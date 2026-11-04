import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioCriteria, RadioPool, RadioSong } from './radioService';

const server = vi.hoisted(() => ({
  criteria: vi.fn(),
  next: vi.fn(),
  left: vi.fn(),
  fiches: vi.fn(),
  askFiches: vi.fn(),
  createMixtape: vi.fn(),
}));

vi.mock('./radioService', () => ({ default: server }));
vi.mock('../utils/mixtapeStore', () => ({ createMixtape: server.createMixtape }));
vi.mock('./musicService', () => ({ default: { getImageUrl: (path: string | null) => (path ? `/images/${path}` : null) } }));

import { player, resetPlayer } from './player';
import { radio, resetRadio, BAND } from './radio';

/** A song of the radio: its energy and an artist of its own unless said. */
export const song = (n: number, energy = 5, artist = `Artist ${n}`): RadioSong => ({
  songId: `s${n}`, title: `Song ${n}`, artist, albumId: 100 + n, album: `Album ${n}`, cover: `covers/${n}.jpg`,
  discNumber: 1, track: n, durationSec: 200, work: null, movement: null,
  energy, tempo: 'mid', moods: ['upbeat'], styles: ['rock'], lang: 'en',
});

let counter = 0;
/** The server draws `count` new songs each time, never one already asked for. */
const drawing = () => server.next.mockImplementation(async (_criteria: RadioCriteria, _pool: RadioPool, count: number) => ({
  songs: Array.from({ length: count }, () => song(++counter)), poolSize: 1190, fitting: 240, missingFiches: 0,
}));

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

let created: HTMLAudioElement[] = [];

beforeEach(() => {
  counter = 0;
  created = [];
  Object.values(server).forEach(fn => fn.mockReset());
  server.criteria.mockResolvedValue({ moods: ['upbeat'], energyMin: 6 });
  server.left.mockResolvedValue({ ok: true });
  server.createMixtape.mockResolvedValue(42);
  drawing();
  const RealAudio = window.Audio;
  vi.stubGlobal('Audio', function Audio() {
    const element = new RealAudio();
    created.push(element);
    return element;
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  resetPlayer();
  resetRadio();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The audio element playing now, heard up to `at` seconds of a track `duration` long. */
const hear = (at: number, duration = 200) => {
  const audio = created.find(element => element.src.endsWith(`/stream/${player.getState().tracks[player.getState().index].songId}`))!;
  Object.defineProperty(audio, 'duration', { value: duration, configurable: true });
  audio.currentTime = at;
  audio.dispatchEvent(new Event('timeupdate'));
  return audio;
};

describe('the radio', () => {
  it('hears a prompt once, draws ten songs for it, and keeps the prompt first of the six recent ones', async () => {
    for (const words of ['un', 'deux', 'trois', 'quatre', 'cinq', 'six']) await radio.listen(words);
    await radio.listen('quelque chose de upbeat');
    expect(server.criteria).toHaveBeenLastCalledWith('quelque chose de upbeat');
    expect(server.next).toHaveBeenLastCalledWith({ moods: ['upbeat'], energyMin: 6 }, expect.objectContaining({ stars: 4 }), BAND, []);
    expect(radio.getState().songs).toHaveLength(BAND);
    expect(radio.getState().recent).toEqual(['quelque chose de upbeat', 'six', 'cinq', 'quatre', 'trois', 'deux']);
    // Kept in the browser: a reload finds the prompt, the band and the recent ones.
    resetRadio();
    expect(radio.getState()).toMatchObject({ prompt: 'quelque chose de upbeat', status: 'ready' });
    expect(radio.getState().songs).toHaveLength(BAND);
    expect(radio.getState().recent[0]).toBe('quelque chose de upbeat');
  });

  it('plays the band as one album, "Radio · <prompt>", each song with its own artist, CD and cover', async () => {
    await radio.listen('rock alternatif');
    radio.play();
    const state = player.getState();
    expect(state.album).toMatchObject({ id: null, radio: true, title: 'Radio · rock alternatif' });
    expect(state.tracks).toHaveLength(BAND);
    expect(state.tracks[0]).toMatchObject({ songId: 's1', artist: 'Artist 1', albumId: 101, cover: '/images/covers/1.jpg', no: 1 });
    expect(state.playing).toBe(true);
    // ▶ again pauses it, rather than starting it over.
    radio.play();
    expect(state.index).toBe(0);
    expect(created.some(audio => audio.src.endsWith('/stream/s1'))).toBe(true);
  });

  it('appends tracks to the album playing without restarting it, the next one loading beside it', () => {
    player.playAlbum({ id: null, radio: true, title: 'Radio · x', artist: 'Radio', cover: null }, [song(1), song(2)].map(one => ({
      songId: one.songId, title: one.title, disc: 1, no: one.track, durationSec: 200,
    })));
    const playing = created.find(audio => audio.src.endsWith('/stream/s1'))!;
    playing.dispatchEvent(new Event('ended'));
    expect(player.getState().index).toBe(1);
    const plays = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    const now = hear(80);

    expect(player.appendTracks([{ songId: 's3', title: 'Song 3', disc: 1, no: 1, durationSec: 200 }])).toBe(true);
    const state = player.getState();
    expect(state.index).toBe(1);
    expect(state.tracks.map(track => [track.songId, track.no])).toEqual([['s1', 1], ['s2', 2], ['s3', 3]]);
    expect(now.currentTime).toBe(80);
    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(plays);
    // The one added loads in the spare, and the saved session has it for a reload.
    expect(created.some(audio => audio !== now && audio.src.endsWith('/stream/s3'))).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('dexvault.player.resume')!).tracks).toHaveLength(3);
  });

  it('tells each song leaving: played when half heard or more, skipped otherwise; and refills to ten', async () => {
    await radio.listen('upbeat');
    radio.play();
    hear(120);
    player.next();
    await flush();
    expect(server.left).toHaveBeenCalledWith('s1', 'played');
    hear(30);
    player.next();
    await flush();
    expect(server.left).toHaveBeenCalledWith('s2', 'skipped');
    // The band follows the player, and the player was given one more each time.
    expect(radio.getState().songs[0].songId).toBe('s3');
    expect(radio.getState().songs).toHaveLength(BAND);
    expect(server.next).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 1, expect.arrayContaining(['s3']));
    expect(player.getState().tracks).toHaveLength(BAND + 2);
    expect(player.getState().index).toBe(2);
  });

  it('tells the song playing as left when another album takes its place', async () => {
    await radio.listen('upbeat');
    radio.play();
    hear(150);
    player.playAlbum({ id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null }, [{ songId: 'n1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }]);
    expect(server.left).toHaveBeenCalledWith('s1', 'played');
  });

  it('✕ on a song to come: told skipped, taken out of the player, and another drawn in its place', async () => {
    await radio.listen('upbeat');
    radio.play();
    radio.remove('s4');
    await flush();
    expect(server.left).toHaveBeenCalledWith('s4', 'skipped');
    expect(player.getState().tracks.map(track => track.songId)).not.toContain('s4');
    expect(player.getState().tracks).toHaveLength(BAND);
    expect(radio.getState().songs.map(one => one.songId)).toEqual(['s1', 's2', 's3', 's5', 's6', 's7', 's8', 's9', 's10', 's11']);
    expect(player.getState().index).toBe(0);
  });

  it('✕ on the song playing skips to the next one, told skipped', async () => {
    await radio.listen('upbeat');
    radio.play();
    hear(20);
    radio.remove('s1');
    await flush();
    expect(server.left).toHaveBeenCalledWith('s1', 'skipped');
    expect(player.getState().index).toBe(1);
  });

  it('✕ before it plays: told skipped, and one more drawn, the others not drawn again', async () => {
    await radio.listen('upbeat');
    radio.remove('s2');
    await flush();
    expect(server.left).toHaveBeenCalledWith('s2', 'skipped');
    const ahead = server.next.mock.calls.at(-1)![3] as string[];
    expect(server.next.mock.calls.at(-1)![2]).toBe(1);
    expect(ahead).toHaveLength(BAND - 1);
    expect(ahead).not.toContain('s2');
    expect(radio.getState().songs).toHaveLength(BAND);
  });

  it('draws again with the criteria edited, the song playing kept', async () => {
    await radio.listen('upbeat');
    radio.play();
    await radio.redraw({ moods: [], energyMin: 6 });
    expect(server.next).toHaveBeenLastCalledWith({ moods: [], energyMin: 6 }, expect.anything(), BAND - 1, ['s1']);
    expect(radio.getState().songs[0].songId).toBe('s1');
    expect(player.getState().tracks.map(track => track.songId)).toEqual(['s1', ...radio.getState().songs.slice(1).map(one => one.songId)]);
  });

  it('saves the band and as many more drawn as asked as a mixtape', async () => {
    await radio.listen('upbeat');
    const band = radio.getState().songs.map(one => one.songId);
    await expect(radio.saveAsMixtape('Radio · upbeat', 30)).resolves.toBe(42);
    expect(server.next).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 20, band);
    const [name, ids] = server.createMixtape.mock.calls[0];
    expect(name).toBe('Radio · upbeat');
    expect(ids).toHaveLength(30);
    expect(ids.slice(0, 10)).toEqual(band);
    expect(ids.slice(10)).toEqual(Array.from({ length: 20 }, (_, at) => `s${11 + at}`));
  });

  it('saves only the first ones of the band when fewer are asked', async () => {
    await radio.listen('upbeat');
    server.next.mockClear();
    await radio.saveAsMixtape('Short', 10);
    expect(server.next).not.toHaveBeenCalled();
    expect(server.createMixtape).toHaveBeenCalledWith('Short', radio.getState().songs.map(one => one.songId));
  });

  it('looks in everything that plays when nothing fits', async () => {
    server.next.mockResolvedValueOnce({ songs: [], poolSize: 40, fitting: 0, missingFiches: 0 });
    await radio.listen('du jazz pour cuisiner');
    expect(radio.getState()).toMatchObject({ status: 'ready', songs: [], fitting: 0 });
    await radio.widen();
    expect(server.next).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ stars: null, hearts: false, popular: false }), BAND, []);
    expect(radio.getState().songs).toHaveLength(BAND);
  });

  it('↵ plays the band once drawn, the player primed at once, within the key', async () => {
    const prime = vi.spyOn(player, 'prime');
    let heard: (criteria: RadioCriteria) => void = () => undefined;
    server.criteria.mockReturnValueOnce(new Promise(resolve => { heard = resolve; }));
    const listening = radio.listen('quelque chose de upbeat', { play: true });
    expect(prime).toHaveBeenCalledTimes(1);
    expect(player.getState().album).toBeNull();
    heard({ moods: ['upbeat'] });
    await listening;
    expect(player.getState()).toMatchObject({ album: { radio: true, title: 'Radio · quelque chose de upbeat' }, index: 0, playing: true });
    expect(player.getState().tracks.map(track => track.songId)).toEqual(radio.getState().songs.map(one => one.songId));
  });

  it('↵ takes the place of whatever plays: an album, or the radio of another prompt', async () => {
    player.playAlbum({ id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null }, [{ songId: 'n1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }]);
    await radio.listen('upbeat', { play: true });
    expect(player.getState().album?.title).toBe('Radio · upbeat');
    hear(20);
    await radio.listen('rock alternatif', { play: true });
    expect(player.getState().album?.title).toBe('Radio · rock alternatif');
    // A new band, not the old one's song playing kept; the song cut short told skipped.
    expect(player.getState().tracks[0].songId).toBe('s11');
    expect(server.left).toHaveBeenCalledWith('s1', 'skipped');
  });

  it('a prompt heard while the radio plays, not played anew: the player\'s album takes its name', async () => {
    await radio.listen('upbeat', { play: true });
    await radio.listen('calme');
    expect(player.getState().album?.title).toBe('Radio · calme');
    expect(player.getState().tracks[0].songId).toBe('s1');
    expect(player.getState().index).toBe(0);
  });

  it('nothing drawn: ↵ plays nothing, what played goes on', async () => {
    player.playAlbum({ id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null }, [{ songId: 'n1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }]);
    server.next.mockResolvedValueOnce({ songs: [], poolSize: 40, fitting: 0, missingFiches: 0 });
    await radio.listen('du jazz pour cuisiner', { play: true });
    expect(player.getState().album?.title).toBe('Come Away With Me');
  });
});
