import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import TrackFiche, { type Fiche } from '../../src/models/trackFiche';
import type { NavidromeAlbum, NavidromeSong } from '../../src/services/navidromeService';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import mixtapeSearchService from '../../src/services/mixtapeSearchService';
import { groupAnswers, songAnswers, takeFicheFilter, type FicheFilter } from '../../src/utils/ficheFilters';

const run = (sql: string, params: unknown[] = []) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const tag = `f${Math.random().toString(36).slice(2, 8)}`;

const insertAlbum = (title: string, { status = 'owned', stars = null as number | null } = {}) =>
  run(`INSERT INTO albums (title, artist, format, title_status, user_rating, navidrome_id) VALUES (?, ?, 'CD', ?, ?, ?)`,
    [`${title} ${tag}`, JSON.stringify(['Somebody']), status, stars, status === 'digital' ? `nd-${title}-${tag}` : null]);

const insertTrack = (albumId: number, no: number, recording: string | null) =>
  run(`INSERT INTO tracks (album_id, disc_number, track_number, title, musicbrainz_recording_id) VALUES (?, 1, ?, ?, ?)`,
    [albumId, no, `Track ${no}`, recording]);

const fiche = (energy: number, moods: string[], styles: string[] = ['folk'], tempo: Fiche['tempo'] = 'mid'): Fiche =>
  ({ energy, tempo, moods, styles, lang: 'english' });

/** An album of DexVault whose tracks have these fiches, by their recording; null for a track with neither. */
const albumWith = async (title: string, fiches: Array<Fiche | null>, options: { stars?: number | null } = {}): Promise<number> => {
  const id = await insertAlbum(title, options);
  const saved: Array<{ key: string; fiche: Fiche }> = [];
  for (const [at, one] of fiches.entries()) {
    const recording = `${tag}-${title}-${at + 1}`;
    await insertTrack(id, at + 1, one ? recording : null);
    if (one) saved.push({ key: recording, fiche: one });
  }
  await TrackFiche.saveMany(saved, 'test');
  return id;
};

/** The titles a search finds, the tag gone, sorted. */
const titles = async (q: string, digital = false): Promise<string[]> => {
  const res = await request(app).get('/api/music/albums/search').query({ q: `${q} ${tag}`, ...(digital ? { digital: '1' } : {}) });
  expect(res.status).toBe(200);
  return res.body.map((album: { title: string }) => album.title.replace(` ${tag}`, '')).sort();
};

describe('the words of how a song sounds', () => {
  const read = (q: string): FicheFilter => {
    const { filter } = takeFicheFilter(q);
    expect(filter).not.toBeNull();
    return filter!;
  };

  it('are taken out of the query, the rest left', () => {
    expect(takeFicheFilter('mood:melancholic piano style:jazz,blues').rest).toBe('piano');
    expect(takeFicheFilter('-mood:dark energy:7-10 tempo:fast').rest).toBe('');
    expect(takeFicheFilter('piano')).toEqual({ filter: null, rest: 'piano' });
    // A value no key can read stays in the query, and finds nothing of itself.
    expect(takeFicheFilter('energy:loud tempo:quick x')).toEqual({ filter: null, rest: 'energy:loud tempo:quick x' });
    // A key inside another word is not the key.
    expect(takeFicheFilter('nomood:dark').filter).toBeNull();
  });

  it('read a song by its own fiche: every word at once, none of those with a sign, nothing without a fiche', () => {
    const sad = fiche(3, ['melancholic', 'tender'], ['folk'], 'slow');
    const loud = fiche(9, ['dark', 'driving'], ['rock', 'hard-rock'], 'fast');
    expect(songAnswers(read('mood:melancholic'), sad)).toBe(true);
    expect(songAnswers(read('mood:MELANCHOLIC,dark'), loud)).toBe(true);
    expect(songAnswers(read('mood:melancholic energy:7-10'), sad)).toBe(false);
    expect(songAnswers(read('style:rock energy:7-10'), loud)).toBe(true);
    expect(songAnswers(read('-mood:dark'), loud)).toBe(false);
    expect(songAnswers(read('-mood:dark'), sad)).toBe(true);
    expect(songAnswers(read('tempo:slow'), sad)).toBe(true);
    expect(songAnswers(read('tempo:medium'), fiche(5, []))).toBe(true);
    expect(songAnswers(read('mood:melancholic'), undefined)).toBe(false);
    expect(songAnswers(read('-mood:dark'), undefined)).toBe(true);
  });

  it('read energy exactly, compared or as a range, either way round', () => {
    const at = (q: string, energy: number) => songAnswers(read(q), fiche(energy, []));
    expect(at('energy:7', 7)).toBe(true);
    expect(at('energy:7', 8)).toBe(false);
    expect(at('energy:7-10', 10)).toBe(true);
    expect(at('energy:7-10', 6)).toBe(false);
    expect(at('energy:10-7', 8)).toBe(true);
    expect(at('energy:>=8', 8)).toBe(true);
    expect(at('energy:<3', 3)).toBe(false);
    expect(at('energy:0-2,9-10', 9)).toBe(true);
    expect(at('-energy:0-4', 2)).toBe(false);
  });

  it('find an album when a third of its songs with a fiche answer, one at least', () => {
    const r = fiche(8, ['driving'], ['rock']);
    const f = fiche(3, ['gentle'], ['folk']);
    expect(groupAnswers(read('style:rock'), [r, f, f])).toBe(true);
    expect(groupAnswers(read('style:rock'), [r, f, f, f])).toBe(false);
    expect(groupAnswers(read('style:rock'), [])).toBe(false);
    // Without a fiche the negation finds it; with one, the third left out.
    expect(groupAnswers(read('-style:rock'), [])).toBe(true);
    expect(groupAnswers(read('-style:rock'), [r, f, f, f])).toBe(true);
    expect(groupAnswers(read('-style:rock'), [r, f, f])).toBe(false);
    // The words without a sign are answered by the same songs at once.
    expect(groupAnswers(read('style:rock energy:0-4'), [r, f])).toBe(false);
  });

  it('find an album by a mood when a quarter of its songs, or three, have it', () => {
    const m = fiche(3, ['melancholic']);
    const j = fiche(7, ['joyful']);
    const of = (melancholic: number, others: number) => [...Array(melancholic).fill(m), ...Array(others).fill(j)];
    expect(groupAnswers(read('mood:melancholic'), of(1, 3))).toBe(true);
    expect(groupAnswers(read('mood:melancholic'), of(1, 4))).toBe(false);
    // Three songs are enough on a long album: 3 of 20.
    expect(groupAnswers(read('mood:melancholic'), of(3, 17))).toBe(true);
    expect(groupAnswers(read('mood:melancholic'), of(2, 18))).toBe(false);
    // Mixed with a style, the style's third holds.
    expect(groupAnswers(read('mood:melancholic style:folk'), of(1, 3))).toBe(false);
    expect(groupAnswers(read('mood:melancholic,joyful style:folk'), of(1, 3))).toBe(true);
    // A mood left out leaves out the albums that mood finds.
    expect(groupAnswers(read('-mood:melancholic'), of(3, 17))).toBe(false);
    expect(groupAnswers(read('-mood:melancholic'), of(2, 18))).toBe(true);
  });
});

describe('MusicDex searched by how its songs sound', () => {
  let loud: number;
  beforeAll(async () => {
    const m = fiche(3, ['melancholic', 'tender'], ['folk'], 'slow');
    const calm = fiche(2, ['calm'], ['folk']);
    const joy = fiche(7, ['joyful', 'upbeat'], ['pop'], 'fast');
    const rock = (energy: number) => fiche(energy, ['dark', 'driving'], ['rock'], 'fast');
    await albumWith('Sad', [m, calm, calm]);
    // One melancholic of five: under a mood's quarter.
    await albumWith('Barely', [m, joy, joy, joy, joy]);
    loud = await albumWith('Loud', [rock(8), rock(9)], { stars: 5 });
    await albumWith('Bare', [null, null]);
    // Five tracks, one with a fiche: the third is of that one.
    await albumWith('Half', [rock(5), null, null, null, null], { stars: 2 });
    // A digital album's files have no track of DexVault: their fiches are kept by their place.
    const files = await insertAlbum('Files', { status: 'digital' });
    await TrackFiche.saveMany([1, 2].map(no => ({ key: `album:${files}:1:${no}`, fiche: m })), 'test');
  });

  it('mood: and style:, commas as or, the third of the songs with a fiche', async () => {
    expect(await titles('mood:melancholic')).toEqual(['Sad']);
    expect(await titles('mood:melancholic', true)).toEqual(['Files', 'Sad']);
    expect(await titles('mood:melancholic,dark')).toEqual(['Half', 'Loud', 'Sad']);
    expect(await titles('style:rock')).toEqual(['Half', 'Loud']);
    expect(await titles('!style:pop,folk')).toEqual(['Bare', 'Half', 'Loud']);
  });

  it('-mood: leaves out what mood: finds, an album with no fiche kept', async () => {
    expect(await titles('-mood:dark')).toEqual(['Bare', 'Barely', 'Sad']);
    expect(await titles('-mood:dark', true)).toEqual(['Bare', 'Barely', 'Files', 'Sad']);
  });

  it('energy: and tempo:', async () => {
    expect(await titles('energy:7-10')).toEqual(['Barely', 'Loud']);
    expect(await titles('energy:9')).toEqual(['Loud']);
    expect(await titles('energy:0-1')).toEqual([]);
    expect(await titles('tempo:slow')).toEqual(['Sad']);
    expect(await titles('tempo:fast')).toEqual(['Barely', 'Half', 'Loud']);
  });

  it('with the other keys and the plain words', async () => {
    expect(await titles('style:rock energy:7-10')).toEqual(['Loud']);
    expect(await titles('mood:melancholic energy:7-10')).toEqual([]);
    expect(await titles('mood:dark stars:>=4')).toEqual(['Loud']);
    expect(await titles('mood:dark loud')).toEqual(['Loud']);
    expect(await titles('mood:dark classical:no')).toEqual(['Half', 'Loud']);
    expect(await titles('mood:dark -classical:no')).toEqual([]);
    expect(await titles('-mood:dark cd:yes -rated:yes')).toEqual(['Bare', 'Barely', 'Sad']);
  });

  it('reads the fiches of every album at hand at once', async () => {
    const spy = jest.spyOn(TrackFiche, 'ofAlbums');
    try {
      await titles('mood:melancholic,dark');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain(loud);
    } finally {
      spy.mockRestore();
    }
  });
});

const copy = (id: string): NavidromeAlbum => ({ id, name: id, artist: 'A', musicBrainzId: null, songCount: 3, userRating: 0 });
const file = (albumId: string, id: string, track: number, title: string, artist: string): NavidromeSong => ({
  albumId, id, title, artist, track, discNumber: 1, durationSec: 240, suffix: 'flac', bitDepth: 16, starred: false,
});

describe('a mixtape’s Add tracks… by how its songs sound', () => {
  let rain: number;
  let symphony: number;

  beforeAll(async () => {
    const m = fiche(2, ['melancholic'], ['classical'], 'slow');
    const j = fiche(7, ['joyful'], ['pop'], 'fast');
    const epic = fiche(8, ['epic', 'dramatic'], ['classical'], 'fast');
    // Two of Rain's songs by their recording, one by its place, one with none.
    rain = await albumWith('Rain', [m, j, null, null]);
    await TrackFiche.saveMany([{ key: `album:${rain}:1:3`, fiche: m }], 'test');
    symphony = await albumWith('Symphony', [epic, epic, j]);
  });

  beforeEach(() => {
    mixtapeSearchService.forget();
    const songs = [
      file('nd-rain', 'r1', 1, 'Piano in the Rain', 'Somebody'),
      file('nd-rain', 'r2', 2, 'Sunny', 'Somebody'),
      file('nd-rain', 'r3', 3, 'Grey', 'Somebody'),
      file('nd-rain', 'r4', 4, 'Unheard', 'Somebody'),
      file('nd-sym', 's1', 1, 'Symphony no. 5: I. Allegro con brio', 'Beethoven'),
      file('nd-sym', 's2', 2, 'Symphony no. 5: II. Andante con moto', 'Beethoven'),
      file('nd-sym', 's3', 3, 'Egmont Overture', 'Beethoven'),
    ];
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(ripStatusService, 'library').mockResolvedValue({ albums: [], songs, lengths: { cd: new Map(), navidrome: new Map() } } as never);
    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[rain, copy('nd-rain')], [symphony, copy('nd-sym')]]));
  });

  afterEach(() => jest.restoreAllMocks());

  const search = async (q: string) => (await request(app).get('/api/music/mixtapes/search').query({ q }).expect(200)).body as {
    albums: Array<{ albumId: number }>; works: Array<{ name: string }>; tracks: Array<{ songId: string }>;
  };
  const ids = (found: Array<{ songId: string }>) => found.map(one => one.songId).sort();

  it('keeps the tracks whose own fiche answers, the plain words with them', async () => {
    const found = await search('mood:melancholic piano');
    expect(ids(found.tracks)).toEqual(['r1']);
    expect(found.albums).toEqual([]);
    expect(ids((await search('mood:melancholic')).tracks)).toEqual(['r1', 'r3']);
    expect(ids((await search('energy:7-10 tempo:fast')).tracks)).toEqual(['r2', 's3']);
  });

  it('shows an album or a work only when a third of its songs with a fiche answer', async () => {
    const sad = await search('mood:melancholic');
    expect(sad.albums.map(one => one.albumId)).toEqual([rain]);
    expect(sad.works).toEqual([]);
    const epic = await search('mood:epic');
    expect(epic.works.map(one => one.name)).toEqual(['Symphony no. 5']);
    expect(epic.albums.map(one => one.albumId)).toEqual([symphony]);
    // The work's movements come with it, not again one by one.
    expect(epic.tracks).toEqual([]);
  });

  it('-mood: keeps the tracks with no fiche, and leaves out the albums the mood finds', async () => {
    const found = await search('-mood:melancholic rain');
    expect(ids(found.tracks)).toEqual(['r2', 'r4']);
    expect(found.albums).toEqual([]);
    expect((await search('!mood:melancholic symphony')).albums.map(one => one.albumId)).toEqual([symphony]);
  });
});
