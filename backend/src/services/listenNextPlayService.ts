import { getDatabase } from '../database';
import Album from '../models/album';
import Collection from '../models/collection';
import ListenNextPlay, { type ListenNextDeparture } from '../models/listenNextPlay';
import navidromeService from './navidromeService';
import ripStatusService from './ripStatusService';
import listenNextPlaylistService from './listenNextPlaylistService';
import musicCollectionService, { entryKey } from './musicCollectionService';
import Mixtape from '../models/mixtape';
import { drawAgain, inListenNextOrder, setShuffled as shuffleMixtape } from './mixtapeShuffle';
import logger from '../logger';
import type { AlbumFormatted } from '../types';

/** A departure is shown on the page for a day; after that, the album has simply gone. */
const SHOWN_FOR_SEC = 24 * 60 * 60;
/** An album's last file, kept a while: a scrobble asks it of every album of Listen Next. */
const LAST_SONG_FOR_MS = 10 * 60 * 1000;

export interface AlbumLength {
  discs: number;
  tracks: number;
  durationSec: number;
  /** Tracks whose length is not known: the sum is then a floor. */
  missing: number;
}

export interface ListenNextPlayState {
  repeat: boolean;
  /** The playlist of Listen Next in Navidrome, for Amperfy. */
  playlistId: string | null;
  /** That playlist in Navidrome's web player, for a computer. */
  playlistUrl: string | null;
  /**
   * Each with the entry now after its place in the list ("12:0", "12:2"),
   * null at the end, for the page to show it there.
   */
  departures: Array<ListenNextDeparture & { album: AlbumFormatted; beforeKey: string | null }>;
  /** The albums of Listen Next with a copy in Navidrome: those the player can play. */
  ripped: number[];
  /** The discs, tracks and length of every entry in Listen Next or leaving it, by its key: a disc's alone for a disc. */
  lengths: Record<string, AlbumLength>;
  /** The mixtapes that play shuffled from Listen Next. */
  shuffled: number[];
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) => getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

const get = <T>(sql: string, params: unknown[] = []): Promise<T | undefined> =>
  new Promise((resolve, reject) => getDatabase().get(sql, params, (err: Error | null, row: T) => (err ? reject(err) : resolve(row))));

const listenNextId = async (): Promise<number> => {
  const collection = await Collection.findByType('listen_next');
  if (!collection) throw new Error('Listen Next collection not found');
  return collection.id;
};

const lastSongs = new Map<string, { songId: string | null; at: number }>();

/** The last file of an album in Navidrome, last disc, last track; of its disc `disc` alone when one is given. */
const lastSongOf = async (navidromeAlbumId: string, disc = 0): Promise<string | null> => {
  const key = `${navidromeAlbumId}:${disc}`;
  const known = lastSongs.get(key);
  if (known && Date.now() - known.at < LAST_SONG_FOR_MS) return known.songId;
  const files = (await navidromeService.getAlbumSongs(navidromeAlbumId)).filter(file => file.id && (!disc || file.discNumber === disc));
  files.sort((a, b) => a.discNumber - b.discNumber || a.track - b.track);
  const songId = files.length > 0 ? files[files.length - 1].id : null;
  lastSongs.set(key, { songId, at: Date.now() });
  return songId;
};

interface Entry {
  id: number;
  title: string;
  /** 0 for the whole album. */
  disc: number;
}

let checking: Promise<unknown> = Promise.resolve();

/** An entry of Listen Next, played, leaves it: its place noted for Keep here, the playlist written again. */
const leave = async (collectionId: number, entry: Entry, at: number): Promise<ListenNextDeparture> => {
  const place = await get<{ collection_order: number | null; suggested: number | null }>(
    'SELECT collection_order, suggested FROM album_collections WHERE collection_id = ? AND album_id = ? AND disc = ?', [collectionId, entry.id, entry.disc]);
  await run('DELETE FROM album_collections WHERE collection_id = ? AND album_id = ? AND disc = ?', [collectionId, entry.id, entry.disc]);
  const departure = await ListenNextPlay.addDeparture(entry.id, place?.collection_order ?? null, at, Boolean(place?.suggested), entry.disc);
  const mixtape = await Mixtape.findByAlbumId(entry.id);
  if (mixtape) await drawAgain(entry.id, mixtape.songs.length);
  listenNextPlaylistService.schedule();
  logger.info(`Listen Next: "${entry.title}"${entry.disc ? `, disc ${entry.disc},` : ''} played to its end, out of the list`);
  return departure;
};

/** Listen Next's entries in their order: each album, with the disc it is there for (0 for the whole album). */
const entries = async (): Promise<Entry[]> =>
  (await musicCollectionService.getListenNextAlbums()).map(album => ({ id: album.id, title: album.title, disc: album.disc || 0 }));

/**
 * One album of Listen Next played to its end leaves it, unless Repeat is on:
 * the scrobble of its last file by NAVIDROME_USER says so, whoever played it,
 * DexVault's player or Amperfy. A scrobble told twice (by DexVault, then by
 * the plugin) finds the album gone the second time.
 */
const check = async (user: string, songId: string, at: number): Promise<ListenNextDeparture | null> => {
  const mine = process.env.NAVIDROME_USER || '';
  if (!mine || user !== mine || !navidromeService.isConfigured()) return null;
  if (await ListenNextPlay.getRepeat()) return null;
  const collectionId = await listenNextId();
  for (const entry of await entries()) {
    // A mixtape leaves on the scrobble of its own last song, the last drawn when it plays shuffled.
    const mixtape = await Mixtape.findByAlbumId(entry.id);
    if (mixtape) {
      const songs = await inListenNextOrder(entry.id, mixtape.songs);
      if (songs.length > 0 && songs[songs.length - 1].songId === songId) return leave(collectionId, entry, at);
      continue;
    }
    // A disc leaves on the scrobble of its own last song.
    const copy = await ripStatusService.navidromeAlbumFor(entry.id);
    if (!copy || await lastSongOf(copy.id, entry.disc) !== songId) continue;
    return leave(collectionId, entry, at);
  }
  return null;
};

/** ⏭ on its last track in DexVault's player: the album, or its disc, counts as played, whatever was heard of it. */
const markPlayed = async (albumId: number, disc: number, at: number): Promise<ListenNextDeparture | null> => {
  if (await ListenNextPlay.getRepeat()) return null;
  const collectionId = await listenNextId();
  const entry = (await entries()).find(one => one.id === albumId && one.disc === disc);
  return entry ? leave(collectionId, entry, at) : null;
};

const listenNextPlayService = {
  /** Notes a scrobble; the departure it caused, if any. */
  noteScrobble: (user: string, songId: string, at = Math.floor(Date.now() / 1000)): Promise<ListenNextDeparture | null> => {
    const next = checking.then(() => check(user, songId, at));
    checking = next.catch(() => undefined);
    return next;
  },

  /** An album, or its disc, skipped to its end on the Mac: it leaves the list as one played does. The departure, if any. */
  markPlayed: (albumId: number, disc = 0, at = Math.floor(Date.now() / 1000)): Promise<ListenNextDeparture | null> => {
    const next = checking.then(() => markPlayed(albumId, disc, at));
    checking = next.catch(() => undefined);
    return next;
  },

  getState: async (): Promise<ListenNextPlayState> => {
    const listed = await musicCollectionService.getListenNextEntries();
    const inList = new Set(listed.map(entry => entryKey(entry.albumId, entry.disc)));
    const departures: ListenNextPlayState['departures'] = [];
    for (const departure of await ListenNextPlay.departuresSince(Math.floor(Date.now() / 1000) - SHOWN_FOR_SEC)) {
      // Put back in the list by hand since: not leaving any more.
      if (inList.has(entryKey(departure.albumId, departure.disc))) continue;
      const album = await Album.findById(departure.albumId);
      const order = departure.collectionOrder;
      const after = order == null ? undefined : listed.find(entry => entry.order != null && entry.order >= order);
      if (album) departures.push({ ...departure, album, beforeKey: after ? entryKey(after.albumId, after.disc) : null });
    }
    const wanted = [...listed.map(entry => ({ id: entry.albumId, disc: entry.disc })), ...departures.map(departure => ({ id: departure.albumId, disc: departure.disc }))];
    const ids = [...new Set(wanted.map(entry => entry.id))];
    const lengths: Record<string, AlbumLength> = {};
    if (ids.length > 0) {
      const rows = await all<{ album_id: number; disc_number: number; tracks: number; duration: number | null; missing: number }>(
        `SELECT album_id, disc_number, COUNT(*) AS tracks,
           SUM(COALESCE(duration_sec, 0)) AS duration, SUM(duration_sec IS NULL) AS missing
         FROM tracks WHERE album_id IN (${ids.map(() => '?').join(',')}) GROUP BY album_id, disc_number`, ids);
      for (const { id, disc } of wanted) {
        const discs = rows.filter(row => row.album_id === id && (!disc || row.disc_number === disc));
        if (discs.length === 0) continue;
        lengths[entryKey(id, disc)] = {
          discs: discs.length,
          tracks: discs.reduce((sum, row) => sum + row.tracks, 0),
          durationSec: discs.reduce((sum, row) => sum + (row.duration || 0), 0),
          missing: discs.reduce((sum, row) => sum + row.missing, 0),
        };
      }
    }
    const ripped: number[] = [];
    if (navidromeService.isConfigured()) {
      for (const id of new Set(listed.map(entry => entry.albumId))) {
        try {
          const mixtape = await Mixtape.findByAlbumId(id);
          if (mixtape ? mixtape.songs.length > 0 : await ripStatusService.navidromeAlbumFor(id)) ripped.push(id);
        } catch (error) {
          logger.warn(`Is album ${id} ripped: ${(error as Error).message}`);
          break;
        }
      }
    }
    let playlistId: string | null = null;
    try {
      playlistId = await listenNextPlaylistService.playlistId();
    } catch (error) {
      logger.warn(`Finding the Listen Next playlist: ${(error as Error).message}`);
    }
    return {
      repeat: await ListenNextPlay.getRepeat(), playlistId, playlistUrl: playlistId ? navidromeService.playlistUrl(playlistId) : null,
      departures, ripped, lengths, shuffled: await ListenNextPlay.shuffledAlbumIds(),
    };
  },

  setRepeat: async (repeat: boolean): Promise<void> => ListenNextPlay.setRepeat(repeat),

  /** A mixtape of Listen Next played shuffled or in its own order; false when the album is no mixtape. */
  setShuffled: async (albumId: number, shuffled: boolean): Promise<boolean> => {
    const mixtape = await Mixtape.findByAlbumId(albumId);
    if (!mixtape) return false;
    await shuffleMixtape(albumId, mixtape.songs.length, shuffled);
    listenNextPlaylistService.schedule();
    return true;
  },

  /** Keep here: the album goes back to Listen Next at its place. False when there is no such departure. */
  keep: async (departureId: number): Promise<boolean> => {
    const departure = await ListenNextPlay.findDeparture(departureId);
    if (!departure) return false;
    const collectionId = await listenNextId();
    const there = await all('SELECT 1 FROM album_collections WHERE collection_id = ? AND album_id = ? AND disc = ?',
      [collectionId, departure.albumId, departure.disc]);
    if (there.length === 0) {
      if (departure.collectionOrder != null) {
        await run('UPDATE album_collections SET collection_order = collection_order + 1 WHERE collection_id = ? AND collection_order >= ?',
          [collectionId, departure.collectionOrder]);
      }
      await run('INSERT INTO album_collections (album_id, collection_id, collection_order, suggested, disc) VALUES (?, ?, ?, ?, ?)',
        [departure.albumId, collectionId, departure.collectionOrder, departure.suggested ? 1 : 0, departure.disc]);
      listenNextPlaylistService.schedule();
    }
    await ListenNextPlay.markKept(departureId);
    return true;
  },
};

export default listenNextPlayService;
