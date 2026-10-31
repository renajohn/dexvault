import request from 'supertest';
import axios from 'axios';
import app from '../../index';
import { getDatabase } from '../../src/database';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';

const insertAlbum = (fields: { title: string; artist: string[]; releaseId?: string; format?: string; status?: string }) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(
      `INSERT INTO albums (title, artist, musicbrainz_release_id, format, title_status) VALUES (?, ?, ?, ?, ?)`,
      [fields.title, JSON.stringify(fields.artist), fields.releaseId ?? null, fields.format ?? 'CD', fields.status ?? 'owned'],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
    ));

const album = (id: string, name: string, artist: string, musicBrainzId?: string) => ({ id, name, artist, musicBrainzId: musicBrainzId ?? null, songCount: 2, userRating: 0 });
const songs = (albumId: string, suffix: string, bitDepth: number | null = null) =>
  [1, 2].map(() => ({ albumId, suffix, bitDepth }));

beforeEach(() => {
  ripStatusService.clearCache();
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
});

afterEach(() => jest.restoreAllMocks());

const statusOf = async (id: number) => (await ripStatusService.getStatus()).albums.find(a => a.id === id)!;

describe('rip status', () => {
  it('reconnaît un CD rippé en FLAC par son ID MusicBrainz', async () => {
    const id = await insertAlbum({ title: `Mezzanine ${Math.random()}`, artist: ['Massive Attack'], releaseId: `rel-${Math.random()}` });
    const releaseId = (await new Promise<any>(r => getDatabase().get('SELECT musicbrainz_release_id FROM albums WHERE id = ?', [id], (_e, row) => r(row)))).musicbrainz_release_id;
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd-1', 'Mezzanine', 'Massive Attack', releaseId)]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-1', 'flac'));

    expect(await statusOf(id)).toMatchObject({ state: 'lossless', formats: ['FLAC'], matches: [{ match: 'musicbrainz' }] });
  });

  it('classe en « pas en lossless » un vieux rip MP3 retrouvé par titre et artiste', async () => {
    const title = `Back to Black ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertAlbum({ title, artist: ['Amy Winehouse'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd-2', `${title} (Deluxe Edition)`, 'Amy Winehouse')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-2', 'mp3'));

    expect(await statusOf(id)).toMatchObject({ state: 'lossy', formats: ['MP3'], matches: [{ match: 'title' }] });
  });

  it('retient la meilleure copie quand le nouveau rip côtoie l’ancien MP3', async () => {
    const title = `Abbey Road ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertAlbum({ title, artist: ['The Beatles'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('old', title, 'The Beatles'), album('new', title, 'Beatles, The')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([...songs('old', 'mp3'), ...songs('new', 'm4a', 16)]);

    expect(await statusOf(id)).toMatchObject({ state: 'lossless', formats: ['ALAC', 'MP3'] });
  });

  it('distingue l’AAC de l’ALAC dans un .m4a', async () => {
    const title = `Tea for the Tillerman ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertAlbum({ title, artist: ['Cat Stevens'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd-3', title, 'Cat Stevens')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-3', 'm4a'));

    expect(await statusOf(id)).toMatchObject({ state: 'lossy', formats: ['AAC'] });
  });

  it('trouve une partie d’un titre Discogs traduit, mais pas le même titre d’un autre artiste', async () => {
    const word = Math.random().toString(36).slice(2, 8);
    const id = await insertAlbum({ title: `Cellokonzerte ${word} • Cello Concertos ${word}`, artist: ['Antonio Vivaldi', 'Mstislav Rostropovich'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([
      album('nd-4', `Cello Concertos ${word}`, 'Mstislav Rostropovich; Paul Sacher'),
      album('nd-5', `Cello Concertos ${word}`, 'Yo-Yo Ma'),
    ]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-4', 'flac'));

    const status = await statusOf(id);
    expect(status.state).toBe('lossless');
    expect(status.matches).toHaveLength(1);
  });

  it('laisse de côté la wish list et dit quand Navidrome n’est pas configuré', async () => {
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(false);
    const wished = await insertAlbum({ title: `Wished ${Math.random()}`, artist: ['X'], status: 'wish' });
    const owned = await insertAlbum({ title: `Owned ${Math.random()}`, artist: ['X'] });

    const status = await ripStatusService.getStatus();

    expect(status.configured).toBe(false);
    const ids = status.albums.map(a => a.id);
    expect(ids).toContain(owned);
    expect(ids).not.toContain(wished);
    expect(status.albums.find(a => a.id === owned)!.state).toBe('none');
  });
});

describe('navidromeService', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('s’authentifie par jeton salé sans envoyer le mot de passe, et tourne les pages', async () => {
    jest.restoreAllMocks();
    process.env.NAVIDROME_USER = 'dexvault';
    process.env.NAVIDROME_PASSWORD = 'secret';
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const get = jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: { 'subsonic-response': { status: 'ok', albumList2: { album: page(500) } } } })
      .mockResolvedValueOnce({ data: { 'subsonic-response': { status: 'ok', albumList2: { album: page(3) } } } });

    expect(await navidromeService.getAlbums()).toHaveLength(503);
    const params = (get.mock.calls[0][1] as { params: Record<string, string> }).params;
    expect(get.mock.calls[0][0]).toBe('http://navidrome:4533/rest/getAlbumList2');
    expect(params).toMatchObject({ u: 'dexvault', f: 'json', offset: 0 });
    expect(JSON.stringify(get.mock.calls)).not.toContain('secret');
    expect((get.mock.calls[1][1] as { params: Record<string, number> }).params.offset).toBe(500);
  });
});

describe('adoption des éditions depuis les rips', () => {
  const musicbrainzService = require('../../src/services/musicbrainzService').default;
  const musicbrainzRefreshService = require('../../src/services/musicbrainzRefreshService').default;
  const Album = require('../../src/models/album').default;
  const musicService = require('../../src/services/musicService').default;

  const insertGrouped = (releaseId: string | null, releaseGroupId: string, title = `CD ${Math.random()}`) =>
    new Promise<number>((resolve, reject) =>
      getDatabase().run(
        `INSERT INTO albums (title, artist, musicbrainz_release_id, musicbrainz_release_group_id, format, title_status) VALUES (?, '["X"]', ?, ?, 'CD', 'owned')`,
        [title, releaseId, releaseGroupId],
        function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
      ));

  const library = (releaseId: string, suffix = 'flac') => {
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd-x', 'Aja', 'Steely Dan', releaseId)]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-x', suffix));
  };

  beforeEach(() => {
    jest.spyOn(musicbrainzRefreshService, 'refreshAlbum').mockResolvedValue({} as any);
  });

  it('remplace le premier pressage venu par celui que Picard a reconnu, puis rafraîchit', async () => {
    const group = `rg-${Math.random()}`;
    const id = await insertGrouped(`first-${Math.random()}`, group);
    const exact = `exact-${Math.random()}`;
    library(exact);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: group } });

    const res = await request(app).post('/api/music/digital/sync');

    expect(res.status).toBe(200);
    expect(res.body.editions).toContainEqual(expect.objectContaining({ albumId: id, releaseId: exact, action: 'edition' }));
    expect((await Album.findById(id)).musicbrainzReleaseId).toBe(exact);
    expect(musicbrainzRefreshService.refreshAlbum).toHaveBeenCalledWith(id);
    expect(res.body.library.albums.find((a: { cd: { id: number } | null }) => a.cd?.id === id)).toMatchObject({ quality: 'lossless' });
  });

  it('ne demande le release group à MusicBrainz qu’une fois par édition', async () => {
    const exact = `once-${Math.random()}`;
    library(exact);
    const lookup = jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: `rg-nobody-${Math.random()}` } });

    await ripStatusService.adoptEditions();
    await ripStatusService.adoptEditions();

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('ne touche à rien quand deux CD de la collection sont du même album', async () => {
    const group = `rg-${Math.random()}`;
    const first = await insertGrouped(`a-${Math.random()}`, group);
    await insertGrouped(`b-${Math.random()}`, group);
    library(`exact-${Math.random()}`);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: group } });

    const [result] = await ripStatusService.adoptEditions();

    expect(result).toMatchObject({ skipped: 'several_albums' });
    expect((await Album.findById(first)).musicbrainzReleaseId).toMatch(/^a-/);
  });

  it('attend un rip lossless : un vieux MP3 tagué ne décide rien', async () => {
    const group = `rg-${Math.random()}`;
    const id = await insertGrouped(`first-${Math.random()}`, group);
    library(`exact-${Math.random()}`, 'mp3');
    const lookup = jest.spyOn(musicbrainzService, 'getReleaseDetails');

    expect(await ripStatusService.adoptEditions()).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect((await Album.findById(id)).musicbrainzReleaseId).toMatch(/^first-/);
  });

  it('ajoute à la collection un CD rippé que DexVault ne connaît pas encore', async () => {
    const exact = `new-${Math.random()}`;
    library(exact);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: `rg-new-${Math.random()}` }, media: [{ format: 'CD' }] });
    const add = jest.spyOn(musicService, 'addAlbumFromMusicBrainz').mockResolvedValue({ id: 4242, title: 'Aja' } as any);

    const [result] = await ripStatusService.adoptEditions();

    expect(add).toHaveBeenCalledWith(exact, { titleStatus: 'owned' });
    expect(result).toMatchObject({ albumId: 4242, action: 'added' });
    expect(musicbrainzRefreshService.refreshAlbum).toHaveBeenCalledWith(4242);
  });

  it('n’ajoute pas un album acheté en téléchargement lossless', async () => {
    library(`bandcamp-${Math.random()}`);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: `rg-dl-${Math.random()}` }, media: [{ format: 'Digital Media' }] });
    const add = jest.spyOn(musicService, 'addAlbumFromMusicBrainz');

    const [result] = await ripStatusService.adoptEditions();

    expect(result).toMatchObject({ skipped: 'not_a_cd' });
    expect(add).not.toHaveBeenCalled();
  });

  it('passe dans la collection un album de la wish list qu’on vient de ripper', async () => {
    const group = `rg-${Math.random()}`;
    const id = await new Promise<number>((resolve, reject) =>
      getDatabase().run(
        `INSERT INTO albums (title, artist, musicbrainz_release_id, musicbrainz_release_group_id, format, title_status) VALUES ('Wished', '["X"]', ?, ?, 'CD', 'wish')`,
        [`wish-${Math.random()}`, group],
        function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
      ));
    const exact = `bought-${Math.random()}`;
    library(exact);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: group }, media: [{ format: 'CD' }] });

    const [result] = await ripStatusService.adoptEditions();

    expect(result).toMatchObject({ albumId: id, action: 'promoted' });
    const album = await Album.findById(id);
    expect(album.titleStatus).toBe('owned');
    expect(album.musicbrainzReleaseId).toBe(exact);
    // A CD come into the collection: at the end of Listen Next.
    const musicCollectionService = require('../../src/services/musicCollectionService').default;
    expect((await musicCollectionService.getListenNextEntries()).map((entry: { albumId: number }) => entry.albumId)).toContain(id);
  });

  it('garde la pochette et le dos de DexVault quand un rip change l’édition ou sort l’album de la wish list', async () => {
    const covers = async (status: string) => {
      const group = `rg-${Math.random()}`;
      const id = await new Promise<number>((resolve, reject) =>
        getDatabase().run(
          `INSERT INTO albums (title, artist, musicbrainz_release_id, musicbrainz_release_group_id, format, title_status, cover, back_cover)
           VALUES ('With covers', '["X"]', ?, ?, 'CD', ?, '/images/cd/my-front.jpg', '/images/cd/my-back.jpg')`,
          [`first-${Math.random()}`, group, status],
          function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
        ));
      // The rip in Navidrome has no back cover at all: DexVault never reads images from it.
      library(`exact-${Math.random()}`);
      jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: group }, media: [{ format: 'CD' }] });
      ripStatusService.clearCache();
      await ripStatusService.adoptEditions();
      const album = await Album.findById(id);
      return [album.cover, album.backCover];
    };

    expect(await covers('owned')).toEqual(['/images/cd/my-front.jpg', '/images/cd/my-back.jpg']);
    expect(await covers('wish')).toEqual(['/images/cd/my-front.jpg', '/images/cd/my-back.jpg']);
  });

  it('ne fait rien d’un ancien rip ALAC tagué : seuls les rips FLAC de ce circuit comptent', async () => {
    library(`old-alac-${Math.random()}`, 'm4a');
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-x', 'm4a', 16));
    const lookup = jest.spyOn(musicbrainzService, 'getReleaseDetails');
    const add = jest.spyOn(musicService, 'addAlbumFromMusicBrainz');

    expect(await ripStatusService.adoptEditions()).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('n’adopte pas une édition déjà portée par un autre album', async () => {
    const group = `rg-${Math.random()}`;
    const exact = `taken-${Math.random()}`;
    const id = await insertGrouped(`first-${Math.random()}`, group);
    await insertGrouped(exact, `rg-other-${Math.random()}`, 'Other');
    // The edition is known to DexVault, on another album: nothing to adopt.
    library(exact);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: group } });

    expect(await ripStatusService.adoptEditions()).toEqual([]);
    expect((await Album.findById(id)).musicbrainzReleaseId).toMatch(/^first-/);
  });
});

describe('import de la pochette depuis Navidrome', () => {
  const imageService = require('../../src/services/imageService').default;
  const Album = require('../../src/models/album').default;

  const insertWithCover = (title: string) =>
    new Promise<number>((resolve, reject) =>
      getDatabase().run(
        `INSERT INTO albums (title, artist, format, title_status, cover, back_cover) VALUES (?, '["Massive Attack"]', 'CD', 'owned', '/images/cd/old.jpg', '/images/cd/my-back.jpg')`,
        [title],
        function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
      ));

  beforeEach(() => {
    jest.spyOn(imageService, 'saveImage').mockImplementation(async (_d: unknown, type: unknown, name: unknown) => `/api/images/${type}/${name}`);
    jest.spyOn(imageService, 'resizeImage').mockResolvedValue(true);
  });

  it('prend la pochette du rip lossless, pas celle du vieux MP3, et garde le dos', async () => {
    const title = `Mezzanine ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertWithCover(title);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('mp3', title, 'Massive Attack'), album('flac', title, 'Massive Attack')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([...songs('mp3', 'mp3'), ...songs('flac', 'flac')]);
    const cover = jest.spyOn(navidromeService, 'getCoverArt').mockResolvedValue({ data: Buffer.from('jpeg'), contentType: 'image/jpeg' });

    const res = await request(app).post(`/api/music/albums/${id}/import-navidrome-cover`);

    expect(res.status).toBe(200);
    expect(cover).toHaveBeenCalledWith('flac');
    const saved = await Album.findById(id);
    expect(saved.cover).toMatch(/^\/api\/images\/cd\/custom\/navidrome_\d+_\d+\.jpg$/);
    expect(saved.backCover).toBe('/images/cd/my-back.jpg');
  });

  it('répond 404 pour un CD absent de Navidrome, sans rien changer', async () => {
    const id = await insertWithCover(`Unripped ${Math.random()}`);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([]);

    const res = await request(app).post(`/api/music/albums/${id}/import-navidrome-cover`);

    expect(res.status).toBe(404);
    expect((await Album.findById(id)).cover).toBe('/images/cd/old.jpg');
  });

  it('garde l’ancienne pochette quand Navidrome n’en donne pas', async () => {
    const title = `No art ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertWithCover(title);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd', title, 'Massive Attack')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd', 'flac'));
    jest.spyOn(navidromeService, 'getCoverArt').mockRejectedValue(new Error('Navidrome has no cover for this album'));

    const res = await request(app).post(`/api/music/albums/${id}/import-navidrome-cover`);

    expect(res.status).toBe(502);
    expect((await Album.findById(id)).cover).toBe('/images/cd/old.jpg');
  });
});

describe('fichiers du rip pour le panneau de piste', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('lit les pistes de l’album Navidrome du CD', async () => {
    const title = `Nightfly ${Math.random().toString(36).slice(2, 8)}`;
    const id = await insertAlbum({ title, artist: ['Donald Fagen'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('nd-f', title, 'Donald Fagen')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('nd-f', 'flac', 16));
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { 'subsonic-response': { status: 'ok', album: { song: [
      { id: 'song-1', title: 'I.G.Y.', track: 1, discNumber: 1, duration: 363, suffix: 'FLAC', bitRate: 900, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: 40000000, path: 'Donald Fagen/The Nightfly/01 I.G.Y..flac' },
    ] } } } });
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
    process.env.NAVIDROME_USER = 'dexvault';
    process.env.NAVIDROME_PASSWORD = 'secret';

    const res = await request(app).get(`/api/music/albums/${id}/navidrome-tracks`);

    expect(res.status).toBe(200);
    expect(get.mock.calls[0][0]).toMatch(/\/rest\/getAlbum$/);
    expect(res.body).toMatchObject({ found: true, album: { id: 'nd-f', url: 'https://music.lab.crog.org/app/#/album/nd-f/show' } });
    expect(res.body.tracks[0]).toMatchObject({ id: 'song-1', track: 1, discNumber: 1, suffix: 'flac', bitDepth: 16, samplingRate: 44100 });
    expect(res.body.tracks[0].url).toBe('https://music.lab.crog.org/app/#/song?filter=%7B%22album_id%22%3A%22nd-f%22%2C%22title%22%3A%22I.G.Y.%22%7D');
  });

  it('répond sans erreur pour un CD pas encore rippé', async () => {
    const id = await insertAlbum({ title: `Unripped ${Math.random()}`, artist: ['Nobody'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([]);

    const res = await request(app).get(`/api/music/albums/${id}/navidrome-tracks`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, found: false, tracks: [] });
  });
});

describe('table des éditions déjà demandées', () => {
  const ReleaseGroupLookup = require('../../src/models/releaseGroupLookup').default;
  const run = (sql: string) => new Promise<void>((resolve, reject) => getDatabase().run(sql, (err: Error | null) => (err ? reject(err) : resolve())));

  it('reprend la table de sa première version, sans colonne is_cd, et redemande ce qu’elle ignore', async () => {
    await run('DROP TABLE release_group_lookups');
    await run('CREATE TABLE release_group_lookups (release_id TEXT PRIMARY KEY, release_group_id TEXT, looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    await run("INSERT INTO release_group_lookups (release_id, release_group_id) VALUES ('old-row', 'rg-old')");

    await ReleaseGroupLookup.createTable();

    // Whether the old row is a CD was never noted: it is asked again.
    expect(await ReleaseGroupLookup.find('old-row')).toBeUndefined();
    await ReleaseGroupLookup.save('new-row', { releaseGroupId: 'rg-new', isCd: true });
    expect(await ReleaseGroupLookup.find('new-row')).toEqual({ releaseGroupId: 'rg-new', isCd: true });
  });
});

describe('albums seulement en digital', () => {
  const imageService = require('../../src/services/imageService').default;
  const musicbrainzRefreshService = require('../../src/services/musicbrainzRefreshService').default;
  const Album = require('../../src/models/album').default;
  const Track = require('../../src/models/track').default;
  const tag = () => Math.random().toString(36).slice(2, 8);

  beforeEach(() => {
    jest.spyOn(imageService, 'saveImage').mockImplementation(async (_d: unknown, type: unknown, name: unknown) => `/api/images/${type}/${name}`);
    jest.spyOn(navidromeService, 'getCoverArt').mockResolvedValue({ data: Buffer.from('jpg'), contentType: 'image/jpeg' });
  });

  const digitalOf = async (navidromeId: string) =>
    (await request(app).get('/api/music/digital')).body.albums.find((d: { navidromeId: string }) => d.navidromeId === navidromeId);

  it('liste ce que Navidrome a sans CD dans la collection, et dit ce qui est dans la wish list', async () => {
    const [owned, wished, alone] = [`Owned ${tag()}`, `Wished ${tag()}`, `Alone ${tag()}`];
    await insertAlbum({ title: owned, artist: ['Moby'] });
    const wishId = await insertAlbum({ title: wished, artist: ['Moby'], status: 'wish' });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([
      album('d-owned', owned, 'Moby'), album('d-wished', wished, 'Moby'), album('d-alone', alone, 'Moby'),
    ]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('d-alone', 'mp3'));

    expect(await digitalOf('d-owned')).toMatchObject({ cd: { title: owned }, wishAlbumId: null, buy: null });
    expect(await digitalOf('d-wished')).toMatchObject({ name: wished, cd: null, wishAlbumId: wishId, buy: { wished: true } });
    expect(await digitalOf('d-alone')).toMatchObject({ name: alone, artist: 'Moby', formats: ['MP3'], cd: null, wishAlbumId: null, buy: null });
  });

  const files = (titles: string[]) => titles.map((title, index) => ({
    id: `s${index}`, url: null, discNumber: 1, track: index + 1, title, artist: 'Moby', durationSec: 200 + index,
    suffix: 'mp3', bitRate: 192, bitDepth: null, samplingRate: null, channelCount: null, size: null, path: null,
  }));

  it('met dans la wish list l’album digital lui-même, avec la pochette de Navidrome, puis l’y rend', async () => {
    const name = `Play ${tag()}`;
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('d-play', name, 'Moby')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('d-play', 'mp3'));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(files(['Honey', 'Find My Baby']));

    const put = await request(app).put('/api/music/digital/d-play/wish');
    expect(put.status).toBe(200);
    expect(put.body.wishAlbumId).toEqual(expect.any(Number));
    const wish = await Album.findById(put.body.wishAlbumId);
    expect(wish).toMatchObject({ title: name, artist: ['Moby'], titleStatus: 'wish', format: 'CD', navidromeId: 'd-play' });
    expect(wish.cover).toMatch(/navidrome_/);
    expect((await Track.findByCdId(wish.id)).map((track: { title: string }) => track.title)).toEqual(['Honey', 'Find My Baby']);

    // A second toggle on does not add it twice.
    expect((await request(app).put('/api/music/digital/d-play/wish')).body.wishAlbumId).toBe(put.body.wishAlbumId);

    // Off the wish list, the same album is a digital album again, its tracks kept.
    const del = await request(app).delete('/api/music/digital/d-play/wish');
    expect(del.body.wishAlbumId).toBeNull();
    expect(await Album.findById(put.body.wishAlbumId)).toMatchObject({ titleStatus: 'digital', format: 'Digital Media', navidromeId: 'd-play' });
    expect(await Track.findByCdId(wish.id)).toHaveLength(2);
  });

  it('rafraîchit depuis MusicBrainz l’album souhaité quand ses fichiers ont une édition', async () => {
    const name = `18 ${tag()}`;
    const releaseId = `rel-${tag()}`;
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('d-18', name, 'Moby', releaseId)]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('d-18', 'mp3'));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(files(['We Are All Made of Stars']));
    const refresh = jest.spyOn(musicbrainzRefreshService, 'refreshAlbum').mockResolvedValue({} as never);

    const put = await request(app).put('/api/music/digital/d-18/wish');

    expect(put.body.wishAlbumId).toEqual(expect.any(Number));
    expect(await Album.findById(put.body.wishAlbumId)).toMatchObject({ musicbrainzReleaseId: releaseId, titleStatus: 'wish' });
    expect(refresh).toHaveBeenCalledWith(put.body.wishAlbumId);
  });

  it('rend au digital, au lieu de la supprimer, une ancienne wish qui n’avait pas d’album Navidrome', async () => {
    const name = `Hotel ${tag()}`;
    const wishId = await insertAlbum({ title: name, artist: ['Moby'], status: 'wish' });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('d-hotel', name, 'Moby')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('d-hotel', 'mp3'));

    await request(app).delete('/api/music/digital/d-hotel/wish');

    expect(await Album.findById(wishId)).toMatchObject({ titleStatus: 'digital', navidromeId: 'd-hotel' });
  });

  it('répond 404 pour un album que Navidrome n’a pas', async () => {
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([]);
    expect((await request(app).put('/api/music/digital/nope/wish')).status).toBe(404);
  });
});

describe('rapprochement des copies plus large', () => {
  const tag = () => Math.random().toString(36).slice(2, 8);
  const timed = (albumId: string, lengths: number[]) =>
    lengths.map((durationSec, index) => ({ albumId, suffix: 'm4a', bitDepth: 16, discNumber: 1, track: index + 1, durationSec }));
  const insertTracks = (albumId: number, lengths: number[]) => Promise.all(lengths.map((length, index) =>
    new Promise<void>((resolve, reject) => getDatabase().run(
      'INSERT INTO tracks (album_id, disc_number, track_number, title, duration_sec) VALUES (?, 1, ?, ?, ?)',
      [albumId, index + 1, `Track ${index + 1}`, length], err => (err ? reject(err) : resolve())))));

  it('reconnaît « Mozart: Requiem » dans le CD Requiem, crédité au même chef', async () => {
    const word = tag();
    const id = await insertAlbum({ title: `Requiem ${word}`, artist: ['Mozart', 'Herbert von Karajan'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('alac-req', `Mozart: Requiem ${word}`, 'Herbert von Karajan, Vienna Philharmonic & Wiener Singverein')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('alac-req', 'm4a', 16));

    expect(await statusOf(id)).toMatchObject({ state: 'lossless', matches: [{ match: 'title' }] });
  });

  it('ne tient pas compte de l’article : « Dark Side of the Moon » est « The Dark Side of the Moon »', async () => {
    const word = tag();
    const id = await insertAlbum({ title: `The Dark Side of the Moon ${word}`, artist: ['Pink Floyd'] });
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('mp3-dsotm', `Dark Side of the Moon ${word} (EMI Uden pressing)`, 'Pink Floyd')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs('mp3-dsotm', 'mp3'));

    expect(await statusOf(id)).toMatchObject({ state: 'lossy', matches: [{ match: 'title' }] });
  });

  it('reconnaît une copie aux durées de ses pistes quand titre et artiste diffèrent', async () => {
    const id = await insertAlbum({ title: `Violinkonzert Nr. 5 ${tag()}`, artist: ['Wolfgang Amadeus Mozart', 'Karajan'] });
    await insertTracks(id, [601, 553, 1210, 734]);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('alac-mutter', `Violin Concertos ${tag()}`, 'Anne-Sophie Mutter')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(timed('alac-mutter', [602, 552, 1211, 734]));

    expect(await statusOf(id)).toMatchObject({ state: 'lossless', matches: [{ match: 'tracks' }] });
  });

  it('ne confond pas deux enregistrements du même titre, ni des pistes de durées voisines', async () => {
    const word = tag();
    const id = await insertAlbum({ title: `Carmina Burana ${word}`, artist: ['Orff', 'Chicago Symphony Chorus', 'James Levine'] });
    await insertTracks(id, [160, 230, 95, 300]);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([album('lso', `Orff: Carmina Burana ${word}`, 'London Symphony Chorus, London Symphony Orchestra & Richard Hickox')]);
    jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(timed('lso', [170, 222, 99, 290]));

    expect(await statusOf(id)).toMatchObject({ state: 'none', matches: [] });
    const digital = (await request(app).get('/api/music/digital')).body.albums;
    expect(digital.find((d: { navidromeId: string }) => d.navidromeId === 'lso')).toMatchObject({ cd: null });
  });
});
