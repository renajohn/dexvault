/** A track as a list of the player shows it: its disc and number, and whether it was put there by hand. */
interface Ordered { disc?: number; no?: number; queued?: boolean }

/**
 * The tracks as the album has them, none moved nor put there by hand: only
 * then the heads of its discs and its own numbers, which say nothing of an
 * order changed (numbered by their places instead).
 */
export const inAlbumOrder = (tracks: Ordered[]): boolean => tracks.every((track, at) => {
  if (track.queued) return false;
  if (at === 0) return true;
  const before = tracks[at - 1];
  const disc = track.disc ?? 1;
  const discBefore = before.disc ?? 1;
  return disc > discBefore || (disc === discBefore && (track.no ?? 0) >= (before.no ?? 0));
});

/**
 * The album whose disc and number name a track's words: the one playing, or,
 * for a track put there by hand from another album, that album. A mixtape's
 * song put there knows its place in the mixtape, not its number on its CD:
 * none.
 */
export const wordsAlbumOf = (
  album: { id: number | null } | null | undefined,
  track: { queued?: boolean; albumId?: number | null; place?: number } | null | undefined,
): number | null => {
  if (!track?.queued) return album?.id ?? null;
  return track.place != null ? null : track.albumId ?? null;
};
