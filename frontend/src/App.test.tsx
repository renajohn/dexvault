import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

/**
 * The shell: navigation between the four collections and the one search box
 * that serves all of them. What each page then renders is covered by that
 * page's own tests.
 */

vi.mock('./services/api', () => ({
  default: {
    getAllMovies: vi.fn(() => Promise.resolve([])),
    getMovieDetails: vi.fn(() => Promise.resolve(null)),
    getAutocompleteSuggestions: vi.fn(() => Promise.resolve([])),
    getCollectionNames: vi.fn(() => Promise.resolve([])),
    getBoxSetNames: vi.fn(() => Promise.resolve([])),
    getWatchNextMovies: vi.fn(() => Promise.resolve([])),
    getAllCollections: vi.fn(() => Promise.resolve([]))
  }
}));

vi.mock('./services/musicService', () => ({
  default: { getAllAlbums: vi.fn(() => Promise.resolve([])) }
}));

vi.mock('./services/bookService', () => ({
  default: { getAllBooks: vi.fn(() => Promise.resolve([])) }
}));

describe('App shell', () => {
  it('lands on FilmDex rather than an empty route', async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/^Search FilmDex/i)).toBeInTheDocument()
    );
  });

  it('offers a way into each collection', async () => {
    render(<App />);

    // The pills carry an icon, not a label, so the tooltip is what names them.
    const sections = await screen.findByRole('radiogroup', { name: 'Collections' });

    const tooltips = Array.from(sections.querySelectorAll('[role="radio"]')).map(s =>
      s.getAttribute('aria-label')
    );

    expect(tooltips).toEqual([
      expect.stringContaining('FilmDex'),
      expect.stringContaining('MusicDex'),
      expect.stringContaining('BookDex'),
      expect.stringContaining('Scores'),
      expect.stringContaining('Wish List'),
      expect.stringContaining('Shelves')
    ]);
  });

  it('marks the collection currently being shown', async () => {
    render(<App />);

    const sections = await screen.findByRole('radiogroup', { name: 'Collections' });

    expect(within(sections).getByRole('radio', { checked: true })).toHaveAccessibleName(expect.stringContaining('FilmDex'));
  });

  it('replaces an age group or a format of the ▾ filters rather than adding a second one', async () => {
    render(<App />);
    await screen.findByPlaceholderText(/^Search FilmDex/i);
    const pick = async (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Advanced filters' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    };
    const pills = () => screen.queryAllByRole('group').map(g => g.getAttribute('aria-label')).filter(l => l && /:/.test(l));

    await pick('Children (4-9)');
    await pick('Teens & Adults (15+)');
    await waitFor(() => expect(pills()).toEqual(['recommended_age: >=15']));

    await pick('Blu-ray 4K');
    await pick('DVD');
    await waitFor(() => expect(pills()).toEqual(['recommended_age: >=15', 'format: DVD']));
  });
});
