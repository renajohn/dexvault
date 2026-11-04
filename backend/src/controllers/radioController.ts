import { Request, Response } from 'express';
import radioService, { criteriaOf, poolOf } from '../services/radioService';
import trackFicheService from '../services/trackFicheService';
import logger from '../logger';

/** A Navidrome id: letters, digits, dashes and underscores. */
const SONG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PROMPT = 500;
const MAX_AHEAD = 200;

const promptOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const prompt = value.trim();
  return prompt && prompt.length <= MAX_PROMPT ? prompt : null;
};

const failed = (res: Response, what: string, error: unknown): void => {
  const message = (error as Error).message;
  logger.warn(`Radio: ${what}: ${message}`);
  const unreachable = message.startsWith('Network error') || message.startsWith('HTTP');
  res.status(unreachable ? 503 : 502).json({
    error: unreachable ? 'The local LLM did not answer. Please try again in a moment.' : message,
  });
};

const radioController = {
  /** What a prompt is heard as. */
  criteria: async (req: Request, res: Response): Promise<void> => {
    const prompt = promptOf(req.body?.prompt);
    if (!prompt) { res.status(400).json({ error: 'A prompt is needed' }); return; }
    try {
      res.json(await radioService.criteria(prompt));
    } catch (error) {
      failed(res, 'no criteria', error);
    }
  },

  /** The next songs; the prompt, when the page sends it too, helps the model choose. */
  next: async (req: Request, res: Response): Promise<void> => {
    const body = req.body || {};
    const criteria = criteriaOf(body.criteria);
    if (!criteria) { res.status(400).json({ error: 'The criteria are not criteria' }); return; }
    const pool = poolOf(body.pool);
    if (!pool) { res.status(400).json({ error: 'A pool is needed: stars, hearts, popular, genre, wholeWorks' }); return; }
    const count = body.count;
    if (!Number.isInteger(count) || count < 1 || count > 50) { res.status(400).json({ error: 'count goes from 1 to 50' }); return; }
    const ahead = body.ahead ?? [];
    if (!Array.isArray(ahead) || ahead.length > MAX_AHEAD || !ahead.every(id => typeof id === 'string' && SONG_ID.test(id))) {
      res.status(400).json({ error: 'ahead is a list of song ids' });
      return;
    }
    const prompt = body.prompt === undefined ? '' : promptOf(body.prompt) ?? '';
    try {
      res.json(await radioService.next({ criteria, pool, count, ahead, prompt }));
    } catch (error) {
      failed(res, 'no songs', error);
    }
  },

  left: async (req: Request, res: Response): Promise<void> => {
    const { songId, how } = req.body || {};
    if (typeof songId !== 'string' || !SONG_ID.test(songId)) { res.status(400).json({ error: 'A song id is needed' }); return; }
    if (how !== 'played' && how !== 'skipped') { res.status(400).json({ error: 'how is played or skipped' }); return; }
    await radioService.left(songId, how);
    res.json({ ok: true });
  },

  fiches: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await trackFicheService.status());
    } catch (error) {
      failed(res, 'no fiches counted', error);
    }
  },

  /** A pool's songs with no fiche put first in the writer's queue. */
  askFiches: async (req: Request, res: Response): Promise<void> => {
    const pool = poolOf(req.body?.pool);
    if (!pool) { res.status(400).json({ error: 'A pool is needed: stars, hearts, popular, genre, wholeWorks' }); return; }
    try {
      res.json(await trackFicheService.ask(pool));
    } catch (error) {
      failed(res, 'no fiches asked', error);
    }
  },
};

export default radioController;
