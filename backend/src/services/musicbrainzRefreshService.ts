import Album from '../models/album';
import Track from '../models/track';
import { getDatabase } from '../database';
import musicbrainzService from './musicbrainzService';
import logger from '../logger';
import type { AlbumFormatted, TrackCreateData, TrackPerformer } from '../types';

type Artist = { id?: string; name?: string; 'sort-name'?: string };
type Credit = { name?: string; artist?: Artist };
type Relation = {
  type: string;
  'target-type'?: string;
  'target-credit'?: string;
  attributes?: string[];
  artist?: Artist;
  work?: { title: string; relations?: Relation[] };
  place?: { name: string };
  url?: { resource: string };
};
type Recording = { id: string; isrcs?: string[]; relations?: Relation[]; 'artist-credit'?: Credit[] };
type RawTrack = { id: string; number: string; position?: number; title: string; length?: number; 'artist-credit'?: Credit[]; recording?: Recording };
type RawRelease = {
  id: string;
  annotation?: string;
  genres?: Array<{ name: string }>;
  relations?: Relation[];
  media?: Array<{ format?: string; tracks?: RawTrack[] }>;
  'release-group'?: { rating?: { value?: number | null; 'votes-count'?: number } };
};

export interface RefreshResult {
  id: number;
  title: string;
  tracksBefore: number;
  tracksAfter: number;
  tracksReplaced: boolean;
  filled: string[];
  error?: string;
}

/** Roles worth a tag; producers and engineers are album credits, arrangers rarely matter. */
const PERFORMER_ROLES: Record<string, (relation: Relation) => string> = {
  conductor: () => 'conductor',
  'performing orchestra': () => 'orchestra',
  instrument: relation => relation.attributes?.join(', ') || 'instrument',
  vocal: relation => relation.attributes?.join(', ') || 'vocals',
  performer: relation => relation.attributes?.join(', ') || 'performer',
  'chorus master': () => 'chorus master',
};

const isLatin = (text: string): boolean => !/[^\u0000-ɏḀ-ỿ -⁯\s]/.test(text);

/**
 * The name as the booklet prints it: the credited name first, then the
 * canonical one. MusicBrainz keeps some artists in their own script
 * (Мстислав Ростропович); their sort name is Latin, "Rostropovich, Mstislav".
 */
const displayName = (artist: Artist | undefined, credited: string | undefined, creditedById: Map<string, string>): string => {
  const candidates = [credited, artist?.id ? creditedById.get(artist.id) : undefined, artist?.name].filter((name): name is string => Boolean(name));
  const latin = candidates.find(isLatin);
  if (latin) return latin;
  const sortName = artist?.['sort-name'];
  if (sortName && isLatin(sortName)) {
    const parts = sortName.split(', ');
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : sortName;
  }
  return candidates[0] || '';
};

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] =>
  [...new Map(items.map(item => [key(item), item])).values()];

/** Turns a release with credits into the tracks DexVault keeps, disc by disc. */
const toTracks = (release: RawRelease): TrackCreateData[] => {
  const creditedById = new Map<string, string>();
  for (const medium of release.media || []) {
    for (const track of medium.tracks || []) {
      for (const credit of [...(track['artist-credit'] || []), ...(track.recording?.['artist-credit'] || [])]) {
        if (credit.artist?.id && credit.name && isLatin(credit.name)) creditedById.set(credit.artist.id, credit.name);
      }
    }
  }

  return (release.media || []).flatMap((medium, discIndex) => (medium.tracks || []).map((track, index) => {
    const relations = track.recording?.relations || [];
    const performances = relations.filter(relation => relation.type === 'performance' && relation.work);
    const composers = performances.flatMap(performance => (performance.work!.relations || [])
      // Songs credit their "writer", Lennon and McCartney's among them; a
      // lyricist is left out, or Puccini's librettists would share his line.
      .filter(relation => (relation.type === 'composer' || relation.type === 'writer') && relation.artist)
      .map(relation => displayName(relation.artist, relation['target-credit'], creditedById)));
    const performers: TrackPerformer[] = relations
      .filter(relation => relation.artist && PERFORMER_ROLES[relation.type])
      .map(relation => ({ name: displayName(relation.artist, relation['target-credit'], creditedById), role: PERFORMER_ROLES[relation.type](relation) }));

    return {
      discNumber: discIndex + 1,
      medium: medium.format || null,
      trackNumber: track.position ?? (parseInt(track.number, 10) || index + 1),
      title: track.title,
      durationSec: track.length ? Math.round(track.length / 1000) : null,
      isrc: track.recording?.isrcs?.[0] ?? null,
      musicbrainzRecordingId: track.recording?.id ?? null,
      musicbrainzTrackId: track.id,
      artist: (track['artist-credit'] || []).map(credit => displayName(credit.artist, credit.name, creditedById)).filter(Boolean),
      work: performances[0]?.work?.title ?? null,
      composers: uniqueBy(composers.filter(Boolean), name => name),
      performers: uniqueBy(performers.filter(performer => performer.name), performer => `${performer.name}|${performer.role}`),
    };
  }));
};

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

/**
 * Album fields MusicBrainz may fill, and only where DexVault has nothing:
 * the title, the artists, the cover and the notes stay as they were entered.
 */
const missingColumns = (album: AlbumFormatted, release: RawRelease, tracks: TrackCreateData[]): Record<string, string | number | null> => {
  const relations = release.relations || [];
  const relationNames = (type: string) => uniqueBy(relations.filter(r => r.type === type && r.artist).map(r => r.artist!.name!), name => name);
  const urls = Object.fromEntries(relations
    .filter(relation => relation.url && ['discogs', 'wikipedia', 'wikidata', 'allmusic', 'official homepage', 'purchase for download', 'streaming music'].includes(relation.type))
    .map(relation => [relation.type, relation.url!.resource]));
  const isrcs = uniqueBy(tracks.map(track => track.isrc).filter((isrc): isrc is string => Boolean(isrc)), isrc => isrc);
  const duration = tracks.reduce((total, track) => total + (track.durationSec || 0), 0);

  const columns: Record<string, string | number | null> = {};
  const fill = (column: string, current: unknown, value: unknown, store: (value: unknown) => string | number | null) => {
    if (isEmpty(current) && !isEmpty(value)) columns[column] = store(value);
  };
  fill('producer', album.producer, relationNames('producer'), JSON.stringify);
  fill('engineer', album.engineer, relationNames('engineer'), JSON.stringify);
  fill('recording_location', album.recordingLocation, relations.find(r => r.type === 'recorded at' && r.place)?.place?.name, String);
  fill('isrc_codes', album.isrcCodes, isrcs, JSON.stringify);
  fill('total_duration', album.totalDuration, duration || null, Number);
  fill('annotation', album.annotation, release.annotation, String);
  fill('genres', album.genres, (release.genres || []).map(genre => genre.name), JSON.stringify);

  // The community's rating is MusicBrainz's own and moves with its votes: always the latest.
  const rating = release['release-group']?.rating?.value;
  if (typeof rating === 'number' && Math.round(rating * 20) / 20 !== album.rating) columns.rating = Math.round(rating * 20) / 20;
  const votes = release['release-group']?.rating?.['votes-count'];
  if (typeof votes === 'number' && votes !== album.ratingVotes) columns.rating_votes = votes;

  const addedUrls = Object.fromEntries(Object.entries(urls).filter(([type]) => !album.urls?.[type]));
  if (Object.keys(addedUrls).length > 0) columns.urls = JSON.stringify({ ...(album.urls || {}), ...addedUrls });
  return columns;
};

const run = (sql: string): Promise<void> =>
  new Promise((resolve, reject) => getDatabase().run(sql, (err: Error | null) => (err ? reject(err) : resolve())));

const musicbrainzRefreshService = {
  toTracks,

  /**
   * Refreshes one album from its MusicBrainz edition. The track list is
   * replaced only when MusicBrainz has at least as many tracks: Discogs often
   * lists a concerto as one track where MusicBrainz has its three movements.
   */
  refreshAlbum: async (albumId: number): Promise<RefreshResult> => {
    const album = await Album.findById(albumId);
    if (!album) throw new Error('Album not found');
    if (!album.musicbrainzReleaseId) throw new Error('Album has no MusicBrainz edition');

    const release = await musicbrainzService.getReleaseWithCredits(album.musicbrainzReleaseId) as RawRelease;
    const tracks = toTracks(release);
    const existing = await Track.findByCdId(albumId);
    const replace = tracks.length > 0 && tracks.length >= existing.length;
    const columns = missingColumns(album, release, tracks);

    await run('BEGIN IMMEDIATE');
    try {
      if (replace) {
        await Track.deleteByCdId(albumId);
        for (const track of tracks) await Track.create({ ...track, albumId });
      }
      await Album.setColumns(albumId, columns);
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(rollbackError => logger.error('Failed to roll back MusicBrainz refresh:', rollbackError));
      throw error;
    }

    logger.info(`Album ${albumId} "${album.title}" refreshed from MusicBrainz: ${replace ? `${existing.length} → ${tracks.length} tracks` : 'tracks kept'}, filled ${Object.keys(columns).join(', ') || 'nothing'}`);
    return {
      id: albumId,
      title: album.title,
      tracksBefore: existing.length,
      tracksAfter: replace ? tracks.length : existing.length,
      tracksReplaced: replace,
      filled: Object.keys(columns),
    };
  },

  /** The given albums, or every album with an edition, one after the other for MusicBrainz's rate limit. */
  refreshAll: async (ids?: number[]): Promise<RefreshResult[]> => {
    const albums = (await Album.findAll()).filter(album => album.musicbrainzReleaseId && (!ids || ids.includes(album.id)));
    const results: RefreshResult[] = [];
    for (const album of albums) {
      try {
        results.push(await musicbrainzRefreshService.refreshAlbum(album.id));
      } catch (error) {
        results.push({ id: album.id, title: album.title, tracksBefore: 0, tracksAfter: 0, tracksReplaced: false, filled: [], error: (error as Error).message });
      }
    }
    return results;
  },
};

export default musicbrainzRefreshService;
