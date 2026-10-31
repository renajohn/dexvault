import fs from 'fs';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { getDatabase } from '../database';
import scoreFilesService, { ScoreFilesError } from './scoreFilesService';

/**
 * A score's pieces to print: their pages cut from one of its PDFs, in the
 * score's order, each page once (two préludes sharing one print it once),
 * set on A4 at the largest that fits within a printer's margins, turned to
 * landscape for a page wider than high.
 */

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> => new Promise((resolve, reject) => {
  getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || [])));
});

/** 5 mm, what a printer leaves white at the edge. */
const MARGIN = 14;

/** The pages to print, in the order asked, each once. */
export const pagesOf = (ranges: Array<{ startPage: number; endPage: number }>, pageCount: number): number[] => {
  const pages: number[] = [];
  for (const range of ranges) {
    for (let page = range.startPage; page <= Math.min(range.endPage, pageCount); page += 1) if (!pages.includes(page)) pages.push(page);
  }
  return pages;
};

/** Pages laid on A4, centred, as large as the margins allow. */
export const onA4 = async (source: Uint8Array, pages: number[]): Promise<Uint8Array> => {
  const from = await PDFDocument.load(source, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const number of pages) {
    const source = from.getPage(number - 1);
    const { width: pageWidth, height: pageHeight } = source.getSize();
    const [short, long] = PageSizes.A4;
    const [width, height] = pageWidth > pageHeight ? [long, short] : [short, long];
    const sheet = out.addPage([width, height]);
    // A page with nothing on it (a blank verso) cannot be embedded: its sheet stays blank.
    if (!source.node.Contents()) continue;
    const page = await out.embedPage(source);
    const scale = Math.min((width - 2 * MARGIN) / page.width, (height - 2 * MARGIN) / page.height);
    sheet.drawPage(page, {
      x: (width - page.width * scale) / 2,
      y: (height - page.height * scale) / 2,
      xScale: scale,
      yScale: scale,
    });
  }
  return out.save();
};

const scorePrintService = {
  /**
   * The pieces asked ("12:" a piece whole, "12:w-voiles" a part of its set; a
   * set's key "12:*" all its parts marked), from the PDF asked or the one that
   * opens first. Its name says the score and the pieces, or is the one given
   * (a prélude's, which the card knows).
   */
  print: async (bookId: number, keys: string[], fileId: number | null, given: string | null = null): Promise<{ pdf: Uint8Array; name: string }> => {
    const files = await scoreFilesService.list(bookId);
    const file = fileId ? files.find(f => f.id === fileId) : files.find(f => f.isDefault);
    if (!file) throw new ScoreFilesError('This score has no PDF', 404);
    if (!keys.length) throw new ScoreFilesError('Which pieces?', 400);
    const marks = await scoreFilesService.bookmarks(bookId, file.id);
    const order = await all<{ id: number; title: string }>('SELECT id, title FROM score_pieces WHERE book_id = ? ORDER BY position, id', [bookId]);
    const rank = new Map(order.map((piece, index) => [piece.id, index]));
    const wanted = marks.filter(mark => keys.some(key => {
      const [piece, part = ''] = key.split(':');
      return Number(piece) === mark.pieceId && (part === '*' || part === (mark.partWorkId ?? ''));
    }));
    if (!wanted.length) throw new ScoreFilesError('Their pages are not marked in this PDF', 400);
    // The score's order: its pieces as listed, a set's parts by their pages.
    wanted.sort((a, b) => (rank.get(a.pieceId) ?? 0) - (rank.get(b.pieceId) ?? 0) || a.startPage - b.startPage);

    const { path } = await scoreFilesService.pathOf(bookId, file.id);
    const source = await fs.promises.readFile(path);
    const count = (await PDFDocument.load(source, { ignoreEncryption: true })).getPageCount();
    const pdf = await onA4(source, pagesOf(wanted, count));
    const [book] = await all<{ title: string }>('SELECT title FROM books WHERE id = ?', [bookId]);
    const pieces = [...new Set(wanted.map(mark => order.find(piece => piece.id === mark.pieceId)?.title).filter(Boolean))];
    const name = given?.trim() || [book?.title.replace(/\s*\((?:HN|BA)\s*[\d.]+\)/i, ''), wanted.length === 1 || pieces.length === 1 ? pieces[0] : `${wanted.length} pieces`]
      .filter(Boolean).join(' – ');
    return { pdf, name: `${name.replace(/["\\/:]/g, ' ').trim()}.pdf` };
  },
};

export default scorePrintService;
