import { Request, Response } from 'express';
import navidromeService from '../services/navidromeService';
import { scrobble } from '../services/scrobble';
import logger from '../logger';

/** A Navidrome song id: letters, digits, dashes and underscores, never a path. */
const SONG_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * DexVault's own player: the files come from Navidrome through here, so its
 * password stays on the server, and what is played is told back to it.
 */
const playerController = {
  stream: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    if (!navidromeService.isConfigured()) {
      res.status(503).json({ error: 'Navidrome is not configured' });
      return;
    }
    try {
      const upstream = await navidromeService.stream(id, typeof req.headers.range === 'string' ? req.headers.range : undefined);
      // Subsonic answers an unknown song with a JSON error, not with sound.
      if (upstream.status >= 400 || upstream.headers['content-type']?.includes('json')) {
        (upstream.data as unknown as { destroy?: () => void }).destroy?.();
        res.status(upstream.status >= 400 ? upstream.status : 404).json({ error: 'Navidrome has no such song' });
        return;
      }
      res.status(upstream.status);
      for (const [name, value] of Object.entries(upstream.headers)) res.setHeader(name, value);
      res.setHeader('Cache-Control', 'no-store');
      // A listener who skips closes the request: stop reading from Navidrome too.
      res.on('close', () => (upstream.data as unknown as { destroy?: () => void }).destroy?.());
      // Navidrome gone halfway: the browser is told, rather than left waiting for the rest.
      upstream.data.on('error', error => {
        logger.warn(`Streaming song ${id}: ${error.message}`);
        res.destroy();
      });
      upstream.data.pipe(res);
    } catch (error) {
      logger.warn(`Streaming song ${id}: ${(error as Error).message}`);
      if (!res.headersSent) res.status(502).json({ error: (error as Error).message });
    }
  },

  scrobble: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    const submission = req.body?.submission === true;
    let left = null;
    try {
      // A play counted: the album of Listen Next it ends leaves it, and the page is told at once.
      ({ left } = await scrobble(id, submission));
    } catch (error) {
      logger.warn(`Scrobbling song ${id}: ${(error as Error).message}`);
      res.status(502).json({ error: (error as Error).message });
      return;
    }
    res.json({ ok: true, left });
  },

  /** A song's heart, in Navidrome: what Amperfy and Navidrome's web player show too. */
  star: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    const starred = req.method === 'PUT';
    try {
      await navidromeService.setStarred(id, starred);
      res.json({ starred });
    } catch (error) {
      logger.warn(`Starring song ${id}: ${(error as Error).message}`);
      res.status(502).json({ error: (error as Error).message });
    }
  },
};

export default playerController;
