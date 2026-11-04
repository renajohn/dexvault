import Album from '../models/album';
import TrackFiche, { recordingKey, type Fiche } from '../models/trackFiche';
import TrackPopularity from '../models/trackPopularity';
import ripStatusService, { groupSongs } from './ripStatusService';
import { popularTracks } from './trackPopularityService';
import { workGroups } from '../utils/workGroups';
import { normaliseAlbumQuery } from '../utils/albumSearchFilters';
import { answeringShare, groupAnswers, songAnswers, takeFicheFilter } from '../utils/ficheFilters';
import { findsAll, fold, matchScore, searchWords } from '../utils/searchText';
import type { NavidromeSong } from './navidromeService';

/**
 * What a mixtape is made from, searched as one types in its Add tracks…:
 * every song that plays, the files in Navidrome of the CDs ripped and of the
 * digital albums, never the wish list nor another mixtape. The words find
 * albums by their title or their artist, works by their name (the movements
 * workGroups puts under one head), and songs by their title, their artist and
 * their album. The words that ask how a song sounds (mood:, style:,
 * energy:, tempo:, utils/ficheFilters) keep the songs whose own fiche answers,
 * and the albums and the works a third of whose songs with a fiche do.
 */

export interface SearchSong {
  songId: string;
  title: string;
  artist: string;
  /** The album of DexVault the file is a copy of. */
  albumId: number;
  album: string;
  cover: string | null;
  discNumber: number;
  track: number;
  durationSec: number | null;
  starred: boolean;
  popular: boolean;
  /** The work it is a movement of, and its own part of it; null for a piece alone. */
  work: string | null;
  movement: string | null;
}

export interface SearchAlbum {
  albumId: number;
  title: string;
  artist: string;
  cover: string | null;
  /** Every song of the album, in its order: an album ticked comes whole, and opens to untick some. */
  songs: SearchSong[];
}

export interface SearchWork {
  /** Its album and the place of its first movement there: what tells two works of one name apart. */
  key: string;
  name: string;
  albumId: number;
  album: string;
  /** The album's artists: the composer, then those who play it. */
  artists: string[];
  cover: string | null;
  songs: SearchSong[];
}

export interface SearchResult {
  albums: SearchAlbum[];
  works: SearchWork[];
  tracks: SearchSong[];
}

const MAX_ALBUMS = 3;
const MAX_WORKS = 6;
const MAX_TRACKS = 40;
const FRESH_MS = 60 * 1000;

export interface IndexedAlbum extends SearchAlbum {
  artists: string[];
  /** The owner's stars in DexVault, halves included; what the radio's pool draws from. */
  stars: number | null;
  genres: string[];
  year: number | null;
  /** The album's artists and its songs' own, the composer of a pianist's sonatas among them. */
  everyArtist: string[];
  works: SearchWork[];
}

let index: { at: number; songs: NavidromeSong[]; albums: IndexedAlbum[] } | null = null;
let building: Promise<IndexedAlbum[]> | null = null;

/** The songs of one album, disc by disc, track by track, each with its work. */
const songsOf = (album: { id: number; title: string; cover: string | null }, files: NavidromeSong[], popular: Set<string>): SearchSong[] => {
  const sorted = files.filter(file => file.id)
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.track || 0) - (b.track || 0));
  const songs: SearchSong[] = [];
  for (const disc of [...new Set(sorted.map(file => file.discNumber || 1))]) {
    const onDisc = sorted.filter(file => (file.discNumber || 1) === disc);
    const groups = workGroups(onDisc.map(file => file.title || ''));
    onDisc.forEach((file, at) => songs.push({
      songId: file.id!, title: file.title || '', artist: file.artist || '', albumId: album.id, album: album.title, cover: album.cover,
      discNumber: disc, track: file.track || 0, durationSec: file.durationSec ?? null, starred: Boolean(file.starred),
      popular: popular.has(`${disc}-${file.track || 0}`),
      work: groups[at]?.work ?? null, movement: groups[at]?.movement ?? null,
    }));
  }
  return songs;
};

/** The works of an album: its movements in a row under one head. */
const worksOf = (album: IndexedAlbum): SearchWork[] => {
  const works: SearchWork[] = [];
  album.songs.forEach((song, at) => {
    if (!song.work) return;
    const last = works[works.length - 1];
    const previous = album.songs[at - 1];
    if (last && previous?.work === song.work && previous.discNumber === song.discNumber && last.songs.includes(previous)) last.songs.push(song);
    else works.push({ key: `${album.albumId}:${at}`, name: song.work, albumId: album.albumId, album: album.title, artists: album.artists, cover: album.cover, songs: [song] });
  });
  // Found by whoever plays it and whoever wrote it: Beethoven's sonatas on Kempff's album.
  return works.filter(work => work.songs.length > 1)
    .map(work => ({ ...work, artists: [...new Set([...work.artists, ...work.songs.map(song => song.artist).filter(Boolean)])] }));
};

/** Every album that plays, read again once Navidrome's library is read anew. */
const albums = async (): Promise<IndexedAlbum[]> => {
  const library = await ripStatusService.library();
  if (index && index.songs === library.songs && Date.now() - index.at < FRESH_MS) return index.albums;
  building = building ?? (async () => {
    const [copies, owned, digital, ranks] = await Promise.all([
      ripStatusService.navidromeAlbums(), Album.findAll(), Album.findByStatus('digital'), TrackPopularity.findAll(),
    ]);
    const byNavidrome = groupSongs(library.songs);
    const built: IndexedAlbum[] = [];
    for (const album of [...owned, ...digital]) {
      const copy = copies.get(album.id);
      const files = copy ? byNavidrome.get(copy.id) : undefined;
      if (!files?.length) continue;
      const popular = popularTracks(ranks.get(album.id) || [], files.length);
      const songs = songsOf({ id: album.id, title: album.title, cover: album.cover ?? null }, files, popular);
      const everyArtist = [...new Set([...album.artist, ...songs.map(song => song.artist).filter(Boolean)])];
      const indexed: IndexedAlbum = {
        albumId: album.id, title: album.title, artist: album.artist[0] || '', artists: album.artist, everyArtist, cover: album.cover ?? null, songs, works: [],
        stars: album.userRating ?? null, genres: album.genres || [], year: album.releaseYear ?? null,
      };
      indexed.works = worksOf(indexed);
      built.push(indexed);
    }
    index = { at: Date.now(), songs: library.songs, albums: built };
    return built;
  })().finally(() => { building = null; });
  return building;
};

/** Whether one of the words is found in the text: what makes it a match by its name, not by its album alone. */
const rank = (song: SearchSong): number => (song.starred ? 2 : 0) + (song.popular ? 1 : 0);

const namedBy = (words: string[], text: string): boolean => words.some(word => fold(text).includes(word));

/** The fiches, and the recordings their keys are found by, read once a search asks how its songs sound. */
const hearing = async (): Promise<{ fiches: Map<string, Fiche>; recordings: Map<string, string> }> => {
  const [fiches, recordings] = await Promise.all([TrackFiche.all(), TrackFiche.recordingIds()]);
  return { fiches, recordings };
};

const mixtapeSearchService = {
  search: async (query: string): Promise<SearchResult> => {
    const { filter, rest } = takeFicheFilter(normaliseAlbumQuery(query || ''));
    const words = searchWords(rest);
    if (!words.length && !filter) return { albums: [], works: [], tracks: [] };
    const all = await albums();
    const heard = filter ? await hearing() : null;
    const ficheOf = (song: SearchSong): Fiche | undefined => heard?.fiches.get(recordingKey(song, heard.recordings));
    const sounds = (songs: SearchSong[]): Fiche[] => songs.map(ficheOf).filter((fiche): fiche is Fiche => Boolean(fiche));
    // How well an album or a work answers the fiche words: 0 without them, which keeps the order of the words.
    const share = (songs: SearchSong[]): number => (filter ? answeringShare(filter, sounds(songs)) : 0);
    const answers = (songs: SearchSong[]): boolean => !filter || groupAnswers(filter, sounds(songs));

    const foundAlbums = all
      .filter(album => findsAll(words, [album.title, ...album.everyArtist]) && (!words.length || namedBy(words, album.title) || findsAll(words, album.everyArtist)))
      .filter(album => answers(album.songs))
      .map(album => ({ album, score: matchScore(words, [[album.title, 1], [album.artists.join(' '), 0.7], [album.everyArtist.join(' '), 0.5]]), share: share(album.songs) }))
      .sort((a, b) => b.score - a.score || b.share - a.share)
      .slice(0, MAX_ALBUMS)
      .map(({ album }) => album);

    const foundWorks = all.flatMap(album => album.works)
      .filter(work => findsAll(words, [work.name, ...work.artists, work.album]) && (!words.length || namedBy(words, work.name) || findsAll(words, work.artists)))
      .filter(work => answers(work.songs))
      .map(work => ({ work, score: matchScore(words, [[work.name, 1], [work.artists.join(' '), 0.6], [work.album, 0.3]]), share: share(work.songs) }))
      .sort((a, b) => b.score - a.score || b.share - a.share)
      .slice(0, MAX_WORKS)
      .map(({ work }) => work);

    // A work found shows its movements: they are not found again one by one.
    const inWorks = new Set(foundWorks.flatMap(work => work.songs.map(song => song.songId)));
    const foundTracks = all.flatMap(album => album.songs.map(song => ({ song, album })))
      .filter(({ song, album }) => !inWorks.has(song.songId) && findsAll(words, [song.title, song.artist, ...album.artists, album.title]))
      // A song answers the fiche words by its own fiche.
      .filter(({ song }) => !filter || songAnswers(filter, ficheOf(song)))
      .map(({ song, album }) => ({
        song,
        score: matchScore(words, [[song.title, 1], [`${song.artist} ${album.artists.join(' ')}`, 0.6], [album.title, 0.4]]),
      }))
      // How well the words name it first (Brel before Cabrel), then the favourites and the most listened.
      .sort((a, b) => b.score - a.score || rank(b.song) - rank(a.song))
      .slice(0, MAX_TRACKS)
      .map(({ song }) => song);

    return {
      albums: foundAlbums.map(({ albumId, title, artist, cover, songs }) => ({ albumId, title, artist, cover, songs })),
      works: foundWorks,
      tracks: foundTracks,
    };
  },

  /** Every album that plays with its songs and its works: the radio draws from them too. */
  albums: (): Promise<IndexedAlbum[]> => albums(),

  /** For tests: nothing read yet. */
  forget: (): void => { index = null; building = null; },
};

export default mixtapeSearchService;
