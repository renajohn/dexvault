import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { player, resetPlayer } from './player';
import outputs, { resetOutputs, takeState, type Output, type OutputState } from './outputs';
import { listenNextQueue } from './listenNextQueue';
import { playAlbumById } from '../utils/playAlbum';

const album = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const tracks = [
  { songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 },
  { songId: 's2', title: 'Seven Years', disc: 1, no: 2, durationSec: 145 },
];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };
const BUREAU = { kind: 'renderer' as const, id: 'uuid:bureau', name: 'Bureau' };

const session = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album, track: null, index: 1, count: 2, tracks,
  status: 'playing', position: 40, duration: 145, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});
const listed = (id: string, name: string, changes: Partial<Output> = {}): Output => ({
  id, name, deviceName: name, model: '', manufacturer: '', reachable: true, gapless: true, volume: 30, muted: false, maxVolume: 70, session: null, ...changes,
});

let fetched: Array<{ url: string; body: Record<string, unknown> | null }> = [];
let list: Output[] = [];

beforeEach(async () => {
  fetched = [];
  list = [listed('uuid:salon', 'Salon'), listed('uuid:bureau', 'Bureau')];
  const RealAudio = window.Audio;
  vi.stubGlobal('Audio', function Audio() { return new RealAudio(); });
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
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify(list)));
    if (url.startsWith('/api/outputs/')) return Promise.resolve(new Response(JSON.stringify(session({ id: decodeURIComponent(url.split('/')[3]) }))));
    return Promise.resolve(new Response('{}'));
  }));
  resetOutputs();
  resetPlayer();
  await outputs.list();
});

afterEach(() => {
  resetOutputs();
  resetPlayer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const commands = () => fetched.filter(call => call.url.startsWith('/api/outputs/'));

describe('the player on an output', () => {
  it('carries a play from this browser to Salon at the same place, and falls silent here', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.setOutput(SALON);

    expect(commands()).toHaveLength(1);
    expect(commands()[0].url).toBe('/api/outputs/uuid%3Asalon/play');
    expect(commands()[0].body).toMatchObject({ album: { id: 7 }, tracks, index: 1, listenNext: false });
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(player.getState().output).toEqual(SALON);
  });

  it('shows what plays on the appliance, and sends it the bar’s commands', () => {
    player.setOutput(SALON);
    takeState(session());
    expect(player.getState()).toMatchObject({ album, index: 1, playing: true, barShown: true, outputStatus: null });

    player.toggle();
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: false } });
    player.next();
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/next');
    player.seek(90);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/seek', body: { position: 90 } });
    player.playTrack(0);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/track', body: { index: 0 } });
  });

  it('says an appliance taken by something else, and ▶ takes it back', () => {
    player.setOutput(SALON);
    takeState(session({ status: 'taken' }));
    expect(player.getState()).toMatchObject({ outputStatus: 'taken', playing: false, barShown: true });
    player.toggle();
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/resume');
  });

  it('carries a play from Salon to Bureau by the server, and from Salon back here', () => {
    player.setOutput(SALON);
    takeState(session());
    player.setOutput(BUREAU);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Abureau/play', body: { from: 'uuid:salon' } });

    // Back here: this browser plays the track at its place, then Salon pauses.
    player.setOutput(SALON, { transfer: false });
    takeState(session());
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, album, index: 1, playing: true });
    expect(player.getState().position).toBeGreaterThanOrEqual(40);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: false } });
  });

  it('follows an appliance that plays while nothing plays here, and lets go of it once chosen otherwise', () => {
    takeState(session());
    expect(player.getState().output).toEqual(SALON);
    expect(player.getState().barShown).toBe(true);
    takeState(session({ status: 'stopped' }));
    expect(player.getState().output).toEqual({ kind: 'local' });
  });

  it('plays here when the appliance chosen is no longer in the list', async () => {
    player.setOutput(SALON);
    list = [];
    await outputs.list();
    expect(player.getState().output).toEqual({ kind: 'local' });
  });

  it('starts Listen Next on Salon, which plays its turn; false when it has nothing to play', async () => {
    player.setOutput(SALON);
    expect(await listenNextQueue.start()).toBe(true);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/listen-next', body: {} });
    expect(await listenNextQueue.start('12:0')).toBe(true);
    expect(commands().at(-1)!.body).toEqual({ key: '12:0' });

    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: 'Nothing to play there' }), { status: 404 })));
    expect(await listenNextQueue.start()).toBe(false);
  });

  it('plays an album of DexVault on Salon by its id, the server loading it', async () => {
    player.setOutput(SALON);
    expect(await playAlbumById(7, { queue: 'listenNext' }, 2, false, 1)).toBe(true);
    expect(commands().at(-1)).toMatchObject({
      url: '/api/outputs/uuid%3Asalon/play', body: { albumId: 7, disc: 1, index: 2, shuffle: false, listenNext: true },
    });
    // Nothing here: this browser stays silent.
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
