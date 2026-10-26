import musicService from './musicService';
import { LISTEN_NEXT_LEFT_EVENT, player, registerQueue, reportOutputError, type PlayerAlbum, type PlayOptions } from './player';
import outputs, { type OutputError } from './outputs';
import { playAlbumById } from '../utils/playAlbum';
import { readStored, writeStored } from '../utils/safeStorage';
import { entryKey, keyOf, parseEntryKey, type EntryKey } from '../utils/listenNextEntry';

/**
 * Listen Next played on the computer, album after album. The list is read
 * again at the end of each album, so what is added, taken out or moved since
 * counts: the next album is the one after the album playing in the list as it
 * now is, the first one after the last. An album played to its end leaves the
 * list on the server, by its scrobble, unless Repeat is on; so does one
 * skipped with ⏭ on its last track, heard or not.
 *
 * With Repeat off, the play stops when nothing is left, or when it comes back
 * to an album played in this play.
 *
 * The tracks' dialog jumps to a track of the list, or to one of an album
 * that left it in this play: a detour, played to its end out of the list,
 * after which Listen Next goes back where it was.
 *
 * Each entry of the list is an album whole or one of its discs, named by its
 * key ("12:0", "12:2"): two discs of an album are two turns, each played alone.
 *
 * On an appliance of the house (Salon) the server plays the turn by the same
 * rules: the page only starts it there, or jumps in it.
 */

/** Listen Next started on the appliance the bar plays on: false when it has nothing to play. */
const onRenderer = async (id: string, body: { key?: EntryKey; index?: number }): Promise<boolean> => {
  try {
    await outputs.listenNext(id, body);
    return true;
  } catch (error) {
    if ((error as OutputError).code === 404) return false;
    reportOutputError(error);
    return true;
  }
};

/** The list as last read, the entry playing kept at its place even once out of it. */
let order: EntryKey[] = [];
/** The list as last read, as it is; null until read after a reload. */
let listed: EntryKey[] | null = null;
let currentKey: EntryKey | null = null;
let repeat = false;
const played = new Set<EntryKey>();
/** Entries that left the list once played, as the server said: not taken out by hand. */
const departed = new Set<EntryKey>();

/** Where Listen Next goes back to once a detour is over: the entry and the track it was left on. */
export interface DetourBack {
  key: EntryKey;
  index: number;
}

/**
 * The play of Listen Next since its ▶, kept in the browser for a reload: the
 * albums played in turn, those of which a track was counted as played, and
 * the detour under way.
 */
export interface ListenNextSession {
  /** Unix seconds. */
  startedAt: number;
  albums: EntryKey[];
  heard: EntryKey[];
  detour: { key: EntryKey; back: DetourBack } | null;
}

const SESSION_KEY = 'dexvault.listenNext.session';

const emptySession = (): ListenNextSession => ({ startedAt: 0, albums: [], heard: [], detour: null });

/** A session kept before the discs named albums by their ids: each the whole album. */
const asKey = (value: unknown): EntryKey => (typeof value === 'number' ? entryKey(value) : String(value));

const readSession = (): ListenNextSession => {
  try {
    const raw = readStored(SESSION_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || !Array.isArray(value.albums) || !Array.isArray(value.heard)) return emptySession();
    const detour = value.detour && (value.detour.key ?? value.detour.albumId) != null && value.detour.back
      ? { key: asKey(value.detour.key ?? value.detour.albumId), back: { key: asKey(value.detour.back.key ?? value.detour.back.albumId), index: value.detour.back.index ?? 0 } }
      : null;
    return { ...emptySession(), startedAt: value.startedAt ?? 0, albums: value.albums.map(asKey), heard: value.heard.map(asKey), detour };
  } catch {
    return emptySession();
  }
};

const noteSession = (change: (session: ListenNextSession) => void): void => {
  const session = readSession();
  change(session);
  writeStored(SESSION_KEY, JSON.stringify(session));
};

const noteHeard = (key: EntryKey) => noteSession(session => {
  if (!session.heard.includes(key)) session.heard.push(key);
});

/**
 * The entries the tracks' dialog shows: those of this play that left the list
 * and were heard, at least a track of them (one taken out by hand unheard was
 * not wanted), or the one playing; then the list as it is.
 */
export const sessionAlbums = (session: ListenNextSession, ids: EntryKey[], current: EntryKey | null): { gone: EntryKey[]; listed: EntryKey[] } => ({
  gone: session.albums.filter(id => !ids.includes(id) && (session.heard.includes(id) || id === current)),
  listed: ids,
});

/** The streamed list's entries: the CDs to put on the player are not played here. */
const listIds = async (): Promise<EntryKey[]> =>
  ((await musicService.getListenNextAlbums()) as Array<{ id: number; disc?: number | null; medium?: string }>)
    .filter(album => album.medium !== 'cd').map(keyOf);

/** The entry an album of the player stands for: its disc, or the whole album. */
export const playingKey = (album: Pick<PlayerAlbum, 'id' | 'disc'> | null | undefined): EntryKey | null =>
  album?.id == null ? null : entryKey(album.id, album.disc);

/**
 * The list as it now is, with the entry playing kept at its place when it
 * has left it: after the entry that came before it, among those still there.
 */
export const withCurrent = <T>(ids: T[], previous: T[], current: T | null): T[] => {
  if (current == null || ids.includes(current)) return ids;
  const at = previous.indexOf(current);
  const before = at < 0 ? [] : previous.slice(0, at).filter(id => ids.includes(id));
  const place = before.length === 0 ? 0 : ids.indexOf(before[before.length - 1]) + 1;
  return [...ids.slice(0, place), current, ...ids.slice(place)];
};

/** The entries to try after `current`, in turn: those after it, then from the top; with Repeat, itself last. */
export const albumsAfter = <T>(ids: T[], current: T | null, withRepeat: boolean): T[] => {
  const at = current == null ? -1 : ids.indexOf(current);
  const turn = at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at)];
  return withRepeat && current != null && at >= 0 ? [...turn, current] : turn;
};

const playFrom = async (candidates: EntryKey[]): Promise<boolean> => {
  for (const key of candidates) {
    if (!repeat && played.has(key)) return false;
    if (await play(key)) return true;
  }
  return false;
};

/** An entry skipped to its end: told to the server, which takes it out of the list as one played. */
const markPlayed = async (key: EntryKey): Promise<void> => {
  noteHeard(key);
  const { albumId, disc } = parseEntryKey(key);
  try {
    const { left } = await musicService.markListenNextPlayed(albumId, disc);
    if (left) window.dispatchEvent(new CustomEvent(LISTEN_NEXT_LEFT_EVENT, { detail: left }));
  } catch {
    // Left in the list: the next album plays all the same.
  }
};

/** How the player goes on once entry `id` of Listen Next is over. */
const optionsFor = (id: EntryKey): PlayOptions => ({
  queue: 'listenNext',
  onAlbumEnd: async how => {
    played.add(id);
    // ⏭ on its last track: the album was listened to, as one played to its end, and leaves the list,
    // its place in the list as it now is kept first, for the turn to go on after it.
    if (how === 'skipped' && !repeat) {
      order = withCurrent(await listIds(), order, id);
      await markPlayed(id);
    }
    const ids = await listIds();
    order = withCurrent(ids, order, id);
    listed = ids;
    return playFrom(albumsAfter(order, id, repeat));
  },
  // Taken out by hand while it plays: its track ends, then the next album.
  leaveAfterTrack: () => currentKey === id && listed !== null && !listed.includes(id) && !departed.has(id),
  onCounted: () => noteHeard(id),
});

const play = async (key: EntryKey, index = 0, options: PlayOptions = optionsFor(key)): Promise<boolean> => {
  const { albumId, disc } = parseEntryKey(key);
  const started = await playAlbumById(albumId, options, index, false, disc).catch(() => false);
  if (started) {
    currentKey = key;
    noteSession(session => { if (!session.albums.includes(key)) session.albums.push(key); });
  }
  return started;
};

/** An entry out of the list played to its end, then back to the track Listen Next was left on. */
const detourOptions = (id: EntryKey, back: DetourBack): PlayOptions => ({
  queue: 'listenNext',
  onAlbumEnd: async () => {
    noteSession(session => { session.detour = null; });
    if (await play(back.key, back.index)) return true;
    const ids = await listIds();
    order = withCurrent(ids, order, back.key);
    listed = ids;
    return playFrom(albumsAfter(order, back.key, repeat));
  },
  onCounted: () => noteHeard(id),
});

if (typeof window !== 'undefined') {
  window.addEventListener(LISTEN_NEXT_LEFT_EVENT, event => {
    const left = (event as CustomEvent<{ albumId?: number; disc?: number }>).detail;
    if (typeof left?.albumId === 'number') departed.add(entryKey(left.albumId, left.disc));
  });
}

export const listenNextQueue = {
  /**
   * After a reload, the album back in the player, paused: Listen Next goes
   * on after its entry as before, the list read again meanwhile.
   */
  restore: (album: Pick<PlayerAlbum, 'id' | 'disc'> & { id: number }): PlayOptions => {
    const key = playingKey(album)!;
    const detour = readSession().detour;
    if (detour?.key === key) {
      currentKey = key;
      return detourOptions(key, detour.back);
    }
    played.clear();
    currentKey = key;
    order = [key];
    listed = null;
    listIds().then(ids => {
      if (currentKey !== key) return;
      order = withCurrent(ids, order, key);
      listed = ids;
    }).catch(() => undefined);
    return optionsFor(key);
  },

  /** Plays Listen Next from entry `key`, from the top without it. False when nothing could be played. */
  start: async (key?: EntryKey): Promise<boolean> => {
    player.prime();
    const renderer = player.rendererId();
    if (renderer) return onRenderer(renderer, key ? { key } : {});
    played.clear();
    writeStored(SESSION_KEY, JSON.stringify({ ...emptySession(), startedAt: Math.floor(Date.now() / 1000) }));
    order = await listIds();
    listed = order;
    const at = key == null ? -1 : order.indexOf(key);
    const turn = at < 0 ? order : [...order.slice(at), ...order.slice(0, at)];
    for (const id of turn) {
      if (await play(id)) return true;
    }
    return false;
  },

  /** The list as the page just read it, for an entry taken out by hand to be noticed. */
  noteList: (ids: EntryKey[]): void => {
    if (player.getState().queue !== 'listenNext' || player.rendererId()) return;
    order = withCurrent(ids, order, currentKey);
    listed = ids;
  },

  /**
   * Jumps to track `index` of entry `key`: of the entry playing, the list
   * goes on as it did; of another entry of the list, the one left stays in it
   * and comes round in the turn; of one out of the list, a detour. False when
   * nothing could be played.
   */
  jumpTo: async (key: EntryKey, index: number): Promise<boolean> => {
    const renderer = player.rendererId();
    if (renderer) {
      if (key === playingKey(player.getState().album)) {
        player.playTrack(index);
        return true;
      }
      return onRenderer(renderer, { key, index });
    }
    if (currentKey == null) return false;
    if (key === currentKey) {
      player.playTrack(index);
      return true;
    }
    const ids = await listIds();
    order = withCurrent(ids, order, currentKey);
    listed = ids;
    if (ids.includes(key)) {
      noteSession(session => { session.detour = null; });
      return play(key, index);
    }
    // Out of the list: back where Listen Next was once it is over, the first detour's place kept.
    const back = readSession().detour?.back ?? { key: currentKey, index: player.getState().index };
    const started = await play(key, index, detourOptions(key, back));
    if (started) noteSession(session => { session.detour = { key, back }; });
    return started;
  },

  /** The entries the tracks' dialog shows, the list read again. */
  albums: async (): Promise<{ gone: EntryKey[]; listed: EntryKey[] }> => {
    const ids = await listIds();
    // On an appliance: the list, and the entry playing there when it has left it already.
    if (player.rendererId()) {
      const playing = playingKey(player.getState().album);
      return { gone: playing && !ids.includes(playing) ? [playing] : [], listed: ids };
    }
    listed = ids;
    return sessionAlbums(readSession(), ids, currentKey);
  },

  /**
   * The entries still to come in this turn, in order, after the one playing (or
   * the one a detour goes back to, itself first): what the bar counts the time
   * left of and announces the next track from. Not Repeat's endless round.
   * The entry playing is given by the player, which knows it first.
   */
  upcoming: (playing: EntryKey | null = currentKey): EntryKey[] => {
    // `playing` as the player has it: the bar asks as an album starts, before Listen Next has noted it.
    const back = readSession().detour?.back.key ?? null;
    const from = back ?? playing;
    if (from == null) return [];
    const ahead: EntryKey[] = back != null && back !== playing ? [back] : [];
    for (const id of albumsAfter(order, from, false)) {
      if (!repeat && played.has(id)) break;
      if (id !== playing && !ahead.includes(id)) ahead.push(id);
    }
    return ahead;
  },

  /** This play's session, for the dialog to tell an album played to its end from one taken out. */
  session: (): ListenNextSession => readSession(),

  setRepeat: (value: boolean): void => {
    repeat = value;
  },
};

// A play of Listen Next left by a reload goes on from here.
registerQueue('listenNext', listenNextQueue.restore);

/** For tests: back to nothing played. */
export const resetListenNextQueue = (): void => {
  order = [];
  listed = null;
  currentKey = null;
  repeat = false;
  played.clear();
  departed.clear();
  writeStored(SESSION_KEY, '');
};
