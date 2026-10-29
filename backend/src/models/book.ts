import type sqlite3 from 'sqlite3';
import { getDatabase } from '../database';
import cacheService from '../services/cacheService';
import BookReading from './bookReading';
import { findsAll, matchScore, searchWords } from '../utils/searchText';
import type { BookRow, BookFormatted, BookCreateData, BookSearchParsed } from '../types';

interface BookUpdateResult {
  id: number;
  updated_at: string;
  [key: string]: unknown;
}

interface BookCoverResult {
  id: number;
  cover: string;
  updated_at: string;
}

interface BookEbookFileResult {
  id: number;
  ebook_file: string | null;
  updated_at: string;
  changes: number;
}

interface BookUrlsResult {
  id: number;
  urls: Record<string, string>;
  updated_at: string;
}

interface BookStatusResult {
  id: number;
  title_status: string;
}

interface BookAutocompleteRow {
  [key: string]: string | number | null;
}

interface UrlsRow {
  urls: string | null;
}

interface PragmaColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

const sanitizeUrls = (urls: Record<string, string | null> | undefined): Record<string, string> => {
  try {
    const obj = urls && typeof urls === 'object' ? urls : {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null) {
        continue;
      }
      if (typeof v === 'string' && v.trim() === '') {
        continue;
      }
      if (typeof v === 'string') {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch (_) { return {}; }
};

const Book = {
  createTable: (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const db = getDatabase();
        const sql = `
          CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            isbn TEXT,
            isbn13 TEXT,
            title TEXT NOT NULL,
            subtitle TEXT,
            authors TEXT,
            artists TEXT,
            publisher TEXT,
            published_year INTEGER,
            language TEXT,
            format TEXT,
            filetype TEXT,
            drm TEXT,
            narrator TEXT,
            runtime INTEGER,
            series TEXT,
            series_number INTEGER,
            genres TEXT,
            tags TEXT,
            rating REAL,
            cover TEXT,
            owner TEXT,
            borrowed BOOLEAN DEFAULT 0,
            borrowed_date DATE,
            returned_date DATE,
            borrowed_notes TEXT,
            page_count INTEGER,
            description TEXT,
            urls TEXT,
            annotation TEXT,
            ebook_file TEXT,
            title_status TEXT DEFAULT 'owned' CHECK(title_status IN ('owned', 'wish', 'borrowed')),
            read_date DATE,
            price_chf REAL,
            purchased_at TEXT,
            composer TEXT,
            difficulty INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;
        console.log('Creating books table...');
        db.run(sql, (err: Error | null) => {
          if (err) {
            console.error('Error creating books table:', err);
            reject(err);
          } else {
            console.log('Books table created successfully');

          // Check if artists column exists and add it if missing (for existing databases)
          db.all("PRAGMA table_info(books)", (err: Error | null, columns: PragmaColumnInfo[]) => {
            if (err) {
              console.error('Error checking table info:', err);
              return reject(err);
            }

            const hasArtistsColumn = columns.some(col => col.name === 'artists');
            const hasEbookFileColumn = columns.some(col => col.name === 'ebook_file');
            const hasBorrowedColumn = columns.some(col => col.name === 'borrowed');
            const hasReadDateColumn = columns.some(col => col.name === 'read_date');

            // If artists column doesn't exist, add it
            if (!hasArtistsColumn) {
              console.log('Adding missing artists column to books table...');
              db.run(`ALTER TABLE books ADD COLUMN artists TEXT`, (alterErr: Error | null) => {
                if (alterErr) {
                  console.error('Error adding artists column:', alterErr);
                  return reject(alterErr);
                }
                console.log('Added artists column successfully');
                checkEbookFileColumn();
              });
            } else {
              checkEbookFileColumn();
            }

            function checkEbookFileColumn(): void {
              // If ebook_file column doesn't exist, add it
              if (!hasEbookFileColumn) {
                console.log('Adding missing ebook_file column to books table...');
                db.run(`ALTER TABLE books ADD COLUMN ebook_file TEXT`, (alterErr: Error | null) => {
                  if (alterErr) {
                    console.error('Error adding ebook_file column:', alterErr);
                    return reject(alterErr);
                  }
                  console.log('Added ebook_file column successfully');
                  migrateBorrowedToReadDate();
                });
              } else {
                migrateBorrowedToReadDate();
              }
            }

            function migrateBorrowedToReadDate(): void {
              // Migration: Replace borrowed columns with read_date and update title_status
              if (hasBorrowedColumn) {
                // Need to recreate table first (to update CHECK constraint), then migrate data
                console.log('Starting migration: borrowed -> read_date and title_status...');
                recreateTableWithoutBorrowed();
              } else {
                // No migration needed - just ensure read_date exists and constraint is updated
                if (!hasReadDateColumn) {
                  // Add read_date if it doesn't exist
                  db.run(`ALTER TABLE books ADD COLUMN read_date DATE`, (alterErr: Error | null) => {
                    if (alterErr) {
                      console.error('Error adding read_date column:', alterErr);
                      return reject(alterErr);
                    }
                    console.log('Added read_date column successfully');
                    updateTitleStatusConstraint();
                  });
                } else {
                  updateTitleStatusConstraint();
                }
              }
            }

            function recreateTableWithoutBorrowed(): void {
              console.log('Recreating table without borrowed columns...');

              // Create new table with updated schema
              db.run(`
                CREATE TABLE books_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  isbn TEXT,
                  isbn13 TEXT,
                  title TEXT NOT NULL,
                  subtitle TEXT,
                  authors TEXT,
                  artists TEXT,
                  publisher TEXT,
                  published_year INTEGER,
                  language TEXT,
                  format TEXT,
                  filetype TEXT,
                  drm TEXT,
                  narrator TEXT,
                  runtime INTEGER,
                  series TEXT,
                  series_number INTEGER,
                  genres TEXT,
                  tags TEXT,
                  rating REAL,
                  cover TEXT,
                  owner TEXT,
                  page_count INTEGER,
                  description TEXT,
                  urls TEXT,
                  annotation TEXT,
                  ebook_file TEXT,
                  title_status TEXT DEFAULT 'owned' CHECK(title_status IN ('owned', 'wish', 'borrowed')),
                  read_date DATE,
                  price_chf REAL,
                  purchased_at TEXT,
                  composer TEXT,
                  difficulty INTEGER,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
              `, (createErr: Error | null) => {
                if (createErr) {
                  console.error('Error creating new books table:', createErr);
                  return reject(createErr);
                }

                // Copy data (excluding borrowed columns) and migrate title_status/read_date
                db.run(`
                  INSERT INTO books_new (
                    id, isbn, isbn13, title, subtitle, authors, artists, publisher, published_year,
                    language, format, filetype, drm, narrator, runtime, series, series_number,
                    genres, tags, rating, cover, owner, page_count, description, urls, annotation,
                    ebook_file, title_status, read_date, created_at, updated_at
                  )
                  SELECT
                    id, isbn, isbn13, title, subtitle, authors, artists, publisher, published_year,
                    language, format, filetype, drm, narrator, runtime, series, series_number,
                    genres, tags, rating, cover, owner, page_count, description, urls, annotation,
                    ebook_file,
                    CASE
                      WHEN borrowed = 1 THEN 'borrowed'
                      ELSE COALESCE(title_status, 'owned')
                    END as title_status,
                    CASE
                      WHEN borrowed_date IS NOT NULL THEN borrowed_date
                      ELSE NULL
                    END as read_date,
                    created_at, updated_at
                  FROM books
                `, (copyErr: Error | null) => {
                  if (copyErr) {
                    console.error('Error copying data to new table:', copyErr);
                    return reject(copyErr);
                  }

                  // Drop old table
                  db.run(`DROP TABLE books`, (dropErr: Error | null) => {
                    if (dropErr) {
                      console.error('Error dropping old books table:', dropErr);
                      return reject(dropErr);
                    }

                    // Rename new table
                    db.run(`ALTER TABLE books_new RENAME TO books`, (renameErr: Error | null) => {
                      if (renameErr) {
                        console.error('Error renaming new books table:', renameErr);
                        return reject(renameErr);
                      }

                      console.log('Successfully recreated books table without borrowed columns');
                      updateTitleStatusConstraint();
                    });
                  });
                });
              });
            }

            function updateTitleStatusConstraint(): void {
              // Check if title_status constraint needs updating
              // SQLite doesn't support modifying CHECK constraints directly,
              // but since we're recreating the table, the constraint should already be updated
              // Just verify and create indexes
              createIndexes();
            }
          });

          function createIndexes(): void {
            // Create indexes for better performance
            const indexPromises: Promise<void>[] = [
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books(isbn13)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_authors ON books(authors)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_artists ON books(artists)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_series ON books(series)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_language ON books(language)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_format ON books(format)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_title_status ON books(title_status)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_books_read_date ON books(read_date)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              })
            ];

            Promise.all(indexPromises)
              .then(() => {
                console.log('Books table indexes created successfully');
                resolve();
              })
              .catch((indexErr) => {
                console.error('Error creating books table indexes:', indexErr);
                reject(indexErr);
              });
          }
        }
      });
      } catch (error) {
        console.error('Error in Book.createTable():', error);
        reject(error);
      }
    });
  },

  create: (bookData: BookCreateData): Promise<BookFormatted> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const book = {
        isbn: bookData.isbn || null,
        isbn13: bookData.isbn13 || null,
        title: bookData.title,
        subtitle: bookData.subtitle || null,
        authors: JSON.stringify(bookData.authors || []),
        artists: JSON.stringify(bookData.artists || []),
        publisher: bookData.publisher || null,
        published_year: bookData.publishedYear || null,
        language: bookData.language || null,
        format: bookData.format || 'physical',
        filetype: bookData.filetype || null,
        drm: bookData.drm || null,
        narrator: bookData.narrator || null,
        runtime: bookData.runtime || null,
        series: bookData.series || null,
        series_number: bookData.seriesNumber || null,
        genres: JSON.stringify(bookData.genres || []),
        tags: JSON.stringify(bookData.tags || []),
        rating: bookData.rating || null,
        cover: bookData.cover || null,
        owner: bookData.owner || null,
        read_date: bookData.readDate || null,
        page_count: bookData.pageCount || null,
        description: bookData.description || null,
        urls: JSON.stringify(sanitizeUrls(bookData.urls)),
        annotation: bookData.annotation || null,
        title_status: bookData.titleStatus || 'owned',
        book_type: bookData.bookType || 'book',
        price_chf: bookData.priceChf ?? null,
        purchased_at: bookData.purchasedAt || null,
        composer: bookData.composer || null,
        difficulty: bookData.difficulty ?? null,
        created_at: now,
        updated_at: now
      };

      const sql = `
        INSERT INTO books (
          isbn, isbn13, title, subtitle, authors, artists, publisher, published_year,
          language, format, filetype, drm, narrator, runtime, series, series_number,
          genres, tags, rating, cover, owner, read_date, page_count, description, urls, annotation, ebook_file, title_status, book_type,
          price_chf, purchased_at, composer, difficulty, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        book.isbn, book.isbn13, book.title, book.subtitle, book.authors, book.artists, book.publisher,
        book.published_year, book.language, book.format, book.filetype, book.drm,
        book.narrator, book.runtime, book.series, book.series_number, book.genres,
        book.tags, book.rating, book.cover, book.owner, book.read_date, book.page_count, book.description,
        book.urls, book.annotation, bookData.ebookFile || null, book.title_status, book.book_type,
        book.price_chf, book.purchased_at, book.composer, book.difficulty, book.created_at, book.updated_at
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when book is created
          await cacheService.invalidateAnalytics();
          const bookId = this.lastID;
          // A book added read: its first reading.
          if (BookReading.day(book.read_date)) {
            try { await BookReading.add(bookId, book.read_date as string); } catch (e) { console.warn('Could not keep the reading:', (e as Error).message); }
          }

          // Get the created book with proper formatting
          db.get('SELECT * FROM books WHERE id = ?', [bookId], (err: Error | null, row: BookRow | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve(Book.formatRow(row!)!);
            }
          });
        }
      });
    });
  },

  findById: (id: number): Promise<BookFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM books WHERE id = ?';

      db.get(sql, [id], (err: Error | null, row: BookRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Book.formatRow(row));
        }
      });
    });
  },

  /** How many books on the shelves (not wished) hold each number of stars, halves apart. */
  countRatings: (): Promise<Array<{ stars: number; count: number }>> => {
    return new Promise((resolve, reject) => {
      getDatabase().all(
        `SELECT rating AS stars, COUNT(*) AS count FROM books
          WHERE rating > 0 AND COALESCE(title_status, 'owned') != 'wish'
          GROUP BY rating ORDER BY rating`,
        [],
        (err: Error | null, rows: Array<{ stars: number; count: number }>) => (err ? reject(err) : resolve(rows)),
      );
    });
  },

  findAll: (): Promise<BookFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      // Sort by: author A-Z, then series name, then series number (NULL series goes after, sorted by author)
      // Return owned and borrowed books (exclude wish)
      const sql = `
        SELECT * FROM books
        WHERE (title_status IN ('owned', 'borrowed') OR title_status IS NULL)
        ORDER BY
          authors ASC,
          CASE WHEN series IS NULL THEN 1 ELSE 0 END,
          series ASC,
          CASE WHEN series_number IS NULL THEN 999999 ELSE series_number END ASC,
          title ASC
      `;

      db.all(sql, [], (err: Error | null, rows: BookRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Book.formatRow).filter((r): r is BookFormatted => r !== null));
        }
      });
    });
  },

  findByIsbn: (isbn: string): Promise<BookFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM books WHERE isbn = ? OR isbn13 = ?';

      db.get(sql, [isbn, isbn], (err: Error | null, row: BookRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Book.formatRow(row));
        }
      });
    });
  },

  findByStatus: (status: string): Promise<BookFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM books WHERE title_status = ? ORDER BY title';

      db.all(sql, [status], (err: Error | null, rows: BookRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Book.formatRow).filter((r): r is BookFormatted => r !== null));
        }
      });
    });
  },

  findBySeriesAndNumber: (series: string, seriesNumber: number): Promise<BookFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM books WHERE series = ? AND series_number = ? AND (title_status IN (\'owned\', \'borrowed\') OR title_status IS NULL)';

      db.get(sql, [series, seriesNumber], (err: Error | null, row: BookRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Book.formatRow(row));
        }
      });
    });
  },

  findBySeries: (series: string): Promise<BookFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      // Use case-insensitive comparison for series name
      // Return owned and borrowed books (exclude wish)
      const sql = 'SELECT * FROM books WHERE LOWER(TRIM(series)) = LOWER(TRIM(?)) AND (title_status IN (\'owned\', \'borrowed\') OR title_status IS NULL) ORDER BY series_number';

      db.all(sql, [series], (err: Error | null, rows: BookRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Book.formatRow).filter((r): r is BookFormatted => r !== null));
        }
      });
    });
  },

  updateStatus: (id: number, status: string): Promise<BookStatusResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      // A wish that joins the shelves is added today: "last added" sorts by it.
      const sql = `UPDATE books SET title_status = ?, updated_at = ?,
        created_at = CASE WHEN ? != 'wish' AND title_status = 'wish' THEN ? ELSE created_at END
        WHERE id = ?`;
      const now = new Date().toISOString();

      db.run(sql, [status, now, status, now, id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, title_status: status });
        }
      });
    });
  },

  // The search's words and filters (docs/superpowers/specs/2026-10-22-search-pills-design.md):
  // key:value, key:a,b (either), key:"two words", -key: or !key: (all but), yes/no for
  // has_ebook (true/false, with/without, y/n, 1/0 understood), numbers 4, >=4, 2-4 for
  // year and rating. A key unknown stays a word; a key without a value is no filter yet.
  _parseSearchQuery: (query: string): BookSearchParsed => {
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    let titleStatusFilter: string | string[] | null = null;
    let hasFilters = false;
    const words: string[] = [];

    // Words split on the spaces outside quotes: title:"Vol: 2" is one.
    const tokens: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const c of query || '') {
      if (/\s/.test(c) && !inQuotes) { if (cur) tokens.push(cur); cur = ''; continue; }
      if (c === '"') inQuotes = !inQuotes;
      cur += c;
    }
    if (cur) tokens.push(cur);

    // A filter's values, split on the commas outside quotes, the quotes gone.
    const splitValues = (s: string): string[] => {
      const out: string[] = [];
      let v = '';
      let q = false;
      for (const c of s) {
        if (c === '"') { q = !q; continue; }
        if (c === ',' && !q) { out.push(v.trim()); v = ''; continue; }
        v += c;
      }
      out.push(v.trim());
      return out.filter(Boolean);
    };

    // Words in a column: never NULL, so that an exclusion keeps the books without it.
    const likeColumns: Record<string, string[]> = {
      title: ['title'], subtitle: ['subtitle'], author: ['authors'], artist: ['artists'],
      isbn: ['isbn', 'isbn13'], series: ['series'], format: ['format'], language: ['language'],
      genre: ['genres'], tag: ['tags'],
    };
    const BOOK_TYPES = ['book', 'graphic-novel', 'score'];
    const STATUSES = ['owned', 'borrowed', 'wish'];
    const YES = ['yes', 'true', 'with', 'y', '1'];
    const NO = ['no', 'false', 'without', 'n', '0'];

    // One number, a comparison or a range, on a column that may be NULL.
    const numberClause = (col: string, v: string, values: unknown[]): string | null => {
      let m = v.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (m) { values.push(Number(m[1]), Number(m[2])); return `${col} BETWEEN ? AND ?`; }
      m = v.match(/^(=|>=|<=|>|<)?(\d+(?:\.\d+)?)$/);
      if (m) { values.push(Number(m[2])); return `${col} ${m[1] || '='} ?`; }
      return null;
    };

    for (const token of tokens) {
      const m = token.match(/^([-!]?)([A-Za-z_]+):(.*)$/s);
      const key = m ? m[2].toLowerCase() : '';
      const known = !!m && (key in likeColumns || ['owner', 'type', 'book_type', 'title_status', 'has_ebook', 'year', 'rating'].includes(key));
      if (!m || !known) { words.push(token); continue; }
      const neg = !!m[1];
      const vals = splitValues(m[3]);
      if (!vals.length) continue; // A key alone: a pill being written.
      hasFilters = true;

      // The clause for the values, true or false but never NULL, and its params.
      let clause: string | null = null;
      const values: unknown[] = [];

      if (key in likeColumns) {
        const cols = likeColumns[key];
        clause = vals.flatMap(v => cols.map(col => { values.push(`%${v}%`); return `COALESCE(${col}, '') LIKE ?`; })).join(' OR ');
      } else if (key === 'owner') {
        // Exact names, one or several: owner:Alice,Oriane is either's; none is no one's.
        const names = vals.filter(v => v.toLowerCase() !== 'none');
        const either = names.length ? [`LOWER(TRIM(COALESCE(owner, ''))) IN (${names.map(() => 'LOWER(?)').join(',')})`] : [];
        if (names.length < vals.length) either.push(`TRIM(COALESCE(owner, '')) = ''`);
        values.push(...names);
        clause = either.join(' OR ');
      } else if (key === 'type' || key === 'book_type') {
        const types = [...new Set(vals.map(v => v.toLowerCase()).filter(v => BOOK_TYPES.includes(v)))];
        if (types.length) { clause = `COALESCE(book_type, 'book') IN (${types.map(() => '?').join(',')})`; values.push(...types); }
      } else if (key === 'title_status') {
        const statuses = vals.map(v => v.toLowerCase()).filter(v => STATUSES.includes(v));
        if (statuses.length) {
          // All but: of the books shown without it, owned and borrowed.
          const chosen = neg ? ['owned', 'borrowed'].filter(s => !statuses.includes(s)) : [...new Set(statuses)];
          titleStatusFilter = chosen.length === 1 ? chosen[0] : chosen;
          if (!chosen.length) whereClauses.push('0');
        }
        continue;
      } else if (key === 'has_ebook') {
        const bools = new Set(vals.map(v => v.toLowerCase()).map(v => (YES.includes(v) ? 'yes' : NO.includes(v) ? 'no' : null)).filter(Boolean));
        if (bools.size === 1) {
          clause = bools.has('yes') ? `COALESCE(ebook_file, '') != ''` : `COALESCE(ebook_file, '') = ''`;
        }
      } else {
        const col = key === 'year' ? 'published_year' : 'rating';
        const ors = vals.map(v => numberClause(col, v, values)).filter((c): c is string => !!c);
        if (ors.length) clause = `${col} IS NOT NULL AND (${ors.join(' OR ')})`;
      }

      if (!clause) continue; // Nothing it could mean: no filter.
      whereClauses.push(neg ? `NOT (${clause})` : `(${clause})`);
      params.push(...values);
    }

    return { params, whereClauses, titleStatusFilter, hasFilters, cleanedQuery: words.join(' ').trim() };
  },

  search: (query: string): Promise<BookFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const { params, whereClauses, titleStatusFilter, cleanedQuery } = Book._parseSearchQuery(query);

      // Owned and borrowed unless title_status says otherwise (one or several).
      let titleStatusClause = "(title_status IN ('owned', 'borrowed') OR title_status IS NULL)";
      let titleStatusParams: string[] = [];
      if (Array.isArray(titleStatusFilter)) {
        if (titleStatusFilter.length) {
          titleStatusClause = `title_status IN (${titleStatusFilter.map(() => '?').join(', ')})`;
          titleStatusParams = titleStatusFilter;
        }
      } else if (titleStatusFilter) {
        titleStatusClause = 'title_status = ?';
        titleStatusParams = [titleStatusFilter];
      }

      // The plain words are read on the rows the filters keep, without their accents (utils/searchText).
      const words = searchWords(cleanedQuery);
      const whereParts: string[] = [];
      whereParts.push(...whereClauses, titleStatusClause);

      const sql = `
        SELECT * FROM books
        WHERE ${whereParts.join(' AND ')}
        ORDER BY
          CASE
            WHEN language IN ('en', 'eng', 'fr', 'fre', 'fra') THEN 1
            ELSE 2
          END,
          title
      `;

      db.all(sql, [...params, ...titleStatusParams], (err: Error | null, rows: BookRow[]) => {
        if (err) {
          reject(err);
        } else {
          // Each word, in any order, in the title, the authors, the series, the ISBN or the description.
          const kept = rows.filter(row => findsAll(words, [
            row.title, row.subtitle, row.authors, row.artists, row.isbn, row.isbn13, row.series, row.description,
          ]));
          // How well they name it: its title first, its authors and its series after, its description last.
          resolve(kept.flatMap(row => {
            const book = Book.formatRow(row);
            if (!book) return [];
            if (!words.length) return [book];
            return [{ ...book, matchScore: matchScore(words, [
              [row.title, 1], [row.authors, 0.9], [row.series, 0.8], [row.subtitle, 0.7], [row.isbn, 0.7], [row.isbn13, 0.7],
              [row.artists, 0.6], [row.description, 0.2],
            ]) }];
          }));
        }
      });
    });
  },

  update: (id: number, bookData: BookCreateData): Promise<BookUpdateResult> => {
    return new Promise(async (resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      // Get existing book to preserve ebook_file if not provided
      let existingBook: BookFormatted | null = null;
      try {
        existingBook = await Book.findById(id);
      } catch (err) {
        console.warn('Could not fetch existing book to preserve ebook_file:', (err as Error).message);
      }

      const sql = `
        UPDATE books SET
          isbn = ?, isbn13 = ?, title = ?, subtitle = ?, authors = ?, artists = ?, publisher = ?,
          published_year = ?, language = ?, format = ?, filetype = ?, drm = ?,
          narrator = ?, runtime = ?, series = ?, series_number = ?, genres = ?,
          tags = ?, rating = ?, cover = ?, owner = ?, read_date = ?, page_count = ?, description = ?,
          urls = ?, annotation = ?, ebook_file = ?, title_status = ?, book_type = ?, price_chf = ?, purchased_at = ?, composer = ?, difficulty = ?, updated_at = ?
        WHERE id = ?
      `;

      // Preserve ebook_file if not provided in bookData (undefined means preserve, null means clear)
      const ebookFile = bookData.ebookFile !== undefined
        ? (bookData.ebookFile || null)
        : (existingBook?.ebookFile || null);

      console.log(`Book.update - book ${id}: ebookFile in bookData: ${bookData.ebookFile}, preserving: ${ebookFile}`);

      const params = [
        bookData.isbn || null,
        bookData.isbn13 || null,
        bookData.title,
        bookData.subtitle || null,
        JSON.stringify(bookData.authors || []),
        JSON.stringify(bookData.artists || []),
        bookData.publisher || null,
        bookData.publishedYear || null,
        bookData.language || null,
        bookData.format || 'physical',
        bookData.filetype || null,
        bookData.drm || null,
        bookData.narrator || null,
        bookData.runtime || null,
        bookData.series || null,
        bookData.seriesNumber || null,
        JSON.stringify(bookData.genres || []),
        JSON.stringify(bookData.tags || []),
        bookData.rating || null,
        bookData.cover || null,
        bookData.owner || null,
        bookData.readDate || null,
        bookData.pageCount || null,
        bookData.description || null,
        JSON.stringify(sanitizeUrls(bookData.urls)),
        bookData.annotation || null,
        ebookFile,
        bookData.titleStatus || 'owned',
        bookData.bookType || 'book',
        // The form does not show them: undefined keeps the price and the date of purchase.
        bookData.priceChf !== undefined ? bookData.priceChf : existingBook?.priceChf ?? null,
        bookData.purchasedAt !== undefined ? bookData.purchasedAt : existingBook?.purchasedAt ?? null,
        bookData.composer !== undefined ? bookData.composer : existingBook?.composer ?? null,
        bookData.difficulty !== undefined ? bookData.difficulty : existingBook?.difficulty ?? null,
        now,
        id
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when book is updated
          await cacheService.invalidateAnalytics();
          // The form's one date: the last reading corrected, or one added.
          try { await BookReading.followForm(id, existingBook?.readDate, bookData.readDate || null); } catch (e) { console.warn('Could not follow the reading:', (e as Error).message); }
          resolve({ id, ...bookData, updated_at: now });
        }
      });
    });
  },

  /** The photograph of its back, alone. */
  updateBackCover: (id: number, path: string): Promise<void> => new Promise((resolve, reject) => {
    getDatabase().run('UPDATE books SET back_cover = ?, updated_at = ? WHERE id = ?', [path, new Date().toISOString(), id],
      (err: Error | null) => (err ? reject(err) : resolve()));
  }),

  updateCover: (id: number, coverPath: string): Promise<BookCoverResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const sql = 'UPDATE books SET cover = ?, updated_at = ? WHERE id = ?';

      db.run(sql, [coverPath, now, id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, cover: coverPath, updated_at: now });
        }
      });
    });
  },

  updateEbookFile: (id: number, ebookFilePath: string | null): Promise<BookEbookFileResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const sql = 'UPDATE books SET ebook_file = ?, updated_at = ? WHERE id = ?';

      console.log(`Updating ebook_file for book ${id} with filename: ${ebookFilePath}`);

      db.run(sql, [ebookFilePath, now, id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          console.error(`Error updating ebook_file for book ${id}:`, err);
          reject(err);
        } else {
          console.log(`Successfully updated ebook_file for book ${id}. Changes: ${this.changes}`);
          if (this.changes === 0) {
            console.warn(`Warning: No rows updated for book ${id}. Book may not exist.`);
          }
          resolve({ id, ebook_file: ebookFilePath, updated_at: now, changes: this.changes });
        }
      });
    });
  },

  updateUrls: (id: number, newUrls: Record<string, string>): Promise<BookUrlsResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      // First fetch existing urls to merge
      db.get('SELECT urls FROM books WHERE id = ?', [id], (err: Error | null, row: UrlsRow | undefined) => {
        if (err) {
          return reject(err);
        }
        const existingUrls: Record<string, string> = row && row.urls ? JSON.parse(row.urls) : {};
        const merged: Record<string, string> = { ...existingUrls, ...newUrls };

        const sql = 'UPDATE books SET urls = ?, updated_at = ? WHERE id = ?';
        db.run(sql, [JSON.stringify(merged), now, id], function(this: sqlite3.RunResult, updateErr: Error | null) {
          if (updateErr) {
            reject(updateErr);
          } else {
            resolve({ id, urls: merged, updated_at: now });
          }
        });
      });
    });
  },

  delete: (id: number): Promise<{ deleted: boolean }> => {
    return new Promise(async (resolve, reject) => {
      const db = getDatabase();
      const sql = 'DELETE FROM books WHERE id = ?';

      db.run(sql, [id], async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when book is deleted
          await cacheService.invalidateAnalytics();
          const deleted = this.changes > 0;
          if (deleted) { try { await BookReading.removeAllOf(id); } catch { /* no readings yet */ } }
          resolve({ deleted });
        }
      });
    });
  },

  // Helper function to safely parse array fields (handles both JSON arrays and comma-separated strings)
  parseArrayField: (value: string | null): string[] => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed as string[];
      }
      // If parsed value is not an array, treat as single item
      return parsed ? [parsed as string] : [];
    } catch (e) {
      // If JSON parsing fails, treat as comma-separated string
      if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(item => item);
      }
      return [];
    }
  },

  formatRow: (row: BookRow): BookFormatted | null => {
    if (!row) return null;

    return {
      id: row.id,
      isbn: row.isbn,
      isbn13: row.isbn13,
      title: row.title,
      subtitle: row.subtitle,
      authors: Book.parseArrayField(row.authors),
      artists: Book.parseArrayField(row.artists),
      publisher: row.publisher,
      publishedYear: row.published_year,
      language: row.language,
      format: row.format,
      filetype: row.filetype,
      drm: row.drm,
      narrator: row.narrator,
      runtime: row.runtime,
      series: row.series,
      seriesNumber: row.series_number,
      genres: Book.parseArrayField(row.genres),
      tags: Book.parseArrayField(row.tags),
      rating: row.rating,
      cover: row.cover,
      owner: row.owner,
      readDate: row.read_date,
      pageCount: row.page_count,
      description: row.description,
      urls: JSON.parse(row.urls || '{}'),
      annotation: row.annotation,
      ebookFile: row.ebook_file,
      titleStatus: row.title_status,
      spokenFor: row.spoken_for === 1,
      bookType: row.book_type || 'book',
      priceChf: row.price_chf ?? null,
      purchasedAt: row.purchased_at ?? null,
      composer: row.composer ?? null,
      difficulty: row.difficulty ?? null,
      backCover: row.back_cover ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  autocomplete: (field: string, value: string): Promise<Record<string, string | number | null>[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();

      // The map is the allowlist: a field with no column here never reaches the
      // query, so an unmapped name cannot become `SELECT DISTINCT undefined`.
      const columnMap: Record<string, string> = {
        'title': 'title',
        'subtitle': 'subtitle',
        'isbn': 'isbn',
        'author': 'authors',
        'artist': 'artists',
        'series': 'series',
        'publisher': 'publisher',
        'genre': 'genres',
        'tag': 'tags',
        'owner': 'owner',
        'language': 'language'
      };
      const column = columnMap[field];
      if (!column) {
        return reject(new Error(`Invalid field: ${field}`));
      }

      // For owner field, show all owners when query is empty (better for look-ahead)
      let sql: string;
      let params: string[];

      // Handle undefined, null, or empty string values
      const trimmedValue = value ? String(value).trim() : '';

      if (!trimmedValue) {
        // Return all distinct owners (or other fields) when query is empty
        sql = `
          SELECT DISTINCT ${column}
          FROM books
          WHERE ${column} IS NOT NULL AND ${column} != ''
          ORDER BY ${column}
          LIMIT 50
        `;
        params = [];
      } else {
        // Search for matching values
        sql = `
          SELECT DISTINCT ${column}
          FROM books
          WHERE ${column} LIKE ?
          ORDER BY ${column}
          LIMIT 50
        `;
        params = [`%${trimmedValue}%`];
      }

      db.all(sql, params, (err: Error | null, rows: BookAutocompleteRow[]) => {
        if (err) {
          reject(err);
        } else {
          // Return rows with the requested field name (not the column name)
          resolve(rows.map(row => ({ [field]: row[column] })));
        }
      });
    });
  }
};

export default Book;
