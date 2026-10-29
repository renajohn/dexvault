import React, { useEffect, useSyncExternalStore } from 'react';
import StarRating, { type StarRatingProps, type StarWords } from './shared/StarRating';
import musicService from '../services/musicService';
import bookService from '../services/bookService';
import { ALBUM_RATED_EVENT, BOOK_RATED_EVENT } from '../services/ratedEvents';

/**
 * What an album's stars mean: what one does with it rather than how good it
 * is, so that they spread (most at 3, a handful at 5) instead of all going up.
 */
export const ALBUM_STAR_WORDS: Record<number, string> = {
  0: 'No stars',
  0.5: 'Not for me',
  1: 'Not really',
  1.5: 'Barely',
  2: 'Has its moments',
  2.5: 'Now and then',
  3: 'Glad I have it',
  3.5: 'Often',
  4: 'Love it',
  4.5: 'A favourite',
  5: 'Outstanding',
};

/** What a book's stars mean, as an album's: what the reading was, so that they spread. */
export const BOOK_STAR_WORDS: Record<number, string> = {
  0: 'No stars',
  0.5: 'Not for me',
  1: 'Not really',
  1.5: 'Barely',
  2: 'Has its moments',
  2.5: 'Fine',
  3: 'Glad I read it',
  3.5: 'A good read',
  4: 'Loved it',
  4.5: 'A favourite',
  5: 'Outstanding',
};

type Spread = Map<number, number>;

/**
 * How a kind of records' stars spread, read once, and again as stars are
 * given here (`event`): a store the stars of that kind share.
 */
const spreadStore = (readCounts: () => Promise<Array<{ stars: number; count: number }>>, event: string) => {
  let counts: Spread | null = null;
  let reading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const read = () => {
    reading ??= Promise.resolve().then(readCounts)
      .then(rows => {
        // By halves: a book's 4.2 of another time counts with the 4s.
        counts = new Map();
        rows.forEach(row => {
          const half = Math.round(Number(row.stars) * 2) / 2;
          counts!.set(half, (counts!.get(half) ?? 0) + row.count);
        });
        listeners.forEach(listener => listener());
      })
      .catch(() => undefined)
      .finally(() => { reading = null; });
    return reading;
  };
  const reread = () => { void read(); };
  const subscribe = (listener: () => void) => {
    if (listeners.size === 0) window.addEventListener(event, reread);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener(event, reread);
    };
  };
  return {
    useSpread: (): Spread | null => {
      const spread = useSyncExternalStore(subscribe, () => counts);
      useEffect(() => { if (!counts) void read(); }, []);
      return spread;
    },
    reset: () => { counts = null; reading = null; },
  };
};

const albums = spreadStore(() => musicService.getRatingCounts(), ALBUM_RATED_EVENT);
const books = spreadStore(() => bookService.getRatingCounts(), BOOK_RATED_EVENT);

/** For tests: the spreads forgotten. */
export const resetStarSpreads = () => { albums.reset(); books.reset(); };

/** "18 % of your rated albums": where a number of stars stands among the records of its kind rated. */
export const shareOf = (stars: number, spread: Spread | null, of = 'albums'): string | null => {
  if (!stars || !spread) return null;
  const total = [...spread.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  return `${Math.round(((spread.get(stars) ?? 0) / total) * 100)} % of your rated ${of}`;
};

/**
 * An album's stars: StarRating, its dial saying what the stars mean and how
 * many albums of the collection hold as many, to keep them spread.
 */
export const AlbumStarRating: React.FC<StarRatingProps> = props => {
  const spread = albums.useSpread();
  const describe: StarWords = stars => ({ words: ALBUM_STAR_WORDS[stars] ?? '', note: shareOf(stars, spread, 'albums') });
  return <StarRating {...props} describe={describe} />;
};

/** A book's stars, as an album's: its dial says what they mean, and how many books hold as many. */
export const BookStarRating: React.FC<StarRatingProps> = props => {
  const spread = books.useSpread();
  const describe: StarWords = stars => ({ words: BOOK_STAR_WORDS[stars] ?? '', note: shareOf(stars, spread, 'books') });
  return <StarRating {...props} describe={describe} />;
};
