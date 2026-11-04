import { getDatabase } from '../database';

export type LeftHow = 'played' | 'skipped';

export interface RadioLeaving {
  id: number;
  songId: string;
  how: LeftHow;
  leftAt: string;
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) =>
    getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) =>
    getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

/** Every song that left the radio, heard or skipped: what keeps it from coming back too soon. */
const RadioHistory = {
  createTable: async (): Promise<void> => {
    await run(`
      CREATE TABLE IF NOT EXISTS radio_history (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT NOT NULL,
        how     TEXT NOT NULL,
        left_at TEXT NOT NULL
      )`);
    await run('CREATE INDEX IF NOT EXISTS idx_radio_history_left_at ON radio_history(left_at)');
  },

  add: (songId: string, how: LeftHow, at: Date = new Date()): Promise<void> =>
    run('INSERT INTO radio_history (song_id, how, left_at) VALUES (?, ?, ?)', [songId, how, at.toISOString()]),

  /** The songs that left since a moment, the latest first. */
  since: async (from: Date): Promise<RadioLeaving[]> => {
    const rows = await all<{ id: number; song_id: string; how: LeftHow; left_at: string }>(
      'SELECT * FROM radio_history WHERE left_at >= ? ORDER BY id DESC', [from.toISOString()]);
    return rows.map(row => ({ id: row.id, songId: row.song_id, how: row.how, leftAt: row.left_at }));
  },

  /** For tests. */
  clear: (): Promise<void> => run('DELETE FROM radio_history'),
};

export default RadioHistory;
