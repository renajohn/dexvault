import React from 'react';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MusicDetailCard from './MusicDetailCard';
import { ConfirmHost, resetConfirm } from './shared/ConfirmDialog';

vi.mock('../services/musicService', () => ({
  default: {
    getListenNextAlbums: vi.fn(() => Promise.resolve([])),
    getNavidromeTracks: vi.fn(() => Promise.resolve({ configured: true, found: false, tracks: [] })),
    getDigitalTracks: vi.fn(() => Promise.resolve([])),
    getAlbumLyrics: vi.fn(() => Promise.resolve([])),
    getLyrics: vi.fn(() => Promise.resolve({ status: 'found', plain: 'Here comes the sun', synced: null, source: 'lrclib', checkedAt: '2026-10-16' })),
    getAlbumStory: vi.fn(() => Promise.resolve({ found: false, reason: 'no_musicbrainz' })),
    getImageUrl: vi.fn((path: string | null | undefined) => (path ? `/images/${path}` : null)),
    toggleListenNext: vi.fn(() => Promise.resolve({})),
    openAppleMusic: vi.fn(),
    getAppleMusicUrl: vi.fn(() => Promise.resolve({ url: 'https://music.apple.com/x' })),
    syncAlbumRating: vi.fn(() => Promise.resolve({ userRating: null })),
    setAlbumRating: vi.fn((_id: number, rating: number) => Promise.resolve({ userRating: rating || null, navidrome: 'synced' })),
    getAlbumNotes: vi.fn(() => Promise.resolve([])),
    getAlbumOverlaps: vi.fn(() => Promise.resolve([])),
    getAlbumGuide: vi.fn(() => Promise.resolve(null)),
    refreshFromMusicBrainz: vi.fn(() => Promise.resolve({})),
    getAlbumById: vi.fn(() => Promise.resolve({ rating: 4.15 })),
    refreshCommunityRating: vi.fn(() => Promise.resolve({ rating: 2, ratingVotes: 1, discogsRating: 4.26, discogsRatingVotes: 27, communityRating: 4.18, communityVotes: 28 })),
    getMixtapes: vi.fn(() => Promise.resolve({ configured: true, mixtapes: [] })),
  },
}));

import musicService from '../services/musicService';

const ripped = {
  configured: true, found: true, album: { id: 'nd-1', name: 'Abbey Road', url: 'https://music.lab/album/nd-1' },
  tracks: [1, 2, 3].map(track => ({
    discNumber: 1, track, title: `T${track}`, durationSec: 180, suffix: 'flac', bitRate: 900,
    bitDepth: 16, samplingRate: 44100, channelCount: 2, size: 20_000_000, path: `${track}.flac`,
  })),
};

const cd = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Abbey Road',
  artist: ['The Beatles'],
  cover: 'covers/1.jpg',
  releaseYear: 2009,
  country: 'GB',
  format: 'CD',
  releaseGroupFirstReleaseDate: '1969-09-26',
  labels: ['Apple Records'],
  catalogNumber: '0946 3 82468 2 4',
  barcode: '094638246824',
  genres: ['Rock', 'Pop'],
  musicbrainzReleaseId: 'rel-1',
  urls: { discogs: 'https://www.discogs.com/release/1' },
  discs: [{ number: 1, tracks: [1, 2, 3].map(no => ({ no, title: `Track ${no}`, durationSec: 1560 })) }],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (musicService.getNavidromeTracks as any).mockResolvedValue({ configured: true, found: false, tracks: [] });
  (musicService.getAlbumNotes as any).mockResolvedValue([]);
  (musicService.getAlbumGuide as any).mockResolvedValue(null);
  (musicService.getAlbumOverlaps as any).mockResolvedValue([]);
});

describe('MusicDetailCard also on', () => {
  const other = (id: number, title: string, shared: number, titleStatus = 'owned') => ({
    id, title, artist: ['The Beatles'], cover: null, titleStatus, format: 'CD', shared, trackCount: 20,
    tracks: Array.from({ length: shared }, (_, index) => ({ disc: 1, no: index + 1, title: `Track ${index + 1}` })),
  });

  it('names the albums holding some of its tracks, how many of them, and opens one on a click', async () => {
    (musicService.getAlbumOverlaps as any).mockResolvedValue([other(7, '1', 3), other(8, 'Love', 2, 'digital')]);
    const onOpenAlbum = vi.fn();
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} onOpenAlbum={onOpenAlbum} />);

    const one = await screen.findByRole('button', { name: '1' });
    expect(screen.getByText('all 3')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Love' })).toHaveAttribute('title', '2 tracks also on Love (digital, 20 tracks): Track 1, Track 2');
    fireEvent.click(one);
    expect(onOpenAlbum).toHaveBeenCalledWith(7);
  });

  it('names three albums, the rest on a click', async () => {
    (musicService.getAlbumOverlaps as any).mockResolvedValue([other(7, 'A', 2), other(8, 'B', 1), other(9, 'C', 1), other(10, 'D', 1), other(11, 'E', 1)]);
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} onOpenAlbum={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: '2 more' }));
    expect(screen.getByRole('button', { name: 'E' })).toBeInTheDocument();
  });

  it('says nothing when no other album shares a track', async () => {
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    await waitFor(() => expect(musicService.getAlbumOverlaps).toHaveBeenCalledWith(1));
    expect(screen.queryByText(/Also on/)).not.toBeInTheDocument();
  });
});

describe('MusicDetailCard notes and Wikipedia', () => {
  it('offers the first note and Wikipedia on one line, and shows the notes at once when there are some', async () => {
    (musicService.getAlbumGuide as any).mockResolvedValue({ albumId: 1, source: 'claude', model: null, text: '**Contexte** : x.', createdAt: '', updatedAt: '' });
    const { unmount } = render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);

    const write = await screen.findByRole('button', { name: 'Write a listening note…' });
    // A guide tells what matters first: Wikipedia waits for a click.
    expect(screen.getByRole('button', { name: 'Read on Wikipedia…' })).toHaveAttribute('aria-expanded', 'false');
    expect(musicService.getAlbumStory).toHaveBeenCalled();
    fireEvent.click(write);
    expect(screen.getByLabelText('New listening note')).toBeInTheDocument();
    unmount();

    (musicService.getAlbumNotes as any).mockResolvedValue([{ id: 1, albumId: 1, note: 'Side two at night.', date: '2026-10-01', createdAt: '', updatedAt: '' }]);
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    expect(await screen.findByText('Side two at night.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write a listening note…' })).not.toBeInTheDocument();
  });
});

describe('MusicDetailCard tracks', () => {
  it('plays the album from a track in DexVault, and its foot turns to Pause', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    // Only what the player tells Navidrome answers; the rest of the page stays offline.
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('/scrobble/') ? Promise.resolve(new Response('{}')) : Promise.reject(new Error('offline')))));
    (musicService.getNavidromeTracks as any).mockResolvedValue({
      ...ripped, tracks: ripped.tracks.map(track => ({ ...track, id: `song-${track.track}` })),
    });
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play Track 2' }));

    const { player } = await import('../services/player');
    expect(player.getState()).toMatchObject({ album: { id: 1, title: 'Abbey Road' }, index: 1, playing: true });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Track 2' })).toBeInTheDocument();
    player.stop();
    vi.unstubAllGlobals();
  });


  it('plays a ripped track from its number, and opens its words from the tag or its credits from the row', async () => {
    (musicService.getNavidromeTracks as any).mockResolvedValue({
      ...ripped, tracks: ripped.tracks.map(track => ({ ...track, url: `https://music.lab/song/${track.track}` })),
    });
    (musicService.getAlbumLyrics as any).mockResolvedValue([
      { discNumber: 1, trackNumber: 1, status: 'found' }, { discNumber: 1, trackNumber: 2, status: 'missing' }, { discNumber: 1, trackNumber: 3, status: 'instrumental' },
    ]);
    render(<MusicDetailCard cd={cd() as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);

    expect(await screen.findByRole('link', { name: 'Play Track 1 in Navidrome' })).toHaveAttribute('href', 'https://music.lab/song/1');
    // Only the track with words has the tag.
    const tag = await screen.findByRole('button', { name: 'lyrics' });
    expect(screen.getAllByRole('button', { name: 'lyrics' })).toHaveLength(1);

    fireEvent.click(tag);
    expect(await screen.findByText('Here comes the sun')).toBeInTheDocument();
    expect(musicService.getLyrics).toHaveBeenCalledWith(1, 1, 1);
    fireEvent.click(screen.getByRole('button', { name: 'credits', pressed: false }));
    expect(screen.queryByText('Here comes the sun')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lyrics', pressed: false })).toBeInTheDocument();

    // A track with no words opens on its credits, with no choice to make.
    fireEvent.click(screen.getByText('Track 2'));
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
  });
});

describe('MusicDetailCard', () => {
  it('shows the edition in one grid: who, what, when, label and links', async () => {
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    expect(screen.getByRole('button', { name: 'The Beatles' })).toBeInTheDocument();
    // The object and its edition in one murmur beside the cover.
    expect(screen.getByText('CD · 3 tracks · 1 h 18 min · 2009 · GB · Apple Records · first 1969-09-26')).toBeInTheDocument();
    expect(screen.queryByText('094638246824')).not.toBeInTheDocument();
    expect(screen.queryByText(/^added /)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MusicBrainz' })).toHaveAttribute('href', 'https://musicbrainz.org/release/rel-1');
    expect(screen.getByRole('link', { name: 'Discogs' })).toHaveAttribute('href', 'https://www.discogs.com/release/1');
    expect(screen.getByRole('img', { name: 'Abbey Road front cover' })).toHaveAttribute('src', '/images/covers/1.jpg');

    await waitFor(() => expect(screen.getByText('Not ripped yet.')).toBeInTheDocument());
  });

  it('folds the identifiers and the album notes away until asked', () => {
    render(<MusicDetailCard cd={cd({ annotation: 'Remastered from the original tapes' })} onClose={() => {}} onDelete={() => {}} />);

    expect(screen.queryByText('Remastered from the original tapes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edition, codes and more' }));

    expect(screen.getByText('Remastered from the original tapes')).toBeInTheDocument();
    expect(screen.getByText(/^added /)).toBeInTheDocument();
    expect(screen.getByText('0946 3 82468 2 4')).toBeInTheDocument();
    expect(screen.getByText('094638246824')).toBeInTheDocument();
    expect(screen.getByText('rel-1')).toBeInTheDocument();
  });

  it('sums up the ISRC codes in the fold, the first and the last, all of them on a click', () => {
    render(<MusicDetailCard cd={cd({ isrcCodes: ['GBAYE0601690', 'GBAYE0601691', 'GBAYE0601692', 'GBAYE0601693'] })} onClose={() => {}} onDelete={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edition, codes and more' }));
    expect(screen.getByText('GBAYE0601690 … GBAYE0601693')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Show every code'));
    expect(screen.getByText('GBAYE0601690, GBAYE0601691, GBAYE0601692, GBAYE0601693')).toBeInTheDocument();
  });

  it('leaves out what it does not know, and a first release in the same year', () => {
    render(<MusicDetailCard cd={cd({
      country: undefined, labels: [], catalogNumber: undefined, barcode: undefined, genres: [],
      releaseGroupFirstReleaseDate: '2009-09-09', musicbrainzReleaseId: null, urls: {},
    })} onClose={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('CD · 3 tracks · 1 h 18 min · 2009')).toBeInTheDocument();
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Label/)).not.toBeInTheDocument();
    expect(screen.queryByText('Barcode')).not.toBeInTheDocument();
    expect(screen.queryByText('Genres')).not.toBeInTheDocument();
    expect(screen.queryByText('Links')).not.toBeInTheDocument();
  });

  it('says how the rip stands in Navidrome and offers to listen to it', async () => {
    (musicService.getNavidromeTracks as any).mockResolvedValue(ripped);
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    await waitFor(() => expect(screen.getByText('Lossless')).toBeInTheDocument());
    expect(screen.getByText('· 3 of 3 tracks · FLAC · 16-bit · 44.1 kHz · stereo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Apple Music' })).not.toBeInTheDocument();
  });

  it('marks a lossy rip, still to be ripped again', async () => {
    (musicService.getNavidromeTracks as any).mockResolvedValue({
      ...ripped, tracks: ripped.tracks.map(file => ({ ...file, suffix: 'mp3', bitDepth: null, samplingRate: null })),
    });
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    await waitFor(() => expect(screen.getByText('Lossy')).toBeInTheDocument());
    expect(screen.getByText('Lossy')).toHaveClass('album-head-lossy');
  });

  it('falls back to Apple Music when the CD is not ripped', async () => {
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    const apple = await screen.findByRole('button', { name: 'Apple Music' });
    fireEvent.click(apple);
    await waitFor(() => expect(musicService.openAppleMusic).toHaveBeenCalledWith('https://music.apple.com/x'));
  });

  it('searches the collection from the artist and a genre, closing the card', () => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    render(<MusicDetailCard cd={cd()} onClose={onClose} onDelete={() => {}} onSearch={onSearch} />);

    fireEvent.click(screen.getByRole('button', { name: 'The Beatles' }));
    expect(onSearch).toHaveBeenCalledWith('artist:"The Beatles"');
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    expect(onSearch).toHaveBeenCalledWith('genre:"Pop"');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the edition\'s note and the owner\'s facts in the fold, and the edit action in the footer', () => {
    const onEdit = vi.fn();
    render(<MusicDetailCard cd={cd({
      ownership: { condition: 'NM', priceChf: 12, notes: 'Bought at the flea market' },
      editionNotes: '2009 remaster', producer: ['George Martin'],
    })} onClose={() => {}} onDelete={() => {}} onEdit={onEdit} />);

    expect(screen.queryByText('2009 remaster')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edition, codes and more' }));
    expect(screen.getByText('2009 remaster')).toBeInTheDocument();
    expect(screen.getByText('Near Mint · CHF 12')).toBeInTheDocument();
    expect(screen.getByText('Bought at the flea market')).toBeInTheDocument();
    expect(screen.getByText('George Martin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('gives the CD stars, and takes them away with a second click on the same star', async () => {
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    await waitFor(() => expect(musicService.setAlbumRating).toHaveBeenCalledWith(1, 4));
    await waitFor(() => expect(screen.getByRole('button', { name: '4 stars' })).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    await waitFor(() => expect(musicService.setAlbumRating).toHaveBeenLastCalledWith(1, 0));
  });

  it('shows the stars given in Navidrome since, as the album opens', async () => {
    vi.mocked(musicService.syncAlbumRating).mockResolvedValueOnce({ userRating: 5 });
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '5 stars' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('shows both communities\' rating weighed by their votes, each in the tooltip', () => {
    render(<MusicDetailCard cd={cd({ rating: 2, ratingVotes: 1, discogsRating: 4.26, discogsRatingVotes: 27, communityRating: 4.18, communityVotes: 28 })} onClose={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('4.2', { exact: false })).toBeInTheDocument();
    const rating = screen.getByText(/28 votes/).parentElement!;
    expect(rating).toHaveAttribute('title', 'Discogs: 27 votes → 4.26\nMusicBrainz: 1 vote → 2');
  });

  it('says when too few voted rather than showing one listener\'s stars', () => {
    render(<MusicDetailCard cd={cd({ rating: 2, ratingVotes: 1, communityRating: null, communityVotes: 1 })} onClose={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('Too few votes (1)')).toHaveAttribute('title', 'MusicBrainz: 1 vote → 2');
  });

  it('rereads MusicBrainz and Discogs from the loop beside the rating', async () => {
    render(<MusicDetailCard cd={cd({ rating: null })} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('No community rating')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the community rating' }));

    await screen.findByText('4.2', { exact: false });
    expect(musicService.refreshFromMusicBrainz).toHaveBeenCalledWith(1);
    expect(musicService.refreshCommunityRating).toHaveBeenCalledWith(1);
  });

  it('steps to the album before or after it with ‹ › and the arrow keys, not while typing', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} onPrevious={onPrevious} onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next album' }));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: 'Write a listening note…' }));
    fireEvent.keyDown(screen.getByPlaceholderText('What did you hear this time?'), { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('greys out ‹ on the first album, and shows no steps for an album the page does not list', () => {
    const { rerender } = render(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous album' })).toBeDisabled();

    rerender(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Previous album' })).not.toBeInTheDocument();
  });

  it('scrolls the details with ↓ right away, further with Shift', () => {
    render(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} />);
    const body = document.querySelector('.modal-body') as HTMLElement;
    body.scrollBy = vi.fn();

    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(body, { key: 'ArrowUp', shiftKey: true });

    expect(body.scrollBy).toHaveBeenNthCalledWith(1, { top: 120, behavior: 'smooth' });
    expect(body.scrollBy).toHaveBeenNthCalledWith(2, { top: -360, behavior: 'smooth' });
  });

  it('glides while ↓ is held, frame by frame, and stops when it is let go', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    render(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} />);
    const body = document.querySelector('.modal-body') as HTMLElement;
    body.scrollBy = vi.fn();

    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown', repeat: true });
    fireEvent.keyDown(document.body, { key: 'ArrowDown', repeat: true });

    // One smooth step for the press, then a single glide for the repeats.
    expect(body.scrollBy).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
    frames[0](performance.now() + 16);
    expect(body.scrollTop).toBeGreaterThan(0);

    fireEvent.keyUp(document.body, { key: 'ArrowDown' });
    expect(caf).toHaveBeenCalled();
    raf.mockRestore();
    caf.mockRestore();
  });

  it('leaves the arrows to a field being typed in', async () => {
    render(<MusicDetailCard cd={cd()} onClose={vi.fn()} onDelete={vi.fn()} />);
    const body = document.querySelector('.modal-body') as HTMLElement;
    body.scrollBy = vi.fn();

    fireEvent.click(await screen.findByRole('button', { name: 'Write a listening note…' }));
    fireEvent.keyDown(screen.getByPlaceholderText('What did you hear this time?'), { key: 'ArrowDown' });

    expect(body.scrollBy).not.toHaveBeenCalled();
  });
});

describe('MusicDetailCard plays of a track', () => {
  const digital = {
    notRipped: false,
    album: {
      navidromeId: 'nd-1', name: 'Abbey Road', artist: 'The Beatles', songCount: 3, url: '', formats: ['FLAC'], quality: 'lossless',
      bitRate: null, hiRes: false, cd: null, oldCopy: false, wishAlbumId: null, albumId: 1, rating: 0, starred: false,
      favouriteTracks: 0, listening: { favourites: 0, needed: 3, plays: 3, lastPlayed: null, score: 0 }, buy: null, dismissed: false,
    },
  };
  const heard = (track: number, totalPlays: number, plays: number) => ({
    id: `s${track}`, url: null, discNumber: 1, track, title: `T${track}`, durationSec: 180, suffix: 'flac', bitRate: 900,
    bitDepth: 16, samplingRate: 44100, plays, totalPlays, lastPlayed: null, rating: 0, starred: false,
  });

  it('counts every play, a lighter grey for a track heard lately, and says it in the open track', async () => {
    (musicService.getDigitalTracks as any).mockResolvedValue([heard(1, 43, 3), heard(2, 31, 0), heard(3, 0, 0)]);
    render(<MusicDetailCard cd={cd() as any} digital={digital as any} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);

    const lately = await screen.findByText('×43');
    expect(lately).toHaveClass('track-plays', 'track-plays-lately');
    expect(lately).toHaveAttribute('title', '43 plays · 3 in 90 days');
    expect(screen.getByText('×31')).not.toHaveClass('track-plays-lately');
    expect(screen.queryByText('×0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Track 1'));
    expect(await screen.findByText('43 plays · 3 in 90 days')).toHaveClass('track-details-plays');
  });
});

describe('MusicDetailCard — a missing side', () => {
  it('offers to find a cover in the empty cover, and the back under the front', () => {
    const { rerender } = render(<MusicDetailCard cd={cd({ cover: null }) as any} onClose={vi.fn()} onDelete={vi.fn()} onCoverChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Find a cover…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find the back…' })).toBeInTheDocument();

    rerender(<MusicDetailCard cd={cd() as any} onClose={vi.fn()} onDelete={vi.fn()} onCoverChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Find a cover…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find the back…' })).toBeInTheDocument();

    rerender(<MusicDetailCard cd={cd({ backCover: 'covers/1-back.jpg' }) as any} onClose={vi.fn()} onDelete={vi.fn()} onCoverChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Find the back…' })).not.toBeInTheDocument();
  });

  it('offers nothing where the cover found could not be kept', () => {
    render(<MusicDetailCard cd={cd({ cover: null }) as any} onClose={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Find a cover…' })).not.toBeInTheDocument();
  });
});

describe('MusicDetailCard Listen Next, streamed or on CD', () => {
  it('streams it by default, and its ▾ puts it on the CD list instead', async () => {
    render(<MusicDetailCard cd={cd({ titleStatus: 'owned', fileQuality: 'lossless' }) as any} onClose={() => {}} onDelete={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Listen Next' }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenCalledWith(1, undefined, 'digital'));

    fireEvent.click(screen.getByRole('button', { name: 'Choose how and what for Listen Next' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /From the CD/ }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenLastCalledWith(1, undefined, 'cd'));
  });

  it('says it is on the CD list, and offers no CD for an album with none', async () => {
    (musicService.getListenNextAlbums as any).mockResolvedValueOnce([{ id: 1, disc: null, medium: 'cd' }]);
    const { unmount } = render(<MusicDetailCard cd={cd({ titleStatus: 'owned' }) as any} onClose={() => {}} onDelete={() => {}} />);
    expect(await screen.findByText(/· from the CD/)).toBeInTheDocument();
    unmount();

    render(<MusicDetailCard cd={cd({ titleStatus: 'digital' }) as any} onClose={() => {}} onDelete={() => {}} />);
    await screen.findByRole('button', { name: 'Listen Next' });
    expect(screen.queryByRole('button', { name: 'Choose how and what for Listen Next' })).not.toBeInTheDocument();
  });

  it('gives each disc the album button’s shorthand: streamed by a click, from the CD by its ▾', async () => {
    const twoDiscs = [1, 2].map(number => ({ number, tracks: [1, 2].map(no => ({ no, title: `D${number} T${no}`, durationSec: 200 })) }));
    (musicService.getListenNextAlbums as any).mockResolvedValue([{ id: 1, disc: 1, medium: 'cd' }]);
    render(<MusicDetailCard cd={cd({ titleStatus: 'owned', fileQuality: 'lossless', discs: twoDiscs }) as any} onClose={() => {}} onDelete={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Disc 1 in Listen Next' })).toHaveTextContent('from the CD');

    fireEvent.click(screen.getByRole('button', { name: 'Disc 2 to Listen Next' }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenCalledWith(1, 2, 'digital'));

    fireEvent.click(screen.getByRole('button', { name: 'Disc 2: streamed or from the CD' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /From the CD/ }));
    await waitFor(() => expect(musicService.toggleListenNext).toHaveBeenLastCalledWith(1, 2, 'cd'));
    (musicService.getListenNextAlbums as any).mockResolvedValue([]);
  });
});

describe('MusicDetailCard on the outputs', () => {
  const withIds = { ...ripped, tracks: ripped.tracks.map(file => ({ ...file, id: `song-${file.track}` })) };
  let sent: Array<{ url: string; body: unknown }> = [];

  beforeEach(async () => {
    sent = [];
    const stored = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      const salon = { id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true, volume: 30, muted: false, maxVolume: 70, session: null };
      // The outputs answer; the rest of the page stays offline.
      if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify([salon])));
      return String(url).startsWith('/api/outputs/') ? Promise.resolve(new Response('{}')) : Promise.reject(new Error('offline'));
    }));
    const { resetOutputs, default: outputs } = await import('../services/outputs');
    const { resetPlayer } = await import('../services/player');
    resetOutputs();
    resetPlayer();
    await outputs.list();
  });

  afterEach(async () => {
    const { resetOutputs } = await import('../services/outputs');
    const { resetPlayer } = await import('../services/player');
    act(() => { resetOutputs(); resetPlayer(); });
    vi.unstubAllGlobals();
  });

  it('plays on Salon from its ▾, which is then the output; Play goes there next', async () => {
    (musicService.getNavidromeTracks as any).mockResolvedValue(withIds);
    const { player } = await import('../services/player');
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'More ways to listen' }));
    expect(screen.getByText('Play on')).toBeInTheDocument();
    // This browser among them, the output it is, ✓.
    expect(screen.getByRole('menuitemradio', { name: /^This / })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Salon' }));

    expect(player.getState().output).toEqual({ kind: 'renderer', id: 'uuid:salon', name: 'Salon' });
    const play = await vi.waitFor(() => {
      const found = sent.find(call => call.url === '/api/outputs/uuid%3Asalon/play');
      if (!found) throw new Error('Not sent yet');
      return found;
    });
    expect(play.body).toMatchObject({ album: { id: 1, title: 'Abbey Road' }, index: 0, tracks: [{ songId: 'song-1' }, { songId: 'song-2' }, { songId: 'song-3' }] });

    // The gold Play says where it plays; in the ▾ Salon is now the one ✓, this browser a choice.
    expect(await screen.findByText(/· Salon/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More ways to listen' }));
    expect(screen.getByRole('menuitemradio', { name: 'Salon' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /^This / })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('MusicDetailCard on a phone', () => {
  const guide = { albumId: 1, source: 'claude', model: null, text: '**Context**: Recorded in 1969, in one summer.', createdAt: '', updatedAt: '' };

  beforeEach(() => {
    // A phone's width: the same query the player's bar asks (useMedia).
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 767px'), addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetConfirm();
  });

  it('lays the head out at a fixed height, the guide behind a chip that opens a sheet with its words', async () => {
    (musicService.getAlbumGuide as any).mockResolvedValue(guide);
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);

    // The head: the cover and, beside it, the lines and the stars in a block of its own; nothing to read in place.
    expect(document.querySelector('.album-head--phone')).toBeInTheDocument();
    const who = document.querySelector('.album-head-who--phone') as HTMLElement;
    expect(within(who).getByRole('button', { name: 'The Beatles' })).toBeInTheDocument();
    expect(within(who).getByRole('button', { name: '4 stars' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read on Wikipedia…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edition, codes and more' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorded in 1969/)).not.toBeInTheDocument();

    // The chips, in a row that wraps; the guide's only once there is one.
    const chips = document.querySelector('.album-chips') as HTMLElement;
    expect(chips).toBeInTheDocument();
    fireEvent.click(await within(chips).findByRole('button', { name: 'Guide' }));

    const sheet = await screen.findByRole('dialog', { name: 'Before you listen' });
    expect(sheet).toHaveClass('dialog--sheet');
    expect(await within(sheet).findByText(/Recorded in 1969/)).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Guide' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps three things at the foot, Edit and Delete under ⋯, and Delete asks first', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<><ConfirmHost /><MusicDetailCard cd={cd()} onClose={() => {}} onEdit={onEdit} onDelete={onDelete} /></>);
    await screen.findByRole('button', { name: 'Apple Music' });

    const foot = document.querySelector('.music-detail-foot--phone') as HTMLElement;
    expect(foot.children).toHaveLength(3);
    expect(within(foot).getByRole('button', { name: 'Listen Next' })).toBeInTheDocument();
    expect(within(foot).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(foot).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(foot).queryByRole('button', { name: 'Mixtapes' })).not.toBeInTheDocument();

    fireEvent.click(within(foot).getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(within(foot).getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const question = await screen.findByRole('alertdialog', { name: 'Delete “Abbey Road”?' });
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it('lists the other albums in a sheet, and opens one on a tap', async () => {
    (musicService.getAlbumOverlaps as any).mockResolvedValue([
      { id: 7, title: 'Love', artist: ['The Beatles'], cover: 'covers/7.jpg', titleStatus: 'owned', format: 'CD', shared: 2, trackCount: 26, tracks: [{ disc: 1, no: 1, title: 'Track 1' }, { disc: 1, no: 2, title: 'Track 2' }] },
    ]);
    const onOpenAlbum = vi.fn();
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} onOpenAlbum={onOpenAlbum} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Also on/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Also on' });
    const row = within(sheet).getByRole('button', { name: /Love/ });
    expect(row).toHaveTextContent('CD · 26 tracks · 2/3 of this album\'s');
    fireEvent.click(row);
    expect(onOpenAlbum).toHaveBeenCalledWith(7);
  });

  it('writes a listening note in the notes sheet, from ⋯', async () => {
    render(<MusicDetailCard cd={cd()} onClose={() => {}} onDelete={() => {}} />);
    await screen.findByRole('button', { name: 'Apple Music' });

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Write a listening note…' }));

    const sheet = await screen.findByRole('dialog', { name: 'Listening notes' });
    expect(await within(sheet).findByLabelText('New listening note')).toBeInTheDocument();
  });
});
