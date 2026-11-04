import Album from '../models/album';
import TrackFiche, { recordingKey } from '../models/trackFiche';
import mixtapeSearchService, { type IndexedAlbum, type SearchSong } from './mixtapeSearchService';

/**
 * Every song that plays as the radio sees it: the song of mixtapeSearchService's
 * index, the key of its recording (what its fiche is kept under), its album's
 * stars and whether the album is classical as the shelves tell it, and the
 * work it is a movement of, when its movements stand in a row on its disc.
 */
export interface RadioEntry {
  song: SearchSong;
  key: string;
  stars: number | null;
  classical: boolean;
  year: number | null;
  /** Its album and the place of the work's first movement there, null for a piece alone. */
  workKey: string | null;
  /** The work's movements in their order, itself among them; empty for a piece alone. */
  workSongs: SearchSong[];
}

export interface Catalogue {
  entries: RadioEntry[];
  bySongId: Map<string, RadioEntry>;
}

export { recordingKey };

let cached: { albums: IndexedAlbum[]; at: number; catalogue: Catalogue } | null = null;
const FRESH_MS = 60 * 1000;

const build = async (albums: IndexedAlbum[]): Promise<Catalogue> => {
  const [recordings, classical] = await Promise.all([
    TrackFiche.recordingIds(),
    Album.classicalOf(albums.map(album => ({ id: album.albumId, genres: album.genres }))),
  ]);
  const entries: RadioEntry[] = [];
  for (const album of albums) {
    const workOf = new Map<string, { key: string; songs: SearchSong[] }>();
    for (const work of album.works) for (const song of work.songs) workOf.set(song.songId, { key: work.key, songs: work.songs });
    for (const song of album.songs) {
      const work = workOf.get(song.songId);
      entries.push({
        song, key: recordingKey(song, recordings), stars: album.stars, classical: classical.get(album.albumId) ?? false, year: album.year,
        workKey: work?.key ?? null, workSongs: work?.songs ?? [],
      });
    }
  }
  return { entries, bySongId: new Map(entries.map(entry => [entry.song.songId, entry])) };
};

/** Built again when the index is, or once a minute for the stars and the recordings found since. */
export const catalogue = async (): Promise<Catalogue> => {
  const albums = await mixtapeSearchService.albums();
  if (cached && cached.albums === albums && Date.now() - cached.at < FRESH_MS) return cached.catalogue;
  const built = await build(albums);
  cached = { albums, at: Date.now(), catalogue: built };
  return built;
};

/** For tests: nothing read yet. */
export const forgetCatalogue = (): void => { cached = null; };

/** Where the songs are drawn from: the union of what is on; all off, everything that plays. */
export interface RadioPool {
  /** Albums at this many stars and more, null for off. */
  stars: number | null;
  hearts: boolean;
  popular: boolean;
  genre: 'both' | 'classical' | 'other';
  /** A work's movement drawn brings the whole work. */
  wholeWorks: boolean;
}

export const inPool = (entry: RadioEntry, pool: RadioPool): boolean => {
  const anySource = pool.stars !== null || pool.hearts || pool.popular;
  const source = !anySource
    || (pool.stars !== null && (entry.stars ?? 0) >= pool.stars)
    || (pool.hearts && entry.song.starred)
    || (pool.popular && entry.song.popular);
  return source && (pool.genre === 'both' || (pool.genre === 'classical') === entry.classical);
};
