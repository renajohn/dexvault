import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerBar from './PlayerBar';
import { HOLD_MS, TOLD_MS } from './PlayerFold';
import outputs, { resetOutputs, takeState, type Output, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';
import { resetPhoneDoor } from '../services/phoneDoor';

const album = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const tracks = [
  { songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 },
  { songId: 's2', title: 'Seven Years', disc: 1, no: 2, durationSec: 145 },
];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };

const session = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album, track: null, index: 1, count: 2, tracks,
  status: 'playing', position: 40, duration: 145, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});
const listed = (changes: Partial<Output> = {}): Output => ({
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null, ...changes,
});

let fetched: Array<{ url: string; body: unknown }> = [];
let house: Output[] = [];

beforeEach(async () => {
  fetched = [];
  house = [listed()];
  // A computer, with a pointer.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('hover'), addEventListener() {}, removeEventListener() {} }));
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    fetched.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify(house)));
    if (url.startsWith('/api/outputs/')) return Promise.resolve(new Response(JSON.stringify(session())));
    return Promise.resolve(new Response('{}'));
  }));
  resetOutputs();
  resetPlayer();
  await outputs.list();
  player.setOutput(SALON);
});

afterEach(async () => {
  // What the commands answered, taken before the page goes.
  await act(async () => { await Promise.resolve(); });
  act(() => { resetOutputs(); resetPlayer(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderBar = () => render(<MemoryRouter initialEntries={['/musicdex']}><PlayerBar /></MemoryRouter>);
const commands = () => fetched.filter(call => call.url.startsWith('/api/outputs/'));

describe('PlayerBar on an appliance', () => {
  it('shows what plays on Salon, and ⏯ pauses it there', () => {
    act(() => { takeState(session({ index: 0, duration: 186 })); });
    renderBar();
    expect(screen.getByRole('region', { name: 'Playing on Salon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Don’t Know Why' })).toBeInTheDocument();
    expect(document.querySelector('.player-bar-where')).toHaveTextContent('Salon');
    expect(screen.getByRole('button', { name: 'Output: Salon' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: false } });
    // Shown paused at once, before the server says so.
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/next');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/stop');
  });

  it('says Salon plays something else, and Resume takes it back', () => {
    act(() => { takeState(session({ status: 'taken' })); });
    renderBar();
    expect(screen.getByText('Salon is playing something else')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(commands().at(-1)!.url).toBe('/api/outputs/uuid%3Asalon/resume');
  });

  it('says Salon is away, greyed', async () => {
    house = [listed({ reachable: false, session: session({ status: 'paused' }) })];
    await act(async () => { await outputs.list(); });
    renderBar();
    expect(screen.getByText('Salon, away')).toBeInTheDocument();
    expect(document.querySelector('.player-bar')).toHaveClass('player-bar--away');
    expect(document.querySelector('.player-bar-where')).toBeNull();
  });

  it('shows a play waiting for Salon to wake as playing, greyed, ⏸ forgetting it; no longer greyed once it plays', async () => {
    house = [listed({ reachable: false, session: session({ status: 'unreachable', wanted: true }) })];
    await act(async () => { await outputs.list(); });
    renderBar();
    expect(document.querySelector('.player-bar')).toHaveClass('player-bar--away');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: false } });

    // It answers and plays: the state alone ungreys it, the last list still saying away.
    act(() => { takeState(session({ status: 'playing' })); });
    expect(document.querySelector('.player-bar')).not.toHaveClass('player-bar--away');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('plays Salon on from its pause with ⏯', () => {
    act(() => { takeState(session({ status: 'paused' })); });
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: true } });
  });

  it('U13: on an iPhone, the full screen of Salon is greyed while it wakes, and no longer once it plays', async () => {
    // A phone's width, a finger.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('767'), addEventListener() {}, removeEventListener() {} }));
    house = [listed({ reachable: false, session: session({ status: 'unreachable', wanted: true }) })];
    await act(async () => { await outputs.list(); });
    renderBar();
    expect(document.querySelector('.now-playing')).toHaveClass('now-playing--away');
    act(() => { takeState(session({ status: 'playing' })); });
    expect(document.querySelector('.now-playing')).not.toHaveClass('now-playing--away');
  });

  it('on an iPhone, shows what plays as its round cover in place of the pill, and opens the full screen from it', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('767'), addEventListener() {}, removeEventListener() {} }));
    act(() => { takeState(session()); });
    renderBar();
    const fold = document.body.querySelector(':scope > .player-fold');
    expect(fold).not.toBeNull();
    expect(document.querySelector('.now-playing')).not.toHaveClass('now-playing--open');
    fireEvent.click(fold!.querySelector('button')!);
    expect(document.querySelector('.now-playing')).toHaveClass('now-playing--open');
    act(() => { resetPhoneDoor(); });
  });

  it('on an iPhone, unrolls the track\'s words beside the round as the track changes, and rolls them back after a while', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('767'), addEventListener() {}, removeEventListener() {} }));
      act(() => { takeState(session({ index: 0 })); });
      renderBar();
      const fold = document.body.querySelector(':scope > .player-fold')!;
      expect(fold).toHaveClass('player-fold--told');
      expect(fold.querySelector('.player-fold__track')).toHaveTextContent('Don’t Know Why');
      act(() => { vi.advanceTimersByTime(TOLD_MS); });
      expect(fold).not.toHaveClass('player-fold--told');
      act(() => { takeState(session({ index: 1 })); });
      expect(fold).toHaveClass('player-fold--told');
      expect(fold.querySelector('.player-fold__track')).toHaveTextContent('Seven Years');
    } finally {
      vi.useRealTimers();
    }
  });

  it('on an iPhone, tells no new track while the full screen player is open', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('767'), addEventListener() {}, removeEventListener() {} }));
    act(() => { takeState(session({ index: 0 })); });
    renderBar();
    const fold = document.body.querySelector(':scope > .player-fold')!;
    fireEvent.click(fold.querySelector('button')!);
    expect(fold).not.toHaveClass('player-fold--told');
    act(() => { takeState(session({ index: 1 })); });
    expect(fold).not.toHaveClass('player-fold--told');
    act(() => { resetPhoneDoor(); });
  });

  it('on an iPhone, a finger held on the round pauses, and the touch that ends the hold opens nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('767'), addEventListener() {}, removeEventListener() {} }));
      act(() => { takeState(session()); });
      renderBar();
      const drop = document.body.querySelector('.player-fold__drop')!;
      fireEvent.pointerDown(drop, { clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(HOLD_MS); });
      expect(commands().at(-1)).toMatchObject({ url: '/api/outputs/uuid%3Asalon/toggle', body: { playing: false } });
      fireEvent.pointerUp(drop);
      fireEvent.click(drop.querySelector('button')!);
      expect(document.querySelector('.now-playing')).not.toHaveClass('now-playing--open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no round cover to fold into on a computer', () => {
    act(() => { takeState(session()); });
    renderBar();
    expect(document.querySelector('.player-fold')).toBeNull();
  });

  it('is not there while Salon plays nothing', () => {
    act(() => { takeState(session({ status: 'stopped' })); });
    renderBar();
    expect(document.querySelector('.player-bar')).not.toHaveClass('player-bar-out');
  });
});
