import { streamUrl } from '../services/player';

/** A track's loudness, slice by slice: what its wave is drawn from. */
export interface Peaks {
  /** Seconds a slice lasts. */
  bin: number;
  /** Each slice's level, 0 to 1, the loud parts of the track near 1. */
  levels: Float32Array;
}

/** A slice of 20 ms: a voice coming in shows as a step. */
const BIN_SEC = 0.02;
/** Decoded at a low rate, mono enough for a wave: a 4 min FLAC takes a few MB instead of 170. */
const RATE = 8000;
/** The tracks read lately, kept for the session: going back to one does not read it again. */
const KEPT = 4;
const kept = new Map<string, Promise<Peaks>>();

/** The levels of decoded sound, slice by slice, the loudest of them (bar a few clicks) at 1. */
export const levelsOf = (channels: Float32Array[], sampleRate: number, bin = BIN_SEC): Float32Array => {
  const per = Math.max(1, Math.round(sampleRate * bin));
  const length = channels[0]?.length ?? 0;
  const levels = new Float32Array(Math.ceil(length / per));
  for (let slice = 0; slice < levels.length; slice++) {
    let sum = 0;
    const from = slice * per;
    const to = Math.min(length, from + per);
    for (const channel of channels) for (let n = from; n < to; n++) sum += channel[n] * channel[n];
    levels[slice] = Math.sqrt(sum / Math.max(1, (to - from) * channels.length));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.995)] || 1;
  for (let slice = 0; slice < levels.length; slice++) levels[slice] = Math.min(1, levels[slice] / loud);
  return levels;
};

/** The wave the server read with ffmpeg and keeps: a few kilobytes. Null where it cannot read (no ffmpeg). */
const fromServer = async (songId: string): Promise<Peaks | null> => {
  const response = await fetch(`/api/music/navidrome/waveform/${encodeURIComponent(songId)}`);
  if (response.status === 501) return null;
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const { bin, levels } = await response.json() as { bin: number; levels: string };
  const bytes = atob(levels);
  return { bin, levels: Float32Array.from(bytes, byte => byte.charCodeAt(0) / 255) };
};

/**
 * A track's wave, the first time it is asked for: from the server, which
 * reads it once and keeps it; where it cannot, from the file itself, read
 * here through DexVault (the whole of it, a few seconds on a phone).
 */
export const peaksOf = (songId: string): Promise<Peaks> => {
  const known = kept.get(songId);
  if (known) return known;
  const reading = (async () => {
    const served = await fromServer(songId).catch(() => null);
    if (served) return served;
    const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Offline) throw new Error('This browser cannot read sound');
    const response = await fetch(streamUrl(songId));
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const sound = await new Offline(1, 1, RATE).decodeAudioData(await response.arrayBuffer());
    const channels = Array.from({ length: sound.numberOfChannels }, (_, i) => sound.getChannelData(i));
    return { bin: BIN_SEC, levels: levelsOf(channels, sound.sampleRate) };
  })();
  kept.set(songId, reading);
  reading.catch(() => kept.delete(songId));
  while (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  return reading;
};
