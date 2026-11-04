import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import { boolOf, normaliseAlbumQuery, takeBoolFilter, takeNumberFilter } from '../../src/utils/albumSearchFilters';

const run = (sql: string, params: unknown[] = []) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const tag = `w${Math.random().toString(36).slice(2, 8)}`;

const insert = (title: string, fields: { status?: string; stars?: number | null; year?: number | null; quality?: string | null; labels?: string[] | null; artist?: string } = {}) =>
  run(
    `INSERT INTO albums (title, artist, title_status, user_rating, release_year, file_quality, labels) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`${title} ${tag}`, JSON.stringify([fields.artist || 'Somebody']), fields.status ?? 'owned', fields.stars ?? null, fields.year ?? null,
      fields.quality ?? null, fields.labels === null ? null : JSON.stringify(fields.labels || ['Label'])],
  );

/** The titles a search finds, the tag gone, in order. */
const titles = async (q: string, digital = true): Promise<string[]> => {
  const res = await request(app).get('/api/music/albums/search').query({ q: `${q} ${tag}`, ...(digital ? { digital: '1' } : {}) });
  expect(res.status).toBe(200);
  return res.body.map((album: { title: string }) => album.title.replace(` ${tag}`, '')).sort();
};

describe('the words of the search, as the pills write them and as they were', () => {
  it('reads yes/no and the old words for them', () => {
    for (const yes of ['yes', 'true', 'with', 'y', '1', 'YES', '"yes"']) expect(boolOf(yes)).toBe(true);
    for (const no of ['no', 'false', 'without', 'n', '0']) expect(boolOf(no)).toBe(false);
    expect(boolOf('maybe')).toBeNull();
  });

  it('writes !key: as -key: and a key by its own name', () => {
    expect(normaliseAlbumQuery('!cd:yes by:Bowie !fav:yes favorites:no blue')).toBe('-cd:yes artist:Bowie -favourites:yes favourites:no blue');
    expect(normaliseAlbumQuery('title:"by: me"')).toBe('title:"by: me"');
    expect(normaliseAlbumQuery('title:"Stand by: me !fav: x" by:Ben')).toBe('title:"Stand by: me !fav: x" artist:Ben');
  });

  it('takes a yes/no filter out with what it lets through', () => {
    expect(takeBoolFilter('blue cd:yes', 'cd')).toEqual({ allowed: [true], rest: 'blue' });
    expect(takeBoolFilter('-cd:yes blue', 'cd')).toEqual({ allowed: [false], rest: 'blue' });
    expect(takeBoolFilter('cd:true', 'cd').allowed).toEqual([true]);
    expect(takeBoolFilter('cd:without', 'cd').allowed).toEqual([false]);
    expect(takeBoolFilter('cd:yes,no', 'cd').allowed).toEqual([true, false]);
    expect(takeBoolFilter('cd:yes -cd:yes', 'cd').allowed).toEqual([]);
    expect(takeBoolFilter('cd:maybe', 'cd')).toEqual({ allowed: null, rest: 'cd:maybe' });
    expect(takeBoolFilter('mixtape:yes', 'cd')).toEqual({ allowed: null, rest: 'mixtape:yes' });
    // A key inside another word is not the key.
    expect(takeBoolFilter('discd:yes', 'cd').allowed).toBeNull();
  });

  it('takes a number filter out as SQL, its values ORed and its sign excluding', () => {
    expect(takeNumberFilter('year:1960-1969,>=2020 jazz', 'year', 'y')).toEqual({
      clauses: ['(y BETWEEN ? AND ? OR y >= ?)'], params: [1960, 1969, 2020], rest: 'jazz',
    });
    expect(takeNumberFilter('-stars:<3', 'stars', 's')).toEqual({ clauses: ['NOT (s < ?)'], params: [3], rest: '' });
    expect(takeNumberFilter('year:old', 'year', 'y')).toEqual({ clauses: [], params: [], rest: 'year:old' });
  });

  it('keeps _parseSearchQuery\'s params in step with its clauses', () => {
    const parsed = Album._parseSearchQuery('artist:Bowie -year:1977 stars:>=4 -file:lossy label:RCA,EMI rated:yes');
    const marks = parsed.whereClauses.join(' AND ').split('?').length - 1;
    expect(marks).toBe(parsed.params.length);
    expect(parsed.cleanedQuery).toBe('');
  });

  describe('against the collection', () => {
    beforeAll(async () => {
      await insert('Ripped five', { stars: 5, year: 1965, quality: 'lossless', labels: ['ECM'] });
      await insert('Ripped lossy', { stars: 3, year: 1985, quality: 'lossy', labels: null });
      await insert('Not ripped', { year: 2021, quality: 'none' });
      await insert('Digital', { status: 'digital', year: 1999, quality: 'near' });
      await insert('Wish', { status: 'wish' });
    });

    it('cd: with yes/no, the old words, - and !', async () => {
      const cds = ['Not ripped', 'Ripped five', 'Ripped lossy'];
      expect(await titles('cd:yes')).toEqual(cds);
      expect(await titles('cd:true')).toEqual(cds);
      expect(await titles('cd:with')).toEqual(cds);
      expect(await titles('-cd:no')).toEqual(cds);
      expect(await titles('!cd:no')).toEqual(cds);
      expect(await titles('cd:no')).toEqual(['Digital', 'Wish']);
      expect(await titles('-cd:yes')).toEqual(['Digital', 'Wish']);
      expect(await titles('cd:0')).toEqual(['Digital', 'Wish']);
      expect(await titles('cd:yes,no')).toHaveLength(5);
    });

    it('ripped:, rated: and mixtape: alike', async () => {
      expect(await titles('ripped:no')).toEqual(['Not ripped']);
      expect(await titles('ripped:false')).toEqual(['Not ripped']);
      expect(await titles('-ripped:no')).toEqual(['Ripped five', 'Ripped lossy']);
      expect(await titles('rated:y')).toEqual(['Ripped five', 'Ripped lossy']);
      expect(await titles('-rated:yes')).toEqual(['Digital', 'Not ripped', 'Wish']);
      expect(await titles('mixtape:without')).toHaveLength(5);
      expect(await titles('-mixtape:no')).toEqual([]);
    });

    it('file: with commas and -', async () => {
      expect(await titles('file:lossless')).toEqual(['Ripped five']);
      expect(await titles('file:near')).toEqual(['Digital']);
      expect(await titles('file:lossless,near')).toEqual(['Digital', 'Ripped five']);
      expect(await titles('file:lossless,lossy')).toEqual(['Ripped five', 'Ripped lossy']);
      expect(await titles('-file:lossy')).toEqual(['Digital', 'Not ripped', 'Ripped five', 'Wish']);
    });

    it('year: and stars: with commas and -', async () => {
      expect(await titles('year:1960-1969,>=2020')).toEqual(['Not ripped', 'Ripped five']);
      expect(await titles('-year:1960-1969 year:<2000')).toEqual(['Digital', 'Ripped lossy']);
      expect(await titles('stars:5,3')).toEqual(['Ripped five', 'Ripped lossy']);
      expect(await titles('-stars:0')).toEqual(['Ripped five', 'Ripped lossy']);
      expect(await titles('!stars:>=4 cd:yes')).toEqual(['Not ripped', 'Ripped lossy']);
    });

    it('text keys: - and ! exclude, an album with no label is not one on ECM, by: is artist:', async () => {
      expect(await titles('-label:ECM cd:yes')).toEqual(['Not ripped', 'Ripped lossy']);
      expect(await titles('!label:ECM cd:yes')).toEqual(['Not ripped', 'Ripped lossy']);
      expect(await titles('Label:ECM')).toEqual(['Ripped five']);
      expect(await titles('by:Somebody cd:no')).toEqual(['Digital', 'Wish']);
    });

    it('classical: with the old words and -', async () => {
      expect(await titles('classical:true')).toEqual(await titles('classical:yes'));
      expect(await titles('-classical:yes')).toEqual(await titles('classical:no'));
      expect(await titles('classical:yes,no')).toHaveLength(5);
    });
  });
});

describe('the plain words of a search', () => {
  beforeAll(async () => {
    await insert('Lemonade', { artist: 'Beyoncé' });
    await insert('Œuvres pour piano', { artist: 'Jean-Yves Thibaudet' });
    await insert('The Dark Side of the Moon', { artist: 'Pink Floyd' });
    await insert('Wish You Were Here', { artist: 'Pink Floyd' });
  });

  it('finds a name without its accents, or with them where the album has none', async () => {
    expect(await titles('beyonce')).toEqual(['Lemonade']);
    expect(await titles('BEYONCÉ')).toEqual(['Lemonade']);
    expect(await titles('oeuvres')).toEqual(['Œuvres pour piano']);
    expect(await titles('thibaudét')).toEqual(['Œuvres pour piano']);
  });

  it('finds each word anywhere, in any order; a quoted group as one', async () => {
    expect(await titles('floyd moon')).toEqual(['The Dark Side of the Moon']);
    expect(await titles('pink floyd')).toEqual(['The Dark Side of the Moon', 'Wish You Were Here']);
    expect(await titles('"pink floyd" wish')).toEqual(['Wish You Were Here']);
    expect(await titles('"floyd pink"')).toEqual([]);
  });
});
