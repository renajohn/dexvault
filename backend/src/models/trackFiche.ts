import { getDatabase } from '../database';

export type Tempo = 'slow' | 'mid' | 'fast';
export const TEMPOS: Tempo[] = ['slow', 'mid', 'fast'];

/** What the radio may hear a song as: closed lists, so that a prompt and a song meet on the same words. */
export const MOODS = ['driving', 'energetic', 'aggressive', 'intense', 'anthemic', 'epic', 'upbeat', 'joyful', 'playful',
  'uplifting', 'hopeful', 'groovy', 'gentle', 'calm', 'dreamy', 'romantic', 'tender', 'intimate', 'melancholic',
  'nostalgic', 'dark', 'tense', 'dramatic', 'reflective', 'atmospheric', 'cinematic'] as const;
export const STYLES = ['rock', 'alternative', 'hard-rock', 'progressive', 'pop', 'singer-songwriter', 'folk', 'chanson',
  'soul', 'r&b', 'blues', 'jazz', 'funk', 'latin', 'hip-hop', 'electronic', 'dance', 'soundtrack', 'world', 'classical'] as const;

export interface Fiche {
  /** 0 a lullaby, 10 pure adrenaline. */
  energy: number;
  tempo: Tempo;
  moods: string[];
  styles: string[];
  /** The sung language in lower case, or "instrumental". */
  lang: string;
}

export interface FicheRecord extends Fiche {
  key: string;
  model: string | null;
  madeAt: string;
}

interface FicheRow {
  recording_key: string;
  energy: number;
  tempo: Tempo;
  moods: string;
  styles: string;
  lang: string;
  model: string | null;
  made_at: string;
}

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) =>
    getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) =>
    getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

const list = (text: string): string[] => {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * The fiche of a recording, written once by the local LLM: one per
 * recording, so the same song on two albums shares it. A track's key is its
 * MusicBrainz recording id, else its place on its album
 * (`album:<albumId>:<disc>:<no>`).
 */
const TrackFiche = {
  createTable: (): Promise<void> =>
    run(`
      CREATE TABLE IF NOT EXISTS track_fiches (
        recording_key TEXT PRIMARY KEY,
        energy        INTEGER NOT NULL,
        tempo         TEXT NOT NULL,
        moods         TEXT NOT NULL,
        styles        TEXT NOT NULL,
        lang          TEXT NOT NULL,
        model         TEXT,
        made_at       TEXT NOT NULL
      )`),

  all: async (): Promise<Map<string, FicheRecord>> => {
    const rows = await all<FicheRow>('SELECT * FROM track_fiches');
    return new Map(rows.map(row => [row.recording_key, {
      key: row.recording_key, energy: row.energy, tempo: row.tempo, moods: list(row.moods), styles: list(row.styles),
      lang: row.lang, model: row.model, madeAt: row.made_at,
    }]));
  },

  saveMany: async (fiches: Array<{ key: string; fiche: Fiche }>, model: string | null): Promise<void> => {
    const now = new Date().toISOString();
    for (const { key, fiche } of fiches) {
      await run(
        `INSERT INTO track_fiches (recording_key, energy, tempo, moods, styles, lang, model, made_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(recording_key) DO UPDATE SET energy = excluded.energy, tempo = excluded.tempo, moods = excluded.moods,
           styles = excluded.styles, lang = excluded.lang, model = excluded.model, made_at = excluded.made_at`,
        [key, fiche.energy, fiche.tempo, JSON.stringify(fiche.moods), JSON.stringify(fiche.styles), fiche.lang, model, now]);
    }
  },

  /** For tests. */
  clear: (): Promise<void> => run('DELETE FROM track_fiches'),
};

export default TrackFiche;
