import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NowPlayingDisc from './NowPlayingDisc';
import PlayerBar from './PlayerBar';
import outputs, { resetOutputs, takeState, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';
import { resetPhoneDoor, useCoversPlayer, useFullPlayer } from '../services/phoneDoor';

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

/** Whether the full screen player is open, as the page reads it. */
const Full = () => <span data-testid="full">{String(useFullPlayer())}</span>;
/** A music window over the whole page, as an album's sheet or a record's card says it. */
const Cover = () => { useCoversPlayer(); return null; };

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
  it('shows what another album plays, its ring half way, and a tap opens the full screen player', () => {
    act(() => { takeState(session()); });
    render(<><NowPlayingDisc exceptAlbumId={12} /><Full /></>);
    const disc = screen.getByRole('button', { name: 'Now playing: Don’t Know Why, Norah Jones' });
    const fill = document.querySelector('.now-playing-disc__fill')!;
    const circle = Number(fill.getAttribute('stroke-dasharray'));
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(circle / 2, 0);
    expect(screen.getByTestId('full')).toHaveTextContent('false');

    fireEvent.click(disc);
    expect(screen.getByTestId('full')).toHaveTextContent('true');
  });

  it('is not there for the window’s own album, nor when nothing plays', () => {
    const { rerender } = render(<NowPlayingDisc exceptAlbumId={12} />);
    expect(screen.queryByRole('button', { name: /Now playing/ })).not.toBeInTheDocument();

    act(() => { takeState(session()); });
    rerender(<NowPlayingDisc exceptAlbumId="7" />);
    expect(screen.queryByRole('button', { name: /Now playing/ })).not.toBeInTheDocument();
  });

  it('opens the full screen player when drawn up, and shows its words when asked', () => {
    act(() => { takeState(session({ status: 'paused' })); });
    render(<><NowPlayingDisc withWords /><Full /></>);
    const disc = screen.getByRole('button', { name: /Now playing/ });
    expect(disc).toHaveClass('now-playing-disc--paused');
    expect(disc).toHaveTextContent('Don’t Know Why');
    expect(disc).toHaveTextContent('Norah Jones');

    fireEvent.pointerDown(disc, { clientY: 400 });
    fireEvent.pointerUp(disc, { clientY: 360 });
    expect(screen.getByTestId('full')).toHaveTextContent('true');
  });
});

describe('PlayerBar on a phone, under a music window', () => {
  it('gives the pill’s room back while a window covers the page, and takes it again once it closes', () => {
    act(() => { takeState(session()); });
    const page = (covered: boolean) => <MemoryRouter initialEntries={['/musicdex']}><PlayerBar />{covered && <Cover />}</MemoryRouter>;
    const { rerender } = render(page(false));
    const bar = document.querySelector('.player-bar')!;
    expect(bar).not.toHaveClass('player-bar--covered');
    expect(document.documentElement.style.getPropertyValue('--player-h')).toBe('var(--player-bar-room)');

    rerender(page(true));
    expect(bar).toHaveClass('player-bar--covered');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(document.documentElement.style.getPropertyValue('--player-h')).toBe('0px');

    rerender(page(false));
    expect(bar).not.toHaveClass('player-bar--covered');
    expect(document.documentElement.style.getPropertyValue('--player-h')).toBe('var(--player-bar-room)');
  });
});
