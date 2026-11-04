import axios from 'axios';
import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import TrackFiche, { type Fiche } from '../../src/models/trackFiche';
import RadioHistory, { type RadioLeaving } from '../../src/models/radioHistory';
import type { NavidromeAlbum, NavidromeSong } from '../../src/services/navidromeService';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import mixtapeSearchService from '../../src/services/mixtapeSearchService';
import { catalogue, forgetCatalogue, inPool, type RadioEntry, type RadioPool } from '../../src/services/radioCatalogue';
import trackFicheService, { describe as describeSongs, NoFichesError, parseFiches } from '../../src/services/trackFicheService';
import { arrange, criteriaOf, fitScore, restingSongs } from '../../src/services/radioService';
import albumGuideService from '../../src/services/albumGuideService';
import albumStoryService from '../../src/services/albumStoryService';
import musicService from '../../src/services/musicService';
import { inTurn } from '../../src/utils/localLlmQueue';

const run = (sql: string, params: unknown[] = []) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const insertAlbum = (title: string, artists: string[], { stars = null as number | null, genres = [] as string[] } = {}) =>
  run(`INSERT INTO albums (title, artist, genres, format, title_status, user_rating) VALUES (?, ?, ?, 'CD', 'owned', ?)`,
    [title, JSON.stringify(artists), JSON.stringify(genres), stars]);

const insertTrack = (albumId: number, no: number, title: string, recording: string | null) =>
  run(`INSERT INTO tracks (album_id, disc_number, track_number, title, musicbrainz_recording_id) VALUES (?, 1, ?, ?, ?)`, [albumId, no, title, recording]);

const copy = (id: string): NavidromeAlbum => ({ id, name: id, artist: 'A', musicBrainzId: null, songCount: 3, userRating: 0 });
const file = (albumId: string, id: string, track: number, title: string, artist: string, starred = false): NavidromeSong => ({
  albumId, id, title, artist, track, discNumber: 1, durationSec: 240, suffix: 'flac', bitDepth: 16, starred,
});

const POOL: RadioPool = { stars: null, hearts: false, popular: false, genre: 'both', wholeWorks: false };
const fiche = (energy: number, moods: string[], styles: string[], tempo: Fiche['tempo'] = 'mid', lang = 'english'): Fiche =>
  ({ energy, tempo, moods, styles, lang });

/** The local LLM's answer to a request. */
const answer = (content: string) => ({ data: { choices: [{ message: { content } }] } });
const askedOf = (body: any): string => body.messages[body.messages.length - 1].content;

let albums: Record<string, number>;

beforeEach(async () => {
  mixtapeSearchService.forget();
  forgetCatalogue();
  trackFicheService.forget();
  await TrackFiche.clear();
  await RadioHistory.clear();
  albums = {
    muse: await insertAlbum('Absolution', ['Muse'], { stars: 5 }),
    adele: await insertAlbum('21', ['Adele'], { stars: 3 }),
    dvorak: await insertAlbum('Symphony no. 9', ['Antonín Dvořák'], { stars: 4, genres: ['Classical'] }),
    // The same Muse song again, on a best of: one recording, one fiche.
    best: await insertAlbum('Best of Muse', ['Muse'], { stars: 2 }),
    // MusicBrainz says classical, the shelves say otherwise.
    abbey: await insertAlbum('Abbey Road', ['The Beatles'], { genres: ['Classical'] }),
  };
  await insertTrack(albums.muse, 1, 'Apocalypse Please', 'rec-apocalypse');
  await insertTrack(albums.best, 1, 'Apocalypse Please', 'rec-apocalypse');
  await run(`INSERT INTO shelf_items (kind, item_id, section) VALUES ('album', ?, 'music')`, [albums.abbey]);
  const songs = [
    file('nd-muse', 'm1', 1, 'Apocalypse Please', 'Muse'),
    file('nd-muse', 'm2', 2, 'Time Is Running Out', 'Muse', true),
    file('nd-muse', 'm3', 3, 'Hysteria', 'Muse'),
    file('nd-adele', 'a1', 1, 'Rolling in the Deep', 'Adele', true),
    file('nd-adele', 'a2', 2, 'Someone Like You', 'Adele'),
    file('nd-dvorak', 'd1', 1, 'Symphony no. 9: I. Adagio – Allegro molto', 'Antonín Dvořák'),
    file('nd-dvorak', 'd2', 2, 'Symphony no. 9: II. Largo', 'Antonín Dvořák'),
    file('nd-dvorak', 'd3', 3, 'Symphony no. 9: III. Scherzo', 'Antonín Dvořák'),
    file('nd-best', 'b1', 1, 'Apocalypse Please', 'Muse'),
    file('nd-abbey', 'r1', 1, 'Come Together', 'The Beatles'),
  ];
  // Never the real model: a test that wants it answering says so.
  jest.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true, request: {}, code: 'ECONNREFUSED' }));
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
  jest.spyOn(ripStatusService, 'library').mockResolvedValue({ albums: [], songs, lengths: { cd: new Map(), navidrome: new Map() } } as never);
  jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([
    [albums.muse, copy('nd-muse')], [albums.adele, copy('nd-adele')], [albums.dvorak, copy('nd-dvorak')],
    [albums.best, copy('nd-best')], [albums.abbey, copy('nd-abbey')],
  ]));
});

afterEach(async () => {
  await trackFicheService.idle();
  jest.restoreAllMocks();
  for (const id of Object.values(albums)) await Album.delete(id);
  await run(`DELETE FROM shelf_items WHERE kind = 'album'`);
});

const entryOf = async (songId: string): Promise<RadioEntry> => (await catalogue()).bySongId.get(songId)!;

/** Every song that plays gets the fiche given here, by its id. */
const giveFiches = async (fiches: Record<string, Fiche>) => {
  const { bySongId } = await catalogue();
  await TrackFiche.saveMany(Object.entries(fiches).map(([songId, one]) => ({ key: bySongId.get(songId)!.key, fiche: one })), 'test');
};

describe('a fiche as the model gives it', () => {
  it('keeps the closed lists\' words, drops the others, and takes numbers given as strings', () => {
    const fiches = parseFiches('Here you go:\n```json\n[{"n":"1","energy":"8","tempo":"Fast","moods":["Driving","furious","epic","anthemic","dark"],'
      + '"styles":["rock","space-rock","alternative","pop"],"lang":"English"},{"n":2,"energy":3,"tempo":"medium","moods":"calm, tender","styles":["folk"],"lang":""},'
      + '{"n":9,"energy":5,"tempo":"mid"},{"n":3,"energy":"loud","tempo":"mid"}]\n```', 3)!;
    expect([...fiches.keys()]).toEqual([1, 2]);
    expect(fiches.get(1)).toEqual({ energy: 8, tempo: 'fast', moods: ['driving', 'epic', 'anthemic'], styles: ['rock', 'alternative'], lang: 'english' });
    expect(fiches.get(2)).toEqual({ energy: 3, tempo: 'mid', moods: ['calm', 'tender'], styles: ['folk'], lang: 'unknown' });
  });

  it('is no answer when it holds no list', () => {
    expect(parseFiches('I cannot help with that.', 2)).toBeNull();
    expect(parseFiches('[{"n": 1}]', 2)).toBeNull();
  });

  it('asks again a malformed answer, three times in all', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce(answer('Sure!'))
      .mockResolvedValueOnce(answer('[{"n": 1, "energy": "x"}]'))
      .mockResolvedValueOnce(answer('[{"n": 1, "energy": 6, "tempo": "mid", "moods": ["groovy"], "styles": ["funk"], "lang": "english"}]'));
    const written = await describeSongs([{ key: 'k1', artist: 'A', title: 'T', album: 'Al', year: 2000 }]);
    expect(written).toEqual([{ key: 'k1', fiche: { energy: 6, tempo: 'mid', moods: ['groovy'], styles: ['funk'], lang: 'english' } }]);
    expect(post).toHaveBeenCalledTimes(3);
    const body = post.mock.calls[0][1] as any;
    expect(body).toMatchObject({ temperature: 0.1, chat_template_kwargs: { enable_thinking: false } });
    expect(askedOf(body)).toContain('1. A — T (album Al, 2000)');

    post.mockReset().mockResolvedValue(answer('nothing'));
    await expect(describeSongs([{ key: 'k1', artist: 'A', title: 'T', album: 'Al', year: null }])).rejects.toBeInstanceOf(NoFichesError);
    expect(post).toHaveBeenCalledTimes(3);
  });
});

describe('the fiches written for a pool', () => {
  it('writes one fiche per recording: the song on two albums is described once and shares it', async () => {
    const post = jest.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
      const lines = askedOf(body).split('\n').filter(line => /^\d+\. /.test(line));
      return answer(JSON.stringify(lines.map((_, at) => ({ n: at + 1, energy: 7, tempo: 'fast', moods: ['driving'], styles: ['rock'], lang: 'english' }))));
    });
    const before = (await request(app).get('/api/radio/fiches').expect(200)).body;
    expect(before).toEqual({ songs: 10, withFiche: 0, queued: 0, writing: false });

    const asked = (await request(app).post('/api/radio/fiches').send({ pool: { ...POOL, stars: 5 } }).expect(200)).body;
    expect(asked).toMatchObject({ songs: 3, withFiche: 0, writing: true });
    await trackFicheService.idle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(askedOf(post.mock.calls[0][1]).split('\n').filter(line => /^\d+\. /.test(line))).toHaveLength(3);

    const after = (await request(app).get('/api/radio/fiches').expect(200)).body;
    // The best of's Apocalypse Please has its fiche too, from Absolution's.
    expect(after).toEqual({ songs: 10, withFiche: 4, queued: 0, writing: false });
    expect((await entryOf('b1')).key).toBe('rec-apocalypse');
    expect((await entryOf('m2')).key).toBe(`album:${albums.muse}:1:2`);

    // The rest, all at once and the shared recording not again.
    await trackFicheService.writeMissing();
    expect(askedOf(post.mock.calls[1][1]).split('\n').filter(line => /^\d+\. /.test(line))).toHaveLength(6);
    expect((await request(app).get('/api/radio/fiches').expect(200)).body.withFiche).toBe(10);
  });
});

describe('the pool', () => {
  const ids = async (pool: RadioPool) => (await catalogue()).entries.filter(entry => inPool(entry, pool)).map(entry => entry.song.songId).sort();

  it('adds up its sources, and is everything that plays with none', async () => {
    expect(await ids(POOL)).toHaveLength(10);
    expect(await ids({ ...POOL, stars: 4 })).toEqual(['d1', 'd2', 'd3', 'm1', 'm2', 'm3']);
    expect(await ids({ ...POOL, hearts: true })).toEqual(['a1', 'm2']);
    expect(await ids({ ...POOL, stars: 4.5, hearts: true })).toEqual(['a1', 'm1', 'm2', 'm3']);
  });

  it('tells classical as the shelves do, never by the album\'s tags alone', async () => {
    expect(await ids({ ...POOL, genre: 'classical' })).toEqual(['d1', 'd2', 'd3']);
    expect(await ids({ ...POOL, genre: 'other' })).toContain('r1');
    expect(await ids({ ...POOL, stars: 4, genre: 'other' })).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('the criteria', () => {
  it('rules out by energy, styles and language, and fits better by tempo and moods', () => {
    const song = fiche(7, ['driving', 'anthemic'], ['rock'], 'fast');
    expect(fitScore(song, {})).toBe(1);
    expect(fitScore(song, { energyMin: 8 })).toBe(0);
    expect(fitScore(song, { energyMax: 6 })).toBe(0);
    expect(fitScore(song, { styles: ['jazz'] })).toBe(0);
    expect(fitScore(song, { langs: ['french'] })).toBe(0);
    expect(fitScore(song, { styles: ['rock', 'jazz'], tempos: ['fast'], moods: ['driving', 'anthemic', 'calm'] })).toBe(4);
  });

  it('keeps the closed lists, takes numbers as strings and refuses what is no criteria', () => {
    expect(criteriaOf({ energy_min: '6', energy_max: null, tempos: ['fast', 'warp'], moods_any: ['Driving', 'sunny'], styles_any: ['rock', 'krautrock'], langs: ['English'] }))
      .toEqual({ energyMin: 6, energyMax: null, tempos: ['fast'], moods: ['driving'], styles: ['rock'], langs: ['english'] });
    expect(criteriaOf(undefined)).toEqual({});
    expect(criteriaOf('loud')).toBeNull();
    expect(criteriaOf({ energyMin: 'loud' })).toBeNull();
    expect(criteriaOf({ moods: 'calm' })).toBeNull();
  });

  it('hears a prompt through the local LLM', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue(answer('{"energy_min": "7", "energy_max": 10, "tempos": ["fast"], "moods_any": ["energetic", "loud"], "styles_any": ["rock"], "langs": []}'));
    const { body } = await request(app).post('/api/radio/criteria').send({ prompt: 'rock alternatif énergique' }).expect(200);
    expect(body).toEqual({ energyMin: 7, energyMax: 10, tempos: ['fast'], moods: ['energetic'], styles: ['rock'], langs: [] });
    expect(askedOf(post.mock.calls[0][1])).toContain('"rock alternatif énergique"');
  });
});

const entry = (songId: string, artist: string, track = 1, work: string | null = null): RadioEntry => ({
  song: { songId, title: songId, artist, albumId: 1, album: 'Al', cover: null, discNumber: 1, track, durationSec: 60, starred: false, popular: false, work, movement: work ? songId : null },
  key: songId, stars: null, classical: Boolean(work), year: null, workKey: work, workSongs: [],
});

describe('the songs arranged', () => {
  const symphony = ['s1', 's2', 's3', 's4'].map((id, at) => entry(id, 'Dvořák', at + 1, 'w'));
  symphony.forEach(one => { one.workSongs = symphony.map(movement => movement.song); });
  const known = new Map(symphony.map(one => [one.song.songId, one]));
  const options = (more: Partial<Parameters<typeof arrange>[1]> = {}) =>
    ({ ahead: [], count: 10, wholeWorks: false, catalogueOf: (id: string) => known.get(id), excluded: new Set<string>(), ...more });
  const ids = (list: RadioEntry[]) => list.map(one => one.song.songId);

  it('puts a work\'s movements together and in their order, where the first came', () => {
    const chosen = [symphony[2], entry('a', 'Adele'), symphony[0], entry('m', 'Muse')];
    expect(ids(arrange(chosen, options()))).toEqual(['s1', 's3', 'a', 'm']);
  });

  it('brings the whole work with whole works', () => {
    expect(ids(arrange([entry('a', 'Adele'), symphony[1]], options({ wholeWorks: true })))).toEqual(['a', 's1', 's2', 's3', 's4']);
    // Even beyond the count, a work stays whole; and a movement already ahead is not drawn again.
    expect(ids(arrange([symphony[3]], options({ wholeWorks: true, count: 1, excluded: new Set(['s1']) })))).toEqual(['s2', 's3', 's4']);
  });

  it('takes at most two by one artist with those ahead, never two in a row', () => {
    const chosen = [entry('m1', 'Muse'), entry('m2', 'Muse'), entry('a1', 'Adele'), entry('m3', 'Muse'), entry('q1', 'Queen')];
    expect(ids(arrange(chosen, options()))).toEqual(['m1', 'a1', 'm2', 'q1']);
    // One ahead by Muse, the last: Muse may come once more, not first.
    expect(ids(arrange(chosen, options({ ahead: [entry('m0', 'Muse')] })))).toEqual(['a1', 'm1', 'q1']);
    // Muse featuring someone is still Muse.
    expect(ids(arrange([entry('x', 'Muse feat. Someone'), entry('y', 'Muse')], options()))).toEqual(['x']);
  });

  it('counts a work ahead as one, by its artist', () => {
    const chosen = [entry('d', 'Dvořák', 9), entry('a', 'Adele')];
    expect(ids(arrange(chosen, options({ ahead: symphony })))).toEqual(['a', 'd']);
  });
});

describe('the songs that left', () => {
  // The fiches a pool listened to would be written meanwhile: not here, the model answers the choice alone.
  beforeEach(() => { jest.spyOn(trackFicheService, 'queueFirst').mockImplementation(() => undefined); });

  const leaving = (songId: string, how: 'played' | 'skipped', daysAgo: number, id: number): RadioLeaving =>
    ({ id, songId, how, leftAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString() });

  it('come back after half the pool or 30 days, a skipped one twice as late', () => {
    // The latest first.
    const history = [leaving('x', 'played', 0, 5), leaving('y', 'played', 0, 4), leaving('z', 'skipped', 0, 3), leaving('old', 'played', 31, 2), leaving('skippedOld', 'skipped', 31, 1)];
    expect([...restingSongs(history, 100)].sort()).toEqual(['skippedOld', 'x', 'y', 'z']);
    // A pool of 4: half is two; one has left since y, so y waits, and four since skippedOld, which is back.
    expect([...restingSongs(history, 4)].sort()).toEqual(['x', 'y', 'z']);
    // A pool of 2: one since y is half of it, y is back; two since z, skipped, are the whole of it, z too.
    expect([...restingSongs(history, 2)].sort()).toEqual(['x']);
    expect([...restingSongs(history, 3)].sort()).toEqual(['x', 'y', 'z']);
  });

  it('are kept, and not drawn again for a while', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true, request: {}, code: 'ECONNREFUSED' }));
    await giveFiches({ m1: fiche(8, ['driving'], ['rock']), a1: fiche(6, ['soulful'], ['soul']), r1: fiche(5, ['playful'], ['rock']) });
    await request(app).post('/api/radio/left').send({ songId: 'm1', how: 'played' }).expect(200, { ok: true });
    const { body } = await request(app).post('/api/radio/next')
      .send({ criteria: {}, pool: POOL, count: 10, ahead: ['a1'] }).expect(200);
    // m1 has just left, b1 is its recording again, a1 is ahead: only r1; the LLM out of reach, the best fits stand in.
    expect(body.songs.map((one: { songId: string }) => one.songId)).toEqual(['r1']);
    // m1's fiche is the best of's b1 too, the same recording.
    expect(body).toMatchObject({ poolSize: 10, fitting: 1, missingFiches: 6 });
    expect(body.songs[0]).toMatchObject({ title: 'Come Together', artist: 'The Beatles', albumId: albums.abbey, energy: 5, styles: ['rock'], moods: ['playful'], lang: 'english' });
  });
});

describe('the next songs', () => {
  // The fiches a pool listened to would be written meanwhile: not here, the model answers the choice alone.
  beforeEach(() => { jest.spyOn(trackFicheService, 'queueFirst').mockImplementation(() => undefined); });

  it('draws from what fits, lets the model choose, and keeps the rules after it', async () => {
    await giveFiches({
      m1: fiche(8, ['driving'], ['rock'], 'fast'), m2: fiche(8, ['intense'], ['rock'], 'fast'), m3: fiche(9, ['driving'], ['rock'], 'fast'),
      a1: fiche(6, ['groovy'], ['soul']), a2: fiche(2, ['melancholic'], ['pop'], 'slow'),
      d1: fiche(6, ['dramatic'], ['classical'], 'fast', 'instrumental'), d2: fiche(3, ['calm'], ['classical'], 'slow', 'instrumental'),
      d3: fiche(7, ['playful'], ['classical'], 'fast', 'instrumental'),
    });
    let asked = '';
    let first = '';
    jest.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
      asked = askedOf(body);
      const candidates = asked.split('\n').filter(line => /^\d+\. /.test(line));
      first = candidates[candidates.length - 1].replace(/^\d+\. Muse — /, '').replace(/ \[.*/, '');
      // The model puts Muse three times in a row, the last first: the code keeps one, the one it chose first.
      return answer(JSON.stringify(candidates.map((_, at) => String(candidates.length - at))));
    });
    const { body } = await request(app).post('/api/radio/next')
      .send({ criteria: { energyMin: 7, styles: ['rock'] }, pool: POOL, count: 3, ahead: [], prompt: 'rock énergique' }).expect(200);
    expect(asked).toContain('"rock énergique"');
    expect(asked).not.toContain('Rolling in the Deep');
    expect(body.songs.map((one: { title: string }) => one.title)).toEqual([first]);
    // b1 fits too, Absolution's Apocalypse Please on the best of.
    expect(body).toMatchObject({ poolSize: 10, fitting: 4, missingFiches: 1 });
  });

  it('brings a work whole, in its order, and gives each movement its part', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue(answer('[1]'));
    await giveFiches({ d2: fiche(3, ['calm'], ['classical'], 'slow', 'instrumental') });
    const { body } = await request(app).post('/api/radio/next')
      .send({ criteria: { moods: ['calm'] }, pool: { ...POOL, genre: 'classical', wholeWorks: true }, count: 1, ahead: [] }).expect(200);
    expect(body.songs.map((one: { songId: string }) => one.songId)).toEqual(['d1', 'd2', 'd3']);
    expect(body.songs[1]).toMatchObject({ work: 'Symphony no. 9', movement: 'II. Largo', energy: 3 });
    // A movement with no fiche of its own wears its work's.
    expect(body.songs[0]).toMatchObject({ movement: 'I. Adagio – Allegro molto', tempo: 'slow' });
  });

  it('is empty when nothing fits', async () => {
    await giveFiches({ m1: fiche(8, ['driving'], ['rock']) });
    const { body } = await request(app).post('/api/radio/next')
      .send({ criteria: { styles: ['jazz'] }, pool: POOL, count: 10, ahead: [] }).expect(200);
    expect(body).toEqual({ songs: [], poolSize: 10, fitting: 0, missingFiches: 8 });
  });
});

describe('the endpoints\' validation', () => {
  const next = (body: object) => request(app).post('/api/radio/next').send({ criteria: {}, pool: POOL, count: 10, ahead: [], ...body });

  it('refuses what they cannot take', async () => {
    await request(app).post('/api/radio/criteria').send({}).expect(400);
    await request(app).post('/api/radio/criteria').send({ prompt: '   ' }).expect(400);
    await next({ count: 0 }).expect(400);
    await next({ count: 51 }).expect(400);
    await next({ count: 2.5 }).expect(400);
    await next({ pool: undefined }).expect(400);
    await next({ pool: { ...POOL, stars: 4.2 } }).expect(400);
    await next({ pool: { ...POOL, genre: 'jazz' } }).expect(400);
    await next({ criteria: { energyMin: 'loud' } }).expect(400);
    await next({ ahead: 'm1' }).expect(400);
    await next({ ahead: ['../etc'] }).expect(400);
    await request(app).post('/api/radio/left').send({ songId: 'm1', how: 'loved' }).expect(400);
    await request(app).post('/api/radio/left').send({ how: 'played' }).expect(400);
    await request(app).post('/api/radio/fiches').send({ pool: 'all' }).expect(400);
  });
});

describe('the local LLM, one request at a time', () => {
  it('never writes a guide and fiches at once', async () => {
    jest.spyOn(musicService, 'getAlbumById').mockResolvedValue({ id: 1, title: 'Le quattro stagioni', artist: ['Vivaldi'], labels: [], discs: [{ number: 1, tracks: [{ no: 1, title: 'La primavera', durationSec: 190 }] }] } as any);
    jest.spyOn(albumStoryService, 'getStory').mockResolvedValue({ found: true, url: null, works: [{ workTitle: 'Le quattro stagioni', positions: [1], links: [{ lang: 'fr', title: 'X', url: 'u' }] }], links: [] } as any);
    jest.spyOn(albumStoryService, 'readArticle').mockResolvedValue({ intro: 'Texte.', sections: [] });
    let running = 0;
    let most = 0;
    const order: string[] = [];
    jest.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
      running++;
      most = Math.max(most, running);
      const fiches = Boolean(body.chat_template_kwargs);
      order.push(fiches ? 'fiche' : 'guide');
      await new Promise(resolve => setTimeout(resolve, 20));
      running--;
      if (fiches) return answer('[{"n":1,"energy":5,"tempo":"mid","moods":["calm"],"styles":["classical"],"lang":"instrumental"}]');
      return answer(body.response_format ? '{"claims":[]}' : '### Fiche');
    });
    const id = await insertAlbum('Le quattro stagioni', ['Vivaldi'], { genres: ['Classical'] });
    try {
      await Promise.all([
        albumGuideService.generate(id),
        describeSongs([{ key: 'k', artist: 'Vivaldi', title: 'La primavera', album: 'Le quattro stagioni', year: null }]),
      ]);
    } finally {
      await Album.delete(id);
    }
    expect(most).toBe(1);
    // The guide's draft and its check in one turn, the fiche after it.
    expect(order).toEqual(['guide', 'guide', 'fiche']);
  });

  it('serves a listener before the work waiting in the background', async () => {
    const order: string[] = [];
    const work = (name: string) => async () => { order.push(name); await new Promise(resolve => setTimeout(resolve, 5)); };
    await Promise.all([inTurn(work('fiches 1')), inTurn(work('fiches 2')), inTurn(work('guide')), inTurn(work('radio'), { urgent: true })]);
    expect(order).toEqual(['fiches 1', 'radio', 'fiches 2', 'guide']);
  });
});
