import navidromeService from './navidromeService';
import ripStatusService from './ripStatusService';
import musicCollectionService from './musicCollectionService';
import Mixtape from '../models/mixtape';
import { inListenNextOrder } from './mixtapeShuffle';
import logger from '../logger';

/**
 * Listen Next as a playlist of Navidrome, for Amperfy on the iPhone: its
 * albums in their order, each album's songs in theirs. DexVault holds Listen
 * Next; the playlist is written again in full at each change, and what is
 * changed in it elsewhere does not last.
 */
export const PLAYLIST_NAME = 'DexVault · Listen Next';
export const PLAYLIST_COMMENT = 'Written by DexVault from Listen Next, again at each change: what is changed here does not last.';

const SETTLE_MS = 2000;
const EVERY_MS = 30 * 60 * 1000;

export interface PlaylistReport {
  playlistId: string | null;
  albums: number;
  /** Albums of Listen Next with no copy in Navidrome: nothing to play yet. */
  notRipped: number;
  songs: number;
}

/**
 * Every song of Listen Next, album after album (or the disc chosen), disc by disc, track by track;
 * a mixtape's in its own order, or the one drawn.
 */
const songsOfListenNext = async (): Promise<{ songIds: string[]; albums: number; notRipped: number }> => {
  const albums = await musicCollectionService.getListenNextAlbums();
  const songIds: string[] = [];
  let notRipped = 0;
  for (const album of albums) {
    const mixtape = await Mixtape.findByAlbumId(album.id);
    if (mixtape) {
      songIds.push(...(await inListenNextOrder(album.id, mixtape.songs)).map(song => song.songId));
      continue;
    }
    const copy = await ripStatusService.navidromeAlbumFor(album.id);
    if (!copy) { notRipped++; continue; }
    const files = await navidromeService.getAlbumSongs(copy.id);
    // One disc of it: its songs alone.
    songIds.push(...files.filter(file => file.id && (!album.disc || file.discNumber === album.disc))
      .sort((a, b) => a.discNumber - b.discNumber || a.track - b.track)
      .map(file => file.id!));
  }
  return { songIds, albums: albums.length, notRipped };
};

/** The playlist as last written or found, for Amperfy to open it. */
let knownPlaylistId: string | null = null;

const findPlaylist = async () => {
  const user = process.env.NAVIDROME_USER || '';
  return (await navidromeService.getPlaylists()).find(playlist => playlist.name === PLAYLIST_NAME && (!playlist.owner || playlist.owner === user));
};

const write = async (): Promise<PlaylistReport | null> => {
  if (!navidromeService.isConfigured()) return null;
  const { songIds, albums, notRipped } = await songsOfListenNext();
  const existing = await findPlaylist();
  const playlistId = await navidromeService.savePlaylist({ id: existing?.id, name: PLAYLIST_NAME, songIds });
  knownPlaylistId = playlistId;
  if (playlistId && existing?.comment !== PLAYLIST_COMMENT) await navidromeService.setPlaylistComment(playlistId, PLAYLIST_COMMENT);
  return { playlistId, albums, notRipped, songs: songIds.length };
};

let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<unknown> = Promise.resolve();

const listenNextPlaylistService = {
  /** Writes the playlist now, after any writing under way. */
  sync: (): Promise<PlaylistReport | null> => {
    const next = writing.then(write, write);
    writing = next.catch(() => undefined);
    return next;
  },

  /** Writes the playlist once Listen Next has settled: several changes in a row make one writing. */
  schedule: (): void => {
    if (!navidromeService.isConfigured()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      listenNextPlaylistService.sync().catch(error =>
        logger.warn(`Listen Next not written to Navidrome: ${(error as Error).message}`));
    }, SETTLE_MS);
    timer.unref?.();
  },

  /** The playlist's id in Navidrome, null when it has none yet. */
  playlistId: async (): Promise<string | null> => {
    if (!navidromeService.isConfigured()) return null;
    if (!knownPlaylistId) knownPlaylistId = (await findPlaylist())?.id ?? null;
    return knownPlaylistId;
  },

  /** At the start, then every half hour: CDs ripped since give their songs. */
  startAutoSync: (): void => {
    if (!navidromeService.isConfigured()) return;
    setTimeout(() => listenNextPlaylistService.schedule(), 90 * 1000).unref();
    setInterval(() => listenNextPlaylistService.schedule(), EVERY_MS).unref();
  },
};

export default listenNextPlaylistService;
