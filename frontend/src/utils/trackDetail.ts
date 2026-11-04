import type { RipTrackFile } from '../services/musicService';
import type { TrackPerformer } from './trackCredits';

/** Each person once, with every role MusicBrainz gave them on the track, in credit order. */
export const performersByPerson = (performers: TrackPerformer[]): Array<{ name: string; roles: string[] }> => {
  const people = new Map<string, string[]>();
  for (const performer of performers) {
    const roles = people.get(performer.name) || [];
    for (const role of performer.role.split(', ').filter(Boolean)) if (!roles.includes(role)) roles.push(role);
    people.set(performer.name, roles);
  }
  return [...people.entries()].map(([name, roles]) => ({ name, roles }));
};

/**
 * The people who hold the same roles, together under them, in credit order:
 * the four violins of "Eleanor Rigby" under one "violin", and Norah Jones
 * once under "piano, lead vocals". Roles match whatever their order.
 */
export const peopleByRoles = (people: Array<{ name: string; roles: string[] }>): Array<{ roles: string[]; names: string[] }> => {
  const groups = new Map<string, { roles: string[]; names: string[] }>();
  for (const person of people) {
    const key = [...person.roles].map(role => role.toLocaleLowerCase()).sort().join('|');
    const group = groups.get(key);
    if (group) group.names.push(person.name);
    else groups.set(key, { roles: person.roles, names: [person.name] });
  }
  return [...groups.values()];
};

/** The rip's file for a track: same disc, same number. */
export const ripFileFor = (files: RipTrackFile[], disc: number, track: number): RipTrackFile | null =>
  files.find(file => file.discNumber === disc && file.track === track) ?? null;

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'stereo' };

/**
 * An .m4a is ALAC at 400 kbps or more: Navidrome gives AAC a bit depth of 16
 * too, and AAC stops at 320. Without a bitrate, a bit depth means ALAC.
 */
export const isAlac = (file: Pick<RipTrackFile, 'bitRate' | 'bitDepth'>): boolean =>
  file.bitRate ? file.bitRate >= 400 : Boolean(file.bitDepth);

/** "FLAC", "ALAC", "AAC": an .m4a named by what it holds. */
export const formatName = (file: RipTrackFile): string =>
  (file.suffix === 'm4a' ? (isAlac(file) ? 'alac' : 'aac') : file.suffix).toUpperCase();

/** "FLAC · 16-bit · 44.1 kHz · stereo", what tells a CD-quality rip at a glance; no bit depth for AAC. */
export const ripFormat = (file: RipTrackFile): string => [
  formatName(file),
  file.bitDepth && formatName(file) !== 'AAC' ? `${file.bitDepth}-bit` : null,
  file.samplingRate ? `${(file.samplingRate / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} kHz` : null,
  file.channelCount ? CHANNELS[file.channelCount] || `${file.channelCount} channels` : null,
].filter(Boolean).join(' · ');

/** "912 kbps · 38.4 MB" */
export const ripSize = (file: RipTrackFile): string => [
  file.bitRate ? `${file.bitRate} kbps` : null,
  file.size ? `${(file.size / 1_000_000).toFixed(1)} MB` : null,
].filter(Boolean).join(' · ');

/** "Thom Yorke; Jonny Greenwood" in an input, back to a list; names never carry a semicolon. */
export const joinNames = (names: string[] | undefined): string => (names || []).join('; ');
export const splitNames = (text: string): string[] =>
  text.split(';').map(name => name.trim()).filter(Boolean);
