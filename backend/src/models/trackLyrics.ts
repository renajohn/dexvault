import { getDatabase } from '../database';

/**
 * What a lookup found for a track: its words, a note that it has none, or
 * nothing yet. "missing" is asked again after a while: LRCLIB grows.
 */
export type LyricsStatus = 'found' | 'instrumental' | 'missing';

export interface TrackLyricsRow {
  album_id: number;
  disc_number: number;
  track_number: number;
  title: string;
  status: LyricsStatus;
  plain: string | null;
  synced: string | null;
  source: string | null;
  source_id: string | null;
  checked_at: string;
  timing_fix: string | null;
  timing_fix_source: string | null;
  timing_saved: number;
}

export interface TrackLyricsFormatted {
  albumId: number;
  discNumber: number;
  trackNumber: number;
  /** The title the words were looked up for: a track renamed since is looked up again. */
  title: string;
  status: LyricsStatus;
  plain: string | null;
  /** LRC, "[mm:ss.xx] line", when the source times its lines. */
  synced: string | null;
  source: string | null;
  sourceId: string | null;
  checkedAt: string;
  /** The lines retimed by hand, LRC too: shown instead of `synced`, which stays LRCLIB's. */
  timingFix: string | null;
  /** Saved into the lyrics: written in the .lrc beside the rip, and kept whatever LRCLIB says next. */
  timingSaved: boolean;
}

/** A track still to look up: no lyrics yet, renamed since, or missing long enough to ask again. */
export interface TrackToLookUp {
  albumId: number;
  discNumber: number;
  trackNumber: number;
  title: string;
  durationSec: number | null;
  trackArtist: string | null;
  albumArtist: string | null;
  albumTitle: string;
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) =>
    getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) =>
    getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

const get = <T>(sql: string, params: unknown[] = []): Promise<T | null> =>
  new Promise((resolve, reject) =>
    getDatabase().get(sql, params, (err: Error | null, row: T | undefined) => (err ? reject(err) : resolve(row ?? null))));

const format = (row: TrackLyricsRow): TrackLyricsFormatted => ({
  albumId: row.album_id,
  discNumber: row.disc_number,
  trackNumber: row.track_number,
  title: row.title,
  status: row.status,
  plain: row.plain,
  synced: row.synced,
  source: row.source,
  sourceId: row.source_id,
  checkedAt: row.checked_at,
  timingFix: row.timing_fix ?? null,
  timingSaved: Boolean(row.timing_saved),
});

/**
 * The words of each track, kept by its place on the album rather than by its
 * row: refreshing an album from MusicBrainz deletes its tracks and writes them
 * again, which would lose them.
 */
const TrackLyrics = {
  createTable: (): Promise<void> =>
    run(`
      CREATE TABLE IF NOT EXISTS track_lyrics (
        album_id     INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        disc_number  INTEGER NOT NULL,
        track_number INTEGER NOT NULL,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL,
        plain        TEXT,
        synced       TEXT,
        source       TEXT,
        source_id    TEXT,
        checked_at   TEXT NOT NULL,
        timing_fix   TEXT,
        timing_fix_source TEXT,
        timing_saved INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (album_id, disc_number, track_number)
      )
    `),

  get: async (albumId: number, discNumber: number, trackNumber: number): Promise<TrackLyricsFormatted | null> => {
    const row = await get<TrackLyricsRow>(
      `SELECT * FROM track_lyrics WHERE album_id = ? AND disc_number = ? AND track_number = ?`,
      [albumId, discNumber, trackNumber]
    );
    return row ? format(row) : null;
  },

  /** What is known of each track of an album, words or not. */
  forAlbum: async (albumId: number): Promise<TrackLyricsFormatted[]> =>
    (await all<TrackLyricsRow>(`SELECT * FROM track_lyrics WHERE album_id = ?`, [albumId])).map(format),

  /** Every track of an album that has words, for the files beside its rip. */
  foundForAlbum: async (albumId: number): Promise<TrackLyricsFormatted[]> =>
    (await all<TrackLyricsRow>(`SELECT * FROM track_lyrics WHERE album_id = ? AND status = 'found'`, [albumId])).map(format),

  /**
   * Keeps what a lookup found. A timing fixed by hand stays while LRCLIB's
   * text is the one it was fixed on, or for good once saved into the lyrics.
   */
  save: (lyrics: Omit<TrackLyricsFormatted, 'checkedAt' | 'timingFix' | 'timingSaved'>): Promise<void> =>
    run(
      `INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, plain, synced, source, source_id, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(album_id, disc_number, track_number) DO UPDATE SET
         title = excluded.title, status = excluded.status, plain = excluded.plain, synced = excluded.synced,
         source = excluded.source, source_id = excluded.source_id, checked_at = excluded.checked_at,
         timing_fix = CASE WHEN track_lyrics.timing_saved = 1 OR track_lyrics.timing_fix_source IS excluded.source_id
           THEN track_lyrics.timing_fix END,
         timing_fix_source = CASE WHEN track_lyrics.timing_saved = 1 OR track_lyrics.timing_fix_source IS excluded.source_id
           THEN track_lyrics.timing_fix_source END`,
      [lyrics.albumId, lyrics.discNumber, lyrics.trackNumber, lyrics.title, lyrics.status, lyrics.plain, lyrics.synced,
        lyrics.source, lyrics.sourceId, new Date().toISOString()]
    ),

  /** The lines retimed by hand, on LRCLIB's text of the moment; `saved` writes them into the lyrics. */
  fixTiming: (albumId: number, discNumber: number, trackNumber: number, synced: string, saved: boolean): Promise<void> =>
    run(
      `UPDATE track_lyrics SET timing_fix = ?, timing_fix_source = source_id, timing_saved = ?
        WHERE album_id = ? AND disc_number = ? AND track_number = ?`,
      [synced, saved ? 1 : 0, albumId, discNumber, trackNumber]
    ),

  /** Back to LRCLIB's timing. */
  resetTiming: (albumId: number, discNumber: number, trackNumber: number): Promise<void> =>
    run(
      `UPDATE track_lyrics SET timing_fix = NULL, timing_fix_source = NULL, timing_saved = 0
        WHERE album_id = ? AND disc_number = ? AND track_number = ?`,
      [albumId, discNumber, trackNumber]
    ),

  /**
   * The tracks of the collection and of the digital albums to look up, oldest albums first: never
   * looked up, renamed since, or missing and last asked before `retryBefore`.
   * The albums in `skip` are left out.
   */
  toLookUp: async (retryBefore: string, limit: number, skip: number[] = []): Promise<TrackToLookUp[]> =>
    all<TrackToLookUp>(
      `SELECT t.album_id AS albumId, t.disc_number AS discNumber, t.track_number AS trackNumber, t.title,
              t.duration_sec AS durationSec, t.artist AS trackArtist, a.artist AS albumArtist, a.title AS albumTitle
         FROM tracks t
         JOIN albums a ON a.id = t.album_id
         LEFT JOIN track_lyrics l
           ON l.album_id = t.album_id AND l.disc_number = t.disc_number AND l.track_number = t.track_number
        WHERE (a.title_status IN ('owned', 'digital') OR a.title_status IS NULL)
          AND (l.album_id IS NULL OR l.title != t.title OR (l.status = 'missing' AND l.checked_at < ?))
          ${skip.length > 0 ? `AND t.album_id NOT IN (${skip.map(() => '?').join(',')})` : ''}
        ORDER BY t.album_id, t.disc_number, t.track_number
        LIMIT ?`,
      [retryBefore, ...skip, limit]
    ),
};

export default TrackLyrics;
