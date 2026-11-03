import { getDatabase } from '../database';

/** A track's popularity, by its place on the album: its rank on Deezer, its listens on ListenBrainz. */
export interface TrackRank {
  discNumber: number;
  trackNumber: number;
  rank: number | null;
  listens: number | null;
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) => getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

/**
 * How much each track of an album is listened to, to point at the
 * few that stand out. Kept by disc and position rather than on the tracks,
 * which an edit of the album deletes and writes again.
 */
const TrackPopularity = {
  createTable: async (): Promise<void> => {
    await run(`CREATE TABLE IF NOT EXISTS track_popularity (
      album_id INTEGER NOT NULL,
      disc_number INTEGER NOT NULL,
      track_number INTEGER NOT NULL,
      deezer_rank INTEGER,
      listens INTEGER,
      PRIMARY KEY (album_id, disc_number, track_number),
      FOREIGN KEY (album_id) REFERENCES albums (id) ON DELETE CASCADE
    )`);
    // When each album was last looked up, found on Deezer or not, so that it is not asked again every time.
    await run(`CREATE TABLE IF NOT EXISTS album_popularity (
      album_id INTEGER PRIMARY KEY,
      deezer_album_id TEXT,
      checked_at DATETIME NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums (id) ON DELETE CASCADE
    )`);
  },

  /** Replaces an album's ranks with those just read; none when neither source has it. */
  save: async (albumId: number, deezerAlbumId: string | null, ranks: TrackRank[]): Promise<void> => {
    await run('DELETE FROM track_popularity WHERE album_id = ?', [albumId]);
    for (const { discNumber, trackNumber, rank, listens } of ranks) {
      await run('INSERT OR REPLACE INTO track_popularity (album_id, disc_number, track_number, deezer_rank, listens) VALUES (?, ?, ?, ?, ?)',
        [albumId, discNumber, trackNumber, rank, listens]);
    }
    await run('INSERT OR REPLACE INTO album_popularity (album_id, deezer_album_id, checked_at) VALUES (?, ?, ?)',
      [albumId, deezerAlbumId, new Date().toISOString()]);
  },

  /** Every album's, by album id. */
  findAll: async (): Promise<Map<number, TrackRank[]>> => {
    const rows = await all<TrackRank & { albumId: number }>(`SELECT album_id AS albumId, disc_number AS discNumber, track_number AS trackNumber,
      deezer_rank AS rank, listens FROM track_popularity`);
    const byAlbum = new Map<number, TrackRank[]>();
    for (const { albumId, ...rank } of rows) byAlbum.set(albumId, [...(byAlbum.get(albumId) || []), rank]);
    return byAlbum;
  },

  findByAlbum: async (albumId: number): Promise<TrackRank[]> =>
    all<TrackRank>(`SELECT disc_number AS discNumber, track_number AS trackNumber, deezer_rank AS rank, listens
      FROM track_popularity WHERE album_id = ?`, [albumId]),

  /** The albums with tracks never looked up, then those looked up before the date given, oldest first. */
  findDue: async (checkedBefore: string, limit: number): Promise<number[]> =>
    (await all<{ id: number }>(`SELECT a.id FROM albums a
      LEFT JOIN album_popularity p ON p.album_id = a.id
      WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id)
        AND COALESCE(a.title_status, 'owned') != 'playlist'
        AND (p.checked_at IS NULL OR p.checked_at < ?)
      ORDER BY p.checked_at IS NOT NULL, p.checked_at, a.id
      LIMIT ?`, [checkedBefore, limit])).map(row => row.id),

  /** Forgets every album's popularity, for all of them to be read again. */
  forgetAll: async (): Promise<void> => {
    await run('DROP TABLE IF EXISTS track_popularity');
    await run('DROP TABLE IF EXISTS album_popularity');
    await TrackPopularity.createTable();
  },
};

export default TrackPopularity;
