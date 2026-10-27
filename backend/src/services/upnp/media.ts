import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import navidromeService from '../navidromeService';
import Album from '../../models/album';
import configManager from '../../config';
import { DLNA_FEATURES } from './didl';
import logger from '../../logger';

/**
 * The media listener: plain HTTP on a port of its own, for the appliances.
 * They cannot follow Traefik's redirect to HTTPS, and must never be given
 * Navidrome's credentials; so the files go through here, by a session's
 * token, as Navidrome gives them (format=raw: no transcoding), a Range
 * passed on for a seek. Nothing else is served: no API on this port.
 *
 *   GET|HEAD /upnp/stream/:token/:songId.:ext
 *   GET      /upnp/cover/:token/:albumId.jpg
 */

/** A token lives as long as its session, and this long after: a track given just before still plays. */
const GRACE_MS = 10 * 60 * 1000;
/** Some appliances refuse WebP or a large image: a JPEG this wide. */
const COVER_WIDTH = 600;
const SONG_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Tokens alive, with when they stop being so (null: while their session lives). */
const tokens = new Map<string, number | null>();

export const mediaTokens = {
  /** 32 random bytes, for a new session. */
  issue: (): string => {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, null);
    return token;
  },
  /** A token read back with its session after a restart. */
  adopt: (token: string): void => { tokens.set(token, null); },
  /** Its session gone: alive a while yet. */
  retire: (token: string, now = Date.now()): void => { if (tokens.has(token)) tokens.set(token, now + GRACE_MS); },
  isValid: (token: string, now = Date.now()): boolean => {
    if (!tokens.has(token)) return false;
    const until = tokens.get(token);
    if (until != null && until < now) {
      tokens.delete(token);
      return false;
    }
    return true;
  },
  /** For the tests. */
  clear: (): void => tokens.clear(),
};

const notFound = (res: http.ServerResponse): void => {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
};

const stream = async (req: http.IncomingMessage, res: http.ServerResponse, songId: string): Promise<void> => {
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  // Closed before Navidrome answers (the appliance given another track meanwhile): the close is seen now, not missed.
  let gone = false;
  res.on('close', () => { gone = true; });
  let upstream;
  try {
    upstream = await navidromeService.stream(songId, range);
  } catch (error) {
    logger.warn(`Streaming song ${songId} to an appliance: ${(error as Error).message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Navidrome does not answer');
    return;
  }
  const destroy = () => (upstream.data as unknown as { destroy?: () => void }).destroy?.();
  if (gone) {
    destroy();
    return;
  }
  // Subsonic answers an unknown song with a JSON error, not with sound.
  if (upstream.status >= 400 || upstream.headers['content-type']?.includes('json')) {
    destroy();
    notFound(res);
    return;
  }
  const headers: Record<string, string> = { ...upstream.headers, 'Cache-Control': 'no-store' };
  if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
  // What a DLNA appliance asks for: how the file is sent, and that it can be sought in.
  if (req.headers['transfermode.dlna.org'] || req.headers['getcontentfeatures.dlna.org']) headers['transferMode.dlna.org'] = 'Streaming';
  if (req.headers['getcontentfeatures.dlna.org']) headers['contentFeatures.dlna.org'] = DLNA_FEATURES;
  res.writeHead(upstream.status, headers);
  if (req.method === 'HEAD') {
    destroy();
    res.end();
    return;
  }
  // The appliance closes the connection to skip or seek: stop reading from Navidrome too.
  res.on('close', destroy);
  upstream.data.on('error', error => {
    logger.warn(`Streaming song ${songId} to an appliance: ${(error as Error).message}`);
    res.destroy();
  });
  upstream.data.pipe(res);
};

/** The album's cover in DexVault, as a JPEG of 600px at most. */
const cover = async (res: http.ServerResponse, albumId: number): Promise<void> => {
  const album = await Album.findById(albumId).catch(() => null);
  const image = album?.cover?.replace(/^\/(api\/)?images\//, '');
  if (!image || /^https?:/.test(image)) return notFound(res);
  const root = path.resolve(configManager.getImagesPath());
  const source = path.resolve(root, image);
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source)) return notFound(res);
  try {
    const jpeg = await sharp(source).rotate().resize({ width: COVER_WIDTH, height: COVER_WIDTH, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length, 'Cache-Control': 'max-age=3600' });
    res.end(jpeg);
  } catch (error) {
    logger.warn(`The cover of album ${albumId} for an appliance: ${(error as Error).message}`);
    notFound(res);
  }
};

/** What the listener answers: a file, a cover, or 404 for everything else. */
export const handleMedia = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  const url = new URL(req.url || '/', 'http://media');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'upnp' || !mediaTokens.isValid(parts[2])) return notFound(res);
  const [, kind, , file] = parts;
  if (kind === 'stream' && (req.method === 'GET' || req.method === 'HEAD')) {
    const songId = decodeURIComponent(file).replace(/\.[a-z0-9]{1,5}$/i, '');
    if (!SONG_ID.test(songId)) return notFound(res);
    return stream(req, res, songId);
  }
  if (kind === 'cover' && req.method === 'GET') {
    const albumId = Number(/^(\d{1,10})\.jpg$/.exec(file)?.[1]);
    if (!albumId) return notFound(res);
    return cover(res, albumId);
  }
  notFound(res);
};

/** The listener, on its port; resolved once it listens. */
export const startMediaServer = (port: number, host?: string): Promise<http.Server> => new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    handleMedia(req, res).catch(error => {
      logger.warn(`Media listener: ${(error as Error).message}`);
      if (!res.headersSent) notFound(res);
      else res.destroy();
    });
  });
  // A file is read for as long as the track lasts, and paused a while.
  server.requestTimeout = 0;
  server.keepAliveTimeout = 60_000;
  server.once('error', reject);
  server.listen(port, host, () => {
    server.off('error', reject);
    resolve(server);
  });
});
