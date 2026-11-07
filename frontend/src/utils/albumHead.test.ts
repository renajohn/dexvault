import { describe, it, expect } from 'vitest';
import { playingTime, ripSummary, urlLabel } from './albumHead';
import type { RipTrackFile } from '../services/musicService';

const file = (over: Partial<RipTrackFile> = {}): RipTrackFile => ({
  discNumber: 1, track: 1, title: 'A', durationSec: 200, suffix: 'flac', bitRate: 900,
  bitDepth: 16, samplingRate: 44100, channelCount: 2, size: 20_000_000, path: 'a.flac', ...over,
});

describe('playingTime', () => {
  it('says minutes, then hours and minutes', () => {
    expect(playingTime(47 * 60 + 20)).toBe('47 min');
    expect(playingTime(78 * 60)).toBe('1 h 18 min');
    expect(playingTime(0)).toBe('');
  });
});

describe('ripSummary', () => {
  it('reads a CD-quality rip as lossless, with the format its files share', () => {
    const rip = { configured: true, found: true, tracks: [file(), file({ track: 2 })] };
    expect(ripSummary(rip)).toEqual({ state: 'lossless', format: 'FLAC · 16-bit · 44.1 kHz · stereo', files: 2 });
  });

  it('reads a rip with an MP3 among the files as lossy, naming what it mixes', () => {
    const rip = { configured: true, found: true, tracks: [file(), file({ track: 2, suffix: 'mp3', bitRate: 320, bitDepth: null, samplingRate: null })] };
    expect(ripSummary(rip)).toEqual({ state: 'lossy', format: 'FLAC, MP3', files: 2, label: 'MP3 320' });
  });

  it('names a lossy rip as the grid does, its bitrate weighed by length', () => {
    const mp3 = (over: Partial<RipTrackFile>) => file({ suffix: 'mp3', bitDepth: null, ...over });
    const rip = { configured: true, found: true, tracks: [mp3({ bitRate: 128, durationSec: 300 }), mp3({ track: 2, bitRate: 96, durationSec: 100 })] };
    expect(ripSummary(rip)?.label).toBe('MP3 120');
  });

  it('knows an .m4a as ALAC by its bitrate, Navidrome giving AAC a bit depth too', () => {
    expect(ripSummary({ configured: true, found: true, tracks: [file({ suffix: 'm4a' })] })?.state).toBe('lossless');
    const aac = ripSummary({ configured: true, found: true, tracks: [file({ suffix: 'm4a', bitRate: 256 })] });
    expect(aac?.state).toBe('lossy');
    expect(aac?.format).toContain('AAC');
    expect(ripSummary({ configured: true, found: true, tracks: [file({ suffix: 'm4a', bitRate: null, bitDepth: null })] })?.state).toBe('lossy');
  });

  it('has nothing to say of a CD that is not ripped', () => {
    expect(ripSummary({ configured: true, found: false, tracks: [] })).toBeNull();
  });
});

describe('urlLabel', () => {
  it('names the sites it knows, and sentence-cases any other key', () => {
    expect(urlLabel('appleMusic')).toBe('Apple Music');
    expect(urlLabel('official homepage')).toBe('Official site');
    expect(urlLabel('bandcampPage')).toBe('Bandcamp page');
  });
});
