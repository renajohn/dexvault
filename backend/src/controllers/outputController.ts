import { Request, Response } from 'express';
import outputs from '../services/upnp/outputs';
import { OutputTakenError, OutputUnreachableError, type OutputSession } from '../services/upnp/session';
import { entryKey, parseEntryKey } from '../services/upnp/turn';
import { shuffledTracks, type PlayerAlbum, type PlayerTrack } from '../services/playable';
import logger from '../logger';

/** A Navidrome song id: letters, digits, dashes and underscores, never a path. */
const SONG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TRACKS = 2000;

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const count = (value: unknown): number => Math.max(0, Math.min(1e6, Math.floor(Number(value) || 0)));
const seconds = (value: unknown): number => Math.max(0, Math.min(1e6, Number(value) || 0));
const optionalText = (value: unknown, max: number): string | null => (value == null || value === '' ? null : text(value, max));

/** An album as a page sends it, kept to what it should hold. */
const albumOf = (value: unknown): PlayerAlbum | null => {
  if (!value || typeof value !== 'object') return null;
  const album = value as Record<string, unknown>;
  return {
    id: Number(album.id) || null,
    navidromeId: optionalText(album.navidromeId, 64),
    url: optionalText(album.url, 500),
    title: text(album.title, 300),
    artist: text(album.artist, 300),
    cover: optionalText(album.cover, 500),
    disc: Number(album.disc) || null,
  };
};

/** Its tracks, each with a song id Navidrome could have; null when one is not. */
const tracksOf = (value: unknown): PlayerTrack[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRACKS) return null;
  const tracks: PlayerTrack[] = [];
  for (const item of value) {
    const track = (item || {}) as Record<string, unknown>;
    const songId = String(track.songId ?? '');
    if (!SONG_ID.test(songId)) return null;
    tracks.push({
      songId, title: text(track.title, 300), disc: count(track.disc) || 1, no: count(track.no),
      durationSec: track.durationSec == null ? null : seconds(track.durationSec),
      ...(track.starred != null ? { starred: Boolean(track.starred) } : {}),
      ...(track.popular ? { popular: true } : {}),
      ...(track.artist != null ? { artist: text(track.artist, 300) } : {}),
      ...(track.albumId !== undefined ? { albumId: Number(track.albumId) || null } : {}),
      ...(track.cover !== undefined ? { cover: optionalText(track.cover, 500) } : {}),
      ...(track.place != null ? { place: count(track.place) } : {}),
      ...(track.suffix != null ? { suffix: text(track.suffix, 8).toLowerCase() } : {}),
      ...(track.lossless != null ? { lossless: Boolean(track.lossless) } : {}),
      ...(track.format != null ? { format: text(track.format, 12) } : {}),
    });
  }
  return tracks;
};

/** The session of the appliance in the path; else 404. */
const sessionOf = (req: Request, res: Response): OutputSession | null => {
  const session = outputs.session(String(req.params.id));
  if (!session) res.status(404).json({ error: 'No such output' });
  return session;
};

/** What went wrong, as the page reads it: 409 taken, 503 away (the play kept for when it answers, if it is), 404 unknown album. */
const fail = (res: Response, error: unknown, what: string, session?: OutputSession): void => {
  const status = (error as { status?: number }).status;
  if (status) res.status(status).json({ error: (error as Error).message });
  else if (error instanceof OutputTakenError) res.status(409).json({ error: error.message, status: 'taken' });
  else if (error instanceof OutputUnreachableError) {
    const kept = session?.wantsPlay() ? `${outputs.nameOf(session.id)} does not answer: it will play once it is on` : error.message;
    res.status(503).json({ error: kept, status: 'unreachable' });
  }
  else if ((error as Error).message === 'Album not found') res.status(404).json({ error: 'Album not found' });
  else {
    logger.warn(`${what}: ${(error as Error).message}`);
    res.status(502).json({ error: (error as Error).message });
  }
};

/** A command, answered with the session's state once the appliance has it. */
const command = (what: string, work: (session: OutputSession, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response): Promise<void> => {
    const session = sessionOf(req, res);
    if (!session) return;
    try {
      await work(session, req);
      res.json(session.state());
    } catch (error) {
      fail(res, error, `${what} on ${outputs.nameOf(session.id)}`, session);
    }
  };

/**
 * The appliances DexVault plays on (UPnP), and what plays there: the same
 * commands as the page's own player, sent to the session, which tells every
 * page what then plays.
 */
const outputController = {
  // GET: the appliances, with what plays on each
  list: (_req: Request, res: Response): void => {
    res.json(outputs.list());
  },

  // GET: `state`, `left` and `outputs`, as Server-Sent Events
  events: (req: Request, res: Response): void => {
    const stop = outputs.listen(res);
    if (stop) req.on('close', stop);
    else res.status(429).json({ error: 'Too many pages listening' });
  },

  /**
   * POST { albumId, disc?, index?, shuffle?, listenNext?, position? }: an album of DexVault;
   * { album, tracks, index?, position?, listenNext? }: tracks the page made (a play carried over);
   * { from }: what plays on another output, carried over at its place, that one paused.
   */
  play: command('Playing', async (session, req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.from != null) {
      const from = outputs.session(String(body.from));
      const handed = from?.handOver();
      if (!from || !handed) throw Object.assign(new Error('Nothing plays there'), { status: 400 });
      await from.pauseForTransfer();
      await session.carryOver(handed.album, handed.tracks, handed.index, handed.position, handed.turn);
      return;
    }
    if (body.tracks != null) {
      const album = albumOf(body.album);
      const tracks = tracksOf(body.tracks);
      if (!album || !tracks) throw Object.assign(new Error('Which album, which tracks?'), { status: 400 });
      const index = Math.min(count(body.index), tracks.length - 1);
      await session.carryOver(album, tracks, index, seconds(body.position), body.listenNext === true ? 'listenNext' : null);
      return;
    }
    const albumId = count(body.albumId);
    if (!albumId) throw Object.assign(new Error('Which album?'), { status: 400 });
    const disc = count(body.disc);
    if (body.listenNext === true) {
      if (!await session.playListenNext(entryKey(albumId, disc), count(body.index))) throw Object.assign(new Error('Nothing to play there'), { status: 404 });
      return;
    }
    const { album, tracks } = await outputs.load(albumId, { disc });
    if (tracks.length === 0) throw Object.assign(new Error('That album has no rip to play'), { status: 404 });
    if (body.shuffle === true) await session.playAlbum(album, shuffledTracks(tracks), 0);
    else await session.playAlbum(album, tracks, count(body.index), seconds(body.position));
  }),

  // POST { key? } or { albumId?, disc? }: Listen Next played there, from that entry, else from the top
  listenNext: command('Playing Listen Next', async (session, req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' && /^\d+:\d+$/.test(body.key)
      ? entryKey(parseEntryKey(body.key).albumId, parseEntryKey(body.key).disc)
      : count(body.albumId) ? entryKey(count(body.albumId), count(body.disc)) : null;
    if (!await session.playListenNext(key, count(body.index))) throw Object.assign(new Error('Nothing in Listen Next to play'), { status: 404 });
  }),

  toggle: command('Pausing', (session, req) => session.toggle(typeof req.body?.playing === 'boolean' ? req.body.playing : undefined)),
  next: command('Next track', session => session.next()),
  previous: command('Previous track', session => session.previous()),
  stop: command('Stopping', session => session.stop()),
  resume: command('Resuming', session => session.resume()),

  // POST { index }
  track: command('Playing a track', (session, req) => {
    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0) throw Object.assign(new Error('Which track?'), { status: 400 });
    return session.playTrack(index);
  }),

  // POST { position } in seconds
  seek: command('Seeking', (session, req) => {
    const position = Number(req.body?.position);
    if (!Number.isFinite(position) || position < 0) throw Object.assign(new Error('Where to?'), { status: 400 });
    return session.seek(position);
  }),

  // PUT { volume?, muted? }: never above the output's ceiling
  volume: command('Setting the volume', (session, req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const volume = body.volume == null ? undefined : Number(body.volume);
    if ((volume !== undefined && !Number.isFinite(volume)) || (body.muted != null && typeof body.muted !== 'boolean')) {
      throw Object.assign(new Error('Expected { volume?: number, muted?: boolean }'), { status: 400 });
    }
    return session.setVolume({ volume, muted: body.muted as boolean | undefined });
  }),

  // PUT { name?, maxVolume? }: the name shown (empty: the appliance's own) and the volume's ceiling
  settings: async (req: Request, res: Response): Promise<void> => {
    const body = (req.body || {}) as Record<string, unknown>;
    const maxVolume = body.maxVolume === undefined ? undefined : body.maxVolume === null ? null : Number(body.maxVolume);
    if (maxVolume != null && (!Number.isFinite(maxVolume) || maxVolume < 0 || maxVolume > 100)) {
      res.status(400).json({ error: 'maxVolume must be between 0 and 100' });
      return;
    }
    try {
      const listed = await outputs.setSettings(String(req.params.id), {
        ...(body.name !== undefined ? { name: body.name == null ? null : String(body.name) } : {}),
        ...(maxVolume !== undefined ? { maxVolume } : {}),
      });
      if (listed) res.json(listed);
      else res.status(404).json({ error: 'No such output' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
};

export default outputController;
