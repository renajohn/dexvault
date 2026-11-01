import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';
import Book from '../models/book';
import scorePiecesService from './scorePiecesService';
import scoreFilesService, { filesDir, ScoreFile, ScoreFilesError } from './scoreFilesService';
import logger from '../logger';

/**
 * The Mutopia Project's pieces of a score: engraved anew with LilyPond, in the
 * public domain or under Creative Commons, their PDFs downloaded without a
 * check for people (IMSLP's). Each piece of the score, or each part of a set
 * (Träumerei of Kinderszenen), is found among the composer's by its number
 * (op. 15 no. 7, BWV 847, L. 75) or its name; those chosen are fetched, laid
 * one after the other in one PDF, and each marked at its pages.
 */

const SITE = 'https://www.mutopiaproject.org';
const HEADERS = { 'User-Agent': 'DexVault/1.0 (personal music library)' };

export interface MutopiaEntry {
  /** Its number on Mutopia: piece-info.cgi?id=504. */
  id: string;
  title: string;
  /** "Op. 15, No. 2", "O 15 N 1", "BWV 847", "L75" as Mutopia writes it. */
  opus: string | null;
  /** "Piano", "Voice and Piano". */
  instrument: string | null;
  /** The edition it was engraved from: "Leichte Stucke, 1900". */
  source: string | null;
  licence: string | null;
  /** Its PDF on A4, or for a work of several movements the zip of their PDFs and the whole's. */
  pdf: string;
  /** The first bars, small. */
  preview: string | null;
}

export interface MutopiaTarget {
  pieceId: number;
  /** The part of a set; null for the piece whole. */
  partWorkId: string | null;
  /** What it is called in the score: "No. 7. Träumerei", "Clair de lune". */
  name: string;
  /** The piece of the score it is, or is a part of: "Kinderszenen, op. 15". */
  piece: string;
  /** Mutopia's that play it, the likely ones checked. */
  candidates: Array<MutopiaEntry & { checked: boolean }>;
  /**
   * The same, as the versions to choose from: Mutopia's for one instrument
   * that make the piece together (a prelude and its fugue), the one checked
   * first, then the keyboard's.
   */
  versions: MutopiaVersion[];
}

export interface MutopiaVersion { instrument: string | null; entries: MutopiaEntry[]; checked: boolean }

// ---------------------------------------------------------------------------
// Reading Mutopia's pages.

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', apos: "'" };
const text = (html: string) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
  .replace(/\s+/g, ' ').trim();

/** The pieces of a page of Mutopia's listing, each a table of four rows. */
export const entriesOf = (html: string): MutopiaEntry[] => {
  const entries: MutopiaEntry[] = [];
  for (const table of html.split('<table class="table-bordered result-table">').slice(1)) {
    const body = table.slice(0, table.indexOf('</table>'));
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const pdf = body.match(/href="([^"]+-a4\.pdf)"/)?.[1] ?? body.match(/href="([^"]+-a4-pdfs\.zip)"/)?.[1];
    const id = body.match(/piece-info\.cgi\?id=(\d+)/)?.[1];
    if (!pdf || !id || cells.length < 8) continue;
    const opus = text(cells[2]);
    entries.push({
      id,
      title: text(cells[0]),
      opus: opus && opus !== ' ' ? opus : null,
      instrument: text(cells[4]).replace(/^for\s+/i, '') || null,
      source: text(cells[8] ?? '') || null,
      licence: text(cells[9] ?? '') || null,
      pdf: pdf.startsWith('http') ? pdf : `${SITE}/${pdf.replace(/^(\.\.\/)+/, '')}`,
      preview: body.match(/href="([^"]+-preview\.(?:png|svg))"/)?.[1] ?? null,
    });
  }
  return entries;
};

const plain = (words: string) => words.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Its composers as Mutopia lists them: "SchumannR" for "R. Schumann (1810–1856)", with how many pieces. */
export const composersOf = (html: string): Array<{ code: string; name: string; count: number }> =>
  [...html.matchAll(/Composer=([A-Za-z]+)'>([^<]+)<\/a>\s*\[(\d+)\]/g)]
    .map(([, code, name, count]) => ({ code, name: text(name).replace(/\s*\(.*$/, ''), count: Number(count) }));

/**
 * The composer's code: the same surname, the same first initial, the most
 * initials in common ("J. S. Bach" for Johann Sebastian, not "C. P. E. Bach").
 */
export const composerOf = (composers: Array<{ code: string; name: string; count: number }>, composer: string) => {
  const words = plain(composer).split(' ').filter(word => !['van', 'von', 'de', 'der', 'la'].includes(word));
  const surname = words[words.length - 1];
  const initials = words.slice(0, -1).map(word => word[0]);
  let best: { code: string; name: string; count: number } | null = null;
  let score = 0;
  for (const candidate of composers) {
    const theirs = plain(candidate.name).split(' ');
    if (theirs[theirs.length - 1] !== surname) continue;
    const their = theirs.slice(0, -1).filter(word => !['van', 'von', 'de', 'v'].includes(word)).map(word => word[0]);
    if (initials.length && their.length && their[0] !== initials[0]) continue;
    const common = 1 + their.filter((initial, i) => initials[i] === initial).length - Math.abs(their.length - initials.length) * 0.1;
    if (common > score) { best = candidate; score = common; }
  }
  return best;
};

// ---------------------------------------------------------------------------
// Numbers and names.

export interface Key { system: string; main: number; sub: number | null }

/** Catalogues whose number names a piece alone: what follows ("no. 2" of the Well-Tempered Clavier) says nothing more. */
const UNIQUE = new Set(['bwv', 'k', 'd', 'hwv', 's', 'woo']);
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24 };

/**
 * The numbers a title names, each with its number in a set: "Kinderszenen,
 * op. 15: No. 7" and Mutopia's "O 15 N 7" are op. 15 no. 7; "Préludes, Livre I,
 * L. 117: IV. Les sons…" is L. 117 no. 4 when asked to read its roman numeral.
 * A range (BWV 846–869) names no piece and is left out.
 */
export const keysOf = (title: string, roman = false): Key[] => {
  const keys: Key[] = [];
  const add = (system: string, main: string, sub: number | null) => {
    if (!keys.some(key => key.system === system && key.main === Number(main))) keys.push({ system, main: Number(main), sub: UNIQUE.has(system) ? null : sub });
  };
  const numberIn = (rest: string): number | null => {
    const found = rest.match(/\b(?:no|nr|n°|N)\.?\s*(\d+)/i) || rest.match(/(?:^|[\s,])N\s+(\d+)/);
    if (found) return Number(found[1]);
    const numeral = roman ? rest.match(/:\s*([IVX]+)\.\s/) : null;
    return numeral ? ROMAN[numeral[1].toLowerCase()] ?? null : null;
  };
  const sub = numberIn(title);
  // BWV 515a is not BWV 515; BWV 812.2 is a version of 812.
  for (const m of title.matchAll(/\bBWV\s*(\d+)([a-z]?)(?:\.\d+)?(\s*[-–]\s*\d+)?/gi)) if (!m[3]) add(`bwv${m[2].toLowerCase()}`, m[1], null);
  // The Anhang's own numbers, each of a list: "BWV Anh. 114, 115, 116" is three menuets.
  for (const m of title.matchAll(/\bBWV\s*Anh\.?\s*(\d+[a-z]?(?:\s*,\s*\d+[a-z]?)*)/gi)) {
    for (const one of m[1].split(/\s*,\s*/)) add(`bwvanh${one.replace(/\d+/, '').toLowerCase()}`, one.replace(/\D+$/, ''), null);
  }
  for (const m of title.matchAll(/\bop(?:us)?\.?\s*(\d+)(?:\s*\/\s*(\d+))?/gi)) add('op', m[1], m[2] ? Number(m[2]) : sub);
  for (const m of title.matchAll(/(?:^|[\s,(])O\s+(\d+)\b/g)) add('op', m[1], sub);
  for (const m of title.matchAll(/\bK(?:V)?\.?\s*(\d+)/g)) add('k', m[1], null);
  for (const m of title.matchAll(/\bWoO\s*(\d+)/gi)) add('woo', m[1], null);
  for (const m of title.matchAll(/\bL\.?\s*(\d+)(\s*[-–]\s*\d+)?/g)) if (!m[2]) add('l', m[1], sub);
  for (const m of title.matchAll(/\b(D|S|HWV)\.?\s+(\d+)/g)) add(m[1].toLowerCase(), m[2], null);
  return keys;
};

/** Words of no help to tell a piece: its kind, its key, its numbers. */
const NOISE = new Set(['no', 'nr', 'op', 'opus', 'in', 'major', 'minor', 'dur', 'moll', 'de', 'la', 'le', 'les', 'des', 'du', 'et', 'and', 'und',
  'the', 'of', 'for', 'pour', 'piano', 'sharp', 'flat', 'bwv', 'anh', 'cd', 'from', 'aus', 'der', 'die', 'das', 'en', 'un', 'une']);
export const nameWordsOf = (name: string): string[] => plain(name.replace(/\b(?:BWV(?:\s*Anh)?|op|L|K|CD|WoO|D|S)\.?\s*\d+\w*/gi, ' '))
  .split(' ').filter(word => word.length > 2 && !/^\d+$/.test(word) && !NOISE.has(word) && !(word in ROMAN));

/** Every word of its name in the other's title: "Clair de lune" in "Suite Bergamasque: Clair de Lune". */
const named = (name: string, title: string) => {
  const words = nameWordsOf(name);
  const theirs = new Set(nameWordsOf(title));
  return words.length > 0 && words.every(word => theirs.has(word));
};

const KEYBOARD = /piano|harpsichord|clavichord|keyboard|cembalo/i;

export interface Wanted {
  pieceId: number;
  partWorkId: string | null;
  name: string;
  /** Its full title, which has its numbers. */
  title: string;
  /** Its set's title, a part's: the numbers it shares with its set name the set, not it. */
  setTitle?: string;
  /** A set whole, its parts wanted besides. */
  whole: boolean;
}

/**
 * Mutopia's for a piece, as versions: those for one instrument together, a
 * second of the same title (Op. 28 No. 4 "from Peters source") a version of
 * its own. The one checked first, then the keyboard's, then the others.
 */
export const versionsOf = (list: MutopiaEntry[], likely: MutopiaEntry[]): MutopiaVersion[] => {
  const versions: Array<MutopiaVersion & { titles: Set<string> }> = [];
  for (const entry of list) {
    const title = plain(entry.title.replace(/\(.*?\)/g, ' '));
    let version = versions.find(one => one.instrument === entry.instrument && !one.titles.has(title));
    if (!version) versions.push(version = { instrument: entry.instrument, entries: [], checked: false, titles: new Set() });
    version.entries.push(entry);
    version.titles.add(title);
    if (likely.includes(entry)) version.checked = true;
  }
  const rank = (version: MutopiaVersion) => (version.checked ? 0 : KEYBOARD.test(version.instrument || '') ? 1 : 2);
  return versions.map(({ titles, ...version }) => version).sort((a, b) => rank(a) - rank(b));
};

/**
 * Which of Mutopia's pieces plays each piece or part. The same number, and
 * the same number in its set when both say one (op. 15 no. 7); when Mutopia's
 * says none ("Suite Bergamasque: Clair de Lune", L75), the same name. A piece
 * of Mutopia's no part has taken goes to the set whole (Debussy's Préludes,
 * Book 1). The likely ones are checked: one of each version ("No. 4 (from
 * Peters source)" is No. 4 again), for the keyboard when there is one, and
 * of many under one number (the Goldberg Variations, BWV 988, for the Aria of
 * Anna Magdalena's book) those its name says. A prelude comes before its fugue.
 */
export const matchPieces = (wanted: Wanted[], entries: MutopiaEntry[]): MutopiaTarget[] => {
  const keysOfEntry = new Map(entries.map(entry => [entry.id, keysOf(`${entry.title} ${entry.opus || ''}`)]));
  const same = (a: Key, b: Key) => a.system === b.system && a.main === b.main && a.sub === b.sub;
  const playing = (target: Wanted, entry: MutopiaEntry): boolean => {
    const theirs = keysOfEntry.get(entry.id) || [];
    // A movement of "Sonata no. 14, op. 27 no. 2" is not told by op. 27 no. 2, the sonata's: by its name alone.
    const sets = target.setTitle ? keysOf(target.setTitle) : [];
    const ours = keysOf(target.title, true).filter(key => !sets.some(set => same(set, key)));
    if (!ours.length && sets.length) return theirs.some(their => sets.some(set => set.system === their.system && set.main === their.main)) && named(target.name, entry.title);
    if (!ours.length) return !theirs.length && named(target.name || target.title, entry.title);
    return ours.some(key => theirs.some(their => {
      if (their.system !== key.system || their.main !== key.main) return false;
      if (target.whole) return their.sub === key.sub;
      if (key.sub != null && their.sub != null) return key.sub === their.sub;
      if (key.sub != null) return named(target.name, entry.title);
      return their.sub == null;
    }));
  };
  const found = new Map(wanted.map(target => [target, entries.filter(entry => playing(target, entry))]));
  // A set's piece one of its parts plays is the part's, not the set's.
  const partsOf = (pieceId: number) => wanted.filter(target => target.pieceId === pieceId && !target.whole);
  for (const target of wanted.filter(one => one.whole)) {
    found.set(target, found.get(target)!.filter(entry => !partsOf(target.pieceId).some(part => found.get(part)!.includes(entry))));
  }
  // The set whole on Mutopia: its parts besides are not checked, they are in it.
  const wholeFound = new Set(wanted.filter(target => target.whole && found.get(target)!.length).map(target => target.pieceId));
  // A score for the piano among them: a waltz for two guitars is not its.
  const keyboard = [...found.values()].flat().some(entry => KEYBOARD.test(entry.instrument || ''));
  const rank = (entry: MutopiaEntry) => (/fug/i.test(entry.title) ? 1 : 0);
  // A piece a score holds twice (French Suite no. 3 in the books of 1722 and of 1725) is fetched once.
  const taken = new Set<string>();
  return wanted.map(target => {
    let list = [...found.get(target)!].sort((a, b) => rank(a) - rank(b));
    const seen = new Set<string>();
    let likely = list.filter(entry => {
      const version = plain(entry.title.replace(/\(.*?\)/g, ' '));
      if ((!target.whole && wholeFound.has(target.pieceId)) || (keyboard && !KEYBOARD.test(entry.instrument || '')) || seen.has(version)) return false;
      seen.add(version);
      return true;
    });
    // Of many under one number (the Goldberg Variations, BWV 988), those its name says, and only them.
    if (!target.whole && list.length > 2) {
      const words = new Set(nameWordsOf(target.name || target.title));
      const said = (entry: MutopiaEntry) => nameWordsOf(entry.title).some(word => words.has(word));
      if (list.some(said)) list = list.filter(said);
      if (likely.length > 2) likely = likely.filter(said);
    }
    likely = likely.filter(entry => !taken.has(entry.id));
    for (const entry of likely) taken.add(entry.id);
    return {
      pieceId: target.pieceId,
      partWorkId: target.partWorkId,
      name: target.name || target.title,
      piece: target.setTitle || target.title,
      candidates: list.map(entry => ({ ...entry, checked: likely.includes(entry) })),
      versions: versionsOf(list, likely),
    };
  });
};

// ---------------------------------------------------------------------------
// Asking Mutopia.

const cache = new Map<string, { at: number; html: string }>();
const WEEK = 7 * 24 * 3600 * 1000;

const page = async (url: string): Promise<string> => {
  const kept = cache.get(url);
  if (kept && Date.now() - kept.at < WEEK) return kept.html;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000, responseType: 'text' });
  cache.set(url, { at: Date.now(), html: String(data) });
  return String(data);
};

/**
 * Every piece of the composer's, its listing read over its pages of ten, four
 * at a time (Bach's 417 in some ten seconds, then kept a week). Mutopia's own
 * search misses numbers it holds (816 finds no French Suite no. 5).
 */
export const entriesFor = async (code: string, count: number): Promise<MutopiaEntry[]> => {
  const at = (start: number) => page(`${SITE}/cgibin/make-table.cgi?${new URLSearchParams({ Composer: code, ...(start ? { startat: String(start) } : {}) })}`);
  const pages: string[] = [];
  const starts = Array.from({ length: Math.max(1, Math.ceil(count / 10)) }, (_, i) => i * 10);
  for (let i = 0; i < starts.length; i += 4) pages.push(...await Promise.all(starts.slice(i, i + 4).map(at)));
  // More than browse.html counted: the rest, one page after the other.
  for (let start = starts.length * 10; />Next 10</.test(pages[pages.length - 1]) && start < 2000; start += 10) pages.push(await at(start));
  const entries = new Map<string, MutopiaEntry>();
  for (const html of pages) for (const entry of entriesOf(html)) entries.set(entry.id, entry);
  return [...entries.values()];
};

/** Mutopia's pieces for each of a score's pieces, or each part it holds of a set. */
const find = async (bookId: number): Promise<{ composer: { code: string; name: string } | null; targets: MutopiaTarget[] }> => {
  const book = await Book.findById(bookId);
  if (!book || book.bookType !== 'score') throw new ScoreFilesError('No such score', 404);
  if (!book.composer) return { composer: null, targets: [] };
  let browse: string;
  try { browse = await page(`${SITE}/browse.html`); } catch (error) {
    logger.warn(`[Mutopia] Its composers: ${(error as Error).message}`);
    throw new ScoreFilesError('Mutopia did not answer', 503);
  }
  const composer = composerOf(composersOf(browse), book.composer);
  if (!composer) return { composer: null, targets: [] };
  const pieces = await scorePiecesService.pieces(bookId);
  const wanted: Wanted[] = pieces.flatMap(piece => {
    const whole: Wanted = { pieceId: piece.id, partWorkId: null, name: piece.title, title: piece.title, whole: !piece.single };
    if (piece.single) return [whole];
    return [...piece.parts.map(part => ({ pieceId: piece.id, partWorkId: part.workId, name: part.name, title: part.title, setTitle: piece.title, whole: false })), whole];
  // A part the score holds twice (French Suite no. 3 in the books of 1722 and of 1725) is one piece to fetch.
  }).filter((one, i, all) => all.findIndex(other => other.pieceId === one.pieceId && other.partWorkId === one.partWorkId) === i);
  try {
    const entries = await entriesFor(composer.code, composer.count);
    const targets = matchPieces(wanted, entries);
    // The set whole is shown only when Mutopia has it so.
    return { composer: { code: composer.code, name: composer.name }, targets: targets.filter((target, i) => !wanted[i].whole || target.candidates.length) };
  } catch (error) {
    logger.warn(`[Mutopia] ${composer.code}: ${(error as Error).message}`);
    throw new ScoreFilesError('Mutopia did not answer', 503);
  }
};

/** Where a suite's movement stands when the score names none: a gigue last, galanteries after the sarabande. */
const DANCES: Array<[RegExp, number]> = [
  [/^(prelud|praelud|preamb|ouvert|overt|fantas|sinfon|toccat)/, 0],
  [/^alleman/, 1], [/^(couran|corren)/, 2], [/^saraband/, 3], [/^gig/, 5],
];
const danceRank = (name: string) => DANCES.find(([word]) => word.test(name))?.[1] ?? 4;

/**
 * The whole work in a zip of its movements' PDFs: french-suite-3-a4.pdf beside
 * bach-french-suite-3-allemande-a4.pdf and the others. A zip without it
 * (french-suite-5's, its seven movements alone) gives them one after the
 * other, in the order of the names given (the parts of the score's piece)
 * when each is found among them, else in a suite's (allemande, courante,
 * sarabande, the others, gigue): Mutopia's own is alphabetical.
 */
export const wholeIn = async (zip: Buffer, url: string, names: string[] = []): Promise<Buffer> => {
  const base = path.basename(url).replace(/-a4-pdfs\.zip$/, '');
  const entries = new AdmZip(zip).getEntries().filter(entry => !entry.isDirectory && /\.pdf$/i.test(entry.entryName));
  const whole = entries.find(entry => path.basename(entry.entryName) === `${base}-a4.pdf`);
  if (whole) return whole.getData();
  if (!entries.length) throw new ScoreFilesError(`${path.basename(url)} holds no PDF`, 502);
  const movements = entries.map(entry => {
    const file = path.basename(entry.entryName);
    const at = file.indexOf(`${base}-`);
    const name = plain((at >= 0 ? file.slice(at + base.length + 1) : file).replace(/-a4\.pdf$/i, '').replace(/-/g, ' '));
    return { entry, file, name };
  });
  const given = names.map(plain);
  const found = movements.map(movement => given.findIndex(one => movement.name && ` ${one} `.includes(` ${movement.name} `)));
  const byNames = found.every(index => index >= 0);
  const ordered = movements.map((movement, i) => ({ ...movement, rank: byNames ? found[i] : danceRank(movement.name) }))
    .sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file, undefined, { numeric: true }));
  const out = await PDFDocument.create();
  for (const { entry } of ordered) {
    const doc = await PDFDocument.load(entry.getData(), { ignoreEncryption: true });
    for (const copied of await out.copyPages(doc, doc.getPageIndices())) out.addPage(copied);
  }
  return Buffer.from(await out.save());
};

export interface MutopiaPick { pieceId: number; partWorkId: string | null; pdf: string }

/**
 * The pieces chosen, fetched from Mutopia, laid in the order given in one PDF
 * kept with the score's, each piece marked at its pages (a prelude and its
 * fugue, two of Mutopia's, one piece of the score).
 */
const fetchInto = async (bookId: number, picks: unknown): Promise<ScoreFile[]> => {
  if (!Array.isArray(picks) || !picks.length) throw new ScoreFilesError('Which pieces?', 400);
  const chosen: MutopiaPick[] = picks.map(pick => {
    const { pieceId, partWorkId, pdf } = (pick || {}) as Record<string, unknown>;
    // Mutopia's own files alone: the server fetches nothing else.
    if (typeof pdf !== 'string' || !/^https:\/\/www\.mutopiaproject\.org\/ftp\/[\w./-]+(?:\.pdf|-a4-pdfs\.zip)$/.test(pdf) || pdf.includes('..')) {
      throw new ScoreFilesError('Not a PDF of Mutopia', 400);
    }
    return { pieceId: Number(pieceId), partWorkId: typeof partWorkId === 'string' && partWorkId ? partWorkId : null, pdf };
  });
  await scoreFilesService.list(bookId);
  const pieces = new Map((await scorePiecesService.pieces(bookId)).map(piece => [piece.id, piece]));
  if (chosen.some(pick => !pieces.has(pick.pieceId))) throw new ScoreFilesError('A piece this score does not hold', 400);
  const out = await PDFDocument.create();
  const marks = new Map<string, { pieceId: number; partWorkId: string | null; startPage: number; endPage: number }>();
  for (const pick of chosen) {
    let bytes: ArrayBuffer;
    try {
      ({ data: bytes } = await axios.get<ArrayBuffer>(pick.pdf, { headers: HEADERS, timeout: 60000, responseType: 'arraybuffer' }));
    } catch (error) {
      logger.warn(`[Mutopia] ${pick.pdf}: ${(error as Error).message}`);
      throw new ScoreFilesError(`Mutopia did not give ${path.basename(pick.pdf)}`, 502);
    }
    const names = pick.partWorkId ? [] : pieces.get(pick.pieceId)!.parts.map(part => part.title);
    const doc = await PDFDocument.load(pick.pdf.endsWith('.zip') ? await wholeIn(Buffer.from(bytes), pick.pdf, names) : bytes, { ignoreEncryption: true });
    const startPage = out.getPageCount() + 1;
    for (const copied of await out.copyPages(doc, doc.getPageIndices())) out.addPage(copied);
    const key = `${pick.pieceId}:${pick.partWorkId || ''}`;
    const mark = marks.get(key);
    marks.set(key, { pieceId: pick.pieceId, partWorkId: pick.partWorkId, startPage: mark?.startPage ?? startPage, endPage: out.getPageCount() });
  }
  out.setTitle('Mutopia Project');
  const dir = filesDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `score_${bookId}_${Date.now()}_Mutopia.pdf`;
  fs.writeFileSync(path.join(dir, filename), await out.save());
  const files = await scoreFilesService.add(bookId, filename, 'Mutopia Project', 'mutopia');
  const file = files.find(one => one.filename === filename)!;
  await scoreFilesService.keepBookmarks(bookId, file.id, { bookmarks: [...marks.values()], pageCount: out.getPageCount() });
  return files;
};

export default { find, fetchInto };
