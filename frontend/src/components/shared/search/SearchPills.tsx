import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BsDashCircle, BsPencil, BsPlus, BsPlusCircle, BsSearch, BsX } from 'react-icons/bs';
import Menu from '../Menu';
import Notice from '../Notice';
import Button from '../Button';
import { readStored, writeStored } from '../../../utils/safeStorage';
import {
  canonical, findKey, fitInRows, nameScore, norm, parseNumber, parseToken, quote, sayNumber, splitValues, tokenize,
} from './query';
import type { SearchGuess, SearchGuessGroup, SearchKey, SearchSchema, SuggestedValue } from './schema';
import '../menu.css';
import './search-pills.css';

/**
 * The search field of the header, in pills (docs/superpowers/specs/2026-10-22-search-pills-design.md,
 * the prototype's variant B). The search stays one string: the field reads it
 * into pills, one for each filter (`composer:Bach`), the plain words between
 * them, and what one does in it writes the string again.
 *
 * - A key typed (`composer:`, or `comp` and Tab) opens a pill; its value is typed in it.
 * - The likely rest of a key or a value shows grey after the caret: Tab or → takes it.
 * - In an open pill: `,` takes the value and adds another, a space goes on in a
 *   name of several words and ends the value otherwise, `!` first excludes,
 *   ⌫ on an empty value goes back, Esc leaves it as it was.
 * - A click on a pill's key opens its menu; on one of its values, the pill opens
 *   on it with every value its key can take.
 *
 * The string is handed to `onChange` as the pages took it before: at each
 * keystroke of plain words, but only once a pill is done, so that a value
 * half typed in a pill does not search the backend at each letter.
 */

export interface SearchPillsProps {
  value: string;
  onChange: (value: string) => void;
  schema: SearchSchema;
  placeholder?: string;
  /** The inner <input>: what the header focuses. */
  inputRef?: React.Ref<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  /** At the end of the field: the ✕ that empties it, the ▾ of the filters. */
  endAdornment?: React.ReactNode;
  /** Where the last searches of the section are kept (localStorage). */
  recentKey?: string;
  className?: string;
  /** The top of each element, for the "+N" of a long search; jsdom has no layout, its tests give their own. */
  measureTops?: (elements: HTMLElement[]) => number[];
}

interface Item {
  id: number;
  /** The word as the string writes it. */
  raw: string;
}

/** The pill open: its key found, its value typed in the field, the values before and after the one typed. */
interface OpenPill {
  at: number;
  neg: boolean;
  key: string;
  before: string[];
  after: string[];
  /** The value clicked, ✓ in the menu. */
  current: string | null;
  /** Every value the key takes, not only those the words typed contain. */
  showAll: boolean;
  /** The pill as it was, for Esc. */
  original: string | null;
  originalId: number | null;
}

interface Draft {
  items: Item[];
  /** What the <input> holds: plain words, or the value typed in the open pill. */
  text: string;
  open: OpenPill | null;
}

type Suggestion =
  | { kind: 'recent'; section: string; query: string; insert?: undefined }
  | { kind: 'word'; section: string; text: string; desc?: string; insert: string }
  | { kind: 'key'; section: string; def: SearchKey; neg: boolean; desc: string; example?: string; insert: string }
  | { kind: 'value'; section: string; def: SearchKey; neg: boolean; value: string; desc?: string; count?: number; insert: string; score?: number }
  | { kind: 'guess'; section: string; group: OpenGroup; guess: SearchGuess; desc?: string; score: number; insert?: undefined }
  | { kind: 'pillValue'; section: string; value: string; desc?: string; count?: number; checked: boolean; insert?: undefined };

type OpenGroup = Extract<SearchGuessGroup, { kind: 'open' }>;

/** A guess good enough to write its name grey after the letters: its name or one of its words begins with them. */
const GHOST_SCORE = 70;
/** How long the empty field waits before its menu of filters shows (ms). */
const IDLE_MENU_DELAY = 2000;

/** Whether a line is one of the guesses (a thing to open, a person to make a pill of). */
const isGuess = (s: Suggestion): boolean => s.kind === 'guess' || (s.kind === 'value' && s.score != null);

/** How well a guess names the letters typed; 0 for what is not a guess. */
const scoreOf = (s: Suggestion): number => (s.kind === 'guess' || s.kind === 'value' ? s.score ?? 0 : 0);

const RECENT_MAX = 5;
const MAX_ROWS_AT_REST = 2;

const readRecent = (key?: string): string[] => {
  if (!key) return [];
  try {
    const list = JSON.parse(readStored(key) || '[]');
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

const quotesOpen = (s: string) => (s.match(/"/g) || []).length % 2 === 1;

/** A value put back in the field to be typed again: between quotes when a comma in it would cut it. */
const asTyped = (v: string) => (v.includes(',') ? `"${v}"` : v);

/** What is typed in a pill, cut at the commas outside quotes: `"B minor, Op. 104",Bach` is two values. */
const splitTyped = (s: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const c of s) {
    if (c === '"') inQuotes = !inQuotes;
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
};

/** The open pill as the string writes it, with the value being typed. */
const pillRaw = (open: OpenPill, text: string): string => {
  const values = [...open.before, text.trim().replace(/"/g, ''), ...open.after].filter(Boolean);
  return values.length ? `${open.neg ? '-' : ''}${open.key}:${values.map(quote).join(',')}` : '';
};

/** The whole search as a string. */
export const queryOf = (d: Draft): string => {
  const parts = d.items.map(i => i.raw);
  if (d.open) {
    const raw = pillRaw(d.open, d.text);
    if (raw) parts.splice(d.open.at, 0, raw);
  } else {
    parts.push(d.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

/** The word being typed: the last one, when nothing follows it. */
const currentWord = (text: string) => {
  const tokens = tokenize(text);
  const last = tokens[tokens.length - 1];
  return last && last.end === text.length ? last : { text: '', start: text.length, end: text.length };
};

const withCode = (msg: string) => msg.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

const SearchPills: React.FC<SearchPillsProps> = ({
  value, onChange, schema, placeholder, inputRef, onFocus, onBlur, endAdornment, recentKey, className = '', measureTops,
}) => {
  const keys = schema.keys;
  const nextId = useRef(1);
  const fromQuery = useCallback((q: string): Draft => ({
    items: tokenize(q).map(t => ({ id: nextId.current++, raw: canonical(parseToken(t.text, keys)) })),
    text: '',
    open: null,
  }), [keys]);

  const [draft, setDraft] = useState<Draft>(() => fromQuery(value));
  const draftRef = useRef(draft);
  const lastEmitted = useRef(value);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [menuShown, setMenuShown] = useState(false);
  // The line lit by the arrows (`keys`) or under the pointer: only the arrows choose what Enter, a space or a comma take.
  const [nav, setNav] = useState<{ ctx: string; index: number; keys: boolean } | null>(null);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [keyMenus, setKeyMenus] = useState(0);
  const [wordValues, setWordValues] = useState<{ word: string; found: Array<{ def: SearchKey; value: string; count?: number }> } | null>(null);
  const [pillValues, setPillValues] = useState<{ key: string; values: SuggestedValue[] } | null>(null);
  const [guessed, setGuessed] = useState<{ word: string; found: Array<{ group: OpenGroup; guess: SearchGuess }> } | null>(null);
  const guessCache = useRef(new Map<string, Promise<SearchGuess[]>>());
  const [recent, setRecent] = useState<string[]>(() => readRecent(recentKey));
  const cache = useRef(new Map<string, Promise<SuggestedValue[]>>());
  const pendingFocus = useRef<'end' | 'all' | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  /** The pill whose key menu opens once it is closed: its key clicked while it was open. */
  const pendingKeyMenu = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const setInput = useCallback((el: HTMLInputElement | null) => {
    inputEl.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  }, [inputRef]);

  const emit = useCallback((d: Draft) => {
    const q = queryOf(d);
    if (q === lastEmitted.current) return;
    lastEmitted.current = q;
    onChange(q);
  }, [onChange]);

  /** Sets what the field holds; `emit` hands the string on, `focus` puts the caret back in the field. */
  const apply = useCallback((next: Draft, { emit: send = false, focus, menu }: { emit?: boolean; focus?: 'end' | 'all'; menu?: boolean } = {}) => {
    draftRef.current = next;
    setDraft(next);
    if (focus) pendingFocus.current = focus;
    if (menu !== undefined) setMenuShown(menu);
    if (send) emit(next);
  }, [emit]);

  // A string set from outside (a link, an actor clicked, the ▾ filters, another section): pills again.
  useLayoutEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    apply(fromQuery(value));
  }, [value, fromQuery, apply]);

  // Another section: its keys, its recent searches, nothing remembered of the last one's values.
  const firstSchema = useRef(true);
  useLayoutEffect(() => {
    if (firstSchema.current) { firstSchema.current = false; return; }
    cache.current.clear();
    guessCache.current.clear();
    setWordValues(null);
    setPillValues(null);
    setGuessed(null);
    setRecent(readRecent(recentKey));
    lastEmitted.current = value;
    apply(fromQuery(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, recentKey]);

  const ask = useCallback((def: SearchKey, typed: string): Promise<SuggestedValue[]> => {
    if (!def.suggest) return Promise.resolve([]);
    const id = `${def.key}\u0000${norm(typed)}`;
    let found = cache.current.get(id);
    if (!found) {
      found = def.suggest(typed).catch(() => []);
      cache.current.set(id, found);
    }
    return found;
  }, []);

  const rememberSearch = useCallback((q: string) => {
    if (!recentKey || !q) return;
    setRecent(old => {
      const list = [q, ...old.filter(r => r !== q)].slice(0, RECENT_MAX);
      writeStored(recentKey, JSON.stringify(list));
      return list;
    });
  }, [recentKey]);

  const { items, text, open } = draft;
  const openDef = open ? findKey(open.key, keys) : undefined;
  const word = open ? '' : currentWord(text).text;
  const wordBody = word.replace(/^[-!]/, '');
  const typedInPill = open ? (open.showAll ? '' : text.trim().replace(/"/g, '')) : null;

  // The values of the key of the open pill, from the collection.
  useEffect(() => {
    if (!open || !focused || !openDef?.suggest || typedInPill === null) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      ask(openDef, typedInPill).then(values => { if (live) setPillValues({ key: openDef.key, values }); });
    }, typedInPill ? 120 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [open?.key, typedInPill, focused, openDef, ask]); // eslint-disable-line react-hooks/exhaustive-deps

  // A word typed: the values of every key that contain it (bach → composer:Bach).
  useEffect(() => {
    if (open || !focused || wordBody.length < 2 || /[:"]/.test(wordBody)) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      const searched = keys.filter(k => (k.type === 'text' || k.type === 'list') && k.suggest && k.valuesForWords !== false);
      Promise.all(searched.map(def => ask(def, wordBody).then(values => values.map(v => ({ def, value: v.value, count: v.count })))))
        .then(lists => {
          if (!live) return;
          const want = norm(wordBody);
          const found = lists.flat().filter(f => norm(f.value).includes(want))
            .sort((a, b) => (norm(a.value).startsWith(want) ? 0 : 1) - (norm(b.value).startsWith(want) ? 0 : 1));
          setWordValues({ word: norm(wordBody), found });
        });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [open, focused, wordBody, keys, ask]);

  // A word typed: the things it may name (an album, a movie), to open.
  const openGroups = (schema.guesses || []).filter((g): g is OpenGroup => g.kind === 'open');
  useEffect(() => {
    if (open || !focused || wordBody.length < 2 || /[:"]/.test(wordBody) || !openGroups.length) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      Promise.all(openGroups.map(group => {
        const id = `${group.section}\u0000${norm(wordBody)}`;
        let found = guessCache.current.get(id);
        if (!found) {
          found = group.find(wordBody).catch(() => []);
          guessCache.current.set(id, found);
        }
        return found.then(list => list.map(guess => ({ group, guess })));
      })).then(lists => { if (live) setGuessed({ word: norm(wordBody), found: lists.flat() }); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [open, focused, wordBody, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------ the menu */

  /**
   * What the letters may name, each group under its heading, best first, and
   * the group holding the best one first: Artists before Albums for "bea",
   * Albums first for "abbey".
   */
  const guessGroups = (body: string, b: string): Suggestion[] => {
    const groups = (schema.guesses || []).map(group => {
      const list: Suggestion[] = group.kind === 'pill'
        ? (wordValues && wordValues.word === b ? wordValues.found : [])
          .filter(f => group.keys.includes(f.def.key))
          .map(f => ({
            kind: 'value' as const, section: group.section, def: f.def, neg: false, value: f.value, count: f.count,
            insert: `${f.def.key}:${quote(f.value)}`, score: nameScore(body, f.value) + Math.min(6, (f.count || 0) * 2),
          }))
        : (guessed && guessed.word === b ? guessed.found : [])
          .filter(f => f.group === group)
          .map(f => ({ kind: 'guess' as const, section: group.section, group, guess: f.guess, desc: f.guess.sub, score: nameScore(body, f.guess.label) }));
      const ranked = list
        .filter(sg => scoreOf(sg) > 0)
        .sort((x, y) => scoreOf(y) - scoreOf(x))
        .slice(0, group.kind === 'pill' ? 4 : 5);
      return { ranked, best: ranked.length ? scoreOf(ranked[0]) : 0 };
    });
    return groups.sort((x, y) => y.best - x.best).flatMap(g => g.ranked);
  };

  const freeSuggestions = (): Suggestion[] => {
    const neg = /^[-!]/.test(word);
    const sign = neg ? word[0] : '';
    const body = neg ? word.slice(1) : word;
    if (/^[A-Za-z_]+:/.test(body)) return [];
    const out: Suggestion[] = [];
    if (body === '') {
      if (!neg && !text.trim() && !items.length) for (const q of recent) out.push({ kind: 'recent', section: 'Recent', query: q });
      for (const def of keys) {
        out.push({
          kind: 'key', section: def.group, def, neg, desc: def.desc, insert: `${sign}${def.key}:`,
          example: def.example || (def.type === 'bool' ? `${def.key}:yes · ${def.key}:no` : undefined),
        });
      }
      return out;
    }
    const b = norm(body);
    const guesses = !neg && b.length >= 2 ? guessGroups(body, b) : [];
    out.push(...guesses);
    if (!neg) out.push({ kind: 'word', section: 'Words', text: body, desc: schema.wordsHint, insert: body });
    for (const def of keys) {
      if (norm(def.key).startsWith(b) || (def.aliases || []).some(a => norm(a).startsWith(b))) {
        out.push({ kind: 'key', section: 'Filters', def, neg, desc: def.desc, insert: `${sign}${def.key}:` });
      }
    }
    if (wordValues && wordValues.word === b) {
      // The values the guesses do not show already.
      const guessedKeys = new Set(guesses.length ? (schema.guesses || []).flatMap(g => (g.kind === 'pill' ? g.keys : [])) : []);
      for (const f of wordValues.found.filter(v => !guessedKeys.has(v.def.key)).slice(0, 8)) {
        out.push({ kind: 'value', section: 'Values', def: f.def, neg, value: f.value, desc: f.def.desc, count: f.count, insert: `${sign}${f.def.key}:${quote(f.value)}` });
      }
    }
    return out;
  };

  /** Every value the open pill's key can take, the words typed filtering them, its other values left out. */
  const pillSuggestions = (): Suggestion[] => {
    if (!open || !openDef) return [];
    const def = openDef;
    const typed = norm(typedInPill || '');
    const others = [...open.before, ...open.after].map(norm);
    const out: SuggestedValue[] = [];
    const push = (v: SuggestedValue) => {
      const n = norm(v.value);
      if (!others.includes(n) && !out.some(o => norm(o.value) === n)) out.push(v);
    };
    const first = (list: SuggestedValue[]) => [...list].sort((a, b) => (norm(a.value).startsWith(typed) ? 0 : 1) - (norm(b.value).startsWith(typed) ? 0 : 1));
    if (def.type === 'bool') {
      (def.values || [{ value: 'yes' }, { value: 'no' }]).filter(v => norm(v.value).startsWith(typed)).forEach(push);
    } else if (def.type === 'enum') {
      first((def.values || []).filter(v => norm(v.value).includes(typed))).forEach(push);
    } else if (def.type === 'number' || def.type === 'date') {
      const n = def.type === 'number' && typed ? parseNumber(typed) : null;
      const listed = [...(def.values || []), ...(def.shortcuts || [])];
      if (n && !listed.some(v => v.value === typed)) push({ value: text.trim(), desc: sayNumber(n) });
      listed.filter(v => !typed || norm(v.value).startsWith(typed)).forEach(push);
    } else {
      const found = pillValues?.key === def.key ? pillValues.values : [];
      first([...(def.values || []), ...found].filter(v => norm(v.value).includes(typed))).forEach(push);
    }
    // The value typed, when the key has it, first: the line lit and the one Tab takes.
    const exact = typed ? out.findIndex(o => norm(o.value) === typed) : -1;
    if (exact > 0) out.unshift(...out.splice(exact, 1));
    if (open.showAll && open.current && !out.some(o => norm(o.value) === norm(open.current!))) out.unshift({ value: open.current });
    const section = `${def.key} · ${open.showAll ? 'every value' : 'values'}`;
    return out.map(v => ({
      kind: 'pillValue', section, value: v.value, desc: v.desc, count: v.count,
      checked: open.current != null && norm(v.value) === norm(open.current),
    }));
  };

  const suggestions = open ? pillSuggestions() : freeSuggestions();

  /** The grey rest of what is typed: only with the caret at the end, so that nothing after it moves. */
  const ghost = ((): { item: Suggestion; rest: string; tag?: string } | null => {
    if (!focused || !caretAtEnd) return null;
    if (open) {
      if (open.showAll || !text.trim() || text.includes('"')) return null;
      const typed = norm(text);
      // A value the key has, typed in full: nothing to add, whatever begins like it.
      if (suggestions.some(s => s.kind === 'pillValue' && norm(s.value) === typed)) return null;
      // A number or a date typed is what it says: 4 is not the start of >=4.5, nor 196 of 1960-1969.
      if ((openDef?.type === 'number' || openDef?.type === 'date') && /^[\s<>=\d.-]/.test(text)) return null;
      for (const s of suggestions) {
        if (s.kind === 'pillValue' && norm(s.value).startsWith(typed) && s.value.length > text.length) return { item: s, rest: s.value.slice(text.length) };
      }
      return null;
    }
    if (!word || /^[-!]?$/.test(word)) return null;
    const typed = norm(word.replace(/"/g, ''));
    // The best guess: its name's rest, or an arrow to it when the letters are inside it (bea → The Beatles).
    // A key the letters begin (comp → composer:) wins over a name they do not begin.
    const best = suggestions[0];
    const bestScore = best ? scoreOf(best) : 0;
    const beginsKey = suggestions.some(s => s.kind === 'key');
    // Only while the menu shows it: after Esc, Enter keeps the letters.
    if (best && menuShown && bestScore >= GHOST_SCORE && !(beginsKey && bestScore < 100)) {
      const name = best.kind === 'guess' ? best.guess.label : best.kind === 'value' ? best.value : '';
      const tag = best.kind === 'guess' ? best.section.toLowerCase().replace(/s$/, '') : best.kind === 'value' ? best.def.key : undefined;
      const begins = norm(name).startsWith(typed) && norm(name).length === name.length && name.length > word.length;
      return { item: best, rest: begins ? name.slice(word.length) : `  → ${name}`, tag };
    }
    for (const s of suggestions) {
      if (!s.insert || s.insert === word) continue;
      const full = s.insert.replace(/"/g, '');
      if (norm(full).startsWith(typed) && full.length > typed.length) return { item: s, rest: full.slice(typed.length) };
    }
    return null;
  })();

  // The line lit: the one Tab takes, as the grey rest says; moved by the arrows until the words change.
  const ctx = JSON.stringify([open?.key ?? null, open?.at ?? null, open?.showAll ?? null, text]);
  const defaultIndex = (() => {
    if (ghost) return suggestions.indexOf(ghost.item);
    if (open?.showAll) return suggestions.findIndex(s => s.kind === 'pillValue' && s.checked);
    return text.trim() ? 0 : -1;
  })();
  const menuIndex = nav && nav.ctx === ctx ? nav.index : defaultIndex;
  // The field empty, the menu lists every filter: it would cover a phone's screen at each tap,
  // so it waits until the field has stood empty a while, and only before any pill (↓ opens it at once).
  const idle = !open && !text;
  const [idleShown, setIdleShown] = useState(false);
  useEffect(() => {
    setIdleShown(false);
    if (!focused || !idle || items.length) return undefined;
    const timer = window.setTimeout(() => setIdleShown(true), IDLE_MENU_DELAY);
    return () => window.clearTimeout(timer);
  }, [focused, idle, items.length]);
  const menuVisible = focused && menuShown && suggestions.length > 0 && (!idle || idleShown);

  // What the handlers read: the render's own view of the menu.
  const chosen = !!nav && nav.ctx === ctx && nav.keys;
  const view = useRef({ suggestions, menuIndex, ghost, menuVisible, chosen });
  view.current = { suggestions, menuIndex, ghost, menuVisible, chosen };

  /* --------------------------------------------------------- what is done */

  /** The words followed by a space become words of the search; `all`, every one. */
  const commitWords = (d: Draft, all: boolean): Draft => {
    const tokens = tokenize(d.text);
    const done = all ? tokens : tokens.filter(t => t.end < d.text.length || /\s$/.test(d.text));
    if (!done.length) return all ? { ...d, text: '' } : d;
    const added = done.map(t => ({ id: nextId.current++, raw: canonical(parseToken(t.text, keys)) }));
    return { ...d, items: [...d.items, ...added], text: all ? '' : d.text.slice(done[done.length - 1].end).trimStart() };
  };

  /** A key typed (composer:, !genre:) opens a pill on it, at the end. */
  const detectKey = (d: Draft): Draft => {
    if (d.open || tokenize(d.text).length > 1) return d;
    const m = d.text.match(/^([-!]?)([A-Za-z_]+):(.*)$/s);
    const def = m && findKey(m[2], keys);
    if (!m || !def) return d;
    const values = splitValues(m[3]);
    const typed = values.pop() ?? '';
    return {
      items: d.items,
      text: typed,
      open: { at: d.items.length, neg: !!m[1], key: def.key, before: values.filter(Boolean), after: [], current: null, showAll: false, original: null, originalId: null },
    };
  };

  /** The open pill closed into a pill like the others, at its place; empty, it goes. */
  const closePill = (d: Draft): Draft => {
    if (!d.open) return d;
    const raw = pillRaw(d.open, d.text);
    const list = [...d.items];
    if (raw) list.splice(d.open.at, 0, { id: d.open.originalId ?? nextId.current++, raw: canonical(parseToken(raw, keys)) });
    return { items: list, text: '', open: null };
  };

  const takeValue = (v: string) => {
    const d = draftRef.current;
    if (!d.open) return;
    // A comparison alone (>=) waits for its number.
    if ((openDef?.type === 'number' || openDef?.type === 'date') && /^[<>=]+$/.test(v)) {
      apply({ ...d, text: v, open: { ...d.open, showAll: false } }, { focus: 'end', menu: true });
      return;
    }
    apply(closePill({ ...d, text: v }), { emit: true, menu: true });
  };

  const take = (s: Suggestion) => {
    const d = draftRef.current;
    if (s.kind === 'pillValue') { takeValue(s.value); return; }
    // A thing guessed opens, the letters typed staying as they were.
    if (s.kind === 'guess') { setNav(null); setMenuShown(false); s.group.open(s.guess); return; }
    if (s.kind === 'recent') { apply(fromQuery(s.query), { emit: true, focus: 'end', menu: true }); return; }
    const tk = currentWord(d.text);
    const next = { ...d, text: d.text.slice(0, tk.start) + s.insert };
    if (s.kind === 'key') apply(detectKey(next), { emit: true, focus: 'end', menu: true });
    else apply(commitWords(next, true), { emit: true, focus: 'end', menu: true });
  };

  /** A guess's name written in full in place of the letters, as a pill: title:"Abbey Road", artist:"The Beatles". */
  const complete = (s: Suggestion) => {
    if (s.kind === 'value') { take(s); return; }
    if (s.kind !== 'guess') return;
    const d = draftRef.current;
    const tk = currentWord(d.text);
    setNav(null);
    const next = { ...d, text: d.text.slice(0, tk.start) + `${s.group.key}:${quote(s.guess.label)}` };
    apply(commitWords(next, true), { emit: true, focus: 'end', menu: true });
  };

  /** Opens the pill of an item on one of its values (`k`), or with a new value after them all (`k` null). */
  const reopen = (id: number, k: number | null) => {
    let d = closePill(draftRef.current);
    const i = d.items.findIndex(item => item.id === id);
    if (i < 0) return;
    const item = d.items[i];
    const t = parseToken(item.raw, keys);
    const list = d.items.filter(x => x.id !== id);
    if (!t.def || t.error || t.pending) {
      // Not a filter one can open: its words, to mend.
      apply({ items: list, text: item.raw, open: null }, { emit: true, focus: 'end', menu: true });
      return;
    }
    const values = (t.canon || t.values).map(String);
    const open: OpenPill = k === null
      ? { at: i, neg: t.neg, key: t.def.key, before: values, after: [], current: null, showAll: false, original: item.raw, originalId: item.id }
      : { at: i, neg: t.neg, key: t.def.key, before: values.slice(0, k), after: values.slice(k + 1), current: values[k], showAll: true, original: item.raw, originalId: item.id };
    d = { items: list, text: k === null ? '' : asTyped(values[k]), open };
    apply(d, { emit: true, focus: k === null ? 'end' : 'all', menu: true });
  };

  const removeItem = (id: number) => {
    const d = draftRef.current;
    const i = d.items.findIndex(item => item.id === id);
    if (i < 0) return;
    const open = d.open && i < d.open.at ? { ...d.open, at: d.open.at - 1 } : d.open;
    apply({ ...d, items: d.items.filter(item => item.id !== id), open }, { emit: true });
  };

  const toggleNeg = (id: number) => {
    const d = closePill(draftRef.current);
    apply({ ...d, items: d.items.map(item => (item.id === id ? { ...item, raw: item.raw.startsWith('-') ? item.raw.slice(1) : `-${item.raw}` } : item)) }, { emit: true, focus: 'end' });
  };

  const editWords = (id: number) => {
    const d = closePill(draftRef.current);
    const item = d.items.find(x => x.id === id);
    if (!item) return;
    apply({ items: d.items.filter(x => x.id !== id), text: item.raw.replace(/^-/, '!'), open: null }, { emit: true, focus: 'end', menu: true });
  };

  const fix = (id: number, words: string) => {
    const d = draftRef.current;
    apply({ ...d, items: d.items.map(item => (item.id === id ? { ...item, raw: canonical(parseToken(words, keys)) } : item)) }, { emit: true });
  };

  /* -------------------------------------------------------------- events */

  /** Whether a space goes on in a name of several words the key knows (Joni ⎵ Mitchell). */
  const goesOn = (typed: string) => {
    if (!openDef || (openDef.type !== 'text' && openDef.type !== 'list')) return false;
    const want = norm(`${typed.replace(/"/g, '')} `);
    return view.current.suggestions.some(s => s.kind === 'pillValue' && norm(s.value).startsWith(want))
      || (openDef.values || []).some(v => norm(v.value).startsWith(want));
  };

  /**
   * The value a comma, a space or Enter ends: a line chosen with the arrows, or
   * else the words as typed, in the key's spelling when it has them (rock is
   * Rock): "bach" stays bach, which finds every Bach, rather than the first
   * name that contains it, and >=4 stays >=4. Tab and → alone take the grey rest.
   */
  const proposed = (raw: string) => {
    const typed = raw.replace(/"/g, '').trim();
    const { suggestions: list, menuIndex: index, menuVisible: shown, chosen } = view.current;
    const lit = list[index];
    if (shown && chosen && typed && lit?.kind === 'pillValue') return lit.value;
    const same = list.find(s => s.kind === 'pillValue' && norm(s.value) === norm(typed));
    return same?.kind === 'pillValue' ? same.value : typed;
  };

  const onInputChange = (v: string) => {
    const d = draftRef.current;
    setNav(null);
    if (d.open) {
      const o = { ...d.open, showAll: false, before: [...d.open.before] };
      let t = v;
      // ! or - first: the pill excludes, or includes again.
      if (/^[-!]/.test(t) && o.before.length === 0) { o.neg = !o.neg; t = t.slice(1); }
      // A comma outside quotes: the value is done, another follows in the same pill.
      const parts = splitTyped(t);
      if (parts.length > 1) {
        t = parts.pop() || '';
        o.before.push(...parts.map(p => p.replace(/"/g, '').trim()).filter(Boolean));
      }
      // A space a phone's keyboard typed without telling its key: the value ends, as with the key.
      if (/\s$/.test(t) && !quotesOpen(t) && !goesOn(t.trim())) {
        const typed = t.trim().replace(/"/g, '');
        if (typed) { apply(closePill({ ...d, open: o, text: proposed(typed) }), { emit: true, menu: true }); return; }
        t = '';
      }
      // Quotes closed: they stay only around a comma, which they keep from cutting the value.
      if (!quotesOpen(t)) t = asTyped(t.replace(/"/g, ''));
      apply({ ...d, open: o, text: t }, { menu: true });
      return;
    }
    let next: Draft = { ...d, text: v };
    if (/\s$/.test(v) && !quotesOpen(v)) next = commitWords(next, false);
    apply(detectKey(next), { emit: true, menu: true });
  };

  const move = (e: React.KeyboardEvent, by: number) => {
    e.preventDefault();
    const { suggestions: list, menuIndex: index, menuVisible: shown } = view.current;
    if (!shown) { setMenuShown(true); setIdleShown(true); return; }
    const next = Math.max(-1, Math.min(list.length - 1, index + by));
    setNav({ ctx, index: next, keys: true });
  };

  const pillKeys = (e: React.KeyboardEvent<HTMLInputElement>, d: Draft, o: OpenPill) => {
    const input = e.currentTarget;
    const { ghost: g, suggestions: list, menuIndex: index, menuVisible: shown } = view.current;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if ((e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) && !e.shiftKey && g && g.item.kind === 'pillValue') {
      e.preventDefault();
      takeValue(g.item.value);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { move(e, e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (e.key === 'Tab' && e.shiftKey) return;
      e.preventDefault();
      const lit = list[index];
      if (e.key === 'Tab' && shown && lit?.kind === 'pillValue') takeValue(lit.value);
      else if (e.key === 'Enter' && d.text.trim()) takeValue(proposed(d.text.trim()));
      else if (e.key === 'Enter' && shown && view.current.chosen && lit?.kind === 'pillValue') takeValue(lit.value);
      else apply(closePill(d), { emit: true, menu: e.key === 'Tab' });
      if (e.key === 'Enter') { setMenuShown(false); rememberSearch(queryOf(closePill(draftRef.current))); }
      return;
    }
    if (e.key === ',' && !quotesOpen(d.text)) {
      e.preventDefault();
      const value = proposed(d.text.trim());
      if (!value) return;
      apply({ ...d, text: '', open: { ...o, before: [...o.before, value], showAll: false } }, { menu: true });
      setNav(null);
      return;
    }
    if (e.key === ' ' && !quotesOpen(d.text)) {
      // A space goes on in a name of several words, and ends the value otherwise.
      if (!goesOn(d.text.trim())) {
        e.preventDefault();
        if (d.text.trim()) takeValue(proposed(d.text.trim()));
      }
      return;
    }
    if (e.key === 'Backspace' && d.text === '' && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      setNav(null);
      if (o.before.length) {
        const before = [...o.before];
        const last = before.pop() || '';
        apply({ ...d, text: asTyped(last), open: { ...o, before, showAll: false } }, { focus: 'end', menu: true });
        return;
      }
      // Nothing left but the key: back to its words, to mend them.
      const list2 = [...d.items];
      if (o.after.length) list2.splice(o.at, 0, { id: nextId.current++, raw: `${o.neg ? '-' : ''}${o.key}:${o.after.map(quote).join(',')}` });
      apply({ items: list2, text: `${o.neg ? '!' : ''}${o.key}`, open: null }, { focus: 'end', menu: true });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (shown && !o.original) { setMenuShown(false); return; }
      // Leave it as it was.
      const list2 = [...d.items];
      if (o.original) list2.splice(o.at, 0, { id: o.originalId ?? nextId.current++, raw: o.original });
      apply({ items: list2, text: '', open: null }, { emit: true, menu: false });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const d = draftRef.current;
    const input = e.currentTarget;
    // ⌘⌫ empties the whole field, pills too, as the ✕ does.
    if (e.key === 'Backspace' && e.metaKey && (d.items.length || d.open || d.text)) {
      e.preventDefault();
      setNav(null);
      apply({ items: [], text: '', open: null }, { emit: true, focus: 'end', menu: true });
      return;
    }
    // ⌥⌫ with nothing typed: the last pill or word goes whole, where ⌫ opens it to mend.
    if (e.key === 'Backspace' && e.altKey && !d.open && d.text === '' && input.selectionStart === 0 && input.selectionEnd === 0 && d.items.length) {
      e.preventDefault();
      setNav(null);
      apply({ ...d, items: d.items.slice(0, -1) }, { emit: true, focus: 'end', menu: true });
      return;
    }
    if (d.open) { pillKeys(e, d, d.open); return; }
    const { ghost: g, suggestions: list, menuIndex: index, menuVisible: shown, chosen } = view.current;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    // A guess written grey: Enter takes it (a movie opens, an artist becomes a pill),
    // Tab or → makes a pill of its name (title:"A Good Day to Die Hard"), to search it.
    if (g && isGuess(g.item) && shown && !e.shiftKey) {
      if (e.key === 'Enter' && !chosen) {
        e.preventDefault();
        take(g.item);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) {
        e.preventDefault();
        complete(g.item);
        return;
      }
    }
    // Tab or → at the end takes the grey rest, as a shell does.
    if ((e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) && !e.shiftKey && g) {
      e.preventDefault();
      take(g.item);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { move(e, e.key === 'ArrowDown' ? 1 : -1); return; }
    // Tab takes the line lit; Enter, only a line chosen with the arrows: otherwise the words as typed.
    if ((e.key === 'Tab' || (e.key === 'Enter' && view.current.chosen)) && !e.shiftKey && shown && index >= 0 && list[index]) {
      e.preventDefault();
      take(list[index]);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && shown && d.text.trim() && list.length) {
      e.preventDefault();
      take(list[0]);
      return;
    }
    if (e.key === 'Escape') {
      if (shown) { e.preventDefault(); setMenuShown(false); }
      return;
    }
    if (e.key === 'Enter') {
      const next = commitWords(d, true);
      apply(next, { emit: true, menu: false });
      rememberSearch(queryOf(next));
      return;
    }
    if (e.key === 'Backspace' && d.text === '' && input.selectionStart === 0 && input.selectionEnd === 0 && d.items.length) {
      e.preventDefault();
      // The last pill opens again, its last value to mend.
      const last = d.items[d.items.length - 1];
      const rest = d.items.slice(0, -1);
      const t = parseToken(last.raw, keys);
      setNav(null);
      if (t.def && !t.error && !t.pending) {
        const values = (t.canon || t.values).map(String);
        apply({
          items: rest,
          text: asTyped(values[values.length - 1]),
          open: { at: rest.length, neg: t.neg, key: t.def.key, before: values.slice(0, -1), after: [], current: null, showAll: false, original: last.raw, originalId: last.id },
        }, { focus: 'end', menu: true });
      } else {
        apply({ items: rest, text: last.raw.replace(/^-/, '!'), open: null }, { focus: 'end', menu: true });
      }
    }
  };

  const noteCaret = (input: HTMLInputElement) => {
    setCaretAtEnd(input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
  };

  const handleFocus = (e: React.FocusEvent) => {
    // Focus coming through a portal (a pill's menu) is not the field's.
    if (!rootRef.current?.contains(e.target as Node) || focusedRef.current) return;
    focusedRef.current = true;
    setFocused(true);
    // The menu opens for the words alone: a button under the field (Use artist) must stay where it was clicked.
    setMenuShown(e.target === inputEl.current);
    cache.current.clear();
    guessCache.current.clear();
    onFocus?.();
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      if (!focusedRef.current || rootRef.current?.contains(document.activeElement)) return;
      focusedRef.current = false;
      setFocused(false);
      setMenuShown(false);
      setNav(null);
      // The pill open closes, the words typed become words of the search.
      const next = commitWords(closePill(draftRef.current), true);
      apply(next, { emit: true });
      rememberSearch(queryOf(next));
      onBlur?.();
    }, 0);
  };

  /** A click in the field's empty space: the pill open closes on what is typed, as Enter does, and the caret goes to the end. */
  const focusField = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .search-pill, .search-pills__word, .search-pills__end')) return;
    e.preventDefault();
    const d = draftRef.current;
    if (d.open && !target.closest('.search-pills__entry--open')) {
      setNav(null);
      apply(closePill(d), { emit: true, focus: 'end', menu: true });
      return;
    }
    pendingFocus.current = 'end';
    inputEl.current?.focus({ preventScroll: true });
  };

  /** The open pill's key clicked: the pill closes with its values, and its key's menu opens, as on a closed pill. */
  const openKeyMenu = () => {
    const d = draftRef.current;
    if (!d.open) return;
    const closed = closePill(d);
    if (pillRaw(d.open, d.text)) pendingKeyMenu.current = closed.items[d.open.at].id;
    setNav(null);
    apply(closed, { emit: true, menu: false });
  };

  /* ------------------------------------------------------- after a render */

  const expanded = focused || keyMenus > 0;
  // While a pill is written or a menu is open, the pills' tooltips would lie over the words being read: none then.
  const quiet = !!open || menuVisible || keyMenus > 0;

  // The caret back in the field, after a click that changed the pills.
  useLayoutEffect(() => {
    const how = pendingFocus.current;
    const input = inputEl.current;
    if (!how || !input) return;
    pendingFocus.current = null;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (how === 'all') input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    noteCaret(input);
  });

  // In use, the field shows where one types: it scrolls in itself past four rows.
  useLayoutEffect(() => {
    const content = contentRef.current;
    const entry = entryRef.current;
    if (!content || !entry) return;
    if (!expanded) { content.scrollTop = 0; return; }
    // A key's menu open, the field left: the pill it belongs to stays where it is.
    if (!focused) return;
    if (entry.offsetTop < content.scrollTop) content.scrollTop = entry.offsetTop - 4;
    else if (entry.offsetTop + entry.offsetHeight > content.scrollTop + content.clientHeight) {
      content.scrollTop = entry.offsetTop + entry.offsetHeight - content.clientHeight + 4;
    }
  }, [draft, expanded, focused]);

  // At rest, two rows at most: what does not fit is "+N", which opens the field.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const content = contentRef.current;
    const more = moreRef.current;
    if (!content || !more) return;
    const pills = Array.from(content.querySelectorAll<HTMLElement>('[data-pill]'));
    pills.forEach(el => el.classList.remove('is-hidden'));
    more.hidden = true;
    if (expanded || !pills.length) return;
    const tops = (els: HTMLElement[]) => (measureTops ? measureTops(els) : els.map(el => el.offsetTop));
    // A pill in two lines (a phone's) is taller than a row: what goes past the field's bottom does not fit either.
    const cut = (els: HTMLElement[]) => !measureTops && els.some(el => el.offsetTop + el.offsetHeight > content.clientHeight + 1);
    let shown = fitInRows(tops(pills), MAX_ROWS_AT_REST);
    if (shown >= pills.length && !cut(pills)) return;
    shown = Math.min(shown, pills.length - 1);
    const place = (count: number) => {
      pills.forEach((el, i) => el.classList.toggle('is-hidden', i >= count));
      more.hidden = false;
      more.textContent = `+${pills.length - count}`;
      more.style.order = String(2 * count - 1);
      more.title = `${pills.length - count} more`;
    };
    // "+N" after the last that fits, one fewer while it has no room on the second row itself.
    place(shown);
    while (shown > 0 && (fitInRows(tops([...pills.slice(0, shown), more]), MAX_ROWS_AT_REST) <= shown || cut([...pills.slice(0, shown), more]))) {
      shown -= 1;
      place(shown);
    }
  });
  void width;

  // Its key clicked while it was open: the pill, closed now, opens its key's menu.
  useLayoutEffect(() => {
    const id = pendingKeyMenu.current;
    if (id == null) return;
    pendingKeyMenu.current = null;
    const content = contentRef.current;
    const pillEl = content?.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
    if (!content || !pillEl) return;
    // In sight first: its menu opens under it.
    if (pillEl.offsetTop < content.scrollTop) content.scrollTop = pillEl.offsetTop - 4;
    pillEl.querySelector<HTMLButtonElement>('.search-pill__key')?.click();
  });

  // In use, the field keeps its height at rest in the page: the rows it grows by lie over what is under it.
  const restHeight = useRef(0);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const float = floatRef.current;
    if (!anchor || !float) return;
    if (!expanded) {
      anchor.style.height = '';
      float.classList.remove('is-over');
      restHeight.current = float.offsetHeight;
      return;
    }
    if (!restHeight.current) return;
    anchor.style.height = `${restHeight.current}px`;
    float.classList.toggle('is-over', float.offsetHeight > restHeight.current + 1);
  });

  /* -------------------------------------------------------------- render */

  const issues = items
    .map(item => ({ item, t: parseToken(item.raw, keys) }))
    .filter(({ t }) => t.error);

  const pill = (item: Item, i: number) => {
    const t = parseToken(item.raw, keys);
    const order = { order: 2 * i };
    if (t.kind === 'word' || t.pending) {
      return (
        <span key={item.id} data-pill className="search-pills__word" style={order} title="Edit the words"
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const d = closePill(draftRef.current);
            apply({ items: d.items.filter(x => x.id !== item.id), text: item.raw, open: null }, { emit: true, focus: 'end', menu: true });
          }}>{item.raw}</span>
      );
    }
    const key = t.def ? t.def.key : t.rawKey;
    const values = (t.canon || t.values).map(String);
    return (
      <span key={item.id} data-pill data-item-id={item.id} role="group" aria-label={`${t.neg ? 'Not ' : ''}${key}: ${values.join(' or ')}`}
        className={`search-pill${t.error ? ' search-pill--error' : ''}${t.neg ? ' search-pill--not' : ''}`} style={order}
        onMouseDown={e => e.preventDefault()}>
        {t.neg && <span className="search-pill__not" title="Not">!</span>}
        <Menu label={`The filter ${key}`} onOpenChange={on => setKeyMenus(n => Math.max(0, n + (on ? 1 : -1)))}
          trigger={props => (
            <button type="button" {...props} className="search-pill__key" title={t.error ? t.error.msg.replace(/`/g, '') : `${t.def?.desc}: exclude, add a value, edit or remove`}>{key}</button>
          )}>
          {t.def && (
            <Menu.Item icon={t.neg ? <BsPlusCircle /> : <BsDashCircle />} onSelect={() => toggleNeg(item.id)}>
              {t.neg ? 'Include it again' : 'Exclude it'}
            </Menu.Item>
          )}
          {t.def && !t.error && t.def.type !== 'bool' && (
            <Menu.Item icon={<BsPlus />} onSelect={() => reopen(item.id, null)}>Add another value…</Menu.Item>
          )}
          <Menu.Item icon={<BsPencil />} onSelect={() => editWords(item.id)}>Edit the words</Menu.Item>
          <Menu.Separator />
          <Menu.Item icon={<BsX />} danger onSelect={() => removeItem(item.id)}>Remove</Menu.Item>
        </Menu>
        {values.map((v, k) => (
          <React.Fragment key={k}>
            {k > 0 && <span className="search-pill__or">or</span>}
            <button type="button" className="search-pill__value" title={v} onClick={() => reopen(item.id, k)}>{v}</button>
          </React.Fragment>
        ))}
        <button type="button" className="search-pill__remove" aria-label={`Remove ${key}`} title="Remove" onClick={() => removeItem(item.id)}>
          <BsX aria-hidden="true" />
        </button>
      </span>
    );
  };

  const token = (s: Suggestion) => {
    switch (s.kind) {
      case 'recent': return (
        <span className="search-pills__recent" title={s.query}>
          {tokenize(s.query).map((tk, i) => {
            const t = parseToken(tk.text, keys);
            if (t.kind === 'word' || !t.values.length) return <span key={i} className="search-pills__recent-word">{tk.text}</span>;
            return (
              <span key={i} className="search-pills__tok">
                {t.neg && <span className="search-pill__not">!</span>}
                <span className="search-pill__key-text">{t.def ? t.def.key : t.rawKey}</span>
                {(t.canon || t.values).map(String).map((v, k) => (
                  <React.Fragment key={k}>{k > 0 && <span className="search-pill__or">or</span>}<span className="search-pills__tok-value">{v}</span></React.Fragment>
                ))}
              </span>
            );
          })}
        </span>
      );
      case 'word': return <span className="search-pills__tok search-pills__tok--plain">“{s.text}”</span>;
      case 'key': return <span className="search-pills__tok">{s.neg && <span className="search-pill__not">!</span>}<span className="search-pill__key-text">{s.def.key}</span></span>;
      case 'guess': return (
        <span className="search-pills__guess">
          {s.guess.image ? <img className="search-pills__thumb" src={s.guess.image} alt="" loading="lazy" /> : <span className="search-pills__thumb" aria-hidden="true" />}
          <span className="search-pills__guess-label">{s.guess.label}</span>
        </span>
      );
      case 'value': return <span className="search-pills__tok">{s.neg && <span className="search-pill__not">!</span>}<span className="search-pill__key-text">{s.def.key}</span><span className="search-pills__tok-value">{s.value}</span></span>;
      default: return <span className="search-pills__tok"><span className="search-pills__tok-value">{s.value}</span></span>;
    }
  };

  // The line lit kept in sight, within the menu alone: never the page.
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = menuRef.current;
    const lit = list?.querySelector<HTMLElement>('.menu-item--active');
    if (!list || !lit) return;
    if (lit.offsetTop < list.scrollTop) list.scrollTop = lit.offsetTop - 6;
    else if (lit.offsetTop + lit.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = lit.offsetTop + lit.offsetHeight - list.clientHeight + 6;
  }, [menuIndex, menuVisible, open?.key]);

  const menu = menuVisible && (
    <div ref={menuRef} className="menu-surface search-pills__menu" id={listId} role="listbox" aria-label="Suggestions" onMouseDown={e => e.preventDefault()}>
      {suggestions.map((s, i) => (
        <React.Fragment key={`${s.kind}-${i}`}>
          {(i === 0 || suggestions[i - 1].section !== s.section) && <div className="menu-section" role="presentation">{s.section}</div>}
          <div id={`${listId}-${i}`} role="option" aria-selected={false}
            className={`menu-item search-pills__option${i === menuIndex ? ' menu-item--active' : ''}`}
            onMouseMove={() => { if (i !== menuIndex) setNav({ ctx, index: i, keys: false }); }}
            onClick={() => take(s)}>
            {s.kind === 'pillValue' && <span className="search-pills__check" aria-hidden="true">{s.checked ? '✓' : ''}</span>}
            {token(s)}
            <span className="search-pills__desc">{'desc' in s ? s.desc : ''}</span>
            {s.kind === 'key' && s.example && <span className="search-pills__ex">{s.example}</span>}
            {'count' in s && s.count ? <span className="search-pills__count">{s.count}</span> : null}
          </div>
        </React.Fragment>
      ))}
      <div className="search-pills__foot" aria-hidden="true">
        {open ? (
          <>
            <span><kbd>Tab</kbd> take</span><span><kbd>,</kbd> another value: or</span><span><kbd>!</kbd> exclude</span>
            <span><kbd>⌫</kbd> on an empty value: back to the key</span><span><kbd>Esc</kbd> leave it as it was</span>
          </>
        ) : (
          <>
            <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
            {ghost && isGuess(ghost.item)
              ? <><span><kbd>↵</kbd> {ghost.item.kind === 'guess' ? 'open' : 'take'}</span><span><kbd>Tab</kbd> {ghost.item.kind === 'guess' ? 'search the title' : 'take'}</span></>
              : <span><kbd>Tab</kbd> take</span>}
            <span><kbd>!</kbd> before a filter excludes</span><span><kbd>,</kbd> between values: or</span>
          </>
        )}
      </div>
    </div>
  );

  const entryOrder = open ? 2 * open.at - 1 : 2 * items.length + 1;

  return (
    <div ref={rootRef} className={`search-pills${focused ? ' is-focused' : ''}${expanded ? ' is-expanded' : ''} ${className}`}
      onFocus={handleFocus} onBlur={handleBlur} data-tooltip-off={quiet || undefined}>
      <div ref={anchorRef} className="search-pills__anchor">
        <div ref={floatRef} className="search-pills__float">
          <div className="search-pills__field" onMouseDown={focusField}>
            <BsSearch className="search-pills__lens" aria-hidden="true" />
            <div ref={contentRef} className="search-pills__content">
              {items.map(pill)}
              <button ref={moreRef} type="button" className="search-pills__more" hidden
                onMouseDown={e => e.preventDefault()}
                onClick={() => { pendingFocus.current = 'end'; inputEl.current?.focus({ preventScroll: true }); }} />
              <span ref={entryRef} className={`search-pills__entry${open ? ' search-pills__entry--open' : ''}`} style={{ order: entryOrder }}>
                {open && (
                  <span className="search-pills__pre">
                    {open.neg && <span className="search-pill__not" title="Not">!</span>}
                    <button type="button" className="search-pill__key search-pills__open-key" title="Close it and open its menu"
                      onMouseDown={e => e.preventDefault()} onClick={openKeyMenu}>{open.key}</button>
                    {open.before.map((v, k) => (
                      <React.Fragment key={k}><span className="search-pills__open-value">{v}</span><span className="search-pill__or">or</span></React.Fragment>
                    ))}
                  </span>
                )}
                <span className="search-pills__typing">
                  <span className="search-pills__ghost" aria-hidden="true">
                    <span className="search-pills__typed">{text || (open ? '' : ' ')}</span>
                    {ghost && <><span className="search-pills__rest">{ghost.rest}</span>{ghost.tag && <span className="search-pills__ghost-tag">{ghost.tag}</span>}<kbd className="search-pills__tab">{isGuess(ghost.item) ? '↵' : 'tab'}</kbd></>}
                  </span>
                  <input
                    ref={setInput}
                    type="text"
                    className="search-pills__input"
                    value={text}
                    placeholder={!open && !items.length ? (placeholder ?? schema.placeholder) : ''}
                    aria-label={open ? `A value of ${open.key}` : 'Search'}
                    role="combobox"
                    aria-expanded={!!menuVisible}
                    aria-controls={menuVisible ? listId : undefined}
                    aria-autocomplete="list"
                    aria-activedescendant={menuVisible && menuIndex >= 0 ? `${listId}-${menuIndex}` : undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={e => { onInputChange(e.target.value); noteCaret(e.target); }}
                    onKeyDown={onKeyDown}
                    onSelect={e => noteCaret(e.currentTarget)}
                    onClick={() => setMenuShown(true)}
                  />
                </span>
                {open && open.after.length > 0 && (
                  <span className="search-pills__post">
                    {open.after.map((v, k) => (
                      <React.Fragment key={k}><span className="search-pill__or">or</span><span className="search-pills__open-value">{v}</span></React.Fragment>
                    ))}
                  </span>
                )}
              </span>
            </div>
            {endAdornment && <div className="search-pills__end">{endAdornment}</div>}
          </div>
          {menu}
        </div>
      </div>
      {issues.length > 0 && (
        <div className="search-pills__issues">
          {issues.map(({ item, t }) => (
            <Notice key={item.id} tone="danger" className="search-pills__issue"
              action={(
                <span className="search-pills__issue-actions">
                  {t.error?.fix && <Button size="sm" onClick={() => fix(item.id, t.error!.fix!)}>{t.error.fixLabel}</Button>}
                  <Button size="sm" variant="quiet" onClick={() => removeItem(item.id)}>Remove</Button>
                </span>
              )}>
              {withCode(t.error!.msg)}
            </Notice>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchPills;
