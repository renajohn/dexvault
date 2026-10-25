import sqlite3 from 'sqlite3';
import configManager from './config';

const verbose = sqlite3.verbose();

const getDbSource = (): string => {
  try {
    return configManager.getDatabasePath();
  } catch (error) {
    // Fallback to default if config not loaded
    return 'db.sqlite';
  }
};

let db: sqlite3.Database | null = null;

interface PragmaColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface MigrationDef {
  name: string;
  up: () => Promise<void>;
}

// Run auto-migrations for schema changes
const runAutoMigrations = async (): Promise<void> => {
  console.log('Checking for schema migrations...');

  if (!db) throw new Error('Database not initialized');
  const currentDb = db;

  // Create migrations tracking table if it doesn't exist
  await new Promise<void>((resolve, reject) => {
    currentDb.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Define migrations - add new ones here
  const migrations: MigrationDef[] = [
    {
      name: '009_add_last_watched',
      up: async () => {
        // Check if column exists
        const columns = await new Promise<PragmaColumnInfo[]>((resolve, reject) => {
          currentDb.all(`PRAGMA table_info(movies)`, (err: Error | null, rows: PragmaColumnInfo[]) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        if (!columns.some(col => col.name === 'last_watched')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run(`ALTER TABLE movies ADD COLUMN last_watched DATE`, (err: Error | null) => {
              if (err && !err.message.includes('duplicate column')) reject(err);
              else resolve();
            });
          });
          console.log('  ✓ Added last_watched column');
        }
      }
    },
    {
      name: '010_add_watch_count',
      up: async () => {
        const columns = await new Promise<PragmaColumnInfo[]>((resolve, reject) => {
          currentDb.all(`PRAGMA table_info(movies)`, (err: Error | null, rows: PragmaColumnInfo[]) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        if (!columns.some(col => col.name === 'watch_count')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run(`ALTER TABLE movies ADD COLUMN watch_count INTEGER DEFAULT 0`, (err: Error | null) => {
              if (err && !err.message.includes('duplicate column')) reject(err);
              else resolve();
            });
          });

          console.log('  ✓ Added watch_count column');
        }
      }
    },
    {
      name: '011_fix_watch_count_data',
      up: async () => {
        const result = await new Promise<number>((resolve, reject) => {
          currentDb.run(`
            UPDATE movies
            SET watch_count = 0
            WHERE last_watched IS NULL
          `, function(this: sqlite3.RunResult, err: Error | null) {
            if (err) reject(err);
            else resolve(this.changes);
          });
        });
        console.log(`  ✓ Reset watch_count to 0 for ${result} movies without last_watched date`);
      }
    },
    {
      name: '012_add_book_type',
      up: async () => {
        const columns = await new Promise<PragmaColumnInfo[]>((resolve, reject) => {
          currentDb.all(`PRAGMA table_info(books)`, (err: Error | null, rows: PragmaColumnInfo[]) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        if (!columns.some(col => col.name === 'book_type')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run(`ALTER TABLE books ADD COLUMN book_type TEXT DEFAULT 'book' CHECK(book_type IN ('book', 'graphic-novel', 'score'))`, (err: Error | null) => {
              if (err && !err.message.includes('duplicate column')) reject(err);
              else resolve();
            });
          });
          console.log('  ✓ Added book_type column to books table');

          const scoresByIsbn = await new Promise<number>((resolve, reject) => {
            currentDb.run(`
              UPDATE books
              SET book_type = 'score'
              WHERE isbn13 LIKE '9790%'
            `, function(this: sqlite3.RunResult, err: Error | null) {
              if (err) reject(err);
              else resolve(this.changes);
            });
          });
          console.log(`  ✓ Backfilled ${scoresByIsbn} books as 'score' (by ISMN)`);

          const scoresByGenre = await new Promise<number>((resolve, reject) => {
            currentDb.run(`
              UPDATE books
              SET book_type = 'score'
              WHERE book_type = 'book'
                AND genres LIKE '%Music /%'
            `, function(this: sqlite3.RunResult, err: Error | null) {
              if (err) reject(err);
              else resolve(this.changes);
            });
          });
          console.log(`  ✓ Backfilled ${scoresByGenre} books as 'score' (by Music genre)`);

          const graphicNovels = await new Promise<number>((resolve, reject) => {
            currentDb.run(`
              UPDATE books
              SET book_type = 'graphic-novel'
              WHERE book_type = 'book'
                AND (
                  genres LIKE '%Comics & Graphic Novels%'
                  OR genres LIKE '%Bandes dessinées%'
                  OR genres LIKE '%bandes dessinées%'
                  OR genres LIKE '%Comic Strips%'
                  OR genres LIKE '%Manga%'
                )
            `, function(this: sqlite3.RunResult, err: Error | null) {
              if (err) reject(err);
              else resolve(this.changes);
            });
          });
          console.log(`  ✓ Backfilled ${graphicNovels} books as 'graphic-novel'`);
        }
      }
    },
    {
      name: '014_add_discogs_release_id',
      up: async () => {
        // Discogs is now the primary source for physical pressings, so albums
        // need their own external id: a Discogs release has no MusicBrainz id.
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(albums)', (err: Error | null, rows: Array<{ name: string }>) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });

        if (!columns.some(c => c.name === 'discogs_release_id')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE albums ADD COLUMN discogs_release_id TEXT', (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          });
          console.log('  ✓ Added discogs_release_id column');
        }

        // Partial, like the MusicBrainz one: any number of albums may have none.
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_discogs_id_unique
            ON albums(discogs_release_id)
            WHERE discogs_release_id IS NOT NULL
          `, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log('  ✓ albums.discogs_release_id is now unique');
      }
    },
    {
      name: '013_unique_album_musicbrainz_id',
      up: async () => {
        // The application checks for an existing release before inserting, but
        // two concurrent requests (a double tap) can both pass that check. A
        // partial unique index makes the database the last line of defence,
        // while still allowing any number of hand-entered albums with no id.
        const duplicates = await new Promise<Array<{ musicbrainz_release_id: string; n: number }>>((resolve, reject) => {
          currentDb.all(`
            SELECT musicbrainz_release_id, COUNT(*) AS n
            FROM albums
            WHERE musicbrainz_release_id IS NOT NULL
            GROUP BY musicbrainz_release_id
            HAVING n > 1
          `, (err: Error | null, rows: Array<{ musicbrainz_release_id: string; n: number }>) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });

        if (duplicates.length > 0) {
          // Refuse to guess which copy to drop: leave the data alone and say so,
          // rather than failing startup or deleting someone's album.
          console.warn(
            `  ! Skipping unique index: ${duplicates.length} MusicBrainz id(s) already appear more than once ` +
            `(${duplicates.map(d => d.musicbrainz_release_id).join(', ')}). ` +
            'Remove the duplicate albums, then restart to apply it.'
          );
          return;
        }

        await new Promise<void>((resolve, reject) => {
          currentDb.run(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_musicbrainz_id_unique
            ON albums(musicbrainz_release_id)
            WHERE musicbrainz_release_id IS NOT NULL
          `, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log('  ✓ albums.musicbrainz_release_id is now unique');
      }
    },
    {
      name: '015_track_popularity_listenbrainz',
      up: async () => {
        // Deezer's rank alone could not tell the tracks of a well-known album
        // apart; every album is read again, with ListenBrainz's listens.
        const TrackPopularity = (await import('./models/trackPopularity')).default;
        await TrackPopularity.forgetAll();
        console.log('  ✓ Track popularity to be read again, with ListenBrainz');
      }
    },
    {
      name: '016_watch_next_in_collection_order',
      up: async () => {
        // Watch Next was shown newest first, its highest order at the head; it
        // now follows its order as every collection does, a new movie at the
        // end. It is numbered again from 1 as it was shown, so that it shows
        // as it did (its orders could tie: a drag in a card and an addition).
        const shown = await new Promise<Array<{ movie_id: number; collection_id: number }>>((resolve, reject) => {
          currentDb.all(`
            SELECT mc.movie_id, mc.collection_id
            FROM movie_collections mc
            JOIN movies m ON m.id = mc.movie_id
            WHERE mc.collection_id IN (SELECT id FROM collections WHERE type = 'watch_next')
            ORDER BY
              CASE WHEN mc.collection_order IS NOT NULL THEN mc.collection_order ELSE 999999 END DESC,
              m.release_date DESC,
              m.title DESC
          `, (err: Error | null, rows: Array<{ movie_id: number; collection_id: number }>) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
        for (const [index, row] of shown.entries()) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('UPDATE movie_collections SET collection_order = ? WHERE movie_id = ? AND collection_id = ?',
              [index + 1, row.movie_id, row.collection_id], (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log(`  ✓ Watch Next in its collection's order (${shown.length} movies)`);
      }
    },
    {
      name: '017_spoken_for',
      up: async () => {
        // A wish already taken care of (ordered, a bid made, a gift to come) is
        // "spoken for": still wished, nothing more to do. It means nothing once
        // the title leaves the wish list, so a trigger clears it then, whatever
        // the path that moves it, and a title wished again starts afresh.
        for (const table of ['movies', 'albums', 'books']) {
          const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
            currentDb.all(`PRAGMA table_info(${table})`, (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
          });
          if (!columns.some(c => c.name === 'spoken_for')) {
            await new Promise<void>((resolve, reject) => {
              currentDb.run(`ALTER TABLE ${table} ADD COLUMN spoken_for INTEGER NOT NULL DEFAULT 0`, (err: Error | null) => (err ? reject(err) : resolve()));
            });
          }
          await new Promise<void>((resolve, reject) => {
            currentDb.run(`
              CREATE TRIGGER IF NOT EXISTS ${table}_spoken_for_leaves_wish
              AFTER UPDATE OF title_status ON ${table}
              WHEN NEW.title_status IS NOT 'wish' AND NEW.spoken_for = 1
              BEGIN UPDATE ${table} SET spoken_for = 0 WHERE id = NEW.id; END
            `, (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log('  ✓ Added spoken_for to movies, albums and books');
      }
    },
    {
      name: '018_book_purchase',
      up: async () => {
        // A book bought, as a CD or a movie: what it cost, and when.
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(books)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        for (const [name, type] of [['price_chf', 'REAL'], ['purchased_at', 'TEXT']]) {
          if (columns.some(c => c.name === name)) continue;
          await new Promise<void>((resolve, reject) => {
            currentDb.run(`ALTER TABLE books ADD COLUMN ${name} ${type}`, (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log('  ✓ Added price_chf and purchased_at to books');
      }
    },
    {
      name: '019_score_composer',
      up: async () => {
        // A score's composer: its "author" is most often an editor (Ashkenazy for Bach's French Suites).
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(books)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!columns.some(c => c.name === 'composer')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE books ADD COLUMN composer TEXT', (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`
            CREATE TABLE IF NOT EXISTS series_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              series_key TEXT NOT NULL,
              series TEXT NOT NULL,
              name TEXT,
              note TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err: Error | null) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
          currentDb.run('CREATE INDEX IF NOT EXISTS idx_series_notes_key ON series_notes(series_key)', (err: Error | null) => (err ? reject(err) : resolve()));
        });
        console.log('  ✓ Added books.composer and series_notes');
      }
    },
    {
      name: '020_book_readings',
      up: async () => {
        // A book read again keeps its first reading: one row per reading, the dates kept so far as the first.
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`
            CREATE TABLE IF NOT EXISTS book_readings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              book_id INTEGER NOT NULL,
              read_date TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err: Error | null) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
          currentDb.run('CREATE INDEX IF NOT EXISTS idx_book_readings_book ON book_readings(book_id)', (err: Error | null) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`INSERT INTO book_readings (book_id, read_date)
            SELECT id, substr(read_date, 1, 10) FROM books
            WHERE read_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
              AND id NOT IN (SELECT book_id FROM book_readings)`, (err: Error | null) => (err ? reject(err) : resolve()));
        });
        // Each comment with the reading it was written after (before the first, with the first).
        const commentColumns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(book_comments)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!commentColumns.some(c => c.name === 'reading_id')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE book_comments ADD COLUMN reading_id INTEGER', (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`UPDATE book_comments SET reading_id = COALESCE(
              (SELECT r.id FROM book_readings r WHERE r.book_id = book_comments.book_id AND r.read_date <= substr(book_comments.date, 1, 10) ORDER BY r.read_date DESC, r.id DESC LIMIT 1),
              (SELECT r.id FROM book_readings r WHERE r.book_id = book_comments.book_id ORDER BY r.read_date, r.id LIMIT 1))
            WHERE reading_id IS NULL`, (err: Error | null) => (err ? reject(err) : resolve()));
        });
        console.log('  ✓ Added book_readings, the comments with their reading');
      }
    },
    {
      name: '021_score_pieces',
      up: async () => {
        // The pieces a score holds, as MusicBrainz works, and the works each recording of the music plays.
        const statements = [
          `CREATE TABLE IF NOT EXISTS mb_works (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            parent_ids TEXT,
            parts TEXT,
            imslp TEXT,
            fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS recording_works (
            recording_id TEXT NOT NULL,
            work_id TEXT NOT NULL,
            depth INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (recording_id, work_id)
          )`,
          'CREATE INDEX IF NOT EXISTS idx_recording_works_work ON recording_works(work_id)',
          `CREATE TABLE IF NOT EXISTS recordings_indexed (
            recording_id TEXT PRIMARY KEY,
            indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS score_pieces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL,
            work_id TEXT,
            title TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            preferred_album_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          'CREATE INDEX IF NOT EXISTS idx_score_pieces_book ON score_pieces(book_id)',
        ];
        for (const sql of statements) {
          await new Promise<void>((resolve, reject) => currentDb.run(sql, (err: Error | null) => (err ? reject(err) : resolve())));
        }
        console.log('  ✓ Added score_pieces and the works of the recordings');
      }
    },
    {
      name: '022_score_difficulty',
      up: async () => {
        // A score's level of difficulty: Henle's, 1 to 9, read from its page.
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(books)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!columns.some(c => c.name === 'difficulty')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE books ADD COLUMN difficulty INTEGER', (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log('  ✓ Added books.difficulty');
      }
    },
    {
      name: '023_score_parts_left_out',
      up: async () => {
        // The parts of a work a score does not hold: a sonata's funeral march alone.
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(score_pieces)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!columns.some(c => c.name === 'parts_left_out')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE score_pieces ADD COLUMN parts_left_out TEXT', (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log('  ✓ Added score_pieces.parts_left_out');
      }
    },
    {
      name: '024_book_back_cover',
      up: async () => {
        // A photograph of a book's back, its blurb, as an album has its back cover.
        const columns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
          currentDb.all('PRAGMA table_info(books)', (err: Error | null, rows: Array<{ name: string }>) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!columns.some(c => c.name === 'back_cover')) {
          await new Promise<void>((resolve, reject) => {
            currentDb.run('ALTER TABLE books ADD COLUMN back_cover TEXT', (err: Error | null) => (err ? reject(err) : resolve()));
          });
        }
        console.log('  ✓ Added books.back_cover');
      }
    },
    {
      name: '025_undated_readings',
      up: async () => {
        // A book read, one does not know when: a reading of no date. SQLite changes a column's constraint by copying the table.
        const exists = await new Promise<unknown>((resolve, reject) => {
          currentDb.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_readings'", (err: Error | null, row: unknown) => (err ? reject(err) : resolve(row)));
        });
        if (exists) {
          for (const sql of [
            'CREATE TABLE book_readings_new (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL, read_date TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
            'INSERT INTO book_readings_new (id, book_id, read_date, created_at) SELECT id, book_id, read_date, created_at FROM book_readings',
            'DROP TABLE book_readings',
            'ALTER TABLE book_readings_new RENAME TO book_readings',
            'CREATE INDEX IF NOT EXISTS idx_book_readings_book ON book_readings(book_id)',
          ]) {
            await new Promise<void>((resolve, reject) => currentDb.run(sql, (err: Error | null) => (err ? reject(err) : resolve())));
          }
        }
        console.log('  ✓ book_readings may have no date');
      }
    },
    {
      name: '026_remote_players',
      up: async () => {
        // The names given from the remote to the computers playing music: MacBook du salon.
        await new Promise<void>((resolve, reject) => currentDb.run(
          'CREATE TABLE IF NOT EXISTS remote_players (id TEXT PRIMARY KEY, name TEXT NOT NULL)', (err: Error | null) => (err ? reject(err) : resolve())));
        console.log('  ✓ Added remote_players');
      }
    },
    {
      name: '027_listen_next_cd',
      up: async () => {
        // Listen Next in two lists: streamed (digital), as it was, and CDs to put on the player (cd).
        const columns = await new Promise<PragmaColumnInfo[]>((resolve, reject) =>
          currentDb.all('PRAGMA table_info(album_collections)', (err: Error | null, rows: PragmaColumnInfo[]) => (err ? reject(err) : resolve(rows || []))));
        if (!columns.some(column => column.name === 'medium')) {
          await new Promise<void>((resolve, reject) => currentDb.run(
            "ALTER TABLE album_collections ADD COLUMN medium TEXT NOT NULL DEFAULT 'digital'", (err: Error | null) => (err ? reject(err) : resolve())));
        }
        // The CDs come in since September, the classical ones left out, those already in Listen Next where they are.
        const { default: musicCollectionService } = await import('./services/musicCollectionService');
        const added = await musicCollectionService.seedCdList('2026-09-01');
        console.log(`  ✓ Listen Next has a CD list (${added} CDs come in lately)`);
      }
    },
    {
      name: '028_added_when_bought',
      up: async () => {
        // A CD or a book wished long before it was bought was added the day it was bought: "last added" sorts by it.
        for (const table of ['albums', 'books']) {
          const exists = await new Promise<unknown>((resolve, reject) =>
            currentDb.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table], (err: Error | null, row: unknown) => (err ? reject(err) : resolve(row))));
          if (!exists) continue;
          const changed = await new Promise<number>((resolve, reject) => currentDb.run(
            `UPDATE ${table} SET created_at = purchased_at || 'T12:00:00.000Z'
             WHERE COALESCE(title_status, 'owned') = 'owned'
               AND purchased_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
               AND purchased_at > date(created_at)`,
            function (this: { changes: number }, err: Error | null) { if (err) reject(err); else resolve(this.changes); }));
          console.log(`  ✓ ${changed} ${table} added the day they were bought`);
        }
      }
    },
    {
      name: '029_age_source',
      up: async () => {
        // Where a movie's age comes from: 'filmages' (filmages.ch), or nothing for the TMDB/OMDB median.
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`ALTER TABLE movies ADD COLUMN age_source TEXT`, (err: Error | null) => {
            if (err && !err.message.includes('duplicate column')) reject(err);
            else resolve();
          });
        });
        console.log('  ✓ Added age_source column');
      }
    },
    {
      name: '030_outputs',
      up: async () => {
        // The appliances DexVault plays on (UPnP): the name and volume ceiling the owner gave each, where it was last
        // seen, and what plays there, in JSON, to outlive a restart.
        for (const sql of [
          `CREATE TABLE IF NOT EXISTS output_settings (
             id TEXT PRIMARY KEY, name TEXT, max_volume INTEGER, location TEXT, device_name TEXT, model TEXT)`,
          'CREATE TABLE IF NOT EXISTS output_sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER)',
        ]) {
          await new Promise<void>((resolve, reject) => currentDb.run(sql, (err: Error | null) => (err ? reject(err) : resolve())));
        }
        console.log('  ✓ Added output_settings and output_sessions');
      }
    }
  ];

  // Run pending migrations
  for (const migration of migrations) {
    const applied = await new Promise<unknown>((resolve, reject) => {
      currentDb.get(`SELECT * FROM schema_migrations WHERE migration_name = ?`, [migration.name], (err: Error | null, row: unknown) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!applied) {
      try {
        await migration.up();
        await new Promise<void>((resolve, reject) => {
          currentDb.run(`INSERT INTO schema_migrations (migration_name) VALUES (?)`, [migration.name], (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log(`  ✓ Applied migration: ${migration.name}`);
      } catch (error) {
        console.error(`  ✗ Migration ${migration.name} failed:`, (error as Error).message);
        // Continue with other migrations
      }
    }
  }

  console.log('Schema migrations complete.');
};

const initDatabase = async (): Promise<sqlite3.Database> => {
  return new Promise(async (resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    db = new verbose.Database(getDbSource(), async (err: Error | null) => {
      if (err) {
        console.error('Database connection error:', err.message);
        reject(err);
      } else {
        const currentDb = db!;
        // Enable foreign key constraints
        currentDb.run('PRAGMA foreign_keys = ON', (err: Error | null) => {
          if (err) {
            console.error('Error enabling foreign keys:', err.message);
          } else {
            console.log('Foreign key constraints enabled');
          }
        });

        // Create tables with final schema
        try {
          const Movie = (await import('./models/movie')).default;
          const MovieCast = (await import('./models/movieCast')).default;
          const MovieCrew = (await import('./models/movieCrew')).default;
          const Collection = (await import('./models/collection')).default;
          const MovieCollection = (await import('./models/movieCollection')).default;
          const Album = (await import('./models/album')).default;
          const Track = (await import('./models/track')).default;
          const AlbumCollection = (await import('./models/albumCollection')).default;
          const Book = (await import('./models/book')).default;
          const BookComment = (await import('./models/bookComment')).default;
          const PlaylistHistory = (await import('./models/playlistHistory')).default;
          const MovieWarning = (await import('./models/movieWarning')).default;
          const MovieFilmages = (await import('./models/movieFilmages')).default;
          const AlbumStory = (await import('./models/albumStory')).default;
          const ReleaseGroupLookup = (await import('./models/releaseGroupLookup')).default;
          const AlbumNote = (await import('./models/albumNote')).default;
          const AlbumGuide = (await import('./models/albumGuide')).default;
          const TrackLyrics = (await import('./models/trackLyrics')).default;
          const ShelfItem = (await import('./models/shelfItem')).default;
          const ShelfFurniture = (await import('./models/shelfFurniture')).default;
          const NavidromePlay = (await import('./models/navidromePlay')).default;
          const NavidromeListener = (await import('./models/navidromeListener')).default;
          const ListenNextPlay = (await import('./models/listenNextPlay')).default;
          const Mixtape = (await import('./models/mixtape')).default;
          const TrackPopularity = (await import('./models/trackPopularity')).default;

          // Create all tables with their final schema
          await Movie.createTable();
          await MovieCast.createTable();
          await MovieCrew.createTable();
          await Collection.createTable();
          await MovieCollection.createTable();
          await Album.createTable();
          await Track.createTable();
          await AlbumCollection.createTable();
          await Book.createTable();
          await BookComment.createTable();
          await PlaylistHistory.createTable();
          await MovieWarning.createTable();
          await MovieFilmages.createTable();
          await AlbumStory.createTable();
          await ReleaseGroupLookup.createTable();
          await AlbumNote.createTable();
          await AlbumGuide.createTable();
          await TrackLyrics.createTable();
          await ShelfItem.createTable();
          await ShelfFurniture.createTable();
          await NavidromePlay.createTable();
          await NavidromeListener.createTable();
          await ListenNextPlay.createTable();
          await Mixtape.createTable();
          await TrackPopularity.createTable();

          // Run auto-migrations for schema updates
          await runAutoMigrations();

          // Initialize system collections
          try {
            await Collection.initializeSystemCollections();
          } catch (error) {
            console.error('Error initializing system collections:', error);
            // Don't block initialization
          }

          console.log('Database initialized successfully.');
        } catch (error) {
          console.error('Database creation error:', error);
          reject(error);
          return;
        }

        resolve(currentDb);
      }
    });
  });
};

const getDatabase = (): sqlite3.Database => {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
};

export {
  initDatabase,
  getDatabase
};
