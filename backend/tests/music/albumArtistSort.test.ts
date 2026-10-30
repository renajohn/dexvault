import request from 'supertest';
import app from '../../index';
import musicService from '../../src/services/musicService';
import musicbrainzService from '../../src/services/musicbrainzService';
import communityRatingService from '../../src/services/communityRatingService';
import trackPopularityService from '../../src/services/trackPopularityService';
import ShelfItem from '../../src/models/shelfItem';

beforeEach(() => {
  jest.spyOn(musicbrainzService, 'getCoverArt').mockResolvedValue(null);
  jest.spyOn(communityRatingService, 'refreshAlbum').mockResolvedValue(undefined as never);
  jest.spyOn(trackPopularityService, 'refreshAlbum').mockResolvedValue(undefined as never);
});

afterEach(() => jest.restoreAllMocks());

it.each([
  ['Tracy Chapman', 'Chapman, Tracy', 'Person', 'Chapman, Tracy'],
  ['Amy Macdonald', 'Macdonald, Amy', 'Person', 'Macdonald, Amy'],
  ['The Beatles', 'Beatles, The', 'Group', 'Beatles'],
  ['The Alan Parsons Project', 'Parsons, Alan, Project', 'Group', 'Parsons, Alan, Project'],
])('range immédiatement un nouvel album de %s avec la clé MusicBrainz', async (name, sortName, type, expected) => {
  const releaseId = `sort-import-${name}`;
  jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({
    id: releaseId, title: 'New CD',
    'artist-credit': [{ name, artist: { name, 'sort-name': sortName, type } }],
    media: [{ format: 'CD', tracks: [] }],
  } as never);

  const album = await musicService.addAlbumFromMusicBrainz(releaseId);
  const { albumOrder } = (await request(app).get('/api/shelving/locations').expect(200)).body;

  expect(albumOrder[album.id].sortName).toBe(expected);
});

it('laisse la synchronisation compléter une clé absente de la réponse d’ajout', async () => {
  const releaseId = 'sort-import-missing';
  jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({
    id: releaseId, title: 'Missing sort name',
    'artist-credit': [{ name: 'Peter Gabriel', artist: { name: 'Peter Gabriel' } }],
  } as never);

  const album = await musicService.addAlbumFromMusicBrainz(releaseId);

  expect(await ShelfItem.albumIdsWithoutSort()).toContainEqual({ id: album.id, releaseId });
});

it('ne reprend pas la clé d’un autre artiste quand le nom a été remplacé à l’ajout', async () => {
  const releaseId = 'sort-import-overridden';
  jest.spyOn(musicbrainzService, 'getReleaseDetails').mockResolvedValue({
    id: releaseId, title: 'Different artist',
    'artist-credit': [{ name: 'Peter Gabriel', artist: { name: 'Peter Gabriel', 'sort-name': 'Gabriel, Peter', type: 'Person' } }],
  } as never);

  const album = await musicService.addAlbumFromMusicBrainz(releaseId, { artist: ['Genesis'] });
  const { albumOrder } = (await request(app).get('/api/shelving/locations').expect(200)).body;

  expect(albumOrder[album.id].sortName).toBe('Genesis');
});
