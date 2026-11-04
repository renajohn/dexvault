import { getDatabase } from '../database';
import type { RadioCriteria } from '../services/radioService';
import type { RadioPool } from '../services/radioCatalogue';

/** What the owner set the radio to, the same on every device: the band itself stays with the device playing it. */
export interface RadioSettings {
  prompt: string;
  recent: string[];
  pool: RadioPool;
  criteria: RadioCriteria | null;
}

export interface StoredRadioSettings {
  settings: RadioSettings | null;
  updatedAt: string | null;
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) =>
    getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const get = <T>(sql: string, params: unknown[] = []): Promise<T | undefined> =>
  new Promise((resolve, reject) =>
    getDatabase().get(sql, params, (err: Error | null, row: T) => (err ? reject(err) : resolve(row))));

/** One row: the radio's settings, as last saved by any device. */
const RadioSettingsModel = {
  createTable: (): Promise<void> => run(`
    CREATE TABLE IF NOT EXISTS radio_settings (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      settings   TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),

  read: async (): Promise<StoredRadioSettings> => {
    const row = await get<{ settings: string; updated_at: string }>('SELECT settings, updated_at FROM radio_settings WHERE id = 1');
    if (!row) return { settings: null, updatedAt: null };
    try {
      return { settings: JSON.parse(row.settings) as RadioSettings, updatedAt: row.updated_at };
    } catch {
      // Unreadable, as none: the next save writes them anew.
      return { settings: null, updatedAt: null };
    }
  },

  save: async (settings: RadioSettings, at: Date = new Date()): Promise<StoredRadioSettings> => {
    const updatedAt = at.toISOString();
    await run(`INSERT INTO radio_settings (id, settings, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`, [JSON.stringify(settings), updatedAt]);
    return { settings, updatedAt };
  },

  /** For tests. */
  clear: (): Promise<void> => run('DELETE FROM radio_settings'),
};

export default RadioSettingsModel;
