import { useSyncExternalStore } from 'react';
import type { PlayerAlbum, PlayerTrack } from './player';
import type { EntryKey } from '../utils/listenNextEntry';

/**
 * The outputs DexVault plays on besides this browser: the appliances of the
 * house (UPnP), Salon, Bureau. The server plays there and tells every page
 * what plays (Server-Sent Events); a page sends it commands. The player
 * (`services/player.ts`) shows the one chosen in its bar, as its own.
 */

export type OutputStatus = 'playing' | 'paused' | 'stopped' | 'taken' | 'unreachable';

/** The track playing there, with its own artist and cover (a song of a mixtape). */
export interface OutputTrackState {
  songId: string;
  title: string;
  disc: number;
  no: number;
  artist: string;
  cover: string | null;
  durationSec: number | null;
}

/** What plays on an output, as the server tells it. */
export interface OutputState {
  id: string;
  name: string;
  album: PlayerAlbum | null;
  track: OutputTrackState | null;
  index: number;
  count: number;
  tracks: PlayerTrack[];
  status: OutputStatus;
  /** Seconds into the track when the appliance was last asked, at `at` (the server's clock, ms). */
  position: number;
  duration: number;
  at: number;
  volume: number | null;
  muted: boolean;
  queue: 'listenNext' | null;
  /** The entries of Listen Next still to come in this turn ("12:0"). */
  upcoming: EntryKey[];
  error: string | null;
  /** Away, with a play kept for when it answers. */
  wanted?: boolean;
}

export interface Output {
  /** Its UDN. */
  id: string;
  /** As the owner named it (Salon), else as it names itself. */
  name: string;
  deviceName: string;
  model: string;
  manufacturer: string;
  reachable: boolean;
  gapless: boolean;
  volume: number | null;
  muted: boolean;
  /** The volume DexVault never sends it above. */
  maxVolume: number;
  session: OutputState | null;
}

/** An album leaving Listen Next once played there, as the scrobble of a page would tell it. */
export interface OutputLeft {
  output: string;
  id: number;
  albumId: number;
  disc: number;
  collectionOrder?: number;
  leftAt: number;
  suggested?: unknown;
}

/** A command refused: `taken` (it plays something else), `unreachable` (off, away), or another error. */
export class OutputError extends Error {
  status: 'taken' | 'unreachable' | null;
  code: number;
  constructor(message: string, code: number, status: 'taken' | 'unreachable' | null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type PlayBody =
  | { albumId: number; disc?: number; index?: number; shuffle?: boolean; listenNext?: boolean; position?: number }
  | { album: PlayerAlbum; tracks: PlayerTrack[]; index?: number; position?: number; listenNext?: boolean }
  | { from: string };

/** The server says the connection is alive every 20 s; with no word of it this long, it is dead. */
const SILENT_AFTER_MS = 45_000;

// What is known of the outputs, for the player and the menus.

let known: Output[] = [];
/** Whether the list was read once: until then a chosen output is not known to be gone. */
let loaded = false;
const listeners = new Set<() => void>();
const leftListeners = new Set<(left: OutputLeft) => void>();

/**
 * How far the server's clock is behind this one, the time a state takes to
 * come included: the least of the last gaps seen between a state's `at` and
 * its arrival. The hand moves on from `at` by this device's clock.
 */
const gaps: number[] = [];
const GAPS_KEPT = 20;
const noteGap = (state: OutputState, receivedAt: number) => {
  if (!state.at) return;
  gaps.push(receivedAt - state.at);
  if (gaps.length > GAPS_KEPT) gaps.shift();
};
export const clockGap = (): number => (gaps.length > 0 ? Math.min(...gaps) : 0);

/**
 * Seconds into the track now: the place the server read, moved on by the
 * time since while it plays, never past the track's end.
 */
export const positionAt = (state: Pick<OutputState, 'status' | 'position' | 'duration' | 'at'>, now = Date.now(), gap = clockGap()): number => {
  if (state.status !== 'playing' || !state.at) return state.position;
  const moved = Math.max(0, (now - gap - state.at) / 1000);
  const end = state.duration > 0 ? state.duration : Infinity;
  return Math.min(end, state.position + moved);
};

/** The same value again when nothing in it changed: the player's slices keep their identity, its effects do not run again. */
const same = <T>(previous: T | undefined, next: T): T =>
  (previous !== undefined && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);

const steady = (previous: OutputState | null | undefined, next: OutputState | null): OutputState | null => {
  if (!next) return null;
  return { ...next, album: same(previous?.album, next.album), track: same(previous?.track ?? undefined, next.track),
    tracks: same(previous?.tracks, next.tracks), upcoming: same(previous?.upcoming, next.upcoming) };
};

const tell = () => listeners.forEach(listener => listener());

/** The list as the server sent it. */
const takeList = (list: Output[], receivedAt = Date.now()) => {
  known = list.map(output => {
    const before = known.find(one => one.id === output.id);
    if (output.session) noteGap(output.session, receivedAt);
    return { ...output, session: steady(before?.session, output.session) };
  });
  loaded = true;
  tell();
};

/** What plays on one output, as an event or a command's answer said. */
export const takeState = (state: OutputState, receivedAt = Date.now()): void => {
  const at = known.findIndex(output => output.id === state.id);
  if (at < 0) return;
  noteGap(state, receivedAt);
  const output = known[at];
  known = [...known.slice(0, at), {
    ...output, name: state.name || output.name, volume: state.volume ?? output.volume, muted: state.muted,
    session: steady(output.session, state),
  }, ...known.slice(at + 1)];
  tell();
};

/**
 * A command's effect shown before the server says it: the toggle, the volume.
 * Answered with what takes it back, for a command refused: unless the server
 * has told something newer since, the output is shown as it was.
 */
const guess = (id: string, change: (output: Output) => Output): (() => void) => {
  const at = known.findIndex(output => output.id === id);
  if (at < 0) return () => undefined;
  const before = known[at];
  const guessed = change(before);
  known = [...known.slice(0, at), guessed, ...known.slice(at + 1)];
  tell();
  return () => {
    const now = known.findIndex(output => output.id === id);
    if (now < 0 || known[now] !== guessed) return;
    known = [...known.slice(0, now), before, ...known.slice(now + 1)];
    tell();
  };
};

/** A command whose effect was shown at once, taken back when it fails. */
const unless = async <T>(undo: () => void, work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch (error) {
    undo();
    throw error;
  }
};

const send = async (method: 'POST' | 'PUT', path: string, body: unknown = {}): Promise<unknown> => {
  const response = await fetch(`/api/outputs/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const answer = await response.json().catch(() => ({})) as { error?: string; status?: string };
  if (!response.ok) {
    const status = answer.status === 'taken' || answer.status === 'unreachable' ? answer.status : null;
    throw new OutputError(answer.error || 'The command did not go through', response.status, status);
  }
  return answer;
};

/** A command to an output, answered with what then plays there; a track chosen just before sent first. */
const command = async (id: string, verb: string, body: unknown = {}): Promise<OutputState> => {
  sendChosen(id);
  const state = await send('POST', `${encodeURIComponent(id)}/${verb}`, body) as OutputState;
  if (state?.id) takeState(state);
  return state;
};

/** A track, an album, chosen on an appliance: sent once the clicks stop this long, the last alone. */
export const CHOOSE_DELAY_MS = 250;
const choosing = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void; dropped: () => void }>();

/** The choice waiting for that appliance sent now: ⏭ or ⏯ pressed right after it go after it, as they were pressed. */
const sendChosen = (id: string) => {
  const waiting = choosing.get(id);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  waiting.send();
};

/**
 * Tracks clicked one after the other quickly: each shown at once, only the
 * last sent, a moment after; the ones it replaces answer null. The appliance
 * takes a few seconds to start a track, and the server would play them all
 * in turn.
 */
const choose = (id: string, verb: string, body: unknown, shown: (output: Output) => Output): Promise<OutputState | null> => {
  const waiting = choosing.get(id);
  if (waiting) {
    clearTimeout(waiting.timer);
    waiting.dropped();
  }
  const undo = guess(id, shown);
  return new Promise<OutputState | null>((resolve, reject) => {
    const send = () => {
      choosing.delete(id);
      unless(undo, command(id, verb, body)).then(resolve, reject);
    };
    choosing.set(id, { timer: setTimeout(send, CHOOSE_DELAY_MS), send, dropped: () => resolve(null) });
  });
};

/** The track `index` shown playing there from its start, before the appliance says so. */
const playingFrom = (output: Output, album: PlayerAlbum | null, tracks: PlayerTrack[], index: number): Output => {
  const track = tracks[index];
  if (!album || !track) return output;
  const session: OutputState = {
    id: output.id, name: output.name, volume: output.volume, muted: output.muted, upcoming: [], queue: null, error: null,
    ...output.session,
    album, tracks, index, count: tracks.length, status: 'playing', position: 0, at: Date.now() - clockGap(),
    duration: track.durationSec || 0,
    track: { songId: track.songId, title: track.title, disc: track.disc, no: track.no, artist: track.artist ?? album.artist, cover: track.cover ?? album.cover ?? null, durationSec: track.durationSec },
  };
  return { ...output, session };
};

const outputs = {
  /** The appliances, with what plays on each; none when UPnP is off. */
  list: async (): Promise<Output[]> => {
    const response = await fetch('/api/outputs');
    if (!response.ok) return [];
    const list = await response.json() as Output[];
    takeList(Array.isArray(list) ? list : []);
    return known;
  },

  /** An album played there; tracks given, shown at once. Null when a newer choice took its place before it was sent. */
  play: (id: string, body: PlayBody) => choose(id, 'play', body, output => ('tracks' in body
    ? playingFrom(output, body.album, body.tracks, Math.max(0, Math.min(body.index ?? 0, body.tracks.length - 1)))
    : output)),
  /** A play carried over there from another output, at its place: at once, not a choice among clicks. */
  carry: (id: string, body: PlayBody) => command(id, 'play', body),
  /** Listen Next played there, from entry `key` (and its track `index`), else from the top. */
  listenNext: (id: string, body: { key?: EntryKey; index?: number } = {}) => choose(id, 'listen-next', body, output => output),
  toggle: (id: string, playing?: boolean) => {
    const undo = playing === undefined ? () => undefined : guess(id, output => (output.session && (output.session.status === 'playing' || output.session.status === 'paused')
      ? { ...output, session: { ...output.session, status: playing ? 'playing' : 'paused', position: positionAt(output.session), at: Date.now() - clockGap() } }
      : output));
    return unless(undo, command(id, 'toggle', playing === undefined ? {} : { playing }));
  },
  next: (id: string) => command(id, 'next'),
  previous: (id: string) => command(id, 'previous'),
  stop: (id: string) => command(id, 'stop'),
  resume: (id: string) => command(id, 'resume'),
  track: (id: string, index: number) => choose(id, 'track', { index }, output => (output.session
    ? playingFrom(output, output.session.album, output.session.tracks, index)
    : output)),
  seek: (id: string, position: number) => command(id, 'seek', { position }),

  /** The volume (never above its ceiling, the server sees to it) or the sound off. */
  volume: async (id: string, change: { volume?: number; muted?: boolean }): Promise<OutputState> => {
    const undo = guess(id, output => ({ ...output, ...(change.volume !== undefined ? { volume: Math.min(output.maxVolume, change.volume) } : {}),
      ...(change.muted !== undefined ? { muted: change.muted } : {}) }));
    const state = await unless(undo, send('PUT', `${encodeURIComponent(id)}/volume`, change)) as OutputState;
    if (state?.id) takeState(state);
    return state;
  },

  /** Its name (empty: its own) and its volume's ceiling (null: the default). */
  settings: async (id: string, change: { name?: string | null; maxVolume?: number | null }): Promise<Output> => {
    const listed = await send('PUT', `${encodeURIComponent(id)}/settings`, change) as Output;
    const at = known.findIndex(output => output.id === id);
    if (at >= 0 && listed?.id) {
      known = [...known.slice(0, at), { ...listed, session: steady(known[at].session, listed.session) }, ...known.slice(at + 1)];
      tell();
    }
    return listed;
  },

  /**
   * What plays on each output, as it changes, until stopped: the list
   * (`outputs`), one output's play (`state`), an album leaving Listen Next
   * (`left`). The same reconnection as the remote's: a connection refused
   * (the server restarting, a proxy's 502) opened again a little later each
   * time; one a proxy keeps open with nothing behind, opened again after 45 s
   * without the server's word; and at once when the page comes back in sight
   * (an iPhone drops it while asleep).
   */
  listen: (handlers: { onOutputs?: (list: Output[]) => void; onState?: (state: OutputState) => void; onLeft?: (left: OutputLeft) => void }): (() => void) => {
    if (typeof EventSource === 'undefined') return () => undefined;
    let source: EventSource | null = null;
    let retry = 0;
    let timer: number | undefined;
    let stopped = false;
    let heard = Date.now();
    const parse = <T>(event: MessageEvent): T | null => {
      heard = Date.now();
      try { return JSON.parse(event.data) as T; } catch { return null; }
    };
    const open = () => {
      heard = Date.now();
      source = new EventSource('/api/outputs/events');
      source.onopen = () => { retry = 0; heard = Date.now(); };
      source.addEventListener('alive', () => { heard = Date.now(); });
      source.addEventListener('outputs', event => {
        const list = parse<Output[]>(event as MessageEvent);
        if (Array.isArray(list)) handlers.onOutputs?.(list);
      });
      source.addEventListener('state', event => {
        const state = parse<OutputState>(event as MessageEvent);
        if (state?.id) handlers.onState?.(state);
      });
      source.addEventListener('left', event => {
        const left = parse<OutputLeft>(event as MessageEvent);
        if (left) handlers.onLeft?.(left);
      });
      source.onerror = () => {
        if (stopped || source?.readyState !== 2) return;
        timer = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    const reopen = () => { source?.close(); window.clearTimeout(timer); open(); };
    open();
    const watch = window.setInterval(() => {
      if (source?.readyState === 1 && Date.now() - heard > SILENT_AFTER_MS) reopen();
    }, 5_000);
    const looked = () => {
      if (document.visibilityState === 'visible' && (source?.readyState !== 1 || Date.now() - heard > SILENT_AFTER_MS)) reopen();
    };
    document.addEventListener('visibilitychange', looked);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(watch);
      document.removeEventListener('visibilitychange', looked);
      source?.close();
    };
  },
};

let stopListening: (() => void) | null = null;

/**
 * Reads the outputs once and, when there are any, listens to them for as
 * long as the page lives: called once by the app. Without UPnP, nothing more.
 */
export const connectOutputs = async (): Promise<void> => {
  if (stopListening) return;
  const list = await outputs.list().catch(() => [] as Output[]);
  if (list.length === 0 || stopListening) return;
  stopListening = outputs.listen({
    onOutputs: list => takeList(list),
    onState: state => takeState(state),
    onLeft: left => leftListeners.forEach(listener => listener(left)),
  });
};

/** An album leaving Listen Next once played on an output. */
export const onOutputLeft = (listener: (left: OutputLeft) => void): (() => void) => {
  leftListeners.add(listener);
  return () => { leftListeners.delete(listener); };
};

export const knownOutputs = (): Output[] => known;
export const outputsLoaded = (): boolean => loaded;

export const subscribeOutputs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The outputs as now known, drawn again as they change. */
export const useOutputs = (): Output[] => useSyncExternalStore(subscribeOutputs, knownOutputs);

/** What a hint says of an output in a menu: away, in use, playing, else its model. */
export const outputHint = (output: Output): string => {
  if (!output.reachable || output.session?.status === 'unreachable') return 'away';
  if (output.session?.status === 'taken') return 'in use';
  if (output.session?.status === 'playing') return [output.model, 'playing'].filter(Boolean).join(' · ');
  return output.model;
};

/** For the tests: nothing known, nothing listening. */
export const resetOutputs = (): void => {
  stopListening?.();
  stopListening = null;
  known = [];
  loaded = false;
  gaps.length = 0;
  tell();
};

export default outputs;
