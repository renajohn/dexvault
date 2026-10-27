import musicService, { type RipTrackFile, type RipTracks } from '../services/musicService';
import { player, reportOutputError, type PlayerAlbum, type PlayOptions, type PlayerTrack } from '../services/player';
import outputs, { type OutputError } from '../services/outputs';
import { ripFileFor } from './trackDetail';
import { formatName, isLossless } from './albumHead';
import { isMixtape, mixtapeArtists } from './mixtape';

interface AlbumLike {
  id: number | string;
  titleStatus?: string;
  title: string;
  artist?: string | string[];
  cover?: string | null;
  discs?: Array<{ number: number; tracks: Array<{ no?: number | string; title: string; durationSec?: number; popular?: boolean }> }>;
}

/** The album as the player names it: on the bar, on the Mac's controls; its rip ties it to Navidrome's. */
export const playerAlbumOf = (album: AlbumLike, rip?: RipTracks | null): PlayerAlbum => ({
  id: Number(album.id),
  navidromeId: rip?.album?.id ?? null,
  url: rip?.album?.url ?? null,
  title: album.title,
  artist: Array.isArray(album.artist) ? album.artist.join(', ') : album.artist || '',
  cover: musicService.getImageUrl(album.cover),
});

/** What a file of the rip is, for the player to say what it plays: lossless, or its format. */
const fileFormat = (file: RipTrackFile): Pick<PlayerTrack, 'lossless' | 'format'> =>
  (file.suffix ? { lossless: isLossless(file), format: formatName(file) } : {});

/**
 * The CD's tracks that have a file in the rip, in the CD's order, with its
 * titles. An album DexVault knows no tracks of (a wish, say, whose files
 * Navidrome has) plays the rip as it is, in its order, with its titles.
 */
export const playerTracksOf = (album: AlbumLike, rip: RipTracks | null | undefined): PlayerTrack[] => {
  if (!rip?.found) return [];
  const known = (album.discs || []).some(disc => disc.tracks.length > 0);
  if (!known) {
    return rip.tracks
      .filter(file => file.id)
      .sort((a, b) => a.discNumber - b.discNumber || a.track - b.track)
      .map(file => ({ songId: file.id!, title: file.title, disc: file.discNumber, no: file.track, durationSec: file.durationSec ?? null, starred: file.starred, ...fileFormat(file) }));
  }
  return (album.discs || []).flatMap(disc => disc.tracks.flatMap(track => {
    const file = ripFileFor(rip.tracks, disc.number, Number(track.no));
    return file?.id
      ? [{ songId: file.id, title: track.title, disc: disc.number, no: Number(track.no), durationSec: file.durationSec ?? track.durationSec ?? null, starred: file.starred, ...(track.popular ? { popular: true } : {}), ...fileFormat(file) }]
      : [];
  }));
};

/**
 * A mixtape as the player plays it: its songs in its order, each with its own
 * artist and the cover of its CD; from Listen Next, in the order drawn there
 * when it plays shuffled, the one Amperfy's playlist has too.
 */
const loadMixtape = async (album: AlbumLike, listenNext: boolean): Promise<{ album: PlayerAlbum; tracks: PlayerTrack[] }> => {
  const mixtape = await musicService.getMixtape(Number(album.id));
  const tracks: PlayerTrack[] = mixtape.songs.map((song, index) => ({
    songId: song.songId, title: song.title, disc: 1, no: index + 1, durationSec: song.durationSec,
    artist: song.artist, albumId: song.albumId, cover: musicService.getImageUrl(song.cover), place: index,
  }));
  const order = listenNext ? mixtape.listenNextOrder : null;
  return {
    album: { ...playerAlbumOf(album), navidromeId: null, url: mixtape.url, artist: mixtapeArtists(album.artist) },
    tracks: order && order.length === tracks.length && order.every(place => tracks[place])
      ? order.map((place, index) => ({ ...tracks[place], no: index + 1 }))
      : tracks,
  };
};

/**
 * The tracks in a new order, drawn at random (Fisher-Yates), numbered again
 * as they will play; a mixtape's song keeps its `place` in the mixtape.
 */
export const shuffledTracks = (tracks: PlayerTrack[], random: () => number = Math.random): PlayerTrack[] => {
  const order = [...tracks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((track, index) => ({ ...track, disc: 1, no: index + 1 }));
};

/**
 * An album as the player would play it: named, with its tracks that have a
 * file in the rip; `listenNext` as Listen Next plays it; `disc`, that disc of
 * it alone, as Listen Next holds it.
 */
export const loadPlayable = async (albumId: number | string, { listenNext = false, disc = 0 } = {}): Promise<{ album: PlayerAlbum; tracks: PlayerTrack[] }> => {
  const [album, rip] = await Promise.all([
    musicService.getAlbumById(albumId) as Promise<AlbumLike>,
    musicService.getNavidromeTracks(albumId).catch(() => null),
  ]);
  if (isMixtape(album)) return loadMixtape(album, listenNext);
  const tracks = playerTracksOf(album, rip);
  if (!disc) return { album: playerAlbumOf(album, rip), tracks };
  return { album: { ...playerAlbumOf(album, rip), disc }, tracks: tracks.filter(track => track.disc === disc) };
};

/**
 * Plays an album from the start, or from its track `index`, from wherever a ▶
 * stands without its card open: its tracks and its rip are asked for first;
 * `shuffle` plays them in an order drawn at random, from the first drawn;
 * `disc`, that disc of it alone.
 * False when it has no rip to play, for the caller to offer something else.
 * On an appliance the server loads it and plays it there.
 */
export const playAlbumById = async (albumId: number | string, options?: PlayOptions, index = 0, shuffle = false, disc = 0): Promise<boolean> => {
  player.prime();
  const renderer = player.rendererId();
  if (renderer) {
    try {
      await outputs.play(renderer, { albumId: Number(albumId), disc, index, shuffle, listenNext: options?.queue === 'listenNext' });
      return true;
    } catch (error) {
      if ((error as OutputError).code === 404) return false;
      reportOutputError(error);
      return true;
    }
  }
  const { album, tracks } = await loadPlayable(albumId, { listenNext: options?.queue === 'listenNext', disc });
  if (tracks.length === 0) return false;
  if (shuffle) player.playAlbum(album, shuffledTracks(tracks), 0, 0, options);
  else player.playAlbum(album, tracks, index, 0, options);
  return true;
};
