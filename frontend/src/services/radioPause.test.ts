import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioCriteria, RadioPool, RadioSettings, RadioSong } from './radioService';

const server = vi.hoisted(() => ({
  criteria: vi.fn(),
  next: vi.fn(),
  left: vi.fn(),
  fiches: vi.fn(),
  askFiches: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  createMixtape: vi.fn(),
}));

vi.mock('./radioService', () => ({ default: server }));
vi.mock('../utils/mixtapeStore', () => ({ createMixtape: server.createMixtape }));
vi.mock('./musicService', () => ({ default: { getImageUrl: (path: string | null) => (path ? `/images/${path}` : null) } }));

import { player, resetPlayer } from './player';
import { radio, resetRadio, radioAlbum, trackOf } from './radio';

const song = (n: number): RadioSong => ({
  songId: `s${n}`, title: `Song ${n}`, artist: `Artist ${n}`, albumId: 100 + n, album: `Album ${n}`, cover: null,
  discNumber: 1, track: n, durationSec: 200, work: null, movement: null,
  energy: 7, tempo: 'fast', moods: ['upbeat'], styles: ['rock'], lang: 'en',
});

const laptop: RadioSettings = {
  prompt: 'quelque chose de upbeat pour courir',
  recent: ['quelque chose de upbeat pour courir', 'calme pour le soir'],
  pool: { stars: 3.5, hearts: true, popular: false, genre: 'other', wholeWorks: false },
  criteria: { energyMin: 6, tempos: ['fast'], moods: ['upbeat'] },
};

/** What the server holds: the last settings saved, from whichever device. */
let stored: { settings: RadioSettings | null; updatedAt: string | null };
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 4, 10, 0, clock++)).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.values(server).forEach(fn => fn.mockReset());
  stored = { settings: null, updatedAt: null };
  server.left.mockResolvedValue({ ok: true });
  server.settings.mockImplementation(async () => stored);
  server.saveSettings.mockImplementation(async (settings: RadioSettings) => { stored = { settings, updatedAt: at() }; return stored; });
  server.criteria.mockImplementation(async (): Promise<RadioCriteria> => ({ energyMax: 4, moods: ['calm'] }));
  server.next.mockImplementation(async (_c: RadioCriteria, _p: RadioPool, count: number) => ({
    songs: Array.from({ length: count }, (_, i) => song(i + 1)), poolSize: 100, fitting: 40, missingFiches: 0,
  }));
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value), removeItem: (key: string) => kept.delete(key) },
  });
  resetPlayer();
  resetRadio();
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = async () => { await vi.advanceTimersByTimeAsync(1000); };


const pauseLikeABrowser = () => vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
  .mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });

describe('a radio paused for a meal', () => {
  it('stays paused when its band is drawn again, and ▶ then plays the new band', async () => {
    await radio.listen('calme pour le soir');
    await settle();
    radio.play();
    const before = player.getState().tracks.map(one => one.songId);
    pauseLikeABrowser();
    player.toggle(false);
    expect(player.getState().playing).toBe(false);
    let n = 100;
    server.next.mockImplementation(async (_c: RadioCriteria, _p: RadioPool, count: number) => ({
      songs: Array.from({ length: count }, () => song(++n)), poolSize: 100, fitting: 40, missingFiches: 0,
    }));
    await radio.redraw();
    await settle();
    // Nothing started, nothing replaced in the player: the new band waits.
    expect(player.getState().playing).toBe(false);
    expect(player.getState().tracks.map(one => one.songId)).toEqual(before);
    expect(radio.getState().songs[0].songId).toBe('s101');
    radio.play();
    expect(player.getState().tracks[0].songId).toBe('s101');
  });

  it('draws nothing while paused, however short its band', async () => {
    await radio.listen('calme pour le soir');
    await settle();
    radio.play();
    pauseLikeABrowser();
    player.toggle(false);
    server.next.mockClear();
    // The band emptied (the settings changed elsewhere): no draw until it plays again.
    player.playTrack?.(player.getState().index);
    pauseLikeABrowser();
    player.toggle(false);
    await settle();
    expect(server.next).not.toHaveBeenCalled();
  });
});

describe('a radio another device started', () => {
  it('is followed without telling its songs leaving: the device that started it tells them', async () => {
    const tracks = [1, 2, 3].map(n => trackOf(song(n), n - 1));
    player.playAlbum(radioAlbum('rock alternatif énergique'), tracks, 0);
    // What the reset of the test before told is not this one's.
    server.left.mockClear();
    player.next();
    await settle();
    expect(server.left).not.toHaveBeenCalled();
  });

  it('tells them when it started the radio itself', async () => {
    await radio.listen('calme pour le soir');
    await settle();
    radio.play();
    player.next();
    await settle();
    expect(server.left).toHaveBeenCalledWith('s1', 'skipped');
  });
});
