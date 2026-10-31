import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MovieSheet from './MovieSheet';

vi.mock('../services/api', () => ({
  default: {
    getMovieCast: vi.fn(() => Promise.resolve([])),
    getMovieCollections: vi.fn(() => Promise.resolve([])),
    getAllCollections: vi.fn(() => Promise.resolve([])),
    getCollectionMovies: vi.fn(() => Promise.resolve({ movies: [] })),
    toggleWatchNext: vi.fn(() => Promise.resolve({})),
    getWatchNextMovies: vi.fn(() => Promise.resolve([{ id: 1, title: 'Dune part one' }])),
    markMovieAsWatched: vi.fn(() => Promise.resolve({ last_watched: '2026-10-31', watch_count: 2 })),
    updateMovie: vi.fn(() => Promise.resolve({})),
    getMovieWarnings: vi.fn(() => Promise.resolve({
      movieId: 1, dddId: null, dddUrl: null, matchedBy: null, checkedAt: null, topics: [],
    })),
    getMovieFilmages: vi.fn(() => Promise.resolve({
      movieId: 1, filmagesId: null, filmagesUrl: null, ageLegal: null, ageSuggested: null,
      indications: [], counterIndications: [], synthesis: null, matchedBy: null, checkedAt: null,
      movieAge: null, ageSource: null,
    })),
  },
}));

import apiService from '../services/api';

const movie = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Dune part one',
  director: 'Denis Villeneuve',
  plot: 'Paul Atreides travels to Arrakis.',
  genre: 'Science Fiction, Adventure',
  release_date: '2021-09-15',
  runtime: 155,
  recommended_age: 14,
  format: 'Blu-ray 4K',
  price: 14,
  acquired_date: '2024-10-18',
  poster_path: '/api/images/posters/dune.jpg',
  trailer_key: 'w0HgHet0sxg',
  trailer_site: 'YouTube',
  title_status: 'owned',
  watch_count: 1,
  last_watched: '2026-01-02',
  ...over,
});

const sheet = (props: Partial<React.ComponentProps<typeof MovieSheet>> = {}) =>
  render(<MovieSheet movieId={1} movie={movie()} watchNext={[]} onWatchNextChange={() => undefined} onClose={() => undefined} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MovieSheet', () => {
  it('heads every tab with the title, the director, the year, the length and the age', async () => {
    const { container } = sheet();
    expect(container.querySelector('.phone-sheet-head__title')).toHaveTextContent('Dune part one');
    expect(screen.getByText('Denis Villeneuve')).toBeInTheDocument();
    expect(screen.getByText('2021 · 2 h 35 · 14+')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    expect(container.querySelector('.phone-sheet-head__title')).toHaveTextContent('Dune part one');
    await waitFor(() => expect(apiService.getMovieCast).toHaveBeenCalledWith(1));
  });

  it('shows the film first: the overview and a link to the trailer on YouTube', () => {
    sheet();
    expect(screen.getByRole('tab', { name: 'Film' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Paul Atreides travels to Arrakis.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Trailer/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=w0HgHet0sxg');
  });

  it('puts Collections before Owned, and calls Owned Wished for a film of the wish list', () => {
    sheet({ movie: movie({ title_status: 'wish' }) });
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Film', 'Collections', 'Wished']);
  });

  it('shows the price of the copy in Owned', () => {
    sheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    expect(screen.getByText(/CHF\s*14\.00/)).toBeInTheDocument();
  });

  it('puts the film in Watch Next from the star on its poster', async () => {
    const onWatchNextChange = vi.fn();
    sheet({ onWatchNextChange });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Watch Next' }));
    await waitFor(() => expect(apiService.toggleWatchNext).toHaveBeenCalledWith(1));
    expect(onWatchNextChange).toHaveBeenCalled();
  });

  it('says its place in Watch Next among the collections', () => {
    sheet({ watchNext: [{ id: 7, title: 'Big Fish' }, { id: 1, title: 'Dune part one' }, { id: 9, title: 'Heat' }] });
    fireEvent.click(screen.getByRole('tab', { name: /Collections/ }));
    expect(screen.getByText('2nd of 3')).toBeInTheDocument();
    expect(screen.getByText('· after Big Fish', { exact: false })).toBeInTheDocument();
  });

  it('marks it watched today', async () => {
    sheet();
    fireEvent.click(screen.getByRole('button', { name: 'Watched today' }));
    await waitFor(() => expect(apiService.markMovieAsWatched).toHaveBeenCalledWith(1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), true));
    await waitFor(() => expect(screen.getByText(/Seen 2 times/)).toBeInTheDocument());
  });

  it('opens on a film the page does not list, before its details are read', () => {
    const { container } = sheet({ movie: null, listMovie: undefined });
    expect(container.querySelector('.phone-sheet')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Film' })).toBeInTheDocument();
  });

  it('saves the last day watched as a watching, not as a field of the movie', async () => {
    sheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    fireEvent.click(screen.getByText('2 January 2026'));
    const field = screen.getByDisplayValue('2026-01-02');
    fireEvent.change(field, { target: { value: '2026-01-05' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(apiService.markMovieAsWatched).toHaveBeenCalledWith(1, '2026-01-05', false));
    expect(apiService.updateMovie).not.toHaveBeenCalled();
  });

  it('edits the day acquired as the day shown, not the day before', () => {
    sheet({ movie: movie({ acquired_date: '10/18/2024' }) });
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    fireEvent.click(screen.getByText('18 October 2024'));
    expect(screen.getByDisplayValue('2024-10-18')).toBeInTheDocument();
  });

  it('cancels an edit with Escape rather than closing', () => {
    const onClose = vi.fn();
    sheet({ onClose });
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    fireEvent.click(screen.getByText(/CHF\s*14\.00/));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(/CHF\s*14\.00/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reads Watch Next itself when the page does not give it (the wish list)', async () => {
    render(<MovieSheet movieId={1} movie={movie()} onClose={() => undefined} />);
    await waitFor(() => expect(apiService.getWatchNextMovies).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Remove from Watch Next' })).toBeInTheDocument();
  });
});
