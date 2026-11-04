import axios from 'axios';
import TrackFiche, { type Fiche, MOODS, STYLES, TEMPOS, type Tempo } from '../models/trackFiche';
import { getConfig, requestFailure } from './coverScanService';
import { catalogue, inPool, type RadioEntry, type RadioPool } from './radioCatalogue';
import { inTurn } from '../utils/localLlmQueue';
import logger from '../logger';

/**
 * The radio's fiches, written by the local LLM 25 songs at a time: energy,
 * tempo, two or three moods and one or two styles from closed lists, and
 * the language sung. In turn with the album guides, never beside them; the
 * songs of a pool the radio plays from first, then all the others, behind
 * the guides' auto-writer. One per recording: a song on two albums is
 * described once.
 */

const BATCH = 25;
/** A malformed answer is asked again, up to this many times in all. */
const ATTEMPTS = 3;
const LLM_TIMEOUT_SEC = 300;
/** A song the model leaves out of its answers is left alone this long. */
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;

export interface FicheAsk {
  key: string;
  artist: string;
  title: string;
  album: string;
  year: number | null;
}

/** One request to the local LLM, its answer's text; thinking off, which only slows it down here. */
export const chatLocal = async (prompt: string, { maxTokens, temperature, timeoutSec = LLM_TIMEOUT_SEC }: { maxTokens: number; temperature: number; timeoutSec?: number }): Promise<string> => {
  const { baseUrl, model } = getConfig();
  try {
    const response = await axios.post(`${baseUrl}/v1/chat/completions`, {
      model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature,
      chat_template_kwargs: { enable_thinking: false },
    }, { timeout: timeoutSec * 1000 });
    const text: string | undefined = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('The local LLM answered with nothing');
    return text;
  } catch (error) {
    throw requestFailure(error);
  }
};

/** The JSON between the first opening and the last closing bracket: models like to talk around it. */
export const jsonIn = (text: string, open: '[' | '{'): unknown => {
  const close = open === '[' ? ']' : '}';
  const from = text.indexOf(open);
  const to = text.lastIndexOf(close);
  if (from === -1 || to <= from) return undefined;
  try {
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    return undefined;
  }
};

/** A number, given as one or as a string ("7", "7/10"). */
export const numberOf = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(number) ? number : null;
};

/** The words of a closed list, in lower case, once each; the others dropped. */
export const closed = (value: unknown, list: readonly string[], most: number): string[] => {
  const words = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,/]/) : [])
    .map(word => String(word).trim().toLowerCase());
  return [...new Set(words.filter(word => list.includes(word)))].slice(0, most);
};

export const tempoOf = (value: unknown): Tempo | null => {
  const word = String(value ?? '').trim().toLowerCase();
  if ((TEMPOS as string[]).includes(word)) return word as Tempo;
  if (word === 'medium' || word === 'moderate') return 'mid';
  return null;
};

/** The fiches an answer gives, by the songs' numbers; null when it is no answer at all. */
export const parseFiches = (text: string, size: number): Map<number, Fiche> | null => {
  const answer = jsonIn(text, '[');
  if (!Array.isArray(answer)) return null;
  const fiches = new Map<number, Fiche>();
  for (const item of answer) {
    if (!item || typeof item !== 'object') continue;
    const one = item as Record<string, unknown>;
    const n = numberOf(one.n);
    const energy = numberOf(one.energy);
    const tempo = tempoOf(one.tempo);
    if (n === null || !Number.isInteger(n) || n < 1 || n > size || energy === null || !tempo) continue;
    fiches.set(n, {
      energy: Math.max(0, Math.min(10, Math.round(energy))),
      tempo,
      moods: closed(one.moods, MOODS, 3),
      styles: closed(one.styles, STYLES, 2),
      lang: String(one.lang ?? '').trim().toLowerCase() || 'unknown',
    });
  }
  return fiches.size > 0 ? fiches : null;
};

export const fichePrompt = (songs: FicheAsk[]): string => [
  'Describe each recording for a listener\'s playlists. For each give: n; energy 0-10 (how lively, driving, danceable: 0 a lullaby, 10 pure adrenaline); tempo slow|mid|fast; '
  + `moods: 2 or 3 words taken ONLY from [${MOODS.join(', ')}]; styles: 1 or 2 taken ONLY from [${STYLES.join(', ')}]; `
  + 'lang: the sung language in English and lower case (english, french, german…), or instrumental. '
  + 'Use what you know of the recording; for a classical movement, its tempo marking. Answer a JSON array of {n,energy,tempo,moods,styles,lang} only.',
  ...songs.map((song, at) => `${at + 1}. ${song.artist} — ${song.title} (album ${song.album}${song.year ? `, ${song.year}` : ''})`),
].join('\n');

/** No usable answer in all the attempts: the model is there, these songs are the trouble. */
export class NoFichesError extends Error {}

/** The fiches of up to 25 songs, a malformed answer asked again; each attempt waits its turn. */
export const describe = async (songs: FicheAsk[]): Promise<Array<{ key: string; fiche: Fiche }>> => {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const text = await inTurn(() => chatLocal(fichePrompt(songs), { maxTokens: 3500, temperature: 0.1 }));
    const fiches = parseFiches(text, songs.length);
    if (fiches) return [...fiches].map(([n, fiche]) => ({ key: songs[n - 1].key, fiche }));
    logger.warn(`Radio fiches: answer ${attempt} of ${ATTEMPTS} was no JSON list`);
  }
  throw new NoFichesError(`The local LLM gave no fiches in ${ATTEMPTS} answers`);
};

const askOf = (entry: RadioEntry): FicheAsk => ({
  key: entry.key, artist: entry.song.artist, title: entry.song.title, album: entry.song.album, year: entry.year,
});

/** What waits to be written: the pools asked for first, then the rest; by recording, each once. */
const asked = new Map<string, FicheAsk>();
const background = new Map<string, FicheAsk>();
const failedAt = new Map<string, number>();
let draining: Promise<void> | null = null;

const takeBatch = (have: Set<string>): FicheAsk[] => {
  const batch: FicheAsk[] = [];
  for (const queue of [asked, background]) {
    for (const [key, song] of queue) {
      queue.delete(key);
      if (have.has(key) || batch.some(one => one.key === key)) continue;
      batch.push(song);
      if (batch.length === BATCH) return batch;
    }
  }
  return batch;
};

/** Writes what waits, a batch at a time; stops when the model cannot be reached, the rest left for the next pass. */
const drain = (): Promise<void> => {
  draining = draining ?? (async () => {
    const have = new Set((await TrackFiche.all()).keys());
    for (;;) {
      const batch = takeBatch(have);
      if (batch.length === 0) return;
      const started = Date.now();
      try {
        const written = await describe(batch);
        await TrackFiche.saveMany(written, getConfig().model);
        written.forEach(one => have.add(one.key));
        batch.filter(song => !have.has(song.key)).forEach(song => failedAt.set(song.key, Date.now()));
        logger.info(`Radio fiches: ${written.length} of ${batch.length} written in ${Math.round((Date.now() - started) / 1000)} s`);
      } catch (error) {
        batch.forEach(song => failedAt.set(song.key, Date.now()));
        logger.warn(`Radio fiches not written: ${(error as Error).message}`);
        // The model out of reach: no use asking it for the next batch either.
        if (!(error instanceof NoFichesError)) { asked.clear(); background.clear(); return; }
      }
    }
  })().finally(() => { draining = null; });
  return draining;
};

const missing = (entries: RadioEntry[], have: Map<string, unknown>): RadioEntry[] =>
  entries.filter(entry => !have.has(entry.key) && Date.now() - (failedAt.get(entry.key) ?? 0) > RETRY_FAILED_AFTER_MS);

export interface FicheStatus {
  songs: number;
  withFiche: number;
  queued: number;
  writing: boolean;
}

const statusOf = async (entries: RadioEntry[]): Promise<FicheStatus> => {
  const have = await TrackFiche.all();
  return {
    songs: entries.length,
    withFiche: entries.filter(entry => have.has(entry.key)).length,
    queued: asked.size + background.size,
    writing: draining !== null,
  };
};

const trackFicheService = {
  /** Every song that plays and how many have their fiche. */
  status: async (): Promise<FicheStatus> => statusOf((await catalogue()).entries),

  /** Puts a pool's songs with no fiche first in the queue, and starts writing; the pool's own counts. */
  ask: async (pool: RadioPool): Promise<FicheStatus> => {
    const entries = (await catalogue()).entries.filter(entry => inPool(entry, pool));
    trackFicheService.queueFirst(entries, await TrackFiche.all());
    return statusOf(entries);
  },

  queueFirst: (entries: RadioEntry[], have: Map<string, unknown>): void => {
    const songs = missing(entries, have);
    if (songs.length === 0) return;
    for (const entry of songs) { background.delete(entry.key); asked.set(entry.key, askOf(entry)); }
    drain().catch(() => undefined);
  },

  /** Every song that plays with no fiche, behind those asked for: albums added or ripped since come in here. */
  writeMissing: async (): Promise<void> => {
    const have = await TrackFiche.all();
    for (const entry of missing((await catalogue()).entries, have)) if (!asked.has(entry.key)) background.set(entry.key, askOf(entry));
    await drain();
  },

  /** Resolved once what waits is written: for tests. */
  idle: (): Promise<void> => draining ?? Promise.resolve(),

  /** For tests: nothing waiting, nothing failed. */
  forget: (): void => { asked.clear(); background.clear(); failedAt.clear(); },
};

export default trackFicheService;
