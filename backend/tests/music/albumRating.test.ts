import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import { reconcile } from '../../src/services/albumRatingService';

const insertAlbum = (title: string, genres: string[] = ['Classical']) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(
      `INSERT INTO albums (title, artist, format, title_status, genres) VALUES (?, ?, 'CD', 'owned', ?)`,
      [title, JSON.stringify(['Dinu Lipatti']), JSON.stringify(genres)],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
    ));

const copy = (id: string, name: string, userRating: number) =>
  ({ id, name, artist: 'Dinu Lipatti', musicBrainzId: null, songCount: 2, userRating });

beforeEach(() => {
  ripStatusService.clearCache();
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
  jest.spyOn(navidromeService, 'getSongs').mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

describe('which stars win', () => {
  it('keeps what both sides hold', () => {
    expect(reconcile(4, 4, null)).toEqual({ keep: 4, push: false });
  });

  it('gives Navidrome the stars changed in DexVault', () => {
    expect(reconcile(5, 3, 3)).toEqual({ keep: 5, push: true });
    expect(reconcile(4, 0, null)).toEqual({ keep: 4, push: true });
  });

  it('takes the stars changed in Navidrome', () => {
    expect(reconcile(3, 5, 3)).toEqual({ keep: 5, push: false });
    expect(reconcile(null, 2, null)).toEqual({ keep: 2, push: false });
    expect(reconcile(4, 0, 4)).toEqual({ keep: 0, push: false });
  });

  it('lets Navidrome win when both changed', () => {
    expect(reconcile(2, 5, 3)).toEqual({ keep: 5, push: false });
  });

  it('keeps a half given here while Navidrome holds its rounding', () => {
    expect(reconcile(3.5, 4, 4)).toEqual({ keep: 3.5, push: false });
    expect(reconcile(3.5, 3, 3)).toEqual({ keep: 3.5, push: true });
    expect(reconcile(3.5, 2, 4)).toEqual({ keep: 2, push: false });
  });
});

describe('stars of a CD', () => {
  it('rates the CD and its copy in Navidrome', async () => {
    const title = `Chopin Waltzes ${Math.random()}`;
    const id = await insertAlbum(title);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([copy('nd-w', title, 0)]);
    const set = jest.spyOn(navidromeService, 'setRating').mockResolvedValue();

    const res = await request(app).put(`/api/music/albums/${id}/rating`).send({ rating: 4 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userRating: 4, navidrome: 'synced' });
    expect(set).toHaveBeenCalledWith('nd-w', 4);
    expect((await Album.findById(id))!.userRating).toBe(4);
  });

  it('keeps a half star here and gives Navidrome its rounding', async () => {
    const title = `Schubert Impromptus ${Math.random()}`;
    const id = await insertAlbum(title);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([copy('nd-s', title, 0)]);
    const set = jest.spyOn(navidromeService, 'setRating').mockResolvedValue();

    const res = await request(app).put(`/api/music/albums/${id}/rating`).send({ rating: 3.5 });

    expect(res.body).toEqual({ userRating: 3.5, navidrome: 'synced' });
    expect(set).toHaveBeenCalledWith('nd-s', 4);
    expect((await Album.findById(id))!.userRating).toBe(3.5);

    // The next sync finds 4 in Navidrome and leaves the half alone.
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([copy('nd-s', title, 4)]);
    ripStatusService.clearCache();
    await request(app).post('/api/music/ratings/sync');
    expect((await Album.findById(id))!.userRating).toBe(3.5);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('keeps the stars of a CD not ripped yet', async () => {
    const id = await insertAlbum(`Unripped ${Math.random()}`);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([]);
    const set = jest.spyOn(navidromeService, 'setRating').mockResolvedValue();

    const res = await request(app).put(`/api/music/albums/${id}/rating`).send({ rating: 3 });

    expect(res.body).toEqual({ userRating: 3, navidrome: 'not_ripped' });
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses stars out of range', async () => {
    const id = await insertAlbum(`Range ${Math.random()}`);
    expect((await request(app).put(`/api/music/albums/${id}/rating`).send({ rating: 7 })).status).toBe(400);
  });

  it('takes the stars given in Amperfy, and gives Navidrome those given here', async () => {
    const fromAmperfy = `Bach Partita ${Math.random()}`;
    const fromDexVault = `Mozart Sonata ${Math.random()}`;
    const a = await insertAlbum(fromAmperfy);
    const b = await insertAlbum(fromDexVault);
    await Album.setUserRating(b, 5);
    jest.spyOn(navidromeService, 'getAlbums').mockResolvedValue([copy('nd-a', fromAmperfy, 4), copy('nd-b', fromDexVault, 0)]);
    const set = jest.spyOn(navidromeService, 'setRating').mockResolvedValue();

    const res = await request(app).post('/api/music/ratings/sync');

    expect(res.status).toBe(200);
    expect(res.body.pulled).toBeGreaterThanOrEqual(1);
    expect(res.body.pushed).toBeGreaterThanOrEqual(1);
    expect((await Album.findById(a))!.userRating).toBe(4);
    expect(set).toHaveBeenCalledWith('nd-b', 5);
  });

  it('finds the classical CDs not rated yet', async () => {
    const rated = await insertAlbum(`Rated ${Math.random()}`);
    const unrated = await insertAlbum(`Unrated ${Math.random()}`);
    await Album.setUserRating(rated, 4);

    const res = await request(app).get('/api/music/albums/search').query({ q: 'genre:classical rated:no' });

    const ids = (res.body as Array<{ id: number }>).map(album => album.id);
    expect(ids).toContain(unrated);
    expect(ids).not.toContain(rated);
  });
});

describe('filtering by stars', () => {
  it('finds the CDs by their stars: exactly, at least, a range, or none', async () => {
    const tag = `Stars${Math.random().toString(36).slice(2, 8)}`;
    const ids = await Promise.all([0, 2, 3, 4.5, 5].map(async stars => {
      const id = await insertAlbum(`${tag} ${stars}`);
      if (stars) await Album.setUserRating(id, stars);
      return { stars, id };
    }));
    const found = async (q: string) => {
      const res = await request(app).get('/api/music/albums/search').query({ q: `${tag} ${q}` });
      return (res.body as Array<{ id: number }>).map(album => ids.find(entry => entry.id === album.id)?.stars).filter(s => s !== undefined).sort();
    };

    expect(await found('stars:>=3')).toEqual([3, 4.5, 5]);
    expect(await found('stars:>=4.5')).toEqual([4.5, 5]);
    expect(await found('stars:5')).toEqual([5]);
    expect(await found('stars:2-3')).toEqual([2, 3]);
    expect(await found('stars:0')).toEqual([0]);
  });
});

describe('listening notes', () => {
  it('keeps a dated journal of each CD', async () => {
    const id = await insertAlbum(`Journal ${Math.random()}`);

    const first = await request(app).post(`/api/music/albums/${id}/notes`).send({ note: 'Slow movement, wonderful.', date: '2026-10-01' });
    await request(app).post(`/api/music/albums/${id}/notes`).send({ note: 'Second listening.', date: '2026-10-05' });
    expect(first.status).toBe(201);

    let notes = (await request(app).get(`/api/music/albums/${id}/notes`)).body;
    expect(notes.map((n: { note: string }) => n.note)).toEqual(['Second listening.', 'Slow movement, wonderful.']);

    await request(app).put(`/api/music/notes/${first.body.id}`).send({ note: 'Slow movement, sublime.' });
    await request(app).delete(`/api/music/notes/${notes[0].id}`);
    notes = (await request(app).get(`/api/music/albums/${id}/notes`)).body;
    expect(notes).toEqual([expect.objectContaining({ note: 'Slow movement, sublime.', date: '2026-10-01' })]);
  });

  it('refuses an empty note', async () => {
    const id = await insertAlbum(`Empty ${Math.random()}`);
    expect((await request(app).post(`/api/music/albums/${id}/notes`).send({ note: '  ' })).status).toBe(400);
  });
});

describe('how the stars spread', () => {
  it('counts the albums of the collection at each half, neither the wished nor the mixtapes', async () => {
    const before = (await request(app).get('/api/music/ratings/counts').expect(200)).body.counts as Array<{ stars: number; count: number }>;
    const at = (counts: Array<{ stars: number; count: number }>, stars: number) => counts.find(one => one.stars === stars)?.count ?? 0;
    const kept = await insertAlbum(`Spread ${Math.random()}`);
    await Album.setUserRating(kept, 3.5);
    const wished = await insertAlbum(`Spread wished ${Math.random()}`);
    await new Promise<void>((resolve, reject) => getDatabase().run(`UPDATE albums SET title_status = 'wish' WHERE id = ?`, [wished], (err: Error | null) => (err ? reject(err) : resolve())));
    await Album.setUserRating(wished, 3.5);

    const after = (await request(app).get('/api/music/ratings/counts').expect(200)).body.counts;
    expect(at(after, 3.5)).toBe(at(before, 3.5) + 1);
  });
});
