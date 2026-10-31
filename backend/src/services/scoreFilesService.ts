import fs from 'fs';
import path from 'path';
import { getDatabase } from '../database';
import configManager from '../config';

/**
 * A score's PDFs: IMSLP's scan of its first edition, one's own copy scanned
 * with its fingerings… One of them opens first; books.ebook_file follows it,
 * so the list, the download and the backups read the score as before. The
 * files lie with the ebooks, in data/ebooks.
 */

export class ScoreFilesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ScoreFilesError';
  }
}

export type ScoreFileSource = 'upload' | 'imslp' | 'scan';

export interface ScoreFile {
  id: number;
  bookId: number;
  filename: string;
  label: string;
  source: ScoreFileSource;
  isDefault: boolean;
  /** Its size in bytes; null when the file is missing. */
  size: number | null;
  createdAt: string;
}

interface Row { id: number; book_id: number; filename: string; label: string; source: ScoreFileSource; is_default: number; created_at: string }

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> => new Promise((resolve, reject) => {
  getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || [])));
});
const run = (sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> => new Promise((resolve, reject) => {
  getDatabase().run(sql, params, function (this: { lastID: number; changes: number }, err: Error | null) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
});

export const filesDir = (): string => {
  try { return configManager.getEbooksPath(); } catch { return path.join(__dirname, '..', '..', 'data', 'ebooks'); }
};

/** A file's name as one reads it: "book_12_1730000000_Debussy_Preludes_I.pdf" is "Debussy Preludes I". */
export const labelOf = (filename: string): string => {
  const name = path.basename(filename, path.extname(filename)).replace(/^(?:book|score)_\d+_\d+_/, '');
  return name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'PDF';
};

const sizeOf = (filename: string): number | null => {
  try { return fs.statSync(path.join(filesDir(), filename)).size; } catch { return null; }
};

const format = (row: Row): ScoreFile => ({
  id: row.id,
  bookId: row.book_id,
  filename: row.filename,
  label: row.label,
  source: row.source,
  isDefault: Boolean(row.is_default),
  size: sizeOf(row.filename),
  createdAt: row.created_at,
});

/** books.ebook_file is the file that opens first, or none. */
const follow = (bookId: number) => run(
  `UPDATE books SET ebook_file = (SELECT filename FROM score_files WHERE book_id = ? AND is_default = 1 LIMIT 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  [bookId, bookId]);

const scoreExists = async (bookId: number) => {
  const [found] = await all<{ id: number }>(`SELECT id FROM books WHERE id = ? AND book_type = 'score'`, [bookId]);
  if (!found) throw new ScoreFilesError('No such score', 404);
};

const one = async (bookId: number, fileId: number): Promise<Row> => {
  const [row] = await all<Row>('SELECT * FROM score_files WHERE id = ? AND book_id = ?', [fileId, bookId]);
  if (!row) throw new ScoreFilesError('No such file', 404);
  return row;
};

const removeFromDisk = (filename: string) => {
  try { fs.unlinkSync(path.join(filesDir(), filename)); } catch { /* already gone */ }
};

const scoreFilesService = {
  /** Its PDFs, the one that opens first first, then as they came. */
  list: async (bookId: number): Promise<ScoreFile[]> => {
    await scoreExists(bookId);
    const rows = await all<Row>('SELECT * FROM score_files WHERE book_id = ? ORDER BY is_default DESC, id', [bookId]);
    return rows.map(format);
  },

  /** How many PDFs each score holds. */
  counts: async (): Promise<Map<number, number>> => {
    const rows = await all<{ book_id: number; n: number }>('SELECT book_id, COUNT(*) AS n FROM score_files GROUP BY book_id');
    return new Map(rows.map(row => [row.book_id, row.n]));
  },

  /** A PDF kept in data/ebooks, given to the score; the first one opens first. */
  add: async (bookId: number, filename: string, label: string | null, source: ScoreFileSource = 'upload'): Promise<ScoreFile[]> => {
    try {
      await scoreExists(bookId);
    } catch (error) {
      removeFromDisk(filename);
      throw error;
    }
    const [{ n }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM score_files WHERE book_id = ?', [bookId]);
    await run('INSERT INTO score_files (book_id, filename, label, source, is_default) VALUES (?, ?, ?, ?, ?)',
      [bookId, filename, label?.trim() || labelOf(filename), source, n === 0 ? 1 : 0]);
    await follow(bookId);
    return scoreFilesService.list(bookId);
  },

  /** { label } renames it, { isDefault: true } makes it the one that opens first. */
  change: async (bookId: number, fileId: number, changes: { label?: unknown; isDefault?: unknown }): Promise<ScoreFile[]> => {
    await one(bookId, fileId);
    if (changes.label !== undefined) {
      const label = typeof changes.label === 'string' ? changes.label.trim() : '';
      if (!label) throw new ScoreFilesError('A name, please', 400);
      await run('UPDATE score_files SET label = ? WHERE id = ?', [label, fileId]);
    }
    if (changes.isDefault === true) {
      await run('UPDATE score_files SET is_default = (id = ?) WHERE book_id = ?', [fileId, bookId]);
      await follow(bookId);
    }
    return scoreFilesService.list(bookId);
  },

  /** Deleted for good, from the disk too; the oldest left opens first when it was this one. */
  remove: async (bookId: number, fileId: number): Promise<ScoreFile[]> => {
    const row = await one(bookId, fileId);
    await run('DELETE FROM score_files WHERE id = ?', [fileId]);
    removeFromDisk(row.filename);
    if (row.is_default) {
      await run('UPDATE score_files SET is_default = 1 WHERE id = (SELECT MIN(id) FROM score_files WHERE book_id = ?)', [bookId]);
    }
    await follow(bookId);
    return scoreFilesService.list(bookId);
  },

  /** All its PDFs gone with the score; the one books.ebook_file names is the book's own to delete. */
  removeAll: async (bookId: number, except: string | null): Promise<void> => {
    const rows = await all<Row>('SELECT * FROM score_files WHERE book_id = ?', [bookId]);
    for (const row of rows) if (row.filename !== except) removeFromDisk(row.filename);
    await run('DELETE FROM score_files WHERE book_id = ?', [bookId]);
  },

  /** Where a PDF lies, and the name it is given when saved. */
  pathOf: async (bookId: number, fileId: number): Promise<{ path: string; name: string }> => {
    const row = await one(bookId, fileId);
    const file = path.join(filesDir(), row.filename);
    if (!fs.existsSync(file)) throw new ScoreFilesError('The file is missing on the server', 404);
    return { path: file, name: `${row.label.replace(/["\\/]/g, ' ').trim() || 'score'}.pdf` };
  },
};

export default scoreFilesService;
