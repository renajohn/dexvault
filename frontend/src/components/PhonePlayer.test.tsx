import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PhonePlayer from './PhonePlayer';
import musicService from '../services/musicService';
import { setFavourite } from '../services/favourites';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../services/musicService', () => ({
  default: { getMixtapes: vi.fn(async () => ({ configured: true, mixtapes: [] })), getLyrics: vi.fn(), getAlbumGuide: vi.fn(async () => null), fixLyricsTiming: vi.fn(), resetLyricsTiming: vi.fn(), getLyricsVersions: vi.fn(async () => ({ durationSec: 229, versions: [] })),
    syncAlbumRating: vi.fn(async () => ({ userRating: 4 })), setAlbumRating: vi.fn(async (_id: number, rating: number) => ({ userRating: rating, navidrome: 'synced' })) },
}));
vi.mock('../services/player', () => ({
  usePlayer: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  player: { currentTime: () => 8, seek: vi.fn(), toggle: vi.fn(), setRate: vi.fn(), getState: () => mocks.state },
  localOutputName: () => 'iPhone',
  streamUrl: (id: string) => `/api/music/navidrome/stream/${id}`,
}));
vi.mock('../services/favourites', async original => ({
  ...(await original<typeof import('../services/favourites')>()),
  setFavourite: vi.fn(async () => undefined),
}));
vi.mock('../utils/audioPeaks', () => ({ peaksOf: vi.fn(async () => ({ bin: 0.02, levels: new Float32Array(15000) })) }));

// jsdom draws nothing and scrolls nothing: a canvas without a context, lists that do not move.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.scrollTo = (() => undefined) as unknown as Element['scrollTo'];

const SYNCED = "[00:05.15] There's a fire starting in my heart\n[00:09.74] Reaching a fever pitch\n[00:14.24] Finally I can see you crystal clear";

const phone = (changes: Record<string, unknown> = {}) => (
  <PhonePlayer title="Rolling in the Deep" subtitle="Adele · 21" cover={{ src: null, title: '21' }} playing position={8} length={229}
    hasNext controls={{ toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn() }} from="21" out={false}
    lyricsOf={{ albumId: 25, disc: 1, no: 1 }} timingSongId="s1" {...changes} />
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { playing: true, output: { kind: 'local' } };
  vi.mocked(musicService.getLyrics).mockResolvedValue({
    status: 'found', plain: null, synced: SYNCED, lrclibSynced: SYNCED, timing: 'lrclib', source: 'lrclib', checkedAt: '',
  });
});

const toWords = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Full screen player' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lyrics' }));
  await screen.findByText('Reaching a fever pitch');
};

describe('PhonePlayer, fixing the words’ timing', () => {
  it('opens the drawer from the words’ menu in place of the controls, and gives them back on Cancel', async () => {
    render(phone());
    await toWords();
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics options' }));
    fireEvent.click(await screen.findByText('Fix timing…'));

    const drawer = screen.getByRole('group', { name: 'Fix timing' });
    expect(drawer).toHaveClass('lyrics-timing--touch');
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    // Its help on a tap: there is no pointer to hover with.
    fireEvent.click(within(drawer).getByRole('button', { name: 'How it works' }));
    expect(within(drawer).getByText(/A double tap resets it/)).toBeInTheDocument();

    fireEvent.change(within(drawer).getByRole('slider', { name: 'Shift the words' }), { target: { value: '-2.4' } });
    expect(within(drawer).getByText('−2.40 s')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Fix timing' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
  });

  it('lets go of the fixing, unsaved, when the words are left for the cover', async () => {
    render(phone());
    await toWords();
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics options' }));
    fireEvent.click(await screen.findByText('Fix timing…'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the cover' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Fix timing' })).not.toBeInTheDocument());
    expect(musicService.fixLyricsTiming).not.toHaveBeenCalled();
  });

  it('offers no fixing for a computer far away, another version still', async () => {
    render(phone({ timingSongId: null }));
    await toWords();
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics options' }));
    expect(await screen.findByText('Find another version…')).toBeInTheDocument();
    expect(screen.queryByText('Fix timing…')).not.toBeInTheDocument();
  });

  it('opens the other versions from the words’ menu', async () => {
    render(phone());
    await toWords();
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics options' }));
    fireEvent.click(await screen.findByText('Find another version…'));
    expect(await screen.findByText('LRCLIB has no other version of this track.')).toBeInTheDocument();
  });
});

describe('PhonePlayer, its tracks’ hearts and dots', () => {
  const tracks = [
    { title: 'Rolling in the Deep', durationSec: 229, songId: 's1', popular: true },
    { title: 'Rumour Has It', durationSec: 223, songId: 's2', starred: true },
  ];
  const toTracks = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Full screen player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tracks' }));
  };

  it('shows the grey dot of a track most listened to and the ♥ of a favourite', () => {
    render(phone({ tracks, index: 0, controls: { toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), playTrack: vi.fn() } }));
    toTracks();

    const [first, second] = screen.getAllByRole('button', { name: /Rolling in the Deep|Rumour Has It/ });
    expect(first).toHaveTextContent('Popular:');
    expect(within(first).queryByLabelText('Favourite')).not.toBeInTheDocument();
    expect(within(second).getByLabelText('Favourite')).toBeInTheDocument();
  });

  it('says over the tracks their count and length, what is left once it plays, and the album’s stars', async () => {
    const { rerender } = render(phone({ tracks, index: 0, starsOf: 25 }));
    toTracks();
    expect(screen.getByText('2 tracks · 8 min')).toBeInTheDocument();
    const stars = await screen.findByRole('group', { name: 'Your stars for 21: 4 stars' });
    expect(musicService.syncAlbumRating).toHaveBeenCalledWith(25);

    rerender(phone({ tracks, index: 0, starsOf: 25, left: '7 min left of 21' }));
    expect(screen.getByText('7 min left of 21')).toBeInTheDocument();
    expect(screen.queryByText('2 tracks · 8 min')).not.toBeInTheDocument();
    expect(stars).toBeInTheDocument();
  });

  it('plays a track touched, the one playing doing nothing', () => {
    const playTrack = vi.fn();
    render(phone({ tracks, index: 0, controls: { toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), playTrack } }));
    toTracks();
    fireEvent.click(screen.getByRole('button', { name: /Rolling in the Deep/ }));
    expect(playTrack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Rumour Has It/ }));
    expect(playTrack).toHaveBeenCalledWith(1);
  });

  /** A finger drawn across a line, from x 100 to `to`. */
  const slide = (line: HTMLElement, to: number) => {
    const row = line.closest('li')!;
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 100 + Math.sign(to - 100) * 20, clientY: 101 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: to, clientY: 102 }] });
    fireEvent.touchEnd(row);
  };

  it('opens a track’s mixtapes let go slid to the right, and gives or takes its ♥ slid to the left, playing nothing', async () => {
    const playTrack = vi.fn();
    render(phone({ tracks, index: 0, controls: { toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), playTrack } }));
    toTracks();
    const rumour = screen.getByRole('button', { name: /Rumour Has It/ });
    expect(rumour.closest('li')).toHaveTextContent('Not favourite');
    slide(rumour, -60);
    expect(setFavourite).toHaveBeenCalledWith('s2', false);

    // Not far enough: back in place, nothing done.
    slide(rumour, 160);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    slide(rumour, 260);
    expect(await screen.findByRole('menuitem', { name: /New mixtape/ })).toBeInTheDocument();
    expect(playTrack).not.toHaveBeenCalled();

    // A touch on its line closes it, and plays nothing.
    fireEvent.touchStart(rumour.closest('li')!, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(rumour.closest('li')!);
    fireEvent.click(rumour);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(playTrack).not.toHaveBeenCalled();
    slide(rumour, 260);
    await screen.findByRole('menu');

    // A touch anywhere else, a finger's: the menu closes.
    fireEvent.pointerDown(screen.getByRole('dialog', { hidden: true }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
