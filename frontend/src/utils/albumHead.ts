import type { RipTrackFile, RipTracks } from '../services/musicService';
import { ripFormat } from './trackDetail';

/*
 * What the head of an album's card says of it: how long it plays, how its rip
 * stands in Navidrome, and what to call a link MusicBrainz gave it.
 */

/** "1 h 18 min", "47 min"; nothing when no track has a duration. */
export const playingTime = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

/** The backend's rule: a rip is lossless when every file is. An .m4a is ALAC when Navidrome reports a bit depth. */
const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aif', 'aiff', 'ape', 'wv']);
export const isLossless = (file: RipTrackFile): boolean =>
  LOSSLESS.has(file.suffix) || (file.suffix === 'm4a' && Boolean(file.bitDepth));
export const formatName = (file: RipTrackFile): string =>
  (file.suffix === 'm4a' ? (file.bitDepth ? 'alac' : 'aac') : file.suffix).toUpperCase();

export interface RipSummary {
  state: 'lossless' | 'lossy';
  /** "FLAC · 16-bit · 44.1 kHz · stereo" when the files agree, else the formats they mix: "FLAC, MP3". */
  format: string;
  files: number;
}

export const ripSummary = (rip: RipTracks): RipSummary | null => {
  if (!rip.found || rip.tracks.length === 0) return null;
  const formats = [...new Set(rip.tracks.map(ripFormat))];
  return {
    state: rip.tracks.every(isLossless) ? 'lossless' : 'lossy',
    format: formats.length === 1 ? formats[0] : [...new Set(rip.tracks.map(formatName))].join(', '),
    files: rip.tracks.length,
  };
};

const URL_LABELS: Record<string, string> = {
  appleMusic: 'Apple Music',
  discogs: 'Discogs',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  allmusic: 'AllMusic',
  'official homepage': 'Official site',
  'purchase for download': 'Download',
  'streaming music': 'Streaming',
};

/** A link's name: the sites DexVault knows by name, any other key in sentence case. */
export const urlLabel = (key: string): string => {
  if (URL_LABELS[key]) return URL_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
