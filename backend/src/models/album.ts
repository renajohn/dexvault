import type sqlite3 from 'sqlite3';
import { getDatabase } from '../database';
import cacheService from '../services/cacheService';
import { normalizeAlbumOwnership } from '../services/utils/albumOwnership';
import { combineRatings } from '../services/utils/communityRating';
import { isClassicalAlbum, type Performer } from '../services/shelfOrder';
import { findsAll, matchScore, searchWords } from '../utils/searchText';
import { normaliseAlbumQuery, takeBoolFilter, takeNumberFilter, findFilters, withoutWords } from '../utils/albumSearchFilters';
import type { AlbumRow, AlbumFormatted, AlbumCreateData, AlbumSearchParsed } from '../types';

interface AlbumUpdateResult {
  id: number;
  updated_at: string;
  [key: string]: unknown;
}

interface AlbumBackCoverResult {
  id: number;
  backCover: string;
  updated_at: string;
}

interface AlbumFrontCoverResult {
  id: number;
  cover: string;
  updated_at: string;
}

interface AlbumUrlsResult {
  id: number;
  urls: Record<string, string>;
  updated_at: string;
}

interface AlbumStatusResult {
  id: number;
  title_status: string;
}

interface AlbumToggleResult {
  id: number;
  action: 'added' | 'removed' | 'kept' | 'moved';
  medium?: 'digital' | 'cd';
}

interface AlbumAutocompleteRow {
  [key: string]: string | number | null;
}

interface ReleaseYearRow {
  release_year: number;
}

interface TrackTitleRow {
  title: string;
}

interface UrlsRow {
  urls: string | null;
}

const sanitizeUrls = (urls: Record<string, string | null> | undefined): Record<string, string> => {
  try {
    const obj = urls && typeof urls === 'object' ? urls : {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null) {
        // null means "explicitly delete this key" -- so skip it
        continue;
      }
      if (typeof v === 'string' && v.trim() === '') {
        // empty string means "no change" -- skip it
        continue;
      }
      // Otherwise keep the value
      if (typeof v === 'string') {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch (_) { return {}; }
};

/** Not a mixtape: what speaks of a disc (stars, files, rips) leaves the mixtapes out. */
const NOT_MIXTAPE = `COALESCE(title_status, 'owned') != 'playlist'`;

const Album = {
  createTable: (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = `
        CREATE TABLE IF NOT EXISTS albums (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          artist TEXT NOT NULL,
          title TEXT NOT NULL,
          release_year INTEGER,
          labels TEXT,
          catalog_number TEXT,
          barcode TEXT,
          country TEXT,
          edition_notes TEXT,
          genres TEXT,
          moods TEXT,
          tags TEXT,
          rating REAL,
          total_duration INTEGER,
          format TEXT,
          packaging TEXT,
          status TEXT,
          release_events TEXT,
          recording_quality TEXT CHECK(recording_quality IN ('demo', 'reference', 'good', 'average')),
          cover TEXT,
          back_cover TEXT,
          musicbrainz_release_id TEXT,
          discogs_release_id TEXT,
          musicbrainz_release_group_id TEXT,
          release_group_first_release_date INTEGER,
          release_group_type TEXT,
          release_group_secondary_types TEXT,
          condition TEXT CHECK(condition IN ('M', 'NM', 'VG+', 'VG')),
          ownership_notes TEXT,
          purchased_at TEXT,
          price_chf REAL,
          producer TEXT,
          engineer TEXT,
          recording_location TEXT,
          language TEXT,
          urls TEXT,
          isrc_codes TEXT,
          annotation TEXT,
          title_status TEXT DEFAULT 'owned' CHECK(title_status IN ('owned', 'wish', 'digital', 'playlist')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;
      db.run(sql, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          // Add new columns if they don't exist (for existing databases)
          const alterTablePromises: Promise<void>[] = [
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN producer TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN engineer TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN recording_location TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN language TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN urls TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN isrc_codes TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN annotation TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN back_cover TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN title_status TEXT DEFAULT 'owned'`, () => resolve());
            }),
            new Promise((resolve) => {
              // A half star (4.5) is kept as it is: SQLite stores in an INTEGER column what it cannot turn into one losslessly.
              db.run(`ALTER TABLE albums ADD COLUMN user_rating INTEGER`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN user_rating_synced INTEGER`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN discogs_release_id TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN rating_votes INTEGER`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN discogs_rating REAL`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN discogs_rating_votes INTEGER`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN navidrome_id TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN navidrome_gone_at TEXT`, () => resolve());
            }),
            new Promise((resolve) => {
              db.run(`ALTER TABLE albums ADD COLUMN file_quality TEXT`, () => resolve());
            })
          ];

          // Wait for all ALTER TABLE statements (ignore errors for existing columns)
          Promise.all(alterTablePromises).then(() => {
            // Create indexes for better performance
            const indexPromises: Promise<void>[] = [
              new Promise((resolve, reject) => {
                db.run(`CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist)`, (err: Error | null) => {
                  if (err) reject(err); else resolve();
                });
              }),
              new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            }),
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_albums_barcode ON albums(barcode)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            }),
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_albums_musicbrainz_id ON albums(musicbrainz_release_id)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            })
            ];

            Promise.all(indexPromises)
              .then(() => resolve())
              .catch(reject);
          });
        }
      });
    });
  },

  create: (cdData: AlbumCreateData): Promise<AlbumFormatted> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();
      const ownership = normalizeAlbumOwnership(cdData);

      const cd = {
        artist: JSON.stringify(cdData.artist || []),
        title: cdData.title,
        release_year: cdData.releaseYear || null,
        labels: JSON.stringify(cdData.labels || []),
        catalog_number: cdData.catalogNumber || null,
        barcode: cdData.barcode || null,
        country: cdData.country || null,
        edition_notes: cdData.editionNotes || null,
        genres: JSON.stringify(cdData.genres || []),
        moods: JSON.stringify([]), // Keep column but don't populate
        tags: JSON.stringify(cdData.tags || []),
        rating: cdData.rating || null,
        total_duration: cdData.totalDuration || null,
        format: cdData.format || null,
        packaging: cdData.packaging || null,
        status: cdData.status || null,
        release_events: JSON.stringify(cdData.releaseEvents || []),
        recording_quality: cdData.recordingQuality || null,
        cover: cdData.cover || null,
        back_cover: cdData.backCover || null,
        musicbrainz_release_id: cdData.musicbrainzReleaseId || null,
        discogs_release_id: cdData.discogsReleaseId || null,
        musicbrainz_release_group_id: cdData.musicbrainzReleaseGroupId || null,
        release_group_first_release_date: cdData.releaseGroupFirstReleaseDate || null,
        release_group_type: cdData.releaseGroupType || null,
        release_group_secondary_types: JSON.stringify(cdData.releaseGroupSecondaryTypes || []),
        condition: ownership.condition,
        ownership_notes: ownership.notes,
        // A CD added to the collection with no date of purchase was bought today.
        purchased_at: ownership.purchasedAt ?? ((cdData.titleStatus || 'owned') === 'owned' ? now.slice(0, 10) : null),
        price_chf: ownership.priceChf,
        producer: JSON.stringify(cdData.producer || []),
        engineer: JSON.stringify(cdData.engineer || []),
        recording_location: cdData.recordingLocation || null,
        language: cdData.language || null,
        urls: JSON.stringify(sanitizeUrls(cdData.urls)),
        isrc_codes: JSON.stringify(cdData.isrcCodes || []),
        annotation: cdData.annotation || null,
        title_status: cdData.titleStatus || 'owned',
        created_at: now,
        updated_at: now
      };

      const sql = `
        INSERT INTO albums (
          artist, title, release_year, labels, catalog_number, barcode,
          country, edition_notes, genres, moods, tags, rating, total_duration,
          format, packaging, status, release_events, recording_quality, cover, back_cover,
          musicbrainz_release_id, discogs_release_id, musicbrainz_release_group_id, release_group_first_release_date,
          release_group_type, release_group_secondary_types, condition, ownership_notes, purchased_at,
          price_chf, producer, engineer, recording_location, language, urls, isrc_codes, annotation, title_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        cd.artist, cd.title, cd.release_year, cd.labels, cd.catalog_number,
        cd.barcode, cd.country, cd.edition_notes, cd.genres, cd.moods, cd.tags,
        cd.rating, cd.total_duration, cd.format, cd.packaging, cd.status, cd.release_events,
        cd.recording_quality, cd.cover, cd.back_cover, cd.musicbrainz_release_id, cd.discogs_release_id, cd.musicbrainz_release_group_id,
        cd.release_group_first_release_date, cd.release_group_type, cd.release_group_secondary_types,
        cd.condition, cd.ownership_notes, cd.purchased_at, cd.price_chf,
        cd.producer, cd.engineer, cd.recording_location, cd.language, cd.urls, cd.isrc_codes, cd.annotation, cd.title_status,
        cd.created_at, cd.updated_at
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when album is created
          await cacheService.invalidateAnalytics();

          // Get the created album with proper formatting
          db.get('SELECT * FROM albums WHERE id = ?', [this.lastID], (err: Error | null, row: AlbumRow | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve(Album.formatRow(row!)!);
            }
          });
        }
      });
    });
  },

  findById: (id: number): Promise<AlbumFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM albums WHERE id = ?';

      db.get(sql, [id], (err: Error | null, row: AlbumRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Album.formatRow(row));
        }
      });
    });
  },

  findAll: (): Promise<AlbumFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM albums WHERE (title_status = ? OR title_status IS NULL) ORDER BY artist, title';

      db.all(sql, ['owned'], (err: Error | null, rows: AlbumRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Album.formatRow).filter((r): r is AlbumFormatted => r !== null));
        }
      });
    });
  },

  findByBarcode: (barcode: string): Promise<AlbumFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM albums WHERE barcode = ?';

      db.get(sql, [barcode], (err: Error | null, row: AlbumRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Album.formatRow(row));
        }
      });
    });
  },

  findByMusicbrainzId: (musicbrainzId: string): Promise<AlbumFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM albums WHERE musicbrainz_release_id = ?';

      db.get(sql, [musicbrainzId], (err: Error | null, row: AlbumRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(Album.formatRow(row));
        }
      });
    });
  },

  /** Discogs is the primary source, so its id needs the same lookup. */
  findByDiscogsId: (discogsId: string): Promise<AlbumFormatted | null> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      db.get(
        'SELECT * FROM albums WHERE discogs_release_id = ?',
        [discogsId],
        (err: Error | null, row: AlbumRow | undefined) => {
          if (err) reject(err);
          else resolve(row ? Album.formatRow(row) : null);
        }
      );
    });
  },

  findByStatus: (status: string): Promise<AlbumFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM albums WHERE title_status = ? ORDER BY artist, title';

      db.all(sql, [status], (err: Error | null, rows: AlbumRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Album.formatRow).filter((r): r is AlbumFormatted => r !== null));
        }
      });
    });
  },

  updateStatus: (id: number, status: string): Promise<AlbumStatusResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      // A CD that joins the collection, wished or digital until now, is added today, "last added" sorts by it,
      // and bought today unless it says otherwise.
      const joins = `? = 'owned' AND COALESCE(title_status, 'owned') != 'owned'`;
      const sql = `UPDATE albums SET title_status = ?, updated_at = ?,
        created_at = CASE WHEN ${joins} THEN ? ELSE created_at END,
        purchased_at = CASE WHEN ${joins} THEN COALESCE(purchased_at, ?) ELSE purchased_at END
        WHERE id = ?`;
      const now = new Date().toISOString();

      db.run(sql, [status, now, status, now, status, now.slice(0, 10), id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, title_status: status });
        }
      });
    });
  },

  /** How a CD was bought: its condition, when, for how much, and what to remember of it. */
  setOwnership: (id: number, ownership: { condition: string | null; notes: string | null; purchasedAt: string | null; priceChf: number | null }): Promise<void> =>
    new Promise((resolve, reject) => {
      getDatabase().run(
        'UPDATE albums SET condition = ?, ownership_notes = ?, purchased_at = ?, price_chf = ?, updated_at = ? WHERE id = ?',
        [ownership.condition, ownership.notes, ownership.purchasedAt, ownership.priceChf, new Date().toISOString(), id],
        (err: Error | null) => { if (err) reject(err); else resolve(); });
    }),

  setFormat: (id: number, format: string): Promise<void> =>
    new Promise((resolve, reject) => {
      getDatabase().run('UPDATE albums SET format = ?, updated_at = ? WHERE id = ?', [format, new Date().toISOString(), id],
        (err: Error | null) => { if (err) reject(err); else resolve(); });
    }),

  /** Ties an album to the Navidrome album it stands for, and notes whether Navidrome still has it. */
  setNavidrome: (id: number, navidromeId: string | null, goneAt: string | null = null): Promise<void> =>
    new Promise((resolve, reject) => {
      getDatabase().run(
        'UPDATE albums SET navidrome_id = ?, navidrome_gone_at = ?, updated_at = ? WHERE id = ?',
        [navidromeId, goneAt, new Date().toISOString(), id],
        (err: Error | null) => { if (err) reject(err); else resolve(); });
    }),

  /** How good the album's files in Navidrome are: lossless, near, lossy, 'none' for a CD not ripped, null unknown. */
  setFileQuality: (id: number, quality: string | null): Promise<void> =>
    new Promise((resolve, reject) => {
      getDatabase().run('UPDATE albums SET file_quality = ? WHERE id = ?', [quality, id],
        (err: Error | null) => { if (err) reject(err); else resolve(); });
    }),

  // Helper function to parse enhanced search query syntax for albums
  // Supports: OR (genre:rock,jazz), negation (-artist:Beatles), ranges (year:2020-2024)
  // Also supports mixed quoted/unquoted: title:21,Absolution,"Anthology 1"
  _parseSearchQuery: (query: string): AlbumSearchParsed => {
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    let hasFilters = false;
    let hasTrackFilter = false;
    // !key: is -key:, by: is artist: (the search pills write them so, a link may not).
    let cleanedQuery = normaliseAlbumQuery(query);

    const columnMap: Record<string, string> = {
      'artist': 'artist', 'title': 'title', 'genre': 'genres', 'mood': 'moods',
      'label': 'labels', 'country': 'country', 'track': 'track',
      'composer': 'composer', 'performer': 'performer', 'conductor': 'conductor', 'instrument': 'instrument', 'work': 'work'
    };

    // What a track credits, read from its JSON lists: an album matches when one of its tracks does.
    const onTrack = (condition: string) => `EXISTS (SELECT 1 FROM tracks WHERE tracks.album_id = albums.id AND ${condition})`;
    const byPerformer = (condition: string) =>
      onTrack(`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(tracks.performers) THEN tracks.performers ELSE '[]' END) p WHERE ${condition})`);
    const trackClauses: Record<string, () => string> = {
      track: () => onTrack('tracks.title LIKE ?'),
      composer: () => onTrack('tracks.composers LIKE ?'),
      work: () => onTrack('tracks.work LIKE ?'),
      performer: () => byPerformer(`json_extract(p.value, '$.name') LIKE ?`),
      conductor: () => byPerformer(`json_extract(p.value, '$.name') LIKE ? AND json_extract(p.value, '$.role') LIKE '%conduct%'`),
      instrument: () => byPerformer(`json_extract(p.value, '$.role') LIKE ?`),
    };

    // Helper: build clause for single/multiple values
    const buildClause = (column: string, values: string[], negate: boolean = false): string => {
      if (trackClauses[column]) {
        hasTrackFilter = true;
        const clauses = values.map(v => {
          params.push(`%${v}%`);
          return trackClauses[column]();
        });
        const combined = clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
        return negate ? `NOT ${combined}` : combined;
      }
      if (column === 'artist') {
        // A compilation names its artists on each track, not on the album.
        const clauses = values.map(v => {
          params.push(`%${v}%`, `%${v}%`);
          return `(artist LIKE ? OR ${onTrack('tracks.artist LIKE ?')})`;
        });
        const combined = clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
        return negate ? `NOT ${combined}` : combined;
      }
      // An album with no label or genre at all is not one with that label: -label:ECM keeps it.
      const col = negate ? `COALESCE(${column}, '')` : column;
      if (values.length === 1) {
        params.push(`%${values[0]}%`);
        return negate ? `${col} NOT LIKE ?` : `${col} LIKE ?`;
      }
      const clauses = values.map(v => { params.push(`%${v}%`); return `${col} LIKE ?`; });
      const orClause = `(${clauses.join(' OR ')})`;
      return negate ? `NOT ${orClause}` : orClause;
    };

    // Helper: parse comma-separated values respecting quotes
    // Handles: value1,value2,"value with spaces","another value"
    const parseCommaSeparatedValues = (valueStr: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < valueStr.length; i++) {
        const char = valueStr[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          if (current.trim()) values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) values.push(current.trim());
      return values.filter(v => v);
    };

    // Helper: extract filter value including quoted parts with spaces
    // Matches: field:value or field:val1,val2,"val 3" until next unquoted space or end
    const extractFilterValue = (text: string, startIndex: number): { value: string; endIndex: number } => {
      let value = '';
      let inQuotes = false;
      let i = startIndex;

      while (i < text.length) {
        const char = text[i];
        if (char === '"') {
          inQuotes = !inQuotes;
          value += char;
        } else if (char === ' ' && !inQuotes) {
          break; // End of filter value
        } else {
          value += char;
        }
        i++;
      }
      return { value, endIndex: i };
    };

    // Process filters with smart value extraction
    const fields = 'artist|title|genre|mood|track|label|country|composer|performer|conductor|instrument|work';

    // Pattern for negated filters: -field:... (!field: is written -field: by now), any case
    const negFilterRe = new RegExp(`(?<=^|\\s)-(${fields}):`, 'gi');
    let match: RegExpExecArray | null;
    const negMatches: Array<{ field: string; value: string; fullMatch: string }> = [];
    while ((match = negFilterRe.exec(cleanedQuery)) !== null) {
      const field = match[1];
      const valueStart = match.index + match[0].length;
      const { value, endIndex } = extractFilterValue(cleanedQuery, valueStart);
      if (value) {
        negMatches.push({ field, value, fullMatch: cleanedQuery.substring(match.index, endIndex) });
      }
    }

    // Process negated matches (in reverse to preserve indices when removing)
    for (const m of negMatches.reverse()) {
      hasFilters = true;
      const col = columnMap[m.field.toLowerCase()];
      if (col) {
        const vals = parseCommaSeparatedValues(m.value);
        whereClauses.push(buildClause(col, vals, true));
        cleanedQuery = cleanedQuery.replace(m.fullMatch, ' ').trim();
      }
    }

    // Pattern for regular filters: field:... standing as a word of its own (the negated ones are gone)
    const posFilterRe = new RegExp(`(?<=^|\\s)(${fields}):`, 'gi');
    const posMatches: Array<{ field: string; value: string; fullMatch: string }> = [];
    while ((match = posFilterRe.exec(cleanedQuery)) !== null) {
      const field = match[1];
      const valueStart = match.index + match[0].length;
      const { value, endIndex } = extractFilterValue(cleanedQuery, valueStart);
      if (value) {
        posMatches.push({ field, value, fullMatch: cleanedQuery.substring(match.index, endIndex) });
      }
    }

    // Process positive matches (in reverse to preserve indices when removing)
    for (const m of posMatches.reverse()) {
      hasFilters = true;
      const col = columnMap[m.field.toLowerCase()];
      if (col) {
        const vals = parseCommaSeparatedValues(m.value);
        whereClauses.push(buildClause(col, vals, false));
        cleanedQuery = cleanedQuery.replace(m.fullMatch, ' ').trim();
      }
    }

    // Numbers: year:1960-1969, year:>=2020, -year:1990, stars:>=3.5, stars:5,0; values ORed, `-` excludes.
    // stars:0 is not rated; a mixtape has no stars of its own, so stars: leaves the mixtapes out.
    for (const [key, column] of [['year', 'release_year'], ['stars', 'COALESCE(user_rating, 0)']] as const) {
      const taken = takeNumberFilter(cleanedQuery, key, column);
      if (!taken.clauses.length) continue;
      hasFilters = true;
      whereClauses.push(...taken.clauses);
      params.push(...taken.params);
      if (key === 'stars') whereClauses.push(NOT_MIXTAPE);
      cleanedQuery = taken.rest;
    }

    // yes/no filters, each with what yes and what no keep (true/false, with/without, y/n, 1/0 too; -cd:yes is cd:no).
    const bools: Array<[string, string, string, boolean?]> = [
      // Whether the album is a CD of the collection: cd:no is what one has only as files, or wishes.
      ['cd', `COALESCE(title_status, 'owned') = 'owned'`, `title_status IN ('digital', 'wish')`],
      // Whether a CD of the collection is in Navidrome: ripped:no is what is left to rip.
      ['ripped', `COALESCE(title_status, 'owned') = 'owned' AND file_quality IN ('lossless', 'near', 'lossy')`,
        `COALESCE(title_status, 'owned') = 'owned' AND file_quality = 'none'`],
      // Whether the owner has given the album stars: rated:no is what is left to listen to. No mixtape.
      ['rated', `user_rating > 0`, `(user_rating IS NULL OR user_rating = 0)`, true],
      // mixtape:yes, the mixtapes alone; mixtape:no, the albums.
      ['mixtape', `title_status = 'playlist'`, NOT_MIXTAPE],
    ];
    for (const [key, yes, no, noMixtape] of bools) {
      const { allowed, rest } = takeBoolFilter(cleanedQuery, key);
      if (!allowed) continue;
      hasFilters = true;
      cleanedQuery = rest;
      if (allowed.length === 0) whereClauses.push('0');
      else if (allowed.length === 1) whereClauses.push(`(${allowed[0] ? yes : no})`);
      if (noMixtape) whereClauses.push(NOT_MIXTAPE);
    }

    // How good its files are, as the last reading of Navidrome found them: near-lossless counts as lossless.
    // file:lossless,lossy is either; -file:lossy everything but the lossy ones.
    const qualities: Record<string, string[]> = { lossless: ['lossless', 'near'], lossy: ['lossy'] };
    const fileWords = findFilters(cleanedQuery, 'file');
    const fileTaken: string[] = [];
    for (const word of fileWords) {
      const values = word.values.map(v => v.toLowerCase());
      if (!values.length || values.some(v => !qualities[v])) continue;
      const wanted = [...new Set(values.flatMap(v => qualities[v]))];
      const marks = wanted.map(() => '?').join(', ');
      whereClauses.push(word.neg ? `COALESCE(file_quality, '') NOT IN (${marks})` : `file_quality IN (${marks})`);
      params.push(...wanted);
      fileTaken.push(word.text);
      hasFilters = true;
    }
    cleanedQuery = withoutWords(cleanedQuery, fileTaken);

    return { params, whereClauses, hasFilters, hasTrackFilter, cleanedQuery: cleanedQuery.trim() };
  },

  /**
   * The albums a query finds. `classical:yes` keeps the classical CDs, and
   * `classical:no` the others, told apart as the shelves tell them: by their
   * genres, by the roles of their performers when they have none, or by the
   * section the owner set by hand.
   */
  search: async (query: string, { withNoCd = false, mixtapes = false }: { withNoCd?: boolean; mixtapes?: boolean } = {}): Promise<AlbumFormatted[]> => {
    // classical:yes, classical:no, -classical:yes, classical:true… (albumSearchFilters).
    const { allowed, rest } = takeBoolFilter(normaliseAlbumQuery(query), 'classical');
    if (!allowed) return Album.searchAll(query, withNoCd, mixtapes);
    if (allowed.length === 0) return [];
    const albums = await Album.searchAll(rest, withNoCd, mixtapes);
    if (albums.length === 0 || allowed.length === 2) return albums;
    const want = allowed[0];
    const ids = albums.map(album => album.id);
    const marks = ids.map(() => '?').join(',');
    const all = <T>(sql: string): Promise<T[]> => new Promise((resolve, reject) =>
      getDatabase().all(sql, ids, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));
    const [tracks, sections] = await Promise.all([
      all<{ album_id: number; performers: string | null }>(`SELECT album_id, performers FROM tracks WHERE album_id IN (${marks})`),
      all<{ item_id: number; section: string | null }>(`SELECT item_id, section FROM shelf_items WHERE kind = 'album' AND item_id IN (${marks})`),
    ]);
    const performersOf = new Map<number, Performer[]>();
    for (const track of tracks) {
      let list: Performer[] = [];
      try { list = JSON.parse(track.performers || '[]'); } catch { /* unreadable credits count as none */ }
      performersOf.set(track.album_id, [...(performersOf.get(track.album_id) || []), ...(Array.isArray(list) ? list : [])]);
    }
    const sectionOf = new Map(sections.map(row => [row.item_id, row.section]));
    return albums.filter(album => {
      const section = sectionOf.get(album.id);
      const isClassical = section === 'classical' || section === 'music'
        ? section === 'classical'
        : isClassicalAlbum(album.genres || [], performersOf.get(album.id) || []);
      return isClassical === want;
    });
  },

  /**
   * The CDs of the collection a query finds; with `withNoCd`, the digital
   * albums and the wishes too; with `mixtapes`, the mixtapes alone, found by
   * their name, their songs' titles and artists.
   */
  searchAll: async (query: string, withNoCd = false, mixtapes = false): Promise<AlbumFormatted[]> => {
    const db = getDatabase();
    const statuses = mixtapes ? `('playlist')` : withNoCd ? `('owned', 'digital', 'wish')` : `('owned')`;

    // The filters in SQL (supports OR, negation, ranges); the plain words after, without their accents.
    const { params, whereClauses, hasTrackFilter, cleanedQuery } = Album._parseSearchQuery(query);
    const words = searchWords(cleanedQuery);
    const whereClause = whereClauses.length > 0 ? whereClauses.join(' AND ') : '1=1';
    const sql = `
      SELECT ${hasTrackFilter ? 'DISTINCT' : ''} albums.* FROM albums
      WHERE ${whereClause}
      AND COALESCE(title_status, 'owned') IN ${statuses}
      ORDER BY artist, title
    `;
    const rows = await new Promise<AlbumRow[]>((resolve, reject) =>
      db.all(sql, params, (err: Error | null, found: AlbumRow[]) => (err ? reject(err) : resolve(found))));
    const albums = rows.map(Album.formatRow).filter((r): r is AlbumFormatted => r !== null);
    if (!words.length || !albums.length) return albums;

    // Each word in the album or in what its tracks credit: a conductor, a soloist, a composer, a work;
    // a mixtape's songs by their titles.
    // How well they name it: its title or its artist first, the shelf showing the best first while they are typed.
    const tracksText = await Album._tracksText(rows.map(row => row.id));
    return albums.flatMap((album, i) => {
      const row = rows[i];
      const credits = tracksText.get(album.id);
      if (!findsAll(words, [row.title, row.artist, row.labels, row.genres, credits])) return [];
      return [{ ...album, matchScore: matchScore(words, [[row.title, 1], [row.artist, 1], [credits, 0.6], [row.labels, 0.4], [row.genres, 0.4]]) }];
    });
  },

  /** What an album's tracks credit, as one text per album: composers, performers, work, artist; a mixtape's titles too. */
  _tracksText: (albumIds: number[]): Promise<Map<number, string>> => new Promise((resolve, reject) => {
    const marks = albumIds.map(() => '?').join(',');
    getDatabase().all(
      `SELECT tracks.album_id, GROUP_CONCAT(
         COALESCE(tracks.composers, '') || ' ' || COALESCE(tracks.performers, '') || ' ' || COALESCE(tracks.work, '') || ' ' ||
         COALESCE(tracks.artist, '') || CASE WHEN albums.title_status = 'playlist' THEN ' ' || COALESCE(tracks.title, '') ELSE '' END,
         char(10)) AS text
       FROM tracks JOIN albums ON albums.id = tracks.album_id
       WHERE tracks.album_id IN (${marks})
       GROUP BY tracks.album_id`,
      albumIds,
      (err: Error | null, rows: Array<{ album_id: number; text: string | null }>) =>
        (err ? reject(err) : resolve(new Map(rows.map(row => [row.album_id, row.text || ''])))));
  }),

  update: (id: number, cdData: AlbumCreateData): Promise<AlbumUpdateResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();
      const ownership = normalizeAlbumOwnership(cdData);

      const sql = `
        UPDATE albums SET
          artist = ?, title = ?, release_year = ?, labels = ?, catalog_number = ?,
          barcode = ?, country = ?, edition_notes = ?, genres = ?, moods = ?,
          recording_quality = ?, cover = COALESCE(?, cover), back_cover = COALESCE(?, back_cover),
          format = ?, musicbrainz_release_id = ?,
          musicbrainz_release_group_id = ?, release_group_first_release_date = ?,
          release_group_type = ?, release_group_secondary_types = ?,
          condition = ?, ownership_notes = ?, purchased_at = ?, price_chf = ?,
          producer = ?, engineer = ?, recording_location = ?, language = ?, urls = ?, isrc_codes = ?, annotation = ?, title_status = ?,
          updated_at = ?
        WHERE id = ?
      `;

      const params = [
        JSON.stringify(cdData.artist || []),
        cdData.title,
        cdData.releaseYear || null,
        JSON.stringify(cdData.labels || []),
        cdData.catalogNumber || null,
        cdData.barcode || null,
        cdData.country || null,
        cdData.editionNotes || null,
        JSON.stringify(cdData.genres || []),
        JSON.stringify([]), // Keep column but don't populate
        cdData.recordingQuality || null,
        // COALESCE above: an edit that does not carry a cover must not erase it.
        // Use updateFrontCover/updateBackCover to change or clear them.
        cdData.cover || null,
        cdData.backCover || null,
        cdData.format || 'CD',
        cdData.musicbrainzReleaseId || null,
        cdData.musicbrainzReleaseGroupId || null,
        cdData.releaseGroupFirstReleaseDate || null,
        cdData.releaseGroupType || null,
        JSON.stringify(cdData.releaseGroupSecondaryTypes || []),
        ownership.condition,
        ownership.notes,
        ownership.purchasedAt,
        ownership.priceChf,
        JSON.stringify(cdData.producer || []),
        JSON.stringify(cdData.engineer || []),
        cdData.recordingLocation || null,
        cdData.language || null,
        JSON.stringify(sanitizeUrls(cdData.urls)),
        JSON.stringify(cdData.isrcCodes || []),
        cdData.annotation || null,
        cdData.titleStatus || 'owned',
        now,
        id
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when album is updated
          await cacheService.invalidateAnalytics();
          resolve({ id, ...cdData, updated_at: now });
        }
      });
    });
  },

  updateBackCover: (id: number, backCoverPath: string): Promise<AlbumBackCoverResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const sql = 'UPDATE albums SET back_cover = ?, updated_at = ? WHERE id = ?';

      db.run(sql, [backCoverPath, now, id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, backCover: backCoverPath, updated_at: now });
        }
      });
    });
  },

  updateFrontCover: (id: number, frontCoverPath: string): Promise<AlbumFrontCoverResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const sql = 'UPDATE albums SET cover = ?, updated_at = ? WHERE id = ?';

      db.run(sql, [frontCoverPath, now, id], function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, cover: frontCoverPath, updated_at: now });
        }
      });
    });
  },

  /** Fills in a release group id found after the fact; never overwrites one. */
  setReleaseGroupId: (id: number, releaseGroupId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      getDatabase().run(
        'UPDATE albums SET musicbrainz_release_group_id = ? WHERE id = ? AND musicbrainz_release_group_id IS NULL',
        [releaseGroupId, id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  },

  /**
   * Writes a few columns as they are given, for the refresh from MusicBrainz:
   * the caller decides what is missing, this only refuses unknown columns.
   */
  setColumns: (id: number, columns: Record<string, string | number | null>): Promise<void> => {
    const allowed = ['producer', 'engineer', 'recording_location', 'isrc_codes', 'total_duration', 'annotation', 'genres', 'urls', 'rating',
      'rating_votes', 'discogs_rating', 'discogs_rating_votes'];
    const names = Object.keys(columns);
    const unknown = names.filter(name => !allowed.includes(name));
    if (unknown.length > 0) return Promise.reject(new Error(`Unknown album columns: ${unknown.join(', ')}`));
    if (names.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      getDatabase().run(
        `UPDATE albums SET ${names.map(name => `${name} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...names.map(name => columns[name]), new Date().toISOString(), id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  },

  /**
   * Replaces the edition with the one the CD itself was identified as, by its
   * disc ID in Picard: the edition picked when adding the album was often
   * just the first of its pressings.
   */
  replaceReleaseId: (id: number, releaseId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      getDatabase().run(
        'UPDATE albums SET musicbrainz_release_id = ?, updated_at = ? WHERE id = ?',
        [releaseId, new Date().toISOString(), id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  },

  /** Fills in the exact edition found after the fact; never overwrites one. */
  setReleaseId: (id: number, releaseId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      getDatabase().run(
        'UPDATE albums SET musicbrainz_release_id = ? WHERE id = ? AND musicbrainz_release_id IS NULL',
        [releaseId, id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  },

  updateUrls: (id: number, newUrls: Record<string, string>): Promise<AlbumUrlsResult> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      // First fetch existing urls to merge
      db.get('SELECT urls FROM albums WHERE id = ?', [id], (err: Error | null, row: UrlsRow | undefined) => {
        if (err) {
          return reject(err);
        }
        const existingUrls: Record<string, string> = row && row.urls ? JSON.parse(row.urls) : {};
        const merged: Record<string, string> = { ...existingUrls, ...newUrls };

        const sql = 'UPDATE albums SET urls = ?, updated_at = ? WHERE id = ?';
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
      const sql = 'DELETE FROM albums WHERE id = ?';

      db.run(sql, [id], async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when album is deleted
          await cacheService.invalidateAnalytics();
          resolve({ deleted: this.changes > 0 });
        }
      });
    });
  },

  /**
   * The owner's stars, apart from the album's other fields so that saving the
   * edit form never resets them. `synced` is what Navidrome holds as well,
   * when known; left undefined, the last agreed value stays.
   */
  setUserRating: (id: number, rating: number | null, synced?: number | null): Promise<void> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = synced === undefined
        ? 'UPDATE albums SET user_rating = ? WHERE id = ?'
        : 'UPDATE albums SET user_rating = ?, user_rating_synced = ? WHERE id = ?';
      const params = synced === undefined ? [rating, id] : [rating, synced, id];
      db.run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  },

  /** How many albums of the collection (bought, CD or digital) hold each number of stars, halves apart. */
  countRatings: (): Promise<Array<{ stars: number; count: number }>> => {
    return new Promise((resolve, reject) => {
      getDatabase().all(
        `SELECT user_rating AS stars, COUNT(*) AS count FROM albums
          WHERE user_rating > 0 AND COALESCE(title_status, 'owned') IN ('owned', 'digital')
          GROUP BY user_rating ORDER BY user_rating`,
        [],
        (err: Error | null, rows: Array<{ stars: number; count: number }>) => (err ? reject(err) : resolve(rows)),
      );
    });
  },

  /** The stars of every album with what was last agreed with Navidrome. */
  findRatings: (): Promise<Array<{ id: number; userRating: number | null; synced: number | null }>> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      db.all('SELECT id, user_rating, user_rating_synced FROM albums', [], (err: Error | null, rows: Array<{ id: number; user_rating: number | null; user_rating_synced: number | null }>) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({ id: row.id, userRating: row.user_rating, synced: row.user_rating_synced })));
      });
    });
  },

  formatRow: (row: AlbumRow): AlbumFormatted | null => {
    if (!row) return null;

    return {
      id: row.id,
      artist: JSON.parse(row.artist || '[]'),
      title: row.title,
      releaseYear: row.release_year,
      labels: JSON.parse(row.labels || '[]'),
      catalogNumber: row.catalog_number,
      barcode: row.barcode,
      country: row.country,
      editionNotes: row.edition_notes,
      genres: JSON.parse(row.genres || '[]'),
      moods: JSON.parse(row.moods || '[]'), // Keep in response but will be empty
      tags: JSON.parse(row.tags || '[]'),
      rating: row.rating,
      ratingVotes: row.rating_votes ?? null,
      discogsRating: row.discogs_rating ?? null,
      discogsRatingVotes: row.discogs_rating_votes ?? null,
      ...(() => {
        const community = combineRatings(
          { value: row.rating, votes: row.rating_votes },
          { value: row.discogs_rating, votes: row.discogs_rating_votes }
        );
        return { communityRating: community.value, communityVotes: community.votes };
      })(),
      totalDuration: row.total_duration,
      format: row.format,
      packaging: row.packaging,
      status: row.status,
      releaseEvents: JSON.parse(row.release_events || '[]'),
      recordingQuality: row.recording_quality,
      cover: row.cover,
      backCover: row.back_cover,
      musicbrainzReleaseId: row.musicbrainz_release_id,
      musicbrainzReleaseGroupId: row.musicbrainz_release_group_id,
      releaseGroupFirstReleaseDate: row.release_group_first_release_date,
      releaseGroupType: row.release_group_type,
      releaseGroupSecondaryTypes: JSON.parse(row.release_group_secondary_types || '[]'),
      ownership: {
        condition: row.condition,
        notes: row.ownership_notes,
        purchasedAt: row.purchased_at,
        priceChf: row.price_chf
      },
      producer: JSON.parse(row.producer || '[]'),
      engineer: JSON.parse(row.engineer || '[]'),
      recordingLocation: row.recording_location,
      language: row.language,
      urls: JSON.parse(row.urls || '{}'),
      isrcCodes: JSON.parse(row.isrc_codes || '[]'),
      annotation: row.annotation,
      discogsReleaseId: row.discogs_release_id ?? null,
      titleStatus: row.title_status,
      spokenFor: row.spoken_for === 1,
      userRating: row.user_rating ?? null,
      navidromeId: row.navidrome_id ?? null,
      navidromeGoneAt: row.navidrome_gone_at ?? null,
      fileQuality: row.file_quality ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  /**
   * What a search keyword may go on with, from the albums searched: the CDs
   * and the wishes, and the digital albums only `withNoCd`, as MusicDex
   * shows them with Digital on.
   */
  autocomplete: (field: string, value: string, withNoCd = false): Promise<Record<string, string | number | null>[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const shown = withNoCd ? NOT_MIXTAPE : `COALESCE(title_status, 'owned') != 'digital' AND ${NOT_MIXTAPE}`;
      const shownTracks = `tracks.album_id IN (SELECT id FROM albums WHERE ${shown})`;

      // Validate field to prevent SQL injection (accept singular forms)
      const allowedFields = ['title', 'artist', 'genre', 'mood', 'track', 'label', 'country', 'year', 'composer', 'performer', 'conductor', 'instrument', 'work'];
      if (!allowedFields.includes(field)) {
        return reject(new Error(`Invalid field: ${field}`));
      }

      // The names credited on tracks, read from their JSON lists.
      const credits: Record<string, string> = {
        composer: `SELECT DISTINCT c.value AS name FROM tracks, json_each(CASE WHEN json_valid(tracks.composers) THEN tracks.composers ELSE '[]' END) c WHERE c.value LIKE ? AND ${shownTracks}`,
        work: `SELECT DISTINCT work AS name FROM tracks WHERE work LIKE ? AND ${shownTracks}`,
        performer: `SELECT DISTINCT json_extract(p.value, '$.name') AS name FROM tracks, json_each(CASE WHEN json_valid(tracks.performers) THEN tracks.performers ELSE '[]' END) p WHERE json_extract(p.value, '$.name') LIKE ? AND ${shownTracks}`,
        conductor: `SELECT DISTINCT json_extract(p.value, '$.name') AS name FROM tracks, json_each(CASE WHEN json_valid(tracks.performers) THEN tracks.performers ELSE '[]' END) p WHERE json_extract(p.value, '$.name') LIKE ? AND json_extract(p.value, '$.role') LIKE '%conduct%' AND ${shownTracks}`,
        instrument: `SELECT DISTINCT json_extract(p.value, '$.role') AS name FROM tracks, json_each(CASE WHEN json_valid(tracks.performers) THEN tracks.performers ELSE '[]' END) p WHERE json_extract(p.value, '$.role') LIKE ? AND ${shownTracks}`,
      };
      if (credits[field]) {
        db.all(`${credits[field]} ORDER BY name LIMIT 20`, [`%${value}%`], (err: Error | null, rows: Array<{ name: string | null }>) => {
          if (err) reject(err);
          else resolve(rows.filter(row => row.name).map(row => ({ [field]: row.name })));
        });
        return;
      }

      // Handle track autocomplete separately (from tracks table)
      if (field === 'track') {
        const sql = `
          SELECT DISTINCT title
          FROM tracks
          WHERE title LIKE ? AND ${shownTracks}
          ORDER BY title
          LIMIT 20
        `;
        const searchTerm = `%${value}%`;

        db.all(sql, [searchTerm], (err: Error | null, rows: TrackTitleRow[]) => {
          if (err) {
            reject(err);
          } else {
            // Return rows with 'track' as the field name
            resolve(rows.map(row => ({ track: row.title })));
          }
        });
        return;
      }

      // Handle year autocomplete (numeric field)
      if (field === 'year') {
        const sql = `
          SELECT DISTINCT release_year
          FROM albums
          WHERE release_year IS NOT NULL AND ${shown}
          ${value ? 'AND CAST(release_year AS TEXT) LIKE ?' : ''}
          ORDER BY release_year DESC
          LIMIT 20
        `;
        const params: string[] = value ? [`${value}%`] : [];

        db.all(sql, params, (err: Error | null, rows: ReleaseYearRow[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map(row => ({ year: row.release_year })));
          }
        });
        return;
      }

      // Map 'genre' to its plural database column name. The map doubles as the
      // allowlist: falling back to the raw field would put an unchecked name
      // straight into the query below.
      const columnMap: Record<string, string> = {
        'title': 'title',
        'artist': 'artist',
        'genre': 'genres',
        'mood': 'moods',
        'label': 'labels',
        'country': 'country'
      };
      const column = columnMap[field];
      if (!column) {
        return reject(new Error(`Invalid field: ${field}`));
      }

      const sql = `
        SELECT DISTINCT ${column}
        FROM albums
        WHERE ${column} LIKE ? AND ${shown}
        ORDER BY ${column}
        LIMIT 20
      `;
      const searchTerm = `%${value}%`;

      db.all(sql, [searchTerm], (err: Error | null, rows: AlbumAutocompleteRow[]) => {
        if (err) {
          reject(err);
        } else {
          // Return rows with the requested field name (not the column name)
          resolve(rows.map(row => ({ [field]: row[column] })));
        }
      });
    });
  },

  /**
   * Listen Next from an album's button: with no disc, the whole album in, or
   * whatever of it is there out; 'all' or a disc as musicCollectionService.setListenNext.
   */
  toggleListenNext: async (id: number, choice?: 'all' | number, medium?: 'digital' | 'cd'): Promise<AlbumToggleResult> => {
    const musicCollectionService = (await import('../services/musicCollectionService')).default;
    return musicCollectionService.setListenNext(id, choice, medium);
  }
};

export default Album;
