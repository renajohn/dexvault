/**
 * How a mixtape is composed, from its Add tracks… and its list: a toggle
 * without Undo, which remembers, while the field keeps its words, where a
 * song taken out stood, for it to go back there; and the movements of one
 * work in a row, one unit that moves and shuffles whole.
 */

/** Where songs taken out stood, by their id: forgotten once the words change or the field is left. */
export type Places = Map<string, number>;

/** What the toggle of songs (one, a work's, an album's) does: how many of them the mixtape holds. */
export type Held = 'all' | 'some' | 'none';

export const heldOf = (ids: string[], songIds: string[]): Held => {
  const unique = [...new Set(songIds)];
  const held = unique.filter(id => ids.includes(id)).length;
  return held === 0 ? 'none' : held === unique.length ? 'all' : 'some';
};

/**
 * Toggles songs in the mixtape's `ids`: all there, every copy goes, each
 * place kept in `places`; else those missing come, each back where it stood
 * if it was taken out during this typing, the others at the end in their
 * order. Never a second copy. Gives the new ids; `places` is changed in place.
 */
export const toggleSongs = (ids: string[], songIds: string[], places: Places): string[] => {
  const unique = [...new Set(songIds)];
  if (heldOf(ids, unique) === 'all') {
    const next = [...ids];
    for (let at = next.length - 1; at >= 0; at--) {
      if (!unique.includes(next[at])) continue;
      places.set(next[at], at);
      next.splice(at, 1);
    }
    return next;
  }
  const missing = unique.filter(id => !ids.includes(id));
  const back = missing.filter(id => places.has(id)).sort((a, b) => places.get(a)! - places.get(b)!);
  const next = [...ids];
  for (const id of back) {
    next.splice(Math.min(places.get(id)!, next.length), 0, id);
    places.delete(id);
  }
  return [...next, ...missing.filter(id => !back.includes(id))];
};

/** A mixtape's song as the units read it. */
export interface UnitSong { work?: string | null; albumId?: number | null }

/** Songs of a mixtape that go together: a work's movements in a row (`work`), or a song alone. */
export interface SongUnit { start: number; end: number; work: string | null }

/** The units of the songs, from the work the server gives each one. */
export const unitsOf = (songs: UnitSong[]): SongUnit[] => {
  const units: SongUnit[] = [];
  songs.forEach((song, at) => {
    const last = units[units.length - 1];
    const before = songs[at - 1];
    if (song.work && last?.work && before?.work === song.work && before.albumId === song.albumId) last.end = at;
    else units.push({ start: at, end: at, work: song.work || null });
  });
  // A movement alone, its work's others not beside it, is a song alone.
  return units.map(unit => (unit.start === unit.end ? { ...unit, work: null } : unit));
};

/** The ids with the unit `from` put before the unit `to` (or at the end for `units.length`). */
export const moveUnit = (ids: string[], units: SongUnit[], from: number, to: number): string[] => {
  if (from === to || from + 1 === to) return ids;
  const parts = units.map(unit => ids.slice(unit.start, unit.end + 1));
  const [moved] = parts.splice(from, 1);
  parts.splice(to > from ? to - 1 : to, 0, moved);
  return parts.flat();
};
