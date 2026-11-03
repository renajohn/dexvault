import ListenNextPlay from '../models/listenNextPlay';
import { mixtapeUnits, type PlacedSong } from './mixtapeWorks';

/**
 * A mixtape played shuffled in Listen Next: an order drawn once, as it is
 * switched on, and kept until it leaves the list once played, so that the
 * Mac and Amperfy's playlist, written again at each change, play the same
 * one; drawn again then, and when its songs are no longer as many. The
 * draw shuffles units, not songs: a work's movements stay together, in their
 * order (mixtapeWorks).
 */

/** The places 0 to `count - 1` in an order drawn at random (Fisher-Yates). */
export const drawPlaces = (count: number, random: () => number = Math.random): number[] => {
  const places = Array.from({ length: count }, (_, place) => place);
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [places[i], places[j]] = [places[j], places[i]];
  }
  return places;
};

/** The places of the songs, unit by unit in an order drawn at random: a work's movements in a row, in their order. */
export const drawUnitPlaces = (songs: PlacedSong[], random: () => number = Math.random): number[] => {
  const units = mixtapeUnits(songs);
  return drawPlaces(units.length, random).flatMap(at => {
    const unit = units[at];
    return Array.from({ length: unit.end - unit.start + 1 }, (_, k) => unit.start + k);
  });
};

/** Every place of `count` songs once. */
export const fitsSongs = (places: number[], count: number): boolean =>
  places.length === count && new Set(places).size === count && places.every(place => Number.isInteger(place) && place >= 0 && place < count);

/** The order the mixtape's songs play in from Listen Next, as places; null when it plays in its own. */
export const shuffleOrder = async (albumId: number, songs: PlacedSong[]): Promise<number[] | null> => {
  const places = await ListenNextPlay.getShuffle(albumId);
  if (!places) return null;
  if (fitsSongs(places, songs.length)) return places;
  const drawn = drawUnitPlaces(songs);
  await ListenNextPlay.setShuffle(albumId, drawn);
  return drawn;
};

/** The songs in the order they play in from Listen Next. */
export const inListenNextOrder = async <T extends PlacedSong>(albumId: number, songs: T[]): Promise<T[]> => {
  const places = await shuffleOrder(albumId, songs);
  return places ? places.map(place => songs[place]) : songs;
};

/** Switched on, a new order; off, the mixtape's own. */
export const setShuffled = async (albumId: number, songs: PlacedSong[], shuffled: boolean): Promise<number[] | null> => {
  if (!shuffled) {
    await ListenNextPlay.clearShuffle(albumId);
    return null;
  }
  const drawn = drawUnitPlaces(songs);
  await ListenNextPlay.setShuffle(albumId, drawn);
  return drawn;
};

/** Once played, out of the list: the next time comes in a new order, if it is still shuffled. */
export const drawAgain = async (albumId: number, songs: PlacedSong[]): Promise<void> => {
  if (await ListenNextPlay.getShuffle(albumId)) await ListenNextPlay.setShuffle(albumId, drawUnitPlaces(songs));
};
