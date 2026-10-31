import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScoreBookmarks, { endsOf, rowsOf } from './ScoreBookmarks';
import bookSectionsService, { type ScoreFile } from '../services/bookSectionsService';
import type { ScorePiece } from '../services/scorePiecesService';
import { openPdf } from '../utils/pdf';

vi.mock('../utils/pdf', () => ({ openPdf: vi.fn() }));
vi.mock('../services/bookSectionsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/bookSectionsService')>()),
  default: { bookmarks: vi.fn(), keepBookmarks: vi.fn() },
}));

const part = (workId: string, name: string) => ({ workId, title: name, name, sub: null, imslp: null, recordings: [] });
const piece = (id: number, title: string, fields: Partial<ScorePiece> = {}): ScorePiece => ({
  id, workId: `w${id}`, title, imslp: null, single: true, parts: [], choices: [], whole: [], albums: [], preferredAlbumId: null, ...fields,
});
const livre = piece(1, 'Préludes, Livre I', { single: false, parts: [part('danseuses', 'Danseuses de Delphes'), part('voiles', 'Voiles'), part('vent', 'Le vent dans la plaine')] });
const clair = piece(2, 'Clair de lune');
const file: ScoreFile = { id: 7, bookId: 219, filename: 'x.pdf', label: 'Durand, 1910', source: 'imslp', isDefault: true, size: 1, pageCount: null, createdAt: '' };

describe('les pages de chaque pièce', () => {
  it('fait une ligne par partie d’un recueil, une pour une pièce d’un mouvement', () => {
    expect(rowsOf([livre, clair]).map(row => [row.key, row.name, row.group])).toEqual([
      ['1:danseuses', 'Danseuses de Delphes', 'Préludes, Livre I'], ['1:voiles', 'Voiles', 'Préludes, Livre I'],
      ['1:vent', 'Le vent dans la plaine', 'Préludes, Livre I'], ['2:', 'Clair de lune', null],
    ]);
  });

  it('finit une pièce avant la suivante, sur sa première page quand la suivante y commence, à la dernière du PDF pour la dernière', () => {
    const rows = rowsOf([livre, clair]);
    expect(endsOf(rows, { '1:danseuses': { start: 3, end: null }, '1:voiles': { start: 6, end: null }, '1:vent': { start: 6, end: 8 }, '2:': { start: 12, end: null } }, 20))
      .toEqual({ '1:danseuses': 5, '1:voiles': 6, '1:vent': 8, '2:': 20 });
    expect(endsOf(rows, { '1:danseuses': { start: 3, end: null }, '1:voiles': { start: 3, end: null } }, 9)).toEqual({ '1:danseuses': 3, '1:voiles': 9 });
  });
});

describe('ScoreBookmarks', () => {
  beforeEach(() => {
    vi.mocked(openPdf).mockReset().mockResolvedValue({
      pageCount: 12, draw: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
      outline: vi.fn().mockResolvedValue([{ title: 'Danseuses', page: 2 }, { title: 'Voiles', page: 4 }]),
    });
    vi.mocked(bookSectionsService.bookmarks).mockReset().mockResolvedValue([{ pieceId: 2, partWorkId: null, startPage: 10, endPage: 12 }]);
    vi.mocked(bookSectionsService.keepBookmarks).mockReset().mockImplementation(async (_s, _f, list) => list);
  });

  it('marque une pièce en touchant sa première page, passe à la suivante, et garde leurs pages', async () => {
    const onSaved = vi.fn();
    render(<ScoreBookmarks scoreId={219} file={file} pieces={[livre, clair]} onClose={vi.fn()} onSaved={onSaved} />);
    const danseuses = (await screen.findByText('Danseuses de Delphes')).closest('li') as HTMLElement;
    expect(danseuses).toHaveClass('score-bookmarks__row--selected');
    expect(screen.getByLabelText('First page of Clair de lune')).toHaveValue('10');

    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(screen.getByLabelText('First page of Danseuses de Delphes')).toHaveValue('1');
    expect((screen.getByText('Voiles').closest('li') as HTMLElement)).toHaveClass('score-bookmarks__row--selected');
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Page 5', }), { shiftKey: true });
    expect(screen.getByLabelText('Last page of Le vent dans la plaine')).toHaveValue('5');
    fireEvent.click(screen.getByText('Le vent dans la plaine'));
    fireEvent.click(screen.getByRole('button', { name: 'Page 5' }));
    expect(screen.getByLabelText('Last page of Voiles')).toHaveAttribute('placeholder', '4');
    expect(screen.getByText('4 of 4 marked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep the pages' }));
    await waitFor(() => expect(bookSectionsService.keepBookmarks).toHaveBeenCalledWith(219, 7, [
      { pieceId: 1, partWorkId: 'danseuses', startPage: 1, endPage: 2 },
      { pieceId: 1, partWorkId: 'voiles', startPage: 3, endPage: 4 },
      { pieceId: 1, partWorkId: 'vent', startPage: 5, endPage: 9 },
      { pieceId: 2, partWorkId: null, startPage: 10, endPage: 12 },
    ], 12));
    expect(onSaved).toHaveBeenCalled();
  });

  it('refuse une dernière page avant la première', async () => {
    render(<ScoreBookmarks scoreId={219} file={file} pieces={[livre, clair]} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('First page of Clair de lune'));
    expect(screen.getByLabelText('First page of Clair de lune').closest('li')).toHaveClass('score-bookmarks__row--selected');
    // It begins on page 10, kept 10–12: page 8 cannot be its last.
    fireEvent.click(screen.getByRole('button', { name: 'Page 8' }), { shiftKey: true });
    expect(screen.getByLabelText('Last page of Clair de lune')).toHaveValue('12');
    fireEvent.change(screen.getByLabelText('Last page of Clair de lune'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the pages' }));
    expect(bookSectionsService.keepBookmarks).not.toHaveBeenCalled();
  });

  it('prend les signets du PDF lui-même, dans l’ordre', async () => {
    render(<ScoreBookmarks scoreId={219} file={file} pieces={[livre, clair]} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Take the PDF’s own 2 bookmarks/ }));
    expect(screen.getByLabelText('First page of Danseuses de Delphes')).toHaveValue('2');
    expect(screen.getByLabelText('First page of Voiles')).toHaveValue('4');
    expect(screen.getByLabelText('First page of Le vent dans la plaine')).toHaveValue('');
    expect(within(screen.getByRole('button', { name: 'Page 4' })).getByText('Voiles')).toBeInTheDocument();
  });
});
