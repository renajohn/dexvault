import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { player, reportOutputError, resetPlayer } from './player';
import toast from '../components/shared/Toast';
import outputs, { knownOutputs, resetOutputs, takeState, type Output, type OutputState } from './outputs';
import { listenNextQueue } from './listenNextQueue';
import { playAlbumById } from '../utils/playAlbum';
import { OutputError } from './outputs';

vi.mock('../components/shared/Toast', async original => ({ ...(await original<object>()), default: vi.fn() }));

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

let audios: HTMLAudioElement[] = [];
let fetched: Array<{ url: string; body: Record<string, unknown> | null }> = [];
let list: Output[] = [];

beforeEach(async () => {
  fetched = [];
  list = [listed('uuid:salon', 'Salon'), listed('uuid:bureau', 'Bureau')];
  const RealAudio = window.Audio;
  audios = [];
  vi.stubGlobal('Audio', function Audio() { const audio = new RealAudio(); audios.push(audio); return audio; });
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
  vi.useRealTimers();
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

  it('keeps an album paused here in the bar when Salon is chosen, ▶ playing it there from where it was', async () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    expect(player.getState().playing).toBe(false);

    player.setOutput(SALON);
    expect(commands()).toEqual([]);
    expect(player.getState()).toMatchObject({ album, index: 1, playing: false, barShown: true, output: SALON });

    // Back here before ▶: the album paused, as it was.
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ album, index: 1, playing: false, output: { kind: 'local' } });

    player.setOutput(SALON);
    player.toggle();
    expect(commands()).toHaveLength(1);
    expect(commands()[0].url).toBe('/api/outputs/uuid%3Asalon/play');
    expect(commands()[0].body).toMatchObject({ album: { id: 7 }, tracks, index: 1, position: 40 });
    // Salon plays it: the bar shows Salon's play, this browser has let go of it.
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ album, playing: true, output: SALON }));
    expect(JSON.parse(window.localStorage.getItem('dexvault.player.resume')!)).toMatchObject({ barOpen: false });
  });

  it('keeps the album in hand when Salon is chosen, not what Salon held paused of its own', () => {
    const other = { id: 9, title: 'Matters of the Heart', artist: 'Tracy Chapman', cover: null };
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    takeState(session({ album: other, status: 'paused' }));

    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ album, index: 1, playing: false, output: SALON });
    player.toggle();
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play', body: { album: { id: 7 }, index: 1 } });
  });

  it('brings the album paused on Bureau along in hand when this browser is chosen, ▶ playing it here', () => {
    player.setOutput(BUREAU);
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused', position: 40 }));
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, album, index: 1, playing: false, position: 40, barShown: true });
    player.toggle();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(commands().filter(call => call.url.includes('bureau'))).toEqual([]);
  });

  it('brings the album paused on Bureau along to Salon, ▶ playing it there', () => {
    player.setOutput(BUREAU);
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused', position: 40 }));
    takeState(session({ status: 'paused', album: { id: 9, title: 'Saucerful', artist: 'Pink Floyd', cover: null } }));
    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ output: SALON, album, index: 1, playing: false });
    player.toggle();
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play', body: { album: { id: 7 }, index: 1, position: 40 } });
  });

  it('no longer greys Salon once it plays after an outage, whatever the last list said', async () => {
    list = [listed('uuid:salon', 'Salon', { reachable: false }), listed('uuid:bureau', 'Bureau')];
    await outputs.list();
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', wanted: true }));
    expect(player.getState()).toMatchObject({ outputStatus: 'unreachable', playing: true });
    // It answers and plays: the state alone says so, before the next list.
    takeState(session({ status: 'playing' }));
    expect(player.getState()).toMatchObject({ outputStatus: null, playing: true });
    expect(knownOutputs().find(one => one.id === 'uuid:salon')!.reachable).toBe(true);
  });

  it('says a play kept for an appliance waking up quietly, not as a failure', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
      error: 'Salon is waking up: it plays as soon as it answers', status: 'unreachable', kept: true,
    }), { status: 503 })));
    const refused = await outputs.toggle('uuid:salon', true).catch(error => error);
    expect(refused).toMatchObject({ status: 'unreachable', kept: true });
  });

  it('says what went wrong on an appliance in the right tone: a play kept quietly, away in orange, taken grey, the rest red', () => {
    reportOutputError(new OutputError('Salon is waking up: it plays as soon as it answers', 503, 'unreachable', true));
    reportOutputError(new OutputError('Salon does not answer: is it on?', 503, 'unreachable'));
    reportOutputError(new OutputError('Salon is playing something else', 409, 'taken'));
    reportOutputError(new OutputError('Play refused (701)', 502, null));
    expect(vi.mocked(toast).mock.calls).toEqual([
      ['Salon is waking up: it plays as soon as it answers', { tone: 'info' }],
      ['Salon does not answer: is it on?', { tone: 'warning' }],
      ['Salon is playing something else', { tone: 'info' }],
      ['Play refused (701)', { tone: 'danger' }],
    ]);
  });

describe('transfers, every source status', () => {
  const other = { id: 9, title: 'Matters of the Heart', artist: 'Tracy Chapman', cover: null };

  it('X4: carries the play here to Salon even while Salon plays something else, which it replaces', () => {
    takeState(session({ album: other, status: 'playing' }));
    player.setOutput({ kind: 'local' });
    player.playAlbum(album, tracks, 1, 40);
    player.setOutput(SALON);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play', body: { album: { id: 7 }, index: 1 } });
  });

  it('X11: carries nothing from Salon stopped by ✕: here plays nothing, sends nothing', () => {
    player.setOutput(SALON);
    takeState(session({ status: 'stopped' }));
    const before = commands().length;
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, album: null, playing: false });
    expect(commands()).toHaveLength(before);
  });

  it('X12: carries nothing from Salon playing someone else’s, and leaves it alone', () => {
    player.setOutput(SALON);
    takeState(session({ status: 'taken' }));
    const before = commands().length;
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, album: null });
    expect(commands()).toHaveLength(before);
  });

  it('X13: carries a play waiting for Salon to wake to Bureau by the server, which makes Salon forget it', () => {
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', wanted: true }));
    player.setOutput(BUREAU);
    // One command: the server pauses the one left, a play kept there forgotten (session.test: 'forgets it once the play goes to another output').
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Abureau/play', body: { from: 'uuid:salon' } });
  });

  it('X14: brings the album of Salon away, paused, along in hand here', () => {
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', position: 40 }));
    player.setOutput({ kind: 'local' });
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, album, index: 1, playing: false, position: 40 });
  });

  it('lets go of the album in hand once Salon plays: its first pause never brings the old album back, ▶ never plays it over', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    takeState(session({ album: other, status: 'playing' }));
    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ album: other, playing: true });
    takeState(session({ album: other, status: 'paused' }));
    expect(player.getState()).toMatchObject({ album: other, playing: false });
    player.toggle();
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: true } });
  });

  it('lets go of it too when ▶ carried it to Salon waking up: the play waiting there is the bar’s', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', wanted: true, position: 40 }));
    expect(player.getState()).toMatchObject({ album, outputStatus: 'unreachable', playing: true });
    takeState(session({ status: 'paused', position: 40 }));
    // Its pause shows Salon's own place, not the album here of before.
    expect(player.getState().position).toBe(40);
    player.toggle();
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/toggle');
  });

  it('keeps the album here, paused, when Salon refuses the play carried to it', async () => {
    player.playAlbum(album, tracks, 1, 40);
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: 'Play refused (701)' }), { status: 502 })));
    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ album, playing: false, output: SALON });
    await vi.waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith('Play refused (701)', { tone: 'danger' }));
    expect(player.getState()).toMatchObject({ album, index: 1, playing: false, barShown: true });
    // ▶ tries again there.
    player.toggle();
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play', body: { album: { id: 7 }, index: 1 } });
  });

  it('says Salon plays someone else’s while an album is in hand for it', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    takeState(session({ status: 'taken' }));
    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ album, outputStatus: 'taken' });
  });

  it('X15: shows what Bureau plays when chosen with an album paused in hand: what sounds in the room', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', album: other, status: 'playing' }));
    player.setOutput(BUREAU);
    expect(player.getState()).toMatchObject({ output: BUREAU, album: other, playing: true });
  });
});

  it('shows what plays on the appliance, and sends it the bar’s commands', async () => {
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
    await vi.waitFor(() => expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/track', body: { index: 0 } }));
  });

  it('sends only the last of tracks clicked quickly on an appliance, each shown at once; ⏭ right after goes after it', async () => {
    player.setOutput(SALON);
    takeState(session());
    const before = commands().length;
    // At the start of the track; the hand moves on as it plays, a loaded machine taking a few milliseconds between two lines.
    player.playTrack(0);
    expect(player.getState()).toMatchObject({ index: 0, playing: true });
    expect(player.getState().position).toBeLessThan(1);
    player.playTrack(1);
    expect(player.getState().index).toBe(1);
    expect(player.getState().position).toBeLessThan(1);
    player.playTrack(0);
    expect(commands()).toHaveLength(before);
    await vi.waitFor(() => expect(commands()).toHaveLength(before + 1));
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/track', body: { index: 0 } });

    player.playTrack(0);
    player.next();
    expect(commands().slice(-2).map(call => call.url)).toEqual(['/api/outputs/uuid%3Asalon/track', '/api/outputs/uuid%3Asalon/next']);
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

  it('does not follow an appliance paused from elsewhere: an album’s Play plays here', () => {
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused' }));
    expect(player.getState()).toMatchObject({ output: { kind: 'local' }, barShown: false });

    player.playAlbum(album, tracks, 0);
    expect(commands()).toHaveLength(0);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('keeps an appliance followed once asked something from here: paused from here, the next album still goes there', async () => {
    takeState(session());
    expect(player.getState().output).toEqual(SALON);
    player.toggle(false);
    takeState(session({ status: 'paused' }));
    expect(player.getState().output).toEqual(SALON);

    player.playAlbum(album, tracks, 0);
    await vi.waitFor(() => expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play' }));
  });

  it('plays CD after CD on Salon: an album over there, the next one played within 30 minutes goes there too', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    player.setOutput(SALON);
    takeState(session());
    vi.advanceTimersByTime(50 * 60 * 1000);
    // An album over: back on its first track, paused (backend session.ts), never stopped, which only ✕ is.
    takeState(session({ status: 'paused', index: 0, position: 0, at: Date.now(), quietFor: 0 }));
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(player.getState().output).toEqual(SALON);

    player.playAlbum(album, tracks, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/play' });
  });

  it('lets Salon go after 30 minutes of silence there: Play plays here again, and says so by itself', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    player.setOutput(SALON);
    takeState(session());
    takeState(session({ status: 'paused', at: Date.now(), quietFor: 0 }));
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(player.getState().output).toEqual({ kind: 'local' });
    expect(window.localStorage.getItem('dv.player.output')).toBeFalsy();

    player.playAlbum(album, tracks, 0);
    expect(commands().filter(call => call.url.endsWith('/play'))).toHaveLength(0);
  });

  it('lets go of Salon chosen yesterday, at a reload: this browser plays', () => {
    window.localStorage.setItem('dv.player.output', JSON.stringify({ ...SALON, at: Date.now() - 24 * 60 * 60 * 1000 }));
    resetPlayer();
    expect(player.getState().output).toEqual({ kind: 'local' });
    expect(player.rendererId()).toBeNull();
  });

  it('keeps Salon chosen while it plays, however long ago it was chosen', () => {
    window.localStorage.setItem('dv.player.output', JSON.stringify({ ...SALON, at: Date.now() - 24 * 60 * 60 * 1000 }));
    takeState(session());
    resetPlayer();
    expect(player.getState().output).toEqual(SALON);
  });

  it('plays here once Salon is stopped by ✕ from another device, or taken by the TV; chosen again, it holds', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    player.setOutput(SALON);
    takeState(session());
    vi.advanceTimersByTime(1000);
    takeState(session({ status: 'stopped', quietFor: 0 }));
    expect(player.getState().output).toEqual({ kind: 'local' });

    vi.advanceTimersByTime(1000);
    player.setOutput(SALON);
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(1000);
    takeState(session({ status: 'stopped', quietFor: 1000 }));
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(1000);
    takeState(session({ status: 'taken', quietFor: 2000 }));
    expect(player.getState().output).toEqual({ kind: 'local' });
    player.playAlbum(album, tracks, 0);
    expect(commands()).toHaveLength(0);
  });

  it('keeps Salon taken by the TV once chosen again: ▶ takes it back', async () => {
    takeState(session({ status: 'taken', quietFor: 0 }));
    player.setOutput(SALON);
    takeState(session({ status: 'taken', quietFor: 1000 }));
    expect(player.getState()).toMatchObject({ output: SALON, outputStatus: 'taken' });
    player.toggle(true);
    await vi.waitFor(() => expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/resume' }));
  });

  it('plays here after ✕ on Salon', () => {
    player.setOutput(SALON);
    takeState(session());
    player.stop();
    takeState(session({ status: 'stopped' }));
    expect(player.getState().output).toEqual({ kind: 'local' });
  });

  it('lets go of an appliance paused once this browser is chosen, until it plays again', () => {
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused' }));
    player.setOutput({ kind: 'local' });
    expect(player.getState().output).toEqual({ kind: 'local' });
    // Told again, the same pause: still this browser.
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused', position: 41 }));
    expect(player.getState().output).toEqual({ kind: 'local' });
    // Played again from elsewhere (the Mac, the WiiM's app): the bar shows it.
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'playing' }));
    expect(player.getState().output).toEqual(BUREAU);
  });

  it('does not follow an appliance paused over an album paused here', () => {
    player.playAlbum(album, tracks, 0);
    // Paused here: the audio element says so.
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    expect(player.getState()).toMatchObject({ playing: false, album });
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused' }));
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

// The 30 minutes after an appliance's last sound: counted from the server's `quietFor`, never from `at`
// (every poll moves it on, a restart too), and a "playing" not told again for a while not taken for a sound.
describe('the output chosen, held 30 minutes after its last sound (review)', () => {
  const MIN = 60 * 1000;
  const LOCAL = { kind: 'local' as const };
  const fake = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

  it('lets Salon go 30 minutes after a pause, though the server, polling it paused, writes a new `at` every 5 s', () => {
    fake();
    player.setOutput(SALON);
    takeState(session());
    takeState(session({ status: 'paused', at: Date.now() }));
    // backend session.poll(): paused on the appliance, polled every POLL_PAUSED_MS, `this.at = this.now()` each time, emitted.
    for (let i = 0; i < 31 * 12; i++) {
      vi.advanceTimersByTime(5000);
      takeState(session({ status: 'paused', at: Date.now(), quietFor: (i + 1) * 5000 }));
    }
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('lets Salon go 30 minutes after a pause, though a restart of the server wrote a new `at` meanwhile', () => {
    fake();
    player.setOutput(SALON);
    takeState(session());
    const pausedAt = Date.now();
    takeState(session({ status: 'paused', at: pausedAt, quietFor: 0 }));
    vi.advanceTimersByTime(20 * MIN);
    // backend Session constructor, back from output_sessions: paused, `this.at = this.now()`, its last sound kept.
    takeState(session({ status: 'paused', at: Date.now(), quietFor: 20 * MIN }));
    vi.advanceTimersByTime(11 * MIN);
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('a Mac waking 3 hours later, Salon’s CD over long ago: Play plays here, not on Salon', () => {
    fake();
    player.setOutput(SALON);
    takeState(session());
    const asleep = Date.now();
    // Asleep: no timer runs, the clock jumps. On waking the bar's ticker fires first, with the state from before.
    vi.setSystemTime(asleep + 3 * 60 * MIN);
    vi.advanceTimersByTime(1000);
    // Then the events again: the CD ended 20 minutes after the Mac fell asleep.
    takeState(session({ status: 'paused', at: asleep + 20 * MIN, quietFor: 160 * MIN }));
    expect(player.getState().output).toEqual(LOCAL);
    player.playAlbum(album, tracks, 0);
    expect(commands().filter(call => call.url.endsWith('/play'))).toHaveLength(0);
  });

  it('a Mac waking 3 hours later, before the events come back: Play does not go to Salon on the word of a stale “playing”', () => {
    fake();
    player.setOutput(SALON);
    takeState(session());
    vi.setSystemTime(Date.now() + 3 * 60 * MIN);
    vi.advanceTimersByTime(1000);
    // The album was 331 s long and was "playing" 3 hours ago: that state cannot be true any more.
    player.playAlbum(album, tracks, 0);
    vi.advanceTimersByTime(1000);
    expect(commands().filter(call => call.url.endsWith('/play'))).toHaveLength(0);
  });

  it('at a reload, keeps Salon whose CD ended 10 minutes ago, chosen an hour ago (the tab closed meanwhile)', async () => {
    window.localStorage.setItem('dv.player.output', JSON.stringify({ ...SALON, at: Date.now() - 60 * MIN }));
    // The page opens: the player before the list of outputs (lapse() runs with no session known).
    resetOutputs();
    resetPlayer();
    list = [listed('uuid:salon', 'Salon', { session: session({ status: 'paused', at: Date.now() - 10 * MIN, quietFor: 10 * MIN }) }), listed('uuid:bureau', 'Bureau')];
    await outputs.list();
    expect(player.getState().output).toEqual(SALON);
  });

  it('at a reload, counts the 30 minutes from the CD’s end, not from the reload (the clock gap read off an old `at`)', async () => {
    fake();
    window.localStorage.setItem('dv.player.output', JSON.stringify({ ...SALON, at: Date.now() - 28 * MIN }));
    resetOutputs();
    resetPlayer();
    // Over 20 minutes ago: the only `at` the page has seen, taken by clockGap() for the servers' lag.
    list = [listed('uuid:salon', 'Salon', { session: session({ status: 'paused', at: Date.now() - 20 * MIN, quietFor: 20 * MIN }) }), listed('uuid:bureau', 'Bureau')];
    await outputs.list();
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(11 * MIN);
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('✕ in the bar with an album carried to Salon, not yet played there: the next album plays here', () => {
    player.playAlbum(album, tracks, 1, 40);
    player.toggle(false);
    audios.forEach(audio => audio.dispatchEvent(new Event('pause')));
    player.setOutput(SALON);
    expect(player.getState()).toMatchObject({ output: SALON, album });
    player.stop();
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('makes an appliance followed the one chosen at ⏸ from here, written down, held 30 minutes, then let go', async () => {
    fake();
    takeState(session({ id: 'uuid:bureau', name: 'Bureau' }));
    expect(player.getState().output).toEqual(BUREAU);
    expect(window.localStorage.getItem('dv.player.output')).toBeFalsy();
    player.toggle(false);
    expect(JSON.parse(window.localStorage.getItem('dv.player.output')!)).toMatchObject({ id: 'uuid:bureau' });
    await vi.advanceTimersByTimeAsync(10);
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused', at: Date.now() }));
    vi.advanceTimersByTime(29 * MIN);
    expect(player.getState().output).toEqual(BUREAU);
    vi.advanceTimersByTime(2 * MIN);
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('holds Salon 30 minutes after the last command sent from here, not after it was chosen', () => {
    fake();
    player.setOutput(SALON);
    takeState(session({ status: 'paused', at: Date.now() }));
    vi.advanceTimersByTime(20 * MIN);
    player.seek(10);
    vi.advanceTimersByTime(20 * MIN);
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(11 * MIN);
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('two appliances: Salon held here, Bureau paused from another device is not followed, Bureau playing is shown only once Salon lets go', () => {
    fake();
    player.setOutput(SALON);
    takeState(session({ status: 'paused', at: Date.now() }));
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'paused', at: Date.now() }));
    expect(player.getState().output).toEqual(SALON);
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'playing', at: Date.now() }));
    // The choice made here wins while it holds.
    expect(player.getState().output).toEqual(SALON);
    vi.advanceTimersByTime(31 * MIN);
    takeState(session({ id: 'uuid:bureau', name: 'Bureau', status: 'playing', at: Date.now() }));
    expect(player.getState().output).toEqual(BUREAU);
  });

  it('lets go of Salon away (unreachable, no play kept) 30 minutes after the last thing asked of it', () => {
    fake();
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', at: Date.now() }));
    vi.advanceTimersByTime(31 * MIN);
    expect(player.getState().output).toEqual(LOCAL);
  });

  it('keeps Salon while a play waits for it to answer (wanted), told again or not', () => {
    fake();
    player.setOutput(SALON);
    takeState(session({ status: 'unreachable', wanted: true, at: Date.now() }));
    vi.advanceTimersByTime(25 * MIN);
    expect(player.getState().output).toEqual(SALON);
    takeState(session({ status: 'unreachable', wanted: true, at: Date.now() - 25 * MIN }));
    vi.advanceTimersByTime(25 * MIN);
    expect(player.getState().output).toEqual(SALON);
  });

  it('starts Listen Next here once Salon has let go', async () => {
    fake();
    player.setOutput(SALON);
    takeState(session({ status: 'stopped', at: Date.now() }));
    vi.advanceTimersByTime(31 * MIN);
    expect(player.rendererId()).toBeNull();
    await listenNextQueue.start().catch(() => undefined);
    expect(commands().filter(call => call.url.endsWith('/listen-next'))).toHaveLength(0);
  });
});
