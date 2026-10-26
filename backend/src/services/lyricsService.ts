import axios from 'axios';
import fs from 'fs';
import path from 'path';
import TrackLyrics, { type TrackLyricsFormatted, type TrackToLookUp } from '../models/trackLyrics';
import Album from '../models/album';
import Track from '../models/track';
import navidromeService from './navidromeService';
import ripStatusService from './ripStatusService';
import logger from '../logger';

/**
 * The words of the songs, from LRCLIB (lrclib.net): free, no key, timed lines
 * for most of them. DexVault keeps them to show under a track, and writes them
 * as an .lrc file beside each file of a rip, where Navidrome reads them and
 * hands them to its players, its web player and the apps alike.
 */
const LRCLIB_URL = 'https://lrclib.net/api';
// LRCLIB asks clients to say who they are.
const USER_AGENT = 'DexVault (https://github.com/renajohn/filmdex)';
const TIMEOUT_MS = 15000;
/** A pause between two lookups, to go easy on a free service. */
const PAUSE_MS = 300;
/** A track LRCLIB did not know is asked again after a month. */
const RETRY_MISSING_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * When the lookup last learnt to find more: a track it missed before is asked
 * again at once. Always a moment already past, or it would ask over and over.
 */
const LOOKUP_REVISED_AT = '2026-10-13T10:15:00.000Z';
/** Search results this far from the CD's length are another recording. */
const DURATION_TOLERANCE_SEC = 5;
const EVERY_MS = 30 * 60 * 1000;
const BATCH = 200;

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsLookup {
  status: 'found' | 'instrumental' | 'missing';
  plain: string | null;
  synced: string | null;
  sourceId: string | null;
}

const MISSING: LyricsLookup = { status: 'missing', plain: null, synced: null, sourceId: null };

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const parseList = (text: string | null): string[] => {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [String(value)];
  } catch {
    return [text];
  }
};

/** MusicBrainz writes "‐M‐" and "Jean‐Jacques" with the Unicode hyphen, LRCLIB with the plain one. */
const plainText = (text: string): string => text.replace(/[‐‑‒–—]/g, '-').replace(/[‘’]/g, "'").trim();

/** "Karma Police (Remastered 2009)" and "Angel - Live" are sung as Karma Police and Angel. */
const bareTitle = (title: string): string =>
  plainText(title).replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+-\s+(live|remaster(ed)?|single|radio edit|mono|stereo)\b.*$/i, '').trim();

/**
 * The artists to ask for, in turn: the track's own, then the album's. A duet
 * is filed under either singer ("Bahia", Véronique Sanson with Alain Chamfort).
 */
export const artistsOf = (track: Pick<TrackToLookUp, 'trackArtist' | 'albumArtist'>): string[] =>
  [...new Set([...parseList(track.trackArtist), ...parseList(track.albumArtist)].map(plainText).filter(Boolean))]
    .filter(name => name !== 'Various Artists' && name !== '[dialogue]').slice(0, 3);

/** The artist to ask for first: the track's own on a compilation, the album's otherwise. */
export const artistOf = (track: Pick<TrackToLookUp, 'trackArtist' | 'albumArtist'>): string | null => artistsOf(track)[0] ?? null;

/** What a parenthesis says that is not another song: "(live)", "(Remastered 2009)", "(interview)". */
const NOT_A_SONG = /\b(live|remaster|version|edit|mix|demo|interview|comedy|bonus|feat|acoustic|instrumental|mono|stereo|take)/i;

/**
 * The song a track names in parentheses, when the track is a film's scene
 * set to it: "End Credits (Blackout)" is Blackout.
 */
export const songInParentheses = (title: string): string | null => {
  const inner = plainText(title).match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  return inner && !NOT_A_SONG.test(inner) && inner.length >= 4 ? inner : null;
};

const sameTitle = (a: string, b: string): boolean => {
  const key = (text: string) => plainText(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return key(a) === key(b) || key(a).startsWith(`${key(b)} `);
};

/** The words of a timed text without the times: those of another length do not fit this one's. */
const untimed = (synced: string): string =>
  synced.split('\n').map(line => line.replace(/^(\[[^\]]*\])+\s?/, '')).join('\n').trim();

const fromRecord = (record: LrclibRecord): LyricsLookup => {
  if (record.instrumental) return { status: 'instrumental', plain: null, synced: null, sourceId: String(record.id) };
  if (!record.plainLyrics && !record.syncedLyrics) return MISSING;
  return { status: 'found', plain: record.plainLyrics, synced: record.syncedLyrics, sourceId: String(record.id) };
};

const lrclib = async <T>(endpoint: string, params: Record<string, string | number>): Promise<T | null> => {
  try {
    const response = await axios.get<T>(`${LRCLIB_URL}/${endpoint}`, { params, timeout: TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw new Error(`LRCLIB ${endpoint} failed${axios.isAxiosError(error) && error.response ? ` (HTTP ${error.response.status})` : ''}`);
  }
};

/**
 * The best of LRCLIB's search results: about as long as the CD's track, with
 * timed lines before plain ones. Without a length, the first with words.
 */
export const pickResult = (records: LrclibRecord[], durationSec: number | null): LrclibRecord | null => {
  const usable = records.filter(record => record.instrumental || record.plainLyrics || record.syncedLyrics);
  const close = durationSec == null ? usable
    : usable.filter(record => record.duration != null && Math.abs(record.duration - durationSec) <= DURATION_TOLERANCE_SEC);
  return [...close].sort((a, b) =>
    Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics))
    || (durationSec == null ? 0 : Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec)))[0] ?? null;
};

/** Two timed texts this close sing in step: a tap a little early or late. A second apart is heard. */
const IN_STEP_SEC = 0.5;
/** Lines in common below which two timed texts cannot be told in step or not. */
const MIN_LINES_IN_COMMON = 3;

/** The times and words of a timed text, a line sung twice under each of its times. */
const timedLines = (synced: string): Array<{ at: number; key: string }> =>
  synced.split('\n').flatMap(line => {
    const tags = line.match(/^(\[\d+:\d+(?:[.:]\d+)?\])+/)?.[0];
    if (!tags) return [];
    const key = plainText(line.slice(tags.length)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key) return [];
    return [...tags.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)].map(([, min, sec]) => ({ at: Number(min) * 60 + Number(sec.replace(':', '.')), key }));
  }).sort((a, b) => a.at - b.at);

/**
 * How much later the second timed text sings than the first: the median gap
 * between their lines in common, each line's first time with the other's
 * first, its second with its second. Null when they have too few in common.
 */
export const lagBetween = (first: string, second: string): number | null => {
  const seen = new Map<string, number[]>();
  for (const line of timedLines(second)) seen.set(line.key, [...(seen.get(line.key) ?? []), line.at]);
  const count = new Map<string, number>();
  const gaps: number[] = [];
  for (const line of timedLines(first)) {
    const nth = count.get(line.key) ?? 0;
    count.set(line.key, nth + 1);
    const other = seen.get(line.key)?.[nth];
    if (other != null) gaps.push(other - line.at);
  }
  if (gaps.length < MIN_LINES_IN_COMMON) return null;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
};

/**
 * The timed text to keep: the one chosen, unless most of the others of the
 * same length sing in step with one another and not with it, someone's
 * tapping half a second or more early or late ("Welcome to the Jungle", 2.6 s
 * late). Then the one of theirs closest to the CD's length.
 */
export const inStep = (chosen: LrclibRecord, records: LrclibRecord[], durationSec: number | null): LrclibRecord => {
  const length = durationSec ?? chosen.duration;
  if (!chosen.syncedLyrics || length == null) return chosen;
  // One timed text copied under ten albums is one voice, not ten: the copy closest to the CD's length speaks.
  const textOf = (synced: string) => timedLines(synced).map(line => `${line.at.toFixed(2)} ${line.key}`).join('\n');
  const own = textOf(chosen.syncedLyrics);
  const texts = new Map<string, LrclibRecord>();
  for (const record of records) {
    if (!record.syncedLyrics || record.duration == null || Math.abs(record.duration - length) > DURATION_TOLERANCE_SEC) continue;
    const text = textOf(record.syncedLyrics);
    if (text === own) continue;
    const kept = texts.get(text);
    if (!kept || Math.abs(record.duration - length) < Math.abs(kept.duration! - length)) texts.set(text, record);
  }
  const others = [...texts.values()]
    .map(record => ({ record, lag: lagBetween(chosen.syncedLyrics!, record.syncedLyrics!) }))
    .filter((other): other is { record: LrclibRecord; lag: number } => other.lag != null);
  const agreeing = others.filter(other => Math.abs(other.lag) <= IN_STEP_SEC).length;
  const groups = others.filter(other => Math.abs(other.lag) > IN_STEP_SEC).map(other => {
    const near = others.filter(another => Math.abs(another.lag - other.lag) <= IN_STEP_SEC);
    return { ...other, together: near.length, spread: near.reduce((sum, another) => sum + Math.abs(another.lag - other.lag), 0) };
  });
  // The most in step with one another, then the closest to them all, then to the CD's length.
  const best = groups.sort((a, b) => b.together - a.together || a.spread - b.spread
    || Math.abs(a.record.duration! - length) - Math.abs(b.record.duration! - length))[0];
  return best && best.together >= 2 && best.together > agreeing ? best.record : chosen;
};

/**
 * The same song at another length, a live take or a film's cut, for a track
 * no recording of its length matches: the words without their times.
 */
export const pickOtherTake = (records: LrclibRecord[], name: string, durationSec: number | null): LyricsLookup | null => {
  const takes = records.filter(record => !record.instrumental && (record.plainLyrics || record.syncedLyrics) && sameTitle(record.trackName, name));
  const best = [...takes].sort((a, b) => durationSec == null ? 0 : Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec))[0];
  if (!best) return null;
  return { status: 'found', plain: best.plainLyrics?.trim() || untimed(best.syncedLyrics!), synced: null, sourceId: String(best.id) };
};

/**
 * The timed texts to set one against: those already in hand, and those a
 * free search on the artist and title finds. LRCLIB answers a search with 20
 * at most, which for a well-known song can all be copies of one text; the
 * free search reaches others ("Once Upon a Time in the West"). Without an
 * answer, those in hand.
 */
const othersLike = async (artist: string, title: string, inHand: LrclibRecord[]): Promise<LrclibRecord[]> => {
  const more = await lrclib<LrclibRecord[]>('search', { q: `${artist} ${title}` }).catch(() => null);
  const ids = new Set(inHand.map(record => record.id));
  return [...inHand, ...(more || []).filter(record => !ids.has(record.id))];
};

/**
 * Looks a track up: the exact entry for this artist, title, album and length
 * first, then a search on the artist and title, then on the title without
 * "(Remastered)" and the like, then on the song a scene is set to. Each
 * artist of the track is asked in turn. Failing a recording of the same
 * length, the words of another take of the song, untimed. Timed lines out of
 * step with most others of the same length give way to theirs.
 */
export const lookUp = async (track: TrackToLookUp): Promise<LyricsLookup> => {
  const artists = artistsOf(track);
  if (artists.length === 0) return MISSING;
  const artist = artists[0];
  const title = plainText(track.title);

  if (track.durationSec) {
    const exact = await lrclib<LrclibRecord>('get', {
      artist_name: artist, track_name: title, album_name: plainText(track.albumTitle), duration: track.durationSec,
    });
    if (exact) {
      const found = fromRecord(exact);
      if (found.status === 'found' && found.synced) {
        // The others to set it against; without them, it stands as it is.
        const others = await lrclib<LrclibRecord[]>('search', { artist_name: artist, track_name: title }).catch(() => null);
        return fromRecord(inStep(exact, await othersLike(artist, title, others || []), track.durationSec));
      }
      if (found.status !== 'missing') return found;
    }
  }

  const names = [...new Set([title, bareTitle(title), songInParentheses(title)])].filter((name): name is string => Boolean(name));
  const otherTakes: Array<{ records: LrclibRecord[]; name: string }> = [];
  for (const singer of artists) {
    for (const name of names) {
      const results = await lrclib<LrclibRecord[]>('search', { artist_name: singer, track_name: name });
      const best = pickResult(results || [], track.durationSec);
      if (best) return fromRecord(best.syncedLyrics ? inStep(best, await othersLike(singer, name, results || []), track.durationSec) : best);
      if (results?.length) otherTakes.push({ records: results, name });
    }
  }
  for (const { records, name } of otherTakes) {
    const take = pickOtherTake(records, name, track.durationSec);
    if (take) return take;
  }
  return MISSING;
};

/** LRCLIB answers 503 now and then: a lookup is tried again after 5, 15 and 45 seconds. */
export const lyricsTiming = { retryDelaysMs: [5000, 15000, 45000] };
const MAX_FAILURES_IN_A_ROW = 5;

const withRetries = async <T>(attempt: () => Promise<T>): Promise<T> => {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= lyricsTiming.retryDelaysMs.length) throw error;
      await pause(lyricsTiming.retryDelaysMs[tries]);
    }
  }
};

/** Looks a track up and keeps what was found, or that nothing was. */
const lookUpAndSave = async (track: TrackToLookUp): Promise<TrackLyricsFormatted> => {
  const found = await lookUp(track);
  await TrackLyrics.save({
    albumId: track.albumId, discNumber: track.discNumber, trackNumber: track.trackNumber, title: track.title,
    status: found.status, plain: found.plain, synced: found.synced, source: found.sourceId ? 'lrclib' : null, sourceId: found.sourceId,
  });
  return (await TrackLyrics.get(track.albumId, track.discNumber, track.trackNumber))!;
};

/** Where the music lies as DexVault sees it: the folder Navidrome reads, mounted in this container too. */
const libraryRoot = (): string | null => {
  const root = process.env.MUSIC_LIBRARY_PATH;
  return root && fs.existsSync(root) ? root : null;
};

/**
 * The file a Navidrome path names. Names on p-cloud are in decomposed Unicode
 * ("e" + accent), Navidrome may hand them back composed: each step of the
 * path is matched by its composed form when the plain one is not there.
 */
export const resolveOnDisk = (root: string, songPath: string): string | null => {
  // Navidrome's own paths are absolute in its container, under /music, as DexVault mounts the library.
  const relative = songPath.startsWith(`${root}/`) ? songPath.slice(root.length + 1)
    : songPath.startsWith('/music/') ? songPath.slice('/music/'.length) : songPath;
  const direct = path.join(root, relative);
  if (fs.existsSync(direct)) return direct;
  let current = root;
  for (const part of relative.split('/').filter(Boolean)) {
    const wanted = part.normalize('NFC');
    let entries: string[];
    try { entries = fs.readdirSync(current); } catch { return null; }
    const match = entries.find(entry => entry === part) ?? entries.find(entry => entry.normalize('NFC') === wanted);
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
};

/**
 * The file of a track found on disk from where the tags put it, for a path
 * Navidrome made up ("Tracy Chapman/Crossroads/01-01 - Crossroads.flac"):
 * the album folder under the library or under FLAC/, or the folder named
 * after it with the year ("Crossroads (1989)"), then the only file of that
 * kind there whose name starts with the track number ("01 Crossroads.flac",
 * "1-01 Crossroads.flac").
 */
export const findByTags = (root: string, madeUpPath: string, discNumber: number, trackNumber: number): string | null => {
  const parts = madeUpPath.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const [artist, album] = parts.slice(-3, -1);
  const extension = path.extname(madeUpPath).toLowerCase();
  const albumKey = album.normalize('NFC').toLocaleLowerCase();

  const folders: string[] = [];
  for (const base of ['', 'FLAC']) {
    const artistFolder = resolveOnDisk(root, path.join(base, artist));
    if (!artistFolder) continue;
    let entries: string[] = [];
    try { entries = fs.readdirSync(artistFolder); } catch { continue; }
    for (const entry of entries) {
      const key = entry.normalize('NFC').toLocaleLowerCase();
      if (key === albumKey || (key.startsWith(albumKey) && /^\s*\(\d{4}\)$/.test(key.slice(albumKey.length)))) {
        folders.push(path.join(artistFolder, entry));
      }
    }
  }

  const track = String(trackNumber);
  const numbered = discNumber > 1
    ? new RegExp(`^0*${discNumber}-0*${track}(?!\\d)`)
    // "1-10" and "2-01" are not "1": a lone number is the track only when no dash follows it.
    : new RegExp(`^(0*1-)?0*${track}(?![\\d-])`);
  const found = folders.flatMap(folder => {
    let entries: string[] = [];
    try { entries = fs.readdirSync(folder); } catch { return []; }
    return entries.filter(entry => path.extname(entry).toLowerCase() === extension && numbered.test(entry)).map(entry => path.join(folder, entry));
  });
  return found.length === 1 ? found[0] : null;
};

/**
 * The .lrc for a track: its timed lines, else its plain words, which Navidrome
 * shows unsynced. A timing fixed by hand is written once saved into the lyrics.
 */
export const lrcText = (lyrics: Pick<TrackLyricsFormatted, 'synced' | 'plain'> & Partial<Pick<TrackLyricsFormatted, 'timingFix' | 'timingSaved'>>): string | null => {
  const text = (lyrics.timingSaved && lyrics.timingFix?.trim()) || lyrics.synced?.trim() || lyrics.plain?.trim();
  return text ? `${text}\n` : null;
};

/** Another take on LRCLIB's texts this far from the CD's length is still shown, to choose from. */
const VERSION_TOLERANCE_SEC = 15;
const MOST_VERSIONS = 12;

/** One of LRCLIB's texts for a track, to choose another. */
export interface LyricsVersion {
  id: string;
  artist: string;
  album: string;
  durationSec: number | null;
  timed: boolean;
  lines: number;
  /** Its first lines, without their times. */
  preview: string[];
  /** How many of LRCLIB's entries hold this very text. */
  copies: number;
  /** The text the track has now. */
  current: boolean;
  /** How much later it sings than the text the track has now, both timed. */
  lag: number | null;
  /** How many of its lines the text the track has now has not: 0, the same words. */
  changed: number | null;
  /** The first of those lines, to see what differs. */
  differing: string[];
  /** The whole text, to try it on the song before choosing it. */
  synced: string | null;
  plain: string | null;
}

export interface LyricsVersions {
  durationSec: number | null;
  versions: LyricsVersion[];
}

/** Where a track's timing comes from: LRCLIB's, fixed by hand in DexVault, or saved into the lyrics. */
export type LyricsTiming = 'lrclib' | 'fixed' | 'saved';

/** A track's words as the players show them: the timing fixed by hand in `synced`, LRCLIB's beside it. */
export interface TrackLyricsShown extends Omit<TrackLyricsFormatted, 'timingFix' | 'timingSaved'> {
  lrclibSynced: string | null;
  timing: LyricsTiming;
}

export const shown = ({ timingFix, timingSaved, ...lyrics }: TrackLyricsFormatted): TrackLyricsShown => ({
  ...lyrics,
  synced: timingFix ?? lyrics.synced,
  lrclibSynced: lyrics.synced,
  timing: timingFix == null ? 'lrclib' : timingSaved ? 'saved' : 'fixed',
});

/** What became of the .lrc beside the rip: rewritten, left as someone else wrote it, or no rip to write it beside. */
export type LrcOutcome = 'written' | 'kept' | 'none';

/** A timed text DexVault takes from the owner: LRC lines, nothing else, of a sensible size. */
export const isTimedText = (text: unknown): text is string =>
  typeof text === 'string' && text.length <= 100_000
  && text.split('\n').some(line => /^\[\d+:\d+(?:\.\d+)?\]/.test(line.trim()));

export interface LrcWriteReport {
  written: number;
  alreadyThere: number;
  notOnDisk: number;
}

/**
 * Writes a track's .lrc anew when what it should say has changed, over the
 * one DexVault wrote before, never over one written by someone else.
 */
const rewriteLrc = async (before: TrackLyricsFormatted, after: TrackLyricsFormatted): Promise<LrcOutcome> => {
  const was = lrcText(before);
  const now = lrcText(after);
  if (!was || !now || was === now) return 'none';
  const report = await lyricsService.writeLrcFiles([after.albumId], new Map([[`${after.discNumber}/${after.trackNumber}`, was]]), true)
    .catch(error => {
      logger.warn(`The .lrc of album ${after.albumId} track ${after.discNumber}-${after.trackNumber} not rewritten: ${(error as Error).message}`);
      return null;
    });
  return report?.written ? 'written' : report?.alreadyThere ? 'kept' : 'none';
};

let lookingUp = false;
/** The albums whose tracks are being looked up for someone who opened them. */
const albumsLookingUp = new Set<number>();

/** Where a track's words stand, for its row in the track list: "pending" while they are being looked up. */
export interface TrackLyricsState {
  discNumber: number;
  trackNumber: number;
  status: TrackLyricsFormatted['status'] | 'pending';
}

/**
 * The classical CDs, told apart as the shelves tell them. LRCLIB knows
 * songs, not movements: they are not looked up with the others, only when
 * someone opens one of their tracks.
 */
const classicalAlbumIds = async (): Promise<number[]> =>
  (await Album.search('classical:yes')).map(album => album.id);

const lyricsService = {
  /**
   * The words of one track, looked up there and then when never asked yet.
   * Looked up again, the .lrc DexVault wrote beside the rip takes the new
   * words. Null when the CD has no such track.
   */
  forTrack: async (albumId: number, discNumber: number, trackNumber: number, { again = false } = {}): Promise<TrackLyricsFormatted | null> => {
    const known = await TrackLyrics.get(albumId, discNumber, trackNumber);
    const album = await Album.findById(albumId);
    const track = album && (await Track.findByCdId(albumId)).find(candidate => candidate.discNumber === discNumber && candidate.trackNumber === trackNumber);
    if (!album || !track) return known;
    // A text chosen by hand stays until a lookup is asked for, the track renamed or not.
    if (known && !again && (known.title === track.title || known.chosen)) return known;
    const found = await lookUpAndSave({
      albumId, discNumber, trackNumber, title: track.title, durationSec: track.durationSec,
      trackArtist: JSON.stringify(track.artist || []), albumArtist: JSON.stringify(album.artist || []), albumTitle: album.title,
    });
    const before = known && lrcText(known);
    if (before && before !== lrcText(found)) {
      await lyricsService.writeLrcFiles([albumId], new Map([[`${discNumber}/${trackNumber}`, before]]))
        .catch(error => logger.warn(`The .lrc of album ${albumId} track ${discNumber}-${trackNumber} not rewritten: ${(error as Error).message}`));
    }
    return found;
  },

  /**
   * Keeps a track's lines retimed by hand, beside LRCLIB's. Saved into the
   * lyrics, they go into the .lrc beside the rip too, when it is the one
   * DexVault wrote. Null when the track has no timed words to retime.
   */
  fixTiming: async (albumId: number, discNumber: number, trackNumber: number, synced: string, intoLyrics: boolean)
    : Promise<{ lyrics: TrackLyricsFormatted; lrc: LrcOutcome } | null> => {
    const known = await TrackLyrics.get(albumId, discNumber, trackNumber);
    if (!known?.synced) return null;
    await TrackLyrics.fixTiming(albumId, discNumber, trackNumber, synced, intoLyrics);
    const lyrics = (await TrackLyrics.get(albumId, discNumber, trackNumber))!;
    return { lyrics, lrc: await rewriteLrc(known, lyrics) };
  },

  /**
   * LRCLIB's texts for a track, to choose another: those about as long as the
   * CD's track, timed first, a text copied under several albums shown once.
   * Null when the CD has no such track.
   */
  versions: async (albumId: number, discNumber: number, trackNumber: number): Promise<LyricsVersions | null> => {
    const album = await Album.findById(albumId);
    const track = album && (await Track.findByCdId(albumId)).find(candidate => candidate.discNumber === discNumber && candidate.trackNumber === trackNumber);
    if (!album || !track) return null;
    const known = await TrackLyrics.get(albumId, discNumber, trackNumber);
    const artists = artistsOf({ trackArtist: JSON.stringify(track.artist || []), albumArtist: JSON.stringify(album.artist || []) });
    const titles = [...new Set([plainText(track.title), bareTitle(track.title)])].filter(Boolean);
    const found = new Map<number, LrclibRecord>();
    const searches = [
      ...artists.slice(0, 2).flatMap(artist => titles.map(title => ({ artist_name: artist, track_name: title }))),
      ...(artists[0] ? [{ q: `${artists[0]} ${titles[titles.length - 1]}` }] : []),
    ];
    for (const params of searches) {
      const records = await lrclib<LrclibRecord[]>('search', params as Record<string, string>).catch(() => null);
      for (const record of records ?? []) found.set(record.id, record);
    }
    const length = track.durationSec ?? null;
    const usable = [...found.values()].filter(record => !record.instrumental && (record.syncedLyrics || record.plainLyrics)
      && (length == null || record.duration == null || Math.abs(record.duration - length) <= VERSION_TOLERANCE_SEC));
    // One text copied under several albums is one version: the copy closest to the CD's length speaks for it.
    const byText = new Map<string, { record: LrclibRecord; copies: number }>();
    for (const record of usable) {
      const text = (record.syncedLyrics || record.plainLyrics || '').trim();
      const kept = byText.get(text);
      const closer = !kept || (length != null && Math.abs((record.duration ?? 0) - length) < Math.abs((kept.record.duration ?? 0) - length));
      byText.set(text, { record: closer ? record : kept!.record, copies: (kept?.copies ?? 0) + 1 });
    }
    const current = known?.synced || known?.plain || null;
    const keyOf = (line: string) => plainText(line).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const inUse = new Set(current ? untimed(current).split('\n').map(keyOf).filter(Boolean) : []);
    const notInUse = (text: string) => untimed(text).split('\n').map(line => line.trim()).filter(line => keyOf(line) && !inUse.has(keyOf(line)));
    const changedFrom = (text: string) => (current ? notInUse(text).length : null);
    const round = (lag: number | null) => (lag == null ? null : Math.round(lag * 100) / 100);
    const versions = [...byText.entries()].map(([text, { record, copies }]): LyricsVersion => ({
      id: String(record.id),
      artist: record.artistName,
      album: record.albumName,
      durationSec: record.duration,
      timed: Boolean(record.syncedLyrics),
      lines: untimed(text).split('\n').filter(line => line.trim()).length,
      preview: untimed(text).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4),
      copies,
      current: known?.sourceId === String(record.id) || (current != null && current.trim() === text),
      lag: round(known?.synced && record.syncedLyrics ? lagBetween(known.synced, record.syncedLyrics) : null),
      changed: changedFrom(text),
      differing: current ? [...new Set(notInUse(text))].slice(0, 3) : [],
      synced: record.syncedLyrics,
      plain: record.plainLyrics,
    }));
    // The text in use first, even when LRCLIB's searches no longer bring it.
    if (current && known?.sourceId && !versions.some(version => version.current)) {
      versions.unshift({
        id: known.sourceId, artist: '', album: '', durationSec: length, timed: Boolean(known.synced),
        lines: untimed(current).split('\n').filter(line => line.trim()).length,
        preview: untimed(current).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4),
        copies: 1, current: true, lag: null, changed: 0, differing: [], synced: known.synced, plain: known.plain,
      });
    }
    versions.sort((a, b) => Number(b.current) - Number(a.current) || Number(b.timed) - Number(a.timed)
      || (length == null ? 0 : Math.abs((a.durationSec ?? 0) - length) - Math.abs((b.durationSec ?? 0) - length)));
    return { durationSec: length, versions: versions.slice(0, MOST_VERSIONS) };
  },

  /** Another of LRCLIB's texts for a track, chosen by hand: the .lrc beside the rip takes it, when it is DexVault's. */
  chooseVersion: async (albumId: number, discNumber: number, trackNumber: number, sourceId: string)
    : Promise<{ lyrics: TrackLyricsFormatted; lrc: LrcOutcome } | null> => {
    const known = await TrackLyrics.get(albumId, discNumber, trackNumber);
    if (!known || !/^\d+$/.test(sourceId)) return null;
    const record = await lrclib<LrclibRecord>(`get/${sourceId}`, {});
    if (!record || record.instrumental || (!record.syncedLyrics && !record.plainLyrics)) return null;
    await TrackLyrics.choose(albumId, discNumber, trackNumber, { plain: record.plainLyrics, synced: record.syncedLyrics, sourceId: String(record.id) });
    const lyrics = (await TrackLyrics.get(albumId, discNumber, trackNumber))!;
    return { lyrics, lrc: await rewriteLrc(known, lyrics) };
  },

  /** Back to LRCLIB's timing, in the .lrc beside the rip too when it was saved there. */
  resetTiming: async (albumId: number, discNumber: number, trackNumber: number)
    : Promise<{ lyrics: TrackLyricsFormatted; lrc: LrcOutcome } | null> => {
    const known = await TrackLyrics.get(albumId, discNumber, trackNumber);
    if (!known) return null;
    await TrackLyrics.resetTiming(albumId, discNumber, trackNumber);
    const lyrics = (await TrackLyrics.get(albumId, discNumber, trackNumber))!;
    return { lyrics, lrc: await rewriteLrc(known, lyrics) };
  },

  /**
   * Whether each track of an album has words, from those kept. The tracks
   * never looked up, or renamed since, are "pending" and looked up in the
   * background, classical CDs too: a second call tells what was found. Null
   * when there is no such album.
   */
  forAlbum: async (albumId: number): Promise<TrackLyricsState[] | null> => {
    const album = await Album.findById(albumId);
    if (!album) return null;
    const tracks = await Track.findByCdId(albumId);
    const known = new Map((await TrackLyrics.forAlbum(albumId)).map(row => [`${row.discNumber}/${row.trackNumber}`, row]));
    const pending = tracks.filter(track => {
      const words = known.get(`${track.discNumber}/${track.trackNumber}`);
      return !words || (words.title !== track.title && !words.chosen);
    });
    if (pending.length > 0 && !albumsLookingUp.has(albumId)) {
      albumsLookingUp.add(albumId);
      (async () => {
        for (const track of pending) {
          await lookUpAndSave({
            albumId, discNumber: track.discNumber, trackNumber: track.trackNumber, title: track.title, durationSec: track.durationSec,
            trackArtist: JSON.stringify(track.artist || []), albumArtist: JSON.stringify(album.artist || []), albumTitle: album.title,
          });
          await pause(PAUSE_MS);
        }
      })()
        .catch(error => logger.warn(`Lyrics of album ${albumId} not looked up: ${(error as Error).message}`))
        .finally(() => albumsLookingUp.delete(albumId));
    }
    return tracks.map(track => ({
      discNumber: track.discNumber,
      trackNumber: track.trackNumber,
      status: pending.includes(track) ? 'pending' : known.get(`${track.discNumber}/${track.trackNumber}`)!.status,
    }));
  },

  /**
   * Looks up every track of the collection that has not been, one at a time,
   * classical CDs apart. Each album done is handed to `albumDone`, to write
   * its .lrc files without waiting for the others. Returns how many were.
   */
  lookUpMissing: async (albumDone?: (albumId: number) => Promise<unknown>): Promise<number> => {
    if (lookingUp) return 0;
    lookingUp = true;
    let done = 0;
    let current: number | null = null;
    const finish = async () => {
      if (current == null || !albumDone) return;
      const albumId = current;
      await albumDone(albumId).catch(error => logger.warn(`Lyrics of album ${albumId} not written: ${(error as Error).message}`));
    };
    try {
      const monthAgo = new Date(Date.now() - RETRY_MISSING_AFTER_MS).toISOString();
      const retryBefore = monthAgo > LOOKUP_REVISED_AT ? monthAgo : LOOKUP_REVISED_AT;
      const classical = await classicalAlbumIds();
      const leftForLater = new Set<string>();
      const key = (track: TrackToLookUp) => `${track.albumId}/${track.discNumber}/${track.trackNumber}`;
      for (;;) {
        const tracks = (await TrackLyrics.toLookUp(retryBefore, BATCH + leftForLater.size, classical)).filter(track => !leftForLater.has(key(track)));
        if (tracks.length === 0) break;
        let failedInARow = 0;
        let lookedUp = 0;
        for (const track of tracks) {
          if (track.albumId !== current) {
            await finish();
            current = track.albumId;
          }
          try {
            await withRetries(() => lookUpAndSave(track));
            done++;
            lookedUp++;
            failedInARow = 0;
          } catch (error) {
            // One track LRCLIB keeps refusing is left for the next pass; several in a row, LRCLIB is down.
            if (++failedInARow >= MAX_FAILURES_IN_A_ROW) {
              logger.warn(`Lyrics lookup stopped after ${done} tracks: ${(error as Error).message}`);
              return done;
            }
            leftForLater.add(key(track));
            logger.warn(`Lyrics of album ${track.albumId} track ${track.discNumber}-${track.trackNumber} left for later: ${(error as Error).message}`);
          }
          await pause(PAUSE_MS);
        }
        if (lookedUp === 0) break;
      }
      await finish();
      if (done > 0) logger.info(`Lyrics looked up for ${done} tracks`);
      return done;
    } finally {
      lookingUp = false;
    }
  },

  /**
   * Writes an .lrc beside every file of a rip whose track has words and no
   * .lrc yet, for the albums given or for all. An .lrc already there is left
   * as it is, whoever wrote it, unless it is word for word what DexVault wrote
   * before for a track looked up again: `replacing`, by "disc/track".
   * `onlyReplacing` writes those tracks alone.
   */
  writeLrcFiles: async (albumIds?: number[], replacing?: Map<string, string>, onlyReplacing = false): Promise<LrcWriteReport | null> => {
    const root = libraryRoot();
    if (!root || !navidromeService.isConfigured()) return null;
    const report: LrcWriteReport = { written: 0, alreadyThere: 0, notOnDisk: 0 };
    const missingExamples: string[] = [];
    for (const [albumId, copy] of await ripStatusService.navidromeAlbums()) {
      if (albumIds && !albumIds.includes(albumId)) continue;
      const lyrics = await TrackLyrics.foundForAlbum(albumId);
      if (lyrics.length === 0) continue;
      const files = await navidromeService.getAlbumSongs(copy.id);
      let realPaths: Array<{ discNumber: number; track: number; path: string }> | null = null;
      for (const words of lyrics) {
        const file = files.find(candidate => candidate.discNumber === words.discNumber && candidate.track === words.trackNumber);
        const text = lrcText(words);
        if (!file || !text) continue;
        let audio = file.path ? resolveOnDisk(root, file.path) : null;
        if (!audio) {
          // Subsonic made the path up from the tags: ask Navidrome's own API, once per album.
          realPaths = realPaths ?? await navidromeService.getSongPaths(copy.id).catch(error => {
            logger.warn(`Navidrome would not say where album ${copy.id} lies: ${(error as Error).message}`);
            return [];
          });
          const real = realPaths.find(candidate => candidate.discNumber === words.discNumber && candidate.track === words.trackNumber);
          audio = (real ? resolveOnDisk(root, real.path) : null)
            ?? (file.path ? findByTags(root, file.path, words.discNumber, words.trackNumber) : null);
          if (!audio && missingExamples.length < 3) {
            missingExamples.push(`album ${albumId} disc ${words.discNumber} track ${words.trackNumber}: ${file.path ?? 'no path'}${real ? ` / ${real.path}` : ''}`);
          }
        }
        if (!audio) { report.notOnDisk++; continue; }
        const lrc = audio.slice(0, audio.length - path.extname(audio).length) + '.lrc';
        const previous = replacing?.get(`${words.discNumber}/${words.trackNumber}`);
        if (onlyReplacing && previous == null) continue;
        if (fs.existsSync(lrc) && (previous == null || previous === text || fs.readFileSync(lrc, 'utf8') !== previous)) {
          report.alreadyThere++;
          continue;
        }
        fs.writeFileSync(lrc, text, 'utf8');
        // DexVault runs as root: the file goes to whoever owns the album folder.
        try {
          const { uid, gid } = fs.statSync(path.dirname(audio));
          fs.chownSync(lrc, uid, gid);
        } catch { /* not ours to give away: harmless */ }
        report.written++;
      }
    }
    if (report.notOnDisk > 0) {
      logger.warn(`Lyrics: ${report.notOnDisk} files Navidrome lists were not found under ${root}, such as ${missingExamples.join('; ')}`);
    }
    // Navidrome watches the library: the folders it is told have changed are scanned within seconds.
    if (report.written > 0) logger.info(`Lyrics: ${report.written} .lrc files written beside the rips`);
    return report;
  },

  /**
   * Every half hour: the tracks of new CDs, each album's .lrc files as soon
   * as it is done, then those of the rips that came since.
   */
  startAutoFetch: (): void => {
    const tick = async () => {
      await lyricsService.lookUpMissing(albumId => lyricsService.writeLrcFiles([albumId])).catch(error => logger.warn(`Lyrics lookup failed: ${(error as Error).message}`));
      await lyricsService.writeLrcFiles().catch(error => logger.warn(`Writing .lrc files failed: ${(error as Error).message}`));
    };
    setTimeout(tick, 2 * 60 * 1000).unref();
    setInterval(tick, EVERY_MS).unref();
  },
};

export default lyricsService;
