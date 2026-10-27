import { describe, it, expect } from 'vitest';
import { playerTracksOf, shuffledTracks } from './playAlbum';
import type { RipTracks } from '../services/musicService';

const file = (discNumber: number, track: number, title: string) => ({
  id: `s${discNumber}-${track}`, url: null, discNumber, track, title, durationSec: 200,
  suffix: 'flac', bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: null,
});

const rip = (tracks: ReturnType<typeof file>[]): RipTracks =>
  ({ configured: true, found: true, album: { id: 'nd-1', name: 'This Is the Life' }, tracks } as unknown as RipTracks);

describe('playerTracksOf', () => {
  it('plays the CD’s tracks that have a file, with the CD’s titles', () => {
    const album = { id: 1, title: 'A', discs: [{ number: 1, tracks: [{ no: 1, title: 'One' }, { no: 2, title: 'Two' }] }] };

    expect(playerTracksOf(album, rip([file(1, 2, 'two.flac')])).map(track => [track.songId, track.title]))
      .toEqual([['s1-2', 'Two']]);
  });

  it('plays the rip as it is when DexVault knows no tracks of the album, a wish say', () => {
    const wish = { id: 249, title: 'This Is the Life', discs: [] };

    expect(playerTracksOf(wish, rip([file(1, 2, 'This Is the Life'), file(1, 1, 'Mr. Rock & Roll')])).map(track => [track.no, track.title]))
      .toEqual([[1, 'Mr. Rock & Roll'], [2, 'This Is the Life']]);
  });

  it('carries the CD’s most listened tracks, for their dot in the player', () => {
    const album = { id: 1, title: 'A', discs: [{ number: 1, tracks: [{ no: 1, title: 'One', popular: true }, { no: 2, title: 'Two' }] }] };

    expect(playerTracksOf(album, rip([file(1, 1, 'one.flac'), file(1, 2, 'two.flac')])).map(track => track.popular))
      .toEqual([true, undefined]);
  });

  it('has nothing to play without a rip', () => {
    expect(playerTracksOf({ id: 1, title: 'A', discs: [] }, null)).toEqual([]);
  });
});

describe('shuffledTracks', () => {
  const song = (place: number) => ({ songId: `s${place}`, title: `Song ${place}`, disc: 1, no: place + 1, durationSec: 200, place });

  it('plays every song once, numbered as they play, each keeping its place in the mixtape', () => {
    const draws = [0, 0.99, 0.5];
    const shuffled = shuffledTracks([song(0), song(1), song(2), song(3)], () => draws.shift() ?? 0);

    expect(shuffled.map(track => track.no)).toEqual([1, 2, 3, 4]);
    expect(shuffled.map(track => track.place).sort()).toEqual([0, 1, 2, 3]);
    expect(shuffled.map(track => track.place)).not.toEqual([0, 1, 2, 3]);
  });

  it('leaves the tracks it is given as they are', () => {
    const tracks = [song(0), song(1)];
    shuffledTracks(tracks, () => 0);
    expect(tracks.map(track => track.no)).toEqual([1, 2]);
  });
});
