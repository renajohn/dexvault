import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerBar from './PlayerBar';
import outputs, { resetOutputs, takeState, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';
import { resetPhoneDoor, setFullPlayer, showAlbum, useFullPlayer } from '../services/phoneDoor';

const shown = { id: 12, title: 'Kind of Blue', artist: 'Miles Davis', cover: null, format: 'CD', releaseYear: 1959, titleStatus: 'owned', fileQuality: 'lossless' };
const rip = {
  configured: true, found: true, album: { id: 'nd-12', name: 'Kind of Blue' },
  tracks: [
    { id: 'k1', discNumber: 1, track: 1, title: 'So What', durationSec: 562 },
    { id: 'k2', discNumber: 1, track: 2, title: 'Freddie Freeloader', durationSec: 586 },
  ],
};
const playing = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const playingTracks = [{ songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };
const SALON_LISTED = {
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null,
};
/** Another album playing, on the living room's appliance: the player follows what it says. */
const session = (): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album: playing, track: null, index: 0, count: 1, tracks: playingTracks,
  status: 'playing', position: 93, duration: 186, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
});

// jsdom has no PointerEvent: a MouseEvent carries the finger's place.
if (!window.PointerEvent) window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;

/** Whether the full screen player is open, as the page reads it. */
const Full = () => <span data-testid="full">{String(useFullPlayer())}</span>;
const page = () => render(<MemoryRouter initialEntries={['/musicdex']}><PlayerBar /><Full /></MemoryRouter>);
const fullScreen = (name: string | RegExp) => screen.getByRole('dialog', { name, hidden: true });

beforeEach(() => {
  // A phone: the pill, and the full screen it opens.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/navidrome-tracks')) return Promise.resolve(new Response(JSON.stringify(rip)));
    if (url.endsWith('/listen-next/albums')) return Promise.resolve(new Response(JSON.stringify([])));
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify([SALON_LISTED])));
    if (url.startsWith('/api/outputs/')) return Promise.resolve(new Response(JSON.stringify(session())));
    return Promise.resolve(new Response('{}'));
  }));
  resetOutputs();
  resetPlayer();
  resetPhoneDoor();
});

/** Another album playing on the Salon. */
const playOther = async () => {
  await outputs.list();
  player.setOutput(SALON);
  act(() => { takeState(session()); });
};

afterEach(async () => {
  await act(async () => { await Promise.resolve(); });
  act(() => { resetOutputs(); resetPlayer(); resetPhoneDoor(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('The phone’s full screen player, on an album a cover opened', () => {
  it('opens on the tracks, the tracks button on: touched, back to the cover', async () => {
    page();
    act(() => { showAlbum(shown); });
    const sheet = fullScreen('Kind of Blue');
    expect(await within(sheet).findByRole('button', { name: /Freddie Freeloader/ })).toBeInTheDocument();
    const tracks = within(sheet).getByRole('button', { name: 'Tracks' });
    expect(tracks).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(tracks);
    expect(tracks).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).queryByRole('button', { name: /Freddie Freeloader/ })).not.toBeInTheDocument();
    // Its tracks read again, the owner's choice holds.
    await act(async () => { await Promise.resolve(); });
    expect(tracks).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows it at rest when nothing plays: its line, ▶ playing it, its tracks playing from one', async () => {
    const playAlbum = vi.spyOn(player, 'playAlbum').mockImplementation(() => undefined);
    page();
    act(() => { showAlbum(shown); });
    const sheet = fullScreen('Kind of Blue');
    expect(screen.getByTestId('full')).toHaveTextContent('true');
    expect(await within(sheet).findByText('CD · 2 tracks · 19 min · 1959')).toBeInTheDocument();
    expect(within(sheet).queryByRole('slider', { name: 'Position in the track' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    // Nothing else plays: no disc at the foot.
    expect(within(sheet).queryByRole('button', { name: /Now playing:/ })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Play' }));
    expect(playAlbum).toHaveBeenLastCalledWith(expect.objectContaining({ id: 12, title: 'Kind of Blue' }), expect.any(Array), 0);

    // Opened by its cover, it shows its tracks, the tracks button on.
    expect(within(sheet).getByRole('button', { name: 'Tracks' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sheet).getByRole('button', { name: /Freddie Freeloader/ }));
    expect(playAlbum).toHaveBeenLastCalledWith(expect.objectContaining({ id: 12 }), expect.any(Array), 1);

    // (i) at the foot: the album's card, the full screen going back under it.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Album details' }));
    expect(screen.getByTestId('full')).toHaveTextContent('false');
  });

  it('another album playing: its disc at the left of the foot goes back to it, and closing lets the album go', async () => {
    await playOther();
    page();
    act(() => { showAlbum(shown); });
    const sheet = fullScreen('Kind of Blue');
    await within(sheet).findByText(/2 tracks/);
    const disc = within(sheet).getByRole('button', { name: 'Now playing: Don’t Know Why, Norah Jones' });
    expect(disc.closest('.now-playing-foot')).not.toBeNull();

    fireEvent.click(disc);
    expect(fullScreen('Now playing')).toHaveTextContent('Don’t Know Why');
    expect(screen.getByTestId('full')).toHaveTextContent('true');

    // Opened again, then closed: the pill is what plays, and opening it again shows what plays.
    act(() => { showAlbum(shown); });
    expect(fullScreen('Kind of Blue')).toBeInTheDocument();
    fireEvent.click(within(fullScreen('Kind of Blue')).getByRole('button', { name: 'Back to the pill' }));
    expect(screen.getByTestId('full')).toHaveTextContent('false');
    // Closed, the full screen is out of reach (inert), and stands for what plays again.
    expect(document.querySelector('.now-playing')).toHaveAttribute('aria-label', 'Now playing');
  });

  it('back on what plays, the album left takes the disc’s place at the left of the foot, to go back to it', async () => {
    await playOther();
    page();
    act(() => { showAlbum(shown); });
    await within(fullScreen('Kind of Blue')).findByText(/2 tracks/);
    fireEvent.click(within(fullScreen('Kind of Blue')).getByRole('button', { name: /Now playing:/ }));

    const back = within(fullScreen('Now playing')).getByRole('button', { name: 'Back to Kind of Blue' });
    expect(back.closest('.now-playing-foot')).not.toBeNull();
    fireEvent.click(back);
    expect(await within(fullScreen('Kind of Blue')).findByText(/2 tracks/)).toBeInTheDocument();

    // And back again; closed, the album left is let go.
    fireEvent.click(within(fullScreen('Kind of Blue')).getByRole('button', { name: /Now playing:/ }));
    fireEvent.click(within(fullScreen('Now playing')).getByRole('button', { name: 'Back to the pill' }));
    act(() => { setFullPlayer(true); });
    expect(within(fullScreen('Now playing')).queryByRole('button', { name: 'Back to Kind of Blue' })).not.toBeInTheDocument();
  });

  it('the tracks of what plays shown, their hearts are read again from Navidrome: one given since the album started shows', async () => {
    await playOther();
    vi.mocked(fetch).mockImplementation(((url: string) => {
      if (url.endsWith('/albums/7/navidrome-tracks')) {
        return Promise.resolve(new Response(JSON.stringify({ ...rip, tracks: [{ id: 's1', discNumber: 1, track: 1, title: 'Don’t Know Why', durationSec: 186, starred: true }] })));
      }
      if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify([SALON_LISTED])));
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch);
    page();
    act(() => { setFullPlayer(true); });
    const sheet = fullScreen('Now playing');
    expect(within(sheet).queryByLabelText('Favourite')).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tracks' }));
    expect(await within(sheet).findByLabelText('Favourite')).toBeInTheDocument();
  });

  it('the album playing, its cover opens the full screen on it, playing', async () => {
    await playOther();
    page();
    act(() => { showAlbum({ ...playing, id: 7 }); });
    expect(fullScreen('Now playing')).toHaveTextContent('Don’t Know Why');
    expect(screen.getByTestId('full')).toHaveTextContent('true');
    expect(within(fullScreen('Now playing')).getByRole('button', { name: 'Tracks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a CD with nothing ripped: no player, its card instead', async () => {
    vi.mocked(fetch).mockImplementation(((url: string) => Promise.resolve(new Response(JSON.stringify(
      url.endsWith('/navidrome-tracks') ? { configured: true, found: false, tracks: [] } : url.endsWith('/listen-next/albums') || url === '/api/outputs' ? [] : {},
    )))) as typeof fetch);
    page();
    act(() => { showAlbum(shown); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('full')).toHaveTextContent('false');
  });
});
