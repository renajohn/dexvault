import musicCollectionService from '../musicCollectionService';
import listenNextPlayService from '../listenNextPlayService';
import ListenNextPlay, { type ListenNextDeparture } from '../../models/listenNextPlay';

/**
 * Listen Next played on an appliance, album after album, by the server
 * alone: the page's turn (frontend/src/services/listenNextQueue.ts) carried
 * over, so that the next album starts with the iPhone locked. The list is
 * read again at the end of each album: the next one is the one after the
 * album playing in the list as it now is, the first one after the last. An
 * album played to its end leaves the list by its scrobble, unless Repeat is
 * on; so does one skipped with ⏭ on its last track. With Repeat off, the
 * play stops when it comes back to an album played in this play.
 *
 * Each entry is an album whole or one of its discs, by its key ("12:0", "12:2").
 */

export type EntryKey = string;

export const entryKey = (albumId: number, disc?: number | null): EntryKey => `${albumId}:${disc || 0}`;

export const parseEntryKey = (key: EntryKey | number): { albumId: number; disc: number } => {
  const [album, disc = '0'] = String(key).split(':');
  return { albumId: Number(album), disc: Number(disc) || 0 };
};

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

/** Where Listen Next goes back to once a detour is over: the entry and the track it was left on. */
export interface DetourBack {
  key: EntryKey;
  index: number;
}

/** What a turn keeps, written with its session: a restart of DexVault goes on from it. */
export interface TurnState {
  order: EntryKey[];
  listed: EntryKey[] | null;
  currentKey: EntryKey | null;
  repeat: boolean;
  played: EntryKey[];
  departed: EntryKey[];
  /** The entries played in turn since ▶, those of which a track counted, and the detour under way. */
  startedAt: number;
  albums: EntryKey[];
  heard: EntryKey[];
  detour: { key: EntryKey; back: DetourBack } | null;
}

export interface TurnDeps {
  /** The streamed list's entries, in order: the CDs to put on the player are not played here. */
  listIds: () => Promise<EntryKey[]>;
  /** An entry skipped to its end: out of the list as one played. */
  markPlayed: (key: EntryKey) => Promise<ListenNextDeparture | null>;
  repeat: () => Promise<boolean>;
}

/** Plays track `index` of an entry; false when it has nothing to play (no rip). */
export type PlayEntry = (key: EntryKey, index: number) => Promise<boolean>;

export const listenNextDeps: TurnDeps = {
  listIds: async () => (await musicCollectionService.getListenNextAlbums())
    .filter(album => (album as { medium?: string }).medium !== 'cd')
    .map(album => entryKey(album.id, (album as { disc?: number | null }).disc)),
  markPlayed: async key => {
    const { albumId, disc } = parseEntryKey(key);
    return listenNextPlayService.markPlayed(albumId, disc);
  },
  repeat: () => ListenNextPlay.getRepeat(),
};

const emptyState = (): TurnState => ({
  order: [], listed: null, currentKey: null, repeat: false, played: [], departed: [],
  startedAt: 0, albums: [], heard: [], detour: null,
});

export class ListenNextTurn {
  private deps: TurnDeps;
  private state: TurnState;
  /** The departures the turn caused, for the session to tell the pages. */
  onLeft: (left: ListenNextDeparture) => void = () => undefined;

  constructor(deps: TurnDeps = listenNextDeps, state?: Partial<TurnState> | null) {
    this.deps = deps;
    this.state = { ...emptyState(), ...(state || {}) };
  }

  snapshot(): TurnState {
    return JSON.parse(JSON.stringify(this.state));
  }

  get currentKey(): EntryKey | null { return this.state.currentKey; }

  get detour(): TurnState['detour'] { return this.state.detour; }

  get albums(): EntryKey[] { return [...this.state.albums]; }

  get heard(): EntryKey[] { return [...this.state.heard]; }

  setRepeat(value: boolean): void { this.state.repeat = value; }

  private async readRepeat(): Promise<void> {
    try { this.state.repeat = await this.deps.repeat(); } catch { /* Repeat as it was */ }
  }

  private noteHeard(key: EntryKey): void {
    if (!this.state.heard.includes(key)) this.state.heard.push(key);
  }

  private async play(play: PlayEntry, key: EntryKey, index = 0): Promise<boolean> {
    const started = await play(key, index).catch(() => false);
    if (started) {
      this.state.currentKey = key;
      if (!this.state.albums.includes(key)) this.state.albums.push(key);
    }
    return started;
  }

  private async playFrom(play: PlayEntry, candidates: EntryKey[]): Promise<boolean> {
    for (const key of candidates) {
      if (!this.state.repeat && this.state.played.includes(key)) return false;
      if (await this.play(play, key)) return true;
    }
    return false;
  }

  private async markPlayed(key: EntryKey): Promise<void> {
    this.noteHeard(key);
    try {
      const left = await this.deps.markPlayed(key);
      if (left) {
        this.noteDeparted(left.albumId, left.disc);
        this.onLeft(left);
      }
    } catch {
      // Left in the list: the next album plays all the same.
    }
  }

  private async readList(current: EntryKey | null): Promise<EntryKey[]> {
    const ids = await this.deps.listIds();
    this.state.order = withCurrent(ids, this.state.order, current);
    this.state.listed = ids;
    return ids;
  }

  /** Plays Listen Next from entry `key` (at its track `index`), from the top without it. False when nothing could be played. */
  async start(play: PlayEntry, key?: EntryKey | null, index = 0): Promise<boolean> {
    this.state = { ...emptyState(), startedAt: Math.floor(Date.now() / 1000) };
    await this.readRepeat();
    this.state.order = await this.deps.listIds();
    this.state.listed = this.state.order;
    const at = key == null ? -1 : this.state.order.indexOf(key);
    const turn = at < 0 ? this.state.order : [...this.state.order.slice(at), ...this.state.order.slice(0, at)];
    // An entry out of the list asked for (an album played from its card, carried over): played first, the list after it.
    if (key != null && at < 0 && await this.play(play, key, index)) return true;
    for (const id of turn) {
      if (await this.play(play, id, id === key ? index : 0)) return true;
    }
    return false;
  }

  /**
   * A play carried over from elsewhere (the page's player): the turn goes on
   * after this entry as the page's would after a reload, the list read at its end.
   */
  pickUp(key: EntryKey): void {
    this.state = { ...emptyState(), startedAt: Math.floor(Date.now() / 1000), currentKey: key, order: [key], albums: [key] };
  }

  /**
   * The album playing is over: played to its end, skipped with ⏭ on its last
   * track, or taken out by hand while it played. True when another one started.
   */
  async albumEnded(play: PlayEntry, how: 'ended' | 'skipped' | 'removed'): Promise<boolean> {
    const id = this.state.currentKey;
    if (id == null) return false;
    await this.readRepeat();
    const detour = this.state.detour;
    if (detour && detour.key === id) {
      // A detour over: back to the track Listen Next was left on.
      this.state.detour = null;
      if (await this.play(play, detour.back.key, detour.back.index)) return true;
      await this.readList(detour.back.key);
      return this.playFrom(play, albumsAfter(this.state.order, detour.back.key, this.state.repeat));
    }
    if (!this.state.played.includes(id)) this.state.played.push(id);
    // ⏭ on its last track: listened to, as one played to its end; its place in the list kept for the turn to go on after it.
    if (how === 'skipped' && !this.state.repeat) {
      await this.readList(id);
      await this.markPlayed(id);
    }
    await this.readList(id);
    return this.playFrom(play, albumsAfter(this.state.order, id, this.state.repeat));
  }

  /** A track of the entry playing counted as played. */
  noteCounted(): void {
    if (this.state.currentKey != null) this.noteHeard(this.state.currentKey);
  }

  /** An entry that left the list once played, as the server said: not one taken out by hand. */
  noteDeparted(albumId: number, disc?: number | null): void {
    const key = entryKey(albumId, disc);
    if (!this.state.departed.includes(key)) this.state.departed.push(key);
  }

  /** The list as just read, for an entry taken out by hand to be noticed. */
  noteList(ids: EntryKey[]): void {
    this.state.order = withCurrent(ids, this.state.order, this.state.currentKey);
    this.state.listed = ids;
  }

  /** Taken out by hand while it plays: its track ends, then the next album. Never during a detour. */
  leaveAfterTrack(): boolean {
    const { currentKey, listed, departed, detour } = this.state;
    if (currentKey == null || detour?.key === currentKey) return false;
    return listed !== null && !listed.includes(currentKey) && !departed.includes(currentKey);
  }

  /** The same, the list read again first: the server has no page to tell it the list changed. */
  async shouldLeave(): Promise<boolean> {
    try { this.noteList(await this.deps.listIds()); } catch { return false; }
    return this.leaveAfterTrack();
  }

  /**
   * Jumps to track `index` of entry `key`: of the entry playing, `playTrack`;
   * of another entry of the list, the one left comes round in the turn; of one
   * out of the list, a detour, back where Listen Next was once it is over.
   */
  async jumpTo(play: PlayEntry, playTrack: (index: number) => Promise<void>, key: EntryKey, index: number, currentIndex: number): Promise<boolean> {
    const current = this.state.currentKey;
    if (current == null) return false;
    if (key === current) {
      await playTrack(index);
      return true;
    }
    const ids = await this.readList(current);
    if (ids.includes(key)) {
      this.state.detour = null;
      return this.play(play, key, index);
    }
    const back = this.state.detour?.back ?? { key: current, index: currentIndex };
    const started = await this.play(play, key, index);
    if (started) this.state.detour = { key, back };
    return started;
  }

  /** The entries still to come in this turn, after the one playing (or the one a detour goes back to, itself first). */
  upcoming(playing: EntryKey | null = this.state.currentKey): EntryKey[] {
    const back = this.state.detour?.back.key ?? null;
    const from = back ?? playing;
    if (from == null) return [];
    const ahead: EntryKey[] = back != null && back !== playing ? [back] : [];
    for (const id of albumsAfter(this.state.order, from, false)) {
      if (!this.state.repeat && this.state.played.includes(id)) break;
      if (id !== playing && !ahead.includes(id)) ahead.push(id);
    }
    return ahead;
  }
}
