import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import type { NavidromeAlbum, NavidromeSong } from '../../src/services/navidromeService';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import mixtapeSearchService from '../../src/services/mixtapeSearchService';
import { mixtapeUnits, withWorks } from '../../src/services/mixtapeWorks';
import { drawUnitPlaces, fitsSongs } from '../../src/services/mixtapeShuffle';

const song = (title: string, navidromeAlbumId = 'dvorak', discNumber = 1) => ({ title, navidromeAlbumId, discNumber });

const dvorak = ['Symphony no. 9: I. Adagio – Allegro molto', 'Symphony no. 9: II. Largo', 'Symphony no. 9: III. Scherzo: Molto vivace', 'Symphony no. 9: IV. Allegro con fuoco']
  .map(title => song(title));
const running = [song('Rolling in the Deep', 'adele'), song('Take Me to Church', 'hozier'), song('Uprising', 'muse')];

describe('the works of a mixtape', () => {
  it('puts the movements of a work in a row under it, a song alone by itself', () => {
    expect(mixtapeUnits([running[0], ...dvorak, running[1]])).toEqual([
      { start: 0, end: 0, work: null, movements: null },
      { start: 1, end: 4, work: 'Symphony no. 9', movements: ['I. Adagio – Allegro molto', 'II. Largo', 'III. Scherzo: Molto vivace', 'IV. Allegro con fuoco'] },
      { start: 5, end: 5, work: null, movements: null },
    ]);
  });

  it('leaves alone a movement taken from its work, and movements of two albums or two discs', () => {
    expect(mixtapeUnits([dvorak[1], running[0]]).every(unit => unit.work === null)).toBe(true);
    expect(mixtapeUnits([dvorak[0], song(dvorak[1].title, 'another')]).every(unit => unit.work === null)).toBe(true);
    expect(mixtapeUnits([dvorak[0], song(dvorak[1].title, 'dvorak', 2)]).every(unit => unit.work === null)).toBe(true);
  });

  it('tells each song its work and its own part', () => {
    const shown = withWorks([...dvorak.slice(0, 2), running[2]]);
    expect(shown.map(one => [one.work, one.movement])).toEqual([
      ['Symphony no. 9', 'I. Adagio – Allegro molto'], ['Symphony no. 9', 'II. Largo'], [null, null],
    ]);
  });

  it('shuffles units: a work stays whole, its movements in their order', () => {
    const songs = [running[0], ...dvorak, running[1], running[2]];
    for (let draw = 0; draw < 20; draw++) {
      const places = drawUnitPlaces(songs);
      expect(fitsSongs(places, songs.length)).toBe(true);
      const at = places.indexOf(1);
      expect(places.slice(at, at + 4)).toEqual([1, 2, 3, 4]);
    }
  });
});

const insertAlbum = (title: string, artists: string[], status = 'owned') =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(`INSERT INTO albums (title, artist, format, title_status, navidrome_id) VALUES (?, ?, 'CD', ?, ?)`,
      [title, JSON.stringify(artists), status, status === 'digital' ? `nd-${title}` : null],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const copy = (id: string): NavidromeAlbum => ({ id, name: id, artist: 'A', musicBrainzId: null, songCount: 3, userRating: 0 });
const file = (albumId: string, id: string, track: number, title: string, artist: string, starred = false): NavidromeSong => ({
  albumId, id, title, artist, track, discNumber: 1, durationSec: 300, suffix: 'flac', bitDepth: 16, starred,
});

describe('the search of what plays, for a mixtape', () => {
  let symphony: number;
  let rock: number;
  let wished: number;

  beforeEach(async () => {
    mixtapeSearchService.forget();
    symphony = await insertAlbum('Symphony no. 9 “From The New World”', ['Antonín Dvořák', 'San Francisco Symphony', 'Seiji Ozawa']);
    rock = await insertAlbum('Absolution', ['Muse']);
    wished = await insertAlbum('Drones', ['Muse'], 'wish');
    const songs = [
      ...dvorak.map((one, at) => file('nd-dvorak', `d${at + 1}`, at + 1, one.title, 'Antonín Dvořák')),
      file('nd-dvorak', 'd5', 5, 'Carnival Overture, op. 92', 'Antonín Dvořák'),
      file('nd-muse', 'm1', 1, 'Apocalypse Please', 'Muse'),
      file('nd-muse', 'm2', 2, 'Time Is Running Out', 'Muse', true),
      file('nd-drones', 'w1', 1, 'Dead Inside', 'Muse'),
    ];
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(ripStatusService, 'library').mockResolvedValue({ albums: [], songs, lengths: { cd: new Map(), navidrome: new Map() } } as never);
    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[symphony, copy('nd-dvorak')], [rock, copy('nd-muse')], [wished, copy('nd-drones')]]));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of [symphony, rock, wished]) await Album.delete(id);
  });

  it('finds an album whole, its works under their name, and the songs', async () => {
    const { body } = await request(app).get('/api/music/mixtapes/search').query({ q: 'dvorak 9' }).expect(200);
    expect(body.albums.map((one: { albumId: number }) => one.albumId)).toEqual([symphony]);
    expect(body.albums[0].songs).toHaveLength(5);
    expect(body.works).toHaveLength(1);
    expect(body.works[0]).toMatchObject({ name: 'Symphony no. 9', albumId: symphony });
    expect(body.works[0].songs.map((one: { movement: string }) => one.movement)).toEqual(dvorak.map(one => one.title.replace('Symphony no. 9: ', '')));
    // The movements come with their work, not again one by one.
    expect(body.tracks.map((one: { songId: string }) => one.songId)).toEqual(['d5']);
  });

  it('finds songs by their title or their artist, the favourite first, and never on the wish list', async () => {
    const { body } = await request(app).get('/api/music/mixtapes/search').query({ q: 'muse' }).expect(200);
    expect(body.albums.map((one: { albumId: number }) => one.albumId)).toEqual([rock]);
    expect(body.tracks.map((one: { songId: string }) => one.songId)).toEqual(['m2', 'm1']);
    expect(body.tracks[0]).toMatchObject({ title: 'Time Is Running Out', album: 'Absolution', albumId: rock, starred: true, work: null });
    const running_ = await request(app).get('/api/music/mixtapes/search').query({ q: 'running' }).expect(200);
    expect(running_.body).toMatchObject({ albums: [], works: [] });
    expect(running_.body.tracks.map((one: { songId: string }) => one.songId)).toEqual(['m2']);
  });

  it('finds a name by its words before a name that only holds the letters, and works by the songs\' artist', async () => {
    const cabrel = await insertAlbum('Sarbacane', ['Francis Cabrel']);
    const brel = await insertAlbum('Grand Jacques', ['Jacques Brel']);
    const kempff = await insertAlbum('Die 32 Klaviersonaten', ['Wilhelm Kempff']);
    const more = [
      file('nd-cabrel', 'c1', 1, 'Petite Marie', 'Francis Cabrel', true),
      file('nd-brel', 'b1', 1, 'La Haine', 'Jacques Brel'),
      file('nd-kempff', 'k1', 1, 'Sonata no.1 in f op.2 no.1 - 1', 'Ludwig van Beethoven'),
      file('nd-kempff', 'k2', 2, 'Sonata no.1 in f op.2 no.1 - 2', 'Ludwig van Beethoven'),
    ];
    const library = await ripStatusService.library();
    (ripStatusService.library as jest.Mock).mockResolvedValue({ ...library, songs: [...library.songs, ...more] });
    const copies = await ripStatusService.navidromeAlbums();
    (ripStatusService.navidromeAlbums as jest.Mock).mockResolvedValue(new Map([...copies, [cabrel, copy('nd-cabrel')], [brel, copy('nd-brel')], [kempff, copy('nd-kempff')]]));
    mixtapeSearchService.forget();
    try {
      const brels = (await request(app).get('/api/music/mixtapes/search').query({ q: 'brel' }).expect(200)).body;
      expect(brels.tracks.map((one: { songId: string }) => one.songId)).toEqual(['b1', 'c1']);
      const sonatas = (await request(app).get('/api/music/mixtapes/search').query({ q: 'beethoven' }).expect(200)).body;
      expect(sonatas.works.map((one: { name: string }) => one.name)).toEqual(['Sonata no.1 in f op.2 no.1']);
      expect(sonatas.albums.map((one: { albumId: number }) => one.albumId)).toEqual([kempff]);
    } finally {
      for (const id of [cabrel, brel, kempff]) await Album.delete(id);
    }
  });

  it('finds nothing for no words', async () => {
    expect((await request(app).get('/api/music/mixtapes/search').query({ q: '  ' }).expect(200)).body).toEqual({ albums: [], works: [], tracks: [] });
  });
});
