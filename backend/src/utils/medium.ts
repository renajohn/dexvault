/**
 * A disc of pictures, not of sound: the DVD of a CD + DVD, a Blu-ray, a VHS.
 * MusicBrainz names a disc's format "DVD-Video", "Blu-ray", "VHS", "VCD", or
 * "DVD" alone; a DVD-Audio or a Blu-ray Audio is sound.
 */
export const isVideoMedium = (format: string | null | undefined): boolean =>
  Boolean(format) && !/audio/i.test(format!) && /video|blu-ray|vhs|vcd|hd-dvd|umd|^dvd$|laserdisc/i.test(format!);

/** The same in SQL, on a column of tracks: the tracks of a disc of sound or of a format unknown. */
export const soundTrackSql = (column = 'medium'): string =>
  `(${column} IS NULL OR ${column} LIKE '%audio%' OR NOT (${column} LIKE '%video%' OR ${column} LIKE '%blu-ray%'`
  + ` OR ${column} LIKE '%vhs%' OR ${column} LIKE '%vcd%' OR ${column} LIKE '%hd-dvd%' OR ${column} LIKE '%umd%'`
  + ` OR ${column} LIKE 'dvd' OR ${column} LIKE '%laserdisc%'))`;
