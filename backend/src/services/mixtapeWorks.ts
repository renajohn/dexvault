import { workGroups } from '../utils/workGroups';

/** What a mixtape's song says of where it comes from: enough to find the work it belongs to. */
export interface PlacedSong {
  title: string;
  navidromeAlbumId: string;
  discNumber: number;
}

/** Songs of a mixtape that go together: the movements of one work in a row, or a song alone (`work` null). */
export interface MixtapeUnit {
  start: number;
  end: number;
  work: string | null;
  /** Each song's own part, "II. Largo", for a work's movements. */
  movements: string[] | null;
}

/**
 * A mixtape's songs as units: songs in a row from one disc of one album
 * whose titles fall under one work (workGroups) are its movements, under it;
 * any other song stands alone, one movement taken from its work too.
 */
export const mixtapeUnits = (songs: PlacedSong[]): MixtapeUnit[] => {
  const units: MixtapeUnit[] = [];
  const alone = (at: number) => units.push({ start: at, end: at, work: null, movements: null });
  let from = 0;
  while (from < songs.length) {
    let to = from;
    while (to + 1 < songs.length && songs[to + 1].navidromeAlbumId === songs[from].navidromeAlbumId
      && songs[to + 1].discNumber === songs[from].discNumber) to++;
    const groups = workGroups(songs.slice(from, to + 1).map(song => song.title));
    for (let at = from; at <= to;) {
      const group = groups[at - from];
      let end = at;
      while (group && end + 1 <= to && groups[end + 1 - from] && !groups[end + 1 - from]!.first && groups[end + 1 - from]!.work === group.work) end++;
      if (group && end > at) {
        units.push({ start: at, end, work: group.work, movements: groups.slice(at - from, end - from + 1).map(one => one!.movement) });
      } else alone(at);
      at = end + 1;
    }
    from = to + 1;
  }
  return units;
};

/** The songs with the work each one plays under, and its own part of it; null for a song alone. */
export const withWorks = <T extends PlacedSong>(songs: T[]): Array<T & { work: string | null; movement: string | null }> => {
  const shown = songs.map(song => ({ ...song, work: null as string | null, movement: null as string | null }));
  for (const unit of mixtapeUnits(songs)) {
    if (!unit.work) continue;
    for (let at = unit.start; at <= unit.end; at++) {
      shown[at].work = unit.work;
      shown[at].movement = unit.movements![at - unit.start];
    }
  }
  return shown;
};
