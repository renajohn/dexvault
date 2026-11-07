import Album from '../models/album';
import NavidromePlay from '../models/navidromePlay';
import NavidromeListener, { type Favourite } from '../models/navidromeListener';
import type { DayPlays } from '../models/navidromePlay';
import type { AlbumFormatted } from '../types';
import navidromeService, { type NavidromeAlbum, type NavidromeSong } from './navidromeService';
import ripStatusService, { cdSongsOf, formatName, groupSongs, matchesOf, qualityOf, type Library, type Quality, type RipMatch } from './ripStatusService';

export type { Quality };
import listenHistoryService, { localDay } from './listenHistoryService';
import musicService from './musicService';
import digitalAlbumService, { DIGITAL_FORMAT } from './digitalAlbumService';
import musicbrainzRefreshService from './musicbrainzRefreshService';
import imageService from './imageService';
import logger from '../logger';

/**
 * An album one listens to and has no CD of is one to buy: at least three of
 * its tracks played twice or more over the last 90 days, every track for an
 * album of fewer. Twice the same three songs in an evening counts, one
 * listen of the whole album does not. The most recent plays rank first.
 */
export const LISTEN_WINDOW_DAYS = 90;
const REPEATS = 2;
const FAVOURITES = 3;
const HALF_LIFE_DAYS = 60;
const EXPLICIT_RATING = 4;

export interface Listening {
  /** Tracks played at least twice in the window, and how many it takes. */
  favourites: number;
  needed: number;
  plays: number;
  lastPlayed: string | null;
  /** Recent plays weigh more, a play halving every 60 days: what the Buy tab is sorted by. */
  score: number;
}

export interface DigitalAlbum {
  navidromeId: string;
  name: string;
  artist: string;
  songCount: number;
  /** The album in Navidrome's web player. */
  url: string;
  formats: string[];
  quality: Quality;
  /** Average bitrate of the compressed files, in kbps; null when all are lossless. */
  bitRate: number | null;
  /** Lossless at more than 16 bits or 44.1 kHz. */
  hiRes: boolean;
  /** The CD of the collection this is a copy of. */
  cd: { id: number; title: string; artist: string[]; cover: string | null; format: string | null; match: RipMatch } | null;
  /** An old compressed copy of the same CD still sits next to this lossless one. */
  oldCopy: boolean;
  wishAlbumId: number | null;
  /** The album of DexVault standing for it: the CD, the wish, or the digital album. */
  albumId: number | null;
  rating: number;
  starred: boolean;
  /** Tracks rated 4 or 5 stars, or hearted. */
  favouriteTracks: number;
  listening: Listening;
  /** Why it is worth buying on CD; null when the CD is in the collection or nothing says so. */
  buy: { listened: boolean; rated: boolean; wished: boolean } | null;
  dismissed: boolean;
}

export interface PhysicalOnlyAlbum {
  id: number;
  title: string;
  artist: string[];
  cover: string | null;
}

/** A compressed copy of a CD Navidrome also has in lossless: a file to delete. */
export interface OldCopy {
  albumId: number;
  title: string;
  navidromeId: string;
  name: string;
  formats: string[];
}

export interface DigitalLibrary {
  configured: boolean;
  error?: string;
  albums: DigitalAlbum[];
  physicalOnly: PhysicalOnlyAlbum[];
  oldCopies: OldCopy[];
  /** What the DexVault plugin in Navidrome reports, null until it first has. */
  plugin: PluginReports | null;
}

/** The plugin's reports: the other accounts counted, and whether it still reports. */
export interface PluginReports {
  /** Accounts besides NAVIDROME_USER whose plays and likes count too. */
  accounts: string[];
  /** Unix seconds of its last hourly report. */
  lastReportAt: number | null;
  /** No hourly report for three hours: the plugin is off, or cannot reach DexVault. */
  stale: boolean;
}

const STALE_AFTER_SEC = 3 * 3600;

const pluginReports = async (main: string, now: number = Date.now() / 1000): Promise<PluginReports | null> => {
  const listeners = await NavidromeListener.listeners();
  if (listeners.length === 0) return null;
  const reports = listeners.map(listener => listener.favouritesAt ?? 0);
  const lastReportAt = Math.max(...reports) || null;
  return {
    accounts: listeners.map(listener => listener.user).filter(user => user !== main),
    lastReportAt,
    stale: !lastReportAt || now - lastReportAt > STALE_AFTER_SEC,
  };
};

export interface DigitalTrack {
  id: string | null;
  url: string | null;
  discNumber: number;
  track: number;
  title: string;
  durationSec: number | null;
  suffix: string;
  bitRate: number | null;
  bitDepth: number | null;
  samplingRate: number | null;
  /** Plays over the last 90 days, all plays ever (Navidrome's count), and the last one. */
  plays: number;
  totalPlays: number;
  lastPlayed: string | null;
  rating: number;
  starred: boolean;
}

/** The plays of each song over the window, by song. */
const playsBySong = (plays: DayPlays[]): Map<string, DayPlays[]> => {
  const bySong = new Map<string, DayPlays[]>();
  for (const play of plays) bySong.set(play.songId, [...(bySong.get(play.songId) || []), play]);
  return bySong;
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const listeningOf = (songs: NavidromeSong[], bySong: Map<string, DayPlays[]>, today: string): Listening => {
  const counts = songs.map(song => (song.id ? bySong.get(song.id) || [] : []));
  const favourites = counts.filter(days => days.reduce((sum, day) => sum + day.plays, 0) >= REPEATS).length;
  const all = counts.flat();
  const score = all.reduce((sum, day) => sum + day.plays * 0.5 ** (daysBetween(day.day, today) / HALF_LIFE_DAYS), 0);
  // Navidrome's last play, or a day of the history when it is later: plays of
  // another account in Navidrome do not count, and those noted here do.
  const lastPlayed = [...songs.map(song => song.played), ...all.map(day => day.day)]
    .filter((played): played is string => Boolean(played)).sort().pop() ?? null;
  return {
    favourites,
    needed: Math.min(FAVOURITES, songs.length),
    plays: all.reduce((sum, day) => sum + day.plays, 0),
    lastPlayed,
    score: Math.round(score * 100) / 100,
  };
};

const byName = (a: DigitalAlbum, b: DigitalAlbum) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);

/**
 * A wish list album for a digital one: its MusicBrainz edition when the files
 * carry one, else its title and artist with the cover Navidrome shows.
 */
const wishFor = async (album: NavidromeAlbum): Promise<AlbumFormatted> => {
  if (album.musicBrainzId) {
    try {
      return await musicService.addAlbumFromMusicBrainz(album.musicBrainzId, { titleStatus: 'wish' });
    } catch (error) {
      logger.warn(`Could not wish "${album.name}" from its edition ${album.musicBrainzId}: ${(error as Error).message}`);
    }
  }
  const added = await musicService.addAlbum({ title: album.name, artist: [album.artist], format: 'CD', titleStatus: 'wish' });
  try {
    const { data } = await navidromeService.getCoverArt(album.id);
    const filename = `navidrome_${added.id}_${Date.now()}.jpg`;
    const coverPath = await imageService.saveImage(data, 'cd/custom', filename);
    await Album.updateFrontCover(added.id, coverPath);
  } catch (error) {
    logger.warn(`Wished "${album.name}" without a cover: ${(error as Error).message}`);
  }
  return added;
};

const EMPTY: Library = { albums: [], songs: [], lengths: { cd: new Map(), navidrome: new Map() } };

const build = async (navidrome: Library, configured: boolean, error?: string): Promise<DigitalLibrary> => {
  const owned = await Album.findAll();
  const wished = await Album.findByStatus('wish');
  const digitalIds = new Map((await Album.findByStatus('digital')).filter(album => album.navidromeId).map(album => [album.navidromeId!, album.id]));
  const dismissed = await NavidromePlay.dismissed();
  const today = localDay(new Date());
  const bySong = playsBySong(await listenHistoryService.recent(LISTEN_WINDOW_DAYS));
  // A heart or 4-5 stars from any account puts an album in Buy; what is shown stays NAVIDROME_USER's.
  const main = process.env.NAVIDROME_USER || '';
  const others = await NavidromeListener.othersFavourites(main);
  const liked = (own: { rating: number; starred: boolean }, other: Favourite | undefined) =>
    own.rating >= EXPLICIT_RATING || own.starred || (other ? other.rating >= EXPLICIT_RATING || other.starred : false);
  const songsByAlbum = groupSongs(navidrome.songs);
  const qualities = new Map(navidrome.albums.map(album => [album.id, qualityOf(songsByAlbum.get(album.id) || [])]));

  // Which CD each Navidrome album is a copy of, and the old copies a lossless rip makes redundant.
  const cdOf = new Map<string, { album: AlbumFormatted; match: RipMatch }>();
  const oldCopies: OldCopy[] = [];
  const physicalOnly: PhysicalOnlyAlbum[] = [];
  for (const album of owned) {
    const matches = matchesOf(album, navidrome.albums, navidrome.lengths);
    if (matches.length === 0) {
      if (/CD|Unknown/i.test(album.format || 'Unknown')) {
        physicalOnly.push({ id: album.id, title: album.title, artist: album.artist, cover: album.cover || null });
      }
      continue;
    }
    // A copy is as good as its files on the CD's tracks: a bonus bought apart leaves a rip lossless.
    const places = navidrome.lengths.cdPlaces?.get(album.id);
    const lossless = (id: string) => qualityOf(cdSongsOf(songsByAlbum.get(id) || [], places)).quality === 'lossless';
    const hasLossless = matches.some(({ candidate }) => lossless(candidate.id));
    for (const { candidate, match } of matches) {
      if (hasLossless && !lossless(candidate.id)) {
        oldCopies.push({
          albumId: album.id, title: album.title, navidromeId: candidate.id, name: candidate.name,
          formats: [...new Set((songsByAlbum.get(candidate.id) || []).map(formatName))].sort(),
        });
      } else if (!cdOf.has(candidate.id)) {
        cdOf.set(candidate.id, { album, match });
      }
    }
  }
  const oldCopyIds = new Set(oldCopies.map(copy => copy.navidromeId));
  const withOldCopy = new Set(oldCopies.map(copy => copy.albumId));

  const albums = navidrome.albums.filter(album => !oldCopyIds.has(album.id)).map((album): DigitalAlbum => {
    const songs = songsByAlbum.get(album.id) || [];
    const owner = cdOf.get(album.id);
    const listening = listeningOf(songs, bySong, today);
    const favouriteTracks = songs.filter(song =>
      liked({ rating: song.userRating ?? 0, starred: Boolean(song.starred) }, song.id ? others.songs.get(song.id) : undefined)).length;
    const wishAlbumId = owner ? null : wished.find(wish => matchesOf(wish, [album], navidrome.lengths).length > 0)?.id ?? null;
    const listened = listening.needed > 0 && listening.favourites >= listening.needed;
    const rated = liked({ rating: album.userRating, starred: Boolean(album.starred) }, others.albums.get(album.id)) || favouriteTracks > 0;
    const wishedNow = wishAlbumId !== null;
    return {
      navidromeId: album.id,
      name: album.name,
      artist: album.artist,
      songCount: album.songCount || songs.length,
      url: navidromeService.albumUrl(album.id),
      formats: [...new Set(songs.map(formatName))].sort(),
      ...(qualities.get(album.id) || { quality: 'lossy' as Quality, bitRate: null, hiRes: false }),
      cd: owner ? {
        id: owner.album.id, title: owner.album.title, artist: owner.album.artist,
        cover: owner.album.cover || null, format: owner.album.format || null, match: owner.match,
      } : null,
      oldCopy: owner ? withOldCopy.has(owner.album.id) : false,
      wishAlbumId,
      albumId: owner?.album.id ?? wishAlbumId ?? digitalIds.get(album.id) ?? null,
      rating: album.userRating,
      starred: Boolean(album.starred),
      favouriteTracks,
      listening,
      buy: !owner && (listened || rated || wishedNow) ? { listened, rated, wished: wishedNow } : null,
      dismissed: dismissed.has(album.id),
    };
  }).sort(byName);

  physicalOnly.sort((a, b) => a.artist.join(', ').localeCompare(b.artist.join(', ')) || a.title.localeCompare(b.title));
  return { configured, ...(error ? { error } : {}), albums, physicalOnly, oldCopies, plugin: await pluginReports(main) };
};

const digitalLibraryService = {
  /** Every album of Navidrome, how good its files are, whether it is a CD of the collection, and whether to buy it. */
  getLibrary: async (): Promise<DigitalLibrary> => {
    const configured = navidromeService.isConfigured();
    if (!configured) return build(EMPTY, false);
    try {
      return build(await ripStatusService.library(), true);
    } catch (error) {
      return build(EMPTY, true, (error as Error).message);
    }
  },

  /** One album as the page shows it, null when Navidrome has no such album. */
  getAlbum: async (navidromeId: string): Promise<DigitalAlbum | null> =>
    (await digitalLibraryService.getLibrary()).albums.find(album => album.navidromeId === navidromeId) ?? null,

  /**
   * Puts an album with no CD on the wish list, or takes it off: the digital
   * album standing for it becomes a wish, and a wish a digital album again,
   * the same album with its tracks, words and notes. Null when Navidrome has
   * no such album.
   */
  setWished: async (navidromeId: string, wished: boolean): Promise<DigitalAlbum | null> => {
    const navidrome = await ripStatusService.library();
    const album = navidrome.albums.find(candidate => candidate.id === navidromeId);
    if (!album) return null;
    // Its own wish first: once refreshed from MusicBrainz, its title may no longer match the files'.
    const standing = (await Album.findByStatus('wish')).filter(wish =>
      wish.navidromeId === navidromeId || matchesOf(wish, [album], navidrome.lengths).length > 0);
    if (wished && standing.length === 0) {
      const digital = await digitalAlbumService.forNavidromeAlbum(navidromeId)
        ?? (await digitalAlbumService.reconcile(), await digitalAlbumService.forNavidromeAlbum(navidromeId));
      if (digital) {
        await Album.updateStatus(digital.id, 'wish');
        await Album.setFormat(digital.id, 'CD');
        logger.info(`Album ${digital.id} "${digital.title}" wished from its digital copy in Navidrome`);
        // The edition the files carry: the CD to buy, its tracks and credits as MusicBrainz has them.
        if (digital.musicbrainzReleaseId) {
          await musicbrainzRefreshService.refreshAlbum(digital.id).catch(error =>
            logger.warn(`Wished album ${digital.id} not refreshed from MusicBrainz: ${(error as Error).message}`));
        }
      } else {
        const added = await wishFor(album);
        await Album.setNavidrome(added.id, navidromeId);
        logger.info(`Album ${added.id} "${added.title}" wished from its digital copy in Navidrome`);
      }
    }
    if (!wished) {
      // Wishes made before digital albums were, with no Navidrome album of their own, take this one.
      for (const wish of standing) {
        await Album.updateStatus(wish.id, 'digital');
        await Album.setFormat(wish.id, DIGITAL_FORMAT);
        if (!wish.navidromeId) await Album.setNavidrome(wish.id, navidromeId);
      }
    }
    return digitalLibraryService.getAlbum(navidromeId);
  },

  /** "Not interested": listening to an album no longer puts it in the Buy tab, until undone. */
  setDismissed: async (navidromeId: string, dismissed: boolean): Promise<DigitalAlbum | null> => {
    const album = (await ripStatusService.library()).albums.find(candidate => candidate.id === navidromeId);
    if (!album) return null;
    if (dismissed) await NavidromePlay.dismiss(album.id, album.name, album.artist);
    else await NavidromePlay.undismiss(album.id);
    return digitalLibraryService.getAlbum(navidromeId);
  },

  /** The files of an album, each with how often it was played lately: why the album is to buy. */
  getTracks: async (navidromeId: string): Promise<DigitalTrack[]> => {
    const bySong = playsBySong(await listenHistoryService.recent(LISTEN_WINDOW_DAYS));
    const files = await navidromeService.getAlbumSongs(navidromeId);
    return files.map(file => {
      const plays = (file.id ? bySong.get(file.id) || [] : []).reduce((sum, day) => sum + day.plays, 0);
      return {
        id: file.id,
        url: file.url,
        discNumber: file.discNumber,
        track: file.track,
        title: file.title,
        durationSec: file.durationSec,
        suffix: file.suffix,
        bitRate: file.bitRate,
        bitDepth: file.bitDepth,
        samplingRate: file.samplingRate,
        plays,
        // Never fewer than the window's: the history notes plays Navidrome may not have counted yet.
        totalPlays: Math.max(file.playCount ?? 0, plays),
        lastPlayed: file.played ?? null,
        rating: file.userRating ?? 0,
        starred: Boolean(file.starred),
      };
    }).sort((a, b) => a.discNumber - b.discNumber || a.track - b.track);
  },
};

export default digitalLibraryService;
