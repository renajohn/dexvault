import { getDatabase } from '../database';
import Book from '../models/book';
import musicbrainzService, { type MBWorkHit, type MBWorkRef } from './musicbrainzService';
import wikidataWorksService, { type WikidataWork } from './wikidataWorksService';
import imslpWorksService, { catalogueFor } from './imslpWorksService';
import logger from '../logger';

/**
 * The pieces a score holds, as MusicBrainz works, and the recordings of the
 * music that play them. Each recording of the collection is indexed with the
 * works it performs and the works those are part of (a prélude, its book), so a
 * score holding "Préludes, Livre I" finds the twelve tracks that play it,
 * whatever album they are on. A composer's name would not do: the John
 * Williams of a pop album did not write Harry Potter.
 */

export class ScorePiecesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ScorePiecesError';
  }
}

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> => new Promise((resolve, reject) => {
  getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || [])));
});
const run = (sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> => new Promise((resolve, reject) => {
  getDatabase().run(sql, params, function (this: { lastID: number; changes: number }, err: Error | null) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
});
const parse = <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) as T : fallback; } catch { return fallback; } };

/** Albums whose tracks count: one's CDs and digital albums, not the wishes nor the mixtapes. */
const HELD = `COALESCE(a.title_status, 'owned') IN ('owned', 'digital')`;

// ---------------------------------------------------------------------------
// The works MusicBrainz knows, kept once fetched.

type StoredPart = { id: string; title: string; imslp?: string | null };
interface StoredWork { id: string; title: string; parentIds: string[]; parts: StoredPart[] | null; imslp: string | null }

const storedWorks = async (ids: string[]): Promise<Map<string, StoredWork>> => {
  if (!ids.length) return new Map();
  const rows = await all<{ id: string; title: string; parent_ids: string | null; parts: string | null; imslp: string | null }>(
    `SELECT * FROM mb_works WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return new Map(rows.map(row => [row.id, { id: row.id, title: row.title, parentIds: parse(row.parent_ids, []), parts: parse(row.parts, null), imslp: row.imslp ?? null }]));
};

const keepWork = async (work: { id: string; title: string; parentIds?: string[] }, parts?: StoredPart[], imslp?: string | null): Promise<void> => {
  await run(`INSERT INTO mb_works (id, title, parent_ids, parts, imslp, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title,
      parent_ids = COALESCE(excluded.parent_ids, mb_works.parent_ids), parts = COALESCE(excluded.parts, mb_works.parts),
      imslp = COALESCE(excluded.imslp, mb_works.imslp)`,
  [work.id, work.title, work.parentIds ? JSON.stringify(work.parentIds) : null, parts ? JSON.stringify(parts) : null, imslp ?? null, new Date().toISOString()]);
};

const isWikidata = (id: string) => /^wd:Q\d+$/.test(id);

/** The MusicBrainz work bearing a catalogue number: "BWV 772" is "Inventio Nr. 1 C-Dur, BWV 772". */
const byNumber = async (number: string, composer: string | null): Promise<string | null> => (await byNumberHit(number, composer))?.id ?? null;

const byNumberHit = async (number: string, composer: string | null): Promise<MBWorkHit | null> => {
  const surname = composer?.split(' ').slice(-1)[0];
  const pattern = (text: string) => new RegExp(`${text.replace(/[.]/g, '\\.').replace(/\s+/g, '\\s*')}(?![\\d.a-z])`, 'i');
  // "op. 28 no. 4" is "Prélude no. 4 in E minor, op. 28" as well: the set's number and the place, anywhere.
  const [set, place] = number.split(/\s+(?=no\.)/);
  const query = [quote(set), place ? quote(place) : null, surname ? `artist:${quote(surname)}` : null].filter(Boolean).join(' AND ');
  const hits = await search(query, 8);
  const [setRe, placeRe] = [pattern(set), place ? pattern(place) : null];
  return hits.filter(hit => setRe.test(hit.title) && (!placeRe || placeRe.test(hit.title))
      && !isMovement(hit.title.slice(Math.max(hit.title.search(setRe), placeRe ? hit.title.search(placeRe) : 0))))
    .sort((a, b) => b.score - a.score)[0] ?? null;
};

/**
 * A work as IMSLP's page lists it: each piece tied to MusicBrainz by its
 * number when one is found (its MusicBrainz title then), its own IMSLP page.
 */
const imslpSet = async (page: string, composer: string | null): Promise<StoredWork> => {
  const work = await imslpWorksService.work(page);
  if (!work) throw new ScorePiecesError('No such work on IMSLP', 404);
  const parts: StoredPart[] = [];
  for (const [index, piece] of work.pieces.entries()) {
    const hit = piece.catalogue ? await byNumberHit(piece.catalogue, composer).catch(() => null) : null;
    parts.push({ id: hit?.id || `imslp:${page}#${index + 1}`, title: hit?.title || piece.title, imslp: piece.page });
  }
  const stored: StoredWork = { id: `imslp:${page}`, title: work.title, parentIds: [], parts, imslp: page };
  await keepWork(stored, parts, page);
  return stored;
};

/**
 * A set Wikidata knows and MusicBrainz does not ("15 Inventions"): its parts,
 * each with its MusicBrainz work when Wikidata names it, else the one its
 * catalogue number finds, which ties it to the recordings; its IMSLP pages.
 */
const wikidataSet = async (qid: string, composer: string | null): Promise<StoredWork> => {
  const [work] = await wikidataWorksService.works([qid]);
  if (!work) throw new ScorePiecesError('No such work in Wikidata', 404);
  const parts: StoredPart[] = [];
  for (const part of await wikidataWorksService.works(work.partQids)) {
    let id = part.mbWorkId;
    for (const number of part.catalogue) { if (id) break; id = await byNumber(number, composer).catch(() => null); }
    parts.push({ id: id || `wd:${part.qid}`, title: part.title, imslp: part.imslp });
  }
  const stored: StoredWork = { id: `wd:${qid}`, title: work.title, parentIds: [], parts, imslp: work.imslp };
  await keepWork(stored, parts, work.imslp);
  return stored;
};

/** The IMSLP pages of a MusicBrainz work and of its parts, when Wikidata has them. */
const imslpOf = async (work: { id: string; parts: StoredPart[] }): Promise<{ imslp: string | null; parts: StoredPart[] }> => {
  try {
    const item = await wikidataWorksService.byMusicBrainz(work.id);
    if (!item) return { imslp: null, parts: work.parts };
    const byMb = new Map((await wikidataWorksService.works(item.partQids)).filter(part => part.mbWorkId).map(part => [part.mbWorkId!, part.imslp]));
    return { imslp: item.imslp, parts: work.parts.map(part => ({ ...part, imslp: byMb.get(part.id) ?? null })) };
  } catch {
    return { imslp: null, parts: work.parts };
  }
};

/** A work with its parts, from MusicBrainz (or Wikidata, for a set it alone knows) the first time. */
const workWithParts = async (id: string, composer: string | null = null): Promise<StoredWork> => {
  const kept = (await storedWorks([id])).get(id);
  if (kept?.parts) return kept;
  if (isWikidata(id)) return wikidataSet(id.slice(3), composer);
  if (id.startsWith('imslp:')) return imslpSet(id.slice(6), composer);
  const work = await musicbrainzService.getWorkWithParts(id);
  const { imslp, parts } = await imslpOf(work);
  await keepWork(work, parts, imslp);
  return { id: work.id, title: work.title, parentIds: work.parentIds, parts, imslp };
};

// ---------------------------------------------------------------------------
// The works of the recordings of the collection.

const indexRecording = async (recordingId: string, works: MBWorkRef[]): Promise<void> => {
  await run('DELETE FROM recording_works WHERE recording_id = ?', [recordingId]);
  for (const work of works) {
    await keepWork(work);
    await run('INSERT OR IGNORE INTO recording_works (recording_id, work_id, depth) VALUES (?, ?, 0)', [recordingId, work.id]);
    for (const parent of work.parents || []) {
      await keepWork(parent);
      await run('INSERT OR IGNORE INTO recording_works (recording_id, work_id, depth) VALUES (?, ?, 1)', [recordingId, parent.id]);
    }
  }
  await run('INSERT OR REPLACE INTO recordings_indexed (recording_id, indexed_at) VALUES (?, ?)', [recordingId, new Date().toISOString()]);
};

let indexing: Promise<{ albums: number; recordings: number }> | null = null;

/**
 * The works of every recording not indexed yet: one lookup per album edition,
 * then one per recording its edition does not hold (one found by search).
 */
const indexAll = (): Promise<{ albums: number; recordings: number }> => {
  if (indexing) return indexing;
  indexing = (async () => {
    const rows = await all<{ album_id: number; release_id: string | null; recording_id: string }>(`
      SELECT t.album_id, a.musicbrainz_release_id AS release_id, t.musicbrainz_recording_id AS recording_id
      FROM tracks t JOIN albums a ON a.id = t.album_id
      WHERE ${HELD} AND t.musicbrainz_recording_id IS NOT NULL AND t.musicbrainz_recording_id != ''
        AND t.musicbrainz_recording_id NOT IN (SELECT recording_id FROM recordings_indexed)`);
    const byAlbum = new Map<number, { releaseId: string | null; recordings: Set<string> }>();
    for (const row of rows) {
      const album = byAlbum.get(row.album_id) || { releaseId: row.release_id, recordings: new Set<string>() };
      album.recordings.add(row.recording_id);
      byAlbum.set(row.album_id, album);
    }
    let recordings = 0;
    for (const [albumId, album] of byAlbum) {
      try {
        const left = new Set(album.recordings);
        if (album.releaseId) {
          const works = await musicbrainzService.getReleaseRecordingWorks(album.releaseId);
          for (const id of album.recordings) {
            if (!works.has(id)) continue;
            await indexRecording(id, works.get(id)!);
            left.delete(id);
            recordings++;
          }
        }
        for (const id of left) {
          await indexRecording(id, await musicbrainzService.getRecordingWorks(id));
          recordings++;
        }
      } catch (error) {
        logger.warn(`Album ${albumId}: works of its recordings not read: ${(error as Error).message}`);
      }
    }
    return { albums: byAlbum.size, recordings };
  })().finally(() => { indexing = null; });
  return indexing;
};

// ---------------------------------------------------------------------------
// The recordings of works.

export interface PieceRecording { trackId: number; albumId: number; disc: number; no: number; title: string; durationSec: number | null }

export interface PieceAlbum {
  albumId: number;
  title: string;
  artist: string[];
  /** Who plays: the performers of its tracks, its artists without the composer otherwise. */
  performers: string[];
  year: number | null;
  cover: string | null;
  rating: number | null;
  titleStatus: string;
  /** How many of the piece's parts it plays. */
  covered: number;
}

type RecordingRow = {
  work_id: string; track_id: number; album_id: number; disc_number: number; track_number: number; title: string; duration_sec: number | null;
  performers: string | null; composers: string | null; album_title: string; album_artist: string; release_year: number | null;
  cover: string | null; rating: number | null; title_status: string | null;
};

/** The tracks of the collection playing these works, by work. */
const recordingsOf = async (workIds: string[]): Promise<Map<string, RecordingRow[]>> => {
  const byWork = new Map<string, RecordingRow[]>();
  if (!workIds.length) return byWork;
  const rows = await all<RecordingRow>(`
    SELECT rw.work_id, t.id AS track_id, t.album_id, t.disc_number, t.track_number, t.title, t.duration_sec, t.performers, t.composers,
      a.title AS album_title, a.artist AS album_artist, a.release_year, a.cover, a.rating, a.title_status
    FROM recording_works rw
    JOIN tracks t ON t.musicbrainz_recording_id = rw.recording_id
    JOIN albums a ON a.id = t.album_id
    WHERE ${HELD} AND rw.work_id IN (${workIds.map(() => '?').join(',')})
    ORDER BY t.album_id, t.disc_number, t.track_number`, workIds);
  for (const row of rows) {
    const list = byWork.get(row.work_id) || [];
    // The same track once per work, though a CD and its rip may both hold it.
    if (!list.some(other => other.track_id === row.track_id)) list.push(row);
    byWork.set(row.work_id, list);
  }
  return byWork;
};

const recordingOf = (row: RecordingRow): PieceRecording => ({
  trackId: row.track_id, albumId: row.album_id, disc: row.disc_number, no: row.track_number, title: row.title, durationSec: row.duration_sec,
});

const performersOf = (rows: RecordingRow[], composer: string | null): string[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const performer of parse<Array<{ name?: string; role?: string }>>(row.performers, [])) {
      if (performer.name) counts.set(performer.name, (counts.get(performer.name) || 0) + 1);
    }
  }
  const named = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (named.length) return named.slice(0, 3);
  const composers = new Set([composer, ...rows.flatMap(row => parse<string[]>(row.composers, []))].filter(Boolean) as string[]);
  return parse<string[]>(rows[0]?.album_artist ?? null, []).filter(name => !composers.has(name)).slice(0, 3);
};

/** A part's short name: "Préludes, Livre I, L. 117: II. Voiles. Modéré" is "Voiles", "Modéré". */
export const partLabel = (whole: string, part: string): { name: string; sub: string | null } => {
  let label = part.startsWith(whole) ? part.slice(whole.length) : part;
  const colon = label.lastIndexOf(': ');
  if (colon >= 0) label = label.slice(colon + 2);
  label = label.replace(/^[\s,:–-]+/, '').trim() || part;
  const numbered = label.match(/^((?:[IVXLC]+|\d+)\.)\s+(.*)$/);
  if (numbered) label = numbered[2];
  // A tempo after the name: "Voiles. Modéré".
  const dot = label.indexOf('. ');
  // Not a catalogue's dot: "S. 172", "op. 28", "No. 1".
  const [before, after] = [label.slice(0, dot), label.slice(dot + 2)];
  if (dot > 0 && !/\b(?:no|op|nr|vol|bk)$/i.test(before) && !/\b[A-Z]{1,3}$/.test(before) && !/\d/.test(after) && after.split(' ').length <= 6) {
    return { name: label.slice(0, dot), sub: label.slice(dot + 2).replace(/\.$/, '') || null };
  }
  return { name: label, sub: null };
};

// ---------------------------------------------------------------------------
// A score's pieces.

interface PieceRow { id: number; book_id: number; work_id: string | null; title: string; position: number; preferred_album_id: number | null; parts_left_out?: string | null }

/** The parts of its work a score holds: all but those left out. */
const keptParts = (work: { parts?: StoredPart[] | null } | undefined, row: PieceRow): StoredPart[] => {
  const out = new Set(parse<string[]>(row.parts_left_out ?? null, []));
  return (work?.parts || []).filter(part => !out.has(part.id));
};

export interface ScorePiece {
  id: number;
  workId: string | null;
  title: string;
  /** Its page on IMSLP, when Wikidata knows it. */
  imslp: string | null;
  /** A piece of one movement: no parts of its own. */
  single: boolean;
  parts: Array<{ workId: string; title: string; name: string; sub: string | null; imslp: string | null; recordings: PieceRecording[] }>;
  /** Every part of its work, the score's checked: to choose those it holds. */
  choices: Array<{ workId: string; name: string; sub: string | null; kept: boolean }>;
  /** Tracks playing the piece whole, in one track: a piece of one movement's recordings. */
  whole: PieceRecording[];
  /** The albums playing it, the one played first first. */
  albums: PieceAlbum[];
  preferredAlbumId: number | null;
}

const piecesRows = (bookId: number) => all<PieceRow>('SELECT * FROM score_pieces WHERE book_id = ? ORDER BY position, id', [bookId]);

const scoreOf = async (bookId: number) => {
  const book = await Book.findById(bookId);
  if (!book || book.bookType !== 'score') throw new ScorePiecesError('No such score', 404);
  return book;
};

/** The pieces of a score, each with its parts and the tracks playing them. */
const pieces = async (bookId: number): Promise<ScorePiece[]> => {
  const book = await scoreOf(bookId);
  const rows = await piecesRows(bookId);
  const works = new Map<string, StoredWork>();
  for (const row of rows) {
    if (!row.work_id) continue;
    try { works.set(row.work_id, await workWithParts(row.work_id, book.composer)); } catch (error) {
      const kept = (await storedWorks([row.work_id])).get(row.work_id);
      if (kept) works.set(row.work_id, { ...kept, parts: kept.parts || [] });
      logger.warn(`Work ${row.work_id}: its parts not read: ${(error as Error).message}`);
    }
  }
  const targets = [...new Set([...works.values()].flatMap(work => [work.id, ...(work.parts || []).map(part => part.id)]))];
  const byWork = await recordingsOf(targets);

  return rows.map(row => {
    const work = row.work_id ? works.get(row.work_id) : undefined;
    const kept = keptParts(work, row);
    const parts = kept.map(part => ({
      workId: part.id, title: part.title, ...partLabel(work!.title, part.title), imslp: part.imslp ?? null,
      recordings: (byWork.get(part.id) || []).map(recordingOf),
    }));
    // A track playing the work whole plays more than a score holding a part of it.
    const wholeRows = row.work_id && kept.length === (work?.parts || []).length ? byWork.get(row.work_id) || [] : [];
    const playing = parts.length ? parts.flatMap(part => (byWork.get(part.workId) || [])) : wholeRows;
    const albumRows = new Map<number, RecordingRow[]>();
    for (const r of [...playing, ...(parts.length ? wholeRows : [])]) albumRows.set(r.album_id, [...(albumRows.get(r.album_id) || []), r]);
    const albums: PieceAlbum[] = [...albumRows].map(([albumId, list]) => ({
      albumId,
      title: list[0].album_title,
      artist: parse<string[]>(list[0].album_artist, []),
      performers: performersOf(list, book.composer),
      year: list[0].release_year,
      cover: list[0].cover,
      rating: list[0].rating,
      titleStatus: list[0].title_status || 'owned',
      covered: parts.length ? parts.filter(part => part.recordings.some(r => r.albumId === albumId)).length : 1,
    }));
    // The one chosen, else the most complete, the best rated, the latest.
    albums.sort((a, b) => Number(b.albumId === row.preferred_album_id) - Number(a.albumId === row.preferred_album_id)
      || b.covered - a.covered || (b.rating ?? 0) - (a.rating ?? 0) || (b.year ?? 0) - (a.year ?? 0));
    return {
      id: row.id,
      workId: row.work_id,
      title: row.title,
      imslp: work?.imslp ?? null,
      single: !parts.length,
      parts,
      choices: (work?.parts || []).map(part => ({ workId: part.id, ...partLabel(work!.title, part.title), kept: kept.includes(part) })),
      whole: wholeRows.map(recordingOf),
      albums,
      preferredAlbumId: albums.some(album => album.albumId === row.preferred_album_id) ? row.preferred_album_id : albums[0]?.albumId ?? null,
    };
  });
};

/** A score's additions, one after the other: a set of Wikidata takes seconds, and a second click must not add it twice. */
const adding = new Map<number, Promise<unknown>>();

/** Pieces added: works of MusicBrainz, or a title alone when none is found. */
const addPieces = (bookId: number, input: { workIds?: string[]; title?: string }): Promise<ScorePiece[]> => {
  const next = (adding.get(bookId) || Promise.resolve()).catch(() => undefined).then(() => addPiecesNow(bookId, input));
  adding.set(bookId, next);
  next.finally(() => { if (adding.get(bookId) === next) adding.delete(bookId); }).catch(() => undefined);
  return next;
};

const addPiecesNow = async (bookId: number, input: { workIds?: string[]; title?: string }): Promise<ScorePiece[]> => {
  const book = await scoreOf(bookId);
  const have = await piecesRows(bookId);
  let position = have.reduce((max, row) => Math.max(max, row.position), 0);
  for (const workId of [...new Set(input.workIds || [])].filter(id => /^[0-9a-f-]{36}$/.test(id) || isWikidata(id) || /^imslp:[^#]+$/.test(id))) {
    if (have.some(row => row.work_id === workId)) continue;
    const work = await workWithParts(workId, book.composer);
    have.push({ id: 0, book_id: bookId, work_id: workId, title: work.title, position: position + 1, preferred_album_id: null });
    await run('INSERT INTO score_pieces (book_id, work_id, title, position) VALUES (?, ?, ?, ?)', [bookId, workId, work.title, ++position]);
  }
  const title = (input.title || '').trim();
  if (title) await run('INSERT INTO score_pieces (book_id, work_id, title, position) VALUES (?, NULL, ?, ?)', [bookId, title, ++position]);
  if (!(input.workIds || []).length && !title) throw new ScorePiecesError('Which pieces?', 400);
  return pieces(bookId);
};

const removePiece = async (bookId: number, pieceId: number): Promise<void> => {
  if (!(await run('DELETE FROM score_pieces WHERE id = ? AND book_id = ?', [pieceId, bookId])).changes) throw new ScorePiecesError('No such piece', 404);
  // Its pages in the score's PDFs go with it.
  await run('DELETE FROM score_bookmarks WHERE piece_id = ?', [pieceId]);
};

/** The parts of its work a score holds; the others left out. */
const keepParts = async (bookId: number, pieceId: number, workIds: string[]): Promise<ScorePiece[]> => {
  const book = await scoreOf(bookId);
  const row = (await piecesRows(bookId)).find(piece => piece.id === pieceId);
  if (!row) throw new ScorePiecesError('No such piece', 404);
  if (!row.work_id) throw new ScorePiecesError('This piece has no parts', 400);
  const parts = (await workWithParts(row.work_id, book.composer)).parts || [];
  const keep = new Set(workIds);
  if (!parts.some(part => keep.has(part.id))) throw new ScorePiecesError('Keep one of its parts at least, or take the piece out', 400);
  const out = parts.filter(part => !keep.has(part.id)).map(part => part.id);
  await run('UPDATE score_pieces SET parts_left_out = ? WHERE id = ?', [out.length ? JSON.stringify(out) : null, pieceId]);
  return pieces(bookId);
};

/** The recording played first for a piece: an album, or none to let the most complete be. */
const choose = async (bookId: number, pieceId: number, albumId: number | null): Promise<void> => {
  if (!(await run('UPDATE score_pieces SET preferred_album_id = ? WHERE id = ? AND book_id = ?', [albumId || null, pieceId, bookId])).changes) {
    throw new ScorePiecesError('No such piece', 404);
  }
};

/** For the list of scores: how many pieces each has, how many of them the music plays. */
const counts = async (): Promise<Map<number, { pieces: number; heard: number }>> => {
  const rows = await all<PieceRow>('SELECT * FROM score_pieces');
  const works = await storedWorks([...new Set(rows.map(row => row.work_id).filter(Boolean) as string[])]);
  const units = rows.map(row => {
    const work = row.work_id ? works.get(row.work_id) : undefined;
    return { bookId: row.book_id, ids: work?.parts?.length ? keptParts(work, row).map(part => part.id) : row.work_id ? [row.work_id] : [] };
  });
  const heard = new Set((await all<{ work_id: string }>(`
    SELECT DISTINCT rw.work_id FROM recording_works rw JOIN tracks t ON t.musicbrainz_recording_id = rw.recording_id
    JOIN albums a ON a.id = t.album_id WHERE ${HELD}`)).map(row => row.work_id));
  const result = new Map<number, { pieces: number; heard: number }>();
  for (const unit of units) {
    const count = result.get(unit.bookId) || { pieces: 0, heard: 0 };
    count.pieces += Math.max(unit.ids.length, 1);
    count.heard += unit.ids.filter(id => heard.has(id)).length;
    result.set(unit.bookId, count);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Finding a score's pieces.

const plain = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‐‑–—]/g, '-').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Words that name the same thing across French, English and German titles. */
const SAME = new Map(Object.entries({
  preludes: 'prelude', prelude: 'prelude', praludium: 'prelude', suites: 'suite', francaises: 'french', francaise: 'french',
  franzosische: 'french', franzosischen: 'french', french: 'french', valses: 'waltz', valse: 'waltz', waltzes: 'waltz', walzer: 'waltz',
  waltz: 'waltz', sonate: 'sonata', sonata: 'sonata', impromptus: 'impromptu', consolations: 'consolation', arabesques: 'arabesque',
  nocturnes: 'nocturne', ballades: 'ballade', ballads: 'ballade', balladen: 'ballade', etudes: 'etude', inventionen: 'invention',
  inventions: 'invention', sinfonien: 'sinfonia', sinfonias: 'sinfonia', jeunesse: 'jugend', youth: 'jugend', young: 'jugend',
  livre: 'book', buch: 'book', vol: 'book', heft: 'book', fantaisie: 'fantasia', fantasy: 'fantasia', fantasie: 'fantasia',
  marche: 'march', funebre: 'funeral', trauermarsch: 'funeral', clavier: 'klavier', tempere: 'wohltemperierte', temperiertes: 'wohltemperierte',
  tempered: 'wohltemperierte', wohltemperierte: 'wohltemperierte', lettre: 'elise', elise: 'elise', fur: 'elise',
}));
const NOISE = new Set(['piano', 'pour', 'for', 'the', 'de', 'la', 'le', 'les', 'des', 'du', 'et', 'and', 'und', 'fur', 'edition', 'henle',
  'urtext', 'para', 'en', 'in', 'of', 'majeur', 'major', 'minor', 'mineur', 'dur', 'moll', 'opus', 'op', 'no', 'nr', 'hn', 'revised', 'version',
  'simplified', 'sharp', 'flat', 'from', 'aus', 'reliee', 'relie', 'lin', 'broche', 'cartonne', 'hardcover', 'paperback']);
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12' };
const NUMBERS: Record<string, string> = { one: '1', two: '2', deux: '2', three: '3', trois: '3', four: '4', quatre: '4', vier: '4', six: '6', sechs: '6' };

/** A work's catalogue, which says nothing a score's title says: "L. 117, CD 125", "op. 28", "S. 172". */
const withoutCatalogue = (title: string) => title.replace(/\b(?:BWV|Hob|WoO|HWV|KK|CD|op|no|nr|K|KV|D|S|L)\.?\s*[IVX\d][\w./]*/g, ' ');

/** The words that tell a work: the same across languages, its numbers ("Livre I", "Vol. 1") when asked. */
const wordsOf = (text: string, numbers: boolean): Set<string> => new Set(plain(withoutCatalogue(text)).split(' ')
  .map(word => ROMAN[word] || NUMBERS[word] || SAME.get(word) || word)
  .filter(word => word && !NOISE.has(word) && (/^\d+$/.test(word) ? numbers : word.length > 1)));

/**
 * How well a work's title answers a score's: every word of the score's title
 * in the work's, and most of the work's said; 0 otherwise. Its numbers count
 * when the score's title has some: "Préludes Vol. 1" is Livre I, not Livre II.
 */
const likeness = (scoreTitle: string, workTitle: string): number => {
  const numbers = /\d|\b(?:i|ii|iii|iv|v|vi)\b/i.test(withoutCatalogue(scoreTitle));
  const [a, b] = [wordsOf(scoreTitle, numbers), wordsOf(workTitle, numbers)];
  if (!a.size || !b.size || ![...a].every(word => b.has(word))) return 0;
  return a.size / b.size;
};
/** Looser: how much of the score's title a work says, for a search by its title. */
const nearness = (scoreTitle: string, workTitle: string): number => {
  const [a, b] = [wordsOf(scoreTitle, false), wordsOf(workTitle, false)];
  return a.size ? [...a].filter(word => b.has(word)).length / a.size : 0;
};

/** The numbers a title names: BWV 812-817, op. 27/2, K. 397, WoO 59, S. 172, D. 899, L. 117. */
export const catalogueOf = (title: string): string[] => {
  const found: string[] = [];
  const add = (label: string) => { if (!found.includes(label) && found.length < 8) found.push(label); };
  for (const m of title.matchAll(/\bBWV\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
    const [from, to] = [Number(m[1]), Number(m[2] || m[1])];
    for (let n = from; n <= Math.min(to, from + 7); n++) add(`BWV ${n}`);
  }
  for (const m of title.matchAll(/\b(?:op(?:us)?\.?)\s*(\d+)(?:\s*(?:\/|no\.?|n°|nr\.?)\s*(\d+))?/gi)) add(m[2] ? `op. ${m[1]} no. ${m[2]}` : `op. ${m[1]}`);
  for (const m of title.matchAll(/\bK(?:V)?\.?\s*(\d+)/g)) add(`K. ${m[1]}`);
  for (const m of title.matchAll(/\bWoO\s*(\d+)/gi)) add(`WoO ${m[1]}`);
  for (const m of title.matchAll(/\b(D|S|L|HWV)\.?\s+(\d+)/g)) add(`${m[1]}${m[1] === 'HWV' ? '' : '.'} ${m[2]}`);
  return found;
};

/** The title without what is not the work: the instrument, the edition, the composer. */
export const workWordsOf = (title: string, composer: string | null): string => {
  let text = title.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/---.*$/, ' ').replace(/\s-\s(?:piano|klavier)\b.*$/i, ' ');
  if (composer) for (const name of composer.split(' ')) if (name.length > 2) text = text.replace(new RegExp(`\\b${name}\\b\\s*[:–-]?`, 'gi'), ' ');
  text = text.replace(/\b(?:piano|urtext|para|pour|for|édi?tion|henle)\b/gi, ' ').replace(/\b(?:BWV|op(?:us)?\.?|K(?:V)?\.?|WoO|HN)\s*[\d/ -]+/gi, ' ');
  return text.replace(/[|:–-]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const isMovement = (title: string): boolean => /:\s/.test(title);

/** The words a search of Wikidata is given: the title's, without its numbers, volumes and keys. */
const searchWordsOf = (words: string) => words
  .replace(/\b(?:vol|book|livre|band|heft|en|in|majeur|mineur|major|minor|r[ée]b|for|the|a|la|le|les|de|des|et|und|pour|edition|reliee|lin)\b\.?/gi, ' ')
  .replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * IMSLP's pages of the composer's works whose titles say the score's ("4 Ballades"
 * and "Impromptus" for "Ballads and Impromptus"): a work of one piece by its
 * MusicBrainz work when its number finds one, else the page with its pieces.
 */
/** IMSLP's spelling of a word of a title: its works are "Ballades", not "Ballads". */
const IMSLP_WORDS: Record<string, string> = { ballads: 'Ballades', valses: 'Waltzes', walzer: 'Waltzes', etudes: 'Etudes' };

/**
 * IMSLP's pages for a score: by its numbers when its title has some (the
 * page bearing "Op.53", not every polonaise), else by its words, else by each
 * of them ("Ballades" and "Impromptus" for "Ballads and Impromptus").
 */
const imslpPagesFor = async (title: string, words: string, composer: string): Promise<string[]> => {
  const numbers = catalogueOf(title);
  const pageNumber = (page: string) => catalogueFor(page.replace(/\s*\([^()]*\)\s*$/, ''));
  // One page per work, the first: "4 Ballades" and "Ballades" are the same.
  const keyOf = (page: string) => pageNumber(page) || [...wordsOf(page.replace(/\s*\([^()]*\)\s*$/, ''), false)].map(word => word.replace(/s$/, '')).sort().join(' ') || page;
  const firstOf = (pages: string[]) => pages.filter((page, index) => pages.findIndex(other => keyOf(other) === keyOf(page)) === index);
  if (numbers.length) {
    const found: string[] = [];
    for (const number of numbers.slice(0, 6)) {
      const imslpStyle = number.replace(/^op\. /, 'Op.').replace(/^K\. /, 'K.').replace(/ no\. /, ' No.');
      const pages = await imslpWorksService.searchWorks(imslpStyle, composer);
      found.push(...pages.filter(page => pageNumber(page) === number).slice(0, 1));
    }
    if (found.length) return firstOf(found);
  }
  const query = searchWordsOf(words);
  if (!query) return [];
  // Its numbers first: "Préludes Vol. 1" is Livre 1, before Livre 2.
  const numbersOf = (text: string) => [...wordsOf(text, true)].filter(word => /^\d+$/.test(word));
  const wanted = numbersOf(words);
  const says = (page: string) => wanted.every(number => numbersOf(page.replace(/\s*\([^()]*\)\s*$/, '')).includes(number));
  const near = (pages: string[]) => pages.filter(page => nearness(words, page.replace(/\s*\([^()]*\)\s*$/, '')) >= 0.5)
    .sort((a, b) => Number(says(b)) - Number(says(a)));
  const pages = near(await imslpWorksService.searchWorks(query, composer));
  if (!pages.length) {
    for (const word of query.split(' ').filter(w => w.length >= 5).slice(0, 3)) {
      pages.push(...near(await imslpWorksService.searchWorks(IMSLP_WORDS[plain(word)] || word, composer)).slice(0, 2));
    }
  }
  return firstOf(pages).slice(0, 6);
};

const imslpSuggestions = async (words: string, composer: string, taken: Set<string | null>, title = words): Promise<PieceSuggestion[]> => {
  const pages = await imslpPagesFor(title, words, composer);
  const suggestions: PieceSuggestion[] = [];
  for (const page of pages) {
    const work = await imslpWorksService.work(page);
    if (!work) continue;
    const number = work.pieces.length ? null : catalogueFor(work.catalogue);
    const mbId = number ? await byNumber(number, composer).catch(() => null) : null;
    if (mbId) {
      if (!taken.has(mbId)) suggestions.push(await describe({ id: mbId, title: work.title, composers: [composer] }, 'imslp'));
    } else if (!taken.has(`imslp:${page}`)) {
      suggestions.push({ workId: `imslp:${page}`, title: work.title, composers: [composer], parts: work.pieces.length, inYourMusic: 0, why: 'imslp' });
    }
  }
  return suggestions;
};

/** A score's page on IMSLP: its one piece's or set's, else the composer's work its title finds; null when none. */
const imslpPage = async (bookId: number): Promise<string | null> => {
  const book = await scoreOf(bookId);
  const rows = await piecesRows(bookId);
  const works = await storedWorks(rows.map(row => row.work_id).filter(Boolean) as string[]);
  // A set's page, else the one its parts all share ("Préludes, Livre I" has none of its own, its preludes Livre 1's).
  const pageOf = (work: StoredWork | undefined) => {
    if (work?.imslp) return work.imslp;
    const shared = [...new Set((work?.parts || []).map(part => part.imslp))];
    return shared.length === 1 ? shared[0] ?? null : null;
  };
  const pages = [...new Set(rows.map(row => pageOf(works.get(row.work_id || ''))).filter(Boolean) as string[])];
  if (pages.length === 1) return pages[0];
  if (!book.composer) return null;
  const found = await imslpPagesFor(book.title, workWordsOf(book.title, book.composer), book.composer).catch(() => []);
  return found[0] || null;
};

/**
 * Wikidata's works of the composer whose labels say the score's title: the
 * MusicBrainz work it names, else the set itself, or the sets it is made of
 * ("Inventions and Sinfonias": its 15 Inventions and its 15 Sinfonias).
 */
const wikidataSuggestions = async (words: string, composer: string, taken: Set<string | null>): Promise<PieceSuggestion[]> => {
  const query = searchWordsOf(words);
  if (!query) return [];
  const numbered = /\b(?:no|nr|n°)\.?\s*\d/i.test(words);
  const hits = (await wikidataWorksService.searchWorks(query, composer))
    .filter(work => (work.mbWorkId || work.partQids.length)
      && work.labels.some(label => nearness(words, label) >= 0.5 && (numbered || !/\b(?:no|nr|n°)\.?\s*\d/i.test(label))));
  const best = hits[0];
  if (!best) return [];
  const leavesHeard = async (work: WikidataWork): Promise<number> => {
    const leaves = (await wikidataWorksService.works(work.partQids)).map(part => part.mbWorkId).filter((id): id is string => !!id);
    const byWork = await recordingsOf(leaves);
    return leaves.filter(id => byWork.has(id)).length;
  };
  const offerSet = async (work: WikidataWork): Promise<PieceSuggestion> => ({
    workId: `wd:${work.qid}`, title: work.title, composers: [composer], parts: work.partQids.length, inYourMusic: await leavesHeard(work), why: 'wikidata',
  });
  if (best.mbWorkId) {
    if (taken.has(best.mbWorkId)) return [];
    return [await describe({ id: best.mbWorkId, title: best.title, composers: [composer] }, 'wikidata')];
  }
  const parts = await wikidataWorksService.works(best.partQids);
  // A set of sets: each set, whose pieces are the rows of a card.
  if (parts.length > 1 && parts.every(part => part.partQids.length > 0 && !part.mbWorkId)) {
    const sets: PieceSuggestion[] = [];
    for (const part of parts) if (!taken.has(`wd:${part.qid}`)) sets.push(await offerSet(part));
    return sets;
  }
  return taken.has(`wd:${best.qid}`) ? [] : [await offerSet(best)];
};
const quote = (text: string) => `"${text.replace(/"/g, '')}"`;

const searchCache = new Map<string, { at: number; hits: MBWorkHit[] }>();
const search = async (query: string, limit = 10): Promise<MBWorkHit[]> => {
  const key = `${limit}:${query}`;
  const kept = searchCache.get(key);
  if (kept && Date.now() - kept.at < 24 * 3600 * 1000) return kept.hits;
  const hits = await musicbrainzService.searchWorks(query, limit);
  searchCache.set(key, { at: Date.now(), hits });
  return hits;
};

export interface PieceSuggestion {
  workId: string;
  title: string;
  composers: string[];
  /** Its parts, 0 for a piece of one movement. */
  parts: number;
  /** Its parts (or itself) the music plays. */
  inYourMusic: number;
  why: 'number' | 'your music' | 'wikidata' | 'imslp' | 'title' | 'photo' | 'search';
  /** What the photo read, for a suggestion from a photo. */
  read?: string;
  /** Checked from the start: a sure one. */
  likely?: boolean;
}

/** How many of a work's parts (or the work itself) the collection plays. */
const heardIn = async (work: StoredWork): Promise<number> => {
  const ids = work.parts?.length ? work.parts.map(part => part.id) : [work.id];
  const byWork = await recordingsOf(ids);
  return ids.filter(id => byWork.has(id)).length;
};

const describe = async (hit: { id: string; title: string; composers?: string[] }, why: PieceSuggestion['why'], read?: string): Promise<PieceSuggestion> => {
  let work: StoredWork = { id: hit.id, title: hit.title, parentIds: [], parts: [], imslp: null };
  try { work = await workWithParts(hit.id); } catch (error) { logger.warn(`Work ${hit.id} not read: ${(error as Error).message}`); }
  return { workId: work.id, title: work.title, composers: hit.composers || [], parts: work.parts?.length || 0, inYourMusic: await heardIn(work), why, ...(read ? { read } : {}) };
};

/**
 * What a score likely holds: the works its numbers name (BWV 812-817), the
 * works of its composer the music plays whose title its title says, and what
 * a search by its title finds. To be confirmed: nothing is kept from here.
 */
const suggest = async (bookId: number): Promise<PieceSuggestion[]> => {
  const book = await scoreOf(bookId);
  return suggestFor({ title: book.title, composer: book.composer }, new Set((await piecesRows(bookId)).map(row => row.work_id)));
};

/** What a score of this title and composer likely holds, those taken aside. */
const suggestFor = async (book: { title: string; composer: string | null }, taken: Set<string | null>): Promise<PieceSuggestion[]> => {
  if (!book.composer) return [];
  const surname = book.composer.split(' ').slice(-1)[0];
  // Bach, not C. P. E. Bach: a work whose composers are known is by this one.
  const theirs = (hit: MBWorkHit) => !hit.composers.length || hit.composers.some(name => plain(name) === plain(book.composer!) || plain(book.composer!).includes(plain(name)));
  const found = new Map<string, { hit: { id: string; title: string; composers?: string[] }; why: PieceSuggestion['why'] }>();
  const offer = (hit: { id: string; title: string; composers?: string[] }, why: PieceSuggestion['why']) => {
    if (!taken.has(hit.id) && !found.has(hit.id)) found.set(hit.id, { hit, why });
  };

  const words = workWordsOf(book.title, book.composer);

  // By its numbers: the work bearing it, not one of its movements.
  for (const number of catalogueOf(book.title)) {
    const hits = await search(`${quote(number)} AND artist:${quote(surname)}`);
    // "op. 39", not "op. 39 no. 15" unless the number says so; the one whose title the score's says best.
    const exact = new RegExp(`${number.replace(/[.]/g, '\\.').replace(/\s+/g, '\\s*')}(?!\\d)${/no\./.test(number) ? '' : '(?!\\s*(?:no|nr)\\.?\\s*\\d)'}`, 'i');
    const best = hits.filter(hit => theirs(hit) && exact.test(hit.title) && !isMovement(hit.title.slice(hit.title.search(exact))))
      .sort((a, b) => nearness(words, b.title) - nearness(words, a.title) || b.score - a.score || a.title.length - b.title.length)[0];
      if (best) offer(best, 'number');
  }

  // The music's own works by the composer whose title the score's says.
  const mine = await all<{ id: string; title: string; depth: number }>(`
    SELECT DISTINCT w.id, w.title, rw.depth FROM recording_works rw
    JOIN mb_works w ON w.id = rw.work_id
    JOIN tracks t ON t.musicbrainz_recording_id = rw.recording_id
    JOIN albums a ON a.id = t.album_id
    WHERE ${HELD} AND t.composers LIKE ?`, [`%${surname}%`]);
  // A movement by its own name ("La cathédrale engloutie"), a whole work by its title.
  mine.map(work => ({ work, like: likeness(words, isMovement(work.title) ? partLabel('', work.title).name : work.title) }))
    .filter(({ like }) => like >= 0.6)
    .sort((a, b) => b.like - a.like || a.work.depth - b.work.depth)
    .slice(0, 4)
    .forEach(({ work }) => offer({ id: work.id, title: work.title, composers: [book.composer!] }, 'your music'));

  // Wikidata, when neither tells: a title in any language among the composer's works ("Inventionen und Sinfonien").
  const fromWikidata: PieceSuggestion[] = [];
  if (words && !found.size) {
    try { fromWikidata.push(...await wikidataSuggestions(words, book.composer, taken)); } catch (error) {
      logger.warn(`Wikidata not read for "${book.title}": ${(error as Error).message}`);
    }
    for (const suggestion of fromWikidata) taken.add(suggestion.workId);
  }

  // IMSLP, when neither tells, or Wikidata knows a set and hardly any of its pieces (Anna Magdalena's notebook, one piece).
  const weak = fromWikidata.length > 0 && fromWikidata.every(suggestion => suggestion.workId.startsWith('wd:') && suggestion.parts <= 1);
  if (words && !found.size && (!fromWikidata.length || weak)) {
    try {
      const fromImslp = await imslpSuggestions(words, book.composer, taken, book.title);
      if (fromImslp.length) fromWikidata.splice(0, fromWikidata.length, ...fromImslp);
    } catch (error) {
      logger.warn(`IMSLP not read for "${book.title}": ${(error as Error).message}`);
    }
  }

  // By its title, when nothing else tells: whole works first, not the movements of one offered.
  if (words && !found.size && !fromWikidata.length) {
    const hits = (await search(`work:(${words.replace(/[()"]/g, ' ')}) AND artist:${quote(surname)}`, 8))
      .filter(hit => hit.score >= 85 && theirs(hit) && nearness(words, isMovement(hit.title) ? partLabel('', hit.title).name : hit.title) >= 0.5);
    const wholes = hits.filter(hit => !isMovement(hit.title));
    hits.filter(hit => !isMovement(hit.title) || !wholes.some(whole => plain(hit.title).startsWith(plain(whole.title).slice(0, 12))))
      .sort((a, b) => Number(isMovement(a.title)) - Number(isMovement(b.title)) || b.score - a.score)
      .slice(0, 3)
      .forEach(hit => offer(hit, 'title'));
  }

  const described: PieceSuggestion[] = [...fromWikidata];
  for (const { hit, why } of [...found.values()].slice(0, 8)) described.push(await describe(hit, why));
  // MusicBrainz has twins ("16 Walzer, op. 39" and "16 Waltzes, op. 39"): the one the music plays, else the one with parts.
  const byTitle = new Map<string, PieceSuggestion>();
  for (const suggestion of described) {
    const key = [...wordsOf(suggestion.title.replace(/\b(op|no)\.\s*(\d+)/gi, '$1$2'), true)].sort().join(' ');
    const other = byTitle.get(key);
    if (!other || suggestion.inYourMusic > other.inYourMusic || (suggestion.inYourMusic === other.inYourMusic && suggestion.parts > other.parts)) byTitle.set(key, suggestion);
  }
  // Sure: by its numbers or from the music; by its title, only the first.
  return [...byTitle.values()].map((suggestion, index) => ({ ...suggestion, likely: suggestion.why !== 'title' || index === 0 }));
};

/** Works by a search, to add one: those the music plays first. */
const searchPieces = async (query: string): Promise<PieceSuggestion[]> => {
  const words = query.trim();
  if (words.length < 2) return [];
  const hits = await search(words.replace(/[()"]/g, ' '), 8);
  const byWork = await recordingsOf(hits.map(hit => hit.id));
  // Lookups for parts would take a second each: a search shows the hits as they are.
  return hits.map(hit => ({ workId: hit.id, title: hit.title, composers: hit.composers, parts: 0, inYourMusic: byWork.has(hit.id) ? 1 : 0, why: 'search' as const }))
    .sort((a, b) => b.inYourMusic - a.inYourMusic);
};

/** Pieces read off a photo of the contents, each matched to a work when one is found. */
const fromContents = async (bookId: number, lines: Array<{ title: string; composer?: string | null; catalogue?: string | null }>): Promise<PieceSuggestion[]> => {
  const book = await scoreOf(bookId);
  const suggestions: PieceSuggestion[] = [];
  for (const line of lines.slice(0, 40)) {
    const composer = (line.composer || book.composer || '').trim();
    const surname = composer.split(' ').slice(-1)[0];
    const text = [line.title, line.catalogue].filter(Boolean).join(' ').replace(/[()"]/g, ' ');
    const hits = await search(surname ? `(${text}) AND artist:${quote(surname)}` : text, 5);
    const best = hits.filter(hit => hit.score >= 80 && nearness(line.title, hit.title) >= 0.5)[0];
    if (best) {
      suggestions.push({ workId: best.id, title: best.title, composers: best.composers, parts: 0, inYourMusic: (await recordingsOf([best.id])).has(best.id) ? 1 : 0, why: 'photo', read: line.title });
    } else {
      suggestions.push({ workId: '', title: line.title, composers: composer ? [composer] : [], parts: 0, inYourMusic: 0, why: 'photo', read: line.title });
    }
  }
  return suggestions;
};

// ---------------------------------------------------------------------------
// An album's scores.

/** The scores holding what an album plays: "On the shelf of scores". */
const scoresOfAlbum = async (albumId: number): Promise<Array<{ id: number; title: string; composer: string | null; publisher: string | null; cover: string | null }>> => {
  const played = new Set((await all<{ work_id: string }>(`
    SELECT DISTINCT rw.work_id FROM recording_works rw JOIN tracks t ON t.musicbrainz_recording_id = rw.recording_id WHERE t.album_id = ?`, [albumId]))
    .map(row => row.work_id));
  if (!played.size) return [];
  const rows = await all<PieceRow>('SELECT * FROM score_pieces WHERE work_id IS NOT NULL');
  const works = await storedWorks([...new Set(rows.map(row => row.work_id!))]);
  const bookIds = [...new Set(rows.filter(row => {
    const work = works.get(row.work_id!);
    return played.has(row.work_id!) || keptParts(work, row).some(part => played.has(part.id));
  }).map(row => row.book_id))];
  const books = await Promise.all(bookIds.map(id => Book.findById(id)));
  return books.filter((book): book is NonNullable<typeof book> => !!book && book.bookType === 'score')
    .map(book => ({ id: book.id, title: book.title, composer: book.composer, publisher: book.publisher || null, cover: book.cover || null }));
};

export default { indexAll, pieces, addPieces, removePiece, keepParts, choose, counts, suggest, suggestFor, searchPieces, fromContents, scoresOfAlbum, imslpPage };
