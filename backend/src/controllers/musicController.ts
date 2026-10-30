
import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import favouriteAlbumService from '../services/favouriteAlbumService';
import musicService from '../services/musicService';
import imageService from '../services/imageService';
import musicbrainzService from '../services/musicbrainzService';
import coverScanService from '../services/coverScanService';
import discogsService from '../services/discogsService';
import Album from '../models/album';
import musicCollectionService, { parseEntryKey } from '../services/musicCollectionService';
import smartPlaylistService, { classicalChoiceOf } from '../services/smartPlaylistService';
import musicbrainzLinkService from '../services/musicbrainzLinkService';
import musicbrainzRefreshService from '../services/musicbrainzRefreshService';
import ripStatusService from '../services/ripStatusService';
import digitalLibraryService from '../services/digitalLibraryService';
import digitalAlbumService from '../services/digitalAlbumService';
import listenNextPlayService from '../services/listenNextPlayService';
import listenNextPlaylistService from '../services/listenNextPlaylistService';
import albumPurchaseService, { PurchaseError } from '../services/albumPurchaseService';
import navidromeService from '../services/navidromeService';
import albumRatingService from '../services/albumRatingService';
import communityRatingService from '../services/communityRatingService';
import trackPopularityService from '../services/trackPopularityService';
import searchCoverService from '../services/searchCoverService';
import albumCoverService from '../services/albumCoverService';
import AlbumNote from '../models/albumNote';
import albumOverlapService from '../services/albumOverlapService';
import logger from '../logger';

/**
 * Errors raised while normalizing user input (an unsupported condition, a price
 * that is not a number) carry status 400: they are the caller's fault, and used
 * to surface as an opaque 500.
 */
const isClientError = (error: unknown): boolean =>
  (error as { status?: number })?.status === 400;

// Configure multer for cover uploads
const storage = multer.diskStorage({
  destination: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const customCoverDir = path.join(imageService.getLocalImagesDir(), 'cd', 'custom');
    // Ensure directory exists
    if (!fs.existsSync(customCoverDir)) {
      fs.mkdirSync(customCoverDir, { recursive: true });
    }
    cb(null, customCoverDir);
  },
  filename: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const cdId = (req as Request).params.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `cd_${cdId}_${timestamp}${ext}`);
  }
});

const coverUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept images only
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

const musicController = {
  // Get all albums
  getAllAlbums: async (req: Request, res: Response): Promise<void> => {
    try {
      const albums = await musicService.getAllAlbums();
      res.json(albums);
    } catch (error) {
      console.error('Error getting all albums:', error);
      res.status(500).json({ error: 'Failed to get albums' });
    }
  },

  // Get albums by status (owned, wish, or digital: the albums of Navidrome with no CD)
  getAlbumsByStatus: async (req: Request, res: Response): Promise<void> => {
    try {
      const status = req.params.status as string;
      if (!['owned', 'wish', 'digital'].includes(status)) {
        res.status(400).json({ error: 'Status must be "owned", "wish" or "digital"' });
        return;
      }

      const albums = await musicService.getAlbumsByStatus(status);
      res.json(albums);
    } catch (error) {
      console.error('Error getting albums by status:', error);
      res.status(500).json({ error: 'Failed to get albums by status' });
    }
  },

  /** "I bought the CD": a digital or wished album becomes a CD of the collection, the same album. */
  markAlbumBought: async (req: Request, res: Response): Promise<void> => {
    try {
      const album = await albumPurchaseService.markBought(parseInt(req.params.id as string, 10), req.body || {});
      res.json(album);
    } catch (error) {
      const status = error instanceof PurchaseError ? error.status : (error as { status?: number }).status ?? 500;
      if (status === 500) logger.error('Error marking an album bought:', error);
      res.status(status).json({ error: (error as Error).message });
    }
  },

  /** The digital and wished albums a CD about to be added would be, to add it to one of them instead. */
  findAttachableAlbums: async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await albumPurchaseService.attachable(req.body || {}));
    } catch (error) {
      logger.error('Error finding albums to attach a CD to:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Update album status
  updateAlbumStatus: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { status } = req.body;

      if (!['owned', 'wish'].includes(status)) {
        res.status(400).json({ error: 'Status must be "owned" or "wish"' });
        return;
      }

      const result = await musicService.updateAlbumStatus(id, status);
      res.json(result);
    } catch (error) {
      console.error('Error updating album status:', error);
      res.status(500).json({ error: 'Failed to update album status' });
    }
  },

  // Get album by ID
  getAlbumById: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const album = await musicService.getAlbumById(id);
      res.json(album);
    } catch (error) {
      console.error('Error getting album by ID:', error);
      if ((error as Error).message === 'Album not found') {
        res.status(404).json({ error: 'Album not found' });
      } else {
        res.status(500).json({ error: 'Failed to get album' });
      }
    }
  },

  // Add new album
  addAlbum: async (req: Request, res: Response): Promise<void> => {
    try {
      const albumData = req.body;
      console.log('=== ADD ALBUM REQUEST ===');
      console.log('Has discs:', !!albumData.discs);
      console.log('Discs length:', albumData.discs?.length);
      if (albumData.discs && albumData.discs.length > 0) {
        albumData.discs.forEach((disc: Record<string, unknown>, idx: number) => {
          console.log(`  Disc ${idx + 1}: ${(disc.tracks as Array<unknown>)?.length || 0} tracks`);
        });
      }
      const album = await musicService.addAlbum(albumData);
      res.status(201).json(album);
    } catch (error) {
      console.error('Error adding album:', error);
      if (isClientError(error)) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      res.status(500).json({ error: 'Failed to add album' });
    }
  },

  // Update album
  updateAlbum: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const albumData = req.body;
      const album = await musicService.updateAlbum(id, albumData);
      res.json(album);
    } catch (error) {
      console.error('Error updating album:', error);
      res.status(500).json({ error: 'Failed to update album' });
    }
  },

  // Delete album
  deleteAlbum: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await musicService.deleteAlbum(id);
      if (result.deleted) {
        res.json({ message: 'Album deleted successfully' });
      } else {
        res.status(404).json({ error: 'Album not found' });
      }
    } catch (error) {
      console.error('Error deleting album:', error);
      res.status(500).json({ error: 'Failed to delete album' });
    }
  },

  // Search albums
  searchAlbums: async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Search query is required' });
        return;
      }

      // digital=1: MusicDex with Digital on, the albums with no CD found too; mixtapes=1: the mixtapes alone.
      const albums = await favouriteAlbumService.search(q as string, { withNoCd: req.query.digital === '1', mixtapes: req.query.mixtapes === '1' });
      res.json(albums);
    } catch (error) {
      console.error('Error searching albums:', error);
      res.status(500).json({ error: 'Failed to search albums' });
    }
  },

  // Search MusicBrainz
  searchMusicBrainz: async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Search query is required' });
        return;
      }

      const releases = await musicService.searchMusicBrainz(q as string);
      res.json(releases);
    } catch (error) {
      console.error('Error searching MusicBrainz:', error);
      res.status(500).json({ error: 'Failed to search MusicBrainz' });
    }
  },

  // Get cover art metadata for a specific MusicBrainz release (front/back URLs + thumbnails)
  getCoverArt: async (req: Request, res: Response): Promise<void> => {
    try {
      const releaseId = req.params.releaseId as string;
      if (!releaseId) {
        res.status(400).json({ error: 'releaseId is required' });
        return;
      }
      const coverArt = await musicbrainzService.getCoverArt(releaseId);
      res.json(coverArt || {});
    } catch (error) {
      console.error('Error getting cover art:', error);
      res.status(500).json({ error: 'Failed to get cover art' });
    }
  },

  /** The covers to try for an album found by a search, best first: { urls }. */
  getSearchCovers: async (req: Request, res: Response): Promise<void> => {
    try {
      const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
      const urls = await searchCoverService.coversOf(text(req.query.releaseGroupId) || null, text(req.query.artist), text(req.query.title));
      res.json({ urls });
    } catch (error) {
      logger.error('Error finding the covers of a search result:', error);
      res.status(500).json({ error: 'Failed to find covers' });
    }
  },

  // Get MusicBrainz release details
  getMusicBrainzReleaseDetails: async (req: Request, res: Response): Promise<void> => {
    try {
      const releaseId = req.params.releaseId as string;
      const release = await musicService.getMusicBrainzReleaseDetails(releaseId);
      res.json(release);
    } catch (error) {
      console.error('Error getting MusicBrainz release details:', error);
      res.status(500).json({ error: 'Failed to get release details' });
    }
  },

  // Add album from MusicBrainz
  /**
   * Identify an album from a photo of its sleeve.
   *
   * Deliberately does NOT call coverScanService.checkHealth() first: that extra
   * round trip only adds latency on the happy path, and an unreachable model is
   * already distinguishable from the analysis error.
   */
  scanCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const { image, mimeType } = req.body || {};

      if (!image) {
        res.status(400).json({ error: 'Image data is required' });
        return;
      }

      let llmResult: { artist: string | null; title: string; year: number | null; format: string | null };
      try {
        llmResult = await coverScanService.analyzeAlbumImage(image, mimeType || 'image/jpeg');
      } catch (error) {
        const message = (error as Error).message || '';
        const unreachable = /network error|no response received|econnrefused|enotfound|timed? ?out|HTTP 5\d\d/i.test(message);
        logger.error('Album cover analysis failed:', message);
        if (unreachable) {
          res.status(503).json({ error: 'Cover scan service is not available', details: message });
        } else {
          res.status(422).json({ error: 'Could not identify album from cover image', details: message });
        }
        return;
      }

      logger.info(
        `Cover scan read: artist="${llmResult.artist || ''}" title="${llmResult.title}" year=${llmResult.year || '?'}`
      );

      // Discogs first: it is the reference for physical pressings and has been
      // far more available than MusicBrainz, which stays as the fallback.
      let candidates: Array<Record<string, unknown>> = [];
      let source: 'discogs' | 'musicbrainz' = 'discogs';

      // We are holding a physical disc, so digital-only editions are noise.
      // Applied to each database's answer before the fallback decision below:
      // an all-digital Discogs answer has to count as no answer at all.
      const physicalOnly = (list: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
        list.filter(r => !/digital|file/i.test(String(r.format || '')));

      if (discogsService.isConfigured()) {
        try {
          // Compilations are credited to "Various" on Discogs, so searching the
          // literal "Various Artists" the model reads off the sleeve finds nothing.
          const isCompilation = /^various(\s+artists)?$/i.test((llmResult.artist || '').trim());
          const searchArtist = isCompilation ? null : llmResult.artist;

          let hits = await discogsService.search({
            artist: searchArtist,
            title: llmResult.title
          });

          // A stylised or mis-read artist name should widen the search, not send
          // us straight to the fallback database.
          if (hits.length === 0 && searchArtist) {
            logger.info('Discogs: no hit for artist+title, retrying on title alone');
            hits = await discogsService.search({ artist: null, title: llmResult.title });
          }

          // Last resort on Discogs: its general query is more forgiving than the
          // structured fields when a performer is filed differently.
          if (hits.length === 0) {
            // searchArtist, not llmResult.artist: putting "Various Artists" back
            // in the query is exactly what the compilation branch above avoids.
            const freeText = [searchArtist, llmResult.title].filter(Boolean).join(' ');
            logger.info(`Discogs: still nothing, trying free text "${freeText}"`);
            hits = await discogsService.searchFreeText(freeText);
          }

          logger.info(`Discogs returned ${hits.length} hit(s)`);

          // The search payload is thin; fetch the full release for the ones we
          // will actually show, capped to keep the round trips bounded.
          const detailed = await Promise.all(
            hits.slice(0, 8).map(async hit => {
              try {
                return discogsService.formatRelease(await discogsService.getRelease(hit.id));
              } catch (_) {
                return null;
              }
            })
          );
          candidates = physicalOnly(detailed.filter(Boolean) as unknown as Array<Record<string, unknown>>);
        } catch (discogsError) {
          logger.warn(`Discogs lookup failed, falling back to MusicBrainz: ${(discogsError as Error).message}`);
          candidates = [];
        }
      } else {
        logger.info('Discogs has no token configured, going straight to MusicBrainz');
      }

      if (candidates.length === 0) {
        logger.info('Falling back to MusicBrainz');
        source = 'musicbrainz';

        // Quoting the terms keeps Lucene from choking on titles like "AC/DC" or
        // "Live: 1975"; only the quote and backslash still need escaping.
        const quote = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;
        const terms = [`release:${quote(llmResult.title)}`];
        if (llmResult.artist) {
          terms.push(`artist:${quote(llmResult.artist)}`);
        }

        // Reading the cover is the expensive, hard part and it already succeeded.
        // If the lookup fails too, hand back what the model read anyway.
        let rawReleases;
        try {
          rawReleases = await musicbrainzService.searchRelease(terms.join(' AND '), 25);

          if (rawReleases.length === 0 && llmResult.artist) {
            rawReleases = await musicbrainzService.searchRelease(`release:${quote(llmResult.title)}`, 25);
          }
        } catch (searchError) {
          const message = (searchError as Error).message || 'MusicBrainz lookup failed';
          logger.warn(`Album lookup failed after a successful scan: ${message}`);
          res.json({
            llm_result: llmResult,
            results: [],
            confidence: 'low',
            search_failed: true,
            source: 'musicbrainz',
            error: message
          });
          return;
        }

        candidates = physicalOnly(rawReleases.map(raw =>
          musicbrainzService.formatReleaseData(raw)
        ) as unknown as Array<Record<string, unknown>>);
      }

      const ranked = coverScanService.rankAlbumResults(candidates, llmResult);
      const confidence = coverScanService.getConfidence(ranked as never);

      // A generic id and source let the client add from either database.
      const withSource = ranked.map(r => ({
        ...r,
        source,
        releaseId: String(r.discogsReleaseId || r.musicbrainzReleaseId || '')
      }));

      logger.info(`Cover scan answered from ${source}: ${withSource.length} candidate(s), confidence=${confidence}`);

      res.json({
        llm_result: llmResult,
        results: withSource,
        confidence,
        source
      });
    } catch (error) {
      logger.error('Error scanning album cover:', error);
      res.status(500).json({ error: 'Failed to scan album cover' });
    }
  },

  /**
   * Add a release from whichever database it was found in.
   *
   * The client no longer has to know which service a result came from: each
   * search result carries `source` and `releaseId`, and posts them straight back.
   */
  addAlbumFromSource: async (req: Request, res: Response): Promise<void> => {
    const source = String(req.params.source || '').toLowerCase();
    const releaseId = String(req.params.releaseId || '');

    try {
      const additionalData = req.body || {};
      let album;

      if (source === 'discogs') {
        album = await musicService.addAlbumFromDiscogs(releaseId, additionalData);
      } else if (source === 'musicbrainz') {
        album = await musicService.addAlbumFromMusicBrainz(releaseId, additionalData);
      } else {
        res.status(400).json({ error: `Unknown source "${source}". Expected discogs or musicbrainz.` });
        return;
      }

      res.status(201).json(album);
    } catch (error) {
      logger.error(`Error adding album from ${source}:`, error);

      // Two taps close enough together both clear the service's duplicate checks
      // and the unique index on the release id catches the second one. That is
      // still a duplicate, not a server failure.
      const isDuplicateRelease =
        (error as { code?: string }).code === 'SQLITE_CONSTRAINT' &&
        /release_id/.test((error as Error).message || '');

      if ((error as Error).message === 'Album already exists in collection' || isDuplicateRelease) {
        res.status(409).json({ error: 'Album already exists in collection', code: 'DUPLICATE_ALBUM' });
      } else if (isClientError(error)) {
        res.status(400).json({ error: (error as Error).message });
      } else {
        res.status(500).json({ error: `Failed to add album from ${source}` });
      }
    }
  },

  addAlbumFromMusicBrainz: async (req: Request, res: Response): Promise<void> => {
    try {
      const releaseId = req.params.releaseId as string;
      const additionalData = req.body || {};

      const album = await musicService.addAlbumFromMusicBrainz(releaseId, additionalData);
      res.status(201).json(album);
    } catch (error) {
      console.error('Error adding album from MusicBrainz:', error);
      if ((error as Error).message === 'Album already exists in collection') {
        res.status(409).json({ error: 'Album already exists in collection', code: 'DUPLICATE_ALBUM' });
      } else if (isClientError(error)) {
        res.status(400).json({ error: (error as Error).message });
      } else {
        res.status(500).json({ error: 'Failed to add album from MusicBrainz' });
      }
    }
  },

  // Add album by barcode
  addAlbumByBarcode: async (req: Request, res: Response): Promise<void> => {
    try {
      const barcode = req.params.barcode as string;
      const additionalData = req.body || {};

      const album = await musicService.addAlbumByBarcode(barcode, additionalData);
      res.status(201).json(album);
    } catch (error) {
      console.error('Error adding album by barcode:', error);
      if ((error as Error).message === 'No release found for this barcode') {
        res.status(404).json({ error: 'No release found for this barcode' });
      } else {
        res.status(500).json({ error: 'Failed to add album by barcode' });
      }
    }
  },

  searchByCatalogNumber: async (req: Request, res: Response): Promise<void> => {
    try {
      const { catalogNumber } = req.query;

      if (!catalogNumber) {
        res.status(400).json({ error: 'Catalog number is required' });
        return;
      }

      const releases = await musicService.searchByCatalogNumber(catalogNumber as string);
      res.json(releases);
    } catch (error) {
      console.error('Error searching by catalog number:', error);
      res.status(500).json({ error: 'Failed to search by catalog number' });
    }
  },

  searchByBarcode: async (req: Request, res: Response): Promise<void> => {
    try {
      const { barcode } = req.query;

      if (!barcode) {
        res.status(400).json({ error: 'Barcode is required' });
        return;
      }

      const releases = await musicService.searchByBarcode(barcode as string);
      res.json(releases);
    } catch (error) {
      console.error('Error searching by barcode:', error);
      res.status(500).json({ error: 'Failed to search by barcode' });
    }
  },

  // Get or resolve Apple Music URL for an album
  /**
   * Links every album that lacks its MusicBrainz edition or release group:
   * those added from Discogs or by hand. Slow on purpose, MusicBrainz allows
   * one request a second.
   */
  linkMusicBrainz: async (_req: Request, res: Response): Promise<void> => {
    try {
      const results = await musicbrainzLinkService.linkAll();
      res.json({
        linked: results.filter(r => r.releaseGroupId).length,
        releasesLinked: results.filter(r => r.releaseId).length,
        results,
      });
    } catch (error) {
      logger.error('Error linking albums to MusicBrainz:', error);
      res.status(500).json({ error: 'Failed to link albums to MusicBrainz' });
    }
  },

  /** Tracks and credits from the album's MusicBrainz edition; see musicbrainzRefreshService. */
  refreshFromMusicBrainz: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      res.json(await musicbrainzRefreshService.refreshAlbum(id));
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Album not found') {
        res.status(404).json({ error: message });
      } else if (message === 'Album has no MusicBrainz edition') {
        res.status(409).json({ error: message });
      } else {
        logger.error('Error refreshing album from MusicBrainz:', error);
        res.status(500).json({ error: 'Failed to refresh album from MusicBrainz' });
      }
    }
  },

  /** Rereads MusicBrainz's and Discogs's community ratings of one album. */
  refreshCommunityRating: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      await communityRatingService.refreshAlbum(id);
      res.json(await Album.findById(id));
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Album not found') {
        res.status(404).json({ error: message });
      } else {
        logger.error('Error refreshing community ratings:', error);
        res.status(500).json({ error: 'Failed to refresh the community ratings' });
      }
    }
  },

  /** Rereads on ListenBrainz and Deezer how much each track of the album is listened to. */
  refreshTrackPopularity: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      res.json(await trackPopularityService.refreshAlbum(id));
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'Album not found') {
        res.status(404).json({ error: message });
      } else {
        logger.error('Error reading track popularity:', error);
        res.status(500).json({ error: 'Failed to read the track popularity' });
      }
    }
  },

  /** Every album's community ratings, in the background: a few seconds an album for Discogs's rate limit. */
  refreshAllCommunityRatings: async (_req: Request, res: Response): Promise<void> => {
    communityRatingService.refreshAll().catch(error => logger.error('Error refreshing all community ratings:', error));
    res.status(202).json({ started: true });
  },

  /** Every album with an edition, or only the ids given in the body. Slow: one request a second. */
  refreshAllFromMusicBrainz: async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(Number.isInteger) : undefined;
      const results = await musicbrainzRefreshService.refreshAll(ids);
      res.json({
        refreshed: results.filter(r => !r.error).length,
        tracksReplaced: results.filter(r => r.tracksReplaced).length,
        results,
      });
    } catch (error) {
      logger.error('Error refreshing albums from MusicBrainz:', error);
      res.status(500).json({ error: 'Failed to refresh albums from MusicBrainz' });
    }
  },

  /** Every album of Navidrome, the quality of its files, its CD and whether to buy it; refresh rereads the library. */
  getDigitalLibrary: async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.query.refresh) ripStatusService.clearCache();
      res.json(await digitalLibraryService.getLibrary());
    } catch (error) {
      logger.error('Error reading the digital library:', error);
      res.status(500).json({ error: 'Failed to read the digital library' });
    }
  },

  /**
   * Rereads Navidrome, which notes the plays since, takes from the rips the
   * editions Picard identified the CDs as, and answers with the library that follows.
   */
  syncDigitalLibrary: async (_req: Request, res: Response): Promise<void> => {
    try {
      ripStatusService.clearCache();
      // Navidrome out of reach must not hide the collection: getLibrary reports it.
      const editions = await ripStatusService.adoptEditions().catch(error => {
        logger.warn(`Could not take editions from the rips: ${(error as Error).message}`);
        return [];
      });
      // After the editions: a rip of a CD DexVault did not know is that CD, not a digital album.
      await digitalAlbumService.reconcile().catch(error =>
        logger.warn(`Digital albums not brought in step with Navidrome: ${(error as Error).message}`));
      // CDs ripped since have songs to give the playlist now.
      listenNextPlaylistService.schedule();
      res.json({ editions, library: await digitalLibraryService.getLibrary() });
    } catch (error) {
      logger.error('Error syncing the digital library:', error);
      res.status(500).json({ error: 'Failed to sync the digital library' });
    }
  },

  /** Puts an album with no CD on the wish list (PUT) or takes it off (DELETE). */
  setDigitalWished: async (req: Request, res: Response): Promise<void> => {
    try {
      if (!navidromeService.isConfigured()) {
        res.status(409).json({ error: 'Navidrome is not configured' });
        return;
      }
      const album = await digitalLibraryService.setWished(req.params.navidromeId as string, req.method === 'PUT');
      if (!album) {
        res.status(404).json({ error: 'This album is not in Navidrome' });
        return;
      }
      res.json(album);
    } catch (error) {
      logger.error('Error changing the wish list from a digital album:', error);
      res.status(500).json({ error: 'Failed to change the wish list' });
    }
  },

  /** Sets an album aside from the Buy tab as "Not interested" (PUT), or brings it back (DELETE). */
  setDigitalDismissed: async (req: Request, res: Response): Promise<void> => {
    try {
      if (!navidromeService.isConfigured()) {
        res.status(409).json({ error: 'Navidrome is not configured' });
        return;
      }
      const album = await digitalLibraryService.setDismissed(req.params.navidromeId as string, req.method === 'PUT');
      if (!album) {
        res.status(404).json({ error: 'This album is not in Navidrome' });
        return;
      }
      res.json(album);
    } catch (error) {
      logger.error('Error dismissing a digital album:', error);
      res.status(500).json({ error: 'Failed to change the album' });
    }
  },

  /** The tracks of a Navidrome album with their plays of the last 90 days. */
  getDigitalTracks: async (req: Request, res: Response): Promise<void> => {
    try {
      if (!navidromeService.isConfigured()) {
        res.status(409).json({ error: 'Navidrome is not configured' });
        return;
      }
      res.json({ tracks: await digitalLibraryService.getTracks(req.params.navidromeId as string) });
    } catch (error) {
      logger.error('Error reading the tracks of a digital album:', error);
      res.status(500).json({ error: 'Failed to read the tracks' });
    }
  },

  /** The cover Navidrome shows for one of its albums, for the albums DexVault has no record of. */
  getNavidromeCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const { data, contentType } = await navidromeService.getCoverArt(req.params.navidromeId as string);
      res.set('Cache-Control', 'public, max-age=86400').type(contentType).send(data);
    } catch {
      res.status(404).end();
    }
  },

  /** The covers an album can take for one side, ?side=front|back: { candidates }. */
  getCoverCandidates: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const side = req.query.side === 'back' ? 'back' : 'front';
      const candidates = await albumCoverService.candidates(id, side);
      if (!candidates) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.json({ candidates });
    } catch (error) {
      logger.error('Error finding covers for an album:', error);
      res.status(500).json({ error: 'Failed to find covers' });
    }
  },

  /** Makes one of those covers a side of the album, { side, url }: { coverPath }. */
  useCoverCandidate: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { side, url } = req.body || {};
      if ((side !== 'front' && side !== 'back') || typeof url !== 'string') {
        res.status(400).json({ error: 'side (front or back) and url are required' });
        return;
      }
      const coverPath = await albumCoverService.useCover(id, side, url);
      logger.info(`Album ${id} takes its ${side} cover from ${url}`);
      res.json({ coverPath });
    } catch (error) {
      const status = (error as { status?: number }).status || 500;
      if (status === 500) logger.error('Error setting a cover chosen for an album:', error);
      res.status(status).json({ error: (error as Error).message || 'Failed to set the cover' });
    }
  },

  /**
   * Takes the cover Navidrome shows for this CD as its DexVault cover: a photo
   * of one's own, dropped on the album in Picard, comes back this way. Only
   * ever on request; the synchronisation with the rips never writes a cover.
   */
  importNavidromeCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (!navidromeService.isConfigured()) {
        res.status(409).json({ error: 'Navidrome is not configured' });
        return;
      }
      const navidromeAlbum = await ripStatusService.navidromeAlbumFor(id);
      if (!navidromeAlbum) {
        res.status(404).json({ error: 'This CD is not in Navidrome' });
        return;
      }
      const { data } = await navidromeService.getCoverArt(navidromeAlbum.id);
      const filename = `navidrome_${id}_${Date.now()}.jpg`;
      const coverPath = await imageService.saveImage(data, 'cd/custom', filename);
      try {
        const fullPath = imageService.getLocalImagePath('cd/custom', filename);
        await imageService.resizeImage(fullPath, fullPath, 1000, 1000);
      } catch (error) {
        logger.warn('Failed to resize the cover taken from Navidrome:', (error as Error).message);
      }
      await Album.updateFrontCover(id, coverPath);
      logger.info(`Album ${id} takes its cover from Navidrome album ${navidromeAlbum.id}`);
      res.json({ success: true, coverPath });
    } catch (error) {
      logger.error('Error importing the cover from Navidrome:', error);
      res.status(502).json({ error: (error as Error).message || 'Failed to import the cover from Navidrome' });
    }
  },

  /**
   * The files of this CD's rip in Navidrome, for the track panel. A CD not
   * ripped yet, or Navidrome not set up, is an answer, not an error.
   */
  getNavidromeTracks: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (!navidromeService.isConfigured()) {
        res.json({ configured: false, found: false, tracks: [] });
        return;
      }
      const navidromeAlbum = await ripStatusService.navidromeAlbumFor(id);
      if (!navidromeAlbum) {
        res.json({ configured: true, found: false, tracks: [] });
        return;
      }
      const tracks = await navidromeService.getAlbumSongs(navidromeAlbum.id);
      res.json({ configured: true, found: true, album: { id: navidromeAlbum.id, name: navidromeAlbum.name, url: navidromeService.albumUrl(navidromeAlbum.id) }, tracks });
    } catch (error) {
      logger.error('Error reading the rip from Navidrome:', error);
      res.status(502).json({ error: (error as Error).message || 'Failed to read the rip from Navidrome' });
    }
  },

  /** The owner's stars on a CD, 0 to take them away; given in Navidrome too. */
  setUserRating: async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    const rating = Number(req.body?.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      res.status(400).json({ error: 'rating must be between 0 and 5' });
      return;
    }
    try {
      if (!await Album.findById(id)) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.json(await albumRatingService.setRating(id, rating));
    } catch (error) {
      logger.error('Error rating an album:', error);
      res.status(500).json({ error: 'Failed to rate the album' });
    }
  },

  /** Takes the stars given in Navidrome since, as an album's dialog opens. */
  syncUserRating: async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ userRating: await albumRatingService.syncAlbum(parseInt(req.params.id as string, 10)) });
    } catch (error) {
      res.status(502).json({ error: (error as Error).message || 'Failed to read the stars in Navidrome' });
    }
  },

  /** How the collection's stars spread: how many albums at each half, for the dial to say where a rating stands. */
  getRatingCounts: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ counts: await Album.countRatings() });
    } catch (error) {
      logger.error('Error counting the stars:', error);
      res.status(500).json({ error: 'Failed to count the stars' });
    }
  },

  syncAllUserRatings: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await albumRatingService.syncAll());
    } catch (error) {
      res.status(502).json({ error: (error as Error).message || 'Failed to sync the stars with Navidrome' });
    }
  },

  /** The other albums of the collection holding some of this album's tracks, the most first. */
  getAlbumOverlaps: async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await albumOverlapService.overlaps(parseInt(req.params.id as string, 10)));
    } catch (error) {
      logger.error('Error reading the albums sharing tracks:', error);
      res.status(500).json({ error: 'Failed to read the albums sharing tracks' });
    }
  },

  getAlbumNotes: async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await AlbumNote.findByAlbumId(parseInt(req.params.id as string, 10)));
    } catch (error) {
      logger.error('Error reading listening notes:', error);
      res.status(500).json({ error: 'Failed to read the notes' });
    }
  },

  createAlbumNote: async (req: Request, res: Response): Promise<void> => {
    const albumId = parseInt(req.params.id as string, 10);
    const note = String(req.body?.note || '').trim();
    const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
    if (!note) {
      res.status(400).json({ error: 'A note needs some text' });
      return;
    }
    try {
      if (!await Album.findById(albumId)) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }
      res.status(201).json(await AlbumNote.create(albumId, note, date));
    } catch (error) {
      logger.error('Error adding a listening note:', error);
      res.status(500).json({ error: 'Failed to add the note' });
    }
  },

  updateAlbumNote: async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    const note = String(req.body?.note || '').trim();
    if (!note) {
      res.status(400).json({ error: 'A note needs some text' });
      return;
    }
    try {
      const existing = await AlbumNote.findById(id);
      if (!existing) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json(await AlbumNote.update(id, note, String(req.body?.date || existing.date)));
    } catch (error) {
      logger.error('Error editing a listening note:', error);
      res.status(500).json({ error: 'Failed to edit the note' });
    }
  },

  deleteAlbumNote: async (req: Request, res: Response): Promise<void> => {
    try {
      const deleted = await AlbumNote.delete(parseInt(req.params.id as string, 10));
      if (!deleted) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (error) {
      logger.error('Error deleting a listening note:', error);
      res.status(500).json({ error: 'Failed to delete the note' });
    }
  },

  getAppleMusicUrl: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await musicService.getAppleMusicUrl(id);
      res.json(result);
    } catch (error) {
      console.error('Error getting Apple Music URL:', error);
      res.status(500).json({ error: 'Failed to resolve Apple Music URL' });
    }
  },

  /**
   * Read a sleeve from photographs and hand back a draft for the form.
   *
   * Nothing is stored: the answer is a proposal the user reviews and submits,
   * or discards. Deliberately does not identify the release -- the records
   * this serves are the ones no database knows.
   */
  transcribeSleeve: async (req: Request, res: Response): Promise<void> => {
    try {
      const { front, back } = req.body || {};

      if (!front?.image && !back?.image) {
        res.status(400).json({ error: 'At least one image is required (front or back)' });
        return;
      }

      const result = await musicService.transcribeSleeve({ front, back });

      logger.info(
        `Sleeve transcribed: front=${result.sources.front} back=${result.sources.back} ` +
        `discs=${result.draft.discs.length} tracks=${result.draft.discs.reduce((n, d) => n + d.tracks.length, 0)}` +
        (result.truncated ? ' (track list cut short)' : '')
      );

      res.json(result);
    } catch (error) {
      const message = (error as Error).message || '';
      // Same taxonomy as scanCover: a model we could not reach is a 503, a
      // sleeve we could not read is a 422.
      const unreachable = /network error|no response received|econnrefused|enotfound|timed? ?out|HTTP 5\d\d/i.test(message);
      logger.error('Sleeve transcription failed:', message);

      if (unreachable) {
        res.status(503).json({ error: 'Cover scan service is not available', details: message });
      } else {
        res.status(422).json({ error: 'Could not read the sleeve', details: message });
      }
    }
  },

  // Get autocomplete suggestions
  getAutocompleteSuggestions: async (req: Request, res: Response): Promise<void> => {
    try {
      const { field, value } = req.query;

      if (!field) {
        res.status(400).json({ error: 'Field parameter is required' });
        return;
      }

      const suggestions = await musicService.getAutocompleteSuggestions(field as string, (value as string) || '', req.query.digital === '1');
      res.json(suggestions);
    } catch (error) {
      // An unknown field is the caller's mistake, not a server failure.
      if (/^Invalid field/.test((error as Error).message)) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      console.error('Error getting autocomplete suggestions:', error);
      res.status(500).json({ error: 'Failed to get autocomplete suggestions' });
    }
  },

  // Upload custom cover for a CD
  uploadCustomCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const file = req.file as Express.Multer.File | undefined;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      logger.info(`Uploading custom cover for CD ${id}: ${file.filename}`);

      // Resize the image to max 1000x1000
      let width = 500;
      let height = 500;

      try {
        await imageService.resizeImage(file.path, file.path, 1000, 1000);

        // Get updated dimensions after resize
        const sharp = require('sharp');
        const metadata = await sharp(file.path).metadata();
        width = metadata.width;
        height = metadata.height;
        logger.info(`Cover resized to ${width}x${height}`);
      } catch (error) {
        // If resize fails, log but continue
        logger.warn('Failed to resize cover image:', (error as Error).message);
      }

      // Construct the cover path using API endpoint
      const coverPath = `/api/images/cd/custom/${file.filename}`;

      // Update only the cover field without affecting other data
      const db = require('../database').getDatabase();
      await new Promise<void>((resolve, reject) => {
        const sql = 'UPDATE albums SET cover = ? WHERE id = ?';
        db.run(sql, [coverPath, id], function(this: { changes: number }, err: Error | null) {
          if (err) {
            logger.error(`Failed to update cover for album ${id}:`, err);
            reject(err);
          } else {
            logger.info(`Updated album ${id} with custom cover: ${coverPath}`);
            resolve();
          }
        });
      });

      res.json({
        success: true,
        coverPath: coverPath,
        filename: file.filename,
        width,
        height
      });
    } catch (error) {
      logger.error('Error uploading custom cover:', error);
      res.status(500).json({ error: 'Failed to upload custom cover' });
    }
  },

  uploadCustomBackCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const file = req.file as Express.Multer.File | undefined;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      logger.info(`Uploading custom back cover for CD ${id}: ${file.filename}`);

      // Resize the image to max 1200x1200
      let width = 500;
      let height = 500;

      try {
        await imageService.resizeImage(file.path, file.path, 1200, 1200);

        // Get updated dimensions after resize
        const sharp = require('sharp');
        const metadata = await sharp(file.path).metadata();
        width = metadata.width;
        height = metadata.height;
        logger.info(`Back cover resized to ${width}x${height}`);
      } catch (error) {
        // If resize fails, log but continue
        logger.warn('Failed to resize back cover image:', (error as Error).message);
      }

      // Construct the back cover path using API endpoint
      const backCoverPath = `/api/images/cd/custom/${file.filename}`;

      // Update only the back_cover field without affecting other data
      const db = require('../database').getDatabase();
      await new Promise<void>((resolve, reject) => {
        const sql = 'UPDATE albums SET back_cover = ? WHERE id = ?';
        db.run(sql, [backCoverPath, id], function(this: { changes: number }, err: Error | null) {
          if (err) {
            logger.error(`Failed to update back cover for album ${id}:`, err);
            reject(err);
          } else {
            logger.info(`Updated album ${id} with custom back cover: ${backCoverPath}`);
            resolve();
          }
        });
      });

      res.json({
        success: true,
        backCoverPath: backCoverPath,
        filename: file.filename,
        width,
        height
      });
    } catch (error) {
      logger.error('Error uploading custom back cover:', error);
      res.status(500).json({ error: 'Failed to upload custom back cover' });
    }
  },

  // Toggle Listen Next for an album
  toggleListenNext: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      // { disc }: one disc in or out, or 'all' for the whole album in place of the discs chosen; none, the album in or out.
      const disc = req.body?.disc;
      if (disc !== undefined && disc !== 'all' && !(Number.isInteger(disc) && disc > 0)) {
        res.status(400).json({ error: "disc must be a disc number or 'all'" });
        return;
      }
      const result = await Album.toggleListenNext(id, disc);
      listenNextPlaylistService.schedule();
      res.json(result);
    } catch (error) {
      logger.error('Error toggling listen_next:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Get Listen Next albums
  getListenNextAlbums: async (req: Request, res: Response): Promise<void> => {
    try {
      const albums = await musicCollectionService.getListenNextAlbums();
      res.json(albums);
    } catch (error) {
      logger.error('Error getting Listen Next albums:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * Listen Next in a new order, dragged on its banner, from the first to the
   * last: { keys } of its entries ("12:0", "12:2"), or { albumIds } as before.
   */
  reorderListenNext: async (req: Request, res: Response): Promise<void> => {
    try {
      const keys = req.body?.keys ?? req.body?.albumIds;
      if (!Array.isArray(keys) || !keys.every(key => Number.isInteger(key) || (typeof key === 'string' && parseEntryKey(key)))) {
        res.status(400).json({ error: 'keys must be an array of Listen Next entries' });
        return;
      }
      const albums = await musicCollectionService.reorderListenNext(keys);
      listenNextPlaylistService.schedule();
      res.json({ albums });
    } catch (error) {
      logger.error('Error reordering Listen Next:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Smart fill Listen Next with suggested albums
  smartFillListenNext: async (req: Request, res: Response): Promise<void> => {
    try {
      // "From anything": the digital albums too, as MusicDex shows them with Digital on.
      const result = await smartPlaylistService.smartFillListenNext({
        withDigital: req.body?.from === 'any',
        classical: classicalChoiceOf(req.body?.classical),
      });
      listenNextPlaylistService.schedule();

      // Get the updated Listen Next albums to return
      const albums = await musicCollectionService.getListenNextAlbums();

      res.json({
        success: true,
        added: result.added.length,
        message: result.message,
        albums: albums
      });
    } catch (error) {
      logger.error('Error in smart fill Listen Next:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Get smart playlist statistics
  getSmartPlaylistStats: async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await smartPlaylistService.getStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error getting smart playlist stats:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Shuffle a specific album in Listen Next (replace with new suggestion)
  shuffleListenNextAlbum: async (req: Request, res: Response): Promise<void> => {
    try {
      const albumId = req.params.albumId as string;
      const result = await smartPlaylistService.shuffleAlbum(parseInt(albumId, 10), classicalChoiceOf(req.body?.classical));
      listenNextPlaylistService.schedule();

      // Get the updated Listen Next albums to return
      const albums = await musicCollectionService.getListenNextAlbums();

      res.json({
        ...result,
        albums: albums
      });
    } catch (error) {
      logger.error('Error shuffling Listen Next album:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  /** Playing Listen Next: Repeat, the albums leaving it, every album's length, the playlist for Amperfy. */
  getListenNextPlay: async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await listenNextPlayService.getState());
    } catch (error) {
      logger.error('Error getting Listen Next play state:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  setListenNextRepeat: async (req: Request, res: Response): Promise<void> => {
    if (typeof req.body?.repeat !== 'boolean') {
      res.status(400).json({ error: 'Expected { repeat: boolean }' });
      return;
    }
    try {
      await listenNextPlayService.setRepeat(req.body.repeat);
      res.json({ repeat: req.body.repeat });
    } catch (error) {
      logger.error('Error setting Listen Next repeat:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  /** A mixtape of Listen Next played shuffled, or in its own order: { shuffled }. */
  setListenNextShuffled: async (req: Request, res: Response): Promise<void> => {
    const albumId = parseInt(req.params.albumId as string, 10);
    if (!Number.isInteger(albumId) || typeof req.body?.shuffled !== 'boolean') {
      res.status(400).json({ error: 'Expected an album id and { shuffled: boolean }' });
      return;
    }
    try {
      if (!(await listenNextPlayService.setShuffled(albumId, req.body.shuffled))) {
        res.status(404).json({ error: 'No such mixtape' });
        return;
      }
      res.json({ shuffled: req.body.shuffled });
    } catch (error) {
      logger.error('Error shuffling a Listen Next mixtape:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  /** ⏭ on the last track of an album, or of a disc ({ disc }), in DexVault's player: it leaves Listen Next as one played to its end. */
  markListenNextPlayed: async (req: Request, res: Response): Promise<void> => {
    const albumId = parseInt(req.params.albumId as string, 10);
    const disc = req.body?.disc ?? 0;
    if (!Number.isInteger(albumId) || !Number.isInteger(disc) || disc < 0) {
      res.status(400).json({ error: 'Expected an album id and its disc' });
      return;
    }
    try {
      res.json({ left: await listenNextPlayService.markPlayed(albumId, disc) });
    } catch (error) {
      logger.error('Error marking a Listen Next album played:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  /** Keep here: an album that left Listen Next once played goes back at its place. */
  keepListenNextDeparture: async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    try {
      if (!(await listenNextPlayService.keep(id))) {
        res.status(404).json({ error: 'No such departure' });
        return;
      }
      res.json({ albums: await musicCollectionService.getListenNextAlbums() });
    } catch (error) {
      logger.error('Error keeping a Listen Next album:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  coverUploadMiddleware: coverUpload.single('cover')
};

export default musicController;
