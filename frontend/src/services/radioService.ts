/**
 * The radio's server: a prompt heard as criteria, songs drawn from the pool
 * that fit them, each song leaving told, and the fiches the drawing reads.
 * The contract is docs/superpowers/specs/2026-11-03-radio-api.md.
 */

export type Tempo = 'slow' | 'mid' | 'fast';

export const MOODS = ['driving', 'energetic', 'aggressive', 'intense', 'anthemic', 'epic', 'upbeat', 'joyful', 'playful',
  'uplifting', 'hopeful', 'groovy', 'gentle', 'calm', 'dreamy', 'romantic', 'tender', 'intimate', 'melancholic',
  'nostalgic', 'dark', 'tense', 'dramatic', 'reflective', 'atmospheric', 'cinematic'] as const;
export const STYLES = ['rock', 'alternative', 'hard-rock', 'progressive', 'pop', 'singer-songwriter', 'folk', 'chanson',
  'soul', 'r&b', 'blues', 'jazz', 'funk', 'latin', 'hip-hop', 'electronic', 'dance', 'soundtrack', 'world', 'classical'] as const;

/** Where the songs are drawn from: the union of what is on; all off = everything that plays. */
export interface RadioPool {
  /** Albums at this many stars and more (3, 3.5, 4, 4.5, 5); null = off. */
  stars: number | null;
  /** The songs hearted in Navidrome. */
  hearts: boolean;
  /** The albums' popular tracks. */
  popular: boolean;
  genre: 'both' | 'classical' | 'other';
  /** A work's movement drawn brings the whole work. */
  wholeWorks: boolean;
}

/** What a prompt is heard as; every field optional, an empty list = no constraint. */
export interface RadioCriteria {
  energyMin?: number | null;
  energyMax?: number | null;
  tempos?: Tempo[];
  moods?: string[];
  styles?: string[];
  langs?: string[];
}

export interface RadioSong {
  songId: string;
  title: string;
  artist: string;
  albumId: number;
  album: string;
  /** A DexVault image path, as elsewhere. */
  cover: string | null;
  discNumber: number;
  track: number;
  durationSec: number | null;
  work: string | null;
  movement: string | null;
  energy: number;
  tempo: Tempo;
  moods: string[];
  styles: string[];
  lang: string;
}

export interface RadioDraw {
  songs: RadioSong[];
  /** The songs of the pool, fiche or not. */
  poolSize: number;
  /** Those of them that fit the criteria. */
  fitting: number;
  /** Those of the pool with no fiche yet: never drawn. */
  missingFiches: number;
}

export interface RadioFiches {
  songs: number;
  withFiche: number;
  queued: number;
  writing: boolean;
}

export type RadioLeft = 'played' | 'skipped';

const BASE = '/api/radio';

const send = async <T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
};

const radioService = {
  /** The prompt heard as criteria, by the local LLM. */
  criteria: (prompt: string): Promise<RadioCriteria> => send('/criteria', 'POST', { prompt }),

  /** `count` songs more (1–50), none of `ahead` drawn again. */
  next: (criteria: RadioCriteria, pool: RadioPool, count: number, ahead: string[]): Promise<RadioDraw> =>
    send('/next', 'POST', { criteria, pool, count: Math.max(1, Math.min(50, count)), ahead }),

  /** A song left the radio: heard half or more, or skipped. */
  left: (songId: string, how: RadioLeft): Promise<{ ok: true }> => send('/left', 'POST', { songId, how }),

  fiches: (): Promise<RadioFiches> => send('/fiches', 'GET'),

  /** The pool's songs with no fiche first in the writer's queue. */
  askFiches: (pool: RadioPool): Promise<RadioFiches> => send('/fiches', 'POST', { pool }),
};

export default radioService;
