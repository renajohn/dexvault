import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/musicService', () => ({ default: { getImageUrl: vi.fn(() => null) } }));

import { heldOf, moveUnit, toggleSongs, unitsOf, type Places } from './mixtapeCompose';
import { shuffledTracks } from './playAlbum';
import type { PlayerTrack } from '../services/player';

describe('composing a mixtape', () => {
  it('says whether songs are all there, some, or none', () => {
    expect(heldOf(['a', 'b'], ['a', 'b'])).toBe('all');
    expect(heldOf(['a'], ['a', 'b'])).toBe('some');
    expect(heldOf(['c'], ['a', 'b'])).toBe('none');
  });

  it('adds what is missing at the end, never a second copy, and takes all out when all are there', () => {
    const places: Places = new Map();
    expect(toggleSongs(['x', 'a'], ['a', 'b', 'c'], places)).toEqual(['x', 'a', 'b', 'c']);
    expect(toggleSongs(['x', 'a', 'b', 'c'], ['a', 'b', 'c'], places)).toEqual(['x']);
  });

  it('puts a song taken out back where it stood, while the words are kept', () => {
    const places: Places = new Map();
    const out = toggleSongs(['a', 'b', 'c', 'd'], ['b'], places);
    expect(out).toEqual(['a', 'c', 'd']);
    expect(toggleSongs(out, ['b'], places)).toEqual(['a', 'b', 'c', 'd']);
    // Forgotten (the words changed): it comes at the end.
    places.clear();
    expect(toggleSongs(toggleSongs(['a', 'b', 'c'], ['a'], places), ['a'], new Map())).toEqual(['b', 'c', 'a']);
  });

  it('puts an album back whole, each song where it stood', () => {
    const places: Places = new Map();
    const out = toggleSongs(['x', 'a1', 'y', 'a2'], ['a1', 'a2'], places);
    expect(out).toEqual(['x', 'y']);
    expect(toggleSongs(out, ['a1', 'a2'], places)).toEqual(['x', 'a1', 'y', 'a2']);
  });

  it('reads a work\'s movements in a row as one unit, and moves it whole', () => {
    const songs = [
      { work: null, albumId: 1 },
      { work: 'Symphony no. 9', albumId: 2 }, { work: 'Symphony no. 9', albumId: 2 }, { work: 'Symphony no. 9', albumId: 2 },
      { work: 'Symphony no. 9', albumId: 3 },
      { work: null, albumId: 4 },
    ];
    const units = unitsOf(songs);
    expect(units).toEqual([
      { start: 0, end: 0, work: null },
      { start: 1, end: 3, work: 'Symphony no. 9' },
      // One movement of another recording, alone: a song alone.
      { start: 4, end: 4, work: null },
      { start: 5, end: 5, work: null },
    ]);
    const ids = ['s', 'm1', 'm2', 'm3', 'o', 't'];
    expect(moveUnit(ids, units, 1, 3)).toEqual(['s', 'o', 'm1', 'm2', 'm3', 't']);
    expect(moveUnit(ids, units, 1, 4)).toEqual(['s', 'o', 't', 'm1', 'm2', 'm3']);
    expect(moveUnit(ids, units, 3, 0)).toEqual(['t', 's', 'm1', 'm2', 'm3', 'o']);
    expect(moveUnit(ids, units, 1, 2)).toEqual(ids);
  });
});

describe('a mixtape shuffled', () => {
  const track = (songId: string, work: string | null = null, albumId = 1): PlayerTrack =>
    ({ songId, title: songId, disc: 1, no: 1, durationSec: 60, albumId, work });

  it('keeps a work\'s movements together and in their order', () => {
    const tracks = [track('a'), track('m1', 'Symphony', 2), track('m2', 'Symphony', 2), track('m3', 'Symphony', 2), track('b'), track('c')];
    for (let draw = 0; draw < 30; draw++) {
      const order = shuffledTracks(tracks).map(one => one.songId);
      expect([...order].sort()).toEqual(['a', 'b', 'c', 'm1', 'm2', 'm3']);
      const at = order.indexOf('m1');
      expect(order.slice(at, at + 3)).toEqual(['m1', 'm2', 'm3']);
    }
  });

  it('numbers the tracks again as they will play', () => {
    expect(shuffledTracks([track('a'), track('b')]).map(one => one.no)).toEqual([1, 2]);
  });
});
