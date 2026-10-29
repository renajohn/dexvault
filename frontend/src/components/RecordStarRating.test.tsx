import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlbumStarRating, BookStarRating, resetStarSpreads, shareOf } from './RecordStarRating';
import bookService from '../services/bookService';
import musicService from '../services/musicService';

vi.mock('../services/musicService', async original => ({
  ...(await original<typeof import('../services/musicService')>()),
  default: { getRatingCounts: vi.fn(async () => [{ stars: 3, count: 6 }, { stars: 4, count: 3 }, { stars: 5, count: 1 }]) },
}));

/** A finger on the stars, at height `y`. */
const finger = (element: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', y: number) =>
  fireEvent(element, Object.assign(new Event(type, { bubbles: true }), { pointerType: 'touch', pointerId: 1, clientY: y, clientX: 0 }));

vi.mock('../services/bookService', () => ({
  default: { getRatingCounts: vi.fn(async () => [{ stars: 3, count: 1 }, { stars: 2.5, count: 3 }]) },
}));

beforeEach(() => resetStarSpreads());

describe('AlbumStarRating and BookStarRating', () => {
  it('says where a number of stars stands among the albums rated', () => {
    const spread = new Map([[3, 6], [4, 3], [5, 1]]);
    expect(shareOf(4, spread)).toBe('30 % of your rated albums');
    expect(shareOf(2, spread)).toBe('0 % of your rated albums');
    expect(shareOf(0, spread)).toBeNull();
    expect(shareOf(4, null)).toBeNull();
  });

  it('says on its dial what the stars mean and how many albums hold as many', async () => {
    render(<AlbumStarRating value={3} onChange={() => undefined} />);
    await waitFor(() => expect(musicService.getRatingCounts).toHaveBeenCalled());
    const stars = screen.getByRole('group');

    finger(stars, 'pointerdown', 300);
    finger(stars, 'pointermove', 260);
    expect(document.querySelector('.ui-star-dial__words')).toHaveTextContent('Love it');
    await waitFor(() => expect(document.querySelector('.ui-star-dial__hint')).toHaveTextContent('30 % of your rated albums'));
    finger(stars, 'pointerup', 260);
  });

  it('says the 3 of an album of no stars in grey, how to move under it', () => {
    render(<AlbumStarRating value={null} onChange={() => undefined} />);
    finger(screen.getByRole('group'), 'pointerdown', 300);
    expect(document.querySelector('.ui-star-dial__words')).toHaveTextContent('Glad I have it');
    expect(document.querySelector('.ui-star-dial__words')).toHaveClass('ui-star-dial__words--seed');
    expect(document.querySelector('.ui-star-dial__hint')).toHaveTextContent('Slide up or down');
  });

  it('says a book’s stars in a reading’s words, and how many books hold as many', async () => {
    render(<BookStarRating value={2.5} onChange={() => undefined} />);
    await waitFor(() => expect(bookService.getRatingCounts).toHaveBeenCalled());
    finger(screen.getByRole('group'), 'pointerdown', 300);
    finger(screen.getByRole('group'), 'pointermove', 280);
    expect(document.querySelector('.ui-star-dial__words')).toHaveTextContent('Glad I read it');
    await waitFor(() => expect(document.querySelector('.ui-star-dial__hint')).toHaveTextContent('25 % of your rated books'));
  });
});
