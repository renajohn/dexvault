import { Request, Response } from 'express';
import navidromeService from '../services/navidromeService';
import waveformService, { canRead } from '../services/waveformService';
import transcodeService, { EncodingDropped } from '../services/transcodeService';
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
    // Closed before Navidrome answers (another track clicked meanwhile): the close is seen now, not missed.
    let gone = false;
    res.on('close', () => { gone = true; });
    try {
      const upstream = await navidromeService.stream(id, typeof req.headers.range === 'string' ? req.headers.range : undefined);
      if (gone) {
        (upstream.data as unknown as { destroy?: () => void }).destroy?.();
        return;
      }
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

  /**
   * A song made lighter for this browser on a weak network (AAC 256 in an
   * .m4a), encoded now if need be: `{ ready: true }` once it can be played,
   * 501 where ffmpeg is not, and the browser plays the file as it is.
   */
  prepareLight: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    if (!navidromeService.isConfigured()) {
      res.status(503).json({ error: 'Navidrome is not configured' });
      return;
    }
    if (!transcodeService.kept(id) && !(await canRead())) {
      res.status(501).json({ error: 'ffmpeg is not installed here' });
      return;
    }
    try {
      await transcodeService.prepare(id);
      res.json({ ready: true });
    } catch (error) {
      if (error instanceof EncodingDropped) {
        res.status(503).json({ error: error.message });
        return;
      }
      logger.warn(`Encoding song ${id}: ${(error as Error).message}`);
      res.status(502).json({ error: (error as Error).message });
    }
  },

  /** The lighter song as a file, every Range answered, as Safari asks it. Never to an appliance: they play the FLAC. */
  streamLight: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    if (!navidromeService.isConfigured()) {
      res.status(503).json({ error: 'Navidrome is not configured' });
      return;
    }
    if (!transcodeService.kept(id) && !(await canRead())) {
      res.status(501).json({ error: 'ffmpeg is not installed here' });
      return;
    }
    try {
      const file = await transcodeService.prepare(id);
      res.sendFile(file, { headers: { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof EncodingDropped) {
        if (!res.headersSent) res.status(503).json({ error: error.message });
        return;
      }
      logger.warn(`Encoding song ${id}: ${(error as Error).message}`);
      if (!res.headersSent) res.status(502).json({ error: (error as Error).message });
    }
  },

  /**
   * A song's wave, for fixing the timing of its words: `{ bin, levels }`,
   * the levels base64, one byte a slice. Read once with ffmpeg and kept; 501
   * where ffmpeg is not, and the browser reads the file itself.
   */
  waveform: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!SONG_ID.test(id)) {
      res.status(400).json({ error: 'Not a song id' });
      return;
    }
    if (!navidromeService.isConfigured()) {
      res.status(503).json({ error: 'Navidrome is not configured' });
      return;
    }
    if (!waveformService.kept(id) && !(await canRead())) {
      res.status(501).json({ error: 'ffmpeg is not installed here' });
      return;
    }
    try {
      const wave = await waveformService.of(id);
      // A song's file does not change under its id: the wave is kept by the browser too.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.json({ bin: wave.bin, levels: wave.levels.toString('base64') });
    } catch (error) {
      logger.warn(`Waveform of song ${id}: ${(error as Error).message}`);
      res.status(502).json({ error: (error as Error).message });
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
