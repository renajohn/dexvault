import Collection from '../models/collection';
import AlbumCollection from '../models/albumCollection';
import PlaylistHistory from '../models/playlistHistory';
import logger from '../logger';
import { getDatabase } from '../database';

interface CollectionAlbum {
  id: number;
  title: string;
  /** One disc of the album in Listen Next, null for the whole album. */
  disc?: number | null;
  /** How many discs the album has, from its tracks: 0 when they are not known. */
  discCount?: number;
  [key: string]: unknown;
}

interface CollectionRecord {
  id: number;
  name: string;
  type: string;
}

/** A row of Listen Next: an album, whole (disc 0) or one of its discs. */
export interface ListenNextEntry {
  albumId: number;
  disc: number;
  order: number | null;
  suggested: boolean;
}

/** What a click on Listen Next asks: the whole album in or out (none), the whole album ('all'), or one disc in or out. */
export type ListenNextChoice = undefined | 'all' | number;

export interface ListenNextToggleResult {
  id: number;
  action: 'added' | 'removed' | 'kept';
}

/**
 * An entry of Listen Next as the page and the player name it: the album's id
 * and its disc, 0 for the whole album ("12:0", "12:2").
 */
export const entryKey = (albumId: number, disc: number | null | undefined): string => `${albumId}:${disc || 0}`;

/** "12:2" as album 12, disc 2; a bare id as the whole album. Null when it is neither. */
export const parseEntryKey = (key: string | number): { albumId: number; disc: number } | null => {
  const [album, disc = '0'] = String(key).split(':');
  const albumId = Number(album);
  const discNo = Number(disc);
  return Number.isInteger(albumId) && albumId > 0 && Number.isInteger(discNo) && discNo >= 0 ? { albumId, disc: discNo } : null;
};

const run = (sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) => getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || []))));

const listenNextCollectionId = async (): Promise<number | null> =>
  ((await Collection.findByType('listen_next')) as CollectionRecord | null)?.id ?? null;

/** Listen Next's rows in their order, one album's alone when `albumId` is given. */
const entriesOf = async (collectionId: number, albumId?: number): Promise<ListenNextEntry[]> =>
  (await all<{ album_id: number; disc: number; collection_order: number | null; suggested: number }>(
    `SELECT album_id, disc, collection_order, suggested FROM album_collections
     WHERE collection_id = ?${albumId == null ? '' : ' AND album_id = ?'}
     ORDER BY CASE WHEN collection_order IS NOT NULL THEN collection_order ELSE 999999 END, id`,
    albumId == null ? [collectionId] : [collectionId, albumId]))
    .map(row => ({ albumId: row.album_id, disc: row.disc, order: row.collection_order, suggested: Boolean(row.suggested) }));

/** Put at the end of Listen Next, and noted so that a draw does not offer it again for a while. */
const addAtEnd = async (collectionId: number, albumId: number, disc: number): Promise<void> => {
  const position = await AlbumCollection.getNextOrder(collectionId);
  await AlbumCollection.create({ album_id: albumId, collection_id: collectionId, collection_order: position, disc });
  try {
    await PlaylistHistory.recordSuggestion(albumId);
  } catch (historyError) {
    // Don't fail the toggle if history recording fails
    logger.warn('Failed to record playlist history:', (historyError as Error).message);
  }
};

const musicCollectionService = {
  /** Listen Next's rows in their order: an album whole, or one disc of it. */
  getListenNextEntries: async (): Promise<ListenNextEntry[]> => {
    const collectionId = await listenNextCollectionId();
    return collectionId == null ? [] : entriesOf(collectionId);
  },

  /**
   * Listen Next in its order, oldest additions first: each album with the
   * disc it is there for (null for the whole album), an album with two discs
   * chosen twice, and how many discs it has; `suggested` on those a draw put
   * there (Help me choose, the die), which offer the die, not on those put by hand.
   */
  getListenNextAlbums: async (): Promise<CollectionAlbum[]> => {
    try {
      const collectionId = await listenNextCollectionId();
      if (collectionId == null) return [];
      const albums = new Map((await Collection.getAlbums(collectionId) as unknown as CollectionAlbum[]).map(album => [album.id, album]));
      const discCounts = new Map((await all<{ album_id: number; discs: number }>(
        `SELECT t.album_id, COUNT(DISTINCT t.disc_number) AS discs FROM tracks t
         JOIN album_collections ac ON ac.album_id = t.album_id WHERE ac.collection_id = ? GROUP BY t.album_id`, [collectionId]))
        .map(row => [row.album_id, row.discs]));
      return (await entriesOf(collectionId)).flatMap(entry => {
        const album = albums.get(entry.albumId);
        return album ? [{ ...album, disc: entry.disc || null, discCount: discCounts.get(entry.albumId) ?? 0, suggested: entry.suggested }] : [];
      });
    } catch (error) {
      logger.error('Error getting Listen Next albums:', error);
      throw error;
    }
  },

  /**
   * A click on Listen Next. With no disc, the whole album in, or the album out
   * whatever of it is there. 'all': the whole album, in place of the discs
   * chosen. A disc: in at the end, out if it is there, in place of the whole
   * album if that is there.
   */
  setListenNext: async (albumId: number, choice: ListenNextChoice = undefined): Promise<ListenNextToggleResult> => {
    const collectionId = await listenNextCollectionId();
    if (collectionId == null) throw new Error('Listen Next collection not found');
    const rows = await entriesOf(collectionId, albumId);
    const whole = rows.some(row => row.disc === 0);

    if (choice === undefined) {
      if (rows.length > 0) {
        await run('DELETE FROM album_collections WHERE collection_id = ? AND album_id = ?', [collectionId, albumId]);
        return { id: albumId, action: 'removed' };
      }
      await addAtEnd(collectionId, albumId, 0);
      return { id: albumId, action: 'added' };
    }

    if (choice === 'all') {
      if (whole) return { id: albumId, action: 'kept' };
      if (rows.length === 0) {
        await addAtEnd(collectionId, albumId, 0);
        return { id: albumId, action: 'added' };
      }
      // At the place of the first disc chosen.
      await run('DELETE FROM album_collections WHERE collection_id = ? AND album_id = ? AND disc <> ?', [collectionId, albumId, rows[0].disc]);
      await run('UPDATE album_collections SET disc = 0, suggested = 0 WHERE collection_id = ? AND album_id = ?', [collectionId, albumId]);
      return { id: albumId, action: 'added' };
    }

    if (rows.some(row => row.disc === choice)) {
      await run('DELETE FROM album_collections WHERE collection_id = ? AND album_id = ? AND disc = ?', [collectionId, albumId, choice]);
      return { id: albumId, action: 'removed' };
    }
    if (whole) {
      // The whole album gives its place to the disc.
      await run('UPDATE album_collections SET disc = ?, suggested = 0 WHERE collection_id = ? AND album_id = ? AND disc = 0', [choice, collectionId, albumId]);
      return { id: albumId, action: 'added' };
    }
    await addAtEnd(collectionId, albumId, choice);
    return { id: albumId, action: 'added' };
  },

  /** A CD come into the collection: at the end of Listen Next, unless it is there already. */
  addNewCd: async (albumId: number): Promise<boolean> => {
    const collectionId = await listenNextCollectionId();
    if (collectionId == null || (await entriesOf(collectionId, albumId)).length > 0) return false;
    await addAtEnd(collectionId, albumId, 0);
    return true;
  },

  /**
   * Listen Next in the order given, dragged on its banner, as entry keys
   * ("12:0", "12:2"; a bare album id is the whole album). An entry the order
   * leaves out (added meanwhile) keeps its turn after those given; one no
   * longer in the list is passed over.
   */
  reorderListenNext: async (keys: Array<string | number>): Promise<CollectionAlbum[]> => {
    const collectionId = await listenNextCollectionId();
    if (collectionId == null) return [];
    const current = (await entriesOf(collectionId)).map(entry => entryKey(entry.albumId, entry.disc));
    const asked = keys.map(parseEntryKey).flatMap(entry => (entry ? [entryKey(entry.albumId, entry.disc)] : []));
    const given = [...new Set(asked)].filter(key => current.includes(key));
    const order = [...given, ...current.filter(key => !given.includes(key))];
    for (const [index, key] of order.entries()) {
      const { albumId, disc } = parseEntryKey(key)!;
      await AlbumCollection.updateOrder(albumId, collectionId, index + 1, disc);
    }
    return musicCollectionService.getListenNextAlbums();
  }
};

export default musicCollectionService;
