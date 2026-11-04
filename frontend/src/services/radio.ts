import { useSyncExternalStore } from 'react';
import radioService, { type RadioCriteria, type RadioPool, type RadioSettings, type RadioSong } from './radioService';
import { player, subscribePlayer, type PlayerAlbum, type PlayerState, type PlayerTrack } from './player';
import musicService from './musicService';
import { readStored, writeStored } from '../utils/safeStorage';
import { createMixtape } from '../utils/mixtapeStore';

/**
 * The radio: a prompt heard once as criteria, a band of songs drawn from the
 * pool that fit them, and, once ▶ is pressed, DexVault's player playing them
 * as one album that grows at its end. The band is the song playing and those
 * after it; each song leaving is told to the server, played when half heard
 * or more, skipped otherwise, and another is drawn in its place.
 */

/** How many songs the band holds, the one playing among them. */
export const BAND = 10;
/** How many prompts are kept to choose again. */
export const RECENT = 6;
const KEY = 'dv.radio';

export const DEFAULT_POOL: RadioPool = { stars: 4, hearts: false, popular: false, genre: 'both', wholeWorks: false };

export type RadioStatus = 'idle' | 'hearing' | 'drawing' | 'ready' | 'failed';

export interface RadioState {
  prompt: string;
  recent: string[];
  criteria: RadioCriteria | null;
  pool: RadioPool;
  /** The band: the song playing first while the radio plays, then those to come. */
  songs: RadioSong[];
  status: RadioStatus;
  /** Of the last draw: the songs of the pool, those that fit, those with no fiche yet. */
  poolSize: number | null;
  fitting: number | null;
  missingFiches: number;
  /** The fiches asked for: how many wait in the writer's queue. */
  fichesQueued: number | null;
}

interface Kept { prompt?: string; recent?: string[]; criteria?: RadioCriteria | null; pool?: RadioPool; songs?: RadioSong[] }

const readKept = (): Kept => {
  try {
    const value = JSON.parse(readStored(KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const initial = (): RadioState => {
  const kept = readKept();
  return {
    prompt: kept.prompt ?? '',
    recent: Array.isArray(kept.recent) ? kept.recent.slice(0, RECENT) : [],
    criteria: kept.criteria ?? null,
    pool: { ...DEFAULT_POOL, ...(kept.pool ?? {}) },
    songs: Array.isArray(kept.songs) ? kept.songs : [],
    status: Array.isArray(kept.songs) && kept.songs.length > 0 ? 'ready' : 'idle',
    poolSize: null, fitting: null, missingFiches: 0, fichesQueued: null,
  };
};

let state: RadioState = initial();
const listeners = new Set<() => void>();
/** Every song drawn, by its id: the band shows a track of the player with its moods and styles. */
const known = new Map<string, RadioSong>(state.songs.map(song => [song.songId, song]));

const keep = () => writeStored(KEY, JSON.stringify({
  prompt: state.prompt, recent: state.recent, criteria: state.criteria, pool: state.pool, songs: state.songs,
}));

/** What is shared with the other devices: the band stays with this one. */
const SHARED: Array<keyof RadioState> = ['prompt', 'recent', 'criteria', 'pool'];
const sharedOf = (from: RadioState): RadioSettings => ({ prompt: from.prompt, recent: from.recent, pool: from.pool, criteria: from.criteria });
const SAVE_AFTER_MS = 600;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The server's settings this device last read or wrote: newer ones come from another device. */
let knownAt: string | null = null;

/** The shared settings, sent once the changes stop for a moment: the last saved, from whichever device, wins. */
const saveSoon = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    Promise.resolve()
      .then(() => radioService.saveSettings(sharedOf(state)))
      .then(saved => { if (saved?.updatedAt) knownAt = saved.updatedAt; })
      .catch(() => undefined);
  }, SAVE_AFTER_MS);
};

const set = (changes: Partial<RadioState>, { fromServer = false } = {}) => {
  state = { ...state, ...changes };
  if ('prompt' in changes || 'recent' in changes || 'criteria' in changes || 'pool' in changes || 'songs' in changes) keep();
  if (!fromServer && SHARED.some(key => key in changes)) saveSoon();
  listeners.forEach(listener => listener());
};

const learn = (songs: RadioSong[]) => songs.forEach(song => known.set(song.songId, song));

/** The radio's album in the player: named after its prompt, no CD of DexVault, each song its own. */
export const radioAlbum = (prompt: string, first?: RadioSong): PlayerAlbum => ({
  id: null, radio: true, title: `Radio · ${prompt}`, artist: 'Radio', cover: musicService.getImageUrl(first?.cover ?? null),
});

/** A song as the player plays it: like a mixtape's, its own artist, its CD and that CD's cover, its work. */
export const trackOf = (song: RadioSong, index = 0): PlayerTrack => ({
  songId: song.songId, title: song.title, disc: 1, no: index + 1, durationSec: song.durationSec,
  artist: song.artist, albumId: song.albumId, cover: musicService.getImageUrl(song.cover), work: song.work,
});

/** A track of the player whose song is not known any more (a reload with no band kept): what the track says. */
const songOfTrack = (track: PlayerTrack): RadioSong => {
  const song = known.get(track.songId);
  // Known without its cover (a band kept before covers were taken): the player's track has it.
  if (song) return song.cover || !track.cover ? song : { ...song, cover: track.cover };
  return songOfTrackAlone(track);
};

const songOfTrackAlone = (track: PlayerTrack): RadioSong => ({
  songId: track.songId, title: track.title, artist: track.artist ?? '', albumId: Number(track.albumId ?? 0), album: '',
  // The cover the player has for it: a radio followed on an appliance, or drawn on another device, still shows its CDs.
  cover: track.cover ?? null, discNumber: 1, track: track.no, durationSec: track.durationSec, work: track.work ?? null, movement: null,
  energy: 5, tempo: 'mid', moods: [], styles: [], lang: '',
});

/** The radio's album, here or as an appliance gives it back (which may not keep its flag): no CD, named "Radio · …". */
export const isRadioAlbum = (album: PlayerAlbum | null | undefined): boolean =>
  Boolean(album && (album.radio || (album.id == null && album.title.startsWith('Radio · '))));

const radioPlaying = (view: PlayerState = player.getState()): boolean => isRadioAlbum(view.album);

const ids = (songs: RadioSong[]) => songs.map(song => song.songId);

/** The radio this device started, by its album's name, kept through a reload: one another device started, and the bar follows, is not its own. */
const OWN_KEY = 'dv.radio.own';
let ownTitle: string | null = readStored(OWN_KEY);
const own = (title: string) => { ownTitle = title; writeStored(OWN_KEY, title); };

/** A draw in hand: one asked later wins over it. */
let drawing = 0;
let refilling: Promise<void> | null = null;

const told = (songId: string, how: 'played' | 'skipped') => {
  radioService.left(songId, how).catch(() => undefined);
};

/**
 * A band for the criteria: while the radio plays (and `keepNow`), the song
 * playing stays; the songs of the band that still fit the criteria and the
 * pool stay too, in their places, and only those that no longer do are drawn
 * again (all of them when `fresh`, ↻), the player's following, its album
 * named after the prompt as it now is.
 */
const drawAgain = async (keepNow = true, fresh = false): Promise<void> => {
  const ticket = ++drawing;
  const criteria = state.criteria ?? {};
  // Playing, not kept paused: a band drawn while the radio is paused never starts it (a pause on the Bureau stays a pause).
  const playing = keepNow && radioPlaying() && player.getState().playing;
  const now = playing ? state.songs.slice(0, 1) : [];
  const keep = fresh ? [] : ids(state.songs.slice(now.length));
  set({ status: 'drawing' });
  try {
    const draw = await radioService.next(criteria, state.pool, BAND - now.length, ids(now), keep);
    if (ticket !== drawing) return;
    learn(draw.songs);
    const songs = [...now, ...draw.songs];
    if (playing && radioPlaying() && !player.setUpcoming(draw.songs.map(trackOf), radioAlbum(state.prompt, now[0]))) {
      // An appliance takes only songs added at the end: the new band played there anew, from where the song playing is.
      const view = player.getState();
      own(radioAlbum(state.prompt).title);
      player.playAlbum(radioAlbum(state.prompt, now[0]), songs.map(trackOf), 0, view.position);
    }
    set({ songs, status: 'ready', poolSize: draw.poolSize, fitting: draw.fitting, missingFiches: draw.missingFiches });
  } catch {
    if (ticket === drawing) set({ status: 'failed' });
  }
};

/** The band back to BAND songs, those drawn after the others, the player's too while it plays the radio. */
export const refill = (): Promise<void> => {
  if (refilling) return refilling;
  const missing = BAND - state.songs.length;
  if (missing <= 0 || !state.criteria || state.status === 'hearing' || state.status === 'drawing') return Promise.resolve();
  const ticket = drawing;
  refilling = radioService.next(state.criteria, state.pool, missing, ids(state.songs))
    .then(draw => {
      if (ticket !== drawing) return;
      const fresh = draw.songs.filter(song => !state.songs.some(one => one.songId === song.songId));
      learn(fresh);
      // The player told of them follows into the band at once: those it holds already are not added twice, and a
      // queue another device filled meanwhile (two following one appliance) is not filled again.
      const view = player.getState();
      if (radioPlaying(view) && view.tracks.length - view.index < BAND) player.appendTracks(fresh.map(trackOf));
      const songs = [...state.songs, ...fresh.filter(song => !state.songs.some(one => one.songId === song.songId))];
      set({ songs, poolSize: draw.poolSize, fitting: draw.fitting, missingFiches: draw.missingFiches });
    })
    .catch(() => undefined)
    .finally(() => { refilling = null; });
  return refilling;
};

export const radio = {
  getState: (): RadioState => state,

  /**
   * A prompt heard as criteria, then a band drawn for it; kept first of the
   * recent ones. With `play` (↵, a recent prompt's chip) the band plays once
   * drawn, in place of whatever played: the player primed now, within the
   * key or the click, for a browser (an iPhone) to let it start seconds later.
   */
  listen: async (words: string, { play = false }: { play?: boolean } = {}): Promise<void> => {
    const prompt = words.trim();
    if (!prompt) return;
    if (play) player.prime();
    const ticket = ++drawing;
    // What the prompt before was heard as goes at once: these words are heard anew.
    set({ prompt, recent: [prompt, ...state.recent.filter(one => one !== prompt)].slice(0, RECENT), criteria: null, status: 'hearing' });
    try {
      const criteria = await radioService.criteria(prompt);
      if (ticket !== drawing) return;
      set({ criteria });
      await drawAgain(!play);
      if (play && ticket + 1 === drawing && state.status === 'ready' && state.songs.length > 0) {
        own(radioAlbum(prompt).title);
        player.playAlbum(radioAlbum(prompt, state.songs[0]), state.songs.map(trackOf), 0);
      }
    } catch {
      if (ticket === drawing) set({ status: 'failed' });
    }
  },

  /**
   * The criteria or the pool changed (a "Heard as" taken away): the songs that
   * still fit stay, the others are drawn again; ↻ (`fresh`), ten others.
   */
  redraw: (criteria?: RadioCriteria, { fresh = false }: { fresh?: boolean } = {}): Promise<void> => {
    if (criteria) set({ criteria });
    if (!state.criteria) return state.prompt ? radio.listen(state.prompt) : Promise.resolve();
    return drawAgain(true, fresh);
  },

  setPool: (changes: Partial<RadioPool>) => set({ pool: { ...state.pool, ...changes } }),

  /** Nothing fits in the pool: everything that plays instead, and a band drawn there. */
  widen: (): Promise<void> => {
    set({ pool: { ...state.pool, stars: null, hearts: false, popular: false } });
    return radio.redraw();
  },

  /** "Not this one": the song playing skipped, or one to come taken out, told skipped either way; another comes. */
  remove: (songId: string) => {
    const at = state.songs.findIndex(song => song.songId === songId);
    if (at < 0) return;
    const playing = radioPlaying();
    if (playing && at === 0) {
      // The player goes on to the next, the song leaving told as any that leaves.
      player.next();
      return;
    }
    told(songId, 'skipped');
    const songs = state.songs.filter(song => song.songId !== songId);
    if (playing) player.setUpcoming(songs.slice(1).map(trackOf));
    set({ songs });
    refill();
  },

  /** ▶ / ⏸: the band played as one album from its first song, or paused and played on. */
  play: () => {
    const view = player.getState();
    // Paused, the band drawn again since (a new prompt, ↻): ▶ plays that band, not what was paused.
    const ahead = view.tracks.slice(view.index).map(one => one.songId).join('|');
    if (radioPlaying(view) && (view.playing || ahead === ids(state.songs).join('|') || state.songs.length === 0)) {
      player.toggle();
      return;
    }
    if (state.songs.length === 0) return;
    player.prime();
    own(radioAlbum(state.prompt).title);
    player.playAlbum(radioAlbum(state.prompt, state.songs[0]), state.songs.map(trackOf), 0);
  },

  /** The band and as many more drawn the same way, made a mixtape in Navidrome; its album id. */
  saveAsMixtape: async (name: string, count: number): Promise<number | null> => {
    const missing = count - state.songs.length;
    let more: RadioSong[] = [];
    if (missing > 0 && state.criteria) {
      try {
        more = (await radioService.next(state.criteria, state.pool, missing, ids(state.songs))).songs;
      } catch {
        more = [];
      }
    }
    return createMixtape(name.trim(), ids([...state.songs, ...more].slice(0, count)));
  },

  /** The pool's songs with no fiche put first in the writer's queue. */
  askFiches: async (): Promise<number | null> => {
    try {
      const fiches = await radioService.askFiches(state.pool);
      set({ fichesQueued: fiches.queued });
      return fiches.queued;
    } catch {
      return null;
    }
  },
};

/*
 * The player followed: a song of the radio leaving (another one playing, the
 * radio left for an album, stopped) is told, played when half heard or more;
 * the band follows the player's tracks and is refilled as they go.
 */
let last: { songId: string; position: number; duration: number; own: boolean } | null = null;

const follow = () => {
  const view = player.getState();
  const isRadio = radioPlaying(view);
  const track = isRadio ? view.tracks[view.index] : undefined;
  // Told by the device that started the radio alone: two following one appliance would tell each song twice.
  if (last && last.songId !== track?.songId && last.own) {
    told(last.songId, last.duration > 0 && last.position >= last.duration / 2 ? 'played' : 'skipped');
  }
  last = track ? { songId: track.songId, position: view.position, duration: view.duration || track.durationSec || 0, own: view.album?.title === ownTitle } : null;
  if (!isRadio) return;
  // A radio this device did not start (another one's, on an appliance the bar follows): its prompt is the album's name.
  const playedPrompt = view.album?.title.startsWith('Radio · ') ? view.album.title.slice('Radio · '.length) : null;
  if (view.playing && playedPrompt && playedPrompt !== state.prompt && !state.prompt) set({ prompt: playedPrompt }, { fromServer: true });
  // A radio of another prompt kept paused (the settings came from another device since): not this one's band.
  if (!view.playing && view.album?.title !== radioAlbum(state.prompt).title) return;
  const band = view.tracks.slice(view.index);
  // Other songs, or the same kept without the covers the player's tracks have (a band kept before they were taken).
  const coversMissing = state.songs.some((song, i) => !song.cover && band[i]?.cover);
  if (band.map(one => one.songId).join('|') !== ids(state.songs).join('|') || coversMissing) {
    set({ songs: band.map((track, i) => (state.songs[i]?.songId === track.songId && state.songs[i].cover ? state.songs[i] : songOfTrack(track))) });
  }
  // Refilled only while it plays: a radio paused for a meal draws nothing, and starts nothing.
  if (view.playing && state.songs.length < BAND) refill();
};

subscribePlayer(follow);

/**
 * The settings another device saved, taken here: the prompt, the recent
 * ones, the pool and the criteria the laptop set are those the phone finds.
 * A device playing the radio keeps its own while it plays (not while it is
 * only kept paused); a band drawn for another prompt goes, for ▶ or ↵ to
 * draw one for this one.
 */
/** The band kept here when it is that of a radio of another prompt kept paused: it goes, for ▶ to draw this prompt's. */
const dropOtherBand = (view: PlayerState) => {
  if (!radioPlaying(view) || view.playing || view.album?.title === radioAlbum(state.prompt).title) return;
  const paused = view.tracks.slice(view.index).map(one => one.songId).join('|');
  if (state.songs.length && ids(state.songs).join('|') === paused) set({ songs: [], status: 'idle' }, { fromServer: true });
};

export const syncRadioSettings = async (): Promise<void> => {
  let stored;
  try {
    stored = await radioService.settings();
  } catch {
    return;
  }
  if (!stored?.settings || !stored.updatedAt) {
    // None on the server yet: what this device had is the first saved.
    if (state.prompt || state.recent.length) saveSoon();
    return;
  }
  // Playing this device's own prompt, not merely kept paused from another day nor a radio another device started
  // and the bar follows: that one alone keeps its settings while it plays.
  const view = player.getState();
  dropOtherBand(view);
  if (knownAt && stored.updatedAt <= knownAt) return;
  const playingOwn = radioPlaying(view) && view.playing && view.album?.title === ownTitle;
  if (saveTimer || playingOwn) return;
  knownAt = stored.updatedAt;
  const { settings } = stored;
  const otherPrompt = settings.prompt !== state.prompt;
  set({
    prompt: settings.prompt,
    recent: settings.recent.slice(0, RECENT),
    pool: { ...DEFAULT_POOL, ...settings.pool },
    criteria: settings.criteria,
    ...(otherPrompt ? { songs: [], status: 'idle' as RadioStatus, poolSize: null, fitting: null, missingFiches: 0 } : {}),
  }, { fromServer: true });
  dropOtherBand(player.getState());
};

// Read as the page opens, and again as it comes back to the front: the other device may have changed them meanwhile.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  syncRadioSettings();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncRadioSettings(); });
  window.addEventListener('focus', () => { syncRadioSettings(); });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useRadio<T>(select: (current: RadioState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

/** For tests: the radio as a first visit finds it, what the browser kept read again. */
export const resetRadio = () => {
  drawing++;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  knownAt = null;
  ownTitle = readStored(OWN_KEY);
  refilling = null;
  last = null;
  known.clear();
  state = initial();
  learn(state.songs);
  listeners.forEach(listener => listener());
};
