import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerBar from './PlayerBar';
import { ConfirmHost } from './shared/ConfirmDialog';
import outputs, { resetOutputs, takeState, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';
import { resetShelfLocations } from '../utils/shelfLocations';
import { resetPhoneDoor, setAlbumManagement, setFullPlayer, showAlbum, useFullPlayer } from '../services/phoneDoor';

const shown = { id: 12, title: 'Kind of Blue', artist: 'Miles Davis', cover: null, format: 'CD', releaseYear: 1959, titleStatus: 'owned', fileQuality: 'lossless' };
const rip = {
  configured: true, found: true, album: { id: 'nd-12', name: 'Kind of Blue' },
  tracks: [
    { id: 'k1', discNumber: 1, track: 1, title: 'So What', durationSec: 562, suffix: 'flac' },
    { id: 'k2', discNumber: 1, track: 2, title: 'Freddie Freeloader', durationSec: 586, suffix: 'flac' },
  ],
};
const playing = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const playingTracks = [{ songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }];
const SALON = { kind: 'renderer' as const, id: 'uuid:salon', name: 'Salon' };
const SALON_LISTED = {
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null,
};
const NO_MIXTAPES = { configured: true, mixtapes: [] };
const NO_SHELVES = { movies: {}, albums: {} };
/** Another album playing, on the living room's appliance: the player follows what it says. */
const session = (): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album: playing, track: null, index: 0, count: 1, tracks: playingTracks,
  status: 'playing', position: 93, duration: 186, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
});

// jsdom has no PointerEvent: a MouseEvent carries the finger's place.
if (!window.PointerEvent) window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;

/** A finger drawn across a line and let go: to the right (dx > 0) its deed, to the left what lies there. */
const slide = (line: HTMLElement, dx: number) => {
  const row = line.closest('.swipe-row')!;
  fireEvent.touchStart(row, { touches: [{ clientX: 150, clientY: 40 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 150 + Math.sign(dx) * 10, clientY: 40 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 150 + Math.sign(dx) * 10 + dx, clientY: 40 }] });
  fireEvent.touchEnd(row);
};

/** A finger's tap on an entry of the menu a slide opened: its touch first, which ends the slide, then the click. */
const tap = (element: HTMLElement) => {
  fireEvent.touchStart(element, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(element);
  fireEvent.click(element);
};

/** Whether the full screen player is open, as the page reads it. */
const Full = () => <span data-testid="full">{String(useFullPlayer())}</span>;
const page = () => render(<MemoryRouter initialEntries={['/musicdex']}><PlayerBar /><Full /><ConfirmHost /></MemoryRouter>);
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
    if (url.endsWith('/music/mixtapes')) return Promise.resolve(new Response(JSON.stringify(NO_MIXTAPES)));
    if (url.endsWith('/music/albums/12')) return Promise.resolve(new Response(JSON.stringify(shown)));
    if (url === '/api/shelving/locations') return Promise.resolve(new Response(JSON.stringify(NO_SHELVES)));
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

    // (i) at the foot: the album's info in place of the tracks, the full screen staying; again, the tracks.
    const info = within(sheet).getByRole('button', { name: 'Album info' });
    fireEvent.click(info);
    expect(info).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('full')).toHaveTextContent('true');
    expect(await within(sheet).findByText('Files and CD')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Freddie Freeloader/ })).not.toBeInTheDocument();
    fireEvent.click(info);
    expect(within(sheet).getByRole('button', { name: /Freddie Freeloader/ })).toBeInTheDocument();
  });

  it('its info: the shelf code and the files first, the edition, the genres, rows that unfold, Edit and Delete from the page', async () => {
    const details = { ...shown, cover: null, country: 'US', labels: ['Columbia'], releaseGroupFirstReleaseDate: '1959-08-17', catalogNumber: 'CK 64935', barcode: '074646493526',
      genres: ['Jazz', 'Modal jazz'], producer: ['Irving Townsend'], musicbrainzReleaseId: 'mb-12', communityRating: 4.6, communityVotes: 88, isrcCodes: ['USSM15900001', 'USSM15900002'],
      ownership: { condition: 'NM', purchasedAt: '2021-03-12', priceChf: 18 }, createdAt: '2024-05-14T10:00:00Z', urls: { discogs: 'https://www.discogs.com/release/1' } };
    vi.mocked(fetch).mockImplementation(((url: string) => {
      if (url.endsWith('/navidrome-tracks')) return Promise.resolve(new Response(JSON.stringify(rip)));
      if (url.endsWith('/music/albums/12')) return Promise.resolve(new Response(JSON.stringify(details)));
      if (url.endsWith('/albums/12/overlaps')) return Promise.resolve(new Response(JSON.stringify([{ id: 30, title: 'The Essential', artist: ['Miles Davis'], cover: null, titleStatus: 'owned', format: 'CD', shared: 2, trackCount: 20, tracks: [] }])));
      if (url.endsWith('/albums/12/notes')) return Promise.resolve(new Response(JSON.stringify([{ id: 1, albumId: 12, note: 'Loud, at night.', date: '2024-03-12', createdAt: '', updatedAt: '' }])));
      if (url.endsWith('/music/mixtapes')) return Promise.resolve(new Response(JSON.stringify(NO_MIXTAPES)));
      if (url === '/api/shelving/locations') return Promise.resolve(new Response(JSON.stringify({ movies: {}, albums: { 12: 'A-3' } })));
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/listen-next/albums') || url === '/api/outputs' || url.endsWith('/scores') ? [] : {})));
    }) as typeof fetch);
    const edit = vi.fn();
    const remove = vi.fn(async () => undefined);
    const search = vi.fn();
    act(() => { setAlbumManagement({ edit, delete: remove, search }); });
    page();
    act(() => { showAlbum(shown, 'info'); });
    const sheet = fullScreen('Kind of Blue');
    // Opened on its info: the (i) on, the tracks away.
    expect(await within(sheet).findByText('Files and CD')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Album info' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).queryByRole('button', { name: /Freddie Freeloader/ })).not.toBeInTheDocument();
    // The files, the edition and its codes, the community.
    expect(await within(sheet).findByText(/Lossless/)).toBeInTheDocument();
    expect(within(sheet).getByText('1959 · US · Columbia')).toBeInTheDocument();
    expect(within(sheet).getByText('CK 64935')).toBeInTheDocument();
    expect(within(sheet).getByText(/88 votes/)).toBeInTheDocument();
    // A genre touched filters the grid, the full screen going back to the pill.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Modal jazz' }));
    expect(search).toHaveBeenCalledWith('genre:"Modal jazz"');
    expect(screen.getByTestId('full')).toHaveTextContent('false');
    // Closed, the player is gone with the album; opened again, it is a new one.
    act(() => { showAlbum(shown, 'info'); });
    const again = fullScreen('Kind of Blue');
    // The rows: Also on unfolds in place, with the other album; the notes with their count.
    fireEvent.click(await within(again).findByRole('button', { name: /Also on/ }));
    expect(await within(again).findByText('The Essential')).toBeInTheDocument();
    expect(within(again).getByText(/· 2 of this album's/)).toBeInTheDocument();
    await waitFor(() => expect(within(again).getByRole('button', { name: /Listening notes/ })).toHaveTextContent('1'));
    // Edit from the page under the player, which goes back to the pill; Delete asks first.
    fireEvent.click(within(again).getByRole('button', { name: 'Edit…' }));
    expect(edit).toHaveBeenCalledWith(12);
    expect(screen.getByTestId('full')).toHaveTextContent('false');
    act(() => { showAlbum(shown, 'info'); });
    fireEvent.click(await within(fullScreen('Kind of Blue')).findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete', hidden: true }).length).toBe(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete', hidden: true })[1]);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(12));
    expect(screen.getByTestId('full')).toHaveTextContent('false');
  });

  it('its info: the shelf code goes to the shelves, the full screen giving way; a finger drawn down the info at its top closes it', async () => {
    vi.mocked(fetch).mockImplementation(((url: string) => {
      if (url.endsWith('/navidrome-tracks')) return Promise.resolve(new Response(JSON.stringify(rip)));
      if (url.endsWith('/music/albums/12')) return Promise.resolve(new Response(JSON.stringify(shown)));
      if (url === '/api/shelving/locations') return Promise.resolve(new Response(JSON.stringify({ movies: {}, albums: { 12: 'A-3' } })));
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/listen-next/albums') || url === '/api/outputs' || url.endsWith('/scores') || url.endsWith('/notes') || url.endsWith('/overlaps') ? [] : {})));
    }) as typeof fetch);
    resetShelfLocations();
    page();
    act(() => { showAlbum(shown, 'info'); });
    fireEvent.click(await within(fullScreen('Kind of Blue')).findByRole('link', { name: 'On the shelves: A-3' }));
    expect(screen.getByTestId('full')).toHaveTextContent('false');

    act(() => { showAlbum(shown, 'info'); });
    const info = (await within(fullScreen('Kind of Blue')).findByText('Files and CD')).closest('.now-playing-scroll')!;
    fireEvent.touchStart(info, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchMove(info, { touches: [{ clientX: 100, clientY: 210 }] });
    fireEvent.touchMove(info, { touches: [{ clientX: 100, clientY: 400 }] });
    fireEvent.touchEnd(info, { changedTouches: [{ clientX: 100, clientY: 400 }] });
    expect(screen.getByTestId('full')).toHaveTextContent('false');
  });

  it('its info, an album with no CD that plays suggest: Not interested sets it aside in place, says so, and can be undone', async () => {
    const digital = { ...shown, titleStatus: 'digital' };
    vi.mocked(fetch).mockImplementation(((url: string) => {
      if (url.endsWith('/navidrome-tracks')) return Promise.resolve(new Response(JSON.stringify(rip)));
      if (url.endsWith('/music/albums/12')) return Promise.resolve(new Response(JSON.stringify(digital)));
      if (url === '/api/shelving/locations') return Promise.resolve(new Response(JSON.stringify(NO_SHELVES)));
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/listen-next/albums') || url === '/api/outputs' || url.endsWith('/scores') || url.endsWith('/notes') || url.endsWith('/overlaps') ? [] : {})));
    }) as typeof fetch);
    let interest: 'suggested' | 'dismissed' = 'suggested';
    const dismiss = vi.fn(async (_id: number, dismissed: boolean) => { interest = dismissed ? 'dismissed' : 'suggested'; });
    act(() => { setAlbumManagement({ dismiss, interest: () => interest }); });
    page();
    act(() => { showAlbum(digital, 'info'); });
    const sheet = fullScreen('Kind of Blue');
    expect(await within(sheet).findByText('Your plays suggest buying the CD')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Not interested' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(12, true));
    // In place: the full screen stays, the page says it again, the button turns back.
    expect(screen.getByTestId('full')).toHaveTextContent('true');
    act(() => { setAlbumManagement({ dismiss, interest: () => interest }); });
    expect(await within(sheet).findByRole('button', { name: 'Interested after all' })).toBeInTheDocument();
    expect(within(sheet).getByText(/no longer put it in Buy/)).toBeInTheDocument();
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

  it('an album of two discs: each under its head, which slid to the left puts that disc alone in Listen Next, touched opens its menu to choose the list', async () => {
    const boxed = { ...shown, id: 13, title: 'Bitches Brew', discs: [
      { number: 1, tracks: [{ no: 1, title: 'Pharaoh’s Dance', durationSec: 1205 }] },
      { number: 2, tracks: [{ no: 1, title: 'Spanish Key', durationSec: 1052 }, { no: 2, title: 'Sanctuary', durationSec: 656 }] },
    ] };
    const boxRip = { ...rip, tracks: [
      { id: 'b1', discNumber: 1, track: 1, title: 'Pharaoh’s Dance', durationSec: 1205, suffix: 'flac' },
      { id: 'b2', discNumber: 2, track: 1, title: 'Spanish Key', durationSec: 1052, suffix: 'flac' },
      { id: 'b3', discNumber: 2, track: 2, title: 'Sanctuary', durationSec: 656, suffix: 'flac' },
    ] };
    // The whole album in Listen Next.
    let listenNext: Array<{ id: number; disc?: number | null }> = [{ id: 13, disc: null }];
    vi.mocked(fetch).mockImplementation(((url: string, init?: RequestInit) => {
      if (url.endsWith('/navidrome-tracks')) return Promise.resolve(new Response(JSON.stringify(boxRip)));
      if (url.endsWith('/listen-next/albums')) return Promise.resolve(new Response(JSON.stringify(listenNext)));
      if (url.endsWith('/albums/13/listen-next')) {
        const asked = init?.body ? JSON.parse(init.body as string) : {};
        listenNext = asked.disc ? [{ id: 13, disc: asked.disc }] : [];
        return Promise.resolve(new Response('{}'));
      }
      return Promise.resolve(new Response(JSON.stringify(url === '/api/outputs' ? [] : url.endsWith('/music/mixtapes') ? NO_MIXTAPES : {})));
    }) as typeof fetch);
    page();
    act(() => { showAlbum(boxed); });
    const sheet = fullScreen('Bitches Brew');
    expect(await within(sheet).findByText('Disc 2')).toBeInTheDocument();
    expect(within(sheet).getByText('2 tracks · 28 min', { exact: false })).toBeInTheDocument();
    // Numbered from 1 again under each head.
    expect(within(sheet).getByRole('button', { name: /Spanish Key/ })).toHaveTextContent(/^1Spanish Key/);
    // The whole album there: both heads say so; disc 2's slid to the left, that disc alone goes.
    const head2 = await within(sheet).findByRole('button', { name: /^Disc 2 · 2 tracks · 28 min, in Listen Next$/ });
    expect(within(sheet).getByRole('button', { name: /^Disc 1 .*, in Listen Next$/ })).toBeInTheDocument();
    slide(head2, -120);
    expect(await within(sheet).findByRole('button', { name: /^Disc 1 · 1 track · 20 min$/ })).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/music/albums/13/listen-next', expect.objectContaining({ body: JSON.stringify({ disc: 2 }) }));

    // Touched: its menu, taking it out.
    tap(within(sheet).getByRole('button', { name: /^Disc 2 .*, in Listen Next$/ }));
    expect(await screen.findByText('Disc 2 in Listen Next')).toBeInTheDocument();
    tap(screen.getByRole('menuitem', { name: /Take out of Listen Next/ }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/music/albums/13/listen-next')).toHaveLength(2));
  });

  it('the album playing: its ⋯ puts it in Listen Next too, not only at rest', async () => {
    await playOther();
    vi.mocked(fetch).mockImplementation(((url: string) => Promise.resolve(new Response(JSON.stringify(
      url.endsWith('/albums/7') ? { id: 7, titleStatus: 'owned', fileQuality: 'lossless' } : url.endsWith('/music/mixtapes') ? NO_MIXTAPES : url.endsWith('/listen-next/albums') || url === '/api/outputs' ? [] : {},
    )))) as typeof fetch);
    page();
    act(() => { setFullPlayer(true); });
    const sheet = fullScreen('Now playing');
    fireEvent.click(within(sheet).getByRole('button', { name: 'More' }));
    expect(await screen.findByText('Listen Next')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Listen to it next/ }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/music/albums/7/listen-next', { method: 'PUT' }));
  });

  it('a CD with nothing ripped: the player all the same, ▶ grey, the line saying so, the CD’s own tracks that play nothing', async () => {
    const playAlbum = vi.spyOn(player, 'playAlbum').mockImplementation(() => undefined);
    vi.mocked(fetch).mockImplementation(((url: string) => Promise.resolve(new Response(JSON.stringify(
      url.endsWith('/navidrome-tracks') ? { configured: true, found: false, tracks: [] } : url.endsWith('/music/mixtapes') ? NO_MIXTAPES : url.endsWith('/listen-next/albums') || url === '/api/outputs' ? [] : {},
    )))) as typeof fetch);
    page();
    act(() => { showAlbum({ ...shown, fileQuality: 'none', discs: [{ number: 1, tracks: [{ no: 1, title: 'So What', durationSec: 562 }] }] }); });
    const sheet = fullScreen('Kind of Blue');
    expect(await within(sheet).findByText('On CD only')).toBeInTheDocument();
    expect(within(sheet).getByText(/On CD only/).closest('.now-playing-rest')).toHaveTextContent('On CD only · 1 track · 9 min · 1959');
    expect(screen.getByTestId('full')).toHaveTextContent('true');
    expect(within(sheet).getByRole('button', { name: 'Play' })).toBeDisabled();
    const line = within(sheet).getByRole('button', { name: /So What/ });
    expect(line).toBeDisabled();
    fireEvent.click(line);
    expect(playAlbum).not.toHaveBeenCalled();
  });
});
