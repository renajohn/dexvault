import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Album from '../../models/album';
import Track from '../../models/track';
import AlbumGuide from '../../models/albumGuide';
import type { TrackFormatted } from '../../types';
import { formatJson, formatError } from '../format/resultFormatter';
import { safeToolHandler } from '../safeHandler';

export const getAlbumInputShape = {
  id: z.number().int().positive().describe('Local album id (the integer id from search_albums).'),
};

const getAlbumInputSchema = z.object(getAlbumInputShape);
export type GetAlbumInput = z.infer<typeof getAlbumInputSchema>;

export const handleGetAlbum = async (input: GetAlbumInput) => {
  const album = await Album.findById(input.id);
  if (!album) {
    return formatError(`Album with id ${input.id} not found.`);
  }
  const tracks = await Track.findByCdId(input.id).catch(() => [] as TrackFormatted[]);
  const guide = await AlbumGuide.get(input.id).catch(() => null);

  // Group tracks by disc number for a more readable structure; credits only where MusicBrainz gave some.
  const discsMap: Record<number, Array<Record<string, unknown>>> = {};
  for (const t of tracks) {
    if (!discsMap[t.discNumber]) discsMap[t.discNumber] = [];
    discsMap[t.discNumber].push({
      track_number: t.trackNumber,
      title: t.title,
      duration_sec: t.durationSec,
      isrc: t.isrc,
      ...(t.artist.length ? { artist: t.artist } : {}),
      ...(t.work ? { work: t.work } : {}),
      ...(t.composers.length ? { composers: t.composers } : {}),
      ...(t.performers.length ? { performers: t.performers } : {}),
    });
  }
  const discs = Object.keys(discsMap)
    .map(n => parseInt(n, 10))
    .sort((a, b) => a - b)
    .map(n => ({ disc_number: n, tracks: discsMap[n] }));

  return formatJson({
    ...album,
    discs,
    listening_guide: guide?.text ?? null,
  });
};

export const registerGetAlbum = (server: McpServer): void => {
  server.registerTool(
    'get_album',
    {
      title: 'Get album details',
      description: 'Return the full JSON detail of a single album by id, including tracks grouped by disc ' +
        '(with their work, composers and performers when MusicBrainz gives them) and listening_guide, ' +
        'the guide shown on its card to read before listening (Markdown, drawn from Wikipedia), null when it has none. ' +
        'For the album\'s background (its Wikipedia article, or the works it plays), call get_album_story. ' +
        'Track numbers restart on each disc. ' +
        'titleStatus says what the user has: "owned" a CD of the collection, "digital" only files in Navidrome, "wish" neither, wished.',
      inputSchema: getAlbumInputShape,
    },
    safeToolHandler('get_album', handleGetAlbum)
  );
};
