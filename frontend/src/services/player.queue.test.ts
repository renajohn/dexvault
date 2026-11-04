import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { player, resetPlayer, type PlayerAlbum, type PlayerTrack } from './player';
import outputs, { resetOutputs, takeState, type Output, type OutputState } from './outputs';

vi.mock('../components/shared/Toast', async original => ({ ...(await original<object>()), default: vi.fn() }));

const album: PlayerAlbum = { id: 7, title: 'Low', artist: 'David Bowie', cover: '/low.jpg' };
const other: PlayerAlbum = { id: 8, title: 'Heroes', artist: 'David Bowie', cover: '/heroes.jpg' };
const track = (n: number, prefix = 'a'): PlayerTrack => ({ songId: `${prefix}${n}`, title: `Song ${n}`, disc: 1, no: n, durationSec: 200 });
const tracks = [track(1), track(2), track(3), track(4)];
const songs = () => player.getState().tracks.map(one => one.songId);
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };

let fetched: Array<{ url: string; body: Record<string, unknown> | null }> = [];

beforeEach(() => {
  fetched = [];
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    fetched.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    if (url === '/api/outputs') {
      const salon: Output = { id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: '', manufacturer: '', reachable: true, gapless: true, volume: 30, muted: false, maxVolume: 70, session: null };
      return Promise.resolve(new Response(JSON.stringify([salon])));
    }
    return Promise.resolve(new Response(JSON.stringify({ count: 0 })));
  }));
  resetOutputs();
  resetPlayer();
});

afterEach(() => {
  resetOutputs();
  resetPlayer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the tracks to come, put in order by hand, here', () => {
  beforeEach(() => player.playAlbum(album, tracks, 1));

  it('moves a track to come to another place, the one playing where it is', () => {
    expect(player.moveTrack(3, 2)).toBe(true);
    expect(songs()).toEqual(['a1', 'a2', 'a4', 'a3']);
    expect(player.getState().index).toBe(1);
    // The track playing and those heard stay where they are.
    expect(player.moveTrack(0, 3)).toBe(false);
    expect(player.moveTrack(1, 3)).toBe(false);
  });

  it('takes a track to come out', () => {
    expect(player.removeTrack(2)).toBe(true);
    expect(songs()).toEqual(['a1', 'a2', 'a4']);
    expect(player.removeTrack(1)).toBe(false);
  });

  it('puts a track of another album next or last, with its artist, CD and cover', () => {
    expect(player.enqueue([track(1, 'b')], 'next', other)).toBe(true);
    expect(player.enqueue([track(2, 'b')], 'last', other)).toBe(true);
    expect(songs()).toEqual(['a1', 'a2', 'b1', 'a3', 'a4', 'b2']);
    expect(player.getState().tracks[2]).toMatchObject({ queued: true, artist: 'David Bowie', albumId: 8, cover: '/heroes.jpg' });
  });

  it('moves a track of the album already to come rather than playing it twice', () => {
    expect(player.enqueue([track(4)], 'next', album)).toBe(true);
    expect(songs()).toEqual(['a1', 'a2', 'a4', 'a3']);
    expect(player.getState().tracks[2].queued).toBeUndefined();
  });

  it('keeps the order for a reload', () => {
    player.moveTrack(3, 2);
    const saved = JSON.parse(window.localStorage.getItem('dexvault.player.resume')!);
    expect(saved.tracks.map((one: PlayerTrack) => one.songId)).toEqual(['a1', 'a2', 'a4', 'a3']);
  });
});

it('plays the tracks put next when nothing plays', () => {
  expect(player.enqueue([track(1, 'b')], 'next', other)).toBe(true);
  expect(player.getState()).toMatchObject({ album: { title: 'Heroes' }, index: 0, playing: true });
});

describe('on an appliance', () => {
  const session = (): OutputState => ({
    id: 'uuid:salon', name: 'Salon', album, track: null, index: 1, count: tracks.length, tracks,
    status: 'playing', position: 20, duration: 200, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  });

  it('sends the tracks to come to the server, the album and the track playing named, shown at once', async () => {
    await outputs.list();
    player.setOutput(SALON);
    takeState(session());
    expect(player.moveTrack(3, 2)).toBe(true);
    expect(fetched.filter(call => call.url.endsWith('/queue'))).toEqual([{
      url: '/api/outputs/uuid%3Asalon/queue', body: { tracks: [track(4), track(3)], albumKey: 'Low', current: 'a2', seen: 4 },
    }]);
    expect(songs()).toEqual(['a1', 'a2', 'a4', 'a3']);
  });
});
