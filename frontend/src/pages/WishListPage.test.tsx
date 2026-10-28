import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WishListPage from './WishListPage';
import apiService from '../services/api';
import musicService from '../services/musicService';
import bookService from '../services/bookService';

vi.mock('../services/api', () => ({
  default: { getMoviesByStatus: vi.fn(), setMovieSpokenFor: vi.fn() },
}));
vi.mock('../services/musicService', () => ({
  default: { getAlbumsByStatus: vi.fn(), setAlbumSpokenFor: vi.fn(), getImageUrl: (p: string) => p },
}));
vi.mock('../services/bookService', () => ({
  default: { getBooksByStatus: vi.fn(), setBookSpokenFor: vi.fn(), getImageUrl: (p: string) => p },
}));

beforeEach(() => {
  vi.mocked(apiService.getMoviesByStatus).mockReset().mockResolvedValue([]);
  vi.mocked(musicService.getAlbumsByStatus).mockReset().mockResolvedValue([
    { id: 407, title: 'Back in Black', artist: ['AC/DC'], spokenFor: false },
    { id: 190, title: "L'Homme fleur", artist: ['Blankass'], spokenFor: true },
  ]);
  vi.mocked(bookService.getBooksByStatus).mockReset().mockResolvedValue([]);
  vi.mocked(musicService.setAlbumSpokenFor).mockReset().mockResolvedValue({});
});

const rowOf = async (title: string) => (await screen.findByText(title)).closest('tr') as HTMLElement;

describe('WishListPage, spoken for', () => {
  it('met en retrait un souhait déjà réglé, avec son étiquette', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf("L'Homme fleur");
    expect(row).toHaveClass('spoken-for');
    expect(within(row).getByText('Spoken for')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'No longer spoken for' })).toHaveAttribute('aria-pressed', 'true');
    expect(await rowOf('Back in Black')).not.toHaveClass('spoken-for');
  });

  it('range les boutons : Ricardo, Spoken for, $, Share, puis la corbeille', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    expect(within(row).getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Search on Ricardo', 'Mark as spoken for', 'I bought the CD', 'Share', 'Delete album']);
  });

  it('bascule d’un clic, sans ouvrir la fiche', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as spoken for' }));
    expect(musicService.setAlbumSpokenFor).toHaveBeenCalledWith(407, true);
    await waitFor(() => expect(row).toHaveClass('spoken-for'));
  });

  it('revient en arrière quand l’enregistrement échoue', async () => {
    vi.mocked(musicService.setAlbumSpokenFor).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as spoken for' }));
    await waitFor(() => expect(row).not.toHaveClass('spoken-for'));
    expect(await screen.findByText(/Failed to mark album as spoken for/)).toBeInTheDocument();
  });
});

describe('WishListPage, Share', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('copie la référence quand le système ne partage pas, sans ouvrir la fiche', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    fireEvent.click(within(row).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Back in Black by AC/DC (Unknown) in CD'));
  });

  it('ouvre la feuille de partage du système quand elle existe', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share });
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    fireEvent.click(within(await rowOf('Back in Black')).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ text: 'Back in Black by AC/DC (Unknown) in CD' }));
  });
});

describe('WishListPage sur un téléphone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 575px'), addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ne garde sur la ligne que Ricardo, le reste sous la ligne glissée à gauche', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    expect(within(row.querySelector('.wl-actions') as HTMLElement).getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Search on Ricardo']);
    expect(within(row.querySelector('.swipe-row__under--actions') as HTMLElement).getAllByRole('button').map(b => b.textContent))
      .toEqual(['Share', 'Bought', 'Delete']);
  });

  it('marque spoken for d’un glissé à droite, sans ouvrir la fiche', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    fireEvent.touchStart(row, { touches: [{ clientX: 40, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 80, clientY: 102 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 103 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 190, clientY: 104 }] });
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(musicService.setAlbumSpokenFor).toHaveBeenCalledWith(407, true);
    await waitFor(() => expect(row).toHaveClass('spoken-for'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('laisse défiler la liste quand le doigt va de haut en bas', async () => {
    render(<MemoryRouter><WishListPage /></MemoryRouter>);
    const row = await rowOf('Back in Black');
    fireEvent.touchStart(row, { touches: [{ clientX: 40, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 160 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 160, clientY: 220 }] });
    fireEvent.touchEnd(row);
    expect(musicService.setAlbumSpokenFor).not.toHaveBeenCalled();
  });
});
