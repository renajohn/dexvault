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
  /** One of the album's most listened tracks (ListenBrainz): the grey dot of its line. */
  popular?: boolean;
  /** A file of the rip that is no track of the CD (a bonus bought apart): played after the CD's. */
  extra?: boolean;
  /** A song of a mixtape: its own artist, the album of DexVault it comes from and that album's cover. */
  artist?: string;
  albumId?: number | null;
  cover?: string | null;
  /** A song of a mixtape: its place in it, from 0. */
  place?: number;
  /** A song of a mixtape: the work it is a movement of with the songs beside it, which a shuffle keeps together. */
  work?: string | null;
  /** The file's kind, as Navidrome names it (flac, mp3): what an appliance is told it is. */
  suffix?: string;
  /** What the page says is heard: the file lossless (FLAC, ALAC…), or its format (MP3, AAC). */
  lossless?: boolean;
  format?: string;
  /** Put there by hand (Play next, Play last) from another album than the one playing: not counted as one of its tracks. */
  queued?: boolean;
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
  /** The radio: an album of songs drawn as it goes, kept so for the pages that follow it. */
  radio?: boolean;
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
  discs?: Array<{ number: number; tracks: Array<{ no?: number | string; title: string; durationSec?: number | null; popular?: boolean }> }>;
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

/** The files of the rip in their order: disc, then track. */
const byPlace = (files: NavidromeTrackFile[]): NavidromeTrackFile[] =>
  files.filter(file => file.id).sort((a, b) => a.discNumber - b.discNumber || a.track - b.track);

/**
 * The CD's tracks that have a file in the rip, in the CD's order, with its
 * titles, then the rip's files on no track of the CD (bonus tracks bought
 * apart, say) with their own; an album DexVault knows no tracks of plays the
 * rip as it is.
 */
export const playerTracksOf = (album: AlbumLike, rip: RipTracks | null | undefined): PlayerTrack[] => {
  if (!rip?.found) return [];
  const discs = album.discs || [];
  const known = discs.some(disc => disc.tracks.length > 0);
  if (!known) {
    return byPlace(rip.tracks)
      .map(file => ({ songId: file.id!, title: file.title, disc: file.discNumber, no: file.track, durationSec: file.durationSec ?? null, starred: file.starred, suffix: file.suffix }));
  }
  const onCd = discs.flatMap(disc => disc.tracks.flatMap(track => {
    const file = ripFileFor(rip.tracks, disc.number, Number(track.no));
    return file?.id
      ? [{ songId: file.id, title: track.title, disc: disc.number, no: Number(track.no), durationSec: file.durationSec ?? track.durationSec ?? null, starred: file.starred, suffix: file.suffix, ...(track.popular ? { popular: true } : {}) }]
      : [];
  }));
  const places = new Set(discs.flatMap(disc => disc.tracks.map(track => `${disc.number}-${Number(track.no)}`)));
  const extras = byPlace(rip.tracks)
    .filter(file => !places.has(`${file.discNumber}-${file.track}`))
    .map(file => ({ songId: file.id!, title: file.title, disc: file.discNumber, no: file.track, durationSec: file.durationSec ?? null, starred: file.starred, suffix: file.suffix, extra: true }));
  return [...onCd, ...extras];
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
    artist: song.artist, albumId: song.albumId, cover: imageUrlOf(song.cover), place: index, work: song.work,
  }));
  const order = listenNext ? await shuffleOrder(album.id, mixtape.songs) : null;
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

/**
 * The tracks in a new order, drawn at random (Fisher-Yates), numbered again
 * as they will play; a mixtape's song keeps its `place` in it, and the
 * movements of one work in a row (`work`) stay together, in their order.
 */
export const shuffledTracks = (tracks: PlayerTrack[], random: () => number = Math.random): PlayerTrack[] => {
  const units: PlayerTrack[][] = [];
  tracks.forEach((track, at) => {
    const before = tracks[at - 1];
    if (track.work && before?.work === track.work && before.albumId === track.albumId) units[units.length - 1].push(track);
    else units.push([track]);
  });
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  return units.flat().map((track, index) => ({ ...track, disc: 1, no: index + 1 }));
};

export default { loadPlayable, playerTracksOf, playerAlbumOf, shuffledTracks };
