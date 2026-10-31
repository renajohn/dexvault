import Album from '../models/album';
import type { AlbumFormatted } from '../types';
import navidromeService, { type NavidromeAlbum, type NavidromeSong } from './navidromeService';
import musicbrainzLinkService from './musicbrainzLinkService';
import musicbrainzService from './musicbrainzService';
import musicbrainzRefreshService from './musicbrainzRefreshService';
import ReleaseGroupLookup, { type ReleaseInfo } from '../models/releaseGroupLookup';
import musicService from './musicService';
import musicCollectionService from './musicCollectionService';
import { getDatabase } from '../database';
import listenHistoryService from './listenHistoryService';
import imageService from './imageService';
import logger from '../logger';

/**
 * Where each CD of the collection stands in Navidrome:
 * - none:     not found in the library;
 * - lossy:    found, but some of its files are compressed (MP3, AAC);
 * - lossless: found, every file lossless (FLAC, ALAC, WAV, AIFF).
 * Every CD is to be ripped again to lossless, so "lossy" is still to do.
 */
export type RipState = 'none' | 'lossy' | 'lossless';
export type RipMatch = 'musicbrainz' | 'title' | 'tracks';

export interface RipStatusAlbum {
  id: number;
  title: string;
  artist: string[];
  cover: string | null;
  musicbrainzReleaseId: string | null;
  state: RipState;
  formats: string[];
  matches: Array<{ navidromeId: string; name: string; artist: string; match: RipMatch; state: RipState }>;
}

/**
 * What DexVault did with an edition found in a rip: took it for a CD of the
 * collection, moved the album off the wish list, or added the CD; or why it
 * left everything alone.
 */
export interface EditionAdoption {
  albumId: number | null;
  title: string;
  releaseId: string;
  action?: 'edition' | 'promoted' | 'added';
  previousReleaseId?: string | null;
  skipped?: 'no_release_group' | 'not_a_cd' | 'several_albums' | 'edition_taken' | 'failed';
}

export interface RipStatus {
  configured: boolean;
  error?: string;
  counts: Record<RipState, number>;
  albums: RipStatusAlbum[];
}

export const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aif', 'aiff', 'ape', 'wv']);

/** An .m4a is ALAC when Navidrome reports a bit depth, AAC otherwise. */
export const isLossless = (song: NavidromeSong): boolean =>
  LOSSLESS.has(song.suffix) || (song.suffix === 'm4a' && Boolean(song.bitDepth));

export const formatName = (song: NavidromeSong): string =>
  (song.suffix === 'm4a' ? (song.bitDepth ? 'alac' : 'aac') : song.suffix).toUpperCase();

/** "Abbey Road (Remastered 2009)" and "Abbey Road [Disc 1]" are Abbey Road. */
const cleanTitle = (title: string): string =>
  musicbrainzLinkService.normalize(title.replace(/[([][^)\]]*[)\]]/g, ' '));

/** "The Dark Side of the Moon" is Dark Side of the Moon, "L'Essentiel" is Essentiel. */
const ARTICLE = /^(the|a|an|le|la|les|l|un|une|der|die|das|il|lo|el|los)\s+/;

/**
 * The names a CD may carry in its tags: Discogs titles join translations,
 * "Cellokonzerte • Cello Concertos", while a rip keeps one of them; an old
 * copy names the composer first, "Mozart: Requiem", where the CD says Requiem.
 * The artist still has to agree.
 */
const titleVariants = (title: string): Set<string> => {
  const parts = [title, ...title.split(/\s+[•·=/]\s+/)];
  const afterColon = parts.filter(part => part.includes(':')).map(part => part.slice(part.indexOf(':') + 1));
  const keys = (list: string[]) => list.map(part => cleanTitle(part).replace(ARTICLE, ''));
  return new Set([
    ...keys([title]),
    ...[...keys(parts.slice(1)), ...keys(afterColon)].filter(part => part.length >= 4),
  ].filter(Boolean));
};

const sameTitle = (a: string, b: string): boolean => {
  const variants = titleVariants(a);
  return [...titleVariants(b)].some(variant => variants.has(variant));
};

/**
 * The length of every track, in order: a CD and a copy of it whose titles
 * and credits have nothing in common, "Violinkonzert Nr. 5" against "Violin
 * Concertos", still last the same, second for second.
 */
export interface TrackLengths {
  cd: Map<number, number[]>;
  navidrome: Map<string, number[]>;
}

const MIN_TRACKS = 3;
const TOLERANCE_SEC = 2;

const sameTracks = (cd: number[] | undefined, copy: number[] | undefined): boolean =>
  Boolean(cd && copy && cd.length >= MIN_TRACKS && cd.length === copy.length
    && cd.every((length, index) => Math.abs(length - copy[index]) <= TOLERANCE_SEC));

/** Each CD's track lengths, null when one of them is unknown. */
const cdTrackLengths = (): Promise<Map<number, number[]>> =>
  new Promise((resolve, reject) =>
    getDatabase().all(
      'SELECT album_id, duration_sec FROM tracks ORDER BY album_id, disc_number, track_number',
      [],
      (err: Error | null, rows: Array<{ album_id: number; duration_sec: number | null }>) => {
        if (err) { reject(err); return; }
        const lengths = new Map<number, number[]>();
        const incomplete = new Set<number>();
        for (const row of rows) {
          if (row.duration_sec == null) incomplete.add(row.album_id);
          lengths.set(row.album_id, [...(lengths.get(row.album_id) || []), row.duration_sec ?? 0]);
        }
        for (const id of incomplete) lengths.delete(id);
        resolve(lengths);
      }));

const navidromeTrackLengths = (songs: NavidromeSong[]): Map<string, number[]> => {
  const byAlbum = new Map<string, NavidromeSong[]>();
  for (const song of songs) byAlbum.set(song.albumId, [...(byAlbum.get(song.albumId) || []), song]);
  const lengths = new Map<string, number[]>();
  for (const [albumId, list] of byAlbum) {
    if (list.some(song => song.durationSec == null)) continue;
    lengths.set(albumId, [...list]
      .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.track ?? 0) - (b.track ?? 0))
      .map(song => song.durationSec!));
  }
  return lengths;
};

const words = (text: string): string[] => musicbrainzLinkService.normalize(text).split(' ').filter(Boolean);

/**
 * One of the CD's artists is named by the tags, word for word in any order:
 * "Beatles, The" is The Beatles, "Mstislav Rostropovich; Paul Sacher" credits
 * Rostropovich.
 */
const sameArtist = (artists: string[], navidromeArtist: string): boolean => {
  const tagged = new Set(words(navidromeArtist));
  if (tagged.size === 0) return false;
  return artists.map(words).filter(list => list.length > 0).some(list =>
    list.every(word => tagged.has(word)) || [...tagged].every(word => list.includes(word)));
};

/**
 * How good the files of an album are:
 * - lossless: every file lossless (FLAC, ALAC…);
 * - near:     compressed, at 256 kbps or more on average (MP3 320, V0, AAC 256);
 * - lossy:    compressed below that.
 * A mixed album is as good as its compressed files.
 */
export type Quality = 'lossless' | 'near' | 'lossy';

const NEAR_LOSSLESS_KBPS = 256;

/** The quality of an album's files, weighed as the page shows it. */
export const qualityOf = (songs: NavidromeSong[]): { quality: Quality; bitRate: number | null; hiRes: boolean } => {
  const compressed = songs.filter(song => !isLossless(song));
  if (songs.length > 0 && compressed.length === 0) {
    const hiRes = songs.every(song => (song.bitDepth ?? 16) > 16 || (song.samplingRate ?? 44100) > 44100);
    return { quality: 'lossless', bitRate: null, hiRes };
  }
  // Weighed by length: a VBR file's quiet track has a lower bitrate than the album.
  const length = compressed.reduce((sum, song) => sum + (song.durationSec || 0), 0);
  const bitRate = compressed.length === 0 ? null : length > 0
    ? Math.round(compressed.reduce((sum, song) => sum + (song.bitRate || 0) * (song.durationSec || 0), 0) / length)
    : Math.round(compressed.reduce((sum, song) => sum + (song.bitRate || 0), 0) / compressed.length);
  return { quality: (bitRate ?? 0) >= NEAR_LOSSLESS_KBPS ? 'near' : 'lossy', bitRate, hiRes: false };
};

export const groupSongs = (songs: NavidromeSong[]): Map<string, NavidromeSong[]> => {
  const byAlbum = new Map<string, NavidromeSong[]>();
  for (const song of songs) byAlbum.set(song.albumId, [...(byAlbum.get(song.albumId) || []), song]);
  return byAlbum;
};

const albumState = (album: NavidromeAlbum, songsByAlbum: Map<string, NavidromeSong[]>): RipState => {
  const songs = songsByAlbum.get(album.id) || [];
  return songs.length > 0 && songs.every(isLossless) ? 'lossless' : 'lossy';
};

/** Gives a CD added from its rip the cover Navidrome reads in its files, when no archive had one. */
const coverFromRip = async (albumId: number, releaseId: string, albums: NavidromeAlbum[]): Promise<void> => {
  const rip = albums.find(album => album.musicBrainzId === releaseId);
  if (!rip) return;
  try {
    const { data: cover } = await navidromeService.getCoverArt(rip.id);
    await Album.updateFrontCover(albumId, await imageService.saveImage(cover, 'cd/custom', `navidrome_${albumId}_${Date.now()}.jpg`));
  } catch (error) {
    logger.warn(`Album ${albumId} added from its rip has no cover: ${(error as Error).message}`);
  }
};

/** The release group of an edition and whether it is a CD, asked of MusicBrainz once and remembered. */
const releaseInfo = async (releaseId: string): Promise<ReleaseInfo> => {
  const known = await ReleaseGroupLookup.find(releaseId);
  if (known) return known;
  const release = await musicbrainzService.getReleaseDetails(releaseId);
  const media = release.media || [];
  const info = {
    releaseGroupId: release['release-group']?.id ?? null,
    isCd: media.length > 0 && media.every(medium => /CD/i.test(medium.format || '')),
  };
  await ReleaseGroupLookup.save(releaseId, info);
  return info;
};

/**
 * The Navidrome albums that are this CD: same MusicBrainz edition, else same
 * title and artist, else the same tracks to the second.
 */
export const matchesOf = (album: AlbumFormatted, candidates: NavidromeAlbum[], lengths?: TrackLengths): Array<{ candidate: NavidromeAlbum; match: RipMatch }> =>
  candidates.flatMap(candidate => {
    if (album.musicbrainzReleaseId && candidate.musicBrainzId === album.musicbrainzReleaseId) {
      return [{ candidate, match: 'musicbrainz' as RipMatch }];
    }
    if (sameTitle(album.title, candidate.name) && sameArtist(album.artist, candidate.artist)) {
      return [{ candidate, match: 'title' as RipMatch }];
    }
    return lengths && sameTracks(lengths.cd.get(album.id), lengths.navidrome.get(candidate.id))
      ? [{ candidate, match: 'tracks' as RipMatch }] : [];
  });

export interface Library { albums: NavidromeAlbum[]; songs: NavidromeSong[]; lengths: TrackLengths }

const CACHE_MS = 60_000;
let cache: { at: number; albums: NavidromeAlbum[]; songs: NavidromeSong[]; lengths: Map<string, number[]> } | null = null;

/** The reading under way, with a token of its own: a sync forgets it by changing the token. */
let reading: { token: object; done: Promise<void> } | null = null;
const readingToken = (): object | undefined => reading?.token;

/** Reads Navidrome anew, once at a time however many ask. */
const reread = (): Promise<void> => {
  if (reading) return reading.done;
  const token = {};
  const done = (async () => {
    const [albums, songs] = await Promise.all([navidromeService.getAlbums(), navidromeService.getSongs()]);
    // A sync asked for a fresher reading meanwhile: this one is not kept.
    if (readingToken() !== token) return;
    cache = { at: Date.now(), albums, songs, lengths: navidromeTrackLengths(songs) };
    // Every fresh reading notes what was listened to since the last one.
    await listenHistoryService.record(songs).catch(error =>
      logger.warn(`Plays not noted from Navidrome: ${(error as Error).message}`));
  })().finally(() => { if (readingToken() === token) reading = null; });
  reading = { token, done };
  return done;
};

/**
 * Navidrome with the track lengths of the CDs as they stand now. A reading
 * older than a minute is answered at once and read anew behind it, so no page
 * waits for Navidrome but the first one after a start or a sync.
 */
const library = async (): Promise<Library> => {
  if (!cache) await reread();
  else if (Date.now() - cache.at >= CACHE_MS) {
    reread().catch(error => logger.warn(`Navidrome not read anew: ${(error as Error).message}`));
  }
  // The reading in hand: a sync may clear the cache while the CDs' lengths are read.
  const read = cache!;
  return { albums: read.albums, songs: read.songs, lengths: { cd: await cdTrackLengths(), navidrome: read.lengths } };
};

/**
 * The copy of a CD in Navidrome whose cover and stars to take: the lossless
 * rip, the one tagged in Picard, before an old MP3.
 */
const bestCopy = (album: AlbumFormatted, navidrome: Library): NavidromeAlbum | null => {
  const songsByAlbum = groupSongs(navidrome.songs);
  const matches = matchesOf(album, navidrome.albums, navidrome.lengths)
    .sort((a, b) => Number(albumState(b.candidate, songsByAlbum) === 'lossless') - Number(albumState(a.candidate, songsByAlbum) === 'lossless')
      || Number(b.match === 'musicbrainz') - Number(a.match === 'musicbrainz'));
  return matches[0]?.candidate ?? null;
};

/** The Navidrome album a digital album stands for, null once Navidrome no longer has it. */
const ownAlbum = (album: AlbumFormatted, navidrome: Library): NavidromeAlbum | null =>
  navidrome.albums.find(candidate => candidate.id === album.navidromeId) ?? null;

const ripStatusService = {
  /** Forgets the library read from Navidrome, for a refresh right after a rip. */
  /** Forgets the reading, and any under way: the next one is made anew (the Refresh of the Digital page). */
  clearCache: (): void => { cache = null; reading = null; },

  /** Navidrome's albums and songs, read at most once a minute. */
  library,

  /** Reads Navidrome again now, which notes the plays since the last reading. */
  refreshLibrary: async (): Promise<void> => {
    cache = null;
    reading = null;
    await library();
  },

  /**
   * Takes from the rips the edition Picard identified each CD as. A FLAC
   * album in Navidrome carries the MusicBrainz edition its files were tagged
   * with; when the collection does not have it, it goes to the album of the
   * same release group, the only one: a CD of the collection takes it in
   * place of the edition picked when it was added, an album of the wish list
   * also moves into the collection, and a CD DexVault does not know yet is
   * added. Tracks and credits then follow.
   */
  adoptEditions: async (): Promise<EditionAdoption[]> => {
    if (!navidromeService.isConfigured()) return [];
    const navidrome = await library();
    const songsByAlbum = groupSongs(navidrome.songs);
    // findAll is the collection only; the wish list and the digital albums come on top.
    const all = [...await Album.findAll(), ...await Album.findByStatus('wish'), ...await Album.findByStatus('digital')];
    const owned = (album: AlbumFormatted) => album.titleStatus !== 'wish' && album.titleStatus !== 'digital';
    const known = new Set(all.filter(owned).map(album => album.musicbrainzReleaseId).filter(Boolean));
    const refresh = (albumId: number, releaseId: string) => musicbrainzRefreshService.refreshAlbum(albumId).catch(error =>
      logger.warn(`Album ${albumId} took edition ${releaseId} but could not be refreshed: ${(error as Error).message}`));
    // Only a FLAC rip speaks for a CD: the rips of this workflow are FLAC,
    // while the library also holds older lossless copies (ALAC from iTunes,
    // tagged at some point) of CDs that may not be in the collection at all.
    const isFlacRip = (album: NavidromeAlbum) => {
      const songs = songsByAlbum.get(album.id) || [];
      return songs.length > 0 && songs.every(song => song.suffix === 'flac');
    };
    const editions = [...new Set(navidrome.albums
      .filter(album => album.musicBrainzId && !known.has(album.musicBrainzId) && isFlacRip(album))
      .map(album => album.musicBrainzId!))];

    const results: EditionAdoption[] = [];
    for (const releaseId of editions) {
      const name = navidrome.albums.find(album => album.musicBrainzId === releaseId)?.name || releaseId;
      try {
        const { releaseGroupId, isCd } = await releaseInfo(releaseId);
        if (!releaseGroupId) { results.push({ albumId: null, title: name, releaseId, skipped: 'no_release_group' }); continue; }
        // A digital album taken in from the tags knows its edition, seldom its release group.
        const sameGroup = all.filter(album => album.musicbrainzReleaseGroupId === releaseGroupId
          || (album.titleStatus === 'digital' && album.musicbrainzReleaseId === releaseId));
        const inCollection = sameGroup.filter(owned);
        const wished = sameGroup.filter(album => album.titleStatus === 'wish');
        // An older copy of the same album (MP3, iTunes) is a digital album of the
        // same group too: the one this rip made is the one of its edition.
        const digitalOfGroup = sameGroup.filter(album => album.titleStatus === 'digital');
        const ofEdition = digitalOfGroup.filter(album => album.musicbrainzReleaseId === releaseId);
        const digital = ofEdition.length === 1 ? ofEdition : digitalOfGroup;
        if (inCollection.length > 1 || (inCollection.length === 0 && (wished.length > 1 || (wished.length === 0 && digital.length > 1)))) {
          results.push({ albumId: null, title: name, releaseId, skipped: 'several_albums' });
          continue;
        }

        const [album] = inCollection.length === 1 ? inCollection : wished.length === 1 ? wished : digital;
        // A digital album is a CD only as an album DexVault did not know would be: the edition is one.
        if (album?.titleStatus === 'digital' && !isCd) { results.push({ albumId: album.id, title: album.title, releaseId, skipped: 'not_a_cd' }); continue; }
        if (!album) {
          // Not in DexVault at all: a CD ripped before being catalogued is added,
          // a download bought in lossless is not a CD of the collection.
          if (!isCd) { results.push({ albumId: null, title: name, releaseId, skipped: 'not_a_cd' }); continue; }
          // Its cover waited for: the banner of Listen Next reads it once this sync answers.
          const added = await musicService.addAlbumFromMusicBrainz(releaseId, { titleStatus: 'owned' } as never, { waitForCover: true });
          // No image for its edition anywhere: the one Picard put in its files.
          if (!added.cover) await coverFromRip(added.id, releaseId, navidrome.albums);
          logger.info(`Album ${added.id} "${added.title}" added from its rip, edition ${releaseId}`);
          results.push({ albumId: added.id, title: added.title, releaseId, action: 'added' });
          // A second rip of the same album, later in this run, finds it instead of adding it again.
          all.push({ ...added, musicbrainzReleaseGroupId: releaseGroupId, titleStatus: 'owned' });
          await refresh(added.id, releaseId);
          continue;
        }

        if (album.musicbrainzReleaseId !== releaseId) {
          try {
            await Album.replaceReleaseId(album.id, releaseId);
          } catch (error) {
            // The unique index: another album already has this edition.
            results.push({ albumId: album.id, title: album.title, releaseId, skipped: 'edition_taken' });
            continue;
          }
        }
        const promoted = album.titleStatus === 'wish' || album.titleStatus === 'digital';
        if (promoted) await Album.updateStatus(album.id, 'owned');
        if (album.titleStatus === 'digital') await Album.setFormat(album.id, 'CD');
        // A CD come into the collection: at the end of Listen Next, as one added or bought.
        if (promoted) await musicCollectionService.addNewCd(album.id).catch(error =>
          logger.warn(`Album ${album.id} ripped but not put in Listen Next: ${(error as Error).message}`));
        logger.info(`Album ${album.id} "${album.title}" takes edition ${releaseId} from its rip (was ${album.musicbrainzReleaseId ?? 'none'})${promoted ? `, moved off the ${album.titleStatus === 'wish' ? 'wish list' : 'digital albums'}` : ''}`);
        results.push({ albumId: album.id, title: album.title, releaseId, action: promoted ? 'promoted' : 'edition', previousReleaseId: album.musicbrainzReleaseId ?? null });
        await refresh(album.id, releaseId);
      } catch (error) {
        logger.warn(`Could not take the edition ${releaseId} found in Navidrome: ${(error as Error).message}`);
        results.push({ albumId: null, title: name, releaseId, skipped: 'failed' });
      }
    }
    return results;
  },

  /** The best copy of a CD in Navidrome, null when it has none. */
  navidromeAlbumFor: async (albumId: number): Promise<NavidromeAlbum | null> => {
    const album = await Album.findById(albumId);
    // A mixtape is a playlist, no album of Navidrome.
    if (!album || album.titleStatus === 'playlist') return null;
    const navidrome = await library();
    return album.titleStatus === 'digital' ? ownAlbum(album, navidrome) : bestCopy(album, navidrome);
  },

  /** The copy in Navidrome of every CD of the collection that has one, and the album of every digital album, by album id. */
  navidromeAlbums: async (): Promise<Map<number, NavidromeAlbum>> => {
    const navidrome = await library();
    const copies = new Map<number, NavidromeAlbum>();
    for (const album of await Album.findAll()) {
      const copy = bestCopy(album, navidrome);
      if (copy) copies.set(album.id, copy);
    }
    for (const album of await Album.findByStatus('digital')) {
      const own = ownAlbum(album, navidrome);
      if (own) copies.set(album.id, own);
    }
    return copies;
  },

  /** Keeps the library read a moment ago in step with stars DexVault just gave in Navidrome. */
  noteRating: (navidromeAlbumId: string, rating: number): void => {
    const album = cache?.albums.find(candidate => candidate.id === navidromeAlbumId);
    if (album) album.userRating = rating;
  },

  getStatus: async (): Promise<RipStatus> => {
    const counts: Record<RipState, number> = { none: 0, lossy: 0, lossless: 0 };
    const owned = (await Album.findAll()).filter(album => /CD|Unknown/i.test(album.format || 'Unknown'));

    let navidrome: Library = { albums: [], songs: [], lengths: { cd: new Map(), navidrome: new Map() } };
    let error: string | undefined;
    const configured = navidromeService.isConfigured();
    if (configured) {
      try {
        navidrome = await library();
      } catch (e) {
        error = (e as Error).message;
      }
    }

    const songsByAlbum = groupSongs(navidrome.songs);
    const stateOf = (album: NavidromeAlbum) => albumState(album, songsByAlbum);

    const albums = owned.map(album => {
      const matches = matchesOf(album, navidrome.albums, navidrome.lengths);

      // A CD ripped again sits next to its old MP3 copy until that one is deleted: the best copy counts.
      const states = matches.map(({ candidate }) => stateOf(candidate));
      const state: RipState = states.includes('lossless') ? 'lossless' : states.length > 0 ? 'lossy' : 'none';
      counts[state]++;
      const formats = [...new Set(matches.flatMap(({ candidate }) => (songsByAlbum.get(candidate.id) || []).map(formatName)))].sort();

      return {
        id: album.id,
        title: album.title,
        artist: album.artist,
        cover: album.cover || null,
        musicbrainzReleaseId: album.musicbrainzReleaseId || null,
        state,
        formats,
        matches: matches.map(({ candidate, match }, index) => ({
          navidromeId: candidate.id, name: candidate.name, artist: candidate.artist, match, state: states[index],
        })),
      };
    });

    return { configured, ...(error ? { error } : {}), counts, albums };
  },
};

export default ripStatusService;
