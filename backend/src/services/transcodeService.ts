import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import configManager from '../config';
import navidromeService from './navidromeService';
import logger from '../logger';

/**
 * A song made lighter for a browser on a weak network (an iPhone in the car):
 * AAC at 256 kbit/s in an .m4a, about a third of the FLAC. Encoded whole with
 * ffmpeg and kept on disk, so that it is served as a file, its length known
 * and every Range answered: Safari on an iPhone plays nothing it cannot ask
 * a range of, and Navidrome's own transcoding streams without one the first
 * time. For this browser alone: the appliances (Salon, Bureau) are always
 * given the file as it lies on disk.
 */

export const BITRATE_KBPS = 256;
/** A long movement takes a while: given up past this. */
const TIMEOUT_MS = 5 * 60_000;
/** What the files may take on the disk, the oldest played going first. About 400 tracks. */
const CAP_BYTES = Number(process.env.TRANSCODE_CACHE_MB || 3000) * 1024 * 1024;

const folder = () => path.join(configManager.getDataPath(), 'transcodes');
export const fileOf = (songId: string) => path.join(folder(), `${songId}-aac${BITRATE_KBPS}.m4a`);

/** Encodes a song's file from Navidrome into `target`, through a file of its own until it is whole. */
const encode = async (songId: string, target: string): Promise<void> => {
  const upstream = await navidromeService.stream(songId);
  if (upstream.status >= 400 || upstream.headers['content-type']?.includes('json')) {
    (upstream.data as unknown as { destroy?: () => void }).destroy?.();
    throw new Error('Navidrome has no such song');
  }
  fs.mkdirSync(folder(), { recursive: true });
  const partial = `${target}.${process.pid}.part`;
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-vn',
      '-c:a', 'aac', '-b:a', `${BITRATE_KBPS}k`, '-movflags', '+faststart', '-f', 'mp4', '-y', partial,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let said = '';
    const timer = setTimeout(() => { ffmpeg.kill('SIGKILL'); reject(new Error('Encoding the track took too long')); }, TIMEOUT_MS);
    ffmpeg.stderr.on('data', (chunk: Buffer) => { said += chunk.toString(); });
    ffmpeg.on('error', error => { clearTimeout(timer); reject(error); });
    ffmpeg.on('close', code => {
      clearTimeout(timer);
      (upstream.data as unknown as { destroy?: () => void }).destroy?.();
      if (code !== 0) return reject(new Error(`ffmpeg could not encode the track${said ? `: ${said.trim().split('\n')[0]}` : ''}`));
      resolve();
    });
    ffmpeg.stdin.on('error', () => undefined);
    upstream.data.on('error', () => ffmpeg.stdin.destroy());
    upstream.data.pipe(ffmpeg.stdin);
  }).catch(error => {
    fs.rmSync(partial, { force: true });
    throw error;
  });
  fs.renameSync(partial, target);
};

/** The oldest played files let go until the folder is under its cap again. */
const prune = () => {
  try {
    const files = fs.readdirSync(folder())
      .filter(name => name.endsWith('.m4a'))
      .map(name => {
        const file = path.join(folder(), name);
        const stat = fs.statSync(file);
        return { file, size: stat.size, at: stat.mtimeMs };
      })
      .sort((a, b) => a.at - b.at);
    let total = files.reduce((sum, one) => sum + one.size, 0);
    for (const one of files) {
      if (total <= CAP_BYTES) break;
      fs.rmSync(one.file, { force: true });
      total -= one.size;
    }
  } catch (error) {
    logger.warn(`Pruning the transcodes: ${(error as Error).message}`);
  }
};

const encoding = new Map<string, Promise<string>>();

/**
 * Two encodings at a time, the last asked first: tracks clicked one after
 * the other quickly each ask for theirs, the one wanted now being the last.
 * Past four waiting, the oldest is given up; the browser asks it again if
 * it still wants it.
 */
const RUNNING_AT_MOST = 2;
const WAITING_AT_MOST = 4;
let running = 0;
const waiting: Array<{ start: () => void; drop: () => void }> = [];

/** An encoding given up for newer ones before it started: 503, to be asked again. */
export class EncodingDropped extends Error {
  constructor() { super('Newer tracks were asked for first'); this.name = 'EncodingDropped'; }
}

const slot = (): Promise<void> => new Promise((resolve, reject) => {
  if (running < RUNNING_AT_MOST) {
    running++;
    resolve();
    return;
  }
  waiting.push({ start: () => { running++; resolve(); }, drop: () => reject(new EncodingDropped()) });
  if (waiting.length > WAITING_AT_MOST) waiting.shift()!.drop();
});

const release = () => {
  running--;
  waiting.pop()?.start();
};

const transcodeService = {
  /** Whether the song's lighter file is on the disk already. */
  kept: (songId: string): boolean => fs.existsSync(fileOf(songId)),

  /** The song's lighter file, encoded now if it is not there yet; two asking at once share one encoding. */
  prepare: (songId: string): Promise<string> => {
    const file = fileOf(songId);
    if (fs.existsSync(file)) {
      // Played again: the last to go.
      const now = new Date();
      try { fs.utimesSync(file, now, now); } catch { /* still there to serve */ }
      return Promise.resolve(file);
    }
    const known = encoding.get(songId);
    if (known) return known;
    const started = Date.now();
    const work = slot().then(() => encode(songId, file).finally(release)).then(() => {
      logger.info(`Song ${songId} encoded in AAC ${BITRATE_KBPS} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      prune();
      return file;
    });
    encoding.set(songId, work);
    work.catch(() => undefined).finally(() => encoding.delete(songId));
    return work;
  },
};

export default transcodeService;
