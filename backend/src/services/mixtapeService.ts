import Album from '../models/album';
import Track from '../models/track';
import Mixtape, { type MixtapeRecord, type MixtapeSong } from '../models/mixtape';
import navidromeService, { type NavidromePlaylist, type NavidromePlaylistEntry } from './navidromeService';
import ripStatusService from './ripStatusService';
import imageService from './imageService';
import listenNextPlaylistService, { PLAYLIST_NAME } from './listenNextPlaylistService';
import { withWorks } from './mixtapeWorks';
import { getDatabase } from '../database';
import logger from '../logger';
import type { AlbumFormatted } from '../types';

/**
 * Mixtapes: NAVIDROME_USER's own playlists, made by hand across CDs, as a
 * cassette once was. Navidrome holds them; DexVault keeps each as an album of
 * its own (`title_status = 'playlist'`) with its songs in order, so that it
 * goes into Listen Next and the player as a CD does, and writes every change
 * made here straight to Navidrome before reading the playlist again.
 *
 * The playlists are listed again (one getPlaylists) as MusicDex or a
 * mixtape's dialog opens and every half hour; a playlist is read in full only
 * when its `changed` moved. Navidrome's plugins are told of no playlist event.
 */
export const MIXTAPE_STATUS = 'playlist';
export const MIXTAPE_FORMAT = 'Mixtape';

const EVERY_MS = 30 * 60 * 1000;
/** Listed again at most this often when asked, however many ask. */
const FRESH_MS = 5 * 1000;
const ALBUMS_FOR_MS = 60 * 1000;

/** A song of a mixtape as the dialog and the player show it: with the album of DexVault it comes from. */
export interface MixtapeSongShown extends MixtapeSong {
  /** The CD or digital album of DexVault the file is a copy of, null when none stands for it. */
  albumId: number | null;
  cover: string | null;
  /** The work it plays under with the songs beside it, and its own part of it ("II. Largo"); null for a song alone. */
  work: string | null;
  movement: string | null;
}

export interface MixtapeShown {
  album: AlbumFormatted;
  playlistId: string;
  /** The playlist in Navidrome's web player. */
  url: string;
  songs: MixtapeSongShown[];
}

/** One of the owner's playlists to show as a mixtape: not Listen Next's, not a smart one, not another account's. */
const isMixtape = (playlist: NavidromePlaylist): boolean => {
  const user = process.env.NAVIDROME_USER || '';
  return playlist.name !== PLAYLIST_NAME && !playlist.readonly && (!playlist.owner || playlist.owner === user);
};

const songOf = (entry: NavidromePlaylistEntry): MixtapeSong => ({
  songId: entry.id, title: entry.title, artist: entry.artist, album: entry.album, navidromeAlbumId: entry.albumId,
  discNumber: entry.discNumber, track: entry.track, durationSec: entry.durationSec,
});

/** The artists of the songs, those with most songs first. */
export const artistsOf = (songs: Array<{ artist: string }>): string[] => {
  const count = new Map<string, number>();
  songs.forEach(song => { if (song.artist) count.set(song.artist, (count.get(song.artist) || 0) + 1); });
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([artist]) => artist);
};

const durationOf = (songs: MixtapeSong[]): number => songs.reduce((total, song) => total + (song.durationSec || 0), 0);

/** Navidrome's mosaic of the playlist, saved as the album's cover; null when it has none. */
const coverOf = async (albumId: number, playlistId: string): Promise<string | null> => {
  try {
    const { data } = await navidromeService.getCoverArt(`pl-${playlistId}`);
    return await imageService.saveImage(data, 'cd/custom', `mixtape_${albumId}_${Date.now()}.jpg`);
  } catch (error) {
    logger.warn(`Mixtape ${albumId} has no cover: ${(error as Error).message}`);
    return null;
  }
};

/** The album, tracks and cache of a mixtape, written again from the playlist. */
const store = async (record: MixtapeRecord | null, playlist: NavidromePlaylist, entries: NavidromePlaylistEntry[]): Promise<MixtapeRecord> => {
  const songs = entries.map(songOf);
  let albumId = record?.albumId;
  if (albumId == null) {
    const album = await Album.create({
      title: playlist.name, artist: artistsOf(songs), format: MIXTAPE_FORMAT, titleStatus: MIXTAPE_STATUS, totalDuration: durationOf(songs),
    } as unknown as Parameters<typeof Album.create>[0]);
    albumId = album.id;
  }
  // An old mosaic is left to the cleaning of unused images.
  const cover = await coverOf(albumId, playlist.id);
  await Mixtape.setAlbum(albumId, { title: playlist.name, artists: artistsOf(songs), durationSec: durationOf(songs), ...(cover ? { cover } : {}) });
  // Its tracks, one per song in the playlist's order, for the search and the lengths of Listen Next.
  await Track.deleteByCdId(albumId);
  for (const [index, song] of songs.entries()) {
    await Track.create({ albumId, discNumber: 1, trackNumber: index + 1, title: song.title, durationSec: song.durationSec, artist: song.artist ? [song.artist] : [] });
  }
  const saved: MixtapeRecord = { albumId, playlistId: playlist.id, changed: playlist.changed, songs };
  await Mixtape.save(saved);
  return saved;
};

const inListenNext = (albumId: number): Promise<boolean> =>
  new Promise((resolve, reject) => getDatabase().get(
    `SELECT 1 AS found FROM album_collections ac JOIN collections c ON c.id = ac.collection_id
     WHERE c.type = 'listen_next' AND ac.album_id = ?`, [albumId],
    (err: Error | null, row: { found: number } | undefined) => (err ? reject(err) : resolve(Boolean(row)))));

/** Gone from Navidrome, or deleted here: the album goes, out of Listen Next too. */
const forget = async (record: MixtapeRecord): Promise<void> => {
  const album = await Album.findById(record.albumId);
  const wasNext = await inListenNext(record.albumId);
  await Album.delete(record.albumId);
  if (wasNext) listenNextPlaylistService.schedule();
  logger.info(`Mixtape ${record.albumId} "${album?.title ?? record.playlistId}" gone`);
};

let lastListed = 0;
let listing: Promise<void> | null = null;

const sync = async (): Promise<void> => {
  const playlists = (await navidromeService.getPlaylists()).filter(isMixtape);
  const cached = await Mixtape.all();
  const byPlaylist = new Map(cached.map(record => [record.playlistId, record]));
  let changedNext = false;
  for (const playlist of playlists) {
    const record = byPlaylist.get(playlist.id) ?? null;
    if (record && record.changed === playlist.changed) continue;
    try {
      const read = await navidromeService.getPlaylist(playlist.id);
      if (!read) continue;
      const saved = await store(record, read.playlist, read.entries);
      if (record && await inListenNext(saved.albumId)) changedNext = true;
      if (!record) logger.info(`Mixtape ${saved.albumId} "${playlist.name}" taken in from Navidrome`);
    } catch (error) {
      logger.warn(`Playlist "${playlist.name}" not taken in as a mixtape: ${(error as Error).message}`);
    }
  }
  const listed = new Set(playlists.map(playlist => playlist.id));
  for (const record of cached.filter(one => !listed.has(one.playlistId))) await forget(record);
  if (changedNext) listenNextPlaylistService.schedule();
};

let navidromeAlbums: { at: number; ids: Map<string, number> } | null = null;

/** The album of DexVault each album of Navidrome stands for, read again after a minute. */
const dexvaultAlbums = async (): Promise<Map<string, number>> => {
  if (navidromeAlbums && Date.now() - navidromeAlbums.at < ALBUMS_FOR_MS) return navidromeAlbums.ids;
  const ids = new Map<string, number>();
  for (const [albumId, copy] of await ripStatusService.navidromeAlbums()) ids.set(copy.id, albumId);
  navidromeAlbums = { at: Date.now(), ids };
  return ids;
};

/** Writes the songs of a mixtape in Navidrome, then reads it again. */
const writeSongs = async (record: MixtapeRecord, songIds: string[]): Promise<MixtapeRecord> => {
  await navidromeService.savePlaylist({ id: record.playlistId, name: '', songIds });
  return readAgain(record);
};

const readAgain = async (record: MixtapeRecord): Promise<MixtapeRecord> => {
  const read = await navidromeService.getPlaylist(record.playlistId);
  if (!read) {
    await forget(record);
    throw new MixtapeGoneError();
  }
  const saved = await store(record, read.playlist, read.entries);
  if (await inListenNext(saved.albumId)) listenNextPlaylistService.schedule();
  return saved;
};

export class MixtapeGoneError extends Error {
  constructor() { super('This mixtape is no longer in Navidrome'); }
}

/** A change to the songs of a mixtape, as the dialogs ask it. */
export type MixtapeEdit =
  | { add: string[] }
  | { remove: string[] }
  | { removeAt: number }
  | { move: { from: number; to: number } }
  | { songs: string[] };

/**
 * The songs once `edit` is made: songs added go at the end, those already in
 * staying at their place (DexVault never makes a song twice); removing takes
 * every copy of it.
 */
export const applyEdit = (songIds: string[], edit: MixtapeEdit): string[] => {
  if ('add' in edit) return [...songIds, ...[...new Set(edit.add)].filter(id => !songIds.includes(id))];
  if ('remove' in edit) return songIds.filter(id => !edit.remove.includes(id));
  if ('removeAt' in edit) return songIds.filter((_, index) => index !== edit.removeAt);
  if ('move' in edit) {
    const { from, to } = edit.move;
    if (from < 0 || from >= songIds.length || to < 0 || to >= songIds.length) return songIds;
    const next = [...songIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }
  return [...edit.songs];
};

const mixtapeService = {
  isConfigured: (): boolean => navidromeService.isConfigured(),

  /** Lists the playlists again and reads those that changed; at most every few seconds unless `force`. */
  refresh: async (force = false): Promise<void> => {
    if (!navidromeService.isConfigured()) return;
    if (listing) return listing;
    if (!force && Date.now() - lastListed < FRESH_MS) return;
    listing = sync().finally(() => { lastListed = Date.now(); listing = null; });
    return listing;
  },

  /** The mixtapes, their albums and songs. */
  list: async (): Promise<Array<{ album: AlbumFormatted; playlistId: string; songIds: string[] }>> => {
    const albums = new Map((await Album.findByStatus(MIXTAPE_STATUS)).map(album => [album.id, album]));
    return (await Mixtape.all())
      .filter(record => albums.has(record.albumId))
      .map(record => ({ album: albums.get(record.albumId)!, playlistId: record.playlistId, songIds: record.songs.map(song => song.songId) }));
  },

  /** One mixtape with its songs and the albums they come from; null when there is none. */
  get: async (albumId: number): Promise<MixtapeShown | null> => {
    const [album, record] = await Promise.all([Album.findById(albumId), Mixtape.findByAlbumId(albumId)]);
    if (!album || !record) return null;
    let origins = new Map<string, number>();
    try {
      origins = await dexvaultAlbums();
    } catch (error) {
      logger.warn(`The CDs of mixtape ${albumId} not found: ${(error as Error).message}`);
    }
    const covers = new Map<number, string | null>();
    const songs: MixtapeSongShown[] = [];
    for (const song of withWorks(record.songs)) {
      const origin = origins.get(song.navidromeAlbumId) ?? null;
      if (origin != null && !covers.has(origin)) covers.set(origin, (await Album.findById(origin))?.cover ?? null);
      songs.push({ ...song, albumId: origin, cover: origin != null ? covers.get(origin) ?? null : null });
    }
    return { album, playlistId: record.playlistId, url: navidromeService.playlistUrl(record.playlistId), songs };
  },

  /** The songs of a mixtape in order, null when the album is no mixtape: what the player and Listen Next play. */
  songsOf: async (albumId: number): Promise<MixtapeSong[] | null> => (await Mixtape.findByAlbumId(albumId))?.songs ?? null,

  /** A new mixtape in Navidrome with these songs; its album. */
  create: async (name: string, songIds: string[]): Promise<AlbumFormatted> => {
    const playlistId = await navidromeService.savePlaylist({ name, songIds: [...new Set(songIds)] });
    if (!playlistId) throw new Error('Navidrome made no playlist');
    const read = await navidromeService.getPlaylist(playlistId);
    if (!read) throw new Error('Navidrome made no playlist');
    const saved = await store(null, read.playlist, read.entries);
    logger.info(`Mixtape ${saved.albumId} "${name}" made`);
    return (await Album.findById(saved.albumId))!;
  },

  rename: async (albumId: number, name: string): Promise<void> => {
    const record = await Mixtape.findByAlbumId(albumId);
    if (!record) throw new MixtapeGoneError();
    await navidromeService.renamePlaylist(record.playlistId, name);
    await readAgain(record);
  },

  /** Changes the songs, on the playlist as Navidrome has it now. */
  edit: async (albumId: number, edit: MixtapeEdit): Promise<MixtapeRecord> => {
    const record = await Mixtape.findByAlbumId(albumId);
    if (!record) throw new MixtapeGoneError();
    const read = await navidromeService.getPlaylist(record.playlistId);
    if (!read) {
      await forget(record);
      throw new MixtapeGoneError();
    }
    return writeSongs(record, applyEdit(read.entries.map(entry => entry.id), edit));
  },

  /** Deletes the mixtape, in Navidrome too; it leaves Listen Next. */
  remove: async (albumId: number): Promise<boolean> => {
    const record = await Mixtape.findByAlbumId(albumId);
    if (!record) return false;
    await navidromeService.deletePlaylist(record.playlistId);
    await forget(record);
    return true;
  },

  /** A minute after the start, then every half hour. */
  startAutoSync: (): void => {
    if (!navidromeService.isConfigured()) return;
    const tick = () => { mixtapeService.refresh(true).catch(error => logger.warn(`Mixtapes not read from Navidrome: ${(error as Error).message}`)); };
    setTimeout(tick, 60 * 1000).unref();
    setInterval(tick, EVERY_MS).unref();
  },
};

export default mixtapeService;
