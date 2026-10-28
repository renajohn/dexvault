import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingJournal from './ReadingJournal';
import SeriesNotes from './SeriesNotes';
import bookSectionsService, { ReadingEntry } from '../services/bookSectionsService';
import bookCommentService from '../services/bookCommentService';

vi.mock('../services/bookSectionsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/bookSectionsService')>()),
  default: { reading: vi.fn(), addReading: vi.fn(), changeReading: vi.fn(), removeReading: vi.fn(), seriesNotes: vi.fn(), addSeriesNote: vi.fn(), deleteSeriesNote: vi.fn() },
}));
vi.mock('../services/bookCommentService', () => ({ default: { createComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn() } }));
vi.mock('../services/bookService', () => ({ default: { getImageUrl: (p: string | null) => p, getBookById: vi.fn(), updateBook: vi.fn(), deleteBook: vi.fn(), addBook: vi.fn() } }));

const entry = (id: number, title: string, fields: Partial<ReadingEntry> = {}): ReadingEntry => ({
  id, title, authors: ['Laurent Gaudé'], cover: null, publishedYear: 2022, readDate: '2025-12-10', rating: 3.5, titleStatus: 'owned', owner: 'Renault', readingId: id * 10, readNumber: 1, readCount: 1, readDates: ['2025-12-10'], comments: [], ...fields,
});

beforeEach(() => {
  vi.mocked(bookSectionsService.reading).mockReset().mockResolvedValue([
    entry(1, '1984', { readDate: '2026-04-26', authors: ['George Orwell'] }),
    entry(2, 'Chien 51', { titleStatus: 'borrowed', owner: 'Léa', comments: [{ id: 9, name: 'Renault', comment: 'Un monde pas si éloigné', date: '2025-12-11' }] }),
  ]);
  vi.mocked(bookCommentService.createComment).mockReset().mockResolvedValue({});
});

describe('ReadingJournal', () => {
  it('montre les lectures par année, à soi ou empruntées et à qui, avec les commentaires', async () => {
    render(<ReadingJournal />);

    const y2025 = (await screen.findByRole('heading', { name: /2025/ })).closest('section') as HTMLElement;
    expect(screen.getByRole('heading', { name: /2026/ })).toBeInTheDocument();
    expect(within(y2025).getByText('Borrowed · Léa')).toBeInTheDocument();
    expect(within(y2025).getByText('Un monde pas si éloigné')).toBeInTheDocument();
  });

  it('filtre par la recherche de l’en-tête, et compte ce qu’il montre', async () => {
    render(<ReadingJournal searchCriteria={{ searchText: 'orwell' }} />);
    expect(await screen.findByText('1984')).toBeInTheDocument();
    expect(screen.queryByText('Chien 51')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 readings/)).toBeInTheDocument();
  });

  it('garde ce qu’on écrit sur une lecture', async () => {
    render(<ReadingJournal />);
    fireEvent.click(await screen.findByRole('button', { name: 'Write what you thought' }));

    fireEvent.change(screen.getByLabelText('Your words on 1984'), { target: { value: 'Glaçant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(bookCommentService.createComment).toHaveBeenCalledWith(expect.objectContaining({ bookId: 1, comment: 'Glaçant' })));
  });

  it('réécrit un commentaire d’avant', async () => {
    vi.mocked(bookCommentService.updateComment).mockResolvedValue({});
    render(<ReadingJournal />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit these words' }));

    const field = screen.getByLabelText('Rewrite your words on Chien 51');
    expect(field).toHaveValue('Un monde pas si éloigné');
    fireEvent.change(field, { target: { value: 'Un monde tout proche' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(bookCommentService.updateComment).toHaveBeenCalledWith(9, { comment: 'Un monde tout proche' }));
  });

  it('montre un livre relu à chacune de ses lectures, et le relit encore', async () => {
    vi.mocked(bookSectionsService.reading).mockResolvedValue([
      entry(1, '1984', { readDate: '2026-04-26', readingId: 11, readNumber: 2, readCount: 2, readDates: ['2019-03-12', '2026-04-26'] }),
      entry(1, '1984', { readDate: '2019-03-12', readingId: 10, readNumber: 1, readCount: 2, readDates: ['2019-03-12', '2026-04-26'] }),
    ]);
    vi.mocked(bookSectionsService.addReading).mockResolvedValue({ id: 12, bookId: 1, readDate: '2026-10-21' });
    render(<ReadingJournal />);

    const y2019 = (await screen.findByRole('heading', { name: /2019/ })).closest('section') as HTMLElement;
    expect(within(y2019).getByText('read again in 2026')).toBeInTheDocument();
    expect(within(y2019).queryByRole('button', { name: 'Read again' })).not.toBeInTheDocument();
    // A word still goes on the first reading, and stays with it.
    fireEvent.click(within(y2019).getByRole('button', { name: 'Write what you thought' }));
    fireEvent.change(within(y2019).getByLabelText('Your words on 1984'), { target: { value: 'Glaçant' } });
    fireEvent.click(within(y2019).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(bookCommentService.createComment).toHaveBeenCalledWith(expect.objectContaining({ bookId: 1, readingId: 10, comment: 'Glaçant' })));

    const y2026 = screen.getByRole('heading', { name: /2026/ }).closest('section') as HTMLElement;
    expect(within(y2026).getByText('2nd reading')).toBeInTheDocument();

    fireEvent.click(within(y2026).getByRole('button', { name: 'Read again' }));
    fireEvent.change(screen.getByLabelText('When you read 1984 again'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Your words on this reading of 1984'), { target: { value: 'Plus glaçant encore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(bookSectionsService.addReading).toHaveBeenCalledWith(1, '2026-10-01'));
    await waitFor(() => expect(bookCommentService.createComment).toHaveBeenCalledWith(expect.objectContaining({ bookId: 1, readingId: 12, comment: 'Plus glaçant encore' })));
  });

  it('corrige la date d’une lecture', async () => {
    vi.mocked(bookSectionsService.changeReading).mockResolvedValue({ id: 10, bookId: 1, readDate: '2026-04-20' });
    render(<ReadingJournal />);
    fireEvent.click(await screen.findByRole('button', { name: /read 26 avril/ }));
    fireEvent.change(screen.getByLabelText('When you read 1984'), { target: { value: '2026-04-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(bookSectionsService.changeReading).toHaveBeenCalledWith(10, '2026-04-20'));
  });
});

describe('SeriesNotes', () => {
  it('montre les notes d’une série, en ajoute une avec qui la dit, et l’efface', async () => {
    vi.mocked(bookSectionsService.seriesNotes).mockResolvedValue([{ id: 1, series: 'Sorceline', name: 'Oriane', note: 'Oriane a adoré cette série', createdAt: '2026-10-21T08:00:00Z' }]);
    vi.mocked(bookSectionsService.addSeriesNote).mockResolvedValue({ id: 2, series: 'Sorceline', name: 'Alice', note: 'Alice aussi', createdAt: '2026-10-21T09:00:00Z' });
    vi.mocked(bookSectionsService.deleteSeriesNote).mockResolvedValue();
    render(<SeriesNotes series="Sorceline" />);

    expect(await screen.findByText('Oriane a adoré cette série')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('A note on the series'), { target: { value: 'Alice aussi' } });
    fireEvent.change(screen.getByLabelText('Who says it'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Alice aussi')).toBeInTheDocument();
    expect(bookSectionsService.addSeriesNote).toHaveBeenCalledWith('Sorceline', 'Alice aussi', 'Alice');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove the note' })[0]);
    await waitFor(() => expect(screen.queryByText('Oriane a adoré cette série')).not.toBeInTheDocument());
  });
});

describe('ReadingJournal sur un téléphone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 575px'), addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pose le choix de la vue au-dessus, puis le compte et + sur une ligne, sans tri', async () => {
    const { container } = render(<ReadingJournal viewSwitch={<span>Library | Reading</span>} />);
    expect(await screen.findByText('2 readings')).toBeInTheDocument();
    expect(container.querySelector('.collection-header__leading')).toHaveTextContent('Library | Reading');
    expect(screen.getByRole('button', { name: 'Add a reading' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull();
  });
});
