import { getDatabase } from '../database';
import Book from '../models/book';
import BookReading from '../models/bookReading';
import { suggestComposer } from '../utils/scoreComposer';
import scorePiecesService from './scorePiecesService';
import scoreFilesService from './scoreFilesService';
import { normalizeSeriesName } from './utils/bookUtils';
import type { BookFormatted } from '../types';

/**
 * The books as three things: the scores, a section of their own, by composer;
 * the reading journal, what one has read (one's own or borrowed) with one's
 * comments; and the notes on a series of the library ("Oriane loved it").
 */

export class BookSectionsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ScoresError';
  }
}

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> => new Promise((resolve, reject) => {
  getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || [])));
});
const run = (sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> => new Promise((resolve, reject) => {
  getDatabase().run(sql, params, function (this: { lastID: number; changes: number }, err: Error | null) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
});

export type ReadingEntry = BookFormatted & {
  /** This reading, of its date; none for a book borrowed or commented on and not read yet. */
  readingId: number | null;
  readNumber: number;
  readCount: number;
  /** Every reading of the book, the first first. */
  /** Each reading's date, the first first; null for one of no date. */
  readDates: Array<string | null>;
  comments: Array<{ id: number; name: string; comment: string; date: string }>;
};

export interface SeriesNote { id: number; series: string; name: string | null; note: string; createdAt: string }

const bookSectionsService = {
  /** Every score, with the composer the title suggests when none is kept yet. */
  list: async (): Promise<Array<BookFormatted & { composerSuggestion: string | null; pieceCount: number; heardCount: number; fileCount: number }>> => {
    const rows = await all<Record<string, unknown>>(`SELECT * FROM books WHERE book_type = 'score' AND title_status IN ('owned', 'borrowed', 'wish') ORDER BY title`);
    // Its pieces and how many the music plays; none before the pieces exist.
    const counts = await scorePiecesService.counts().catch(() => new Map<number, { pieces: number; heard: number }>());
    const files = await scoreFilesService.counts();
    return rows.map(row => {
      const book = Book.formatRow(row as never)!;
      const count = counts.get(book.id);
      return { ...book, composerSuggestion: book.composer ? null : suggestComposer(book.title, book.authors || []), pieceCount: count?.pieces ?? 0, heardCount: count?.heard ?? 0, fileCount: files.get(book.id) ?? 0 };
    });
  },

  /** The composers confirmed, several at once: [{ id, composer }], a composer null to clear it. */
  setComposers: async (updates: Array<{ id: number; composer: string | null }>): Promise<number> => {
    if (!Array.isArray(updates) || !updates.length) throw new BookSectionsError('Which scores?', 400);
    let changed = 0;
    for (const { id, composer } of updates) {
      const name = typeof composer === 'string' ? composer.trim() || null : null;
      changed += (await run(`UPDATE books SET composer = ?, updated_at = ? WHERE id = ? AND book_type = 'score'`, [name, new Date().toISOString(), Number(id)])).changes;
    }
    return changed;
  },

  /**
   * The reading journal: an entry per reading, a book read twice in both its
   * years, plus the books borrowed or commented on and not read yet; scores
   * aside, the last read first. A comment goes with the reading it was
   * written after (before the first, with the first).
   */
  reading: async (): Promise<ReadingEntry[]> => {
    const readings = await BookReading.list();
    const rows = await all<Record<string, unknown>>(`
      SELECT * FROM books WHERE book_type != 'score' AND title_status IN ('owned', 'borrowed')
        AND (id IN (SELECT book_id FROM book_readings) OR read_date IS NOT NULL OR title_status = 'borrowed' OR id IN (SELECT book_id FROM book_comments))`);
    const comments = await all<{ id: number; book_id: number; reading_id: number | null; name: string; comment: string; date: string }>(
      'SELECT * FROM book_comments ORDER BY date');
    const entries: ReadingEntry[] = [];
    for (const row of rows) {
      const book = Book.formatRow(row as never)!;
      const its = readings.filter(r => r.bookId === book.id);
      const itsComments = comments.filter(c => c.book_id === book.id);
      const words = itsComments.map(c => ({ id: c.id, name: c.name, comment: c.comment, date: c.date }));
      const readDates = its.map(r => r.readDate);
      if (!its.length) {
        entries.push({ ...book, readingId: null, readNumber: 0, readCount: 0, readDates: [], comments: words });
        continue;
      }
      // Its reading as kept with it; one without, the reading its date follows.
      const readingOf = (comment: typeof itsComments[number]) => {
        const kept = its.findIndex(r => r.id === comment.reading_id);
        if (kept >= 0) return kept;
        const when = String(comment.date).slice(0, 10);
        let found = 0;
        its.forEach((r, i) => { if ((r.readDate || '') <= when) found = i; });
        return found;
      };
      its.forEach((reading, i) => entries.push({
        ...book, readDate: reading.readDate, readingId: reading.id, readNumber: i + 1, readCount: its.length, readDates,
        comments: itsComments.filter(c => readingOf(c) === i).map(c => ({ id: c.id, name: c.name, comment: c.comment, date: c.date })),
      }));
    }
    return entries.sort((a, b) => (a.readDate ? 0 : 1) - (b.readDate ? 0 : 1)
      || String(b.readDate || '').localeCompare(String(a.readDate || ''))
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  },

  /** Read again, or read for the first time: a reading of its date. */
  addReading: async (bookId: number, date?: string | null): Promise<{ id: number; bookId: number; readDate: string | null }> => {
    if (!(await Book.findById(bookId))) throw new BookSectionsError('No such book', 404);
    const when = BookReading.day(date || new Date().toISOString());
    if (!when) throw new BookSectionsError('A reading needs its date (YYYY-MM-DD)', 400);
    return BookReading.add(bookId, when);
  },

  changeReading: async (id: number, date?: string | null) => {
    if (!BookReading.day(date)) throw new BookSectionsError('A reading needs its date (YYYY-MM-DD)', 400);
    const reading = await BookReading.changeDate(id, date as string);
    if (!reading) throw new BookSectionsError('No such reading', 404);
    return reading;
  },

  removeReading: async (id: number): Promise<void> => {
    if (!(await BookReading.remove(id))) throw new BookSectionsError('No such reading', 404);
  },

  /** The readings of one book, the first first. */
  readingsOf: async (bookId: number) => BookReading.list(bookId),

  /** The notes on series: those of one series, or all of them by series. */
  seriesNotes: async (series?: string | null): Promise<SeriesNote[]> => {
    const rows = await all<{ id: number; series: string; name: string | null; note: string; created_at: string }>(
      series ? 'SELECT * FROM series_notes WHERE series_key = ? ORDER BY created_at' : 'SELECT * FROM series_notes ORDER BY created_at',
      series ? [normalizeSeriesName(series)] : []);
    return rows.map(row => ({ id: row.id, series: row.series, name: row.name, note: row.note, createdAt: row.created_at }));
  },

  addSeriesNote: async (input: { series?: string; name?: string | null; note?: string }): Promise<SeriesNote> => {
    const series = (input.series || '').trim();
    const note = (input.note || '').trim();
    if (!series || !note) throw new BookSectionsError('A note needs its series and its words', 400);
    const now = new Date().toISOString();
    const { lastID } = await run('INSERT INTO series_notes (series_key, series, name, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [normalizeSeriesName(series), series, (input.name || '').trim() || null, note, now, now]);
    return { id: lastID, series, name: (input.name || '').trim() || null, note, createdAt: now };
  },

  deleteSeriesNote: async (id: number): Promise<void> => {
    if (!(await run('DELETE FROM series_notes WHERE id = ?', [id])).changes) throw new BookSectionsError('No such note', 404);
  },
};

export default bookSectionsService;
