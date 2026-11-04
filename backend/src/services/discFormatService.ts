import { getDatabase } from '../database';
import logger from '../logger';
import musicbrainzService from './musicbrainzService';

/*
 * The format of each disc of the albums added before DexVault kept it: a CD
 * + DVD's DVD is no audio to rip nor to play. Only albums of several discs
 * are asked, one edition a second for MusicBrainz's rate limit; a disc
 * MusicBrainz gives no format keeps '' so as not to be asked again.
 */

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));
const run = (sql: string, params: unknown[]): Promise<void> =>
  new Promise((resolve, reject) => getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const discFormatService = {
  /** Fills the format of the discs of the albums of several discs that have none yet; how many albums. */
  fill: async (limit = 200): Promise<number> => {
    const albums = await all<{ id: number; releaseId: string }>(
      `SELECT a.id, a.musicbrainz_release_id AS releaseId FROM albums a
        WHERE a.musicbrainz_release_id IS NOT NULL AND a.musicbrainz_release_id != ''
          AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.medium IS NULL)
          AND (SELECT COUNT(DISTINCT disc_number) FROM tracks t WHERE t.album_id = a.id) > 1
        LIMIT ?`, [limit]);
    let filled = 0;
    for (const album of albums) {
      try {
        const formats = await musicbrainzService.getReleaseMediaFormats(album.releaseId);
        const discs = await all<{ disc: number }>('SELECT DISTINCT disc_number AS disc FROM tracks WHERE album_id = ?', [album.id]);
        for (const { disc } of discs) {
          await run('UPDATE tracks SET medium = ? WHERE album_id = ? AND disc_number = ? AND medium IS NULL', [formats[disc - 1] || '', album.id, disc]);
        }
        filled++;
      } catch (error) {
        logger.warn(`Disc formats of album ${album.id}: ${(error as Error).message}`);
      }
      await pause(1100);
    }
    return filled;
  },

  startAutoFill: (): void => {
    const tick = () => {
      discFormatService.fill()
        .then(count => { if (count) logger.info(`Read the disc formats of ${count} albums from MusicBrainz`); })
        .catch(error => logger.warn(`Disc formats fill failed: ${(error as Error).message}`));
    };
    setTimeout(tick, 3 * 60 * 1000).unref();
    setInterval(tick, 6 * 60 * 60 * 1000).unref();
  },
};

export default discFormatService;
