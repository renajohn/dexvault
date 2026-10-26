import request from 'supertest';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import app from '../../index';
import { getDatabase } from '../../src/database';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import lyricsService, { artistOf, findByTags, inStep, lagBetween, lyricsTiming, pickResult, resolveOnDisk, songInParentheses } from '../../src/services/lyricsService';

const run = (sql: string, params: unknown[] = []) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const insertAlbum = (title: string, artist: string[], status = 'owned') =>
  run(`INSERT INTO albums (title, artist, format, title_status) VALUES (?, ?, 'CD', ?)`, [title, JSON.stringify(artist), status]);

const insertTrack = (albumId: number, track: number, title: string, durationSec = 264, artist: string[] = []) =>
  run(`INSERT INTO tracks (album_id, disc_number, track_number, title, duration_sec, artist) VALUES (?, 1, ?, ?, ?, ?)`,
    [albumId, track, title, durationSec, JSON.stringify(artist)]);

const record = (fields: Partial<{ id: number; trackName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null }>) => ({
  id: 1, trackName: 'T', artistName: 'A', albumName: 'B', duration: 264, instrumental: false, plainLyrics: 'words', syncedLyrics: null, ...fields,
});

const notFound = () => Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } });

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.MUSIC_LIBRARY_PATH;
});

describe('lyrics lookup', () => {
  it('prend l’artiste de la piste, sinon celui de l’album, avec un tiret ordinaire', () => {
    expect(artistOf({ trackArtist: '[]', albumArtist: JSON.stringify(['‐M‐']) })).toBe('-M-');
    expect(artistOf({ trackArtist: JSON.stringify(['Queen']), albumArtist: JSON.stringify(['Various Artists']) })).toBe('Queen');
  });

  it('garde le résultat de recherche de la bonne durée, synchronisé d’abord', () => {
    const picked = pickResult([
      record({ id: 1, duration: 300 }),
      record({ id: 2, duration: 262 }),
      record({ id: 3, duration: 266, syncedLyrics: '[00:01.00] words' }),
    ], 264);
    expect(picked?.id).toBe(3);
    expect(pickResult([record({ duration: 300 })], 264)).toBeNull();
  });

  it('mesure le retard d’un texte synchronisé sur un autre par les lignes en commun', () => {
    const jungle = '[00:07.45] Oh, my God\n[00:40.26] Welcome to the jungle\n[00:42.10] We got fun and games\n[01:07.50] Welcome to the jungle';
    const late = '[00:10.05] Oh, my God\n[00:42.86] Welcome to the jungle\n[00:44.70] We got fun and games\n[01:10.18] Welcome to the jungle';
    expect(lagBetween(jungle, late)).toBeCloseTo(2.6, 1);
    expect(lagBetween(late, jungle)).toBeCloseTo(-2.6, 1);
    expect(lagBetween(jungle, '[00:01.00] Something else\n[00:40.26] Welcome to the jungle')).toBeNull();
  });

  it('écarte un texte synchronisé en retard sur la plupart des autres de la même durée', () => {
    const lines = (shift: number, hundredths = 45) => ['Oh, my God', 'Welcome to the jungle', 'We got fun and games', 'We got everything you want']
      .map((words, index) => `[00:${String(7 + index * 11 + shift).padStart(2, '0')}.${hundredths}] ${words}`).join('\n');
    const late = record({ id: 1, duration: 274, syncedLyrics: lines(3) });
    const others = [
      record({ id: 2, duration: 273.6, syncedLyrics: lines(0) }),
      record({ id: 3, duration: 273, syncedLyrics: lines(0, 43) }),
      record({ id: 4, duration: 334, syncedLyrics: lines(0, 40) }),
    ];
    expect(inStep(late, [late, ...others], 274).id).toBe(2);
    // One other alone does not outvote it, nor two when as many agree with it.
    expect(inStep(late, [others[0]], 274).id).toBe(1);
    const agreeing = [record({ id: 5, duration: 274, syncedLyrics: lines(3, 50) }), record({ id: 6, duration: 275, syncedLyrics: lines(3, 40) })];
    expect(inStep(late, [...others, ...agreeing], 274).id).toBe(1);
    // A text copied under several albums speaks once, and so do the chosen one's copies: the two that differ win.
    const copies = [1, 2, 3].map(id => record({ id: 10 + id, duration: 274, syncedLyrics: lines(1).replace(/\] /g, ']') }));
    const ownCopies = [record({ id: 20, duration: 274, syncedLyrics: lines(3) })];
    expect(inStep(late, [...copies, ...ownCopies, others[0], others[1]], 274).id).toBe(2);
  });

  it('cherche aussi librement quand la recherche par artiste ne rend que des copies du texte en retard', async () => {
    const albumId = await insertAlbum(`Communiqué ${Math.random()}`, ['Dire Straits']);
    await insertTrack(albumId, 1, 'Once Upon a Time in the West', 325);
    const lines = (shift: number, hundredths = 18) => ['Some people get a cheap laugh', 'Scaring the pedestrians', 'Crossing up progress', 'Leaving just enough room']
      .map((words, index) => `[01:${String(10 + index * 6 - shift).padStart(2, '0')}.${hundredths}] ${words}`).join('\n');
    const get = jest.spyOn(axios, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url.endsWith('/get')) return { data: record({ id: 810736, duration: 325, syncedLyrics: lines(0) }) };
      if (config?.params?.q) return { data: [record({ id: 25094621, duration: 325, syncedLyrics: lines(1, 20) }), record({ id: 1472803, duration: 325, syncedLyrics: lines(1, 10) })] };
      return { data: [810736, 36842731, 34372084].map(id => record({ id, duration: 325, syncedLyrics: lines(0) })) };
    });

    const res = await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`);
    expect(res.body).toMatchObject({ status: 'found', sourceId: '25094621' });
    expect(get).toHaveBeenCalledWith('https://lrclib.net/api/search', expect.objectContaining({ params: { q: 'Dire Straits Once Upon a Time in the West' } }));
  });

  it('cherche une piste à l’ouverture et garde ce qu’il a trouvé', async () => {
    const albumId = await insertAlbum(`OK Computer ${Math.random()}`, ['Radiohead']);
    await insertTrack(albumId, 6, 'Karma Police');
    const get = jest.spyOn(axios, 'get').mockImplementation(async (url: string) =>
      ({ data: url.endsWith('/get') ? record({ id: 13976, plainLyrics: 'Karma police', syncedLyrics: '[00:01.00] Karma police' }) : [] }));

    const first = await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/6/lyrics`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'found', plain: 'Karma police', synced: '[00:01.00] Karma police', source: 'lrclib', sourceId: '13976' });
    expect(get).toHaveBeenCalledWith('https://lrclib.net/api/get', expect.objectContaining({
      params: { artist_name: 'Radiohead', track_name: 'Karma Police', album_name: expect.any(String), duration: 264 },
    }));

    // Kept: no second request.
    get.mockClear();
    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/6/lyrics`)).body.status).toBe('found');
    expect(get).not.toHaveBeenCalled();
  });

  it('se rabat sur la recherche, puis sur le titre sans « (Remastered) »', async () => {
    const albumId = await insertAlbum(`Best Of ${Math.random()}`, ['Bee Gees']);
    await insertTrack(albumId, 1, 'Too Much Heaven (Remastered 2007)', 296);
    jest.spyOn(axios, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url.endsWith('/get')) throw notFound();
      if (config?.params?.track_name === 'Too Much Heaven') return { data: [record({ id: 7, duration: 297 })] };
      return { data: [] };
    });

    const res = await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`);
    expect(res.body).toMatchObject({ status: 'found', sourceId: '7' });
  });

  it('reconnaît la chanson qu’une scène de film met entre parenthèses, pas « (live) »', () => {
    expect(songInParentheses('End Credits (Blackout)')).toBe('Blackout');
    expect(songInParentheses('Gallery Slideshow (Sing for Absolution)')).toBe('Sing for Absolution');
    expect(songInParentheses('Thankful (live)')).toBeNull();
    expect(songInParentheses('Tell Me Why (smooth radio edit)')).toBeNull();
    expect(songInParentheses('Plug In Baby')).toBeNull();
  });

  it('prend les paroles d’une autre prise, sans les temps, quand aucune n’a la durée du CD', async () => {
    const albumId = await insertAlbum(`Drones ${Math.random()}`, ['Muse']);
    await insertTrack(albumId, 1, 'Dead Inside (live at Brighton Dome)', 279);
    await insertTrack(albumId, 2, 'End Credits (Blackout)', 276);
    jest.spyOn(axios, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url.endsWith('/get')) throw notFound();
      const name = config?.params?.track_name;
      if (name === 'Dead Inside') {
        return { data: [record({ id: 3, trackName: 'DEAD INSIDE', duration: 263, plainLyrics: null, syncedLyrics: '[00:01.00] Revolt\n[00:04.50] Dead inside' })] };
      }
      if (name === 'Blackout') return { data: [record({ id: 4, trackName: 'Blackout', duration: 262, plainLyrics: 'Don’t kid yourself', syncedLyrics: '[00:01.00] Don’t kid yourself' })] };
      return { data: [] };
    });

    const live = await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`);
    expect(live.body).toMatchObject({ status: 'found', sourceId: '3', plain: 'Revolt\nDead inside', synced: null });
    const scene = await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`);
    expect(scene.body).toMatchObject({ status: 'found', sourceId: '4', plain: 'Don’t kid yourself', synced: null });
  });

  it('demande aussi l’autre chanteur d’un duo, et ne prend pas une chanson d’un autre titre', async () => {
    const albumId = await insertAlbum(`Duos ${Math.random()}`, ['Véronique Sanson']);
    await insertTrack(albumId, 1, 'Bahia', 225, ['Alain Chamfort']);
    await insertTrack(albumId, 2, 'Unknown Song', 200);
    jest.spyOn(axios, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url.endsWith('/get')) throw notFound();
      if (config?.params?.artist_name === 'Véronique Sanson' && config?.params?.track_name === 'Bahia') {
        return { data: [record({ id: 5, trackName: 'Bahia', duration: 172 })] };
      }
      return { data: [record({ id: 6, trackName: 'Another Song', duration: 100 })] };
    });

    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body).toMatchObject({ status: 'found', sourceId: '5' });
    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`)).body).toMatchObject({ status: 'missing' });
  });

  it('note une piste instrumentale ou introuvable, et la recherche à nouveau sur demande', async () => {
    const albumId = await insertAlbum(`Play ${Math.random()}`, ['Moby']);
    await insertTrack(albumId, 1, 'Guitar Flute & String');
    await insertTrack(albumId, 2, 'Unknown Song');
    const get = jest.spyOn(axios, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (config?.params?.track_name === 'Guitar Flute & String' && url.endsWith('/get')) return { data: record({ instrumental: true, plainLyrics: null }) };
      if (url.endsWith('/get')) throw notFound();
      return { data: [] };
    });

    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body.status).toBe('instrumental');
    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`)).body.status).toBe('missing');

    get.mockResolvedValue({ data: record({ plainLyrics: 'now there' }) });
    expect((await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`)).body).toMatchObject({ status: 'found', plain: 'now there' });
  });

  it('dit pour chaque piste d’un album si elle a des paroles, et cherche en arrière-plan celles jamais cherchées', async () => {
    const albumId = await insertAlbum(`Come Away With Me ${Math.random()}`, ['Norah Jones']);
    await insertTrack(albumId, 1, 'Don’t Know Why');
    await insertTrack(albumId, 2, 'Seven Years');
    await run(`INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, checked_at) VALUES (?, 1, 1, 'Don’t Know Why', 'found', '2026-10-16')`, [albumId]);
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: record({ instrumental: true, plainLyrics: null }) });

    const first = await request(app).get(`/api/music/albums/${albumId}/lyrics`);
    expect(first.status).toBe(200);
    expect(first.body.tracks).toEqual([
      { discNumber: 1, trackNumber: 1, status: 'found' },
      { discNumber: 1, trackNumber: 2, status: 'pending' },
    ]);

    // The track never looked up is, in the background: the next call knows.
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(get).toHaveBeenCalledTimes(1);
    const second = await request(app).get(`/api/music/albums/${albumId}/lyrics`);
    expect(second.body.tracks[1]).toEqual({ discNumber: 1, trackNumber: 2, status: 'instrumental' });
    expect((await request(app).get('/api/music/albums/999999/lyrics')).status).toBe(404);
  });

  it('répond 404 pour une piste que le CD n’a pas', async () => {
    const albumId = await insertAlbum(`Short ${Math.random()}`, ['X']);
    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/9/lyrics`)).status).toBe(404);
  });

  it('réessaie quand LRCLIB répond 503, et laisse pour plus tard une piste qui échoue toujours', async () => {
    lyricsTiming.retryDelaysMs = [1, 1];
    const albumId = await insertAlbum(`Flaky ${Math.random()}`, ['Muse']);
    await insertTrack(albumId, 1, 'Flaky Song');
    await insertTrack(albumId, 2, 'Broken Song');
    const unavailable = () => Object.assign(new Error('503'), { isAxiosError: true, response: { status: 503 } });
    let flaky = 0;
    jest.spyOn(axios, 'get').mockImplementation(async (_url: string, config?: { params?: Record<string, unknown> }) => {
      if (config?.params?.track_name === 'Broken Song') throw unavailable();
      if (config?.params?.track_name === 'Flaky Song' && flaky++ < 2) throw unavailable();
      return { data: record({ plainLyrics: 'got it' }) };
    });
    try {
      await lyricsService.lookUpMissing();
    } finally {
      lyricsTiming.retryDelaysMs = [5000, 15000, 45000];
    }
    expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body.plain).toBe('got it');
    const broken = await new Promise<unknown>(r => getDatabase().get('SELECT * FROM track_lyrics WHERE album_id = ? AND track_number = 2', [albumId], (_e, row) => r(row)));
    expect(broken).toBeUndefined();
  });

  it('remplit les pistes de la collection jamais cherchées, pas celles de la wish list', async () => {
    // Earlier tests left their tracks looked up; these are the only new ones.
    const owned = await insertAlbum(`Owned ${Math.random()}`, ['Muse']);
    const wished = await insertAlbum(`Wished ${Math.random()}`, ['Muse'], 'wish');
    await insertTrack(owned, 1, 'Blackout');
    await insertTrack(wished, 1, 'Hysteria');
    const asked: unknown[] = [];
    jest.spyOn(axios, 'get').mockImplementation(async (_url: string, config?: { params?: Record<string, unknown> }) => {
      asked.push(config?.params?.track_name);
      return { data: record({}) };
    });

    await lyricsService.lookUpMissing();
    expect(asked).toContain('Blackout');
    expect(asked).not.toContain('Hysteria');
  });

  it('laisse de côté les CD classiques et passe chaque album fini à la suite', async () => {
    const pop = await insertAlbum(`Pop ${Math.random()}`, ['Hozier']);
    const baroque = await insertAlbum(`Baroque ${Math.random()}`, ['Various Artists']);
    await run(`UPDATE albums SET genres = ? WHERE id = ?`, [JSON.stringify(['Classical', 'Baroque']), baroque]);
    const rock = await insertAlbum(`Rock ${Math.random()}`, ['Muse']);
    await insertTrack(pop, 1, 'Cherry Wine');
    await insertTrack(pop, 2, 'From Eden');
    await insertTrack(baroque, 1, 'Brandenburg Concerto No. 3: I. Allegro', 300, ['Johann Sebastian Bach']);
    await insertTrack(rock, 1, 'Uprising');
    const asked: unknown[] = [];
    jest.spyOn(axios, 'get').mockImplementation(async (_url: string, config?: { params?: Record<string, unknown> }) => {
      asked.push(config?.params?.track_name);
      return { data: record({}) };
    });

    const done: Array<{ albumId: number; asked: number }> = [];
    await lyricsService.lookUpMissing(async albumId => { done.push({ albumId, asked: asked.length }); });
    expect(asked).toEqual(['Cherry Wine', 'From Eden', 'Uprising']);
    // Each album is handed on once its tracks are looked up, before the next one starts.
    expect(done).toEqual([{ albumId: pop, asked: 2 }, { albumId: rock, asked: 3 }]);
    // A classical track is still looked up when it is opened.
    expect((await request(app).get(`/api/music/albums/${baroque}/discs/1/tracks/1/lyrics`)).status).toBe(200);
    expect(asked).toContain('Brandenburg Concerto No. 3: I. Allegro');
  });
});

describe('.lrc files beside the rips', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dexvault-music-'));
    ripStatusService.clearCache();
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('trouve un fichier dont le nom est en Unicode décomposé', () => {
    const nfd = 'Ve\u0301ronique';
    fs.mkdirSync(path.join(root, 'FLAC', 'Zazie', nfd), { recursive: true });
    fs.writeFileSync(path.join(root, 'FLAC', 'Zazie', nfd, '01 Craque.flac'), '');
    // macOS ignores the difference that Linux, on p-cloud, makes: compare both in one form.
    const found = resolveOnDisk(root, 'FLAC/Zazie/V\u00e9ronique/01 Craque.flac');
    expect(found && fs.existsSync(found)).toBe(true);
    expect(found?.normalize('NFC')).toBe(path.join(root, 'FLAC', 'Zazie', 'V\u00e9ronique', '01 Craque.flac'));
    expect(resolveOnDisk(root, 'FLAC/Zazie/Absent/01.flac')).toBeNull();
  });

  it('écrit un .lrc à côté de chaque piste qui a des paroles, sans toucher à un .lrc existant', async () => {
    process.env.MUSIC_LIBRARY_PATH = root;
    const albumId = await insertAlbum(`Lrc ${Math.random()}`, ['Hozier']);
    await insertTrack(albumId, 1, 'Jackie and Wilson');
    await insertTrack(albumId, 2, 'Angel of Small Death');
    await insertTrack(albumId, 3, 'Instrumental');
    await run(`INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, plain, synced, checked_at) VALUES
      (?, 1, 1, 'Jackie and Wilson', 'found', 'plain words', '[00:01.00] timed words', '2026-10-13'),
      (?, 1, 2, 'Angel of Small Death', 'found', 'mine?', NULL, '2026-10-13'),
      (?, 1, 3, 'Instrumental', 'instrumental', NULL, NULL, '2026-10-13')`, [albumId, albumId, albumId]);

    const dir = path.join(root, 'FLAC', 'Hozier', 'Hozier');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['01 Jackie.flac', '02 Angel.flac', '03 Instrumental.flac']) fs.writeFileSync(path.join(dir, name), '');
    fs.writeFileSync(path.join(dir, '02 Angel.lrc'), 'by hand\n');

    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[albumId, { id: 'nd-1', name: 'Hozier', artist: 'Hozier', musicBrainzId: null, songCount: 3, userRating: 0 }]]));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(['01 Jackie.flac', '02 Angel.flac', '03 Instrumental.flac'].map((name, index) => ({
      id: `s${index}`, url: null, discNumber: 1, track: index + 1, title: name, durationSec: 264, suffix: 'flac',
      bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: `FLAC/Hozier/Hozier/${name}`,
    })));

    const report = await lyricsService.writeLrcFiles();
    expect(report).toEqual({ written: 1, alreadyThere: 1, notOnDisk: 0 });
    expect(fs.readFileSync(path.join(dir, '01 Jackie.lrc'), 'utf8')).toBe('[00:01.00] timed words\n');
    expect(fs.readFileSync(path.join(dir, '02 Angel.lrc'), 'utf8')).toBe('by hand\n');
    expect(fs.existsSync(path.join(dir, '03 Instrumental.lrc'))).toBe(false);
  });

  it('reprend une piste dont l’entrée exacte est en retard, et réécrit le .lrc que DexVault avait écrit', async () => {
    process.env.MUSIC_LIBRARY_PATH = root;
    const albumId = await insertAlbum(`Appetite ${Math.random()}`, ['Guns N’ Roses']);
    await insertTrack(albumId, 1, 'Welcome to the Jungle', 274);
    await insertTrack(albumId, 2, 'It’s So Easy', 274);
    const lines = (shift: number) => ['Oh, my God', 'Welcome to the jungle', 'We got fun and games', 'We got everything you want']
      .map((words, index) => `[00:${String(7 + index * 11 + shift).padStart(2, '0')}.45] ${words}`).join('\n');
    const late = lines(3);
    await run(`INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, plain, synced, checked_at) VALUES
      (?, 1, 1, 'Welcome to the Jungle', 'found', 'words', ?, '2026-10-13'),
      (?, 1, 2, 'It’s So Easy', 'found', 'words', ?, '2026-10-13')`, [albumId, late, albumId, late]);
    const dir = path.join(root, 'FLAC', 'Guns N’ Roses', 'Appetite for Destruction');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['01 Welcome.flac', '02 Easy.flac']) fs.writeFileSync(path.join(dir, name), '');
    fs.writeFileSync(path.join(dir, '01 Welcome.lrc'), `${late}\n`);
    fs.writeFileSync(path.join(dir, '02 Easy.lrc'), 'by hand\n');

    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[albumId, { id: 'nd-3', name: 'Appetite', artist: 'Guns N’ Roses', musicBrainzId: null, songCount: 2, userRating: 0 }]]));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(['01 Welcome.flac', '02 Easy.flac'].map((name, index) => ({
      id: `s${index}`, url: null, discNumber: 1, track: index + 1, title: name, durationSec: 274, suffix: 'flac',
      bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: `FLAC/Guns N’ Roses/Appetite for Destruction/${name}`,
    })));
    jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/get')) return { data: record({ id: 5743773, duration: 274, syncedLyrics: late }) };
      return { data: [
        record({ id: 5743773, duration: 274, syncedLyrics: late }),
        record({ id: 22593691, duration: 273.6, syncedLyrics: lines(0) }),
        record({ id: 21989462, duration: 273, syncedLyrics: lines(0).replace(/\.45\]/g, '.43]') }),
      ] };
    });

    const res = await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`);
    expect(res.body).toMatchObject({ status: 'found', sourceId: '22593691', synced: lines(0) });
    expect(fs.readFileSync(path.join(dir, '01 Welcome.lrc'), 'utf8')).toBe(`${lines(0)}\n`);

    // An .lrc someone wrote by hand stays.
    expect((await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`)).body.sourceId).toBe('22593691');
    expect(fs.readFileSync(path.join(dir, '02 Easy.lrc'), 'utf8')).toBe('by hand\n');
  });

  it('demande le vrai chemin à Navidrome quand Subsonic en invente un à partir des tags', async () => {
    process.env.MUSIC_LIBRARY_PATH = root;
    const albumId = await insertAlbum(`Fake ${Math.random()}`, ['Muse']);
    await insertTrack(albumId, 1, 'Blackout');
    await run(`INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, plain, checked_at)
      VALUES (?, 1, 1, 'Blackout', 'found', 'words', '2026-10-13')`, [albumId]);
    const dir = path.join(root, 'FLAC', 'Muse', 'Absolution');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-14 Blackout.flac'), '');

    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[albumId, { id: 'nd-2', name: 'Absolution', artist: 'Muse', musicBrainzId: null, songCount: 1, userRating: 0 }]]));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue([{
      id: 's1', url: null, discNumber: 1, track: 1, title: 'Blackout', durationSec: 264, suffix: 'flac',
      bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: 'Muse/Absolution/01 - Blackout.flac',
    }]);
    jest.spyOn(navidromeService, 'getSongPaths').mockResolvedValue([{ discNumber: 1, track: 1, path: '/music/FLAC/Muse/Absolution/01-14 Blackout.flac' }]);

    expect(await lyricsService.writeLrcFiles()).toEqual({ written: 1, alreadyThere: 0, notOnDisk: 0 });
    expect(fs.readFileSync(path.join(dir, '01-14 Blackout.lrc'), 'utf8')).toBe('words\n');
  });

  it('retrouve un fichier sur le disque d’après le chemin que Navidrome tire des tags', () => {
    const flac = path.join(root, 'FLAC', 'Tracy Chapman', 'Crossroads');
    const mp3 = path.join(root, 'Phil Collins', 'No Jacket Required (1985)');
    fs.mkdirSync(flac, { recursive: true });
    fs.mkdirSync(mp3, { recursive: true });
    for (const name of ['01 Crossroads.flac', '10 All That You Have Is Your Soul.flac', '01 Crossroads.lrc']) fs.writeFileSync(path.join(flac, name), '');
    fs.writeFileSync(path.join(mp3, '1-02 Long Long Way to Go.mp3'), '');

    expect(findByTags(root, 'Tracy Chapman/Crossroads/01-01 - Crossroads.flac', 1, 1)).toBe(path.join(flac, '01 Crossroads.flac'));
    expect(findByTags(root, 'Tracy Chapman/Crossroads/01-10 - All That You Have Is Your Soul.flac', 1, 10)).toBe(path.join(flac, '10 All That You Have Is Your Soul.flac'));
    expect(findByTags(root, 'Phil Collins/No Jacket Required/01-02 - Long Long Way to Go.mp3', 1, 2)).toBe(path.join(mp3, '1-02 Long Long Way to Go.mp3'));
    expect(findByTags(root, 'Tracy Chapman/Crossroads/01-05 - Be Careful of My Heart.flac', 1, 5)).toBeNull();
  });

  it('ne prend pas « 1-10 » ni « 2-01 » pour la piste 1 d’un double album', () => {
    const wall = path.join(root, 'FLAC', 'Pink Floyd', 'The Wall');
    fs.mkdirSync(wall, { recursive: true });
    for (const name of ['1-01 In the Flesh_.flac', '1-02 The Thin Ice.flac', '1-10 One of My Turns.flac', '1-11 Don’t Leave Me Now.flac', '2-01 Hey You.flac', '2-02 Is There Anybody Out There_.flac']) {
      fs.writeFileSync(path.join(wall, name), '');
    }

    expect(findByTags(root, 'Pink Floyd/The Wall/01-01 - In the Flesh?.flac', 1, 1)).toBe(path.join(wall, '1-01 In the Flesh_.flac'));
    expect(findByTags(root, 'Pink Floyd/The Wall/01-02 - The Thin Ice.flac', 1, 2)).toBe(path.join(wall, '1-02 The Thin Ice.flac'));
    expect(findByTags(root, 'Pink Floyd/The Wall/02-01 - Hey You.flac', 2, 1)).toBe(path.join(wall, '2-01 Hey You.flac'));
  });

  it('ne fait rien sans dossier de musique monté', async () => {
    expect(await lyricsService.writeLrcFiles()).toBeNull();
  });
  describe('timing fixed by hand', () => {
    const lrclib = '[00:08.40] Welcome to the jungle\n[00:12.00] We got fun and games';
    const fixed = '[00:06.00] Welcome to the jungle\n[00:09.60] We got fun and games';
    const timing = (albumId: number, track = 1) => `/api/music/albums/${albumId}/discs/1/tracks/${track}/lyrics/timing`;

    const ripped = async () => {
      process.env.MUSIC_LIBRARY_PATH = root;
      const albumId = await insertAlbum(`Timing ${Math.random()}`, ['Guns N’ Roses']);
      await insertTrack(albumId, 1, 'Welcome to the Jungle', 274);
      await insertTrack(albumId, 2, 'It’s So Easy', 274);
      await run(`INSERT INTO track_lyrics (album_id, disc_number, track_number, title, status, plain, synced, source, source_id, checked_at) VALUES
        (?, 1, 1, 'Welcome to the Jungle', 'found', 'words', ?, 'lrclib', '7', '2026-10-26'),
        (?, 1, 2, 'It’s So Easy', 'found', 'words', ?, 'lrclib', '8', '2026-10-26')`, [albumId, lrclib, albumId, lrclib]);
      const dir = path.join(root, 'FLAC', 'Guns', 'Appetite');
      fs.mkdirSync(dir, { recursive: true });
      for (const name of ['01 Welcome.flac', '02 Easy.flac']) fs.writeFileSync(path.join(dir, name), '');
      fs.writeFileSync(path.join(dir, '01 Welcome.lrc'), `${lrclib}\n`);
      fs.writeFileSync(path.join(dir, '02 Easy.lrc'), 'by hand\n');
      jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[albumId, { id: 'nd-t', name: 'Appetite', artist: 'Guns', musicBrainzId: null, songCount: 2, userRating: 0 }]]));
      jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(['01 Welcome.flac', '02 Easy.flac'].map((name, index) => ({
        id: `s${index}`, url: null, discNumber: 1, track: index + 1, title: name, durationSec: 274, suffix: 'flac',
        bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: `FLAC/Guns/Appetite/${name}`,
      })));
      return { albumId, lrc: (name: string) => fs.readFileSync(path.join(dir, name), 'utf8') };
    };

    it('garde le timing corrigé dans DexVault seulement, LRCLIB à côté, et le remet à zéro', async () => {
      const { albumId, lrc } = await ripped();
      const res = await request(app).put(timing(albumId)).send({ synced: fixed });
      expect(res.body).toMatchObject({ lrc: 'none', lyrics: { synced: fixed, lrclibSynced: lrclib, timing: 'fixed' } });
      expect((await request(app).get(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body).toMatchObject({ synced: fixed, timing: 'fixed' });
      expect(lrc('01 Welcome.lrc')).toBe(`${lrclib}\n`);

      const reset = await request(app).delete(timing(albumId));
      expect(reset.body).toMatchObject({ lrc: 'none', lyrics: { synced: lrclib, timing: 'lrclib' } });
    });

    it('écrit le timing dans le .lrc que DexVault avait écrit, jamais dans un autre, et y remet celui de LRCLIB', async () => {
      const { albumId, lrc } = await ripped();
      expect((await request(app).put(timing(albumId)).send({ synced: fixed, intoLyrics: true })).body)
        .toMatchObject({ lrc: 'written', lyrics: { synced: fixed, timing: 'saved' } });
      expect(lrc('01 Welcome.lrc')).toBe(`${fixed}\n`);
      expect(lrc('02 Easy.lrc')).toBe('by hand\n');

      expect((await request(app).put(timing(albumId, 2)).send({ synced: fixed, intoLyrics: true })).body.lrc).toBe('kept');
      expect(lrc('02 Easy.lrc')).toBe('by hand\n');

      expect((await request(app).delete(timing(albumId))).body.lrc).toBe('written');
      expect(lrc('01 Welcome.lrc')).toBe(`${lrclib}\n`);
    });

    it('garde la correction quand LRCLIB rend le même texte, la lâche pour un autre, sauf sauvée dans les paroles', async () => {
      const { albumId } = await ripped();
      await request(app).put(timing(albumId)).send({ synced: fixed });
      await request(app).put(timing(albumId, 2)).send({ synced: fixed, intoLyrics: true });
      let answer = record({ id: 7, duration: 274, syncedLyrics: lrclib });
      jest.spyOn(axios, 'get').mockImplementation(async (url: string) => ({ data: url.endsWith('/get') ? answer : [answer] }));
      expect((await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body).toMatchObject({ synced: fixed, timing: 'fixed' });

      const other = '[00:07.00] Welcome to the jungle\n[00:10.60] We got fun and games';
      answer = record({ id: 9, duration: 274, syncedLyrics: other });
      expect((await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/1/lyrics`)).body).toMatchObject({ synced: other, timing: 'lrclib' });
      expect((await request(app).post(`/api/music/albums/${albumId}/discs/1/tracks/2/lyrics`)).body).toMatchObject({ synced: fixed, lrclibSynced: other, timing: 'saved' });
    });

    it('refuse un texte sans temps, et une piste sans paroles minutées', async () => {
      const { albumId } = await ripped();
      expect((await request(app).put(timing(albumId)).send({ synced: 'no times here' })).status).toBe(400);
      await run(`UPDATE track_lyrics SET synced = NULL WHERE album_id = ? AND track_number = 2`, [albumId]);
      expect((await request(app).put(timing(albumId, 2)).send({ synced: fixed })).status).toBe(404);
    });
  });
});
