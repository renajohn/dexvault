import { getDatabase } from '../database';
import ShelfItem, { SHELF_SECTIONS, ShelfItemRow, ShelfKind, ShelfPlaceRow, ShelfSection, ShelfSettings } from '../models/shelfItem';
import ShelfFurniture, { ShelfLevelRow, ShelfUnitRow } from '../models/shelfFurniture';
import { fillShelves, usableCases } from './shelfFill';
import musicbrainzService from './musicbrainzService';
import logger from '../logger';
import {
  boxSetName, classicalHeadline, collationKey, filmTitle, isClassicalAlbum, isVarious, Performer, personSortName, withoutArticle,
} from './shelfOrder';

/** A request the shelves cannot honour, with the status to answer it by. */
export class ShelvingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Where a filing name came from: set by hand, given by MusicBrainz, or worked out here and worth a look. */
export type SortSource = 'manual' | 'musicbrainz' | 'guess';

export interface ShelvedItem {
  kind: ShelfKind;
  id: number;
  title: string;
  /** The artist, or a film's year and format. */
  subtitle: string;
  image: string | null;
  section: ShelfSection;
  /** Whether the section is the one the data gives, not one set by hand. */
  sectionAuto: boolean;
  /** The name it is filed under, as read on the shelf: "Michael, George", "Parrain". */
  sortName: string;
  sortSource: SortSource;
  /** How wide it stands, in standard cases: a CD case for a CD, a Blu-ray case for a film (a DVD's is 1.2). */
  units: number;
  /** Whether the width is the estimate from its discs or format, not one set by hand. */
  unitsAuto: boolean;
  placeId: number | null;
  /** The shelf it stands on, "B-3", once the furniture is described; null off the shelves or when they are full. */
  code: string | null;
  levelId: number | null;
  /** Whether the owner put it on that shelf by hand, out of the order. */
  pinned: boolean;
  /** The films a box set holds. */
  movieIds?: number[];
  /** A film's collections, and whether the owner keeps each together on the shelf. */
  collections?: Array<{ id: number; name: string; together: boolean }>;
  /** The collection it stands with, filed under its first film: "Jurassic Park". */
  together?: { id: number; name: string } | null;
}

/** An object to take from one shelf to another, or to put on its shelf when new. */
/** An object on a shelf, in the order the shelf holds them. */
export interface LineItem {
  kind: ShelfKind;
  id: number;
  title: string;
  /** A CD's artist, to name it among the others. */
  artist?: string;
  orderKey: string;
}

/** What a shelf was told about its room. */
export type LevelState = Pick<ShelfLevelRow, 'id' | 'capacity' | 'break_before' | 'extend_through' | 'locked' | 'locked_from' | 'locked_through'>;

export interface ShelfMove {
  kind: ShelfKind;
  id: number;
  /** A CD's artist and title, "Ayọ – Joyful". */
  title: string;
  /** A CD's artist and its title alone, to name several of one artist once. */
  artist?: string;
  name?: string;
  /** The shelf or place it stood on; null for an object new to the collection. */
  from: string | null;
  /** Null when the shelves have no more room for it. */
  to: string | null;
  /** What it stands next to there, to slip it in at the right place: the one before it, or the one after when it is first. */
  after?: string | null;
  before?: string | null;
  /** The shelf it goes on, when it is one the owner fills step by step. */
  toLevelId?: number | null;

}

export interface ShelfLevelPlan {
  id: number;
  level: number;
  code: string;
  section: ShelfSection | null;
  /** Cases it holds, its own or its unit's. */
  capacity: number;
  ownCapacity: number | null;
  /** Cases it takes before it counts as full. */
  usable: number;
  used: number;
  count: number;
  /** How many of them the owner put there by hand. */
  pinned: number;
  first: string | null;
  last: string | null;
  locked: boolean;
  /** The name of the object told it had no room here. */
  breakBefore: string | null;
}

export interface ShelfUnitPlan {
  id: number;
  letter: string;
  capacity: number;
  levels: ShelfLevelPlan[];
}

export interface ShelvingPlan {
  sections: Array<{ key: ShelfSection; items: ShelvedItem[]; shelves: number; unshelved: number }>;
  places: Array<ShelfPlaceRow & { items: ShelvedItem[] }>;
  units: ShelfUnitPlan[];
}

/** An object with the key it stands in order by: its filing name, then the year and title, then itself. */
type Ordered = ShelvedItem & { orderKey: string; pinTo: number | null };

/**
 * Where a CD stands in the shelves' order: the name it is filed under,
 * "Chapman, Tracy" or "Karajan, Herbert von", and the key that orders it,
 * which the collection's list sorts by too.
 */
export interface AlbumOrder { sortName: string; key: string }

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) =>
    getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))));

const parseList = <T = string>(json: string | null): T[] => {
  try {
    const value = JSON.parse(json || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

interface AlbumRow { id: number; artist: string; title: string; release_year: number | null; genres: string | null; cover: string | null; discs: number | null }
interface TrackCreditRow { album_id: number; composers: string | null; performers: string | null }
interface MovieRow { id: number; title: string; release_date: string | null; format: string | null; poster_path: string | null; box_set_id: number | null }
interface BoxSetRow { id: number; name: string }
interface MembershipRow { movie_id: number; collection_id: number; name: string }

/** A CD case holds two discs; beyond that a box set grows by a case for every two more. */
const albumUnits = (discs: number): number => Math.max(1, Math.ceil(discs / 2));

/** A box set of films stands about a case wide for every two films in it. */
const boxSetUnits = (films: number): number => Math.max(1, Math.ceil(films / 2));

/** A DVD case is thicker than a Blu-ray's: a shelf holding 12 Blu-ray takes 10 DVD. */
const movieUnits = (format: string | null): number => (/^dvd/i.test(format || '') ? 1.2 : 1);

/** The filing name of a CD outside classical: the artist as MusicBrainz files it, the title for a compilation. */
const musicSortName = (artists: string[], title: string, saved: ShelfItemRow | undefined): { name: string; source: SortSource } => {
  const first = artists[0] || '';
  if (!first || isVarious(first)) return { name: withoutArticle(title), source: 'guess' };
  if (saved?.artist_sort) {
    // MusicBrainz files "The Beatles" as "Beatles, The": the article is not read on the shelf.
    return { name: saved.artist_sort.replace(/,\s*(the|les|le|la|l['’])$/i, ''), source: 'musicbrainz' };
  }
  return { name: withoutArticle(first), source: 'guess' };
};

/** A collection of films lent out, "Prêté à Yves", is no series to keep together. */
const isLoan = (name: string): boolean => /^(pr[êe]t|lent\s|loaned\s)/i.test(name.trim());

const orderKeyOf = (sortName: string, then: string, kind: ShelfKind, id: number): string =>
  [collationKey(sortName), then, kind, String(id).padStart(9, '0')].join('\u0001');

const byKey = (a: Ordered, b: Ordered): number => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);

const codeOf = (unit: ShelfUnitRow, level: ShelfLevelRow): string => `${unit.letter}-${level.level}`;

const shelvingService = {
  /**
   * Every object to shelve, in the order it stands within its section, and
   * those kept off the shelves by place. The order within a section is the
   * filing name, then the year for an artist's albums, so a discography stands
   * in the order it came out.
   */
  plan: async (): Promise<ShelvingPlan> => {
    const { items, places, units, levels } = await shelvingService.arrange();
    const strip = ({ orderKey: _key, pinTo: _pin, ...item }: Ordered): ShelvedItem => item;
    const placeIds = new Set(places.map(place => place.id));
    const onShelves = items.filter(item => item.placeId == null || !placeIds.has(item.placeId));

    const nameOf = new Map(items.map(item => [item.orderKey, item.sortName]));
    const unitPlans: ShelfUnitPlan[] = units.map(unit => ({
      id: unit.id,
      letter: unit.letter,
      capacity: unit.capacity,
      levels: levels.filter(level => level.unit_id === unit.id).map(level => {
        const held = onShelves.filter(item => item.levelId === level.id);
        const pinned = held.filter(item => item.pinned).length;
        const capacity = level.capacity || unit.capacity;
        return {
          id: level.id,
          level: level.level,
          code: codeOf(unit, level),
          section: level.section,
          capacity,
          ownCapacity: level.capacity,
          usable: usableCases(capacity),
          used: Math.round(held.reduce((sum, item) => sum + item.units, 0) * 10) / 10,
          count: held.length,
          pinned,
          first: held[0]?.sortName ?? null,
          last: held[held.length - 1]?.sortName ?? null,
          locked: !!level.locked,
          breakBefore: level.break_before ? nameOf.get(level.break_before) ?? 'an object since removed' : null,
        };
      }),
    }));

    return {
      sections: SHELF_SECTIONS.map(key => {
        // Once there are shelves, the list follows them, a shelf's objects in order, what has none at the end.
        const shelfIndex = new Map(units.flatMap(unit => levels.filter(level => level.unit_id === unit.id)).map((level, index) => [level.id, index]));
        const at = (item: Ordered) => (item.levelId == null ? Infinity : shelfIndex.get(item.levelId) ?? Infinity);
        const sectionItems = onShelves.filter(item => item.section === key)
          .sort((a, b) => at(a) - at(b) || byKey(a, b));
        return {
          key,
          items: sectionItems.map(strip),
          shelves: levels.filter(level => level.section === key).length,
          unshelved: sectionItems.filter(item => item.code == null).length,
        };
      }),
      places: places.map(place => ({ ...place, items: items.filter(item => item.placeId === place.id).map(strip) })),
      units: unitPlans,
    };
  },

  /**
   * Every object in order, each with the shelf it goes on: a section's
   * shelves are taken unit after unit, in letter order, and in each from
   * the top shelf down.
   */
  arrange: async (): Promise<{ items: Ordered[]; places: ShelfPlaceRow[]; units: ShelfUnitRow[]; levels: ShelfLevelRow[] }> => {
    const [albums, credits, movies, boxSets, memberships, togetherChoices, saved, places, units, levels] = await Promise.all([
      all<AlbumRow>(`
        SELECT a.id, a.artist, a.title, a.release_year, a.genres, a.cover,
               (SELECT MAX(disc_number) FROM tracks t WHERE t.album_id = a.id) AS discs
          FROM albums a WHERE COALESCE(a.title_status, 'owned') = 'owned'`),
      all<TrackCreditRow>(`
        SELECT t.album_id, t.composers, t.performers FROM tracks t
          JOIN albums a ON a.id = t.album_id
         WHERE COALESCE(a.title_status, 'owned') = 'owned'`),
      all<MovieRow>(`
        SELECT m.id, m.title, m.release_date, m.format, m.poster_path,
               (SELECT c.id FROM movie_collections mc JOIN collections c ON c.id = mc.collection_id
                 WHERE mc.movie_id = m.id AND c.type = 'box_set' ORDER BY c.id LIMIT 1) AS box_set_id
          FROM movies m WHERE COALESCE(m.title_status, 'owned') = 'owned'`),
      all<BoxSetRow>(`SELECT id, name FROM collections WHERE type = 'box_set'`),
      all<MembershipRow>(`
        SELECT mc.movie_id, mc.collection_id, c.name FROM movie_collections mc
          JOIN collections c ON c.id = mc.collection_id
         WHERE c.type = 'user' ORDER BY c.id`),
      ShelfItem.togetherChoices(),
      ShelfItem.all(),
      ShelfItem.places(),
      ShelfFurniture.units(),
      ShelfFurniture.levels(),
    ]);

    const settings = new Map(saved.map(row => [`${row.kind}:${row.item_id}`, row]));
    const creditsOf = new Map<number, { composers: string[]; performers: Performer[] }>();
    for (const row of credits) {
      const entry = creditsOf.get(row.album_id) || { composers: [], performers: [] };
      entry.composers.push(...parseList(row.composers));
      entry.performers.push(...parseList<Performer>(row.performers));
      creditsOf.set(row.album_id, entry);
    }

    const items: Ordered[] = [];
    const finish = (item: ShelvedItem, then: string, row: ShelfItemRow | undefined) => {
      const manual = row?.shelve_under?.trim();
      const shelved = manual ? { ...item, sortName: manual, sortSource: 'manual' as const } : item;
      const section = row?.section || shelved.section;
      items.push({
        ...shelved,
        section,
        sectionAuto: !row?.section,
        placeId: row?.place_id ?? null,
        units: row?.units || shelved.units,
        unitsAuto: !row?.units,
        orderKey: orderKeyOf(shelved.sortName, then, item.kind, item.id),
        pinTo: row?.level_id ?? null,
      });
    };

    for (const album of albums) {
      const row = settings.get(`album:${album.id}`);
      const artists = parseList(album.artist);
      const albumCredits = creditsOf.get(album.id) || { composers: [], performers: [] };
      const classical = row?.section ? row.section === 'classical' : isClassicalAlbum(parseList(album.genres), albumCredits.performers);
      let sort: { name: string; source: SortSource };
      if (classical && !isVarious(artists[0])) {
        const headline = classicalHeadline(artists, albumCredits.composers, albumCredits.performers);
        sort = headline ? { name: personSortName(headline), source: 'guess' } : { name: withoutArticle(album.title), source: 'guess' };
      } else {
        sort = musicSortName(artists, album.title, row);
      }
      finish({
        kind: 'album', id: album.id, title: album.title, subtitle: artists.join(', '), image: album.cover,
        section: classical ? 'classical' : 'music', sectionAuto: true,
        sortName: sort.name, sortSource: sort.source, units: albumUnits(album.discs || 1), unitsAuto: true, placeId: null, code: null, levelId: null, pinned: false,
      }, `${String(album.release_year || 9999)} ${collationKey(album.title)}`, row);
    }

    const filmsOf = new Map<number, MovieRow[]>();
    const loose = movies.filter(movie => {
      if (movie.box_set_id == null) return true;
      filmsOf.set(movie.box_set_id, [...(filmsOf.get(movie.box_set_id) || []), movie]);
      return false;
    });

    // A collection kept together stands under its first film's name, its films in the order they came out.
    // Each is, unless the owner said otherwise, or it holds films lent out rather than a series.
    const together = new Set(memberships
      .filter(member => togetherChoices.get(member.collection_id) ?? !isLoan(member.name))
      .map(member => member.collection_id));
    const collectionsOf = new Map<number, Array<{ id: number; name: string; together: boolean }>>();
    for (const member of memberships) {
      const entry = { id: member.collection_id, name: member.name, together: together.has(member.collection_id) };
      collectionsOf.set(member.movie_id, [...(collectionsOf.get(member.movie_id) || []), entry]);
    }
    const released = (movie: MovieRow) => movie.release_date || '9999';
    const ownName = (movie: MovieRow) => settings.get(`movie:${movie.id}`)?.shelve_under?.trim() || filmTitle(movie.title);
    const groupOf = new Map<number, { id: number; name: string }>();
    for (const id of together) {
      const films = loose
        .filter(movie => !groupOf.has(movie.id) && collectionsOf.get(movie.id)?.some(entry => entry.id === id))
        .sort((a, b) => released(a).localeCompare(released(b)) || a.id - b.id);
      if (films.length < 2) continue;
      const group = { id, name: ownName(films[0]) };
      films.forEach(movie => groupOf.set(movie.id, group));
    }

    for (const movie of loose) {
      const row = settings.get(`movie:${movie.id}`);
      const year = (movie.release_date || '').slice(0, 4);
      const group = groupOf.get(movie.id) || null;
      const item: ShelvedItem = {
        kind: 'movie', id: movie.id, title: movie.title, subtitle: [year, movie.format].filter(Boolean).join(' · '),
        image: movie.poster_path, section: 'films', sectionAuto: true,
        sortName: filmTitle(movie.title), sortSource: 'guess', units: movieUnits(movie.format), unitsAuto: true, placeId: null, code: null, levelId: null, pinned: false,
        collections: collectionsOf.get(movie.id) || [], together: group,
      };
      if (!group) {
        finish(item, year, row);
        continue;
      }
      // The film's own name is set aside while its collection is kept together.
      const shelved = { ...item, sortName: group.name, sortSource: 'guess' as const };
      finish(shelved, `~${String(group.id).padStart(9, '0')} ${released(movie)}`, row && { ...row, shelve_under: null });
      const last = items[items.length - 1];
      last.sortSource = row?.shelve_under?.trim() && ownName(movie) === group.name ? 'manual' : 'guess';
    }

    for (const box of boxSets) {
      const films = filmsOf.get(box.id);
      if (!films?.length) continue;
      const row = settings.get(`box_set:${box.id}`);
      finish({
        kind: 'box_set', id: box.id, title: box.name, subtitle: `${films.length} films`,
        image: films[0].poster_path, section: 'films', sectionAuto: true,
        sortName: withoutArticle(boxSetName(box.name)), sortSource: 'guess', units: boxSetUnits(films.length), unitsAuto: true, placeId: null, code: null, levelId: null, pinned: false,
        movieIds: films.map(film => film.id),
      }, '', row);
    }

    items.sort(byKey);
    const placeIds = new Set(places.map(place => place.id));
    const unitOf = new Map(units.map(unit => [unit.id, unit]));
    const shelvesInOrder = units.flatMap(unit => levels.filter(level => level.unit_id === unit.id));
    const levelById = new Map(levels.map(level => [level.id, level]));
    const onShelves = items.filter(item => item.placeId == null || !placeIds.has(item.placeId));

    // What the owner put on a shelf by hand stands there, out of the order, and takes from its room.
    const reserved = new Map<number, number>();
    for (const item of onShelves) {
      const level = item.pinTo != null ? levelById.get(item.pinTo) : undefined;
      if (!level) continue;
      item.levelId = level.id;
      item.code = codeOf(unitOf.get(level.unit_id)!, level);
      item.pinned = true;
      reserved.set(level.id, (reserved.get(level.id) || 0) + item.units);
    }

    for (const section of SHELF_SECTIONS) {
      const shelves = shelvesInOrder.filter(level => level.section === section);
      const placed = onShelves.filter(item => item.section === section && !item.pinned);
      const { shelfOf } = fillShelves(
        shelves.map(level => ({
          reserved: reserved.get(level.id) || 0,
          id: level.id,
          capacity: level.capacity || unitOf.get(level.unit_id)!.capacity,
          locked: !!level.locked,
          lockedFrom: level.locked_from,
          lockedThrough: level.locked_through,
          breakBefore: level.break_before,
          extendThrough: level.extend_through,
        })),
        placed.map(item => ({ key: item.orderKey, units: item.units })),
      );
      placed.forEach((item, index) => {
        const level = shelves.find(shelf => shelf.id === shelfOf[index]);
        item.levelId = level?.id ?? null;
        item.code = level ? codeOf(unitOf.get(level.unit_id)!, level) : null;
      });
    }
    return { items, places, units, levels };
  },

  /**
   * Where each film and CD is, for their cards: the shelf code, or the name of
   * the place it is kept in. A film in a box set is where its box set is. And
   * what the owner has to move since they last put the shelves in order.
   */
  locations: async (): Promise<{ movies: Record<number, string>; albums: Record<number, string>; albumOrder: Record<number, AlbumOrder>; moves: ShelfMove[] }> => {
    const { items, places } = await shelvingService.arrange();
    const placeName = new Map(places.map(place => [place.id, place.name]));
    const movies: Record<number, string> = {};
    const albums: Record<number, string> = {};
    const albumOrder: Record<number, AlbumOrder> = {};
    const whereOf = (item: Ordered) => (item.placeId != null && placeName.get(item.placeId)) || item.code || null;
    for (const item of items) {
      if (item.kind === 'album') albumOrder[item.id] = { sortName: item.sortName, key: item.orderKey };
      const where = whereOf(item);
      if (!where) continue;
      if (item.kind === 'album') albums[item.id] = where;
      else if (item.kind === 'movie') movies[item.id] = where;
      else for (const movieId of item.movieIds || []) movies[movieId] = where;
    }
    return { movies, albums, albumOrder, moves: await shelvingService.moves(items.map(item => ({ item, where: whereOf(item) }))) };
  },

  /**
   * What stands somewhere else than where the owner last put it: a film after
   * which another was added moves on to the next shelf. An object new to the
   * collection is to be put on its shelf. The first time, what the plan says
   * is taken as where everything stands.
   */
  moves: async (current: Array<{ item: Ordered; where: string | null }>): Promise<ShelfMove[]> => {
    const standing = await ShelfItem.standing();
    if (standing.length === 0) {
      await ShelfItem.saveStanding(current.map(({ item, where }) => ({ kind: item.kind, id: item.id, place: where })));
      return [];
    }
    const before = new Map(standing.map(row => [`${row.kind}:${row.item_id}`, row.place]));
    // Each shelf's objects in the order they stand; what was put there by hand lies apart.
    const onShelf = new Map<number, Ordered[]>();
    for (const { item } of current) {
      if (item.levelId == null || item.pinned || item.placeId != null) continue;
      onShelf.set(item.levelId, [...(onShelf.get(item.levelId) || []), item]);
    }
    const neighbours = (item: Ordered): { after: string | null; before: string | null } => {
      const row = item.levelId != null && !item.pinned ? onShelf.get(item.levelId) || [] : [];
      const at = row.indexOf(item);
      if (at < 0) return { after: null, before: null };
      // A CD next to another artist's says whose it is; next to one of its own artist, its title is enough.
      const named = (other: Ordered | undefined): string | null =>
        !other ? null : other.kind === 'album' && other.subtitle && other.subtitle !== item.subtitle ? `${other.subtitle} – ${other.title}` : other.title;
      if (at > 0) return { after: named(row[at - 1]), before: null };
      return { after: null, before: named(row[1]) };
    };
    const moves: ShelfMove[] = [];
    const placed: Array<{ kind: ShelfKind; id: number; place: string | null }> = [];
    for (const { item, where } of current) {
      const was = before.get(`${item.kind}:${item.id}`);
      if (was === where || (was === undefined && where == null)) continue;
      // One that had no shelf as the shelves were being set up gets one: no move to make, but it stands there from now on.
      if (was === null) {
        placed.push({ kind: item.kind, id: item.id, place: where });
        continue;
      }
      const onPlan = item.levelId != null && !item.pinned && item.placeId == null;
      const nextTo = where ? neighbours(item) : { after: null, before: null };
      moves.push({
        kind: item.kind, id: item.id, from: was ?? null, to: where,
        title: item.kind === 'album' && item.subtitle ? `${item.subtitle} – ${item.title}` : item.title,
        ...(item.kind === 'album' && item.subtitle ? { artist: item.subtitle, name: item.title } : {}),
        ...nextTo,
        toLevelId: onPlan ? item.levelId : null,
      });
    }
    await ShelfItem.saveStanding(placed);
    const present = new Set(current.map(({ item }) => `${item.kind}:${item.id}`));
    for (const row of standing) {
      if (!present.has(`${row.kind}:${row.item_id}`)) await ShelfItem.forgetStanding(row.kind, row.item_id);
    }
    // In the order they stand, so the owner works along the shelves.
    const at = new Map(current.map(({ item }, index) => [`${item.kind}:${item.id}`, index]));
    return moves.sort((a, b) => at.get(`${a.kind}:${a.id}`)! - at.get(`${b.kind}:${b.id}`)!);
  },

  /** The owner made these moves: they stand where the plan has them now. */
  movesDone: (moves: Array<{ kind: ShelfKind; id: number; to: string | null }>): Promise<void> =>
    ShelfItem.saveStanding(moves.map(move => ({ kind: move.kind, id: move.id, place: move.to }))),

  saveSettings: (kind: ShelfKind, id: number, settings: ShelfSettings): Promise<void> => ShelfItem.saveSettings(kind, id, settings),

  /** Keeps a collection's films together on the shelf, or lets each stand under its own name again. */
  setTogether: async (collectionId: number, together: boolean): Promise<void> => {
    const found = await all<{ id: number }>(`SELECT id FROM collections WHERE id = ? AND type = 'user'`, [collectionId]);
    if (found.length === 0) throw new ShelvingError(404, 'Collection not found');
    await ShelfItem.setTogether(collectionId, together);
  },

  createUnit: ShelfFurniture.createUnit,
  updateUnit: ShelfFurniture.updateUnit,
  deleteUnit: ShelfFurniture.deleteUnit,
  unit: ShelfFurniture.unit,
  level: ShelfFurniture.level,

  /** Gives a shelf to a section, or another capacity. A shelf given to another section starts afresh: unlocked, with room for all. */
  updateLevel: async (id: number, changes: { section?: ShelfSection | null; capacity?: number | null }): Promise<void> => {
    const level = await ShelfFurniture.level(id);
    if (!level) throw new ShelvingError(404, 'Shelf not found');
    const moved = changes.section !== undefined && changes.section !== level.section;
    await ShelfFurniture.updateLevel(id, {
      ...changes,
      ...(moved ? { break_before: null, extend_through: null, locked: 0, locked_from: null, locked_through: null } : {}),
    });
  },

  /**
   * Locks a shelf once arranged, keeping the objects it holds now and the
   * place where the next shelf begins, or unlocks it.
   */
  setLocked: async (id: number, locked: boolean): Promise<void> => {
    if (!locked) {
      await ShelfFurniture.updateLevel(id, { locked: 0, locked_from: null, locked_through: null });
      return;
    }
    const { items } = await shelvingService.arrange();
    const held = items.filter(item => item.levelId === id && !item.pinned);
    if (held.length === 0) throw new ShelvingError(409, 'Nothing stands on this shelf in order to keep');
    await ShelfFurniture.updateLevel(id, {
      locked: 1, locked_from: held[0].orderKey, locked_through: held[held.length - 1].orderKey, break_before: null,
    });
  },

  /**
   * An object did not fit on its shelf: it and those after it go on the next
   * one. On a locked shelf, the shelf gives up that object and the ones after.
   */
  noRoom: async (kind: ShelfKind, id: number): Promise<void> => {
    const { items } = await shelvingService.arrange();
    const item = items.find(other => other.kind === kind && other.id === id);
    if (!item?.levelId) throw new ShelvingError(409, 'It is not on a shelf');
    if (item.pinned) throw new ShelvingError(409, 'It was put on this shelf by hand: choose another shelf for it instead');
    const held = items.filter(other => other.levelId === item.levelId && !other.pinned);
    const at = held.indexOf(item);
    if (at === 0) throw new ShelvingError(409, 'It is already first on its shelf: give the shelf more room instead');
    const level = await ShelfFurniture.level(item.levelId);
    if (level?.locked) await ShelfFurniture.updateLevel(item.levelId, { locked_through: held[at - 1].orderKey });
    else {
      // Moved back onto this shelf earlier, it no longer is.
      const extended = level?.extend_through != null && item.orderKey <= level.extend_through;
      await ShelfFurniture.updateLevel(item.levelId, {
        break_before: item.orderKey,
        ...(extended ? { extend_through: held[at - 1].orderKey } : {}),
      });
    }
  },

  /**
   * It would fit on the shelf before: that shelf takes it, and those before it
   * on its shelf, whatever its room. The shelf before is the section's
   * previous one, in the order the shelves fill.
   */
  moveBack: async (kind: ShelfKind, id: number): Promise<void> => {
    const { items, units, levels } = await shelvingService.arrange();
    const item = items.find(other => other.kind === kind && other.id === id);
    if (!item?.levelId) throw new ShelvingError(409, 'It is not on a shelf');
    if (item.pinned) throw new ShelvingError(409, 'It was put on this shelf by hand: choose another shelf for it instead');
    const current = levels.find(level => level.id === item.levelId)!;
    const shelves = units.flatMap(unit => levels.filter(level => level.unit_id === unit.id && level.section === current.section));
    const previous = shelves[shelves.findIndex(level => level.id === current.id) - 1];
    if (!previous) throw new ShelvingError(409, 'It is on the first shelf of its section');

    if (previous.locked) {
      await ShelfFurniture.updateLevel(previous.id, { locked_through: item.orderKey });
    } else {
      // Only it moves: the shelf before stops right after it, as it stopped before it.
      const following = items.find(other => other.section === item.section && !other.pinned && other.placeId == null && other.orderKey > item.orderKey);
      await ShelfFurniture.updateLevel(previous.id, {
        extend_through: item.orderKey,
        break_before: following ? following.orderKey : null,
      });
    }
    if (current.locked) {
      const rest = items.filter(other => other.levelId === current.id && !other.pinned && other.orderKey > item.orderKey);
      await ShelfFurniture.updateLevel(current.id, rest.length > 0
        ? { locked_from: rest[0].orderKey }
        : { locked: 0, locked_from: null, locked_through: null });
    }
  },

  /**
   * What is on a shelf once its moves are made, in order: what stands there
   * now and what the plan brings, the ones the plan takes off it included.
   */
  line: async (id: number): Promise<{ items: LineItem[]; code: string }> => {
    const { items, units, levels } = await shelvingService.arrange();
    const level = levels.find(other => other.id === id);
    if (!level) throw new ShelvingError(404, 'Shelf not found');
    const code = codeOf(units.find(unit => unit.id === level.unit_id)!, level);
    const there = new Set((await ShelfItem.standing()).filter(row => row.place === code).map(row => `${row.kind}:${row.item_id}`));
    const line = items.filter(item => !item.pinned && item.placeId == null && (item.levelId === id || there.has(`${item.kind}:${item.id}`)));
    return { code, items: line.sort(byKey).map(item => ({
      kind: item.kind, id: item.id, title: item.title, orderKey: item.orderKey,
      ...(item.kind === 'album' && item.subtitle ? { artist: item.subtitle } : {}),
    })) };
  },

  /**
   * The owner filled a shelf and took the last few off it to make room: it
   * holds the rest, whatever the plan said of its room, and those go on to
   * the next shelf.
   */
  takeOff: async (id: number, count: number): Promise<void> => {
    const { items: line } = await shelvingService.line(id);
    if (count < 0 || count >= line.length) throw new ShelvingError(409, 'The shelf cannot be left empty');
    const level = (await ShelfFurniture.level(id))!;
    const kept = line[line.length - count - 1];
    if (level.locked) {
      await ShelfFurniture.updateLevel(id, { locked_through: kept.orderKey });
      return;
    }
    // As when one is moved back: the shelf takes all up to the last kept and stops right after it.
    const { items } = await shelvingService.arrange();
    const keptItem = items.find(item => item.orderKey === kept.orderKey)!;
    const following = items.find(other => other.section === keptItem.section && !other.pinned && other.placeId == null && other.orderKey > kept.orderKey);
    await ShelfFurniture.updateLevel(id, { extend_through: kept.orderKey, break_before: following ? following.orderKey : null });
  },

  /** What each shelf was told about its room, to put it back as it was. */
  levelsState: async (): Promise<LevelState[]> =>
    (await ShelfFurniture.levels()).map(({ id, capacity, break_before, extend_through, locked, locked_from, locked_through }) =>
      ({ id, capacity, break_before, extend_through, locked, locked_from, locked_through })),

  /** Puts the shelves back as they were told: undoes a change made from the moves notice. */
  restoreLevels: async (rows: LevelState[]): Promise<void> => {
    const known = new Set((await ShelfFurniture.levels()).map(level => level.id));
    for (const { id, ...state } of rows) if (known.has(id)) await ShelfFurniture.updateLevel(id, state);
  },

  /** The owner had not made these moves after all: they stand where they stood. */
  movesUndone: async (moves: Array<{ kind: ShelfKind; id: number; from: string | null }>): Promise<void> => {
    for (const move of moves) {
      if (move.from == null) await ShelfItem.forgetStanding(move.kind, move.id);
      else await ShelfItem.saveStanding([{ kind: move.kind, id: move.id, place: move.from }]);
    }
  },

  /** Forgets that an object had no room on a shelf, and what was moved back onto it. */
  clearBreak: (id: number): Promise<void> => ShelfFurniture.updateLevel(id, { break_before: null, extend_through: null }),

  places: ShelfItem.places,
  createPlace: ShelfItem.createPlace,
  renamePlace: ShelfItem.renamePlace,
  deletePlace: ShelfItem.deletePlace,

  /**
   * Asks MusicBrainz the sort name of each album's artist not asked yet: the
   * name a record shop files them under, "Michael, George" but "Beatles, The",
   * which no rule could tell from the name alone. One album per request, at
   * MusicBrainz's pace; an album it fails on is asked again next time.
   */
  fetchSortNames: async (): Promise<number> => {
    let fetched = 0;
    for (const { id, releaseId } of await ShelfItem.albumIdsWithoutSort()) {
      try {
        const credits = await musicbrainzService.getReleaseArtistCredits(releaseId);
        const first = credits[0];
        await ShelfItem.saveArtistSort(id, first?.sortName || null, first?.type || null);
        fetched += 1;
      } catch (error) {
        logger.warn(`Sort name of album ${id}: ${(error as Error).message}`);
      }
    }
    return fetched;
  },

  /** Fetches the missing sort names soon after start, then every few hours for the CDs added since. */
  startSortNameSync: (): void => {
    const tick = () => {
      shelvingService.fetchSortNames()
        .then(count => { if (count) logger.info(`Fetched the sort names of ${count} albums`); })
        .catch(error => logger.warn(`Sort names sync failed: ${(error as Error).message}`));
    };
    setTimeout(tick, 2 * 60 * 1000).unref();
    setInterval(tick, 6 * 60 * 60 * 1000).unref();
  },
};

export default shelvingService;
