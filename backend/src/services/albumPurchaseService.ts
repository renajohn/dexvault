import Album from '../models/album';
import type { AlbumFormatted } from '../types';
import musicbrainzService from './musicbrainzService';
import musicbrainzRefreshService from './musicbrainzRefreshService';
import { matchesOf } from './ripStatusService';
import { normalizeAlbumOwnership } from './utils/albumOwnership';
import logger from '../logger';
import musicCollectionService from './musicCollectionService';

/**
 * The CD of an album one had only as files, or wished, bought: the same
 * album of DexVault becomes a CD of the collection, with its tracks, words,
 * notes, guide, plays and place in Listen Next, instead of a new album
 * beside it.
 */

export class PurchaseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export interface Purchase {
  /** The exact edition bought: a MusicBrainz release, its id or its link. */
  releaseId?: string | null;
  /** Or the barcode on its back, for MusicBrainz to say which edition it is. */
  barcode?: string | null;
  condition?: string | null;
  purchasedAt?: string | null;
  priceChf?: number | string | null;
  notes?: string | null;
  ownership?: Record<string, unknown>;
}

const RELEASE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The edition named, or the one MusicBrainz knows the barcode of; null to keep the album's own. */
const editionOf = async ({ releaseId, barcode }: Pick<Purchase, 'releaseId' | 'barcode'>): Promise<string | null> => {
  if (releaseId) {
    const id = releaseId.match(RELEASE_ID)?.[0];
    if (!id) throw new PurchaseError('Not a MusicBrainz release: give its id or its link', 400);
    return id.toLowerCase();
  }
  if (barcode) {
    const releases = await musicbrainzService.getReleaseByBarcode(barcode.replace(/\s+/g, ''));
    if (releases.length === 0) throw new PurchaseError(`MusicBrainz knows no edition with the barcode ${barcode}`, 404);
    return releases[0].id;
  }
  return null;
};

const hasNoCd = (album: AlbumFormatted) => album.titleStatus === 'digital' || album.titleStatus === 'wish';

const albumPurchaseService = {
  /**
   * Makes a digital or wished album a CD of the collection, as bought: its
   * condition, date, price and notes, and the edition bought when it is not
   * the one the album already has, its tracks then taken from MusicBrainz.
   * The words follow by position, looked up again only where a title moved.
   */
  markBought: async (albumId: number, purchase: Purchase): Promise<AlbumFormatted> => {
    const album = await Album.findById(albumId);
    if (!album) throw new PurchaseError('No such album', 404);
    if (!hasNoCd(album)) throw new PurchaseError('This album is already a CD of the collection', 409);

    const releaseId = await editionOf(purchase);
    const newEdition = Boolean(releaseId && releaseId !== album.musicbrainzReleaseId);
    if (newEdition) {
      const holder = (await Album.findAll()).find(other => other.musicbrainzReleaseId === releaseId);
      if (holder) throw new PurchaseError(`"${holder.title}" of the collection already is this edition`, 409);
      await Album.replaceReleaseId(albumId, releaseId!);
    }
    await Album.setOwnership(albumId, normalizeAlbumOwnership(purchase));
    await Album.setFormat(albumId, 'CD');
    await Album.updateStatus(albumId, 'owned');
    // The CD bought: at the end of Listen Next, unless it is there already.
    await musicCollectionService.addNewCd(albumId).catch(error =>
      logger.warn(`Album ${albumId} bought but not put in Listen Next: ${(error as Error).message}`));
    logger.info(`Album ${albumId} "${album.title}" bought on CD${newEdition ? `, edition ${releaseId}` : ''} (was ${album.titleStatus})`);
    if (newEdition) {
      await musicbrainzRefreshService.refreshAlbum(albumId).catch(error =>
        logger.warn(`Album ${albumId} bought as edition ${releaseId} but not refreshed: ${(error as Error).message}`));
    }
    return (await Album.findById(albumId))!;
  },

  /**
   * The digital and wished albums a CD about to be added would be: the same
   * edition, the same release group, or the same title and artist. Adding it
   * to one of them keeps all that hangs on it.
   */
  attachable: async (query: { releaseId?: string | null; barcode?: string | null; title?: string | null; artist?: string[] | string | null }): Promise<AlbumFormatted[]> => {
    let releaseId: string | null = null;
    let releaseGroupId: string | null = null;
    let title = query.title || null;
    let artists = Array.isArray(query.artist) ? query.artist : query.artist ? [query.artist] : [];
    try {
      releaseId = await editionOf(query);
      if (releaseId) {
        const release = await musicbrainzService.getReleaseDetails(releaseId);
        releaseGroupId = release['release-group']?.id ?? null;
        title = title || release.title || null;
        if (artists.length === 0) artists = (release['artist-credit'] || []).map((credit: { name?: string }) => credit.name || '').filter(Boolean);
      }
    } catch (error) {
      // MusicBrainz out of reach: the title and artist still tell.
      logger.warn(`No edition read for an album to attach: ${(error as Error).message}`);
    }
    const asTagged = title ? [{ id: 'new', name: title, artist: artists.join(' '), musicBrainzId: releaseId, songCount: 0, userRating: 0 }] : [];
    const candidates = [...await Album.findByStatus('digital'), ...await Album.findByStatus('wish')];
    return candidates.filter(album =>
      (releaseId && album.musicbrainzReleaseId === releaseId)
      || (releaseGroupId && album.musicbrainzReleaseGroupId === releaseGroupId)
      || (asTagged.length > 0 && artists.length > 0 && matchesOf(album, asTagged).length > 0));
  },
};

export default albumPurchaseService;
