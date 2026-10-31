import { useEffect, useSyncExternalStore } from 'react';

/** An object to take from one shelf to another, or to put on its shelf when new. */
export interface ShelfMove {
  kind: 'movie' | 'album' | 'box_set';
  id: number;
  /** A CD's artist and title, "Ayọ – Joyful". */
  title: string;
  /** A CD's artist and its title alone, to name several of one artist once. */
  artist?: string;
  name?: string;
  /** Null for an object new to the collection. */
  from: string | null;
  /** Null when the shelves have no more room for it. */
  to: string | null;
  /** What it stands next to there: the one before it, or the one after when it is first. */
  after?: string | null;
  before?: string | null;
  /** The shelf it goes on, when it is one the owner fills step by step. */
  toLevelId?: number | null;
}

/** Where a CD stands in the shelves' order: the name it is filed under and the key that orders it. */
export interface AlbumOrder {
  sortName: string;
  key: string;
}

interface Locations {
  movies: Record<number, string>;
  albums: Record<number, string>;
  albumOrder?: Record<number, AlbumOrder>;
  moves?: ShelfMove[];
}

const NO_MOVES: ShelfMove[] = [];
const NO_ORDER: Record<number, AlbumOrder> = {};

/** Fetched again when a page asks after this long, so a CD added since gets its shelf. */
const STALE_MS = 30 * 1000;

let locations: Locations | null = null;
let fetchedAt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Rereads where each film and CD is: after the shelves change, or when the copy at hand is old. */
export function refreshShelfLocations(): Promise<void> {
  if (pending) return pending;
  pending = fetch('/api/shelving/locations')
    .then(response => (response.ok ? response.json() : null))
    .then((body: Locations | null) => {
      if (body) {
        locations = body;
        fetchedAt = Date.now();
        listeners.forEach(listener => listener());
      }
    })
    .catch(() => undefined)
    .finally(() => { pending = null; });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * The shelf a film or CD stands on, "B-3", or the place it is kept in; null
 * while unknown or when the furniture has no shelf for it. One copy for the
 * whole app, so a grid of hundreds of cards asks the server once.
 */
export function useShelfLocation(kind: 'movie' | 'album', id: number | string | null | undefined): string | null {
  const current = useSyncExternalStore(subscribe, () => locations);
  useEffect(() => {
    if (Date.now() - fetchedAt > STALE_MS) refreshShelfLocations();
  }, []);
  if (id == null || !current) return null;
  return (kind === 'movie' ? current.movies : current.albums)[Number(id)] ?? null;
}

/**
 * The order the CDs stand in on the shelves, by album id: the collection
 * sorts by artist the same way, "Chapman, Tracy" at C and "-M-" at M.
 */
export function useAlbumOrder(): Record<number, AlbumOrder> {
  const current = useSyncExternalStore(subscribe, () => locations);
  useEffect(() => {
    if (Date.now() - fetchedAt > STALE_MS) refreshShelfLocations();
  }, []);
  return current?.albumOrder ?? NO_ORDER;
}

/** What the owner has to move on the shelves since they last put them in order. */
export function useShelfMoves(): ShelfMove[] {
  const current = useSyncExternalStore(subscribe, () => locations);
  return current?.moves ?? NO_MOVES;
}

/** The owner made these moves: the shelves stand as the plan has them. */
export async function markMovesDone(moves: ShelfMove[]): Promise<void> {
  const response = await fetch('/api/shelving/moves/done', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves: moves.map(({ kind, id, to }) => ({ kind, id, to })) }),
  });
  if (!response.ok) throw new Error('The moves could not be recorded');
  await refreshShelfLocations();
}

/** The owner had not made these moves after all: they are listed again. */
export async function markMovesUndone(moves: ShelfMove[]): Promise<void> {
  const response = await fetch('/api/shelving/moves/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves: moves.map(({ kind, id, from }) => ({ kind, id, from })) }),
  });
  if (!response.ok) throw new Error('The moves could not be undone');
  await refreshShelfLocations();
}

const planListeners = new Set<() => void>();

/** The plan changed outside the shelves page, from the moves notice: the page reads it again. */
export function onShelvesChanged(listener: () => void): () => void {
  planListeners.add(listener);
  return () => { planListeners.delete(listener); };
}

export function shelvesChanged(): void {
  planListeners.forEach(listener => listener());
}

/** For tests: forget what was fetched. */
export function resetShelfLocations(): void {
  locations = null;
  fetchedAt = 0;
  pending = null;
}
