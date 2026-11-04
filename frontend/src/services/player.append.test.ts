import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { player, resetPlayer, type PlayerTrack } from './player';
import toast from '../components/shared/Toast';
import outputs, { resetOutputs, takeState, type Output, type OutputState } from './outputs';

vi.mock('../components/shared/Toast', async original => ({ ...(await original<object>()), default: vi.fn() }));

const radio = { id: null, radio: true, title: 'Radio · upbeat', artist: 'Radio', cover: null };
const track = (n: number): PlayerTrack => ({ songId: `s${n}`, title: `Song ${n}`, disc: 1, no: n, durationSec: 200, artist: `Artist ${n}`, albumId: 100 + n, cover: null });
const tracks = [track(1), track(2), track(3)];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };

const session = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album: radio, track: null, index: 0, count: tracks.length, tracks,
  status: 'playing', position: 20, duration: 200, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});
const listed = (id: string, name: string): Output => ({
  id, name, deviceName: name, model: '', manufacturer: '', reachable: true, gapless: true, volume: 30, muted: false, maxVolume: 70, session: null,
});

let fetched: Array<{ url: string; body: Record<string, unknown> | null }> = [];
/** What the server answers an append: its status. */
let appendStatus = 200;

beforeEach(async () => {
  fetched = [];
  appendStatus = 200;
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    fetched.push({ url, body });
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify([listed('uuid:salon', 'Salon')])));
    if (url.endsWith('/append')) {
      return Promise.resolve(new Response(JSON.stringify(appendStatus === 200 ? { appended: (body?.tracks as unknown[]).length } : { error: 'No' }), { status: appendStatus }));
    }
    return Promise.resolve(new Response(JSON.stringify(session())));
  }));
  resetOutputs();
  resetPlayer();
  await outputs.list();
  player.setOutput(SALON);
  takeState(session());
});

afterEach(() => {
  resetOutputs();
  resetPlayer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const appends = () => fetched.filter(call => call.url.endsWith('/append'));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('the radio refilled on an appliance', () => {
  it('appends the songs to what Salon plays, named by its album, shown at once', async () => {
    expect(player.getState()).toMatchObject({ output: SALON, album: { title: 'Radio · upbeat' }, index: 0 });
    expect(player.appendTracks([track(4), track(5)])).toBe(true);
    expect(appends()).toEqual([{ url: '/api/outputs/uuid%3Asalon/append', body: { tracks: [track(4), track(5)], albumKey: 'Radio · upbeat' } }]);
    expect(player.getState().tracks.map(one => one.songId)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it('sends only what comes after the songs it holds; a band drawn anew cannot be sent there', () => {
    expect(player.setUpcoming([track(2), track(3), track(6)])).toBe(true);
    expect(appends().map(call => call.body)).toEqual([{ tracks: [track(6)], albumKey: 'Radio · upbeat' }]);
    expect(player.setUpcoming([track(7), track(8)])).toBe(false);
    expect(appends()).toHaveLength(1);
  });

  it('says nothing when another album plays there by now, and takes the songs shown back', async () => {
    appendStatus = 409;
    player.appendTracks([track(4)]);
    await flush();
    await flush();
    expect(player.getState().tracks).toHaveLength(3);
    expect(toast).not.toHaveBeenCalled();
  });

  it('says so when the server fails otherwise', async () => {
    appendStatus = 500;
    player.appendTracks([track(4)]);
    await flush();
    await flush();
    expect(toast).toHaveBeenCalled();
  });
});
