import { getDatabase } from '../database';

/** Who wrote a guide: Claude for the albums catalogued before guides existed, the local LLM since, or the owner by hand. */
export type GuideSource = 'claude' | 'local_llm' | 'manual';

export const GUIDE_SOURCES: GuideSource[] = ['claude', 'local_llm', 'manual'];

export interface AlbumGuideRow {
  album_id: number;
  text: string;
  source: GuideSource;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumGuideFormatted {
  albumId: number;
  /** Markdown: "###" headings, "**bold**", "*italic*" and "-" bullets. */
  text: string;
  source: GuideSource;
  /** The model that wrote it, when a model did. */
  model: string | null;
  createdAt: string;
  updatedAt: string;
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

const format = (row: AlbumGuideRow): AlbumGuideFormatted => ({
  albumId: row.album_id,
  text: row.text,
  source: row.source,
  model: row.model,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** What to know before listening to a CD: one guide per album, written once and kept. */
const AlbumGuide = {
  createTable: (): Promise<void> =>
    run(`
      CREATE TABLE IF NOT EXISTS album_guides (
        album_id   INTEGER PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
        text       TEXT NOT NULL,
        source     TEXT NOT NULL,
        model      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),

  get: async (albumId: number): Promise<AlbumGuideFormatted | null> => {
    const row = await get<AlbumGuideRow>(`SELECT * FROM album_guides WHERE album_id = ?`, [albumId]);
    return row ? format(row) : null;
  },

  /** The albums that have a guide, to leave alone when guides are written for the others. */
  albumIds: async (): Promise<Set<number>> =>
    new Set((await all<{ album_id: number }>(`SELECT album_id FROM album_guides`)).map(row => row.album_id)),

  /** The latest guide Claude wrote for another album: the local LLM takes its tone from it. */
  latestByClaude: async (exceptAlbumId: number, { trackByTrack = false } = {}): Promise<AlbumGuideFormatted | null> => {
    // A track-by-track guide is no model for one told work by work, nor the other way round.
    const row = await get<AlbumGuideRow>(
      `SELECT * FROM album_guides WHERE source = 'claude' AND album_id != ?
         AND text ${trackByTrack ? '' : 'NOT '}LIKE '%**Plage par plage**%'
       ORDER BY updated_at DESC LIMIT 1`,
      [exceptAlbumId]
    );
    return row ? format(row) : null;
  },

  save: async (albumId: number, text: string, source: GuideSource, model: string | null = null): Promise<AlbumGuideFormatted> => {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO album_guides (album_id, text, source, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(album_id) DO UPDATE SET
         text = excluded.text, source = excluded.source, model = excluded.model, updated_at = excluded.updated_at`,
      [albumId, text, source, model, now, now]
    );
    return (await AlbumGuide.get(albumId))!;
  },

  remove: (albumId: number): Promise<void> => run(`DELETE FROM album_guides WHERE album_id = ?`, [albumId]),
};

export default AlbumGuide;
