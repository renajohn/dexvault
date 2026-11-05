import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Album from '../../models/album';
import outputs from '../../services/upnp/outputs';
import navidromeService from '../../services/navidromeService';
import ripStatusService from '../../services/ripStatusService';
import { formatJson } from '../format/resultFormatter';
import { safeToolHandler } from '../safeHandler';

interface Playing {
  where: string;
  status: 'playing' | 'paused' | 'unknown';
  /** DexVault's album id, for get_album and get_album_story; null for an album DexVault does not know. */
  album_id: number | null;
  album: string;
  artist: string;
  disc_number: number;
  track_number: number;
  title: string;
  duration_sec: number | null;
  position_sec?: number;
  /** Navidrome's players only: since the song started, as the player said. */
  minutes_ago?: number;
  /** Played from a mixtape or the radio: its name, the album above being the song's own. */
  from?: string;
}

/** What DexVault's appliances play: it drives them, so it knows the track, where in it, and whether it sounds. */
const onAppliances = async (): Promise<Playing[]> =>
  Promise.all(outputs.list().map(async (output): Promise<Playing | null> => {
    const state = output.session;
    if (!state?.album || !state.track || (state.status !== 'playing' && state.status !== 'paused')) return null;
    // A song of a mixtape or the radio comes from an album of its own.
    const songAlbumId = state.tracks[state.index]?.albumId;
    const ownAlbum = songAlbumId === undefined;
    const songAlbum = !ownAlbum && songAlbumId ? await Album.findById(songAlbumId) : null;
    const position = state.status === 'playing' ? state.position + (Date.now() - state.at) / 1000 : state.position;
    return {
      where: output.name,
      status: state.status,
      album_id: ownAlbum ? state.album.id : songAlbum?.id ?? null,
      album: ownAlbum ? state.album.title : songAlbum?.title ?? '',
      artist: state.track.artist,
      disc_number: state.track.disc,
      track_number: state.track.no,
      title: state.track.title,
      duration_sec: state.track.durationSec,
      position_sec: Math.round(position),
      ...(ownAlbum ? {} : { from: state.album.title }),
    };
  })).then(playing => playing.filter((entry): entry is Playing => entry !== null));

/** The player by its name, its account too when another one plays: DexVault's own player logs in as "Dexvault". */
const placeOf = (player: string | null, user: string): string => {
  const name = player?.toLowerCase() === 'dexvault' ? 'DexVault' : player || 'Navidrome';
  return user && user.toLowerCase() !== name.toLowerCase() ? `${name} (${user})` : name;
};

/** What the other players told Navidrome they play: DexVault in a browser or on an iPhone, Amperfy, Navidrome's web player. */
const onNavidrome = async (heard: Set<string>): Promise<Playing[]> => {
  if (!navidromeService.isConfigured()) return [];
  const entries = (await navidromeService.getNowPlaying()).filter(entry => !heard.has(entry.songId));
  if (entries.length === 0) return [];
  const albumOf = new Map([...(await ripStatusService.navidromeAlbums())].map(([albumId, copy]) => [copy.id, albumId]));
  return entries.map(entry => ({
    where: placeOf(entry.player, entry.user),
    status: 'unknown' as const,
    album_id: entry.albumId ? albumOf.get(entry.albumId) ?? null : null,
    album: entry.album,
    artist: entry.artist,
    disc_number: entry.discNumber,
    track_number: entry.track,
    title: entry.title,
    duration_sec: entry.durationSec,
    minutes_ago: entry.minutesAgo,
  }));
};

export const handleGetNowPlaying = async () => {
  const appliances = await onAppliances();
  const songIds = new Set(outputs.list().flatMap(output => output.session?.track ? [output.session.track.songId] : []));
  const elsewhere = await onNavidrome(songIds);
  const playing = [...appliances, ...elsewhere];
  if (playing.length === 0) return formatJson({ playing: [], message: 'Nothing is playing.' });
  return formatJson({ playing });
};

export const registerGetNowPlaying = (server: McpServer): void => {
  server.registerTool(
    'get_now_playing',
    {
      title: 'Get what is playing',
      description: 'Return what is playing now, one entry per place: the appliances DexVault drives (Salon, Bureau), ' +
        'with whether they play or are paused and the position in the track, and every other player that told Navidrome ' +
        '(DexVault in a browser or on an iPhone, Amperfy), whose pause cannot be told and which say how many minutes ago the song started. ' +
        'album_id is DexVault\'s album, for get_album and get_album_story; a song played from a mixtape or the radio names it in "from". ' +
        'Call it when the user asks about "this song", "this album" or "track 3" without naming the album.',
      inputSchema: {},
    },
    safeToolHandler('get_now_playing', handleGetNowPlaying)
  );
};
