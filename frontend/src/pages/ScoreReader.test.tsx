import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ScoreReader, { pieceAt, spreadOf, turned } from './ScoreReader';
import bookSectionsService from '../services/bookSectionsService';
import scorePiecesService, { type ScorePiece } from '../services/scorePiecesService';
import bookService from '../services/bookService';
import { openPdf } from '../utils/pdf';
import { play } from '../utils/playPiece';

vi.mock('../utils/pdf', () => ({ openPdf: vi.fn() }));
vi.mock('../services/bookSectionsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/bookSectionsService')>()),
  default: { files: vi.fn(), bookmarks: vi.fn() },
}));
vi.mock('../services/scorePiecesService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/scorePiecesService')>()),
  default: { pieces: vi.fn() },
}));
vi.mock('../services/bookService', () => ({ default: { getBookById: vi.fn() } }));
vi.mock('../utils/playPiece', async importOriginal => ({ ...(await importOriginal<typeof import('../utils/playPiece')>()), play: vi.fn() }));

const rec = (albumId: number, no: number) => ({ trackId: no, albumId, disc: 1, no, title: `Track ${no}`, durationSec: 200 });
const livre: ScorePiece = {
  id: 1, workId: 'w', title: 'Préludes, Livre I', imslp: null, single: false, choices: [], whole: [], preferredAlbumId: 177,
  albums: [{ albumId: 177, title: 'Préludes', artist: [], performers: ['Schmid-Gagnebin'], year: 2000, cover: null, rating: null, titleStatus: 'owned', covered: 2 }],
  parts: [
    { workId: 'w1', title: 'Danseuses', name: 'Danseuses de Delphes', sub: null, imslp: null, recordings: [rec(177, 1)] },
    { workId: 'w2', title: 'Voiles', name: 'Voiles', sub: null, imslp: null, recordings: [rec(177, 2)] },
  ],
};
const Where = () => <p data-testid="where">{useLocation().pathname}{useLocation().search}</p>;
const reader = (url = '/scores/219/read') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/scores/:id/read" element={<ScoreReader />} />
      <Route path="/scores" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const size = (width: number, height: number) => { Object.assign(window, { innerWidth: width, innerHeight: height }); window.dispatchEvent(new Event('resize')); };

describe('tourner les pages', () => {
  it('montre une page, ou deux côte à côte, sans dépasser la dernière', () => {
    expect(spreadOf(3, 10, false)).toEqual([3]);
    expect(spreadOf(3, 10, true)).toEqual([3, 4]);
    expect(spreadOf(10, 10, true)).toEqual([10]);
    expect(turned(3, 1, 10, true)).toBe(5);
    expect(turned(9, 1, 10, true)).toBe(9);
    expect(turned(10, 1, 10, false)).toBe(10);
    expect(turned(2, -1, 10, true)).toBe(1);
  });

  it('sait la pièce d’une page, la dernière commencée', () => {
    const marks = [{ pieceId: 1, partWorkId: 'w1', startPage: 3, endPage: 5 }, { pieceId: 1, partWorkId: 'w2', startPage: 5, endPage: 8 }];
    expect(pieceAt(4, marks)?.partWorkId).toBe('w1');
    expect(pieceAt(5, marks)?.partWorkId).toBe('w2');
    expect(pieceAt(9, marks)).toBeNull();
  });
});

describe('ScoreReader', () => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); }, clear: () => kept.clear(),
  });
  const draw = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    localStorage.clear();
    size(800, 1100);
    draw.mockClear();
    vi.mocked(openPdf).mockReset().mockResolvedValue({ pageCount: 10, draw, sizeOf: vi.fn().mockResolvedValue({ width: 600, height: 800 }), outline: vi.fn(), close: vi.fn() });
    vi.mocked(bookSectionsService.files).mockReset().mockResolvedValue([
      { id: 5, bookId: 219, filename: 'a.pdf', label: 'Durand', source: 'imslp', isDefault: true, size: 1, pageCount: 10, createdAt: '' },
    ]);
    vi.mocked(bookSectionsService.bookmarks).mockReset().mockResolvedValue([
      { pieceId: 1, partWorkId: 'w1', startPage: 3, endPage: 5 }, { pieceId: 1, partWorkId: 'w2', startPage: 6, endPage: 8 },
    ]);
    vi.mocked(scorePiecesService.pieces).mockReset().mockResolvedValue([livre]);
    vi.mocked(bookService.getBookById).mockReset().mockResolvedValue({ title: 'Préludes Vol. 1 - piano - (HN 383)' });
    vi.mocked(play).mockReset();
  });
  afterEach(() => size(1024, 768));

  const pages = () => [...document.querySelectorAll('.score-reader__page')].map(page => Number((page as HTMLElement).dataset.page));

  it('s’ouvre à la page demandée, dit la pièce, tourne aux flèches et au toucher, et retient la page', async () => {
    reader('/scores/219/read?page=4');
    await waitFor(() => expect(pages()).toEqual([4]));
    expect(screen.getByText('Préludes Vol. 1')).toBeInTheDocument();
    expect(screen.getByText('Danseuses de Delphes')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'PageDown' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(pages()).toEqual([6]);
    expect(screen.getByText('Voiles')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.score-reader__spread')!, { clientX: 50 });
    expect(pages()).toEqual([5]);
    expect(localStorage.getItem('dv.reader.page.5')).toBe('5');

    // A touch in the middle hides the bar, another shows it.
    fireEvent.click(document.querySelector('.score-reader__spread')!, { clientX: 400 });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.score-reader__spread')!, { clientX: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/scores?score=219');
  });

  it('montre deux pages côte à côte sur un écran couché, une seule si on le demande', async () => {
    size(1200, 800);
    localStorage.setItem('dv.reader.page.5', '3');
    reader();
    await waitFor(() => expect(pages()).toEqual([3, 4]));
    fireEvent.keyDown(window, { key: ' ' });
    expect(pages()).toEqual([5, 6]);
    fireEvent.click(screen.getByRole('button', { name: 'One page at a time' }));
    expect(pages()).toEqual([5]);
    expect(localStorage.getItem('dv.reader.layout')).toBe('one');
  });

  it('va à une pièce et joue son enregistrement', async () => {
    reader();
    await waitFor(() => expect(pages()).toEqual([1]));
    expect(screen.getByRole('button', { name: 'Not in your music' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Go to a piece' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Voiles/ }));
    expect(pages()).toEqual([6]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play Voiles' })); });
    expect(play).toHaveBeenCalledWith([expect.objectContaining({ albumId: 177, no: 2 })]);
  });

  it('dit quand la partition n’a pas de PDF', async () => {
    vi.mocked(bookSectionsService.files).mockResolvedValue([]);
    reader();
    expect(await screen.findByText('This score has no PDF yet.')).toBeInTheDocument();
  });
});
