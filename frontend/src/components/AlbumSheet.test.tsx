import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumSheet from './AlbumSheet';
import musicService from '../services/musicService';
import { player } from '../services/player';
import { resetPhoneDoor, useCovered, useFullPlayer } from '../services/phoneDoor';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../services/musicService', () => ({
  default: {
    getNavidromeTracks: vi.fn(),
    getAlbumGuide: vi.fn(async () => null),
    getImageUrl: vi.fn((path: string | null | undefined) => (path ? `/images/${path}` : null)),
    toggleListenNext: vi.fn(async () => ({})),
  },
}));
vi.mock('../services/player', () => ({
  usePlayer: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  player: { playAlbum: vi.fn(), playTrack: vi.fn(), toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn() },
  localOutputName: () => 'this iPhone',
}));
// No appliance in the house: the output's button stays away. The mixtapes are not asked for.
vi.mock('./OutputMenu', () => ({ default: () => null }));
vi.mock('../utils/mixtapeStore', () => ({
  useMixtapes: () => ({ mixtapes: [] }), byLastChange: (list: unknown[]) => list, heldIn: () => 0, toggleInMixtape: vi.fn(), createMixtape: vi.fn(),
}));

/** What the sheet tells the player: covered while it is open (the pill out of sight), and whether the full screen is. */
const Door = () => {
  const covered = useCovered();
  const full = useFullPlayer();
  return <span data-testid="door">{`covered ${covered} full ${full}`}</span>;
};

const ripped = {
  configured: true, found: true, album: { id: 'nd-1', name: 'Abbey Road', url: 'https://music.lab/album/nd-1' },
  tracks: [1, 2, 3].map(track => ({
    id: `f${track}`, discNumber: 1, track, title: `T${track}`, durationSec: 180, suffix: 'flac', bitRate: 900,
    bitDepth: 16, samplingRate: 44100, channelCount: 2, size: 20_000_000, path: `${track}.flac`, starred: false,
  })),
};

const album = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Abbey Road',
  artist: ['The Beatles'],
  cover: 'covers/1.jpg',
  releaseYear: 2009,
  format: 'CD',
  titleStatus: 'owned',
  discs: [{ number: 1, tracks: [1, 2, 3].map(no => ({ no, title: `Track ${no}`, durationSec: 180 })) }],
  ...over,
});

const sheet = (changes: Record<string, unknown> = {}) => (
  <AlbumSheet album={album(changes.album as Record<string, unknown>)} onClose={vi.fn()} onOpenCard={vi.fn()} {...changes} />
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { album: null, tracks: [], index: 0, playing: false, position: 0, duration: 0, output: { kind: 'local' } };
  vi.mocked(musicService.getNavidromeTracks).mockResolvedValue(ripped as never);
  vi.mocked(musicService.getAlbumGuide).mockResolvedValue(null);
});

describe('AlbumSheet', () => {
  it('opens on the album: who, what, and its tracks', async () => {
    render(sheet());
    expect(screen.getByRole('dialog', { name: 'Abbey Road' })).toBeInTheDocument();
    expect(screen.getByText('The Beatles')).toBeInTheDocument();
    expect(screen.getByText('CD · 3 tracks · 9 min · 2009')).toBeInTheDocument();
    expect(await screen.findByText('Plays on this iPhone · 9 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Track 3/ })).toBeEnabled();
  });

  it('▶ plays the album from its first track', async () => {
    render(sheet());
    const play = await screen.findByRole('button', { name: 'Play' });
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(player.playAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: 1, navidromeId: 'nd-1' }), expect.any(Array), 0);
    expect(vi.mocked(player.playAlbum).mock.calls[0][1]).toHaveLength(3);
  });

  it('a track tapped plays from it', async () => {
    render(sheet());
    await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(screen.getByRole('button', { name: /Track 2/ }));
    expect(player.playAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(Array), 1);
  });

  it('this album playing: ⏯ in the band, the track in gold, a tap on another track of it', async () => {
    mocks.state = {
      album: { id: 1, title: 'Abbey Road' }, tracks: ripped.tracks.map(file => ({ songId: file.id, title: file.title, durationSec: 180 })),
      index: 1, playing: true, position: 12, duration: 180, output: { kind: 'local' },
    };
    render(sheet());
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Position in the track' })).toHaveAttribute('aria-valuenow', '12');
    const now = await screen.findByRole('button', { name: /Track 2/ });
    expect(now).toHaveClass('album-sheet-track--now');
    expect(now).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByText('Playing on this iPhone · 9 min')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(player.toggle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Track 3/ }));
    expect(player.playTrack).toHaveBeenCalledWith(2);
    expect(player.playAlbum).not.toHaveBeenCalled();
  });

  it('a CD not ripped: ▶ greyed, and why', async () => {
    vi.mocked(musicService.getNavidromeTracks).mockResolvedValue({ configured: true, found: false, tracks: [] } as never);
    render(sheet());
    expect(await screen.findByText('On CD only — put it on, or rip it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Not ripped')).toBeInTheDocument();
    // Its tracks are listed still, greyed.
    expect(screen.getByRole('button', { name: /Track 1/ })).toBeDisabled();
  });

  it('a wish with no rip: ▶ greyed, not ripped yet', async () => {
    vi.mocked(musicService.getNavidromeTracks).mockResolvedValue({ configured: true, found: false, tracks: [] } as never);
    render(sheet({ album: album({ titleStatus: 'wish' }) }));
    expect(await screen.findByText('Not ripped yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('(i) and ⋯ › Album card open the card', async () => {
    const onOpenCard = vi.fn();
    render(sheet({ onOpenCard }));
    fireEvent.click(screen.getByRole('button', { name: 'Album card' }));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Album card' }));
    expect(onOpenCard).toHaveBeenCalledTimes(2);
  });

  it('the headphones put the album in Listen Next, streamed, and take it out', async () => {
    const onListenNextChange = vi.fn();
    const { rerender } = render(sheet({ onListenNextChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Stream it next' }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenCalledWith(1, undefined, 'digital'));
    expect(onListenNextChange).toHaveBeenCalled();

    rerender(sheet({ onListenNextChange, isInListenNext: true, listenNextMedium: 'digital' }));
    const on = screen.getByRole('button', { name: 'Take out of Listen Next' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(on);
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenLastCalledWith(1));
  });

  it('⋯ › From the CD moves it to the CD list', async () => {
    render(sheet({ isInListenNext: true, listenNextMedium: 'digital' }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Streamed' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'From the CD' }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenCalledWith(1, undefined, 'cd'));
  });

  it('Guide shows the listening guide in place of the tracks, Tracks brings them back', async () => {
    vi.mocked(musicService.getAlbumGuide).mockResolvedValue({ text: 'Listen for the bass line of the Aria.' } as never);
    render(sheet());
    fireEvent.click(await screen.findByRole('tab', { name: 'Guide' }));
    expect(screen.getByText('Listen for the bass line of the Aria.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Track 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tracks' }));
    expect(screen.getByRole('button', { name: /Track 1/ })).toBeInTheDocument();
  });

  it('offers no guide tab when the album has none', async () => {
    render(sheet());
    await screen.findByRole('button', { name: 'Play' });
    expect(screen.queryByRole('tab', { name: 'Guide' })).not.toBeInTheDocument();
  });

  it('another album playing: its disc at the foot, with its words, opens the full screen player; the pill gives way', async () => {
    mocks.state = {
      ...mocks.state, barShown: true, playing: true, position: 30, duration: 120,
      album: { id: 9, title: 'Kind of Blue', artist: 'Miles Davis', cover: null },
      tracks: [{ songId: 'k1', title: 'So What', disc: 1, no: 1, durationSec: 120 }],
    };
    resetPhoneDoor();
    render(<>{sheet()}<Door /></>);
    expect(screen.getByTestId('door')).toHaveTextContent('covered true');
    const disc = await screen.findByRole('button', { name: 'Now playing: So What, Miles Davis' });
    expect(disc).toHaveTextContent('So What');
    fireEvent.click(disc);
    expect(screen.getByTestId('door')).toHaveTextContent('full true');
    resetPhoneDoor();
  });

  it('this album playing: no disc at the foot, its own controls say it', async () => {
    mocks.state = {
      ...mocks.state, barShown: true, playing: true,
      album: { id: 1, title: 'Abbey Road', artist: 'The Beatles', cover: null },
      tracks: [{ songId: 'f1', title: 'T1', disc: 1, no: 1, durationSec: 180 }],
    };
    render(sheet());
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.queryByRole('button', { name: /Now playing/ })).not.toBeInTheDocument();
  });

  it('a box set lists its tracks by disc', async () => {
    const box = album({ discs: [1, 2].map(number => ({ number, tracks: [{ no: 1, title: `D${number} one`, durationSec: 100 }] })) });
    render(sheet({ album: box }));
    await screen.findByRole('button', { name: 'Play' });
    expect(screen.getByText('Disc 2 · 1 tracks')).toBeInTheDocument();
    expect(screen.getByText('CD · 2 discs · 2 tracks · 3 min · 2009')).toBeInTheDocument();
  });

  it('the handle closes it, once it has slid out', async () => {
    const onClose = vi.fn();
    render(sheet({ onClose }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Escape closes it, unless a card or a menu stands over it', async () => {
    const onClose = vi.fn();
    render(sheet({ onClose }));
    await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await screen.findByRole('menuitem', { name: 'Album card' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(onClose).not.toHaveBeenCalled();
  });
});
