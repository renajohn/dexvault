import Album from '../models/album';
import Track from '../models/track';
import { getDatabase } from '../database';
import type { AlbumFormatted } from '../types';
import navidromeService, { type NavidromeAlbum } from './navidromeService';
import ripStatusService, { cdSongsOf, groupSongs, matchesOf, qualityOf, type Library, type Quality } from './ripStatusService';
import musicService from './musicService';
import imageService from './imageService';
import scorePiecesService from './scorePiecesService';
import recordingIdService from './recordingIdService';
import logger from '../logger';

/**
 * The albums of Navidrome no CD or wish of the collection stands for are
 * albums of DexVault too, `title_status = 'digital'`: their tracks, words,
 * notes and place in Listen Next hang on an album like any other, and stay
 * with it when it goes on the wish list or its CD is bought.
 */
export const DIGITAL_FORMAT = 'Digital Media';

export interface DigitalAlbumsReport {
  added: number;
  relinked: number;
  /** Tracks copied again from the tags, their lengths having changed. */
  retracked: number;
  /** Kept although Navidrome no longer has them: something hangs on them. */
  gone: number;
  deleted: number;
}

const exists = (sql: string, params: unknown[]): Promise<boolean> =>
  new Promise((resolve, reject) =>
    getDatabase().get(sql, params, (err: Error | null, row: { found: number } | undefined) => {
      if (err) reject(err); else resolve(Boolean(row?.found));
    }));

/**
 * What the owner gave an album of their own: a note, a guide, stars, a place
 * in a collection. Not its Wikipedia story, read as its dialog opens and read
 * again at will.
 */
const hasOwnersTouch = async (album: AlbumFormatted): Promise<boolean> =>
  album.userRating != null || exists(
    `SELECT EXISTS(SELECT 1 FROM album_notes WHERE album_id = ?)
         OR EXISTS(SELECT 1 FROM album_guides WHERE album_id = ?)
         OR EXISTS(SELECT 1 FROM album_collections WHERE album_id = ?) AS found`,
    [album.id, album.id, album.id]);

/** The tracks of an album as its files are tagged, disc by disc. */
const discsOf = async (navidromeId: string) => {
  const files = await navidromeService.getAlbumSongs(navidromeId);
  const discs = new Map<number, Array<{
    trackNumber: number; title: string; durationSec: number | null; artist: string[]; musicbrainzRecordingId: string | null; isrc: string | null;
  }>>();
  for (const file of [...files].sort((a, b) => a.discNumber - b.discNumber || a.track - b.track)) {
    discs.set(file.discNumber, [...(discs.get(file.discNumber) || []), {
      trackNumber: file.track, title: file.title, durationSec: file.durationSec, artist: file.artist ? [file.artist] : [],
      musicbrainzRecordingId: file.musicbrainzRecordingId ?? null, isrc: file.isrc ?? null,
    }]);
  }
  return [...discs].map(([number, tracks]) => ({ number, tracks }));
};

const sameLengths = (a: number[] | undefined, b: number[] | undefined): boolean =>
  Boolean(a && b && a.length === b.length && a.every((length, index) => length === b[index]));

const create = async (album: NavidromeAlbum): Promise<AlbumFormatted> => {
  const data = {
    title: album.name, artist: [album.artist], format: DIGITAL_FORMAT, titleStatus: 'digital',
    ...(album.year ? { releaseYear: album.year } : {}),
    discs: await discsOf(album.id),
  };
  let added: AlbumFormatted;
  try {
    added = await musicService.addAlbum({ ...data, ...(album.musicBrainzId ? { musicbrainzReleaseId: album.musicBrainzId } : {}) });
  } catch (error) {
    // The unique index: an album of DexVault already has this edition, no title of its own in common.
    if (!album.musicBrainzId || !/UNIQUE/i.test((error as Error).message)) throw error;
    added = await musicService.addAlbum(data);
  }
  await Album.setNavidrome(added.id, album.id);
  try {
    const { data: cover } = await navidromeService.getCoverArt(album.id);
    await Album.updateFrontCover(added.id, await imageService.saveImage(cover, 'cd/custom', `navidrome_${added.id}_${Date.now()}.jpg`));
  } catch (error) {
    logger.warn(`Digital album ${added.id} "${album.name}" has no cover: ${(error as Error).message}`);
  }
  return added;
};

const EVERY_MS = 30 * 60 * 1000;

/** A CD with several copies is as good as its best. */
const QUALITIES: Quality[] = ['lossless', 'near', 'lossy'];

let running: Promise<DigitalAlbumsReport | null> | null = null;

const reconcile = async (): Promise<DigitalAlbumsReport | null> => {
  const navidrome: Library = await ripStatusService.library();
  // An empty answer is Navidrome rescanning or out of order, not a library emptied: nothing goes.
  if (navidrome.albums.length === 0) return null;
  const report: DigitalAlbumsReport = { added: 0, relinked: 0, retracked: 0, gone: 0, deleted: 0 };

  // How good each album's files are, kept on the album for the search: a CD's best copy, 'none' for a CD not ripped.
  const songsByAlbum = groupSongs(navidrome.songs);
  // A CD's files alone: a bonus bought apart and put with it leaves its rip as good as it is.
  const qualityIn = (navidromeId: string, places?: Set<string>): Quality =>
    qualityOf(cdSongsOf(songsByAlbum.get(navidromeId) || [], places)).quality;
  const fileQualities = new Map<number, string | null>();

  // The copies of a CD of the collection or of a wish are theirs, not albums of their own.
  const taken = new Set<string>();
  const cdsAndWishes = [...await Album.findAll(), ...await Album.findByStatus('wish')];
  for (const album of cdsAndWishes) {
    const copies = matchesOf(album, navidrome.albums, navidrome.lengths).map(({ candidate }) => candidate.id);
    copies.forEach(id => taken.add(id));
    const qualities = copies.map(id => qualityIn(id, navidrome.lengths.cdPlaces?.get(album.id)));
    fileQualities.set(album.id, QUALITIES.find(quality => qualities.includes(quality))
      ?? (album.titleStatus !== 'wish' && /CD|Unknown/i.test(album.format || 'Unknown') ? 'none' : null));
  }

  const digital = await Album.findByStatus('digital');
  const claimed = new Set<number>();
  const byNavidromeId = new Map(digital.filter(album => album.navidromeId).map(album => [album.navidromeId!, album]));
  for (const album of navidrome.albums.filter(candidate => !taken.has(candidate.id))) {
    try {
      let mine = byNavidromeId.get(album.id);
      if (mine && claimed.has(mine.id)) mine = undefined;
      if (!mine) {
        // Navidrome gives an album a new id when its tags change: the same title and artist, or edition, is the same album.
        mine = digital.find(candidate => !claimed.has(candidate.id) && !navidrome.albums.some(other => other.id === candidate.navidromeId)
          && matchesOf(candidate, [album]).length > 0);
        if (mine) report.relinked++;
      }
      if (!mine) {
        const added = await create(album);
        claimed.add(added.id);
        fileQualities.set(added.id, qualityIn(album.id));
        report.added++;
        logger.info(`Digital album ${added.id} "${album.name}" added from Navidrome`);
        continue;
      }
      claimed.add(mine.id);
      fileQualities.set(mine.id, qualityIn(album.id));
      if (mine.navidromeId !== album.id || mine.navidromeGoneAt) await Album.setNavidrome(mine.id, album.id);
      // Lengths Navidrome gives in full and the tracks do not have: the files changed, the tracks follow.
      const files = navidrome.lengths.navidrome.get(album.id);
      if (files && !sameLengths(navidrome.lengths.cd.get(mine.id), files)) {
        const discs = await discsOf(album.id);
        await Track.deleteByCdId(mine.id);
        for (const disc of discs) {
          for (const track of disc.tracks) await Track.create({ albumId: mine.id, discNumber: disc.number, ...track });
        }
        recordingIdService.forget(mine.id);
        report.retracked++;
      }
    } catch (error) {
      logger.warn(`Navidrome album ${album.id} "${album.name}" not taken in as a digital album: ${(error as Error).message}`);
    }
  }

  // No longer in Navidrome, or now a CD's copy: kept only when the owner made something of it.
  for (const album of digital.filter(candidate => !claimed.has(candidate.id))) {
    if (await hasOwnersTouch(album)) {
      fileQualities.set(album.id, null);
      if (!album.navidromeGoneAt) {
        await Album.setNavidrome(album.id, album.navidromeId ?? null, new Date().toISOString());
        report.gone++;
      }
    } else {
      await Track.deleteByCdId(album.id);
      await Album.delete(album.id);
      report.deleted++;
      logger.info(`Digital album ${album.id} "${album.title}" deleted: no longer in Navidrome on its own`);
    }
  }
  const known = new Map([...cdsAndWishes, ...digital].map(album => [album.id, album.fileQuality ?? null]));
  for (const [id, quality] of fileQualities) {
    if (known.get(id) !== quality) await Album.setFileQuality(id, quality);
  }
  if (report.added + report.relinked + report.retracked + report.gone + report.deleted > 0) {
    logger.info(`Digital albums: ${JSON.stringify(report)}`);
  }
  return report;
};

const digitalAlbumService = {
  /**
   * Brings the digital albums in step with Navidrome: one for each album no
   * CD or wish stands for, its tracks copied from the tags. One no longer
   * there is deleted, or only marked gone when it has notes, a guide, stars
   * or a place in Listen Next. Once at a time, however many ask.
   */
  reconcile: (): Promise<DigitalAlbumsReport | null> => {
    if (!navidromeService.isConfigured()) return Promise.resolve(null);
    running = running ?? reconcile().finally(() => { running = null; });
    return running;
  },

  /**
   * A minute after the start, before the words are looked up, then every
   * half hour; then the recordings the albums lack, which tell the same song
   * on two albums.
   */
  startAutoSync: (): void => {
    if (!navidromeService.isConfigured()) return;
    const tick = () => {
      digitalAlbumService.reconcile()
        .catch(error => logger.warn(`Digital albums not brought in step with Navidrome: ${(error as Error).message}`))
        .then(() => recordingIdService.fillAll())
        .catch(error => logger.warn(`Recordings not filled in: ${(error as Error).message}`))
        // Then the works they play, which tie a score's pieces to the music.
        .then(() => scorePiecesService.indexAll())
        .catch(error => logger.warn(`Works of the recordings not read: ${(error as Error).message}`));
    };
    setTimeout(tick, 60 * 1000).unref();
    setInterval(tick, EVERY_MS).unref();
  },

  /** The digital album standing for a Navidrome album, null when there is none. */
  forNavidromeAlbum: async (navidromeId: string): Promise<AlbumFormatted | null> =>
    (await Album.findByStatus('digital')).find(album => album.navidromeId === navidromeId) ?? null,
};

export default digitalAlbumService;
