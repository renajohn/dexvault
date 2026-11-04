import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import Track from '../../src/models/track';
import Album from '../../src/models/album';
import musicService from '../../src/services/musicService';
import musicbrainzService from '../../src/services/musicbrainzService';
import musicbrainzRefreshService from '../../src/services/musicbrainzRefreshService';

const rostropovich = { id: 'a-rostro', name: 'Мстислав Ростропович', 'sort-name': 'Rostropovich, Mstislav' };

const movement = (position: number, title: string) => ({
  id: `track-${position}`, number: String(position), position, title, length: 180_400,
  'artist-credit': [{ name: 'Antonio Vivaldi', artist: { id: 'a-vivaldi', name: 'Antonio Vivaldi' } }],
  recording: {
    id: `rec-${position}`, isrcs: [`DEF05770027${position}`],
    relations: [
      { type: 'performance', 'target-type': 'work', work: {
        title: `Concerto for Cello in C major, RV 398: ${title}`,
        relations: [{ type: 'composer', 'target-type': 'artist', artist: { id: 'a-vivaldi', name: 'Antonio Vivaldi' } }],
      } },
      { type: 'conductor', 'target-type': 'artist', artist: { id: 'a-sacher', name: 'Paul Sacher' } },
      { type: 'instrument', 'target-type': 'artist', attributes: ['cello'], artist: rostropovich },
      { type: 'performing orchestra', 'target-type': 'artist', artist: { id: 'a-cmz', name: 'Collegium Musicum Zürich' } },
      { type: 'arranger', 'target-type': 'artist', artist: rostropovich },
    ],
  },
});

const release = (count: number) => ({
  id: 'rel-vivaldi',
  genres: [{ name: 'classical' }],
  relations: [
    { type: 'producer', 'target-type': 'artist', artist: { id: 'a-prod', name: 'Rainer Brock' } },
    { type: 'wikidata', 'target-type': 'url', url: { resource: 'https://www.wikidata.org/wiki/Q1' } },
  ],
  media: [{ format: 'CD', tracks: ['I. Allegro', 'II. Largo', 'III. Allegro'].slice(0, count).map((title, i) => movement(i + 1, title)) }],
});

const insertAlbum = (fields: { releaseId?: string | null; producer?: string[] } = {}) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(
      `INSERT INTO albums (title, artist, musicbrainz_release_id, producer, genres, title_status) VALUES (?, ?, ?, ?, '[]', 'owned')`,
      [`Cello Concertos ${Math.random()}`, JSON.stringify(['Vivaldi', 'Rostropovich']),
        fields.releaseId === undefined ? `rel-${Math.random()}` : fields.releaseId, JSON.stringify(fields.producer ?? [])],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
    ));

afterEach(() => jest.restoreAllMocks());

describe('toTracks', () => {
  it('garde le format de chaque disque, le DVD d’un CD + DVD compris', () => {
    const data = { ...release(1), media: [...release(1).media, { format: 'DVD-Video', tracks: [movement(1, 'Film')] }] };
    expect(musicbrainzRefreshService.toTracks(data).map(track => [track.discNumber, track.medium])).toEqual([[1, 'CD'], [2, 'DVD-Video']]);
  });

  it('crédite chaque mouvement : œuvre, compositeur et interprètes, sans l’arrangeur', () => {
    const [track] = musicbrainzRefreshService.toTracks(release(1));

    expect(track).toMatchObject({
      discNumber: 1, trackNumber: 1, title: 'I. Allegro', durationSec: 180, isrc: 'DEF057700271',
      musicbrainzRecordingId: 'rec-1', musicbrainzTrackId: 'track-1',
      artist: ['Antonio Vivaldi'],
      work: 'Concerto for Cello in C major, RV 398: I. Allegro',
      composers: ['Antonio Vivaldi'],
    });
    expect(track.performers).toEqual([
      { name: 'Paul Sacher', role: 'conductor' },
      { name: 'Mstislav Rostropovich', role: 'cello' },
      { name: 'Collegium Musicum Zürich', role: 'orchestra' },
    ]);
  });

  it('compte l’auteur-compositeur d’une chanson, pas le parolier d’un opéra', () => {
    const data = release(1);
    data.media[0].tracks[0].recording.relations[0].work!.relations = [
      { type: 'writer', 'target-type': 'artist', artist: { id: 'a-lennon', name: 'John Lennon' } },
      { type: 'lyricist', 'target-type': 'artist', artist: { id: 'a-illica', name: 'Luigi Illica' } },
    ] as any;

    expect(musicbrainzRefreshService.toTracks(data)[0].composers).toEqual(['John Lennon']);
  });

  it('préfère le nom crédité en alphabet latin au nom canonique', () => {
    const data = release(1);
    data.media[0].tracks[0]['artist-credit'].push({ name: 'Mstislav Rostropovich', artist: rostropovich } as any);
    (data.media[0].tracks[0].recording.relations[2] as any).artist = { ...rostropovich, 'sort-name': 'Ростропович' };

    expect(musicbrainzRefreshService.toTracks(data)[0].performers).toContainEqual({ name: 'Mstislav Rostropovich', role: 'cello' });
  });
});

describe('refreshAlbum', () => {
  it('remplace une liste Discogs plus courte et remplit seulement les champs vides', async () => {
    const id = await insertAlbum({ releaseId: 'rel-vivaldi' });
    await Track.create({ albumId: id, trackNumber: 1, title: 'Concerto RV 398' });
    jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValue(release(3));

    const result = await musicbrainzRefreshService.refreshAlbum(id);

    expect(result).toMatchObject({ tracksBefore: 1, tracksAfter: 3, tracksReplaced: true });
    expect(result.filled).toEqual(expect.arrayContaining(['producer', 'genres', 'isrc_codes', 'total_duration', 'urls']));
    const tracks = await Track.findByCdId(id);
    expect(tracks.map(t => t.title)).toEqual(['I. Allegro', 'II. Largo', 'III. Allegro']);
    expect(tracks[1].performers).toContainEqual({ name: 'Paul Sacher', role: 'conductor' });
    const album = (await Album.findById(id))!;
    expect(album.producer).toEqual(['Rainer Brock']);
    expect(album.title).toMatch(/^Cello Concertos/);
    expect(album.artist).toEqual(['Vivaldi', 'Rostropovich']);
  });

  it('prend la note de la communauté MusicBrainz, et la suit quand elle change', async () => {
    const id = await insertAlbum({ releaseId: 'rel-rated' });
    const rated = (value: number) => ({ ...release(1), 'release-group': { rating: { value, 'votes-count': 8 } } });
    jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValueOnce(rated(4.15)).mockResolvedValueOnce(rated(4.4));

    await musicbrainzRefreshService.refreshAlbum(id);
    expect((await Album.findById(id))!.rating).toBe(4.15);

    await musicbrainzRefreshService.refreshAlbum(id);
    expect((await Album.findById(id))!.rating).toBe(4.4);
  });

  it('garde une liste plus longue que celle de MusicBrainz et ne remplace pas un producteur saisi', async () => {
    const id = await insertAlbum({ producer: ['Hand Entered'] });
    for (const n of [1, 2, 3, 4]) await Track.create({ albumId: id, trackNumber: n, title: `Track ${n}` });
    jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValue(release(3));

    const result = await musicbrainzRefreshService.refreshAlbum(id);

    expect(result).toMatchObject({ tracksBefore: 4, tracksAfter: 4, tracksReplaced: false });
    expect(result.filled).not.toContain('producer');
    expect((await Track.findByCdId(id)).map(t => t.title)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
    expect((await Album.findById(id))!.producer).toEqual(['Hand Entered']);
  });

  it('ne touche jamais à la pochette ni au dos', async () => {
    const id = await insertAlbum();
    await new Promise<void>((resolve, reject) => getDatabase().run(
      `UPDATE albums SET cover = '/images/cd/my-front.jpg', back_cover = '/images/cd/my-back.jpg' WHERE id = ?`, [id],
      (err: Error | null) => (err ? reject(err) : resolve())));
    jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValue(release(3));

    await musicbrainzRefreshService.refreshAlbum(id);

    const album = (await Album.findById(id))!;
    expect(album.cover).toBe('/images/cd/my-front.jpg');
    expect(album.backCover).toBe('/images/cd/my-back.jpg');
  });

  it('refuse d’écrire une colonne de pochette', async () => {
    await expect(Album.setColumns(1, { back_cover: null })).rejects.toThrow(/Unknown album columns: back_cover/);
  });

  it('répond 409 pour un album sans édition MusicBrainz', async () => {
    const id = await insertAlbum({ releaseId: null });
    const res = await request(app).post(`/api/music/albums/${id}/refresh-musicbrainz`);
    expect(res.status).toBe(409);
  });

  it('ne rafraîchit que les albums demandés', async () => {
    const wanted = await insertAlbum();
    await insertAlbum();
    const lookup = jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValue(release(2));

    const res = await request(app).post('/api/music/albums/refresh-musicbrainz').send({ ids: [wanted] });

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { id: number }) => r.id)).toEqual([wanted]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('édition de l’album', () => {
  it('garde les crédits des pistes quand le formulaire renvoie seulement titres et durées', async () => {
    const id = await insertAlbum();
    jest.spyOn(musicbrainzService, 'getReleaseWithCredits').mockResolvedValue(release(1));
    await musicbrainzRefreshService.refreshAlbum(id);
    const album = await musicService.getAlbumById(id);

    await musicService.updateAlbum(id, {
      ...album, discs: [{ number: 1, tracks: [{ no: 1, title: 'I. Allegro (corrigé)', durationSec: 180 }] }],
    } as any);

    const [track] = await Track.findByCdId(id);
    expect(track.title).toBe('I. Allegro (corrigé)');
    expect(track.composers).toEqual(['Antonio Vivaldi']);
    expect(track.performers).toHaveLength(3);
  });
});
