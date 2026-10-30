
import Album from '../models/album';
import Track from '../models/track';
import ShelfItem from '../models/shelfItem';
import { getDatabase } from '../database';
import { normalizeAlbumOwnership } from './utils/albumOwnership';
import musicbrainzService from './musicbrainzService';
import discogsService from './discogsService';
import communityRatingService from './communityRatingService';
import trackPopularityService, { popularTracks } from './trackPopularityService';
import TrackPopularity from '../models/trackPopularity';
import type { FormattedRelease } from './musicbrainzService';
import imageService from './imageService';
import axios, { AxiosResponse } from 'axios';
import logger from '../logger';
import musicCollectionService from './musicCollectionService';
import path from 'path';
import type { AlbumFormatted, AlbumCreateData, TrackFormatted, TrackPerformer } from '../types';
import coverScanService from './coverScanService';
import type { SleeveTranscription } from './coverScanService';
import { toMusicFormDraft, type MusicFormDraft } from './sleeveDraft';

/**
 * How long an add waits for the cover before answering anyway. Long enough that
 * a healthy Cover Art Archive hands the artwork back with the new album, short
 * enough that a sick one barely delays the save.
 */
const COVER_GRACE_MS = 2000;

/**
 * Hosts we will fetch cover art from. The client picks which artwork to use and
 * sends us its URL, so without this the server would download and then serve
 * any address it was handed -- including the local network or a cloud metadata
 * endpoint.
 */
const TRUSTED_COVER_HOSTS = ['coverartarchive.org', 'archive.org', 'discogs.com', 'dzcdn.net', 'mzstatic.com'];

export const isTrustedCoverUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  return TRUSTED_COVER_HOSTS.some(trusted => host === trusted || host.endsWith(`.${trusted}`));
};

/**
 * Downloads a cover into the CD images, resized to 1200 px at most; null when
 * the download fails, so the caller can try another source.
 */
export const downloadCover = async (url: string, key: string, type: string): Promise<string | null> => {
  if (!url) return null;
  try {
    const filename = `album_${key}_${type}_${Date.now()}.jpg`;
    const pathUrl = await imageService.downloadImageFromUrl(url, 'cd', filename);
    if (pathUrl) {
      try {
        const downloadedFilename = pathUrl.split('/').pop()!;
        const fullPath = path.join(imageService.getLocalImagesDir(), 'cd', downloadedFilename);
        await imageService.resizeImage(fullPath, fullPath, 1200, 1200);
      } catch (resizeError: unknown) {
        const err = resizeError as { message: string };
        console.warn(`Failed to resize ${type} cover art:`, err.message);
      }
    }
    return pathUrl;
  } catch (error: unknown) {
    const err = error as { message: string };
    console.warn(`Failed to download ${type} cover art from url ${url}:`, err.message);
    return null;
  }
};

const runStatement = (sql: string): Promise<void> =>
  new Promise((resolve, reject) => {
    getDatabase().run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
  });

interface AlbumData {
  title?: string;
  artist?: string[];
  releaseYear?: number | null;
  cover?: string | null;
  backCover?: string | null;
  labels?: string[];
  genres?: string[];
  barcode?: string | null;
  catalogNumber?: string | null;
  country?: string | null;
  discs?: DiscData[];
  ownership?: {
    condition?: string | null;
    purchasedAt?: string | null;
    priceChf?: number | null;
    notes?: string | null;
  };
  coverArtData?: {
    frontCoverUrl?: string;
    backCoverUrl?: string;
  };
  urls?: Record<string, string>;
  isrcCodes?: string[];
  [key: string]: unknown;
}

/** A track as the album page shows it, with its credits when MusicBrainz gave them. */
interface AlbumTrack {
  no: number;
  title: string;
  durationSec: number | null;
  isrc: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzTrackId: string | null;
  toc: string | null;
  artist: string[];
  work: string | null;
  composers: string[];
  performers: TrackPerformer[];
  /** One of the few tracks listened to much more than the rest, on ListenBrainz or Deezer. */
  popular?: boolean;
}

interface DiscData {
  number: number;
  tracks: TrackData[];
}

interface TrackData {
  trackNumber?: number;
  no?: number;
  title: string;
  durationSec?: number | null;
  isrc?: string | null;
  musicbrainzRecordingId?: string | null;
  musicbrainzTrackId?: string | null;
  toc?: string | null;
  artist?: string[];
  work?: string | null;
  composers?: string[];
  performers?: TrackPerformer[];
}

interface DataQualityResult {
  score: number;
  maxScore: number;
  details: Record<string, boolean>;
}

interface AppleMusicResult {
  url: string;
  cached: boolean;
}

interface AutocompleteRow {
  [key: string]: string | number | null;
}

interface ITunesResponse {
  results?: Array<{
    collectionId?: number;
    collectionViewUrl?: string;
    trackViewUrl?: string;
    artistName?: string;
    collectionName?: string;
    collectionType?: string;
    trackCount?: number;
    releaseDate?: string;
  }>;
}

class MusicService {
  async initializeTables(): Promise<void> {
    try {
      await Album.createTable();
      await Track.createTable();
      console.log('Music tables initialized successfully');
    } catch (error) {
      console.error('Error initializing music tables:', error);
      throw error;
    }
  }

  async searchAlbums(query: string, options: { withNoCd?: boolean } = {}): Promise<AlbumFormatted[]> {
    try {
      return await Album.search(query, options);
    } catch (error) {
      console.error('Error searching albums:', error);
      throw error;
    }
  }

  async getAllAlbums(): Promise<AlbumFormatted[]> {
    try {
      return await Album.findAll();
    } catch (error) {
      console.error('Error getting all albums:', error);
      throw error;
    }
  }

  async getAlbumsByStatus(status: string): Promise<AlbumFormatted[]> {
    try {
      return await Album.findByStatus(status);
    } catch (error) {
      console.error('Error getting albums by status:', error);
      throw error;
    }
  }

  async updateAlbumStatus(id: number, status: string): Promise<{ id: number; title_status: string }> {
    try {
      const result = await Album.updateStatus(id, status);
      // A wish come true: at the end of Listen Next.
      if (status === 'owned') await musicCollectionService.addNewCd(id).catch(() => false);
      return result;
    } catch (error) {
      console.error('Error updating album status:', error);
      throw error;
    }
  }

  async getAlbumById(id: number): Promise<AlbumFormatted & { discs: Array<{ number: number; tracks: AlbumTrack[] }> }> {
    try {
      const album = await Album.findById(id);
      if (!album) {
        throw new Error('Album not found');
      }

      // Get tracks for this CD
      console.log(`Fetching tracks for album ID: ${id}`);
      const tracks = await Track.findByCdId(id);
      console.log(`Found ${tracks.length} tracks`);
      const popular = popularTracks(await TrackPopularity.findByAlbum(id), tracks.length);

      // Group tracks by disc
      const discs: Record<number, TrackFormatted[]> = {};
      tracks.forEach(track => {
        if (!discs[track.discNumber]) {
          discs[track.discNumber] = [];
        }
        discs[track.discNumber].push(track);
      });

      // Convert to array format
      const discsArray = Object.keys(discs).map(discNumber => ({
        number: parseInt(discNumber),
        tracks: discs[parseInt(discNumber)].map(track => ({
          no: track.trackNumber,
          title: track.title,
          durationSec: track.durationSec,
          isrc: track.isrc,
          musicbrainzRecordingId: track.musicbrainzRecordingId,
          musicbrainzTrackId: track.musicbrainzTrackId,
          toc: track.toc,
          artist: track.artist,
          work: track.work,
          composers: track.composers,
          performers: track.performers,
          ...(popular.has(`${track.discNumber}-${track.trackNumber}`) ? { popular: true } : {})
        }))
      }));

      return {
        ...album,
        discs: discsArray
      };
    } catch (error) {
      console.error('Error getting album:', error);
      throw error;
    }
  }

  async addAlbum(albumData: AlbumData): Promise<AlbumFormatted> {
    // The album row and its tracks must land together: a failing track used to
    // leave a coverless, trackless album behind, which then made every retry
    // fail with "Album already exists in collection".
    await runStatement('BEGIN IMMEDIATE');

    try {
      // Create the album
      let album = await Album.create(albumData as unknown as AlbumCreateData) as unknown as AlbumFormatted;

      // Ensure covers are persisted even if model mapping missed them
      const needsFrontPersist = albumData.cover && (!album.cover || album.cover.trim() === '');
      const needsBackPersist = albumData.backCover && (!album.backCover || album.backCover.trim() === '');
      if (needsFrontPersist) {
        try {
          await Album.updateFrontCover(album.id, albumData.cover!);
        } catch (e: unknown) {
          const err = e as { message: string };
          console.warn(`Failed to persist front cover for album ${album.id}:`, err.message);
        }
      }
      if (needsBackPersist) {
        try {
          await Album.updateBackCover(album.id, albumData.backCover!);
        } catch (e: unknown) {
          const err = e as { message: string };
          console.warn(`Failed to persist back cover for album ${album.id}:`, err.message);
        }
      }
      if (needsFrontPersist || needsBackPersist) {
        album = (await Album.findById(album.id))!;
      }

      // Add tracks if provided
      if (albumData.discs && albumData.discs.length > 0) {
        console.log(`Adding ${albumData.discs.length} disc(s) with tracks for album ID: ${album.id}`);
        for (const disc of albumData.discs) {
          console.log(`  Disc ${disc.number}: ${disc.tracks?.length || 0} tracks`);
          for (const track of disc.tracks) {
            try {
              await Track.create({
                albumId: album.id,
                discNumber: disc.number,
                trackNumber: track.trackNumber ?? track.no ?? 0,
                title: track.title,
                durationSec: track.durationSec,
                isrc: track.isrc,
                musicbrainzRecordingId: track.musicbrainzRecordingId,
                musicbrainzTrackId: track.musicbrainzTrackId,
                toc: track.toc,
                artist: track.artist,
                work: track.work,
                composers: track.composers,
                performers: track.performers
              });
            } catch (trackError) {
              console.error(`Failed to create track ${track.trackNumber || track.no}:`, trackError);
              throw trackError;
            }
          }
        }
        console.log(`Successfully added tracks for album ID: ${album.id}`);
      } else {
        console.log('No tracks to add for this album');
      }

      await runStatement('COMMIT');
      // A CD come in: at the end of Listen Next.
      if ((album.titleStatus ?? 'owned') === 'owned') {
        await musicCollectionService.addNewCd(album.id).catch(error =>
          logger.warn(`Album ${album.id} added but not put in Listen Next: ${(error as Error).message}`));
      }
      return album;
    } catch (error) {
      await runStatement('ROLLBACK').catch((rollbackError) => {
        logger.error('Failed to roll back album insert:', rollbackError);
      });
      console.error('Error adding album:', error);
      throw error;
    }
  }

  async updateAlbum(id: number, albumData: AlbumData): Promise<AlbumFormatted> {
    try {
      // Update the album
      const album = await Album.update(id, albumData as unknown as AlbumCreateData) as unknown as AlbumFormatted;

      // Update tracks if provided
      if (albumData.discs && albumData.discs.length > 0) {
        // The form sends back every field of the tracks it loaded, an emptied
        // one as null or [], and that is the edit. A client that leaves a field
        // out (a script, an older page) keeps what the track at that position
        // had, rather than wiping its ISRC, MusicBrainz ids, TOC and credits.
        const existingTracks = await Track.findByCdId(id);
        const existingByPosition = new Map<string, typeof existingTracks[number]>();
        existingTracks.forEach(track => {
          existingByPosition.set(`${track.discNumber}:${track.trackNumber}`, track);
        });

        console.log(`Deleting existing tracks for album ID: ${id}`);
        await Track.deleteByCdId(id);

        console.log(`Adding ${albumData.discs.length} disc(s) with tracks for album ID: ${id}`);
        for (const disc of albumData.discs) {
          console.log(`  Disc ${disc.number}: ${disc.tracks?.length || 0} tracks`);
          for (const track of disc.tracks) {
            try {
              const trackNumber = track.trackNumber ?? track.no ?? 0;
              const previous = existingByPosition.get(`${disc.number}:${trackNumber}`);
              const given = <K extends keyof TrackData>(key: K) => track[key] !== undefined;

              await Track.create({
                albumId: id,
                discNumber: disc.number,
                trackNumber,
                title: track.title,
                durationSec: given('durationSec') ? track.durationSec : previous?.durationSec,
                isrc: (given('isrc') ? track.isrc : previous?.isrc) || null,
                musicbrainzRecordingId:
                  (given('musicbrainzRecordingId') ? track.musicbrainzRecordingId : previous?.musicbrainzRecordingId) || null,
                musicbrainzTrackId:
                  (given('musicbrainzTrackId') ? track.musicbrainzTrackId : previous?.musicbrainzTrackId) || null,
                toc: (given('toc') ? track.toc : previous?.toc) || null,
                artist: given('artist') ? track.artist : previous?.artist,
                work: (given('work') ? track.work : previous?.work) || null,
                composers: given('composers') ? track.composers : previous?.composers,
                performers: given('performers') ? track.performers : previous?.performers
              });
            } catch (trackError) {
              console.error(`Failed to create track ${track.trackNumber || track.no}:`, trackError);
              throw trackError;
            }
          }
        }
        console.log(`Successfully updated tracks for album ID: ${id}`);
      }

      return album;
    } catch (error) {
      console.error('Error updating album:', error);
      throw error;
    }
  }

  async deleteAlbum(id: number): Promise<{ deleted: boolean }> {
    try {
      const result = await Album.delete(id);
      return result;
    } catch (error) {
      console.error('Error deleting album:', error);
      throw error;
    }
  }

  // Resolve and cache Apple Music album URL
  async getAppleMusicUrl(albumId: number): Promise<AppleMusicResult> {
    try {
      const album = await Album.findById(albumId);
      if (!album) {
        throw new Error('Album not found');
      }

      // If cached URL exists, return it
      if (album.urls && album.urls.appleMusic) {
        logger.info(`[AppleMusic] Using cached URL for album ${albumId}: ${album.urls.appleMusic}`);
        return { url: album.urls.appleMusic, cached: true };
      }

      // If any existing URL looks like Apple Music/iTunes, use and cache it
      if (album.urls && typeof album.urls === 'object') {
        const values = Object.values(album.urls);
        const existingApple = values.find(u => typeof u === 'string' && /\b(music\.apple\.com|itunes\.apple\.com)\b/.test(u));
        if (existingApple) {
          logger.info(`[AppleMusic] Found existing Apple URL in urls for album ${albumId}: ${existingApple}`);
          try {
            await Album.updateUrls(albumId, { appleMusic: existingApple });
          } catch (_) { /* non-fatal */ }
          return { url: existingApple, cached: true };
        }
      }

      // Build normalized helpers
      const artistText = Array.isArray(album.artist) ? album.artist.join(' ') : (album.artist || '');
      const titleText = album.title || '';
      const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const wantArtist = norm(artistText);
      const wantTitle = norm(titleText);

      const countries = ['CH', 'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'PT'];

      let expectedTrackCount: number | null = null;
      try {
        const tracksForCount = await Track.findByCdId(albumId);
        expectedTrackCount = Array.isArray(tracksForCount) ? tracksForCount.length : null;
      } catch (_) { /* ignore */ }

      logger.info(`[AppleMusic] Resolving URL for album ${albumId}: title="${titleText}", artist="${artistText}", barcode=${album.barcode || '-'} isrcs_in_album=${Array.isArray(album.isrcCodes) ? album.isrcCodes.length : 0}`);

      // 1) Try UPC/EAN (barcode) exact lookup
      if (album.barcode) {
        for (const country of countries) {
          try {
            const resp: AxiosResponse<ITunesResponse> = await axios.get('https://itunes.apple.com/lookup', {
              params: { upc: album.barcode, entity: 'album', country },
              timeout: 8000
            });
            const items = resp.data?.results || [];
            logger.debug(`[AppleMusic] UPC lookup country=${country} results=${items.length}`);
            const found = items.find(it => it.collectionViewUrl);
            if (found && found.collectionViewUrl) {
              const url = found.collectionViewUrl;
              logger.info(`[AppleMusic] UPC match for album ${albumId} in ${country}: ${url}`);
              try { await Album.updateUrls(albumId, { appleMusic: url }); } catch (_) { /* non-fatal */ }
              return { url, cached: true };
            }
          } catch (_) {
            // try next country
          }
        }
      }

      // 2) Try ISRC-based lookup
      let isrcList: string[] = Array.isArray(album.isrcCodes) ? album.isrcCodes.filter(Boolean) : [];
      if (!isrcList || isrcList.length === 0) {
        try {
          const tracks = await Track.findByCdId(albumId);
          isrcList = Array.from(new Set(tracks.map(t => t.isrc).filter(Boolean))) as string[];
        } catch (_) { /* ignore */ }
      }
      if (isrcList && isrcList.length > 0) {
        const collectionVotes = new Map<number, { count: number; url: string | undefined }>();
        for (const isrc of isrcList.slice(0, 8)) {
          for (const country of countries) {
            try {
              const resp: AxiosResponse<ITunesResponse> = await axios.get('https://itunes.apple.com/lookup', {
                params: { isrc, country },
                timeout: 8000
              });
              const items = resp.data?.results || [];
              logger.debug(`[AppleMusic] ISRC lookup isrc=${isrc} country=${country} results=${items.length}`);
              items.forEach(it => {
                if (it.collectionId && (it.collectionViewUrl || it.trackViewUrl)) {
                  const prev = collectionVotes.get(it.collectionId) || { count: 0, url: it.collectionViewUrl };
                  collectionVotes.set(it.collectionId, { count: prev.count + 1, url: prev.url || it.collectionViewUrl });
                }
              });
            } catch (_) {
              // try next
            }
          }
        }
        if (collectionVotes.size > 0) {
          const majority = Array.from(collectionVotes.entries()).sort((a, b) => b[1].count - a[1].count)[0];
          const collectionId = majority[0];
          logger.info(`[AppleMusic] ISRC majority collectionId=${collectionId} votes=${majority[1].count}`);
          for (const country of countries) {
            try {
              const resp: AxiosResponse<ITunesResponse> = await axios.get('https://itunes.apple.com/lookup', {
                params: { id: collectionId, entity: 'album', country },
                timeout: 8000
              });
              const item = (resp.data?.results || []).find(r => r.collectionViewUrl);
              if (item && item.collectionViewUrl) {
                const url = item.collectionViewUrl;
                logger.info(`[AppleMusic] Resolved album by collectionId in ${country}: ${url}`);
                try { await Album.updateUrls(albumId, { appleMusic: url }); } catch (_) { /* non-fatal */ }
                return { url, cached: true };
              }
            } catch (_) { /* ignore */ }
          }
        }
      }

      // Two-pass strategy: precise album title first, then broader search
      async function searchItunes(params: Record<string, string | number>): Promise<ITunesResponse['results']> {
        try {
          const resp: AxiosResponse<ITunesResponse> = await axios.get(`https://itunes.apple.com/search`, { params, timeout: 8000 });
          return resp.data?.results || [];
        } catch (_) {
          return [];
        }
      }

      const scoreItem = (it: NonNullable<ITunesResponse['results']>[number]): number => {
        const a = norm(it.artistName || '');
        const t = norm(it.collectionName || '');
        let score = 0;
        if (it.collectionType === 'Album' || it.collectionType === 'Compilation') score += 2;
        if (t === wantTitle) score += 3;
        if (a === wantArtist) score += 3;
        if (wantArtist && a.includes(wantArtist)) score += 2;
        if (wantTitle) {
          const words = wantTitle.split(' ').filter(Boolean);
          if (t.includes(wantTitle) || words.every(w => t.includes(w))) score += 2;
        }
        const isLikelySingle = /\b(single|ep)\b/i.test(it.collectionName || '');
        const titleSaysSingle = /\b(single|ep)\b/i.test(titleText || '');
        if (isLikelySingle && !titleSaysSingle) score -= 3;
        if (typeof it.trackCount === 'number') {
          if (it.trackCount >= 6) score += 1;
          if (it.trackCount <= 2 && !titleSaysSingle) score -= 1;
          if (expectedTrackCount && Math.abs(it.trackCount - expectedTrackCount) <= 2) score += 2;
        }
        if (album!.releaseYear && it.releaseDate) {
          const y = new Date(it.releaseDate).getFullYear();
          if (Math.abs(y - (album!.releaseYear as number)) <= 1) score += 1;
        }
        const wantBest = /\b(best|greatest)\b/.test(wantTitle);
        const hasBest = /\b(best|greatest)\b/.test(t);
        if (wantBest && hasBest) score += 2;
        if (wantBest && !hasBest) score -= 1;
        return score;
      };

      let result: string | null = null;
      for (const country of countries) {
        const pass1 = await searchItunes({
          term: titleText,
          media: 'music',
          entity: 'album',
          attribute: 'albumTerm',
          limit: 10,
          country
        });
        let candidates = (pass1 || []).filter(Boolean);
        logger.debug(`[AppleMusic] Country ${country} pass1 candidates=${candidates.length}`);
        if (wantArtist) {
          candidates = candidates.filter(it => norm(it.artistName || '').includes(wantArtist));
        }
        if (candidates.length === 0) {
          const pass2 = await searchItunes({
            term: `${artistText} ${titleText}`.trim(),
            media: 'music',
            entity: 'album',
            limit: 10,
            country
          });
          candidates = (pass2 || []).filter(Boolean);
          logger.debug(`[AppleMusic] Country ${country} pass2 candidates=${candidates.length}`);
        }
        if (candidates.length > 0) {
          const isSingleOrEp = (name: string | undefined): boolean => /\b(single|ep)\b/i.test(name || '');
          let pool = candidates;
          const nonSingles = candidates.filter(c => !isSingleOrEp(c.collectionName));
          const albumLength = nonSingles.filter(c => typeof c.trackCount === 'number' ? c.trackCount >= 8 : true);
          if (albumLength.length > 0) pool = albumLength;
          else if (nonSingles.length > 0) pool = nonSingles;

          const exact = pool.filter(c => norm(c.collectionName || '') === wantTitle);
          const starts = exact.length === 0 ? pool.filter(c => norm(c.collectionName || '').startsWith(wantTitle)) : exact;
          const finalPool = (starts.length > 0 ? starts : pool);

          const best = finalPool
            .map(it => ({ it, score: scoreItem(it) }))
            .sort((x, y) => y.score - x.score)[0];
          if (best && best.score > 0) {
            result = best.it.collectionViewUrl || null;
            logger.info(`[AppleMusic] Selected in ${country}: name="${best.it.collectionName}", type=${best.it.collectionType}, tracks=${best.it.trackCount}, score=${best.score}, url=${result}`);
            if (result) break;
          }
        }
      }

      // Normalize result to universal Apple Music URL
      const normalizeToMusicHost = (u: string): string => {
        try {
          const parsed = new URL(u);
          if (parsed.hostname.includes('itunes.apple.com')) {
            parsed.hostname = 'music.apple.com';
            return parsed.toString();
          }
          return u;
        } catch {
          return u;
        }
      };

      if (result) {
        result = normalizeToMusicHost(result);
      }

      // Fallback to Apple Music search URL
      const fallbackTerm = `${artistText} ${titleText}`.trim();
      const fallback = `https://music.apple.com/search?term=${encodeURIComponent(fallbackTerm)}`;
      if (!result) {
        logger.warn(`[AppleMusic] Falling back to search for album ${albumId} term="${fallbackTerm}"`);
      }
      const finalUrl = result || fallback;

      // Cache only if concrete album URL
      if (result) {
        try {
          await Album.updateUrls(albumId, { appleMusic: finalUrl });
        } catch (e: unknown) {
          const err = e as { message: string };
          console.warn('Failed to cache appleMusic URL:', err.message);
        }
      }

      return { url: finalUrl, cached: !!result };
    } catch (error) {
      console.error('Error resolving Apple Music URL:', error);
      throw error;
    }
  }

  // Calculate data quality score for an album
  calculateDataQuality(album: AlbumFormatted & { discs?: Array<{ number: number; tracks?: Array<{ no: number; title: string; durationSec: number | null }> }> }): DataQualityResult {
    let score = 0;
    let maxScore = 0;

    // Basic information (40 points)
    maxScore += 40;
    if (album.title) score += 10;
    if (album.artist && album.artist.length > 0) score += 10;
    if (album.releaseYear) score += 10;
    if (album.cover) score += 10;

    // Detailed metadata (30 points)
    maxScore += 30;
    if (album.labels && album.labels.length > 0) score += 5;
    if (album.genres && album.genres.length > 0) score += 5;
    if (album.barcode) score += 5;
    if (album.catalogNumber) score += 5;
    if (album.country) score += 5;

    // Track information (20 points)
    maxScore += 20;
    if (album.discs && album.discs.length > 0) {
      score += 10;
      const totalTracks = album.discs.reduce((sum, disc) => sum + (disc.tracks?.length || 0), 0);
      if (totalTracks > 0) score += 10;
    }

    // Ownership information (10 points)
    maxScore += 10;
    if (album.ownership?.condition) score += 3;
    if (album.ownership?.purchasedAt) score += 3;
    if (album.ownership?.priceChf) score += 2;
    if (album.ownership?.notes) score += 2;

    return {
      score: Math.round((score / maxScore) * 100),
      maxScore,
      details: {
        hasTitle: !!album.title,
        hasArtist: !!(album.artist && album.artist.length > 0),
        hasYear: !!album.releaseYear,
        hasCover: !!album.cover,
        hasLabels: !!(album.labels && album.labels.length > 0),
        hasGenres: !!(album.genres && album.genres.length > 0),
        hasBarcode: !!album.barcode,
        hasCatalogNumber: !!album.catalogNumber,
        hasCountry: !!album.country,
        hasTracks: !!(album.discs && album.discs.length > 0 && album.discs.some(disc => disc.tracks && disc.tracks.length > 0)),
        hasOwnership: !!(album.ownership?.condition || album.ownership?.purchasedAt || album.ownership?.priceChf || album.ownership?.notes)
      }
    };
  }

  async searchMusicBrainz(query: string): Promise<FormattedRelease[]> {
    try {
      const isArtistOnlyQuery = typeof query === 'string' && query.trim().toLowerCase().startsWith('artist:') && !query.includes(' AND ');
      const limit = isArtistOnlyQuery ? 400 : 10;
      const releases = await musicbrainzService.searchRelease(query, limit);
      const formatted = releases.map(release => musicbrainzService.formatReleaseData(release));
      console.log(`Searched MusicBrainz (fast mode): ${formatted.length} releases`);
      return formatted;
    } catch (error) {
      console.error('Error searching MusicBrainz:', error);
      throw error;
    }
  }

  async getMusicBrainzReleaseDetails(releaseId: string): Promise<FormattedRelease> {
    try {
      const release = await musicbrainzService.getReleaseDetails(releaseId);
      return musicbrainzService.formatReleaseData(release);
    } catch (error) {
      console.error('Error getting MusicBrainz release details:', error);
      throw error;
    }
  }
  /**
   * Download the cover art for a stored album and attach it afterwards.
   *
   * Runs after the album row exists, on purpose: the downloads used to happen
   * before the first INSERT, so up to ~35s of MusicBrainz + Cover Art Archive
   * timeouts stood between the user and a saved record -- and a slow CAA made
   * saving impossible even though every piece of metadata was already in hand.
   */
  async attachCoverArt(
    albumId: number,
    releaseId: string,
    additionalData: AlbumData = {},
    source: 'musicbrainz' | 'discogs' = 'musicbrainz'
  ): Promise<void> {
    const downloadAndResizeCover = (url: string, type: string) => downloadCover(url, releaseId, type);

    // Client-supplied urls are untrusted; archive urls we looked up ourselves
    // below are not filtered again.
    const fromClient = (value: string | undefined): string | null => {
      if (!value) return null;
      if (isTrustedCoverUrl(value)) return value;
      logger.warn(`Refusing cover art url from an untrusted host: ${value}`);
      return null;
    };

    // Each source is only asked for the sides still missing once the previous
    // ones were downloaded: an image that is listed but fails to download (a
    // Cover Art Archive thumbnail timing out on archive.org) must not stop the
    // next source from being tried, or the album stays without a front.
    let frontPath: string | null = null;
    let backPath: string | null = null;
    const download = async (frontUrl: string | null | undefined, backUrl: string | null | undefined): Promise<void> => {
      const [front, back] = await Promise.all([
        !frontPath && frontUrl ? downloadAndResizeCover(frontUrl, 'front') : Promise.resolve(null),
        !backPath && backUrl ? downloadAndResizeCover(backUrl, 'back') : Promise.resolve(null)
      ]);
      frontPath = frontPath || front;
      backPath = backPath || back;
    };

    await download(
      fromClient(additionalData?.coverArtData?.frontCoverUrl),
      fromClient(additionalData?.coverArtData?.backCoverUrl)
    );

    // Cover Art Archive is keyed on MusicBrainz ids: asking it about a Discogs
    // release just returns 400, so only try it on the MusicBrainz path.
    if (source === 'musicbrainz' && (!frontPath || !backPath)) {
      const coverArt = await musicbrainzService.getCoverArt(releaseId);
      await download(coverArt?.front?.url, coverArt?.back?.url);

      // An edition is often catalogued without any image while its release group
      // has one, the way a Discogs pressing falls back on its master. Only the
      // front: another edition's back cover would list the wrong tracks.
      const album = !frontPath || !backPath ? await Album.findById(albumId) : null;
      if (!frontPath && album?.musicbrainzReleaseGroupId) {
        const groupArt = await musicbrainzService.getReleaseGroupCoverArt(album.musicbrainzReleaseGroupId);
        await download(groupArt?.front?.url, null);
      }

      // Cover Art Archive is often down or has no image typed as the front,
      // while the Discogs release MusicBrainz links to has both sides. It is the
      // same edition, so its back cover lists the right tracks.
      const discogsId = album?.urls?.discogs?.match(/discogs\.com\/release\/(\d+)/)?.[1];
      if ((!frontPath || !backPath) && discogsId && discogsService.isConfigured()) {
        try {
          const formatted = discogsService.formatRelease(await discogsService.getRelease(discogsId));
          await download(formatted.coverArt.front, formatted.coverArt.back);
          if (!frontPath) await download(await discogsService.getMasterCoverArt(formatted.masterId), null);
        } catch (error) {
          logger.warn(`Could not read Discogs release ${discogsId} for cover art: ${(error as Error).message}`);
        }
      }
    }

    if (frontPath) await Album.updateFrontCover(albumId, frontPath);
    if (backPath) await Album.updateBackCover(albumId, backPath);
  }

  /**
   * Move a wish-list row into the collection.
   *
   * The stored row carries an empty nested `ownership`, which would win over the
   * flat fields the form posts, so merge them explicitly: what the user just
   * entered takes precedence, the rest is kept.
   */
  private async promoteFromWishList(existing: AlbumFormatted, additionalData: AlbumData): Promise<AlbumFormatted> {
    logger.info(`Promoting album ${existing.id} from the wish list to the collection`);
    await Album.updateStatus(existing.id, 'owned');

    const incoming = normalizeAlbumOwnership(additionalData);
    const ownership = {
      condition: incoming.condition ?? existing.ownership?.condition ?? null,
      notes: incoming.notes ?? existing.ownership?.notes ?? null,
      purchasedAt: incoming.purchasedAt ?? existing.ownership?.purchasedAt ?? new Date().toISOString().slice(0, 10),
      priceChf: incoming.priceChf ?? existing.ownership?.priceChf ?? null
    };

    await Album.update(existing.id, {
      ...(existing as unknown as AlbumCreateData),
      ...(additionalData as unknown as AlbumCreateData),
      ownership,
      titleStatus: 'owned'
    });

    return (await Album.findById(existing.id))!;
  }

  /**
   * Add an album from Discogs, the primary source for physical pressings.
   *
   * Mirrors addAlbumFromMusicBrainz: duplicate check first so a repeat attempt
   * leaves no orphan files, then the album and its tracks in one transaction,
   * then the cover art with the same short head start.
   */
  async addAlbumFromDiscogs(releaseId: string, additionalData: AlbumData = {}): Promise<AlbumFormatted> {
    try {
      const existing = await Album.findByDiscogsId(String(releaseId));
      if (existing) {
        const wantsOwned = (additionalData.titleStatus as string | undefined) !== 'wish';

        // Buying something off the wish list is the normal case, not a conflict.
        if (existing.titleStatus === 'wish' && wantsOwned) {
          return this.promoteFromWishList(existing, additionalData);
        }

        throw new Error('Album already exists in collection');
      }

      const raw = await discogsService.getRelease(releaseId);
      const formatted = discogsService.formatRelease(raw);

      const albumData: AlbumData = {
        ...(formatted as unknown as AlbumData),
        ...additionalData
      };

      // Second, late check: narrows the window where two concurrent requests
      // (a double tap) both pass the guard above and the unique index turns the
      // second insert into an opaque 500 instead of a duplicate response.
      if (await Album.findByDiscogsId(String(releaseId))) {
        throw new Error('Album already exists in collection');
      }

      const album = await this.addAlbum(albumData);

      // The communities' votes, which the release lookups above do not count.
      communityRatingService.refreshAlbum(album.id).catch((error: unknown) => {
        logger.warn(`Could not read the community ratings of album ${album.id}: ${(error as Error).message}`);
      });
      trackPopularityService.refreshAlbum(album.id).catch((error: unknown) => {
        logger.warn(`Could not read the track popularity of album ${album.id}: ${(error as Error).message}`);
      });

      const clientFront = additionalData.coverArtData?.frontCoverUrl;
      const coverWork = (async () => {
        // Individual pressings are often catalogued without any image; the master
        // that groups them usually has one. Looked up inside the cover work so a
        // slow Discogs cannot hold up the add past the grace period below.
        let frontUrl = clientFront || formatted.coverArt.front || undefined;
        if (!frontUrl) {
          frontUrl = (await discogsService.getMasterCoverArt(formatted.masterId)) || undefined;
        }

        return this.attachCoverArt(album.id, String(releaseId), {
          ...additionalData,
          coverArtData: {
            frontCoverUrl: frontUrl,
            backCoverUrl: additionalData.coverArtData?.backCoverUrl || formatted.coverArt.back || undefined
          }
        }, 'discogs');
      })().catch((error: unknown) => {
        const err = error as { message: string };
        logger.error(`Failed to attach cover art for album ${album.id}: ${err.message}`);
      });

      const grace = new Promise<void>(resolve => setTimeout(resolve, COVER_GRACE_MS));
      await Promise.race([coverWork, grace]);

      return (await Album.findById(album.id)) || album;
    } catch (error) {
      console.error('Error adding album from Discogs:', error);
      throw error;
    }
  }

  async addAlbumFromMusicBrainz(releaseId: string, additionalData: AlbumData = {}): Promise<AlbumFormatted> {
    try {
      // Checked before anything is fetched or written to disk, so a duplicate
      // attempt leaves no orphan files behind.
      const existing = await Album.findByMusicbrainzId(releaseId);
      if (existing) {
        const wantsOwned = (additionalData.titleStatus as string | undefined) !== 'wish';

        // Buying something off the wish list is the normal case, not a conflict:
        // promote the row in place instead of refusing the add.
        if (existing.titleStatus === 'wish' && wantsOwned) {
          const promoted = await this.promoteFromWishList(existing, additionalData);

          this.attachCoverArt(existing.id, releaseId, additionalData).catch((error: unknown) => {
            const err = error as { message: string };
            logger.error(`Failed to attach cover art for album ${existing.id}: ${err.message}`);
          });

          return promoted;
        }

        throw new Error('Album already exists in collection');
      }

      const releaseData = await musicbrainzService.getReleaseDetails(releaseId);
      const formattedData = musicbrainzService.formatReleaseData(releaseData);

      const albumData: AlbumData = {
        ...(formattedData as unknown as AlbumData),
        ...additionalData
      };

      // Second, late check: narrows the window where two concurrent requests
      // (a double tap) both pass the guard above.
      const existingAlbum = await Album.findByMusicbrainzId(releaseId);
      if (existingAlbum) {
        throw new Error('Album already exists in collection');
      }

      const album = await this.addAlbum(albumData);

      // The release already includes its artist's filing name. Keep it now,
      // rather than leaving a new CD under its first name until the next sync.
      const credit = releaseData['artist-credit']?.[0];
      const creditedName = credit?.name || credit?.artist?.name;
      if (credit?.artist?.['sort-name'] && album.artist[0] === creditedName) {
        await ShelfItem.saveArtistSort(album.id, credit.artist['sort-name'], credit.artist.type || null);
      }

      // The communities' votes, which the release lookups above do not count.
      communityRatingService.refreshAlbum(album.id).catch((error: unknown) => {
        logger.warn(`Could not read the community ratings of album ${album.id}: ${(error as Error).message}`);
      });
      trackPopularityService.refreshAlbum(album.id).catch((error: unknown) => {
        logger.warn(`Could not read the track popularity of album ${album.id}: ${(error as Error).message}`);
      });

      // The record is already safe, so cover art can no longer block the add.
      // We still give it a short head start: when Cover Art Archive is healthy
      // the artwork comes back with the new album instead of popping in later.
      const coverWork = this.attachCoverArt(album.id, releaseId, additionalData).catch((error: unknown) => {
        const err = error as { message: string };
        logger.error(`Failed to attach cover art for album ${album.id}: ${err.message}`);
      });

      const grace = new Promise<void>(resolve => setTimeout(resolve, COVER_GRACE_MS));
      await Promise.race([coverWork, grace]);

      return (await Album.findById(album.id)) || album;
    } catch (error) {
      console.error('Error adding album from MusicBrainz:', error);
      throw error;
    }
  }

  async addAlbumByBarcode(barcode: string, additionalData: AlbumData = {}): Promise<AlbumFormatted> {
    try {
      const releases = await musicbrainzService.getReleaseByBarcode(barcode);

      if (releases.length === 0) {
        throw new Error('No release found for this barcode');
      }

      const releaseId = releases[0].id;
      return await this.addAlbumFromMusicBrainz(releaseId, additionalData);
    } catch (error) {
      console.error('Error adding album by barcode:', error);
      throw error;
    }
  }

  async searchByCatalogNumber(catalogNumber: string): Promise<FormattedRelease[]> {
    try {
      const releases = await musicbrainzService.getReleaseByCatalogNumber(catalogNumber);
      return releases.map(release => musicbrainzService.formatReleaseData(release));
    } catch (error) {
      console.error('Error searching by catalog number:', error);
      throw error;
    }
  }

  async searchByBarcode(barcode: string): Promise<FormattedRelease[]> {
    try {
      const releases = await musicbrainzService.getReleaseByBarcode(barcode);
      return releases.map(release => musicbrainzService.formatReleaseData(release));
    } catch (error) {
      console.error('Error searching by barcode:', error);
      throw error;
    }
  }

  /**
   * Get autocomplete suggestions for a given field
   */
  async getAutocompleteSuggestions(field: string, value: string, withNoCd = false): Promise<AutocompleteRow[]> {
    const allowedFields = ['title', 'artist', 'genre', 'mood', 'track', 'label', 'country', 'year', 'composer', 'performer', 'conductor', 'instrument', 'work'];
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field: ${field}`);
    }

    try {
      const rows = await Album.autocomplete(field, value, withNoCd);
      return rows;
    } catch (error) {
      console.error('Error getting autocomplete suggestions:', error);
      throw error;
    }
  }
  /**
   * Read a sleeve from photographs and hand back a draft for the form.
   *
   * The two photographs are read independently and in parallel, so a failure
   * on one side still fills the form from the other -- the point of the
   * feature is to save typing, and half a sleeve saves half of it.
   *
   * The back wins every field it read. A front is artwork: the title is
   * stylised, sometimes absent altogether, and on a classical sleeve it names
   * the composer where the back names the performer. The front only fills what
   * the back left blank.
   */
  async transcribeSleeve(input: {
    front?: { image: string; mimeType?: string };
    back?: { image: string; mimeType?: string };
  }): Promise<{
    draft: MusicFormDraft;
    sources: { front: 'ok' | 'failed' | 'absent'; back: 'ok' | 'failed' | 'absent' };
    truncated: boolean;
  }> {
    const read = (
      side: 'front' | 'back',
      photo: { image: string; mimeType?: string } | undefined
    ): Promise<SleeveTranscription | null> => {
      if (!photo?.image) return Promise.resolve(null);
      const fn = side === 'back' ? coverScanService.transcribeSleeveBack : coverScanService.transcribeSleeveFront;
      return fn(photo.image, photo.mimeType || 'image/jpeg');
    };

    const [frontResult, backResult] = await Promise.allSettled([
      read('front', input.front),
      read('back', input.back)
    ]);

    const settled = (r: PromiseSettledResult<SleeveTranscription | null>, supplied: boolean) => {
      if (!supplied) return { value: null, state: 'absent' as const };
      if (r.status === 'fulfilled') return { value: r.value, state: 'ok' as const };
      logger.warn(`Sleeve transcription failed: ${(r.reason as Error)?.message}`);
      return { value: null, state: 'failed' as const, error: r.reason as Error };
    };

    const front = settled(frontResult, Boolean(input.front?.image));
    const back = settled(backResult, Boolean(input.back?.image));

    if (!front.value && !back.value) {
      // Surface the underlying message: the controller reads it to tell an
      // unreachable model from an unreadable photograph.
      throw (front as { error?: Error }).error
        || (back as { error?: Error }).error
        || new Error('Could not read anything from the sleeve');
    }

    const b = back.value;
    const f = front.value;
    const pick = <T>(fromBack: T | null | undefined, fromFront: T | null | undefined, empty: T): T => {
      const hasBack = Array.isArray(fromBack) ? fromBack.length > 0 : Boolean(fromBack);
      if (hasBack) return fromBack as T;
      const hasFront = Array.isArray(fromFront) ? fromFront.length > 0 : Boolean(fromFront);
      return hasFront ? (fromFront as T) : empty;
    };

    const merged: SleeveTranscription = {
      title: pick(b?.title, f?.title, null),
      artist: pick(b?.artist, f?.artist, [] as string[]),
      label: b?.label || [],
      catalogNumber: b?.catalogNumber || null,
      barcode: b?.barcode || null,
      year: b?.year ?? null,
      country: b?.country || null,
      format: pick(b?.format, f?.format, null),
      genres: b?.genres || [],
      tracks: b?.tracks || [],
      truncated: Boolean(b?.truncated)
    };

    return {
      draft: toMusicFormDraft(merged),
      sources: { front: front.state, back: back.state },
      truncated: merged.truncated
    };
  }

}

export default new MusicService();
