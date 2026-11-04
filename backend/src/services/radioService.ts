import TrackFiche, { type FicheRecord, MOODS, STYLES, TEMPOS, type Tempo } from '../models/trackFiche';
import RadioHistory, { type LeftHow, type RadioLeaving } from '../models/radioHistory';
import { catalogue, inPool, type Catalogue, type RadioEntry, type RadioPool } from './radioCatalogue';
import { buildStyleGraph, type StyleGraph } from './styleGraph';
import trackFicheService, { chatLocal, closed, jsonIn, numberOf } from './trackFicheService';
import { inTurn } from '../utils/localLlmQueue';
import { fold } from '../utils/searchText';
import logger from '../logger';

/**
 * Radio: a prompt heard once as criteria over the songs' fiches, then the
 * songs drawn again and again from a pool. The fiches give the candidates,
 * the local LLM chooses among them, and the code keeps the rules the model
 * does not (tried): a work's movements together and in their order, at most
 * two songs by one artist among those ahead, never two in a row.
 */

export interface RadioCriteria {
  energyMin?: number | null;
  energyMax?: number | null;
  tempos?: Tempo[];
  moods?: string[];
  /** The styles asked for: their songs first, the neighbouring styles' only when they are too few. */
  styles?: string[];
  langs?: string[];
  /** Neighbouring styles taken away from "Heard as": never drawn for being near. */
  notStyles?: string[];
}

/** A style drawn from for being near one asked: how near, and through which styles. */
export interface RadioNeighbour {
  style: string;
  weight: number;
  /** From the style asked to this one, both in. */
  path: string[];
}

export interface RadioSong {
  songId: string;
  title: string;
  artist: string;
  albumId: number;
  album: string;
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

export interface RadioNext {
  songs: RadioSong[];
  poolSize: number;
  fitting: number;
  missingFiches: number;
  /** The neighbouring styles drawn from, the nearest first. */
  neighbours: RadioNeighbour[];
}

const CANDIDATES = 40;
const CANDIDATES_PER_ARTIST = 3;
const AHEAD_PER_ARTIST = 2;
const HEARD_SHOWN = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const REST_DAYS = 30;
/** The artists a band wants before neighbouring styles fill in: at most two by one artist ahead, artists make its length. */
const ARTISTS_WANTED = 6;
/** No style this far from the one asked is near it. */
const NEIGHBOUR_FLOOR = 0.03;
/**
 * A song's style weight in hundredths against moods and the tempo by ones:
 * a song of the asked style always comes before a neighbour's, a nearer
 * neighbour's before a farther one's but for a few moods, and the moods rank
 * the songs of one style.
 */
const STYLE_RANK = 100;
/** How long a listener waits for the model's choice before the best fits stand in. */
const CHOICE_WAIT_MS = 45 * 1000;

/** Who a song is by, for the artist rules: the first of its artists, without its accents. */
export const artistKey = (artist: string): string =>
  fold(artist.split(/\s*(?:,|;|\bfeat\.?\s|\bft\.\s|\bfeaturing\s)\s*/i)[0] || artist).trim();

/** The criteria as the page or the model gives them, kept to the closed lists; null when they are no criteria at all. */
export const criteriaOf = (value: unknown): RadioCriteria | null => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const given = value as Record<string, unknown>;
  const pick = (...names: string[]) => names.map(name => given[name]).find(one => one !== undefined);
  const energy = (one: unknown): number | null | undefined => {
    if (one === undefined || one === null || one === '') return null;
    const number = numberOf(one);
    return number === null ? undefined : Math.max(0, Math.min(10, number));
  };
  const energyMin = energy(pick('energyMin', 'energy_min'));
  const energyMax = energy(pick('energyMax', 'energy_max'));
  if (energyMin === undefined || energyMax === undefined) return null;
  const lists = ['tempos', 'moods', 'moods_any', 'styles', 'styles_any', 'langs', 'notStyles'].map(name => given[name]);
  if (lists.some(list => list !== undefined && list !== null && !Array.isArray(list))) return null;
  const langs = (pick('langs') as unknown[] | undefined) || [];
  const notStyles = closed(pick('notStyles'), STYLES, STYLES.length);
  return {
    energyMin, energyMax,
    tempos: closed(pick('tempos'), TEMPOS, 3) as Tempo[],
    moods: closed(pick('moods', 'moods_any'), MOODS, MOODS.length),
    // Criteria saved when the model listed neighbours too: all of them asked.
    styles: closed(pick('styles', 'styles_any'), STYLES, STYLES.length),
    langs: [...new Set(langs.map(lang => String(lang).trim().toLowerCase()).filter(Boolean))],
    ...(notStyles.length ? { notStyles } : {}),
  };
};

/** The pool as the page sends it; null when it is not one. */
export const poolOf = (value: unknown): RadioPool | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const given = value as Record<string, unknown>;
  const stars = given.stars ?? null;
  if (stars !== null && (typeof stars !== 'number' || stars < 0.5 || stars > 5 || stars * 2 !== Math.round(stars * 2))) return null;
  const genre = given.genre ?? 'both';
  if (genre !== 'both' && genre !== 'classical' && genre !== 'other') return null;
  for (const flag of ['hearts', 'popular', 'wholeWorks']) if (given[flag] !== undefined && typeof given[flag] !== 'boolean') return null;
  return { stars, hearts: Boolean(given.hearts), popular: Boolean(given.popular), genre, wholeWorks: Boolean(given.wholeWorks) };
};

type FicheFit = Pick<FicheRecord, 'energy' | 'tempo' | 'moods' | 'styles' | 'lang'>;

/** The styles a draw takes, by weight: those asked at 1, and the neighbours drawn from. */
export type StyleWeights = Map<string, number>;

const askedOnly = (criteria: RadioCriteria): StyleWeights => new Map((criteria.styles ?? []).map(style => [style, 1]));

/** How near a song's styles come to those taken: the nearest of them, 0 for none. */
const styleWeightOf = (styles: string[], weights: StyleWeights): number =>
  styles.reduce((best, style) => Math.max(best, weights.get(style) ?? 0), 0);

/**
 * How well a fiche answers the criteria, 0 for not at all: energy and
 * languages rule a song out, and its styles when none is among those taken
 * (the styles asked, and the neighbours drawn from); the nearer its style,
 * then the tempo and each mood in common, the better a fit.
 */
export const fitScore = (fiche: FicheFit, criteria: RadioCriteria, weights: StyleWeights = askedOnly(criteria)): number => {
  if (criteria.energyMin != null && fiche.energy < criteria.energyMin) return 0;
  if (criteria.energyMax != null && fiche.energy > criteria.energyMax) return 0;
  if (criteria.langs?.length && !criteria.langs.includes(fiche.lang)) return 0;
  const style = criteria.styles?.length ? styleWeightOf(fiche.styles, weights) : 0;
  if (criteria.styles?.length && style === 0) return 0;
  return style * STYLE_RANK + 1
    + (criteria.tempos?.length && criteria.tempos.includes(fiche.tempo) ? 1 : 0)
    + fiche.moods.filter(mood => criteria.moods?.includes(mood)).length;
};

/**
 * Whether a song of the band still answers the criteria, to stay there: not
 * ruled out, its styles weighed as the draw's, and with one of the moods
 * asked, when there are: a new prompt keeps none of another mood. The tempo
 * only ranks the draw, as there.
 */
export const stillFits = (fiche: FicheFit, criteria: RadioCriteria, weights: StyleWeights = askedOnly(criteria)): boolean =>
  fitScore(fiche, criteria, weights) > 0
  && (!criteria.moods?.length || fiche.moods.some(mood => criteria.moods!.includes(mood)));

/**
 * The styles a draw takes: those asked; and when their songs are by fewer
 * than six artists, the neighbouring styles one by one, the nearest first,
 * until there are enough or none is near enough. A neighbour is kept when it
 * brings a song the others did not; one taken away from "Heard as" never is.
 */
export const reachOf = (criteria: RadioCriteria, graph: StyleGraph, songs: Array<{ artist: string; styles: string[] }>): { weights: StyleWeights; neighbours: RadioNeighbour[] } => {
  const asked = criteria.styles ?? [];
  const weights = askedOnly(criteria);
  const neighbours: RadioNeighbour[] = [];
  if (!asked.length) return { weights, neighbours };
  const out = new Set(criteria.notStyles ?? []);
  const near = graph.styles
    .filter(style => !weights.has(style) && !out.has(style))
    .map(style => {
      const from = asked.reduce((best, one) => (graph.weight(one, style) > graph.weight(best, style) ? one : best), asked[0]);
      return { style, weight: graph.weight(from, style), path: graph.path(from, style) };
    })
    .filter(one => one.weight >= NEIGHBOUR_FLOOR)
    .sort((a, b) => b.weight - a.weight);
  const taken = (song: { styles: string[] }) => song.styles.some(style => weights.has(style));
  const artists = new Set(songs.filter(taken).map(song => song.artist));
  for (const neighbour of near) {
    if (artists.size >= ARTISTS_WANTED) break;
    const brought = songs.filter(song => !taken(song) && song.styles.includes(neighbour.style));
    if (!brought.length) continue;
    weights.set(neighbour.style, neighbour.weight);
    neighbours.push(neighbour);
    brought.forEach(song => artists.add(song.artist));
  }
  return { weights, neighbours };
};

let graphCached: { catalogue: Catalogue; fiches: number; graph: StyleGraph } | null = null;

/** The styles' graph from every song's fiche, built again with the catalogue or as fiches are written. */
export const styleGraphOf = (songs: Catalogue, fiches: Map<string, FicheRecord>): StyleGraph => {
  if (graphCached && graphCached.catalogue === songs && graphCached.fiches === fiches.size) return graphCached.graph;
  const graph = buildStyleGraph(songs.entries.filter(entry => fiches.has(entry.key))
    .map(entry => ({ key: entry.key, artist: artistKey(entry.song.artist), styles: fiches.get(entry.key)!.styles })));
  graphCached = { catalogue: songs, fiches: fiches.size, graph };
  return graph;
};

/**
 * The songs that may not come back yet: a song comes back once half the
 * pool has left since it did, or after 30 days, whichever first; a song
 * skipped, twice as late.
 */
export const restingSongs = (history: RadioLeaving[], poolSize: number, now = Date.now()): Set<string> => {
  const resting = new Set<string>();
  const seen = new Set<string>();
  // The latest first: a song's place in the list is how many left since.
  history.forEach((leaving, since) => {
    if (seen.has(leaving.songId)) return;
    seen.add(leaving.songId);
    const late = leaving.how === 'skipped' ? 2 : 1;
    const days = (now - Date.parse(leaving.leftAt)) / DAY_MS;
    if (since < late * poolSize / 2 && days < late * REST_DAYS) resting.add(leaving.songId);
  });
  return resting;
};

/** A song alone, or a work's movements in their order: what the artist rules count once. */
interface Unit {
  entries: RadioEntry[];
  artist: string;
}

const byPlace = (a: RadioEntry, b: RadioEntry): number =>
  a.song.discNumber - b.song.discNumber || a.song.track - b.song.track;

/** The units ahead, a work's movements in a row counted as one. */
const unitsAhead = (ahead: RadioEntry[]): Unit[] => {
  const units: Unit[] = [];
  for (const entry of ahead) {
    const last = units[units.length - 1];
    if (last && entry.workKey && last.entries[0].workKey === entry.workKey) last.entries.push(entry);
    else units.push({ entries: [entry], artist: artistKey(entry.song.artist) });
  }
  return units;
};

/**
 * The songs in the order chosen, made into units and kept to the rules:
 * a work's movements together and in their order, the whole work with
 * `wholeWorks`; at most two units by one artist with those ahead, never two
 * in a row; as many songs as asked, a work whole even when it goes beyond.
 */
export const arrange = (chosen: RadioEntry[], { ahead, count, wholeWorks, catalogueOf, excluded }: {
  ahead: RadioEntry[];
  count: number;
  wholeWorks: boolean;
  /** The songs a whole work is completed from. */
  catalogueOf: (songId: string) => RadioEntry | undefined;
  /** Never drawn, a whole work's movements included: those ahead. */
  excluded: Set<string>;
}): RadioEntry[] => {
  const units: Unit[] = [];
  const ofWork = new Map<string, Unit>();
  const taken = new Set<string>();
  for (const entry of chosen) {
    if (taken.has(entry.song.songId) || excluded.has(entry.song.songId)) continue;
    if (entry.workKey) {
      const unit = ofWork.get(entry.workKey);
      if (wholeWorks) {
        if (unit) continue;
        const movements = entry.workSongs.map(song => catalogueOf(song.songId)).filter((one): one is RadioEntry => Boolean(one) && !excluded.has(one!.song.songId));
        const whole: Unit = { entries: movements.length ? movements : [entry], artist: artistKey(entry.song.artist) };
        whole.entries.forEach(one => taken.add(one.song.songId));
        ofWork.set(entry.workKey, whole);
        units.push(whole);
        continue;
      }
      if (unit) { unit.entries.push(entry); taken.add(entry.song.songId); continue; }
      const first: Unit = { entries: [entry], artist: artistKey(entry.song.artist) };
      ofWork.set(entry.workKey, first);
      units.push(first);
      taken.add(entry.song.songId);
      continue;
    }
    units.push({ entries: [entry], artist: artistKey(entry.song.artist) });
    taken.add(entry.song.songId);
  }
  units.forEach(unit => unit.entries.sort(byPlace));

  const before = unitsAhead(ahead);
  const perArtist = new Map<string, number>();
  before.forEach(unit => perArtist.set(unit.artist, (perArtist.get(unit.artist) || 0) + 1));
  let last = before[before.length - 1]?.artist ?? null;
  const placed: RadioEntry[] = [];
  const waiting: Unit[] = [];
  const place = (unit: Unit) => {
    placed.push(...unit.entries);
    perArtist.set(unit.artist, (perArtist.get(unit.artist) || 0) + 1);
    last = unit.artist;
  };
  for (const unit of units) {
    if (placed.length >= count) break;
    if ((perArtist.get(unit.artist) || 0) >= AHEAD_PER_ARTIST) continue;
    if (unit.artist === last) { waiting.push(unit); continue; }
    place(unit);
    // One kept back for coming right after its artist goes in as soon as another stands between.
    const next = waiting.findIndex(one => one.artist !== last && (perArtist.get(one.artist) || 0) < AHEAD_PER_ARTIST);
    if (next !== -1 && placed.length < count) place(waiting.splice(next, 1)[0]);
  }
  return placed;
};

const songOf = (entry: RadioEntry, fiche: FicheRecord): RadioSong => {
  const { songId, title, artist, albumId, album, cover, discNumber, track, durationSec, work, movement } = entry.song;
  return {
    songId, title, artist, albumId, album, cover, discNumber, track, durationSec,
    work: entry.workKey ? work : null, movement: entry.workKey ? movement : null,
    energy: fiche.energy, tempo: fiche.tempo, moods: fiche.moods, styles: fiche.styles, lang: fiche.lang,
  };
};

const ficheLine = (entry: RadioEntry, fiche: FicheRecord): string =>
  `${entry.song.artist} — ${entry.song.title} [energy ${fiche.energy}, ${fiche.tempo}, ${fiche.moods.join('/')}; ${fiche.styles.join('/')}]`;

/** The criteria in words, for the model's choice when the page sends no prompt. */
export const describeCriteria = (criteria: RadioCriteria): string => [
  criteria.energyMin != null || criteria.energyMax != null ? `energy ${criteria.energyMin ?? 0} to ${criteria.energyMax ?? 10}` : '',
  criteria.tempos?.length ? criteria.tempos.join(' or ') : '',
  criteria.moods?.length ? criteria.moods.join(', ') : '',
  criteria.styles?.length ? criteria.styles.join(' or ') : '',
  criteria.langs?.length ? `sung in ${criteria.langs.join(' or ')}` : '',
].filter(Boolean).join('; ') || 'anything good';

export const criteriaPrompt = (prompt: string): string =>
  `A listener asks a playlist for: "${prompt}". Turn it into criteria over each song's fiche: energy 0-10; tempo slow|mid|fast; `
  + `moods from [${MOODS.join(', ')}]; styles from [${STYLES.join(', ')}]; lang (english, french, instrumental…). `
  + 'Answer one JSON object {energy_min, energy_max, tempos:[], moods_any:[], styles:[], langs:[]}; '
  + 'an empty list or null for no constraint. '
  + 'styles: only the styles the listener names or plainly means, the most precise one ("rock alternatif" is ["alternative"], not "rock"), '
  + 'none when the prompt names no style; never the neighbouring styles, the playlist finds those itself. '
  + 'langs only when the listener asks for a language ("français" in the prompt\'s own words is the language it is written in, not a request, '
  + 'unless it qualifies the music: "rock français" is french). '
  + 'Be loose on what the prompt does not say.';

const choicePrompt = (prompt: string, count: number, candidates: Array<{ entry: RadioEntry; fiche: FicheRecord }>, heard: string[]): string => [
  `Make a playlist of ${count} for: "${prompt}". Choose from these candidates only, by number; varied, and following on well from what was just heard. `
  + 'Answer a JSON array of numbers in the order to listen to.',
  ...(heard.length ? ['Just heard (latest last):', ...heard] : []),
  'Candidates:',
  ...candidates.map(({ entry, fiche }, at) => `${at + 1}. ${ficheLine(entry, fiche)}`),
].join('\n');

/** The numbers an answer chooses, in its order, each once. */
export const parseChoice = (text: string, size: number): number[] | null => {
  const answer = jsonIn(text, '[');
  if (!Array.isArray(answer)) return null;
  const numbers = answer.map(numberOf).filter((n): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= size);
  return numbers.length ? [...new Set(numbers)] : null;
};

const shuffle = <T>(list: T[]): T[] => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const radioService = {
  /** The prompt heard as criteria by the local LLM, before the work queued behind it. */
  criteria: async (prompt: string): Promise<RadioCriteria> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const text = await inTurn(() => chatLocal(criteriaPrompt(prompt), { maxTokens: 600, temperature: 0.3, timeoutSec: 60 }), { urgent: true });
      const criteria = criteriaOf(jsonIn(text, '{') ?? 'none');
      if (criteria) return criteria;
      logger.warn(`Radio criteria: answer ${attempt} was no JSON object`);
    }
    throw new Error('The local LLM did not answer with criteria');
  },

  next: async ({ criteria, pool, count, ahead, keep = [], prompt = '' }: {
    criteria: RadioCriteria; pool: RadioPool; count: number; ahead: string[];
    /** The band as the page shows it: those that still fit stay, in their order, and only the rest is drawn. */
    keep?: string[];
    prompt?: string;
  }): Promise<RadioNext> => {
    const [known, fiches] = await Promise.all([catalogue(), TrackFiche.all()]);
    const { entries, bySongId } = known;
    const inThePool = entries.filter(entry => inPool(entry, pool));
    // A pool listened to gets its fiches written first.
    trackFicheService.queueFirst(inThePool, fiches);

    const history = await RadioHistory.since(new Date(Date.now() - 2 * REST_DAYS * DAY_MS));
    const resting = restingSongs(history, inThePool.length);
    const keyOf = (id: string) => bySongId.get(id)?.key;
    const restingKeys = new Set([...resting].map(keyOf).filter(Boolean));
    // The styles taken from the songs that may play, those of the band among them: neighbours only when the
    // asked style's are by too few artists.
    const inBand = new Set([...ahead, ...keep]);
    const { weights, neighbours } = reachOf(criteria, styleGraphOf(known, fiches), inThePool
      .filter(entry => fiches.has(entry.key) && (inBand.has(entry.song.songId) || !restingKeys.has(entry.key))
        && fitScore(fiches.get(entry.key)!, { ...criteria, styles: [] }) > 0)
      .map(entry => ({ artist: artistKey(entry.song.artist), styles: fiches.get(entry.key)!.styles })));

    // Still in the pool and still fitting: a band changes only as much as the criteria do. Already in the band,
    // they are not resting, and a work's movements kept stay together as they were.
    const aheadIds = new Set(ahead);
    const kept = [...new Set(keep)]
      .map(id => bySongId.get(id))
      .filter((entry): entry is RadioEntry => Boolean(entry) && !aheadIds.has(entry!.song.songId) && inPool(entry!, pool)
        && fiches.has(entry!.key) && stillFits(fiches.get(entry!.key)!, criteria, weights))
      .slice(0, count);

    const excluded = new Set([...ahead, ...kept.map(entry => entry.song.songId)]);
    // A recording ahead, kept or resting is so on every album it is on.
    const keysOut = new Set([...[...excluded].map(keyOf).filter(Boolean), ...restingKeys]);
    const fitting = inThePool
      .filter(entry => !excluded.has(entry.song.songId) && !keysOut.has(entry.key) && fiches.has(entry.key))
      .map(entry => ({ entry, fiche: fiches.get(entry.key)!, score: fitScore(fiches.get(entry.key)!, criteria, weights) }))
      .filter(one => one.score > 0);
    // A movement brought by its whole work may have no fiche yet: it wears one of its work's.
    const ficheOf = (entry: RadioEntry): FicheRecord => fiches.get(entry.key)
      ?? entry.workSongs.map(song => bySongId.get(song.songId)).map(one => one && fiches.get(one.key)).find(Boolean)
      ?? { key: entry.key, energy: 0, tempo: 'mid', moods: [], styles: [], lang: 'unknown', model: null, madeAt: '', version: 1 };
    const result = (songs: RadioEntry[]): RadioNext => ({
      songs: [...kept, ...songs].map(entry => songOf(entry, ficheOf(entry))),
      poolSize: inThePool.length,
      fitting: fitting.length + kept.length,
      missingFiches: inThePool.filter(entry => !fiches.has(entry.key)).length,
      neighbours,
    });
    const wanted = count - kept.length;
    if (fitting.length === 0 || wanted <= 0) return result([]);

    // The best fits first, the ties drawn at random; at most three by one artist, a work once when it comes whole.
    const candidates: typeof fitting = [];
    const perArtist = new Map<string, number>();
    const works = new Set<string>();
    for (const one of shuffle([...fitting]).sort((a, b) => b.score - a.score)) {
      const artist = artistKey(one.entry.song.artist);
      if ((perArtist.get(artist) || 0) >= CANDIDATES_PER_ARTIST) continue;
      if (pool.wholeWorks && one.entry.workKey && works.has(one.entry.workKey)) continue;
      perArtist.set(artist, (perArtist.get(artist) || 0) + 1);
      if (one.entry.workKey) works.add(one.entry.workKey);
      candidates.push(one);
      if (candidates.length === CANDIDATES) break;
    }

    const heard = history.slice(0, HEARD_SHOWN).reverse()
      .map(leaving => ({ leaving, entry: bySongId.get(leaving.songId) }))
      .filter(one => one.entry)
      .map(({ leaving, entry }) => `- ${entry!.song.artist} — ${entry!.song.title}${leaving.how === 'skipped' ? ' (skipped)' : ''}`);
    const order = shuffle([...candidates]);
    let chosen: RadioEntry[] = [];
    const cancelled = { now: false };
    try {
      const started = Date.now();
      const asked = inTurn(async () => {
        if (cancelled.now) return null;
        return chatLocal(choicePrompt(prompt || describeCriteria(criteria), Math.min(order.length, wanted + 3), order, heard), { maxTokens: 400, temperature: 0.3, timeoutSec: 40 });
      }, { urgent: true });
      const text = await Promise.race([asked, new Promise<null>(resolve => setTimeout(() => resolve(null), CHOICE_WAIT_MS).unref())]);
      if (text === null) { cancelled.now = true; throw new Error('the model was busy too long'); }
      const numbers = parseChoice(text, order.length);
      if (!numbers) throw new Error('its answer was no list');
      chosen = numbers.map(n => order[n - 1].entry);
      logger.info(`Radio: ${chosen.length} chosen of ${order.length} in ${Date.now() - started} ms`);
    } catch (error) {
      logger.warn(`Radio: the best fits stand in for the model's choice: ${(error as Error).message}`);
    }
    // What the rules leave out is made up from the best fits.
    const songs = arrange([...chosen, ...candidates.map(one => one.entry)], {
      ahead: [...ahead.map(id => bySongId.get(id)).filter((one): one is RadioEntry => Boolean(one)), ...kept],
      count: wanted, wholeWorks: pool.wholeWorks, catalogueOf: id => bySongId.get(id), excluded,
    });
    return result(songs);
  },

  left: (songId: string, how: LeftHow): Promise<void> => RadioHistory.add(songId, how),
};

export default radioService;
