import { TEMPOS, type Fiche } from '../models/trackFiche';
import { findFilters, withoutWords } from './albumSearchFilters';

/**
 * The words of a search that ask how a song sounds, read on the fiches the
 * local LLM wrote of each recording (models/trackFiche.ts): mood: and style:
 * among the closed lists, energy: from 0 to 10 (7, 7-10, >=7), tempo:
 * slow|mid|fast. Commas are "or", `-key:` (or `!key:`, by now `-key:`) "not",
 * as the other keys of MusicDex.
 *
 * A song answers by its own fiche, every word written without a sign at once
 * and none of those with one; a song with no fiche answers none, so it is
 * found by the words' negation alone. An album, or a work, answers when at
 * least a third of its songs that have a fiche answer, one at least: a word
 * with a sign leaves out the albums that word would find. A mood asks less,
 * a quarter of them or three songs: each song has two or three moods of
 * twenty-six, so one mood seldom reaches a third of an album (mood:melancholic
 * found three albums of the whole collection, all fado, on 04.11.2026).
 */

/** Whether one fiche answers one word of the search; `loose`, a word an album answers by fewer of its songs (a mood). */
type Test = ((fiche: Fiche) => boolean) & { loose?: boolean };

export interface FicheFilter {
  /** The words without a sign: a song answers them all at once. */
  all: Test[];
  /** The words with one: an album answering one of them is left out. */
  none: Test[];
}

const ENERGY = /^(?:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)|(=|>=|<=|>|<)?(\d+(?:\.\d+)?))$/;

/** 7, 7-10, >=7 as a test of energy; null for anything else. */
const energyTest = (value: string): Test | null => {
  const m = value.match(ENERGY);
  if (!m) return null;
  if (m[1] !== undefined) {
    const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
    return fiche => fiche.energy >= a && fiche.energy <= b;
  }
  const n = Number(m[4]);
  switch (m[3]) {
    case '>=': return fiche => fiche.energy >= n;
    case '<=': return fiche => fiche.energy <= n;
    case '>': return fiche => fiche.energy > n;
    case '<': return fiche => fiche.energy < n;
    default: return fiche => fiche.energy === n;
  }
};

const has = (list: (fiche: Fiche) => string[]) => (value: string): Test => {
  const want = value.toLowerCase();
  return fiche => list(fiche).some(one => one.toLowerCase() === want);
};

/** How each key reads one of its values; null for a value it cannot read, which leaves the word in the query. */
const KEYS: Record<string, (value: string) => Test | null> = {
  mood: has(fiche => fiche.moods),
  style: has(fiche => fiche.styles),
  energy: energyTest,
  tempo: value => {
    const tempo = value.toLowerCase() === 'medium' ? 'mid' : value.toLowerCase();
    return (TEMPOS as string[]).includes(tempo) ? fiche => fiche.tempo === tempo : null;
  },
};

export const FICHE_KEYS = Object.keys(KEYS);

/** The fiche words taken out of the query (normalised by normaliseAlbumQuery first); filter null when there are none. */
export const takeFicheFilter = (query: string): { filter: FicheFilter | null; rest: string } => {
  const filter: FicheFilter = { all: [], none: [] };
  const taken: string[] = [];
  for (const key of FICHE_KEYS) {
    for (const word of findFilters(query, key)) {
      const tests = word.values.map(KEYS[key]);
      if (!tests.length || tests.includes(null)) continue;
      const any: Test = fiche => (tests as Test[]).some(test => test(fiche));
      if (key === 'mood') any.loose = true;
      (word.neg ? filter.none : filter.all).push(any);
      taken.push(word.text);
    }
  }
  if (!taken.length) return { filter: null, rest: query };
  return { filter, rest: withoutWords(query, taken) };
};

/** Whether a song answers, by its own fiche. */
export const songAnswers = (filter: FicheFilter, fiche: Fiche | undefined): boolean =>
  fiche ? filter.all.every(test => test(fiche)) && !filter.none.some(test => test(fiche)) : filter.all.length === 0;

/** Whether enough of these fiches, one at least, answer the test: a third; for a mood, a quarter or three songs. */
const enough = (fiches: Fiche[], test: Test, loose = test.loose === true): boolean => {
  const answering = fiches.filter(test).length;
  if (answering === 0) return false;
  return answering * 3 >= fiches.length || (loose && (answering >= 3 || answering * 4 >= fiches.length));
};

/**
 * Whether an album, or a work, answers, by the fiches of its songs that have
 * one: enough of them answering every word without a sign at once, and for
 * each word with one, not enough of them answering it.
 */
export const groupAnswers = (filter: FicheFilter, fiches: Fiche[]): boolean =>
  (filter.all.length === 0 || enough(fiches, fiche => filter.all.every(test => test(fiche)),
    // Loose only when every word asked is a mood: mood:calm style:jazz still wants a third of jazz.
    filter.all.every(test => test.loose === true)))
  && !filter.none.some(test => enough(fiches, test));

/** The share of these fiches answering every word without a sign: what puts first the album that answers best. */
export const answeringShare = (filter: FicheFilter, fiches: Fiche[]): number =>
  fiches.length ? fiches.filter(fiche => filter.all.every(test => test(fiche))).length / fiches.length : 0;
