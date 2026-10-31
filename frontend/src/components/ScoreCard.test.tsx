import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScoreCard from './ScoreCard';
import scorePiecesService, { ScorePiece } from '../services/scorePiecesService';
import { player } from '../services/player';
import { loadPlayable } from '../utils/playAlbum';
import bookSectionsService, { type ImslpEdition, type Score, type ScoreFile } from '../services/bookSectionsService';
import bookService from '../services/bookService';
import bookCommentService from '../services/bookCommentService';
import { confirm } from './shared/ConfirmDialog';

vi.mock('../services/scorePiecesService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/scorePiecesService')>()),
  default: { pieces: vi.fn(), addPieces: vi.fn(), removePiece: vi.fn(), keepParts: vi.fn(), choose: vi.fn(), suggestions: vi.fn(), search: vi.fn(), contentsPhoto: vi.fn(), imslpPage: vi.fn(), henle: vi.fn(), lookup: vi.fn(), create: vi.fn() },
}));
vi.mock('../services/bookSectionsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/bookSectionsService')>()),
  default: { files: vi.fn(), changeFile: vi.fn(), removeFile: vi.fn(), addFile: vi.fn(), imslpEditions: vi.fn(), bookmarks: vi.fn() },
}));
vi.mock('../utils/playAlbum', () => ({ loadPlayable: vi.fn() }));
vi.mock('../services/bookService', () => ({ default: { getImageUrl: (p: string | null) => p, getBookById: vi.fn(), updateBook: vi.fn(), deleteBook: vi.fn() } }));
vi.mock('../services/bookCommentService', () => ({ default: { getCommentsByBookId: vi.fn(), createComment: vi.fn(), deleteComment: vi.fn() } }));
vi.mock('../components/shared/ConfirmDialog', async importOriginal => ({ ...(await importOriginal<typeof import('./shared/ConfirmDialog')>()), confirm: vi.fn() }));

const score: Score = {
  id: 219, title: 'Préludes Vol. 1 - piano - (HN 383)', authors: [], publisher: 'G. Henle Verlag', cover: null, composer: 'Claude Debussy',
  composerSuggestion: null, ebookFile: null, isbn13: null, urls: {}, titleStatus: 'owned',
};
const rec = (albumId: number, no: number, durationSec = 150) => ({ trackId: albumId * 100 + no, albumId, disc: 1, no, title: `Track ${no}`, durationSec });
const album = (albumId: number, performers: string[], covered: number, year = 2003) => ({
  albumId, title: `Album ${albumId}`, artist: [], performers, year, cover: null, rating: null, titleStatus: 'owned', covered,
});
const livre: ScorePiece = {
  id: 1, workId: 'w-livre', imslp: null, title: 'Préludes, Livre I, L. 117, CD 125', single: false, whole: [], preferredAlbumId: 177,
  parts: [
    { workId: 'w1', title: '…: I. Danseuses de Delphes', name: 'Danseuses de Delphes', sub: 'Lent et grave', imslp: 'Danseuses_de_Delphes_(Debussy)', recordings: [rec(177, 1, 149), rec(903, 1, 160)] },
    { workId: 'w2', title: '…: II. Voiles', name: 'Voiles', sub: 'Modéré', imslp: null, recordings: [rec(177, 2, 176)] },
    { workId: 'w3', title: '…: III. Le vent dans la plaine', name: 'Le vent dans la plaine', sub: 'Animé', imslp: null, recordings: [] },
  ],
  albums: [album(177, ['Ruth Schmid-Gagnebin'], 2), album(903, ['Krystian Zimerman'], 1, 1994)],
  choices: [],
};
livre.choices = livre.parts.map(part => ({ workId: part.workId, name: part.name, sub: part.sub, kept: true }));
const clair: ScorePiece = { id: 2, workId: 'w-clair', imslp: null, title: 'Clair de lune', single: true, parts: [], choices: [], whole: [], albums: [], preferredAlbumId: null };

const card = (props: Partial<React.ComponentProps<typeof ScoreCard>> = {}) => render(<ScoreCard score={score} onClose={vi.fn()} onAttach={vi.fn()} onChanged={vi.fn()} {...props} />);

beforeEach(() => {
  vi.mocked(scorePiecesService.pieces).mockReset().mockResolvedValue([livre, clair]);
  vi.mocked(scorePiecesService.choose).mockReset().mockResolvedValue();
  vi.mocked(scorePiecesService.imslpPage).mockReset().mockResolvedValue({ page: 'Préludes, Livre 1, CD 125 (Debussy, Claude)' });
  vi.mocked(loadPlayable).mockReset().mockResolvedValue({
    album: { id: 177, title: '24 Préludes', artist: 'Ruth Schmid-Gagnebin', cover: null },
    tracks: [1, 2, 3].map(no => ({ songId: `s${no}`, title: `Track ${no}`, disc: 1, no, durationSec: 150 })),
  });
  vi.spyOn(player, 'playAlbum').mockImplementation(() => undefined);
  vi.mocked(scorePiecesService.henle).mockReset().mockResolvedValue({ url: 'https://www.henle.de/Preludes-Premier-livre/HN-383', level: 7 });
  vi.mocked(bookService.getBookById).mockReset().mockResolvedValue({
    id: 219, title: 'Préludes Vol. 1 - piano - (HN 383)', composer: 'Claude Debussy', publisher: 'G. Henle Verlag', isbn13: '9790201803838',
    priceChf: 24.5, purchasedAt: '2025-11-30', titleStatus: 'owned', owner: null, bookType: 'score', authors: [],
  });
  vi.mocked(bookService.updateBook).mockReset().mockResolvedValue({});
  vi.mocked(bookService.deleteBook).mockReset().mockResolvedValue({});
  vi.mocked(bookCommentService.getCommentsByBookId).mockReset().mockResolvedValue([{ id: 1, name: 'Renault', comment: 'Voiles d’abord', date: '2025-12-02' }]);
  vi.mocked(bookCommentService.createComment).mockReset().mockResolvedValue({});
});

const pdf = (id: number, label: string, isDefault = false): ScoreFile => ({ id, bookId: 219, filename: `score_219_${id}.pdf`, label, source: 'upload', isDefault, size: 2.5 * 1024 * 1024, pageCount: null, createdAt: '2026-10-31' });

describe('ScoreCard, ses PDF', () => {
  it('en montre plusieurs : le premier sous PDF, les autres sous ▾, chacun renommé, choisi ou effacé', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const durand = pdf(1, 'IMSLP Durand 1910', true);
    const henle = pdf(2, 'Mon Henle annoté');
    vi.mocked(bookSectionsService.files).mockReset().mockResolvedValue([durand, henle]);
    vi.mocked(bookSectionsService.changeFile).mockReset().mockResolvedValue([{ ...henle, label: 'Mon exemplaire', isDefault: true }, { ...durand, isDefault: false }]);
    vi.mocked(bookSectionsService.removeFile).mockReset().mockResolvedValue([{ ...durand, isDefault: true }]);
    vi.mocked(bookSectionsService.bookmarks).mockReset().mockResolvedValue([{ pieceId: 1, partWorkId: 'w2', startPage: 7, endPage: 9 }]);
    vi.mocked(confirm).mockResolvedValue(true);
    const onChanged = vi.fn();
    card({ score: { ...score, ebookFile: durand.filename, fileCount: 2 }, onChanged });

    const list = (await screen.findByRole('heading', { name: 'Its PDFs' })).closest('section') as HTMLElement;
    expect(within(list).getByText('Opens first')).toBeInTheDocument();

    // A piece marked in the PDF that opens first opens it at its page.
    const voiles = (await screen.findByText('Voiles')).closest('.score-piece__row') as HTMLElement;
    fireEvent.click(await within(voiles).findByRole('button', { name: 'p. 7' }));
    expect(open).toHaveBeenCalledWith('/api/scores/219/files/1/pdf#page=7', '_blank', 'noopener');
    fireEvent.click(within(voiles).getByRole('button', { name: 'Print Voiles' }));
    expect(open).toHaveBeenCalledWith(`/api/scores/219/print?pieces=1%3Aw2&file=1&name=${encodeURIComponent('Préludes Vol. 1 – Voiles').replace(/%20/g, '+')}`, '_blank', 'noopener');
    // One piece marked: nothing to choose among.
    expect(screen.queryByRole('button', { name: /Print several/ })).not.toBeInTheDocument();
    expect(within(list).getAllByText('2.5 MB')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Its other PDFs' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mon Henle annoté/ }));
    expect(open).toHaveBeenCalledWith('/api/scores/219/files/2/pdf', '_blank', 'noopener');

    fireEvent.click(within(list).getByRole('button', { name: 'More for Mon Henle annoté' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const name = within(list).getByRole('textbox', { name: 'Its name' });
    fireEvent.change(name, { target: { value: 'Mon exemplaire' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(bookSectionsService.changeFile).toHaveBeenCalledWith(219, 2, { label: 'Mon exemplaire' }));
    expect(await within(list).findByText('Mon exemplaire')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(within(list).getByRole('button', { name: 'More for IMSLP Durand 1910' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete the PDF' }));
    await waitFor(() => expect(bookSectionsService.removeFile).toHaveBeenCalledWith(219, 1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
  });

  it('ouvre le lecteur à la page d’une pièce, en disant laquelle', async () => {
    vi.mocked(bookSectionsService.files).mockReset().mockResolvedValue([pdf(1, 'Durand', true)]);
    vi.mocked(bookSectionsService.bookmarks).mockReset().mockResolvedValue([{ pieceId: 1, partWorkId: 'w2', startPage: 7, endPage: 9 }]);
    const onRead = vi.fn();
    card({ score: { ...score, ebookFile: 'score_219_1.pdf', fileCount: 1 }, onRead });
    const voiles = (await screen.findByText('Voiles')).closest('.score-piece__row') as HTMLElement;
    fireEvent.click(await within(voiles).findByRole('button', { name: 'p. 7' }));
    expect(onRead).toHaveBeenCalledWith(219, 1, 7, '1:w2');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(onRead).toHaveBeenLastCalledWith(219);
  });

  it('imprime plusieurs pièces marquées, choisies parmi elles', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(bookSectionsService.files).mockReset().mockResolvedValue([pdf(1, 'Durand', true)]);
    vi.mocked(bookSectionsService.bookmarks).mockReset().mockResolvedValue([
      { pieceId: 1, partWorkId: 'w1', startPage: 3, endPage: 5 }, { pieceId: 1, partWorkId: 'w2', startPage: 6, endPage: 9 }, { pieceId: 2, partWorkId: null, startPage: 40, endPage: 44 },
    ]);
    card({ score: { ...score, ebookFile: 'score_219_1.pdf', fileCount: 1 } });
    fireEvent.click(await screen.findByRole('button', { name: /Print several/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Print several of its pieces' });
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Voiles/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Clair de lune/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Print 2 pieces' }));
    expect(open).toHaveBeenCalledWith(`/api/scores/219/print?pieces=1%3Aw2%2C2%3A&file=1&name=${encodeURIComponent('Préludes Vol. 1 – 2 pieces').replace(/%20/g, '+')}`, '_blank', 'noopener');

    const set = screen.getByText('Danseuses de Delphes').closest('.score-piece') as HTMLElement;
    fireEvent.click(within(set).getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Print it all/ }));
    expect(open).toHaveBeenLastCalledWith(expect.stringContaining('pieces=1%3A*'), '_blank', 'noopener');
  });

  it('ne demande rien quand la partition n’a pas de PDF', async () => {
    vi.mocked(bookSectionsService.files).mockReset();
    card();
    await screen.findByText('Voiles');
    expect(bookSectionsService.files).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Its PDFs' })).not.toBeInTheDocument();
  });
});

describe('ScoreCard', () => {
  it('montre ses pièces, chacune avec l’enregistrement choisi, et le joue', async () => {
    card();
    const voiles = (await screen.findByText('Voiles')).closest('.score-piece__row') as HTMLElement;
    expect(screen.getByText(/2 of 4 in your music/)).toBeInTheDocument();

    fireEvent.click(within(voiles).getByRole('button', { name: /Schmid-Gagnebin/ }));

    await waitFor(() => expect(player.playAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: 177 }), [expect.objectContaining({ songId: 's2' })], 0));
  });

  it('joue toute l’œuvre dans l’enregistrement choisi, et en change', async () => {
    card();
    fireEvent.click(await screen.findByRole('button', { name: /All · Schmid-Gagnebin/ }));
    await waitFor(() => expect(player.playAlbum).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ songId: 's1' }), expect.objectContaining({ songId: 's2' })], 0));

    fireEvent.click(screen.getByRole('button', { name: 'Which recording' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Krystian Zimerman/ }));
    await waitFor(() => expect(scorePiecesService.choose).toHaveBeenCalledWith(219, 1, 903));
    expect(screen.getByRole('button', { name: /All · Zimerman/ })).toBeInTheDocument();
  });

  it('montre les mots de son éditeur, pas ceux d’une boutique, et sa pochette en grand', async () => {
    vi.mocked(bookService.getBookById).mockResolvedValueOnce({ id: 219, title: 'Préludes (HN 383)', composer: 'Claude Debussy', bookType: 'score', authors: [], cover: '/api/images/book/b.jpg',
      description: 'In 1910 the Préludes were published.\n\nRead on.' });
    card();
    expect(await screen.findByText('In 1910 the Préludes were published.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(screen.getByRole('button', { name: 'Less' })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('See it large'));
    expect(document.querySelectorAll('img[src="/api/images/book/b.jpg"]').length).toBe(2);
  });

  it('cache la fiche d’une boutique prise pour une description, et se relit quand henle.de a donné du neuf', async () => {
    vi.mocked(scorePiecesService.henle).mockResolvedValueOnce({ url: 'https://www.henle.de/X/HN-383', level: 7, changed: true });
    vi.mocked(bookService.getBookById).mockResolvedValue({ id: 219, title: 'Préludes (HN 383)', composer: 'Claude Debussy', bookType: 'score', authors: [],
      description: 'Support - PartitionInstrumentation - Klavier' });
    card();
    await waitFor(() => expect(bookService.getBookById).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Support - Partition/)).not.toBeInTheDocument();
  });

  it('ne montre pas des mots en allemand', async () => {
    vi.mocked(bookService.getBookById).mockResolvedValue({ id: 219, title: 'Inventionen', composer: 'J. S. Bach', bookType: 'score', authors: [],
      description: 'Bachs Inventionen und Sinfonien gelten zu Recht als unverzichtbar im Leben eines Pianisten. Der Komponist schrieb sie für seinen Sohn.' });
    card();
    await waitFor(() => expect(bookService.getBookById).toHaveBeenCalled());
    await screen.findByText('J. S. Bach');
    expect(screen.queryByText(/Bachs Inventionen/)).not.toBeInTheDocument();
  });

  it('ne garde que les mouvements que tient la partition', async () => {
    vi.mocked(scorePiecesService.keepParts).mockReset().mockResolvedValue([{ ...livre, parts: [livre.parts[1]], choices: livre.choices.map(c => ({ ...c, kept: c.workId === 'w2' })) }, clair]);
    card();
    const set = (await screen.findByText('Voiles')).closest('.score-piece') as HTMLElement;
    fireEvent.click(within(set).getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Choose the parts it holds/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Danseuses de Delphes' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Le vent dans la plaine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep 1 of 3' }));

    await waitFor(() => expect(scorePiecesService.keepParts).toHaveBeenCalledWith(219, 1, ['w2']));
    expect(await screen.findByText(/1 of its 3 pieces/)).toBeInTheDocument();
    expect(screen.queryByText('Danseuses de Delphes')).not.toBeInTheDocument();
  });

  it('garde les autres enregistrements d’une pièce derrière +N', async () => {
    card();
    const danseuses = (await screen.findByText('Danseuses de Delphes')).closest('.score-piece__row') as HTMLElement;
    fireEvent.click(within(danseuses).getByRole('button', { name: '+1' }));
    expect(await screen.findByRole('menuitem', { name: /Krystian Zimerman/ })).toBeInTheDocument();
  });

  it('cherche sur YouTube ce que la musique ne joue pas', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    card();
    const clairRow = (await screen.findByText('Not in your music')).closest('.score-piece__row') as HTMLElement;
    fireEvent.click(within(clairRow).getByRole('button', { name: /YouTube/ }));
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Claude%20Debussy%20Clair%20de%20lune', '_blank', 'noopener');
  });

  it('mène à la page IMSLP d’une pièce quand on la connaît', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    card();
    const danseuses = (await screen.findByText('Danseuses de Delphes')).closest('.score-piece__row') as HTMLElement;
    fireEvent.click(within(danseuses).getByRole('button', { name: 'Its score on IMSLP' }));
    expect(open).toHaveBeenCalledWith('https://imslp.org/wiki/Danseuses_de_Delphes_(Debussy)', '_blank', 'noopener');
    expect(within((screen.getByText('Voiles')).closest('.score-piece__row') as HTMLElement).queryByRole('button', { name: 'Its score on IMSLP' })).toBeNull();
  });

  it('montre ses éditions sur IMSLP, la sienne d’abord : téléchargée là-bas, jointe sous son nom', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const edition = (name: string, index: string, fields: Partial<ImslpEdition> = {}): ImslpEdition => ({
      section: 'Complete', name, editor: null, publisher: null, reprinted: null, copyright: 'Public Domain', notes: null, plate: null, thumbnail: null,
      files: [{ index, title: 'Complete Score', pages: 24, size: '2.91MB', downloads: 100, download: `https://imslp.org/wiki/Special:ImagefromIndex/${index}` }], ...fields,
    });
    vi.mocked(bookSectionsService.imslpEditions).mockReset().mockResolvedValue({ page: 'Préludes, Livre 1, CD 125 (Debussy, Claude)', editions: [
      edition('Durand, 1910', '1', { files: [{ index: '1', title: 'Complete Score', pages: 60, size: '9MB', downloads: 50000, download: 'https://imslp.org/wiki/Special:ImagefromIndex/1' }] }),
      edition('G. Henle Verlag, 1986', '2', { plate: 'HN 383', editor: 'Ernst-Günter Heinemann' }),
    ] });
    const pdf = { id: 9, bookId: 219, filename: 'x.pdf', label: 'G. Henle Verlag, 1986', source: 'imslp' as const, isDefault: true, size: 1, pageCount: null, createdAt: '' };
    vi.mocked(bookSectionsService.addFile).mockReset().mockResolvedValue([pdf]);
    const onChanged = vi.fn();
    card({ onChanged });

    fireEvent.click(await screen.findByRole('button', { name: /Find the PDF on IMSLP/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Its editions on IMSLP' });
    const names = within(dialog).getAllByText(/Durand, 1910|G. Henle Verlag, 1986/).map(e => e.textContent);
    expect(names[0]).toMatch(/Henle/);
    expect(within(dialog).getByText('Your edition')).toBeInTheDocument();

    const henle = within(dialog).getByText(/G. Henle Verlag, 1986/).closest('.imslp-edition') as HTMLElement;
    fireEvent.click(within(henle).getByRole('button', { name: /Download on IMSLP/ }));
    expect(open).toHaveBeenCalledWith('https://imslp.org/wiki/Special:ImagefromIndex/2', '_blank', 'noopener');
    expect(within(henle).getByRole('button', { name: /Attach it/ })).toBeInTheDocument();

    const file = new File(['%PDF'], 'IMSLP929903-PMLP02397.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('imslp-pdf-input'), { target: { files: [file] } });
    await waitFor(() => expect(bookSectionsService.addFile).toHaveBeenCalledWith(219, file, { label: 'G. Henle Verlag, 1986', source: 'imslp' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Its editions on IMSLP' })).not.toBeInTheDocument());
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Its PDFs' })).toBeInTheDocument();
  });

  it('dit quand IMSLP ne connaît pas la page de la partition', async () => {
    vi.mocked(bookSectionsService.imslpEditions).mockReset().mockResolvedValue({ page: null, editions: [] });
    card();
    fireEvent.click(await screen.findByRole('button', { name: /Find the PDF on IMSLP/ }));
    expect(await screen.findByText(/does not know its page on IMSLP/)).toBeInTheDocument();
  });

  it('propose le contenu d’une partition qui n’en a pas, et garde ce qu’on coche', async () => {
    vi.mocked(scorePiecesService.pieces).mockResolvedValue([]);
    vi.mocked(scorePiecesService.suggestions).mockResolvedValue([
      { workId: 'bwv812', title: 'Französische Suite Nr. 1 d-Moll, BWV 812', composers: [], parts: 6, inYourMusic: 0, why: 'number' },
      { workId: 'bwv813', title: 'Französische Suite Nr. 2 c-Moll, BWV 813', composers: [], parts: 6, inYourMusic: 0, why: 'number' },
    ]);
    vi.mocked(scorePiecesService.addPieces).mockResolvedValue([{ ...livre, id: 5, title: 'Französische Suite Nr. 1 d-Moll, BWV 812' }]);
    card();

    fireEvent.click(await screen.findByRole('checkbox', { name: /BWV 813/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(scorePiecesService.addPieces).toHaveBeenCalledWith(219, { workIds: ['bwv812'] }));
    expect(await screen.findByText('Französische Suite Nr. 1 d-Moll, BWV 812')).toBeInTheDocument();
  });

  it('ajoute une pièce trouvée par la recherche', async () => {
    vi.mocked(scorePiecesService.search).mockResolvedValue([{ workId: 'w-tr', title: 'Kinderszenen, op. 15: VII. Träumerei', composers: ['Robert Schumann'], parts: 0, inYourMusic: 1, why: 'search' }]);
    vi.mocked(scorePiecesService.addPieces).mockResolvedValue([livre, clair]);
    card();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add a piece' }));

    fireEvent.change(screen.getByLabelText('Find a piece'), { target: { value: 'träumerei' } });
    fireEvent.click(await screen.findByRole('option', { name: /Träumerei/ }, { timeout: 2000 }));

    await waitFor(() => expect(scorePiecesService.addPieces).toHaveBeenCalledWith(219, { workIds: ['w-tr'] }));
  });

  it('montre son édition en une ligne, et la change en place', async () => {
    const onChanged = vi.fn();
    card({ onChanged });
    expect(await screen.findByText(/G\. Henle Verlag · HN 383 · Henle level 7 · CHF 24\.5, 30\.11\.2025/)).toBeInTheDocument();
    expect(screen.getByText('ISMN 9790201803838')).toBeInTheDocument();
    expect(screen.getByText('Voiles d’abord')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Change its edition' })[0]);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Préludes, Premier livre' } });
    fireEvent.change(screen.getByLabelText('Its price'), { target: { value: '26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(bookService.updateBook).toHaveBeenCalledWith(219, expect.objectContaining({
      title: 'Préludes, Premier livre (HN 383)', priceChf: 26, publisher: 'G. Henle Verlag', titleStatus: 'owned',
    })));
    expect(onChanged).toHaveBeenCalled();
  });

  it('garde son titre tel quel quand on ne change ni ses mots ni son numéro', async () => {
    card();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Change its edition' }))[0]);
    fireEvent.change(screen.getByLabelText('Its price'), { target: { value: '26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(bookService.updateBook).toHaveBeenCalledWith(219, expect.objectContaining({
      title: 'Préludes Vol. 1 - piano - (HN 383)', priceChf: 26,
    })));
  });

  it('supprime une note après confirmation', async () => {
    vi.mocked(bookCommentService.deleteComment).mockReset().mockResolvedValue({});
    vi.mocked(confirm).mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    card();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this note' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(bookCommentService.deleteComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this note' }));
    await waitFor(() => expect(bookCommentService.deleteComment).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('Voiles d’abord')).not.toBeInTheDocument());
  });

  it('ne retire une pièce qu’après confirmation', async () => {
    vi.mocked(scorePiecesService.removePiece).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(confirm).mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    card();
    const takeOut = async () => {
      const set = (await screen.findByText('Voiles')).closest('.score-piece') as HTMLElement;
      fireEvent.click(within(set).getByRole('button', { name: 'More' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Take it out of the score' }));
    };
    await takeOut();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(scorePiecesService.removePiece).not.toHaveBeenCalled();
    await takeOut();
    await waitFor(() => expect(scorePiecesService.removePiece).toHaveBeenCalledWith(219, 1));
    await waitFor(() => expect(screen.queryByText('Voiles')).not.toBeInTheDocument());
  });

  it('se supprime après confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const onDeleted = vi.fn();
    card({ onDeleted });
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete the score' }));
    await waitFor(() => expect(bookService.deleteBook).toHaveBeenCalledWith(219));
    expect(onDeleted).toHaveBeenCalled();
  });

  it('s’ajoute dans la même vue : son ISMN de Henle, son œuvre cochée, son édition', async () => {
    vi.mocked(scorePiecesService.lookup).mockResolvedValue({
      from: 'henle',
      edition: { title: 'Consolations', composer: 'Franz Liszt', publisher: 'G. Henle Verlag', number: 'HN 465', code: '9790201804651', cover: null, level: 5, url: 'https://www.henle.de/Consolations/HN-465' },
      works: [
        { workId: 's172', title: 'Consolations, S. 172', composers: [], parts: 6, inYourMusic: 6, why: 'your music', likely: true },
        { workId: 's171', title: 'Consolations, S. 171a', composers: [], parts: 6, inYourMusic: 0, why: 'title', likely: false },
      ],
    });
    vi.mocked(scorePiecesService.create).mockResolvedValue({ id: 300 });
    const onCreated = vi.fn();
    card({ score: null, onCreated });

    fireEvent.change(screen.getByLabelText('A work, a composer, or its ISMN'), { target: { value: '979-0-2018-0465-1' } });
    expect(await screen.findByText(/An edition of G\. Henle Verlag/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/G\. Henle Verlag · HN 465 · Henle level 5/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Consolations, S. 172' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Consolations, S. 171a' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Add the score' }));
    await waitFor(() => expect(scorePiecesService.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Consolations', composer: 'Franz Liszt', number: 'HN 465', code: '9790201804651', level: 5, url: 'https://www.henle.de/Consolations/HN-465',
      titleStatus: 'owned', workIds: ['s172'],
    })));
    expect(onCreated).toHaveBeenCalledWith(300);
  });
});
