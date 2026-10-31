import '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import Track from '../../src/models/track';
import TrackLyrics from '../../src/models/trackLyrics';
import navidromeService, { type NavidromeAlbum, type NavidromeTrackFile } from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import digitalAlbumService from '../../src/services/digitalAlbumService';
import imageService from '../../src/services/imageService';
import musicbrainzService from '../../src/services/musicbrainzService';
import musicbrainzRefreshService from '../../src/services/musicbrainzRefreshService';

const tag = () => Math.random().toString(36).slice(2, 8);

const run = (sql: string, params: unknown[] = []) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const insertAlbum = (title: string, artist: string, status = 'owned', releaseId: string | null = null) =>
  run(`INSERT INTO albums (title, artist, format, title_status, musicbrainz_release_id) VALUES (?, ?, 'CD', ?, ?)`,
    [title, JSON.stringify([artist]), status, releaseId]);

const album = (id: string, name: string, artist: string, musicBrainzId: string | null = null): NavidromeAlbum =>
  ({ id, name, artist, musicBrainzId, songCount: 2, userRating: 0 });

/** Two songs to an album, lasting `lengths`, as the whole library lists them. */
const songsOf = (albumId: string, suffix = 'mp3', lengths = [200, 201]) =>
  lengths.map((durationSec, index) => ({ albumId, id: `${albumId}-${index}`, suffix, bitDepth: null, discNumber: 1, track: index + 1, durationSec }));

const files = (titles: string[], lengths = [200, 201]): NavidromeTrackFile[] => titles.map((title, index) => ({
  id: `f${index}`, url: null, discNumber: 1, track: index + 1, title, artist: 'Moby', durationSec: lengths[index],
  suffix: 'mp3', bitRate: 192, bitDepth: null, samplingRate: null, channelCount: null, size: null, path: null,
}));

const navidrome = (albums: NavidromeAlbum[], songs: ReturnType<typeof songsOf>) => {
  ripStatusService.clearCache();
  jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue(albums);
  jest.spyOn(navidromeService, 'getSongs').mockResolvedValue(songs);
};

const digitalOf = async (navidromeId: string) => digitalAlbumService.forNavidromeAlbum(navidromeId);

beforeEach(() => {
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
  jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(files(['Porcelain', 'Natural Blues']));
  jest.spyOn(navidromeService, 'getCoverArt').mockResolvedValue({ data: Buffer.from('jpg'), contentType: 'image/jpeg' });
  jest.spyOn(imageService, 'saveImage').mockImplementation(async (_data: unknown, type: unknown, name: unknown) => `/api/images/${type}/${name}`);
});

afterEach(() => jest.restoreAllMocks());

describe('albums digitaux', () => {
  it('fait un album de chaque album Navidrome sans CD ni souhait, avec les pistes de ses tags et sa pochette', async () => {
    const [owned, wished, alone] = [`Owned ${tag()}`, `Wished ${tag()}`, `Play ${tag()}`];
    await insertAlbum(owned, 'Moby');
    await insertAlbum(wished, 'Moby', 'wish');
    navidrome([album('n-owned', owned, 'Moby'), album('n-wished', wished, 'Moby'), { ...album('n-alone', alone, 'Moby'), year: 1999 }],
      [...songsOf('n-owned'), ...songsOf('n-wished'), ...songsOf('n-alone')]);

    expect(await digitalAlbumService.reconcile()).toMatchObject({ added: 1 });

    expect(await digitalOf('n-owned')).toBeNull();
    expect(await digitalOf('n-wished')).toBeNull();
    const digital = (await digitalOf('n-alone'))!;
    expect(digital).toMatchObject({ title: alone, artist: ['Moby'], titleStatus: 'digital', format: 'Digital Media', releaseYear: 1999 });
    expect(digital.cover).toMatch(/navidrome_/);
    expect((await Track.findByCdId(digital.id)).map(track => [track.trackNumber, track.title, track.durationSec, track.artist]))
      .toEqual([[1, 'Porcelain', 200, ['Moby']], [2, 'Natural Blues', 201, ['Moby']]]);

    // Not part of the collection: not in it, nor found by its search.
    expect((await Album.findAll()).some(found => found.id === digital.id)).toBe(false);
    expect((await Album.search(alone)).some(found => found.id === digital.id)).toBe(false);
  });

  it('ne refait pas l’album à la sync suivante, et le retrouve quand Navidrome lui donne un autre id', async () => {
    const name = `Hotel ${tag()}`;
    navidrome([album('n-hotel', name, 'Moby')], songsOf('n-hotel'));
    await digitalAlbumService.reconcile();
    const first = (await digitalOf('n-hotel'))!;

    navidrome([album('n-hotel', name, 'Moby')], songsOf('n-hotel'));
    expect(await digitalAlbumService.reconcile()).toMatchObject({ added: 0 });

    navidrome([album('n-hotel-2', name, 'Moby')], songsOf('n-hotel-2'));
    expect(await digitalAlbumService.reconcile()).toMatchObject({ added: 0, relinked: 1 });
    expect((await digitalOf('n-hotel-2'))!.id).toBe(first.id);
  });

  it('reprend les pistes des tags quand les fichiers ont changé', async () => {
    const name = `Wait ${tag()}`;
    navidrome([album('n-wait', name, 'Moby')], songsOf('n-wait'));
    await digitalAlbumService.reconcile();
    const digital = (await digitalOf('n-wait'))!;

    navidrome([album('n-wait', name, 'Moby')], songsOf('n-wait', 'mp3', [300, 301, 302]));
    jest.spyOn(navidromeService, 'getAlbumSongs').mockResolvedValue(files(['A', 'B', 'C'], [300, 301, 302]));
    expect(await digitalAlbumService.reconcile()).toMatchObject({ retracked: 1 });
    expect((await Track.findByCdId(digital.id)).map(track => track.title)).toEqual(['A', 'B', 'C']);
  });

  it('supprime l’album disparu de Navidrome, sauf s’il a une note, qu’il garde marqué jusqu’à son retour', async () => {
    const [plain, noted] = [`Plain ${tag()}`, `Noted ${tag()}`];
    navidrome([album('n-plain', plain, 'Moby'), album('n-noted', noted, 'Moby')], [...songsOf('n-plain'), ...songsOf('n-noted')]);
    await digitalAlbumService.reconcile();
    const [gonePlain, goneNoted] = [(await digitalOf('n-plain'))!, (await digitalOf('n-noted'))!];
    await run(`INSERT INTO album_notes (album_id, note, date) VALUES (?, 'Beau', '2026-10-17')`, [goneNoted.id]);

    navidrome([album('n-other', `Other ${tag()}`, 'Moby')], songsOf('n-other'));
    expect(await digitalAlbumService.reconcile()).toMatchObject({ deleted: 1, gone: 1 });
    expect(await Album.findById(gonePlain.id)).toBeNull();
    expect((await Album.findById(goneNoted.id))!.navidromeGoneAt).toEqual(expect.any(String));

    navidrome([album('n-noted', noted, 'Moby')], songsOf('n-noted'));
    await digitalAlbumService.reconcile();
    expect((await Album.findById(goneNoted.id))!.navidromeGoneAt).toBeNull();
  });

  it('supprime quand même l’album dont on n’a fait que lire l’histoire', async () => {
    const name = `Read ${tag()}`;
    navidrome([album('n-read', name, 'Moby')], songsOf('n-read'));
    await digitalAlbumService.reconcile();
    const read = (await digitalOf('n-read'))!;
    await run(`INSERT INTO album_stories (album_id, found, fetched_at) VALUES (?, 1, '2026-10-17')`, [read.id]);

    navidrome([album('n-else', `Else ${tag()}`, 'Moby')], songsOf('n-else'));
    await digitalAlbumService.reconcile();
    expect(await Album.findById(read.id)).toBeNull();
  });

  it('ne touche à rien quand Navidrome répond une bibliothèque vide', async () => {
    const name = `Kept ${tag()}`;
    navidrome([album('n-kept', name, 'Moby')], songsOf('n-kept'));
    await digitalAlbumService.reconcile();

    navidrome([], []);
    expect(await digitalAlbumService.reconcile()).toBeNull();
    expect(await digitalOf('n-kept')).not.toBeNull();
  });

  it('retire l’album digital quand son CD entre dans la collection', async () => {
    const name = `Bought ${tag()}`;
    navidrome([album('n-bought', name, 'Moby')], songsOf('n-bought'));
    await digitalAlbumService.reconcile();
    const digital = (await digitalOf('n-bought'))!;

    await insertAlbum(name, 'Moby');
    navidrome([album('n-bought', name, 'Moby')], songsOf('n-bought'));
    expect(await digitalAlbumService.reconcile()).toMatchObject({ deleted: 1 });
    expect(await Album.findById(digital.id)).toBeNull();
  });

  it('note la qualité des fichiers sur chaque album, et la recherche la trouve par file: et ripped:', async () => {
    const [flac, mp3, unripped, alone] = [`Flac ${tag()}`, `Mp3 ${tag()}`, `Unripped ${tag()}`, `Alone ${tag()}`];
    const flacId = await insertAlbum(flac, 'Moby');
    const mp3Id = await insertAlbum(mp3, 'Moby');
    const unrippedId = await insertAlbum(unripped, 'Moby');
    // The CD's FLAC and its old MP3: the CD is as good as its best copy.
    navidrome([album('n-flac', flac, 'Moby'), album('n-flac-old', flac, 'Moby'), album('n-mp3', mp3, 'Moby'), album('n-alone', alone, 'Moby')],
      [...songsOf('n-flac', 'flac'), ...songsOf('n-flac-old'), ...songsOf('n-mp3'), ...songsOf('n-alone')]);

    await digitalAlbumService.reconcile();

    const digital = (await digitalOf('n-alone'))!;
    const qualities = async () => Object.fromEntries(await Promise.all([flacId, mp3Id, unrippedId, digital.id]
      .map(async id => [id, (await Album.findById(id))?.fileQuality])));
    expect(await qualities()).toEqual({ [flacId]: 'lossless', [mp3Id]: 'lossy', [unrippedId]: 'none', [digital.id]: 'lossy' });

    const found = async (query: string) => (await Album.search(`artist:Moby ${query}`, { withNoCd: true }))
      .map(album => album.id).filter(id => [flacId, mp3Id, unrippedId, digital.id].includes(id)).sort((a, b) => a - b);
    expect(await found('file:lossless')).toEqual([flacId]);
    expect(await found('file:lossy')).toEqual([mp3Id, digital.id].sort((a, b) => a - b));
    expect(await found('ripped:no')).toEqual([unrippedId]);
    expect(await found('ripped:yes')).toEqual([flacId, mp3Id]);
  });

  it('cherche les paroles des albums digitaux comme celles des CD', async () => {
    const name = `Words ${tag()}`;
    navidrome([album('n-words', name, 'Moby')], songsOf('n-words'));
    await digitalAlbumService.reconcile();
    const digital = (await digitalOf('n-words'))!;

    const toLookUp = await TrackLyrics.toLookUp(new Date().toISOString(), 1000);
    expect(toLookUp.filter(track => track.albumId === digital.id).map(track => track.title)).toEqual(['Porcelain', 'Natural Blues']);
  });
});

describe('rip FLAC d’un album digital', () => {
  const flacRip = (id: string, name: string, releaseId: string) => {
    navidrome([album(id, name, 'Moby', releaseId)], songsOf(id, 'flac'));
  };

  beforeEach(() => {
    jest.spyOn(musicbrainzRefreshService, 'refreshAlbum').mockResolvedValue({} as never);
  });

  it('fait un CD de la collection de l’album digital dont le rip est l’édition d’un CD', async () => {
    const [name, releaseId] = [`Rip ${tag()}`, `rel-${tag()}`];
    flacRip('n-rip', name, releaseId);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: `rg-${tag()}` }, media: [{ format: 'CD' }] } as never);
    await digitalAlbumService.reconcile();
    const digital = (await digitalOf('n-rip'))!;
    expect(digital.musicbrainzReleaseId).toBe(releaseId);

    expect(await ripStatusService.adoptEditions()).toEqual([expect.objectContaining({ albumId: digital.id, action: 'promoted' })]);
    expect(await Album.findById(digital.id)).toMatchObject({ titleStatus: 'owned', format: 'CD' });
  });

  it('fait un CD de l’album du rip quand une ancienne copie MP3 du même album est aussi digitale', async () => {
    const [name, releaseId, oldReleaseId, groupId] = [`Twice ${tag()}`, `rel-${tag()}`, `rel-${tag()}`, `rg-${tag()}`];
    navidrome([album('n-mp3', name, 'Moby', oldReleaseId)], songsOf('n-mp3'));
    await digitalAlbumService.reconcile();
    const old = (await digitalOf('n-mp3'))!;
    await run('UPDATE albums SET musicbrainz_release_group_id = ? WHERE id = ?', [groupId, old.id]);

    navidrome([album('n-mp3', name, 'Moby', oldReleaseId), album('n-flac', name, 'Moby', releaseId)], [...songsOf('n-mp3'), ...songsOf('n-flac', 'flac')]);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: groupId }, media: [{ format: 'CD' }] } as never);
    await digitalAlbumService.reconcile();
    const rip = (await digitalOf('n-flac'))!;
    await run('UPDATE albums SET musicbrainz_release_group_id = ? WHERE id = ?', [groupId, rip.id]);

    expect(await ripStatusService.adoptEditions()).toEqual([expect.objectContaining({ albumId: rip.id, action: 'promoted' })]);
    expect(await Album.findById(rip.id)).toMatchObject({ titleStatus: 'owned', format: 'CD' });
  });

  it('laisse digital l’album dont l’édition n’est pas un CD (un FLAC acheté en ligne)', async () => {
    const [name, releaseId] = [`Shop ${tag()}`, `rel-${tag()}`];
    flacRip('n-shop', name, releaseId);
    jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ 'release-group': { id: `rg-${tag()}` }, media: [{ format: 'Digital Media' }] } as never);
    await digitalAlbumService.reconcile();
    const digital = (await digitalOf('n-shop'))!;

    expect(await ripStatusService.adoptEditions()).toEqual([expect.objectContaining({ albumId: digital.id, skipped: 'not_a_cd' })]);
    expect(await Album.findById(digital.id)).toMatchObject({ titleStatus: 'digital' });
  });
});
