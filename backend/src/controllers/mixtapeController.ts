import { Request, Response } from 'express';
import mixtapeService, { MixtapeGoneError, type MixtapeEdit } from '../services/mixtapeService';
import logger from '../logger';
import { shuffleOrder } from '../services/mixtapeShuffle';
import mixtapeSearchService from '../services/mixtapeSearchService';

/** A Navidrome id: letters, digits, dashes and underscores. */
const SONG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 200;

const albumIdOf = (req: Request): number | null => {
  const id = Number(req.params.albumId);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const songIdsOf = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length <= 5000 && value.every(id => typeof id === 'string' && SONG_ID.test(id)) ? value as string[] : null;

const nameOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_NAME ? name : null;
};

const indexOf = (value: unknown): number | null => (Number.isInteger(value) && (value as number) >= 0 ? value as number : null);

/** The change asked for, null when it is not one. */
const editOf = (body: Record<string, unknown>): MixtapeEdit | null => {
  if ('add' in body) { const ids = songIdsOf(body.add); return ids && ids.length ? { add: ids } : null; }
  if ('remove' in body) { const ids = songIdsOf(body.remove); return ids && ids.length ? { remove: ids } : null; }
  if ('removeAt' in body) { const at = indexOf(body.removeAt); return at == null ? null : { removeAt: at }; }
  if ('move' in body) {
    const move = body.move as Record<string, unknown> | null;
    const from = indexOf(move?.from), to = indexOf(move?.to);
    return from == null || to == null ? null : { move: { from, to } };
  }
  if ('songs' in body) { const ids = songIdsOf(body.songs); return ids ? { songs: ids } : null; }
  return null;
};

const fail = (res: Response, error: unknown, what: string) => {
  if (error instanceof MixtapeGoneError) {
    res.status(404).json({ error: error.message });
    return;
  }
  logger.error(`${what}:`, error);
  res.status(502).json({ error: (error as Error).message || what });
};

const mixtapeController = {
  /** The mixtapes, the playlists listed again in Navidrome first; their songs' ids, for the toggles of a CD's tracks. */
  list: async (_req: Request, res: Response): Promise<void> => {
    try {
      await mixtapeService.refresh().catch(error => logger.warn(`Mixtapes not read from Navidrome: ${(error as Error).message}`));
      res.json({ configured: mixtapeService.isConfigured(), mixtapes: await mixtapeService.list() });
    } catch (error) {
      fail(res, error, 'Failed to list the mixtapes');
    }
  },

  /** What plays and the words find, for a mixtape's Add tracks…: albums, works, songs. */
  search: async (req: Request, res: Response): Promise<void> => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (query.length > MAX_NAME) { res.status(400).json({ error: 'The search is too long' }); return; }
    if (!mixtapeService.isConfigured()) { res.json({ albums: [], works: [], tracks: [] }); return; }
    try {
      res.json(await mixtapeSearchService.search(query));
    } catch (error) {
      fail(res, error, 'Failed to search what plays');
    }
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const albumId = albumIdOf(req);
    if (albumId == null) { res.status(400).json({ error: 'albumId must be a number' }); return; }
    try {
      await mixtapeService.refresh().catch(error => logger.warn(`Mixtapes not read from Navidrome: ${(error as Error).message}`));
      const mixtape = await mixtapeService.get(albumId);
      if (!mixtape) { res.status(404).json({ error: 'Mixtape not found' }); return; }
      // Played shuffled from Listen Next: the order drawn, as places, for DexVault's player to play it so.
      res.json({ ...mixtape, listenNextOrder: await shuffleOrder(albumId, mixtape.songs) });
    } catch (error) {
      fail(res, error, 'Failed to read the mixtape');
    }
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const name = nameOf(req.body?.name);
    const songIds = songIdsOf(req.body?.songIds ?? []);
    if (!name || !songIds) { res.status(400).json({ error: 'A name and song ids are required' }); return; }
    try {
      res.status(201).json(await mixtapeService.create(name, songIds));
    } catch (error) {
      fail(res, error, 'Failed to make the mixtape');
    }
  },

  /** A new name, or a change to the songs: add, remove (every copy), removeAt, move, songs. */
  update: async (req: Request, res: Response): Promise<void> => {
    const albumId = albumIdOf(req);
    if (albumId == null) { res.status(400).json({ error: 'albumId must be a number' }); return; }
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      if ('name' in body) {
        const name = nameOf(body.name);
        if (!name) { res.status(400).json({ error: 'A name is required' }); return; }
        await mixtapeService.rename(albumId, name);
      } else {
        const edit = editOf(body);
        if (!edit) { res.status(400).json({ error: 'Nothing to change' }); return; }
        await mixtapeService.edit(albumId, edit);
      }
      res.json(await mixtapeService.get(albumId));
    } catch (error) {
      fail(res, error, 'Failed to change the mixtape');
    }
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const albumId = albumIdOf(req);
    if (albumId == null) { res.status(400).json({ error: 'albumId must be a number' }); return; }
    try {
      if (!await mixtapeService.remove(albumId)) { res.status(404).json({ error: 'Mixtape not found' }); return; }
      res.json({ deleted: true });
    } catch (error) {
      fail(res, error, 'Failed to delete the mixtape');
    }
  },
};

export default mixtapeController;
