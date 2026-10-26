import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../utils/safeStorage';
import { isComputer } from '../utils/isComputer';
import type { EntryKey } from '../utils/listenNextEntry';
import outputs, { knownOutputs, onOutputLeft, outputsLoaded, positionAt, subscribeOutputs, type OutputError, type OutputState } from './outputs';
import toast from '../components/shared/Toast';

/** A file of the rip, as the player plays it. */
export interface PlayerTrack {
  songId: string;
  title: string;
  disc: number;
  no: number;
  durationSec: number | null;
  /** Hearted in Navidrome when the album was started: the bar's ♥ until it knows better. */
  starred?: boolean;
  /**
   * A song of a mixtape: its own artist, the CD or digital album of DexVault it
   * comes from, and that album's cover, which the bar shows while it plays.
   */
  artist?: string;
  albumId?: number | null;
  cover?: string | null;
  /** A song of a mixtape: its place in it, from 0, which a shuffled play keeps while `no` follows the play. */
  place?: number;
}

/** The album a play belongs to, for the bar, the cards and the Mac's own controls. */
export interface PlayerAlbum {
  /** The CD in DexVault; null for an album Navidrome has and the collection does not. */
  id: number | null;
  /** The album in Navidrome, and its page there, when known. */
  navidromeId?: string | null;
  url?: string | null;
  /** Where it was started, for the bar to lead back there: the Digital page's tab, say. */
  from?: string | null;
  title: string;
  artist: string;
  cover: string | null;
  /** One disc of the album, played from Listen Next alone; absent for the whole album. */
  disc?: number | null;
}

/** Where a play was left, kept in the browser: Navidrome's own saved queue is shared with Amperfy. */
export interface PlayerResume {
  album: PlayerAlbum;
  tracks: PlayerTrack[];
  index: number;
  position: number;
  /** The bar was out: a reload brings it back, paused there. False once ✕ took it away. */
  barOpen?: boolean;
  /** The list the album was played from, to go on with once it is over. */
  queue?: PlayerQueue | null;
}

/** A list the player goes on with once an album is over: Listen Next. */
export type PlayerQueue = 'listenNext';

/**
 * What a list does when an album is over: played to its end, skipped with ⏭
 * on its last track, or taken out of the list by hand while it played. True
 * when it went on with another album.
 */
export type AlbumEnd = (how: 'ended' | 'skipped' | 'removed') => Promise<boolean>;

export interface PlayOptions {
  queue?: PlayerQueue;
  onAlbumEnd?: AlbumEnd;
  /** Asked at the end of each track: the album is to be left there, taken out of its list. */
  leaveAfterTrack?: () => boolean;
  /** A track of the album was counted as played, as Navidrome is told. */
  onCounted?: () => void;
}

/**
 * Where the music plays: this browser (This computer, This iPhone), or an
 * appliance of the house (Salon), which the server plays on and the bar
 * then shows and commands, as its own.
 */
export type PlayerOutput = { kind: 'local' } | { kind: 'renderer'; id: string; name: string };

export interface PlayerState {
  album: PlayerAlbum | null;
  /** The list the album is played from, null for an album played alone. */
  queue: PlayerQueue | null;
  tracks: PlayerTrack[];
  index: number;
  playing: boolean;
  /** Seconds into the track, and its length once the file says it. */
  position: number;
  duration: number;
  /** Whether the bar at the foot of the screen is out. */
  barShown: boolean;
  /** What ✕ or a reload left, to resume from the album's card. */
  resume: PlayerResume | null;
  error: string | null;
  /** The words of the track, in their panel along the left edge, on a desktop. */
  lyricsOpen: boolean;
  /** Where it plays: the output chosen, or one playing that the bar follows while nothing plays here. */
  output: PlayerOutput;
  /** An appliance that plays something else (taken), or does not answer (unreachable); null otherwise. */
  outputStatus: 'taken' | 'unreachable' | null;
  /** Of Listen Next played on an appliance, the entries to come, as the server counts them; null here. */
  upcoming: EntryKey[] | null;
}

const RESUME_KEY = 'dexvault.player.resume';
/** The words were out: they come out again with the next play, in this browser. */
const LYRICS_KEY = 'dexvault.player.lyrics';
/** A play counts once half the track is heard, or four minutes of it, as the other players count it. */
const SCROBBLE_AFTER_SEC = 240;
/** ⏮ goes back to the start of the track past this many seconds, to the one before within them. */
const RESTART_AFTER_SEC = 3;

const streamUrl = (songId: string) => `/api/music/navidrome/stream/${encodeURIComponent(songId)}`;

const readResume = (): PlayerResume | null => {
  try {
    const raw = readStored(RESUME_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && Array.isArray(value.tracks) && value.album ? value : null;
  } catch {
    return null;
  }
};

/** A private window keeps nothing: Resume is a convenience. An empty value stands for none. */
const writeResume = (resume: PlayerResume | null) => writeStored(RESUME_KEY, resume ? JSON.stringify(resume) : '');

const readLyricsOpen = (): boolean => readStored(LYRICS_KEY) === '1';

/** The output chosen in this browser, kept from one visit to the next. */
const OUTPUT_KEY = 'dv.player.output';
const LOCAL: PlayerOutput = { kind: 'local' };

const readOutput = (): PlayerOutput => {
  try {
    const value = JSON.parse(readStored(OUTPUT_KEY) || 'null');
    return value?.kind === 'renderer' && typeof value.id === 'string' ? { kind: 'renderer', id: value.id, name: String(value.name || '') } : LOCAL;
  } catch {
    return LOCAL;
  }
};

/** What this browser is called as an output. */
export const localOutputName = (agent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string =>
  /iPhone/.test(agent) ? 'This iPhone' : /iPad/.test(agent) ? 'This iPad' : isComputer() ? 'This computer' : 'This phone';

export const sameOutput = (a: PlayerOutput, b: PlayerOutput): boolean =>
  a.kind === b.kind && (a.kind === 'local' || a.id === (b as { id: string }).id);

/** What plays in this browser: the audio elements' state. The bar shows it while the output is this browser. */
let state: PlayerState = {
  album: null, queue: null, tracks: [], index: 0, playing: false, position: 0, duration: 0, barShown: false,
  resume: typeof window !== 'undefined' ? readResume() : null, error: null,
  lyricsOpen: typeof window !== 'undefined' ? readLyricsOpen() : false,
  output: LOCAL, outputStatus: null, upcoming: null,
};
/** What the bar, the cards and Listen Next see: this browser's state, or an appliance's play. */
let view: PlayerState = state;
let chosen: PlayerOutput = typeof window !== 'undefined' ? readOutput() : LOCAL;
/** An appliance playing, or paused, that the bar shows while nothing plays here, as a remote would. */
let followed: { id: string; name: string } | null = null;
/**
 * Appliances left by a choice while they held an album, with what they were
 * doing then: not followed again until that changes (it plays, another album).
 */
const declined = new Map<string, string>();
const markOf = (session: OutputState | null): string =>
  (session?.album ? `${session.status}|${session.album.id ?? session.album.title}|${session.album.disc ?? 0}` : '');

const listeners = new Set<() => void>();
const set = (changes: Partial<PlayerState>) => {
  state = { ...state, ...changes };
  refresh();
};

const sessionOf = (id: string): OutputState | null => knownOutputs().find(output => output.id === id)?.session ?? null;

/**
 * The bar follows an appliance that plays while nothing plays here and this
 * browser is the output, or, when nothing is in this browser's player at all,
 * one paused (the last one asked): Play on an album's card goes there, ▶
 * takes it up again. It lets go once that one stops, or this one plays.
 */
const follow = () => {
  for (const [id, mark] of declined) if (markOf(sessionOf(id)) !== mark) declined.delete(id);
  if (chosen.kind !== 'local' || state.playing) {
    followed = null;
    return;
  }
  if (followed) {
    const session = sessionOf(followed.id);
    if (!session?.album || session.status === 'stopped' || declined.has(followed.id)) followed = null;
  }
  if (!followed) {
    const holding = knownOutputs().filter(output => output.reachable && output.session?.album && !declined.has(output.id));
    const playing = holding.find(output => output.session!.status === 'playing');
    const paused = state.album ? undefined
      : holding.filter(output => output.session!.status === 'paused').sort((a, b) => b.session!.at - a.session!.at)[0];
    const one = playing ?? paused;
    if (one) followed = { id: one.id, name: one.name };
  }
};

/** The output the bar plays on: the one chosen (an appliance gone from the list: this browser), else the one followed. */
const effective = (): PlayerOutput => {
  if (chosen.kind === 'renderer') {
    const id = chosen.id;
    if (!outputsLoaded()) return chosen;
    const listed = knownOutputs().find(output => output.id === id);
    if (listed) return { kind: 'renderer', id, name: listed.name };
  }
  return followed ? { kind: 'renderer', id: followed.id, name: knownOutputs().find(output => output.id === followed!.id)?.name ?? followed.name } : LOCAL;
};

const NO_TRACKS: PlayerTrack[] = [];
// Kept while they say the same: the cards' and the bar's effects do not run again at every state.
let lastOutput: PlayerOutput = LOCAL;
let lastResume: { session: OutputState | null; resume: PlayerResume | null } = { session: null, resume: null };

/** An appliance's play as the bar shows it: the same shape as this browser's. */
const rendererView = (output: PlayerOutput & { kind: 'renderer' }): PlayerState => {
  const listed = knownOutputs().find(one => one.id === output.id);
  const session = listed?.session ?? null;
  const track = session?.tracks[session.index];
  if (!sameOutput(lastOutput, output) || lastOutput.kind !== 'renderer' || lastOutput.name !== output.name) lastOutput = output;
  if (lastResume.session !== session) {
    lastResume = {
      session,
      resume: session?.album && session.status === 'stopped'
        ? { album: session.album, tracks: session.tracks, index: session.index, position: session.position, queue: session.queue }
        : null,
    };
  }
  const away = (outputsLoaded() && !listed?.reachable) || session?.status === 'unreachable';
  return {
    album: session?.album ?? null,
    queue: session?.queue ?? null,
    tracks: session?.tracks ?? NO_TRACKS,
    index: session?.index ?? 0,
    playing: session?.status === 'playing',
    position: session ? positionAt(session) : 0,
    duration: session?.duration || track?.durationSec || 0,
    barShown: Boolean(session?.album) && session?.status !== 'stopped',
    resume: lastResume.resume,
    error: session?.error ?? null,
    lyricsOpen: state.lyricsOpen,
    output: lastOutput,
    outputStatus: away ? 'unreachable' : session?.status === 'taken' ? 'taken' : null,
    upcoming: session?.queue === 'listenNext' ? session.upcoming : null,
  };
};

/** The hand moves on between two states of an appliance playing. */
let ticker: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 1000;

const refresh = () => {
  follow();
  const output = effective();
  view = output.kind === 'local' ? state : rendererView(output);
  if (view.output.kind === 'renderer' && view.playing) {
    if (!ticker) ticker = setInterval(refresh, TICK_MS);
  } else if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  listeners.forEach(listener => listener());
};

/** The appliance the commands go to, while the bar shows one. */
const rendererId = (): string | null => (view.output.kind === 'renderer' ? view.output.id : null);

/** What went wrong on an appliance, said: away in orange, the rest in red. */
export const reportOutputError = (error: unknown): void => {
  const refused = error as OutputError;
  if (refused?.status === 'unreachable') toast(refused.message, { tone: 'warning' });
  else if (refused?.status === 'taken') toast(refused.message, { tone: 'info' });
  else toast((error as Error)?.message || 'The command did not go through', { tone: 'danger' });
};

const onRenderer = (work: (id: string) => Promise<unknown>): boolean => {
  const id = rendererId();
  if (!id) return false;
  work(id).catch(reportOutputError);
  return true;
};

/*
 * The Mac kept awake while a play goes on. Chrome lets go of its hold on
 * sleep at the end of each track and takes it again only seconds into the
 * next: with the screen off, macOS sleeps in between. A Web Audio stream kept
 * running holds the sound card, and so sleep, across the gap: a constant far
 * below hearing, since Chrome stops a stream of zeros after half a minute.
 * Let go a while after the play stops, so that the step from one album of a
 * list to the next does not let go of it.
 */
const KEEP_AWAKE_LEVEL = 1e-5;
const KEEP_AWAKE_GRACE_MS = 30000;
let keepAwakeContext: AudioContext | null = null;
let keepAwakeRelease: ReturnType<typeof setTimeout> | null = null;

/**
 * Called from a click or a key: a browser starts no sound otherwise. On a
 * computer alone: a phone plays on with its screen off by itself, and an
 * iPhone whose page runs a Web Audio stream takes the page's sound for that
 * stream, its lock screen and Control Center no longer showing the track.
 */
const holdAwake = () => {
  if (typeof AudioContext === 'undefined' || !isComputer()) return;
  try {
    if (!keepAwakeContext) {
      keepAwakeContext = new AudioContext();
      const source = keepAwakeContext.createConstantSource();
      source.offset.value = KEEP_AWAKE_LEVEL;
      source.connect(keepAwakeContext.destination);
      source.start();
    }
    keepAwakeContext.resume().catch(() => undefined);
  } catch { /* the Mac may sleep between tracks, the play still works */ }
};

const syncAwake = () => {
  if (!keepAwakeContext) return;
  if (state.playing) {
    if (keepAwakeRelease) clearTimeout(keepAwakeRelease);
    keepAwakeRelease = null;
    if (keepAwakeContext.state === 'suspended') keepAwakeContext.resume().catch(() => undefined);
  } else if (!keepAwakeRelease) {
    keepAwakeRelease = setTimeout(() => {
      keepAwakeRelease = null;
      if (!state.playing) keepAwakeContext?.suspend().catch(() => undefined);
    }, KEEP_AWAKE_GRACE_MS);
  }
};
listeners.add(syncAwake);

/*
 * Two audio elements: the one playing, and the next track loading in the
 * other, so the step from one to the next is as short as a browser allows.
 */
let audios: HTMLAudioElement[] = [];
let active = 0;
let scrobbled = false;
let announced = false;
let lastSaved = 0;
let options: PlayOptions = {};

/** An album of Listen Next that left it once played, as the server answered a scrobble. */
export const LISTEN_NEXT_LEFT_EVENT = 'dexvault:listen-next-left';

const current = (): HTMLAudioElement => audios[active];
const spare = (): HTMLAudioElement => audios[1 - active];

/**
 * Where an element is to start once it has its data: an iPhone reads nothing
 * before a touch and then starts from 0, the place set before being lost. One
 * listener per element, set once in setUp(), goes there as the metadata comes,
 * if the source is still the one it was wanted for; a newer place wanted for
 * the same source (a seek before the data) takes the older one's place.
 */
const wanted = new WeakMap<HTMLAudioElement, { url: string; at: number }>();
const wantAt = (audio: HTMLAudioElement, at: number) => {
  // Its data there already (the spare, loaded beside the track before): straight there, no metadata to wait for.
  if (at > 0 && audio.readyState < 1) wanted.set(audio, { url: audio.src, at });
  else wanted.delete(audio);
  audio.currentTime = at;
};

const post = (songId: string, submission: boolean) => {
  fetch(`/api/music/navidrome/scrobble/${encodeURIComponent(songId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submission }),
  })
    .then(response => (response.ok ? response.json() : null))
    .then(body => {
      if (body?.left) window.dispatchEvent(new CustomEvent(LISTEN_NEXT_LEFT_EVENT, { detail: body.left }));
    })
    .catch(() => undefined);
};

/** The album is over: the list it is played from goes on, or it waits on its first track to be played again. */
const endAlbum = (how: 'ended' | 'skipped' | 'removed') => {
  const finish = () => {
    if (!state.album || state.tracks.length === 0) return;
    writeResume(here(0, 0));
    set({ playing: false, position: 0, index: 0, resume: readResume() });
    current().src = streamUrl(state.tracks[0].songId);
    preloadNext();
  };
  const goOn = options.onAlbumEnd;
  if (!goOn) {
    if (how !== 'skipped') finish();
    return;
  }
  const album = state.album;
  goOn(how).then(played => { if (!played && state.album === album) finish(); }, () => { if (state.album === album) finish(); });
};

/** Where the play is, kept: the bar is out while an album is in the player. */
const here = (index: number, position: number, barOpen = true): PlayerResume | null =>
  state.album ? { album: state.album, tracks: state.tracks, index, position: Math.floor(position), barOpen, queue: state.queue } : null;

const saveResume = (barOpen = true) => {
  if (!state.album || state.tracks.length === 0) return;
  writeResume(here(state.index, current()?.currentTime || state.position, barOpen));
};

/** Whether a track heard up to `at` seconds was counted already: half of it, or four minutes. */
const countedAt = (track: PlayerTrack, at: number) =>
  at >= SCROBBLE_AFTER_SEC || (Boolean(track.durationSec) && at >= (track.durationSec as number) / 2);

/** Loads the track after the current one into the spare element, ready to take over. */
const preloadNext = () => {
  const next = state.tracks[state.index + 1];
  const other = spare();
  if (!other) return;
  if (!next) {
    other.removeAttribute('src');
    return;
  }
  const url = streamUrl(next.songId);
  if (!other.src.endsWith(url)) {
    other.src = url;
    other.preload = 'auto';
    other.load();
  }
};

const updateMediaSession = () => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !state.album) return;
  const track = state.tracks[state.index];
  try {
    // A song of a mixtape: its own artist and its CD's cover.
    const cover = track?.cover !== undefined ? track.cover : state.album.cover;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track?.title || '',
      artist: track?.artist ?? state.album.artist,
      album: state.album.title,
      artwork: cover ? [{ src: new URL(cover, window.location.href).href }] : [],
    });
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  } catch { /* an older browser: the keys still work through the audio element */ }
  updatePositionState();
};

/**
 * Where the track is, for the lock screen and the Control Center: Navidrome's
 * stream tells no length before its end, so the system's bar stayed empty
 * without the track's own. Told as it plays, pauses and moves.
 */
const updatePositionState = () => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const audio = audios[active];
  if (!audio) return;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : state.duration;
  if (!(duration > 0)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(duration, Math.max(0, audio.currentTime || state.position)),
      playbackRate: audio.playbackRate || 1,
    });
  } catch { /* a position past the end, an older browser */ }
};

/** Starts the track at `index` from `at` seconds, on the element already holding it when it is the spare. */
const start = (index: number, at = 0) => {
  const track = state.tracks[index];
  if (!track) return;
  const url = streamUrl(track.songId);
  if (spare().src.endsWith(url)) {
    // The spare holds it: the one playing stops, and its late 'pause' finds it no longer mine.
    current().pause();
    active = 1 - active;
  }
  const audio = current();
  // A new source stops the element by itself, with no 'pause' of its own to show Play a moment.
  const changed = !audio.src.endsWith(url);
  if (changed) audio.src = url;
  // Played on from where it was left: counted then already if far enough in.
  scrobbled = countedAt(track, at);
  announced = false;
  set({ index, position: at, duration: track.durationSec || 0, playing: true, error: null });
  // Where to start, set before the data is there: the browser goes there once it has it, and a new source forgets it.
  // No listener waiting for the metadata: on an iPhone nothing loads before a touch, and one left waiting took the
  // next album, or a seek made meanwhile, back to this place. And play() at once, within the touch that asked it.
  if (at > 0 || changed) wantAt(audio, at);
  audio.play().catch(error => {
    // Interrupted by a newer load or play (iOS does so as a track follows another): the sound goes on, nothing is wrong.
    if ((error as Error).name === 'AbortError' || !audio.paused) return;
    set({ playing: false, error: (error as Error).message });
  });
  preloadNext();
  updateMediaSession();
  // Where it starts, kept at once: a reload right away still offers Resume.
  writeResume(here(index, at));
};

/**
 * The bar comes out as soon as something plays, cards open or not: every
 * dialog ends above it (--player-h), its foot in sight.
 */
const revealBar = () => {
  if (!state.barShown) set({ barShown: true });
};

const setUp = () => {
  if (audios.length > 0 || typeof Audio === 'undefined') return;
  audios = [new Audio(), new Audio()];
  audios.forEach((audio, which) => {
    audio.preload = 'auto';
    const mine = () => which === active;
    audio.addEventListener('loadedmetadata', () => {
      const want = wanted.get(audio);
      if (!want) return;
      wanted.delete(audio);
      if (audio.src.endsWith(want.url)) audio.currentTime = want.at;
    });
    audio.addEventListener('timeupdate', () => {
      if (!mine()) return;
      // Still to go where it was wanted: the place shown stays, rather than a 0 of the first frames.
      if (wanted.has(audio)) return;
      const position = audio.currentTime;
      const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
      // ⏯ as the element is: a play refused or a pause told late never leaves Play shown while the sound goes on.
      set(state.playing === !audio.paused ? { position, duration } : { position, duration, playing: !audio.paused });
      const track = state.tracks[state.index];
      if (track && !scrobbled && duration > 0 && (position >= duration / 2 || position >= SCROBBLE_AFTER_SEC)) {
        scrobbled = true;
        post(track.songId, true);
        options.onCounted?.();
      }
      if (Math.abs(position - lastSaved) >= 5) {
        lastSaved = position;
        saveResume();
      }
    });
    audio.addEventListener('playing', () => {
      if (!mine()) return;
      const track = state.tracks[state.index];
      if (track && !announced) {
        announced = true;
        post(track.songId, false);
      }
      set({ playing: true });
      updateMediaSession();
    });
    audio.addEventListener('pause', () => {
      if (!mine() || audio.ended) return;
      set({ playing: false });
      saveResume();
      updateMediaSession();
    });
    // The system's bar follows a move, and the length once the stream tells it.
    audio.addEventListener('seeked', () => { if (mine()) updatePositionState(); });
    audio.addEventListener('durationchange', () => { if (mine()) updatePositionState(); });
    audio.addEventListener('ended', () => {
      if (!mine()) return;
      if (options.leaveAfterTrack?.()) endAlbum('removed');
      else if (state.index + 1 < state.tracks.length) start(state.index + 1);
      // The album is over: its list goes on, or it can be played again from its card, from the start.
      else endAlbum('ended');
    });
    audio.addEventListener('error', () => {
      if (!mine() || !audio.src) return;
      set({ playing: false, error: 'Could not play this track from Navidrome' });
    });
  });
  if ('mediaSession' in navigator) {
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => player.toggle(true)],
      ['pause', () => player.toggle(false)],
      ['nexttrack', () => player.next()],
      ['previoustrack', () => player.previous()],
      ['seekto', details => { if (details.seekTime != null) player.seek(details.seekTime); }],
    ];
    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* not every action everywhere */ }
    }
  }
};

/** ✕ here: stops, keeps where it was for Resume, and takes the bar away: a reload does not bring it back. */
const stopHere = () => {
  if (!state.album) return;
  saveResume(false);
  audios.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
  options = {};
  set({ album: null, queue: null, tracks: [], index: 0, playing: false, position: 0, duration: 0, barShown: false, resume: readResume() });
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
};

export const player = {
  /**
   * Called within a touch or a click, before the tracks are asked for: an
   * iPhone lets an element play only when asked within a gesture, and the
   * asking for the tracks takes it past one when the network is slow. A load
   * of nothing within the gesture lifts that for the element's next play.
   */
  prime: () => {
    if (player.rendererId() || typeof Audio === 'undefined') return;
    setUp();
    holdAwake();
    for (const audio of audios) if (!audio.src) audio.load();
  },

  /** Plays an album's tracks from `index`, the rest of the album after it; a list goes on after it when given. */
  playAlbum: (album: PlayerAlbum, tracks: PlayerTrack[], index = 0, at = 0, playOptions: PlayOptions = {}) => {
    if (tracks.length === 0) return;
    // On an appliance the server plays them, Listen Next's turn included; the page's callbacks are not needed there.
    const { from: _from, ...sent } = album;
    if (onRenderer(id => outputs.play(id, {
      album: sent, tracks, index: Math.max(0, Math.min(index, tracks.length - 1)), position: at, listenNext: playOptions.queue === 'listenNext',
    }))) return;
    setUp();
    holdAwake();
    options = playOptions;
    set({ album, queue: playOptions.queue ?? null, tracks, resume: null });
    writeResume(null);
    spare().removeAttribute('src');
    start(Math.max(0, Math.min(index, tracks.length - 1)), at);
    revealBar();
  },

  /** Pauses or plays on; `playing` forces one or the other, as the Mac's keys ask. */
  toggle: (playing?: boolean) => {
    // An appliance taken by something else, or stopped: ▶ takes it back where it was.
    if (onRenderer(id => ((view.outputStatus === 'taken' || view.resume) && playing !== false
      ? outputs.resume(id)
      : outputs.toggle(id, playing ?? !view.playing)))) return;
    if (!state.album) return;
    const audio = current();
    const want = playing ?? audio.paused;
    if (want) {
      holdAwake();
      // Brought back by a reload, its track not loaded: started now, within the touch, as any track is. An iPhone
      // loads a source set outside a touch in a state it can neither take up at its place nor seek in.
      if (!audio.src) {
        start(state.index, state.position);
        return;
      }
      audio.play().then(() => { if (state.error) set({ error: null }); }).catch(error => set({ error: (error as Error).message }));
    } else audio.pause();
  },

  /** The next track; on the last one, the next album of the list it is played from. */
  next: () => {
    if (onRenderer(id => outputs.next(id))) return;
    if (state.index + 1 < state.tracks.length) start(state.index + 1);
    else if (options.onAlbumEnd) endAlbum('skipped');
  },

  /** Another track of the album playing, from its start, the list it is played from kept. */
  playTrack: (index: number) => {
    if (onRenderer(id => outputs.track(id, index))) return;
    if (!state.album || !state.tracks[index]) return;
    start(index);
  },

  /** Back to the start of the track, or to the one before in its first seconds. */
  previous: () => {
    if (onRenderer(id => outputs.previous(id))) return;
    if (current().currentTime > RESTART_AFTER_SEC || state.index === 0) player.seek(0);
    else start(state.index - 1);
  },

  seek: (seconds: number) => {
    if (onRenderer(id => outputs.seek(id, Math.max(0, seconds)))) return;
    const audio = current();
    if (!audio) return;
    // The place asked, not the element's, which before its data is loaded (an iPhone's, before a touch) may still say 0.
    const at = Math.max(0, seconds);
    if (audio.readyState < 1) wantAt(audio, at);
    else audio.currentTime = at;
    set({ position: at });
  },

  /** ✕: stops, keeps where it was for Resume, and takes the bar away: a reload does not bring it back. */
  stop: () => {
    if (onRenderer(id => outputs.stop(id))) {
      followed = null;
      return;
    }
    stopHere();
  },

  /** Plays on from where ✕ or a reload left it; on an appliance taken by something else, from where it was taken. */
  resume: () => {
    if (onRenderer(id => outputs.resume(id))) return;
    const saved = state.resume;
    if (!saved) return;
    player.playAlbum(saved.album, saved.tracks, saved.index, saved.position);
  },

  /** Shows or hides the words; without `open`, the other way from now. */
  showLyrics: (open?: boolean) => {
    const lyricsOpen = open ?? !state.lyricsOpen;
    writeStored(LYRICS_KEY, lyricsOpen ? '1' : '');
    set({ lyricsOpen });
  },

  /** Seconds into the track now, finer than `position`, which the audio element updates a few times a second. */
  currentTime: (): number => {
    const id = rendererId();
    if (id) {
      const session = sessionOf(id);
      return session ? positionAt(session) : 0;
    }
    return current()?.currentTime ?? state.position;
  },

  /** The appliance the bar plays on, null for this browser. */
  rendererId,

  /**
   * Plays on another output from now. What plays goes along (`transfer`, the
   * default): the same album, track and place there, Listen Next's turn
   * included, and the output left falls silent. Without it, the output left
   * only falls silent, for what is played next to start on the new one.
   */
  setOutput: (next: PlayerOutput, { transfer = true }: { transfer?: boolean } = {}) => {
    const from = view.output;
    const moving = transfer && view.playing && view.album !== null && view.tracks.length > 0;
    chosen = next.kind === 'local' ? LOCAL : { kind: 'renderer', id: next.id, name: next.name };
    writeStored(OUTPUT_KEY, chosen.kind === 'local' ? '' : JSON.stringify(chosen));
    followed = null;
    for (const output of knownOutputs()) {
      if (output.session?.album && output.session.status !== 'stopped' && !(next.kind === 'renderer' && next.id === output.id)) declined.set(output.id, markOf(output.session));
    }
    if (sameOutput(from, next)) {
      refresh();
      return;
    }
    if (from.kind === 'local') {
      const carried = state.album ? {
        album: state.album, tracks: state.tracks, index: state.index, position: current()?.currentTime ?? state.position, queue: state.queue,
      } : null;
      if (state.playing) stopHere();
      refresh();
      if (moving && carried && next.kind === 'renderer') {
        const { from: _from, ...album } = carried.album;
        outputs.play(next.id, { album, tracks: carried.tracks, index: carried.index, position: carried.position, listenNext: carried.queue === 'listenNext' })
          .catch(reportOutputError);
      }
      return;
    }
    const session = sessionOf(from.id);
    refresh();
    if (moving && session?.album) {
      if (next.kind === 'renderer') {
        outputs.play(next.id, { from: from.id }).catch(reportOutputError);
        return;
      }
      // Here: it plays first, while the click still lets a browser play, then the appliance falls silent.
      const restore = session.queue && session.album.id != null ? queues.get(session.queue) : undefined;
      player.playAlbum(session.album, session.tracks, session.index, positionAt(session),
        restore ? restore(session.album as PlayerAlbum & { id: number }) : { queue: session.queue ?? undefined });
    }
    if (session?.status === 'playing') outputs.toggle(from.id, false).catch(() => undefined);
  },

  getState: (): PlayerState => view,
};

/**
 * A list that goes on once an album is over registers how to pick it up
 * again after a reload: the player cannot import the list, the list imports
 * the player.
 */
const queues = new Map<PlayerQueue, (album: PlayerAlbum & { id: number }) => PlayOptions>();
let waitingQueue: { queue: PlayerQueue; album: PlayerAlbum } | null = null;

export const registerQueue = (queue: PlayerQueue, restore: (album: PlayerAlbum & { id: number }) => PlayOptions): void => {
  queues.set(queue, restore);
  if (waitingQueue?.queue === queue && state.album === waitingQueue.album && waitingQueue.album.id != null) {
    options = restore(waitingQueue.album as PlayerAlbum & { id: number });
    waitingQueue = null;
  }
};

/**
 * After a reload: the bar comes back, paused where the play was, its track
 * and its moment known, nothing loaded. No sound until ▶, which starts the
 * track then: a browser plays nothing a click has not asked for, and an
 * iPhone loads a source set outside a touch in a state it cannot seek in.
 */
export const restorePlayer = (): void => {
  const saved = readResume();
  if (!saved?.barOpen || saved.tracks.length === 0 || typeof Audio === 'undefined') return;
  setUp();
  const index = Math.max(0, Math.min(saved.index, saved.tracks.length - 1));
  const track = saved.tracks[index];
  const queue = saved.queue ?? null;
  options = {};
  waitingQueue = null;
  if (queue && saved.album.id != null) {
    const restore = queues.get(queue);
    if (restore) options = restore(saved.album as PlayerAlbum & { id: number });
    else waitingQueue = { queue, album: saved.album };
  }
  set({ album: saved.album, queue, tracks: saved.tracks, index, playing: false, position: saved.position,
    duration: track.durationSec || 0, barShown: true, resume: null, error: null });
  if (waitingQueue) waitingQueue.album = state.album!;
  scrobbled = countedAt(track, saved.position);
  announced = false;
  updateMediaSession();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** A slice of the player's state; a component re-renders only when its slice changes. */
export function usePlayer<T>(select: (state: PlayerState) => T): T {
  return useSyncExternalStore(subscribe, () => select(view));
}

/** For tests: back to nothing playing. */
export const resetPlayer = () => {
  audios = [];
  active = 0;
  options = {};
  waitingQueue = null;
  keepAwakeContext?.close().catch(() => undefined);
  keepAwakeContext = null;
  if (keepAwakeRelease) clearTimeout(keepAwakeRelease);
  keepAwakeRelease = null;
  state = { album: null, queue: null, tracks: [], index: 0, playing: false, position: 0, duration: 0, barShown: false, resume: readResume(), error: null,
    lyricsOpen: readLyricsOpen(), output: LOCAL, outputStatus: null, upcoming: null };
  chosen = readOutput();
  followed = null;
  declined.clear();
  lastOutput = LOCAL;
  lastResume = { session: null, resume: null };
  refresh();
};

// What the appliances play shows as it changes; an album leaving Listen Next there is told as a page's scrobble tells it.
subscribeOutputs(refresh);
onOutputLeft(left => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LISTEN_NEXT_LEFT_EVENT, { detail: left }));
});

if (typeof window !== 'undefined') restorePlayer();
