export interface TrackPerformer {
  name: string;
  role: string;
}

export interface CreditedTrack {
  artist?: string[];
  composers?: string[];
  performers?: TrackPerformer[];
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

/** "Ryan Tedder (drums, piano, bass guitar)" rather than one entry per instrument. */
export const formatPerformers = (performers: TrackPerformer[]): string => {
  const roles = new Map<string, string[]>();
  for (const performer of performers) {
    const list = roles.get(performer.name) || [];
    for (const role of performer.role.split(', ')) if (!list.includes(role)) list.push(role);
    roles.set(performer.name, list);
  }
  return [...roles.entries()].map(([name, list]) => `${name} (${list.join(', ')})`).join(', ');
};

/**
 * One line naming who wrote and who plays a track, as MusicBrainz credits it:
 * "Antonio Vivaldi — Paul Sacher (conductor), Mstislav Rostropovich (cello)".
 * The track artist only shows when there is no composer and it differs from
 * the album's, as on a compilation; a performer who is the album's artist,
 * Dinu Lipatti at the piano on his own album, goes without saying. Null when
 * there is nothing to say.
 */
export const trackCredits = (track: CreditedTrack, albumArtists: string[]): string | null => {
  const albumArtist = (name: string) => albumArtists.some(artist => same(artist, name));
  const composers = track.composers || [];
  const artists = (track.artist || []).filter(name => !albumArtist(name));
  const authors = composers.length > 0 ? composers : artists;
  const performers = (track.performers || []).filter(performer => !albumArtist(performer.name));
  const parts = [authors.join(' / '), formatPerformers(performers)].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : null;
};

const performerKey = (performer: TrackPerformer) => `${performer.name}|${performer.role}`;

/** The roles a listener looks for: who conducts, which orchestra and choir, which voices. */
const FEATURED_ROLE = /^(conductor|orchestra|chorus master)$|choir|chorus|\b(soprano|mezzo-soprano|alto|contralto|countertenor|tenor|baritone|bass-baritone|bass) vocals\b/;
const CLASSICAL_VOICE = /\b(soprano|mezzo-soprano|alto|contralto|countertenor|tenor|baritone|bass-baritone|bass) vocals\b|choir|chorus/;

/**
 * Splits a track's performers into those worth a line and the session
 * musicians. A band's lead and backing vocals mark a pop track, whose
 * performers all go to the musicians, its gospel choir with them; elsewhere
 * up to three instrumentalists are the soloists of a concerto or a recital
 * and stay in the line.
 */
const splitPerformers = (performers: TrackPerformer[]): { featured: TrackPerformer[]; musicians: TrackPerformer[] } => {
  const featured = performers.filter(performer => FEATURED_ROLE.test(performer.role));
  const others = performers.filter(performer => !FEATURED_ROLE.test(performer.role));
  const pop = others.some(performer => /vocals/.test(performer.role) && !CLASSICAL_VOICE.test(performer.role));
  const players = new Set(others.map(performer => performer.name)).size;
  if (pop) return { featured: [], musicians: performers };
  return players <= 3 ? { featured: performers, musicians: [] } : { featured, musicians: others };
};

/**
 * What every credited track shares, in the first one's order. A track
 * MusicBrainz left without credits is a gap in its data, not another
 * composer: Aja's "Black Cow" has none, the six others are Becker / Fagen.
 */
const shared = <T>(lists: T[][], key: (item: T) => string): T[] => {
  const credited = lists.filter(list => list.length > 0);
  if (credited.length === 0) return [];
  return credited[0].filter(item => credited.every(list => list.some(other => key(other) === key(item))));
};

/**
 * The composers most tracks share, when they are more than half of the
 * credited ones: Lennon / McCartney head Abbey Road, Harrison stays under
 * "Something". A Vivaldi, Boccherini and Tartini disc has no head composer.
 */
const usualComposers = (lists: string[][]): string[] => {
  const credited = lists.filter(list => list.length > 0);
  const counts = new Map<string, { names: string[]; count: number }>();
  for (const names of credited) {
    const key = names.join('|');
    counts.set(key, { names, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best && best.count * 2 > credited.length ? best.names : [];
};

export interface DiscCredits {
  common: string | null;
  perTrack: Array<string | null>;
  musicians: Array<string | null>;
}

/**
 * The credits of a disc: once at its head for what the tracks share (the
 * composer of a recital, the conductor and orchestra of an opera), then under
 * each track that differs, on that track and no other, so a line never leaves
 * a doubt about which track it belongs to. Session musicians come apart, for
 * a page that shows them on demand.
 */
export const discCredits = (tracks: CreditedTrack[], albumArtists: string[]): DiscCredits => {
  const split = tracks.map(track => splitPerformers(track.performers || []));
  const composers = usualComposers(tracks.map(track => track.composers || []));
  const performers = shared(split.map(parts => parts.featured), performerKey);
  const common = trackCredits({ composers, performers }, albumArtists);
  const usual = composers.join('|');

  const perTrack = tracks.map((track, index) => trackCredits({
    // A classical track's artist is its composer, already named.
    artist: track.composers?.length ? [] : track.artist,
    composers: (track.composers || []).join('|') === usual ? [] : track.composers,
    performers: split[index].featured.filter(performer => !performers.some(p => performerKey(p) === performerKey(performer))),
  }, albumArtists));
  const musicians = split.map(parts => formatPerformers(parts.musicians) || null);

  return { common, perTrack, musicians };
};

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
