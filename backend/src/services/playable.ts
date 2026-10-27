import musicService from './musicService';
import navidromeService, { type NavidromeTrackFile } from './navidromeService';
import ripStatusService from './ripStatusService';
import mixtapeService from './mixtapeService';
import { shuffleOrder } from './mixtapeShuffle';

/**
 * An album of DexVault as a player plays it, on the server: the same as the
 * page's (frontend/src/utils/playAlbum.ts), for an appliance that goes on
 * from album to album when no page is open.
 */

/** A file of the rip, as the player plays it. */
export interface PlayerTrack {
  songId: string;
  title: string;
  disc: number;
  no: number;
  durationSec: number | null;
  starred?: boolean;
  /** A song of a mixtape: its own artist, the album of DexVault it comes from and that album's cover. */
  artist?: string;
  albumId?: number | null;
  cover?: string | null;
  /** A song of a mixtape: its place in it, from 0. */
  place?: number;
  /** The file's kind, as Navidrome names it (flac, mp3): what an appliance is told it is. */
  suffix?: string;
  /** What the page says is heard: the file lossless (FLAC, ALAC…), or its format (MP3, AAC). */
  lossless?: boolean;
  format?: string;
}

/** The album a play belongs to. */
export interface PlayerAlbum {
  id: number | null;
  navidromeId?: string | null;
  url?: string | null;
  title: string;
  artist: string;
  /** As the page shows it: /api/images/… */
  cover: string | null;
  disc?: number | null;
}

export interface Playable {
  album: PlayerAlbum;
  tracks: PlayerTrack[];
}

interface AlbumLike {
  id: number;
  titleStatus?: string | null;
  title: string;
  artist?: string | string[];
  cover?: string | null;
  discs?: Array<{ number: number; tracks: Array<{ no?: number | string; title: string; durationSec?: number | null }> }>;
}

interface RipTracks {
  found: boolean;
  album?: { id: string; url: string };
  tracks: NavidromeTrackFile[];
}

/** An image of DexVault as the page reaches it, as musicService.getImageUrl does on the page. */
export const imageUrlOf = (path: string | null | undefined): string | null => {
  if (!path) return null;
  if (path.startsWith('http') || path.startsWith('/api/images/') || path.startsWith('/images/')) return path;
  return `/api/images/${path}`;
};

const artistOf = (artist: string | string[] | undefined): string => (Array.isArray(artist) ? artist.join(', ') : artist || '');

/** “Miles Davis, Bach & 6 more”, as the page names a mixtape's artists. */
export const mixtapeArtists = (artists: string[] | string | null | undefined): string => {
  const names = Array.isArray(artists) ? artists : artists ? [artists] : [];
  if (names.length === 0) return 'Empty mixtape';
  if (names.length <= 2) return names.join(' & ');
  return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`;
};

export const playerAlbumOf = (album: AlbumLike, rip?: RipTracks | null): PlayerAlbum => ({
  id: Number(album.id),
  navidromeId: rip?.album?.id ?? null,
  url: rip?.album?.url ?? null,
  title: album.title,
  artist: artistOf(album.artist),
  cover: imageUrlOf(album.cover),
});

const ripFileFor = (files: NavidromeTrackFile[], disc: number, track: number): NavidromeTrackFile | null =>
  files.find(file => file.discNumber === disc && file.track === track) ?? null;

/**
 * The CD's tracks that have a file in the rip, in the CD's order, with its
 * titles; an album DexVault knows no tracks of plays the rip as it is.
 */
export const playerTracksOf = (album: AlbumLike, rip: RipTracks | null | undefined): PlayerTrack[] => {
  if (!rip?.found) return [];
  const known = (album.discs || []).some(disc => disc.tracks.length > 0);
  if (!known) {
    return rip.tracks
      .filter(file => file.id)
      .sort((a, b) => a.discNumber - b.discNumber || a.track - b.track)
      .map(file => ({ songId: file.id!, title: file.title, disc: file.discNumber, no: file.track, durationSec: file.durationSec ?? null, starred: file.starred, suffix: file.suffix }));
  }
  return (album.discs || []).flatMap(disc => disc.tracks.flatMap(track => {
    const file = ripFileFor(rip.tracks, disc.number, Number(track.no));
    return file?.id
      ? [{ songId: file.id, title: track.title, disc: disc.number, no: Number(track.no), durationSec: file.durationSec ?? track.durationSec ?? null, starred: file.starred, suffix: file.suffix }]
      : [];
  }));
};

/** The rip of an album, as /api/music/albums/:id/navidrome-tracks gives it. */
const ripOf = async (albumId: number): Promise<RipTracks | null> => {
  if (!navidromeService.isConfigured()) return null;
  const navidromeAlbum = await ripStatusService.navidromeAlbumFor(albumId);
  if (!navidromeAlbum) return { found: false, tracks: [] };
  const tracks = await navidromeService.getAlbumSongs(navidromeAlbum.id);
  return { found: true, album: { id: navidromeAlbum.id, url: navidromeService.albumUrl(navidromeAlbum.id) }, tracks };
};

/** A mixtape: its songs in its order, or in the order Listen Next drew for it. */
const loadMixtape = async (album: AlbumLike, listenNext: boolean): Promise<Playable> => {
  const mixtape = await mixtapeService.get(album.id);
  if (!mixtape) return { album: playerAlbumOf(album), tracks: [] };
  const tracks: PlayerTrack[] = mixtape.songs.map((song, index) => ({
    songId: song.songId, title: song.title, disc: 1, no: index + 1, durationSec: song.durationSec,
    artist: song.artist, albumId: song.albumId, cover: imageUrlOf(song.cover), place: index,
  }));
  const order = listenNext ? await shuffleOrder(album.id, tracks.length) : null;
  return {
    album: { ...playerAlbumOf(album), navidromeId: null, url: mixtape.url, artist: mixtapeArtists(album.artist) },
    tracks: order && order.length === tracks.length && order.every(place => tracks[place])
      ? order.map((place, index) => ({ ...tracks[place], no: index + 1 }))
      : tracks,
  };
};

/**
 * An album as the player would play it: named, with its tracks that have a
 * file in the rip; `listenNext` as Listen Next plays it; `disc`, that disc alone.
 * Throws 'Album not found' for an album DexVault does not have.
 */
export const loadPlayable = async (albumId: number, { listenNext = false, disc = 0 } = {}): Promise<Playable> => {
  const album = await musicService.getAlbumById(albumId) as unknown as AlbumLike;
  if (album.titleStatus === 'playlist') return loadMixtape(album, listenNext);
  const rip = await ripOf(albumId).catch(() => null);
  const tracks = playerTracksOf(album, rip);
  if (!disc) return { album: playerAlbumOf(album, rip), tracks };
  return { album: { ...playerAlbumOf(album, rip), disc }, tracks: tracks.filter(track => track.disc === disc) };
};

/** The tracks in a new order, drawn at random, numbered again as they will play. */
export const shuffledTracks = (tracks: PlayerTrack[], random: () => number = Math.random): PlayerTrack[] => {
  const order = [...tracks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((track, index) => ({ ...track, disc: 1, no: index + 1 }));
};

export default { loadPlayable, playerTracksOf, playerAlbumOf, shuffledTracks };
