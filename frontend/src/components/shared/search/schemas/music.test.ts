import { describe, expect, it } from 'vitest';
import { canonicalQuery, findKey, parseNumber, parseToken } from '../query';
import { musicSchema } from './music';

const { keys } = musicSchema;

/**
 * The keys the backend reads (backend/src/models/album.ts, favouriteAlbumService, utils/ficheFilters), mixtape:
 * aside, the mixtapes having their own view of MusicDex.
 */
const BACKEND_KEYS = [
  'artist', 'title', 'genre', 'track', 'label', 'country', 'composer', 'performer', 'conductor', 'instrument', 'work',
  'year', 'stars', 'cd', 'file', 'ripped', 'rated', 'classical', 'favourites', 'mood', 'style', 'energy', 'tempo',
];

describe('MusicDex’s search keys', () => {
  it('are the keys the backend reads, each once', () => {
    expect(keys.map(k => k.key).sort()).toEqual([...BACKEND_KEYS].sort());
    const names = keys.flatMap(k => [k.key, ...(k.aliases || [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('each says what it finds, in a sentence, under a group', () => {
    for (const k of keys) {
      expect(k.group, k.key).toBeTruthy();
      expect(k.desc, k.key).toMatch(/^[A-Z]/);
      expect(k.desc, k.key).not.toMatch(/\bCDs? of\b/); // an album, not a CD (design-guidelines, principle 9)
    }
  });

  it('keep the groups together, in their order', () => {
    const groups = keys.map(k => k.group).filter((g, i, all) => all.indexOf(g) === i);
    expect(groups).toEqual(['Who', 'What', 'How it sounds', 'When', 'Your stars', 'CD and files']);
    const order = keys.map(k => groups.indexOf(k.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('give an example of the others than yes/no, written as they are read', () => {
    for (const k of keys.filter(k => k.type !== 'bool')) {
      expect(k.example, k.key).toBeTruthy();
      const t = parseToken(k.example!, keys);
      expect(t.def?.key, k.key).toBe(k.key);
      expect(t.error, k.key).toBeUndefined();
    }
  });

  it('a yes/no key offers yes and no, each said', () => {
    for (const k of keys.filter(k => k.type === 'bool')) {
      expect(k.values?.map(v => v.value), k.key).toEqual(['yes', 'no']);
      expect(k.values?.every(v => v.desc), k.key).toBe(true);
    }
  });

  it('offer numbers the parsers read: decades for the year, stars from 0 to 5', () => {
    for (const k of keys.filter(k => k.type === 'number')) {
      expect(k.shortcuts?.length, k.key).toBeGreaterThan(0);
      for (const s of k.shortcuts || []) expect(parseNumber(s.value), `${k.key}:${s.value}`).not.toBeNull();
    }
    expect(findKey('year', keys)?.shortcuts?.map(s => s.value)).toContain('1960-1969');
    expect(findKey('stars', keys)?.shortcuts?.map(s => s.value)).toEqual(expect.arrayContaining(['5', '>=4', '0']));
  });

  it('the words of the collection: suggested for the text keys, titles and tracks kept out of a plain word’s', () => {
    for (const k of keys.filter(k => k.type === 'text')) expect(k.suggest, k.key).toBeTypeOf('function');
    expect(findKey('title', keys)?.valuesForWords).toBe(false);
    expect(findKey('track', keys)?.valuesForWords).toBe(false);
  });

  it('write old words and other names as the backend reads them', () => {
    expect(canonicalQuery('cd:true !ripped:without fav:1 by:Bowie classical:N', keys))
      .toBe('cd:yes -ripped:no favourites:yes artist:Bowie classical:no');
    expect(canonicalQuery('file:LOSSY,lossless year:1960-1969,>=2020 -stars:<3', keys))
      .toBe('file:lossy,lossless year:1960-1969,>=2020 -stars:<3');
  });
});
