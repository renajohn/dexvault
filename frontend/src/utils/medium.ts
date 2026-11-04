/**
 * A disc of pictures, not of sound: the DVD of a CD + DVD, a Blu-ray, a VHS
 * (the backend's rule, utils/medium.ts). MusicBrainz names a disc's format
 * "DVD-Video", "Blu-ray", "VHS", "VCD", or "DVD" alone; a DVD-Audio is sound.
 */
export const isVideoMedium = (format: string | null | undefined): boolean =>
  Boolean(format) && !/audio/i.test(format!) && /video|blu-ray|vhs|vcd|hd-dvd|umd|^dvd$|laserdisc/i.test(format!);

/** The discs that play: all of them but a CD + DVD's DVD. */
export const soundDiscs = <T extends { format?: string | null }>(discs: T[] | null | undefined): T[] =>
  (discs || []).filter(disc => !isVideoMedium(disc.format));

/** The discs that are films, shown apart and never played. */
export const videoDiscs = <T extends { format?: string | null }>(discs: T[] | null | undefined): T[] =>
  (discs || []).filter(disc => isVideoMedium(disc.format));
