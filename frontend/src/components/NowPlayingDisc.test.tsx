import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NowPlayingDisc from './NowPlayingDisc';
import outputs, { resetOutputs, takeState, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';
import { resetPhoneDoor } from '../services/phoneDoor';

const album = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const tracks = [
  { songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 },
  { songId: 's2', title: 'Seven Years', disc: 1, no: 2, durationSec: 145 },
];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };
const SALON_LISTED = {
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null,
};
const session = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album, track: null, index: 0, count: 2, tracks,
  status: 'playing', position: 93, duration: 186, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});

// jsdom has no PointerEvent: a MouseEvent carries the finger's place.
if (!window.PointerEvent) window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;

beforeEach(async () => {
  // A phone: the pill, and the full screen it opens.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify([SALON_LISTED])));
    if (url.startsWith('/api/outputs/')) return Promise.resolve(new Response(JSON.stringify(session())));
    return Promise.resolve(new Response('{}'));
  }));
  resetOutputs();
  resetPlayer();
  resetPhoneDoor();
  await outputs.list();
  player.setOutput(SALON);
});

afterEach(async () => {
  await act(async () => { await Promise.resolve(); });
  act(() => { resetOutputs(); resetPlayer(); resetPhoneDoor(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NowPlayingDisc', () => {
  it('shows what another album plays, its ring half way, and a tap goes back to it', () => {
    act(() => { takeState(session()); });
    const onOpen = vi.fn();
    render(<NowPlayingDisc exceptAlbumId={12} onOpen={onOpen} />);
    const disc = screen.getByRole('button', { name: 'Now playing: Don’t Know Why, Norah Jones' });
    const fill = document.querySelector('.now-playing-disc__fill')!;
    const circle = Number(fill.getAttribute('stroke-dasharray'));
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(circle / 2, 0);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(disc);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is not there for the window’s own album, nor when nothing plays', () => {
    const { rerender } = render(<NowPlayingDisc exceptAlbumId={12} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Now playing/ })).not.toBeInTheDocument();

    act(() => { takeState(session()); });
    rerender(<NowPlayingDisc exceptAlbumId="7" onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Now playing/ })).not.toBeInTheDocument();
  });

  it('goes back to what plays when drawn up, grey while it is paused', () => {
    act(() => { takeState(session({ status: 'paused' })); });
    const onOpen = vi.fn();
    render(<NowPlayingDisc onOpen={onOpen} />);
    const disc = screen.getByRole('button', { name: /Now playing/ });
    expect(disc).toHaveClass('now-playing-disc--paused');

    fireEvent.pointerDown(disc, { clientY: 400 });
    fireEvent.pointerUp(disc, { clientY: 360 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
