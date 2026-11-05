import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Album from '../../models/album';
import albumStoryService from '../../services/albumStoryService';
import type { StorySection } from '../../models/albumStory';
import { formatJson, formatError } from '../format/resultFormatter';
import { safeToolHandler } from '../safeHandler';

export const getAlbumStoryInputShape = {
  id: z.number().int().positive().describe('Local album id (the integer id from search_albums or get_now_playing).'),
};

const getAlbumStoryInputSchema = z.object(getAlbumStoryInputShape);
export type GetAlbumStoryInput = z.infer<typeof getAlbumStoryInputSchema>;

const asText = (intro: string | null, sections: StorySection[]): string =>
  [intro, ...sections.map(section => `${'#'.repeat(Math.min(section.level, 6))} ${section.heading}\n\n${section.text}`)]
    .filter(Boolean)
    .join('\n\n');

/** The story the album's card tells: read once from Wikipedia through MusicBrainz, then kept. */
export const handleGetAlbumStory = async (input: GetAlbumStoryInput) => {
  const album = await Album.findById(input.id);
  if (!album) {
    return formatError(`Album with id ${input.id} not found.`);
  }
  const story = await albumStoryService.getStory(input.id);
  if (!story.found) {
    return formatJson({
      album_id: input.id,
      found: false,
      reason: story.reason === 'no_musicbrainz'
        ? 'The album is not linked to MusicBrainz, so no Wikipedia article can be found for it.'
        : 'Wikipedia has no article on the album nor on the works it plays.',
    });
  }
  return formatJson({
    album_id: input.id,
    found: true,
    // The album's own article; none when only its works have one.
    article: story.url
      ? { title: story.title, lang: story.lang, url: story.url, text: asText(story.intro, story.sections) }
      : null,
    works: story.works.map(work => ({
      work: work.workTitle,
      positions: work.positions ?? null,
      title: work.title,
      lang: work.lang,
      url: work.url,
      text: asText(work.intro, work.sections),
    })),
    other_languages: story.links.filter(link => link.url !== story.url).map(link => link.url),
  });
};

export const registerGetAlbumStory = (server: McpServer): void => {
  server.registerTool(
    'get_album_story',
    {
      title: 'Get an album\'s story',
      description: 'Return the Wikipedia article about an album, as its card in DexVault tells it: the narrative ' +
        '(background, recording, songs, reception), credit lists and references left out, from the fuller of ' +
        'the French and English articles. When the album has no article of its own (often a classical record), ' +
        'the articles of the works it plays instead, each with the album positions of its tracks (counted from 1 across the discs). ' +
        'Read from cache; the first call for an album fetches it, which takes a few seconds. ' +
        'Use it to answer questions about an album or one of its songs before searching the web.',
      inputSchema: getAlbumStoryInputShape,
    },
    safeToolHandler('get_album_story', handleGetAlbumStory)
  );
};
