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

/** A track's place on its album: what finds its recording in DexVault. */
const place = (albumId: number, disc: number, no: number): string => `${albumId}:${disc}:${no}`;

/** The key a track's fiche is kept under: its MusicBrainz recording, else its place on its album. */
export const recordingKey = (song: { albumId: number; discNumber: number; track: number }, recordings: Map<string, string>): string =>
  recordings.get(place(song.albumId, song.discNumber, song.track)) ?? `album:${song.albumId}:${song.discNumber}:${song.track}`;

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
const ficheOf = (row: FicheRow): FicheRecord => ({
  key: row.recording_key, energy: row.energy, tempo: row.tempo, moods: list(row.moods), styles: list(row.styles),
  lang: row.lang, model: row.model, madeAt: row.made_at,
});

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
    return new Map(rows.map(row => [row.recording_key, ficheOf(row)]));
  },

  /** The MusicBrainz recording of each track of DexVault that has one, by its place (`albumId:disc:no`). */
  recordingIds: async (): Promise<Map<string, string>> => {
    const rows = await all<{ album_id: number; disc_number: number; track_number: number; musicbrainz_recording_id: string }>(
      `SELECT album_id, disc_number, track_number, musicbrainz_recording_id FROM tracks
       WHERE musicbrainz_recording_id IS NOT NULL AND musicbrainz_recording_id != ''`);
    return new Map(rows.map(row => [place(row.album_id, row.disc_number || 1, row.track_number), row.musicbrainz_recording_id]));
  },

  /**
   * The fiches of these albums' tracks, one per place, read at once: by the
   * recording of a track of DexVault, else by its place, as the radio keeps
   * them (a digital album's files have no track of DexVault).
   */
  ofAlbums: async (albumIds: number[]): Promise<Map<number, Fiche[]>> => {
    const out = new Map<number, Fiche[]>();
    if (!albumIds.length) return out;
    const wanted = new Set(albumIds);
    const byPlace = new Map<number, Map<string, Fiche>>();
    const put = (albumId: number, at: string, fiche: Fiche) => {
      if (!byPlace.has(albumId)) byPlace.set(albumId, new Map());
      byPlace.get(albumId)!.set(at, fiche);
    };
    const [placed, recorded] = await Promise.all([
      all<FicheRow>(`SELECT * FROM track_fiches WHERE recording_key LIKE 'album:%'`),
      all<FicheRow & { album_id: number; disc_number: number | null; track_number: number }>(
        `SELECT f.*, t.album_id, t.disc_number, t.track_number FROM json_each(?) ids
         JOIN tracks t ON t.album_id = ids.value
         JOIN track_fiches f ON f.recording_key = t.musicbrainz_recording_id`, [JSON.stringify(albumIds)]),
    ]);
    for (const row of placed) {
      const [, id, disc, no] = row.recording_key.split(':');
      if (wanted.has(Number(id))) put(Number(id), `${disc}:${no}`, ficheOf(row));
    }
    for (const row of recorded) put(row.album_id, `${row.disc_number || 1}:${row.track_number}`, ficheOf(row));
    for (const [albumId, fiches] of byPlace) out.set(albumId, [...fiches.values()]);
    return out;
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
