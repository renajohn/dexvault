import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookSheet from './BookSheet';

vi.mock('../services/bookService', () => ({
  default: {
    getImageUrl: vi.fn((path: string | null) => path || null),
    getBooksBySeries: vi.fn(() => Promise.resolve([
      { id: 9, title: 'Parable of the Sower', series: 'Earthseed', seriesNumber: 1 },
      { id: 31, title: 'Parable of the Talents', series: 'Earthseed', seriesNumber: 2, readDate: '2025-03-01', rating: 4.5 },
    ])),
    updateBook: vi.fn(() => Promise.resolve({})),
    downloadEbook: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('../services/bookCommentService', () => ({
  default: {
    getCommentsByBookId: vi.fn(() => Promise.resolve([])),
    createComment: vi.fn(() => Promise.resolve({})),
    updateComment: vi.fn(() => Promise.resolve({})),
    deleteComment: vi.fn(() => Promise.resolve({})),
  },
}));
vi.mock('../services/bookSectionsService', () => ({
  default: {
    readingsOf: vi.fn(() => Promise.resolve([{ id: 1, readDate: '2025-02-07' }])),
    addReading: vi.fn(() => Promise.resolve({ id: 2, readDate: '2026-10-31' })),
    seriesNotes: vi.fn(() => Promise.resolve([])),
    addSeriesNote: vi.fn(),
  },
}));

import bookService from '../services/bookService';
import bookCommentService from '../services/bookCommentService';

const book = (over: Record<string, unknown> = {}) => ({
  id: 9,
  title: 'Parable of the Sower',
  authors: ['Octavia E. Butler'],
  publisher: 'Hachette UK',
  publishedYear: 2014,
  pageCount: 300,
  language: 'en',
  format: 'physical',
  series: 'Earthseed',
  seriesNumber: 1,
  genres: ['Literary', 'Dystopian'],
  rating: 5,
  cover: '/api/images/book/sower.jpg',
  readDate: '2025-02-07',
  description: 'Lauren Olamina records everything she sees of this broken world.',
  titleStatus: 'borrowed',
  bookType: 'book',
  ...over,
});

const sheet = (props: Partial<React.ComponentProps<typeof BookSheet>> = {}) =>
  render(<BookSheet bookId={9} book={book()} onClose={() => undefined} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookSheet', () => {
  it('heads it with the title, the author, the year, the pages and the language', () => {
    const { container } = sheet();
    expect(container.querySelector('.phone-sheet-head__title')).toHaveTextContent('Parable of the Sower');
    expect(screen.getByRole('button', { name: 'Octavia E. Butler' })).toBeInTheDocument();
    expect(screen.getByText('2014 · 300 pages · English')).toBeInTheDocument();
  });

  it('puts the volume and the loan on the cover, where the grid puts them', () => {
    const { container } = sheet();
    const tags = container.querySelector('.book-sheet-cover__tags');
    expect(tags).toHaveTextContent('#1');
    expect(tags).toHaveTextContent('Borrowed');
  });

  it('names its third tab by the copy: Borrowed, Owned or Wished', () => {
    const { unmount } = sheet();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Book', 'Series', 'Borrowed']);
    unmount();
    sheet({ book: book({ titleStatus: 'wish' }) });
    expect(screen.getByRole('tab', { name: 'Wished' })).toBeInTheDocument();
  });

  it('shows the series, opened on this volume', async () => {
    sheet();
    fireEvent.click(screen.getByRole('tab', { name: /Series/ }));
    expect(await screen.findByText('Parable of the Talents')).toBeInTheDocument();
    expect(screen.getByText('this book')).toBeInTheDocument();
    expect(screen.getByText('2 volumes')).toBeInTheDocument();
  });

  it('saves a field of the copy with the whole book, as the server wants it', async () => {
    const onUpdated = vi.fn();
    sheet({ onUpdated });
    fireEvent.click(screen.getByRole('tab', { name: 'Borrowed' }));
    fireEvent.click(screen.getAllByRole('button', { name: /—/ })[0]);
    const field = screen.getByPlaceholderText('Whose is it?');
    fireEvent.change(field, { target: { value: 'Oriane' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(bookService.updateBook).toHaveBeenCalledWith(9, expect.objectContaining({ owner: 'Oriane', title: 'Parable of the Sower', series: 'Earthseed' })));
    expect(onUpdated).toHaveBeenCalled();
  });

  it('writes a review', async () => {
    sheet();
    fireEvent.click(screen.getByText('Write a review…'));
    fireEvent.change(screen.getByLabelText('Who writes it'), { target: { value: 'Renault' } });
    fireEvent.change(screen.getByLabelText('The review'), { target: { value: 'Prescient.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bookCommentService.createComment).toHaveBeenCalledWith({ bookId: 9, name: 'Renault', comment: 'Prescient.' }));
  });

  it('opens the card over it to edit the book', () => {
    const onEdit = vi.fn();
    sheet({ onEdit });
    fireEvent.click(screen.getByRole('tab', { name: 'Borrowed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit…' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('offers the next volumes and the series in the library only where the page can', async () => {
    const { unmount } = sheet();
    fireEvent.click(screen.getByRole('tab', { name: /Series/ }));
    await screen.findByText('Parable of the Talents');
    expect(screen.queryByRole('button', { name: 'Next volumes…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in the library' })).not.toBeInTheDocument();
    unmount();
    sheet({ onNextVolumes: vi.fn(), onShowSeries: vi.fn() });
    fireEvent.click(screen.getByRole('tab', { name: /Series/ }));
    await screen.findByText('Parable of the Talents');
    expect(screen.getByRole('button', { name: 'Next volumes…' })).toBeInTheDocument();
    // The series' volumes are owned (no status): the library shows them.
    expect(screen.getByRole('button', { name: 'Show in the library' })).toBeInTheDocument();
  });

  it('keeps no loan of its own: the days and the note of a loan are no longer kept', () => {
    sheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Borrowed' }));
    expect(screen.queryByText('On')).not.toBeInTheDocument();
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
  });

  it('lists every author when the head cuts them', () => {
    sheet({ book: book({ authors: ['Ann', 'Bea', 'Cid'] }) });
    expect(screen.getByText('Authors')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cid' }).length).toBeGreaterThan(0);
  });

  it('opens on a book the page does not list, before its details are read', () => {
    const { container } = sheet({ book: null });
    expect(container.querySelector('.phone-sheet')).toBeInTheDocument();
  });
});
