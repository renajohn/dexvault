import '../../index';
import { getDatabase } from '../../src/database';
import Track from '../../src/models/track';
import musicbrainzService from '../../src/services/musicbrainzService';
import musicService from '../../src/services/musicService';
import discFormatService from '../../src/services/discFormatService';
import { isVideoMedium } from '../../src/utils/medium';

const run = (sql: string, params: unknown[] = []) => new Promise<number>((resolve, reject) =>
  getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

afterEach(() => jest.restoreAllMocks());

describe('disques vidéo', () => {
  it('sait un DVD vidéo, un Blu-ray, une VHS d’un CD, d’un DVD-Audio et d’un format inconnu', () => {
    for (const format of ['DVD-Video', 'DVD', 'Blu-ray', 'VHS', 'VCD']) expect(isVideoMedium(format)).toBe(true);
    for (const format of ['CD', 'Enhanced CD', 'SACD', 'DVD-Audio', 'Blu-ray Audio', 'Digital Media', '', null]) expect(isVideoMedium(format)).toBe(false);
  });

  it('lit dans MusicBrainz le format des disques des albums de plusieurs disques, une fois', async () => {
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
    const releaseId = `rel-haarp-${Math.random()}`;
    const id = await run(`INSERT INTO albums (title, artist, musicbrainz_release_id, title_status) VALUES ('HAARP', '["Muse"]', ?, 'owned')`, [releaseId]);
    await Track.create({ albumId: id, discNumber: 1, trackNumber: 1, title: 'Intro' });
    await Track.create({ albumId: id, discNumber: 2, trackNumber: 1, title: 'Intro' });
    const formats = jest.spyOn(musicbrainzService, 'getReleaseMediaFormats').mockImplementation(async asked => (asked === releaseId ? ['CD', 'DVD-Video'] : []));

    await discFormatService.fill();
    expect((await Track.findByCdId(id)).map(track => track.medium)).toEqual(['CD', 'DVD-Video']);
    const asked = formats.mock.calls.filter(([asked]) => asked === releaseId).length;
    await discFormatService.fill();
    expect(formats.mock.calls.filter(([again]) => again === releaseId)).toHaveLength(asked);
  });

  it('garde le format d’un disque quand le formulaire renvoie ses pistes sans lui, et le rend avec la fiche', async () => {
    const id = await run(`INSERT INTO albums (title, artist, title_status) VALUES ('HAARP', '["Muse"]', 'owned')`);
    await Track.create({ albumId: id, discNumber: 1, trackNumber: 1, title: 'Intro', medium: 'CD' });
    await Track.create({ albumId: id, discNumber: 2, trackNumber: 1, title: 'Intro', medium: 'DVD-Video' });

    await musicService.updateAlbum(id, { title: 'HAARP', artist: ['Muse'], discs: [
      { number: 1, tracks: [{ no: 1, title: 'Intro' }] }, { number: 2, tracks: [{ no: 1, title: 'Intro (live)' }] }] } as never);

    expect((await musicService.getAlbumById(id)).discs.map(disc => disc.format)).toEqual(['CD', 'DVD-Video']);
  });
});
