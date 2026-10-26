import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import configManager from '../config';
import navidromeService from './navidromeService';
import logger from '../logger';

/**
 * A track's wave, for fixing the timing of its words: its loudness slice by
 * slice, read once from the file with ffmpeg and kept on disk beside the
 * images, so that a phone fetches a few kilobytes rather than the whole file.
 */

/** A slice of 20 ms: a voice coming in shows as a step. */
export const BIN_SEC = 0.02;
/** Decoded at a low rate, in mono: enough for a level, and quick. */
const RATE = 8000;
/** A track taking longer than this to read is given up. */
const TIMEOUT_MS = 120_000;

export interface Waveform {
  bin: number;
  /** Each slice's level, 0 to 255, the loud parts of the track near 255. */
  levels: Buffer;
}

/** The levels of 16-bit samples, slice by slice, the loudest of them (bar a few clicks) at 255. */
export const levelsOf = (samples: Int16Array, sampleRate = RATE, bin = BIN_SEC): Buffer => {
  const per = Math.max(1, Math.round(sampleRate * bin));
  const raw = new Float64Array(Math.ceil(samples.length / per));
  for (let slice = 0; slice < raw.length; slice++) {
    let sum = 0;
    const from = slice * per;
    const to = Math.min(samples.length, from + per);
    for (let n = from; n < to; n++) sum += (samples[n] / 32768) ** 2;
    raw[slice] = Math.sqrt(sum / Math.max(1, to - from));
  }
  const sorted = Float64Array.from(raw).sort();
  const loud = sorted[Math.floor(sorted.length * 0.995)] || 1;
  return Buffer.from(Array.from(raw, level => Math.round(Math.min(1, level / loud) * 255)));
};

const folder = () => path.join(configManager.getDataPath(), 'waveforms');
const fileOf = (songId: string) => path.join(folder(), `${songId}.bin`);

let ffmpegThere: boolean | null = null;
/** Whether ffmpeg can be run here: in the Docker image, not always on a computer in development. */
export const canRead = (): Promise<boolean> => {
  if (ffmpegThere !== null) return Promise.resolve(ffmpegThere);
  return new Promise(resolve => {
    const probe = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
    probe.on('error', () => resolve((ffmpegThere = false)));
    probe.on('close', code => resolve((ffmpegThere = code === 0)));
  });
};

/** Reads a song's file from Navidrome through ffmpeg, as mono 16-bit samples at 8 kHz. */
const decode = async (songId: string): Promise<Int16Array> => {
  const upstream = await navidromeService.stream(songId);
  if (upstream.status >= 400 || upstream.headers['content-type']?.includes('json')) {
    (upstream.data as unknown as { destroy?: () => void }).destroy?.();
    throw new Error('Navidrome has no such song');
  }
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1']);
    const chunks: Buffer[] = [];
    let said = '';
    const timer = setTimeout(() => { ffmpeg.kill('SIGKILL'); reject(new Error('Reading the track took too long')); }, TIMEOUT_MS);
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => { said += chunk.toString(); });
    ffmpeg.on('error', error => { clearTimeout(timer); reject(error); });
    ffmpeg.on('close', code => {
      clearTimeout(timer);
      (upstream.data as unknown as { destroy?: () => void }).destroy?.();
      if (code !== 0) return reject(new Error(`ffmpeg could not read the track${said ? `: ${said.trim().split('\n')[0]}` : ''}`));
      const all = Buffer.concat(chunks);
      resolve(new Int16Array(all.buffer, all.byteOffset, Math.floor(all.length / 2)));
    });
    // ffmpeg may stop reading before the end of a broken file: the rest is let go.
    ffmpeg.stdin.on('error', () => undefined);
    upstream.data.on('error', () => ffmpeg.stdin.destroy());
    upstream.data.pipe(ffmpeg.stdin);
  });
};

const reading = new Map<string, Promise<Waveform>>();

const waveformService = {
  /** Whether a song's wave was read before and is on the disk. */
  kept: (songId: string): boolean => fs.existsSync(fileOf(songId)),

  /** A song's wave, from the disk when it was read before, else read now and kept. Two asking at once share one reading. */
  of: (songId: string): Promise<Waveform> => {
    const file = fileOf(songId);
    if (fs.existsSync(file)) return Promise.resolve({ bin: BIN_SEC, levels: fs.readFileSync(file) });
    const known = reading.get(songId);
    if (known) return known;
    const now = (async () => {
      const levels = levelsOf(await decode(songId));
      fs.mkdirSync(folder(), { recursive: true });
      fs.writeFileSync(file, levels);
      logger.info(`Waveform of song ${songId} read: ${levels.length} slices`);
      return { bin: BIN_SEC, levels };
    })();
    reading.set(songId, now);
    now.catch(() => undefined).finally(() => reading.delete(songId));
    return now;
  },
};

export default waveformService;
