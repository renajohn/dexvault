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
import { radio, resetRadio, syncRadioSettings, radioAlbum, trackOf } from './radio';

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

describe("the radio's settings across devices", () => {
  it('takes the prompt, the recent ones, the pool and the criteria another device saved', async () => {
    stored = { settings: laptop, updatedAt: at() };
    await syncRadioSettings();
    const state = radio.getState();
    expect(state.prompt).toBe(laptop.prompt);
    expect(state.recent).toEqual(laptop.recent);
    expect(state.pool).toEqual(laptop.pool);
    expect(state.criteria).toEqual(laptop.criteria);
    // Taken, not sent back.
    await settle();
    expect(server.saveSettings).not.toHaveBeenCalled();
  });

  it('sends what is changed here, once the changes stop', async () => {
    radio.setPool({ stars: 3 });
    radio.setPool({ hearts: true });
    await settle();
    expect(server.saveSettings).toHaveBeenCalledTimes(1);
    expect(server.saveSettings.mock.calls[0][0].pool).toMatchObject({ stars: 3, hearts: true });
    // The prompt heard here is saved with its criteria.
    await radio.listen('calme pour le soir');
    await settle();
    expect(stored.settings).toMatchObject({ prompt: 'calme pour le soir', criteria: { energyMax: 4, moods: ['calm'] } });
    expect(stored.settings!.recent[0]).toBe('calme pour le soir');
  });

  it("drops a band drawn for another prompt, and keeps this device's own when nothing newer was saved", async () => {
    await radio.listen('calme pour le soir');
    await settle();
    expect(radio.getState().songs.length).toBeGreaterThan(0);
    // Read again with nothing newer: nothing changes.
    await syncRadioSettings();
    expect(radio.getState().prompt).toBe('calme pour le soir');
    expect(radio.getState().songs.length).toBeGreaterThan(0);
    // The laptop saves another prompt: the band of the old one goes.
    stored = { settings: laptop, updatedAt: at() };
    await syncRadioSettings();
    expect(radio.getState().prompt).toBe(laptop.prompt);
    expect(radio.getState().songs).toEqual([]);
    expect(radio.getState().status).toBe('idle');
  });

  it('keeps its own while the radio plays here', async () => {
    await radio.listen('calme pour le soir');
    await settle();
    const songs = radio.getState().songs;
    radio.play();
    stored = { settings: laptop, updatedAt: at() };
    await syncRadioSettings();
    expect(radio.getState().prompt).toBe('calme pour le soir');
    expect(radio.getState().songs.length).toBe(songs.length);
  });

  it('takes them when its radio is only kept paused, from another day', async () => {
    await radio.listen('calme pour le soir');
    await settle();
    const songs = radio.getState().songs;
    player.playAlbum(radioAlbum('calme pour le soir', songs[0]), songs.map((one, i) => trackOf(one, i)), 0);
    // As a browser does: the element paused says so.
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });
    player.toggle(false);
    expect(player.getState().playing).toBe(false);
    stored = { settings: laptop, updatedAt: at() };
    await syncRadioSettings();
    expect(radio.getState().prompt).toBe(laptop.prompt);
    expect(radio.getState().pool).toEqual(laptop.pool);
    // The paused radio of the other prompt is not taken back as this one's band.
    expect(radio.getState().songs).toEqual([]);
  });

  it('shows the covers of a radio it did not draw, and its prompt, the settings of the device playing it taken', async () => {
    // Another device's radio: this one knows none of its songs, only the player's tracks, their covers with them.
    const tracks = [1, 2, 3].map(n => ({ ...trackOf(song(n), n - 1), cover: `/api/images/cd/${n}.jpg` }));
    player.playAlbum(radioAlbum('rock alternatif énergique'), tracks, 0);
    expect(radio.getState().prompt).toBe('rock alternatif énergique');
    expect(radio.getState().songs.map(one => one.cover)).toEqual(['/api/images/cd/1.jpg', '/api/images/cd/2.jpg', '/api/images/cd/3.jpg']);
    stored = { settings: { ...laptop, prompt: 'rock alternatif énergique' }, updatedAt: at() };
    await syncRadioSettings();
    expect(radio.getState().pool).toEqual(laptop.pool);
  });

  it('takes back the covers of a band kept without them', async () => {
    window.localStorage.setItem('dv.radio', JSON.stringify({ prompt: 'rock', songs: [{ ...song(1), cover: null }, { ...song(2), cover: null }] }));
    resetRadio();
    player.playAlbum(radioAlbum('rock'), [1, 2].map(n => ({ ...trackOf(song(n), n - 1), cover: `/api/images/cd/${n}.jpg` })), 0);
    expect(radio.getState().songs.map(one => one.cover)).toEqual(['/api/images/cd/1.jpg', '/api/images/cd/2.jpg']);
  });

  it("gives the server this device's settings when it has none yet", async () => {
    window.localStorage.setItem('dv.radio', JSON.stringify({ prompt: 'du jazz pour cuisiner', recent: ['du jazz pour cuisiner'] }));
    resetRadio();
    await syncRadioSettings();
    await settle();
    expect(stored.settings).toMatchObject({ prompt: 'du jazz pour cuisiner', recent: ['du jazz pour cuisiner'] });
  });
});
