import { getDatabase } from '../../src/database';
import musicService from '../../src/services/musicService';
import musicbrainzService from '../../src/services/musicbrainzService';
import imageService from '../../src/services/imageService';

const get = (sql: string, params: unknown[] = []): Promise<any> =>
  new Promise((resolve, reject) => {
    getDatabase().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

/** Poll until the background cover work lands, instead of guessing a delay. */
const waitForCover = async (albumId: number, timeoutMs = 3000): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await get('SELECT cover FROM albums WHERE id = ?', [albumId]);
    if (row?.cover) return row.cover;
    await new Promise(r => setTimeout(r, 25));
  }
  return null;
};

const mockRelease = (mbid: string) => {
  jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({ id: mbid } as any);
  jest.spyOn(musicbrainzService, 'formatReleaseData').mockReturnValue({
    title: `Album ${mbid}`,
    artist: ['Test'],
    musicbrainzReleaseId: mbid,
    discs: [{ number: 1, tracks: [{ trackNumber: 1, title: 'One' }] }]
  } as any);
  jest.spyOn(musicbrainzService, 'getCoverArt').mockResolvedValue({
    front: { url: 'https://coverartarchive.org/release/x/front.jpg' }
  } as any);
  jest.spyOn(imageService, 'resizeImage').mockResolvedValue(undefined as any);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('addAlbumFromMusicBrainz — cover downloads must not hold up the save', () => {
  it('stores the album even though the cover download never finishes', async () => {
    mockRelease('slow-cover-mbid');
    // Cover Art Archive hanging is exactly the case that used to make saving
    // impossible, even though every piece of metadata was already in hand.
    jest.spyOn(imageService, 'downloadImageFromUrl').mockReturnValue(new Promise(() => {}) as any);

    const album = await musicService.addAlbumFromMusicBrainz('slow-cover-mbid');

    expect(album.id).toBeDefined();
    const row = await get('SELECT title FROM albums WHERE id = ?', [album.id]);
    expect(row.title).toBe('Album slow-cover-mbid');
  });

  it('stores the tracks too, without waiting for the cover', async () => {
    mockRelease('slow-cover-tracks');
    jest.spyOn(imageService, 'downloadImageFromUrl').mockReturnValue(new Promise(() => {}) as any);

    const album = await musicService.addAlbumFromMusicBrainz('slow-cover-tracks');

    const row = await get('SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?', [album.id]);
    expect(row.n).toBe(1);
  });

  it('attaches the cover to the stored album once the download completes', async () => {
    mockRelease('eventual-cover');
    let finish: (value: string) => void = () => {};
    jest.spyOn(imageService, 'downloadImageFromUrl').mockReturnValue(
      new Promise<string>(resolve => { finish = resolve; }) as any
    );

    const album = await musicService.addAlbumFromMusicBrainz('eventual-cover');
    finish('/api/images/cd/eventual.jpg');

    await expect(waitForCover(album.id)).resolves.toBe('/api/images/cd/eventual.jpg');
  });

  it('returns the cover right away when Cover Art Archive answers quickly', async () => {
    mockRelease('quick-cover');
    jest.spyOn(imageService, 'downloadImageFromUrl').mockResolvedValue('/api/images/cd/quick.jpg');

    const album = await musicService.addAlbumFromMusicBrainz('quick-cover');

    // The common case must still hand the cover back, so the new album does not
    // show a placeholder in the grid.
    expect(album.cover).toBe('/api/images/cd/quick.jpg');
  });

  it('waits for a slow cover past its head start when asked to, for a CD found from its rip', async () => {
    mockRelease('rip-cover');
    jest.spyOn(imageService, 'downloadImageFromUrl').mockReturnValue(
      new Promise<string>(resolve => setTimeout(() => resolve('/api/images/cd/rip.jpg'), 2500)) as any
    );

    const album = await musicService.addAlbumFromMusicBrainz('rip-cover', {}, { waitForCover: true });

    expect(album.cover).toBe('/api/images/cd/rip.jpg');
  });

  it('keeps the album when the cover download fails outright', async () => {
    mockRelease('failed-cover');
    jest.spyOn(imageService, 'downloadImageFromUrl').mockRejectedValue(new Error('404'));

    const album = await musicService.addAlbumFromMusicBrainz('failed-cover');

    const row = await get('SELECT title, cover FROM albums WHERE id = ?', [album.id]);
    expect(row.title).toBe('Album failed-cover');
    expect(row.cover).toBeNull();
  });
});
