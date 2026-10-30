import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Album from '../../src/models/album';
import ListenNextPlay from '../../src/models/listenNextPlay';
import navidromeService, { type NavidromeAlbum, type NavidromeTrackFile } from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import musicCollectionService from '../../src/services/musicCollectionService';
import listenNextPlaylistService from '../../src/services/listenNextPlaylistService';
import listenNextPlayService from '../../src/services/listenNextPlayService';
import Mixtape from '../../src/models/mixtape';
import { drawPlaces, fitsSongs } from '../../src/services/mixtapeShuffle';

const tag = () => Math.random().toString(36).slice(2, 8);

const insertAlbum = (title: string) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(`INSERT INTO albums (title, artist, format, title_status) VALUES (?, ?, 'CD', 'owned')`,
      [title, JSON.stringify([`Artist ${tag()}`])],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const insertTrack = (albumId: number, disc: number, no: number, durationSec: number | null) =>
  new Promise<void>((resolve, reject) =>
    getDatabase().run('INSERT INTO tracks (album_id, disc_number, track_number, title, duration_sec) VALUES (?, ?, ?, ?, ?)',
      [albumId, disc, no, `${disc}-${no}`, durationSec], (err: Error | null) => (err ? reject(err) : resolve())));

const copy = (id: string): NavidromeAlbum => ({ id, name: id, artist: 'A', musicBrainzId: null, songCount: 3, userRating: 0 });

/** Out of order, as getAlbum may give them: the last is disc 2, track 1. */
const files = (albumId: string): NavidromeTrackFile[] => [[2, 1], [1, 2], [1, 1]].map(([disc, track]) => ({
  id: `${albumId}-${disc}-${track}`, url: null, discNumber: disc, track, title: `${disc}-${track}`, durationSec: 100,
  suffix: 'flac', bitRate: null, bitDepth: 16, samplingRate: 44100, channelCount: 2, size: null, path: null,
}));

const ids = async () => (await musicCollectionService.getListenNextAlbums()).map(album => album.id);

const savedUser = process.env.NAVIDROME_USER;
let first: number;
let second: number;
let third: number;

beforeEach(async () => {
  process.env.NAVIDROME_USER = 'me';
  for (const id of new Set((await musicCollectionService.getListenNextAlbums()).map(album => album.id))) await Album.toggleListenNext(id);
  await ListenNextPlay.setRepeat(false);
  await new Promise<void>((resolve, reject) =>
    getDatabase().run('DELETE FROM listen_next_departures', (err: Error | null) => (err ? reject(err) : resolve())));
  [first, second, third] = [await insertAlbum(`First ${tag()}`), await insertAlbum(`Second ${tag()}`), await insertAlbum(`Third ${tag()}`)];
  for (const id of [first, second, third]) await Album.toggleListenNext(id);
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
  jest.spyOn(navidromeService, 'getAlbumSongs').mockImplementation(async (albumId: string) => files(albumId));
  jest.spyOn(ripStatusService, 'navidromeAlbumFor').mockImplementation(async (id: number) => copy(`nd-${id}`));
  jest.spyOn(listenNextPlaylistService, 'schedule').mockImplementation(() => undefined);
  jest.spyOn(listenNextPlaylistService, 'playlistId').mockResolvedValue('pl-1');
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedUser === undefined) delete process.env.NAVIDROME_USER; else process.env.NAVIDROME_USER = savedUser;
});

describe('Listen Next lu', () => {
  it('retire un album quand sa dernière piste est scrobblée par NAVIDROME_USER, une seule fois', async () => {
    const departure = await listenNextPlayService.noteScrobble('me', `nd-${second}-2-1`, 1_800_000_000);

    expect(departure).toMatchObject({ albumId: second, leftAt: 1_800_000_000 });
    expect(await ids()).toEqual([first, third]);
    expect(listenNextPlaylistService.schedule).toHaveBeenCalled();
    // The plugin tells the same scrobble again: the album is already gone.
    expect(await listenNextPlayService.noteScrobble('me', `nd-${second}-2-1`)).toBeNull();
  });

  it('ignore une autre piste, un autre compte, et tout quand Repeat est activé', async () => {
    expect(await listenNextPlayService.noteScrobble('me', `nd-${second}-1-2`)).toBeNull();
    expect(await listenNextPlayService.noteScrobble('someone-else', `nd-${second}-2-1`)).toBeNull();
    await listenNextPlayService.setRepeat(true);
    expect(await listenNextPlayService.noteScrobble('me', `nd-${second}-2-1`)).toBeNull();
    expect(await ids()).toEqual([first, second, third]);
  });

  it('Keep here remet l’album à sa place', async () => {
    const departure = await listenNextPlayService.noteScrobble('me', `nd-${second}-2-1`);

    expect(await listenNextPlayService.keep(departure!.id)).toBe(true);
    expect(await ids()).toEqual([first, second, third]);
    expect(await listenNextPlayService.keep(departure!.id)).toBe(false);
  });

  it('donne Repeat, les départs du jour et la longueur de chaque album', async () => {
    await insertTrack(first, 1, 1, 200);
    await insertTrack(first, 2, 1, null);
    const departure = await listenNextPlayService.noteScrobble('me', `nd-${third}-2-1`);

    const state = await listenNextPlayService.getState();

    expect(state.repeat).toBe(false);
    expect(state.playlistId).toBe('pl-1');
    expect(state.playlistUrl).toMatch(/\/app\/#\/playlist\/pl-1\/show$/);
    expect(state.ripped).toEqual([first, second]);
    expect(state.departures.map(d => [d.id, d.albumId, d.album.id, d.beforeKey])).toEqual([[departure!.id, third, third, null]]);
    await listenNextPlayService.noteScrobble('me', `nd-${first}-2-1`);
    expect((await listenNextPlayService.getState()).departures.find(d => d.albumId === first)?.beforeKey).toBe(`${second}:0`);
    expect(state.lengths[`${first}:0`]).toEqual({ discs: 2, tracks: 2, durationSec: 200, missing: 1 });
  });

  it('un album remis à la main dans Listen Next ne part plus', async () => {
    await listenNextPlayService.noteScrobble('me', `nd-${third}-2-1`);
    await Album.toggleListenNext(third);

    expect((await listenNextPlayService.getState()).departures).toEqual([]);
  });

  it('le scrobble du lecteur de DexVault répond avec l’album parti', async () => {
    jest.spyOn(navidromeService, 'scrobble').mockResolvedValue();

    const nowPlaying = await request(app).post(`/api/music/navidrome/scrobble/nd-${first}-2-1`).send({ submission: false });
    expect(nowPlaying.body).toEqual({ ok: true, left: null });

    const played = await request(app).post(`/api/music/navidrome/scrobble/nd-${first}-2-1`).send({ submission: true });
    expect(played.body.left).toMatchObject({ albumId: first });
  });

  it('règle Repeat et garde un album par HTTP', async () => {
    const departure = await listenNextPlayService.noteScrobble('me', `nd-${first}-2-1`);

    expect((await request(app).put('/api/collections/listen-next/repeat').send({ repeat: 'yes' })).status).toBe(400);
    expect((await request(app).put('/api/collections/listen-next/repeat').send({ repeat: true })).body).toEqual({ repeat: true });
    expect((await request(app).get('/api/collections/listen-next/play')).body.repeat).toBe(true);

    const kept = await request(app).post(`/api/collections/listen-next/departures/${departure!.id}/keep`);
    expect(kept.body.albums.map((album: { id: number }) => album.id)).toEqual([first, second, third]);
    expect((await request(app).post('/api/collections/listen-next/departures/999999/keep')).status).toBe(404);
  });

  it('un album passé jusqu’au bout dans le lecteur part comme un album lu, une seule fois, sauf avec Repeat', async () => {
    const skipped = await request(app).post(`/api/collections/listen-next/played/${second}`);
    expect(skipped.body.left).toMatchObject({ albumId: second });
    expect(await ids()).toEqual([first, third]);
    expect(listenNextPlaylistService.schedule).toHaveBeenCalled();
    // Keep here finds its place again.
    expect(await listenNextPlayService.keep(skipped.body.left.id)).toBe(true);
    expect(await ids()).toEqual([first, second, third]);

    expect((await request(app).post(`/api/collections/listen-next/played/999999`)).body).toEqual({ left: null });
    expect((await request(app).post('/api/collections/listen-next/played/abc')).status).toBe(400);
    await listenNextPlayService.setRepeat(true);
    expect((await request(app).post(`/api/collections/listen-next/played/${first}`)).body).toEqual({ left: null });
    expect(await ids()).toEqual([first, second, third]);
  });

  it('une mixtape lue en aléatoire part sur le scrobble de la dernière chanson tirée, et revient dans un autre ordre', async () => {
    const songs = [0, 1, 2, 3, 4, 5].map(no => ({
      songId: `mx-${second}-${no}`, title: `Song ${no}`, artist: 'A', album: 'B', albumId: null,
      navidromeAlbumId: 'nd-x', discNumber: 1, track: no + 1, durationSec: 100,
    }));
    await Mixtape.save({ albumId: second, playlistId: `pl-${second}`, changed: null, songs });

    expect((await request(app).put(`/api/collections/listen-next/albums/${second}/shuffled`).send({ shuffled: 'yes' })).status).toBe(400);
    expect((await request(app).put(`/api/collections/listen-next/albums/${first}/shuffled`).send({ shuffled: true })).status).toBe(404);
    expect((await request(app).put(`/api/collections/listen-next/albums/${second}/shuffled`).send({ shuffled: true })).body).toEqual({ shuffled: true });
    expect((await request(app).get('/api/collections/listen-next/play')).body.shuffled).toContain(second);

    const order = (await ListenNextPlay.getShuffle(second))!;
    expect(fitsSongs(order, songs.length)).toBe(true);

    // Its own last song is no longer the last: only the last drawn takes it out.
    const lastDrawn = songs[order[order.length - 1]].songId;
    const notLast = songs.find(song => song.songId !== lastDrawn)!.songId;
    expect(await listenNextPlayService.noteScrobble('me', notLast)).toBeNull();
    expect(await listenNextPlayService.noteScrobble('me', lastDrawn)).toMatchObject({ albumId: second });
    expect(await ids()).toEqual([first, third]);
    expect(fitsSongs((await ListenNextPlay.getShuffle(second))!, songs.length)).toBe(true);

    expect((await request(app).put(`/api/collections/listen-next/albums/${second}/shuffled`).send({ shuffled: false })).body).toEqual({ shuffled: false });
    expect(await ListenNextPlay.getShuffle(second)).toBeNull();
    await Album.delete(second);
  });

  it('tire chaque place une fois', () => {
    const draws = [0.1, 0.9, 0.5, 0.3];
    const places = drawPlaces(5, () => draws.shift() ?? 0);
    expect([...places].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(fitsSongs(places, 5)).toBe(true);
    expect(fitsSongs([0, 0, 1], 3)).toBe(false);
    expect(fitsSongs([0, 1], 3)).toBe(false);
  });

  it('Keep here remet un disque tiré avec son dé, un disque mis à la main sans', async () => {
    await new Promise<void>((resolve, reject) => getDatabase().run(
      'UPDATE album_collections SET suggested = 1 WHERE album_id = ?', [second], (err: Error | null) => (err ? reject(err) : resolve())));
    const suggestedOf = async () => Object.fromEntries((await musicCollectionService.getListenNextAlbums()).map(album => [album.id, album.suggested]));
    expect(await suggestedOf()).toEqual({ [first]: false, [second]: true, [third]: false });

    for (const id of [first, second]) {
      const left = await listenNextPlayService.markPlayed(id, 0);
      expect(await listenNextPlayService.keep(left!.id)).toBe(true);
    }
    expect(await suggestedOf()).toEqual({ [first]: false, [second]: true, [third]: false });
  });

  describe('un disque d’un album', () => {
    const entries = async () => (await musicCollectionService.getListenNextAlbums()).map(album => `${album.id}:${album.disc ?? 0}`);

    it('met un disque à la fin, un autre après, et l’album entier à la place du premier', async () => {
      await Album.toggleListenNext(first);
      expect((await request(app).put(`/api/music/albums/${first}/listen-next`).send({ disc: 2 })).body).toEqual({ id: first, action: 'added' });
      await Album.toggleListenNext(first, 1);
      expect(await entries()).toEqual([`${second}:0`, `${third}:0`, `${first}:2`, `${first}:1`]);

      // A disc there taken out alone.
      await Album.toggleListenNext(first, 2);
      expect(await entries()).toEqual([`${second}:0`, `${third}:0`, `${first}:1`]);
      await Album.toggleListenNext(first, 2);
      expect(await Album.toggleListenNext(first, 'all')).toEqual({ id: first, action: 'added' });
      expect(await entries()).toEqual([`${second}:0`, `${third}:0`, `${first}:0`]);
      expect(await Album.toggleListenNext(first, 'all')).toEqual({ id: first, action: 'kept' });

      // A disc in place of the whole album; the album's button takes out whatever of it is there.
      await Album.toggleListenNext(first, 3);
      expect(await entries()).toEqual([`${second}:0`, `${third}:0`, `${first}:3`]);
      await Album.toggleListenNext(first, 1);
      expect(await Album.toggleListenNext(first)).toEqual({ id: first, action: 'removed' });
      expect(await entries()).toEqual([`${second}:0`, `${third}:0`]);

      expect((await request(app).put(`/api/music/albums/${first}/listen-next`).send({ disc: 'two' })).status).toBe(400);
    });

    it('range les entrées par leurs clés', async () => {
      await Album.toggleListenNext(first, 1);
      await Album.toggleListenNext(first, 2);
      // first:0 is no longer there: passed over.
      const body = (await request(app).put('/api/collections/listen-next/order').send({ keys: [`${first}:2`, `${third}`, `${first}:0`, `${first}:1`] })).body;
      expect(body.albums.map((album: { id: number; disc: number | null }) => `${album.id}:${album.disc ?? 0}`))
        .toEqual([`${first}:2`, `${third}:0`, `${first}:1`, `${second}:0`]);
      expect((await request(app).put('/api/collections/listen-next/order').send({ keys: ['x:1'] })).status).toBe(400);
    });

    it('fait partir un disque sur le scrobble de sa dernière piste, et le remet avec Keep here', async () => {
      await Album.toggleListenNext(second);
      await Album.toggleListenNext(second, 1);
      await Album.toggleListenNext(second, 2);
      await insertTrack(second, 1, 1, 100);
      await insertTrack(second, 1, 2, 120);
      await insertTrack(second, 2, 1, 300);
      expect((await listenNextPlayService.getState()).lengths).toMatchObject({
        [`${second}:1`]: { discs: 1, tracks: 2, durationSec: 220, missing: 0 },
        [`${second}:2`]: { discs: 1, tracks: 1, durationSec: 300, missing: 0 },
      });

      // Disc 1's last song is 1-2 in Navidrome, not the album's.
      const departure = await listenNextPlayService.noteScrobble('me', `nd-${second}-1-2`);
      expect(departure).toMatchObject({ albumId: second, disc: 1 });
      expect(await entries()).toEqual([`${first}:0`, `${third}:0`, `${second}:2`]);
      expect((await listenNextPlayService.getState()).departures.map(d => [d.albumId, d.disc, d.beforeKey])).toEqual([[second, 1, `${second}:2`]]);

      expect((await request(app).post(`/api/collections/listen-next/played/${second}`).send({ disc: 2 })).body.left).toMatchObject({ disc: 2 });
      expect(await listenNextPlayService.keep(departure!.id)).toBe(true);
      expect(await entries()).toEqual([`${first}:0`, `${third}:0`, `${second}:1`]);
    });
  });
});
