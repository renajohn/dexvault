import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import musicService from '../../src/services/musicService';
import musicCollectionService from '../../src/services/musicCollectionService';
import listenNextPlaylistService from '../../src/services/listenNextPlaylistService';
import listenNextPlayService from '../../src/services/listenNextPlayService';

const tag = () => Math.random().toString(36).slice(2, 8);

const insertAlbum = (title: string, { status = 'owned' } = {}) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(`INSERT INTO albums (title, artist, format, title_status, genres) VALUES (?, ?, 'CD', ?, '[]')`,
      [title, JSON.stringify([`Artist ${tag()}`]), status],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

/** Listen Next as "id:disc", in its order. */
const list = async () => (await musicCollectionService.getListenNextAlbums()).map(album => `${album.id}:${album.disc ?? 0}`);

beforeEach(async () => {
  for (const id of new Set((await musicCollectionService.getListenNextAlbums()).map(album => album.id))) await Album.toggleListenNext(id);
  jest.spyOn(listenNextPlaylistService, 'schedule').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('Listen Next and the CDs come in', () => {
  it('puts a CD come in at the end of Listen Next, not a wish; a wish bought too, unless Listen Next has it', async () => {
    const before = await insertAlbum(`Before ${tag()}`);
    await Album.toggleListenNext(before);
    const added = await musicService.addAlbum({ title: `Rumours ${tag()}`, artist: ['Fleetwood Mac'], format: 'CD' });
    await musicService.addAlbum({ title: `Wished ${tag()}`, artist: ['Someone'], format: 'CD', titleStatus: 'wish' });
    expect(await list()).toEqual([`${before}:0`, `${added.id}:0`]);

    const wished = await insertAlbum(`Wish ${tag()}`, { status: 'wish' });
    const listed = await insertAlbum(`Listed wish ${tag()}`, { status: 'wish' });
    await Album.toggleListenNext(listed);
    await request(app).post(`/api/music/albums/${wished}/bought`).send({}).expect(200);
    await request(app).post(`/api/music/albums/${listed}/bought`).send({}).expect(200);
    expect(await list()).toEqual([`${before}:0`, `${added.id}:0`, `${listed}:0`, `${wished}:0`]);
  });

  it('lets a CD come in leave once played, as any album', async () => {
    const cd = await musicService.addAlbum({ title: `Aja ${tag()}`, artist: ['Steely Dan'], format: 'CD' });
    expect(await listenNextPlayService.markPlayed(cd.id)).not.toBeNull();
    expect(await list()).toEqual([]);
  });
});
