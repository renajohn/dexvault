import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import ScoresPage from './ScoresPage';
import bookSectionsService, { Score } from '../services/bookSectionsService';
import bookService from '../services/bookService';

vi.mock('../services/bookSectionsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/bookSectionsService')>()),
  default: { scores: vi.fn(), setComposers: vi.fn(), addFile: vi.fn(), files: vi.fn() },
}));
vi.mock('../services/bookService', () => ({ default: { uploadEbook: vi.fn(), getImageUrl: (p: string | null) => p, getBookById: vi.fn(), updateBook: vi.fn(), deleteBook: vi.fn(), addBook: vi.fn() } }));

const Reading = () => <p>Reading score {useParams().id}</p>;
const page = (props: React.ComponentProps<typeof ScoresPage> = {}) => <MemoryRouter><ScoresPage {...props} /></MemoryRouter>;

const score = (id: number, title: string, fields: Partial<Score> = {}): Score => ({
  id, title, authors: [], publisher: 'G. Henle Verlag', cover: null, composer: null, composerSuggestion: null, ebookFile: null, isbn13: null, urls: {}, titleStatus: 'owned', ...fields,
});

beforeEach(() => {
  vi.mocked(bookSectionsService.scores).mockReset().mockResolvedValue([
    score(1, 'Préludes Vol. 1 - piano - (HN 383)', { composer: 'Claude Debussy', ebookFile: 'book_1_x_preludes.pdf' }),
    score(2, 'Bach : suites françaises BWV 812-817', { authors: ['Vladimir Ashkenazy'], composerSuggestion: 'Johann Sebastian Bach' }),
    score(3, 'Improve your sight-reading !', { authors: ['Paul Harris'], publisher: 'Faber' }),
  ]);
  vi.mocked(bookSectionsService.setComposers).mockReset().mockResolvedValue({ changed: 1 });
  vi.mocked(bookSectionsService.addFile).mockReset().mockResolvedValue([]);
});

describe('ScoresPage', () => {
  it('range les partitions par compositeur, les recueils à la fin, avec la référence et l’éditeur', async () => {
    render(page());

    const debussy = (await screen.findByRole('heading', { name: /Claude Debussy/ })).closest('section') as HTMLElement;
    expect(within(debussy).getByText('Préludes Vol. 1')).toBeInTheDocument();
    expect(within(debussy).getByText('HN 383')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings[headings.length - 1]).toMatch(/Anthologies & methods/);
    expect(screen.getByText(/ed\. Vladimir Ashkenazy/)).toBeInTheDocument();
  });

  it('ouvre le PDF dans le lecteur, et propose d’en joindre un à celle qui n’en a pas', async () => {
    render(<MemoryRouter initialEntries={['/scores']}><Routes>
      <Route path="/scores" element={<ScoresPage />} />
      <Route path="/scores/:id/read" element={<Reading />} />
    </Routes></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'PDF' }));
    expect(await screen.findByText('Reading score 1')).toBeInTheDocument();
  });

  it('propose de joindre un PDF à celle qui n’en a pas', async () => {
    render(page());
    await screen.findByRole('button', { name: 'PDF' });

    const bach = screen.getByText('Bach : suites françaises BWV 812-817').closest('.scores-page__score') as HTMLElement;
    fireEvent.click(within(bach).getByRole('button', { name: /attach pdf/i }));
    const file = new File(['%PDF'], 'suites.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('score-pdf-input'), { target: { files: [file] } });
    await waitFor(() => expect(bookSectionsService.addFile).toHaveBeenCalledWith(2, file));
  });

  it('mène à IMSLP par le compositeur et la pièce', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(page());
    const preludes = (await screen.findByText('Préludes Vol. 1')).closest('.scores-page__score') as HTMLElement;

    fireEvent.click(within(preludes).getByRole('button', { name: 'On IMSLP' }));

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/imslp\.org\/index\.php\?search=Claude%20Debussy%20Pr%C3%A9ludes/), '_blank', 'noopener');
  });

  it('propose les compositeurs suggérés, qu’on peut corriger, et les garde', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /review the suggestions/i }));

    const field = screen.getByLabelText('Composer of Bach : suites françaises BWV 812-817');
    expect(field).toHaveValue('Johann Sebastian Bach');
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(bookSectionsService.setComposers).toHaveBeenCalledWith([{ id: 2, composer: 'Johann Sebastian Bach' }]));
  });

  it('filtre par la recherche de l’en-tête : des mots, composer:, publisher:', async () => {
    const { rerender } = render(page({ searchCriteria: { searchText: 'faber' } }));
    expect(await screen.findByText('Improve your sight-reading !')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'composer:debussy' } }));
    expect(screen.getByText('Préludes Vol. 1')).toBeInTheDocument();
    expect(screen.queryByText('Improve your sight-reading !')).not.toBeInTheDocument();
  });

  it('filtre par les filtres du menu : pdf:, heard:, contents:, composer:none', async () => {
    vi.mocked(bookSectionsService.scores).mockResolvedValue([
      score(1, 'Préludes Vol. 1 - piano - (HN 383)', { composer: 'Claude Debussy', ebookFile: 'book_1_x_preludes.pdf', pieceCount: 12, heardCount: 3 }),
      score(2, 'Suites françaises', { composer: 'Johann Sebastian Bach', pieceCount: 6 }),
      score(3, 'Improve your sight-reading !', { publisher: 'Faber' }),
    ]);
    const { rerender } = render(page({ searchCriteria: { searchText: 'pdf:yes' } }));
    expect(await screen.findByText('Préludes Vol. 1')).toBeInTheDocument();
    expect(screen.queryByText('Suites françaises')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'heard:no contents:yes' } }));
    expect(screen.getByText('Suites françaises')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Improve your sight-reading !')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'composer:none' } }));
    expect(screen.getByText('Improve your sight-reading !')).toBeInTheDocument();
    expect(screen.queryByText('Suites françaises')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'composer:"Johann Sebastian Bach"' } }));
    expect(screen.getByText('Suites françaises')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();
  });

  it('exclut avec - ou !, prend les virgules et les anciens mots true/false', async () => {
    vi.mocked(bookSectionsService.scores).mockResolvedValue([
      score(1, 'Préludes Vol. 1 - piano - (HN 383)', { composer: 'Claude Debussy', ebookFile: 'book_1_x_preludes.pdf' }),
      score(2, 'Suites françaises', { composer: 'Johann Sebastian Bach' }),
      score(3, 'Improve your sight-reading !', { publisher: 'Faber' }),
    ]);
    const { rerender } = render(page({ searchCriteria: { searchText: '-composer:debussy' } }));
    expect(await screen.findByText('Suites françaises')).toBeInTheDocument();
    expect(screen.getByText('Improve your sight-reading !')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: '!pdf:yes -composer:none' } }));
    expect(screen.getByText('Suites françaises')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Improve your sight-reading !')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'composer:Bach,Debussy' } }));
    expect(screen.getByText('Suites françaises')).toBeInTheDocument();
    expect(screen.getByText('Préludes Vol. 1')).toBeInTheDocument();
    expect(screen.queryByText('Improve your sight-reading !')).not.toBeInTheDocument();

    rerender(page({ searchCriteria: { searchText: 'pdf:false' } }));
    expect(screen.getByText('Suites françaises')).toBeInTheDocument();
    expect(screen.queryByText('Préludes Vol. 1')).not.toBeInTheDocument();
  });

  it('pose la lettre de chaque compositeur pour l’index sur le côté', async () => {
    render(page());
    const debussy = (await screen.findByRole('heading', { name: /Claude Debussy/ })).closest('section') as HTMLElement;
    expect(debussy).toHaveAttribute('data-first-letter', 'D');
  });
});
