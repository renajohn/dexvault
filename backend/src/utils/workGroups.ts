/**
 * The works a disc's tracks fall under, as the frontend reads them for an
 * album's card (frontend/src/utils/trackCredits.ts, workGroups): the same
 * rules, kept in step, for the mixtapes' works, their search and their
 * shuffle, which the server draws.
 */

/** A movement's number opening its name: "1. ", "IV. ", "4, ", "III: ", or "II" alone. */
const MOVEMENT_NUMBER = /^(?:\d+|[IVXL]+)(?:[.,:]\s|$)/;

/**
 * Where a title may part into its work and its movement: at each colon
 * ("Partita Nr.1 B-dur, BWV 825: I. Prélude"), at a rip's " _ " written for
 * a colon ("Sonata no.8 in c minor, op. 13 - 'pathetique' _ 1. grave"), and at
 * a dash before a movement's number ("Sonata no.17 in d op.31 no.2 'the
 * tempest' - 1. largo allegro", "Concerto pour 2 violons BWV 1040 – II"),
 * never at a dash in a work's name or between a movement's tempi. Each work
 * it may be, by its words in lower case ("op. 4 No. 1" one track, "op. 4 no.
 * 1" the others), with what is left of the title for its movement.
 */
const workCuts = (title: string): Map<string, { work: string; movement: string }> => {
  const cuts = new Map<string, { work: string; movement: string }>();
  const pattern = /: | _ | [-–—] /g;
  for (let found = pattern.exec(title); found; found = pattern.exec(title)) {
    const work = title.slice(0, found.index).trim();
    const movement = title.slice(found.index + found[0].length).trim();
    if (!work || !movement) continue;
    if (/[-–—]/.test(found[0]) && !MOVEMENT_NUMBER.test(movement)) continue;
    cuts.set(work.toLowerCase(), { work, movement });
  }
  return cuts;
};

/**
 * The works a disc's tracks fall under: the movements of a sonata or a
 * partita, two tracks or more in a row whose titles open with one work, go
 * under one heading and keep only their own part, "I. Prélude". Two tracks
 * take the longest work they share: "Suite no. 1 for 2 pianos, op. 5: I.
 * Barcarolle: Allegretto" and "…: II. Valse: Presto" the suite, Haydn's
 * "Symphonie G-dur Hob. I: 88: 1. Adagio" its 88th, not every symphony of
 * Hoboken's first group; and the tracks after them stay while they open with
 * it, the Requiem's Sequenz and Offertorium under the Requiem. Tracks of one
 * title in a row, nothing to tell them apart ("Sonata no.23 in f minor, op. 57"
 * three times), are its parts in order. A track alone, such as one of 24
 * préludes, each its own piece, stays as it is. Null for a track under no heading.
 */
export const workGroups = (titles: string[]): Array<{ work: string; movement: string; first: boolean } | null> => {
  const groups: Array<{ work: string; movement: string; first: boolean } | null> = titles.map(() => null);
  const cuts = titles.map(workCuts);
  let index = 0;
  while (index < titles.length) {
    const title = titles[index];
    if (titles[index + 1] === title) {
      let end = index;
      while (titles[end + 1] === title) end++;
      for (let k = index; k <= end; k++) groups[k] = { work: title, movement: `Part ${k - index + 1}`, first: k === index };
      index = end + 1;
      continue;
    }
    const key = [...cuts[index].keys()].filter(one => cuts[index + 1]?.has(one)).sort((a, b) => b.length - a.length)[0];
    if (!key) { index++; continue; }
    const work = cuts[index].get(key)!.work;
    let end = index;
    while (cuts[end + 1]?.has(key)) end++;
    for (let k = index; k <= end; k++) groups[k] = { work, movement: cuts[k].get(key)!.movement, first: k === index };
    index = end + 1;
  }
  return groups;
};
