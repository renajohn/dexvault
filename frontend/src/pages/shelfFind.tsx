import React from 'react';
import type { ShelvedItem } from '../services/shelvingService';

export const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const wordsOf = (query: string) => normalize(query).split(/\s+/).filter(Boolean);

/** Whether an object answers a search: every word in its name, title, subtitle or shelf ("A-3"). */
export const matches = (item: ShelvedItem, query: string): boolean => {
  const words = wordsOf(query);
  if (!words.length) return false;
  const text = normalize(`${item.sortName} ${item.title} ${item.subtitle} ${item.code || ''}`);
  return words.every(word => text.includes(word));
};

/** The words of a search in a name, in gold: accents and case do not count. */
export const highlight = (text: string, query: string): React.ReactNode => {
  const words = wordsOf(query);
  if (!words.length) return text;
  // Each letter as it is searched, and the letter of the text it came from.
  let flat = '';
  const from: number[] = [];
  Array.from(text).forEach((letter, index) => {
    for (const searched of normalize(letter)) { flat += searched; from.push(index); }
  });
  const letters = Array.from(text);
  const marked = new Array<boolean>(letters.length).fill(false);
  words.forEach(word => {
    for (let at = flat.indexOf(word); at >= 0; at = flat.indexOf(word, at + 1)) {
      for (let k = at; k < at + word.length; k++) marked[from[k]] = true;
    }
  });
  const parts: React.ReactNode[] = [];
  let start = 0;
  for (let index = 1; index <= letters.length; index++) {
    if (index === letters.length || marked[index] !== marked[start]) {
      const piece = letters.slice(start, index).join('');
      parts.push(marked[start] ? <mark key={start} className="shelf-match">{piece}</mark> : piece);
      start = index;
    }
  }
  return parts;
};

export const ordinal = (n: number) => {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

/** A small poster: TMDB's original size is several megabytes. */
export const thumbnail = (image: string | null): string | null => {
  if (!image) return null;
  if (image.includes('image.tmdb.org/t/p/original')) return image.replace('/t/p/original', '/t/p/w92');
  if (image.startsWith('http') || image.startsWith('/')) return image;
  return `/api/images/${image}`;
};

/** A search's result: the object, the tab it shows in and its name, and the place it is kept in when off the shelves. */
export interface Hit {
  item: ShelvedItem;
  tab: ShelvedItem['section'] | 'places';
  label: string;
  kept?: string;
}

export const keyOf = (item: ShelvedItem) => `${item.kind}:${item.id}`;

/** Where an object stands on its shelf: the nth from the left, of how many. */
export interface Place { nth: number; of: number }

/** Each shelved object's place on its shelf, counted in the order the section stands in. */
export const placesOf = (items: ShelvedItem[]): Map<string, Place> => {
  const byLevel = new Map<number, ShelvedItem[]>();
  items.forEach(item => {
    if (item.levelId != null) byLevel.set(item.levelId, [...(byLevel.get(item.levelId) || []), item]);
  });
  const places = new Map<string, Place>();
  byLevel.forEach(on => on.forEach((item, index) => places.set(keyOf(item), { nth: index + 1, of: on.length })));
  return places;
};
