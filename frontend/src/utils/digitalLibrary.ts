import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import musicService, { type DigitalAlbum, type DigitalLibrary, type EditionAdoption } from '../services/musicService';
import { readStored, writeStored } from './safeStorage';
import { isAppleMobile } from './navidrome';
import { LISTEN_NEXT_CHANGED_EVENT } from '../components/useAlbumAtRest';

/**
 * The music as files, in Navidrome, as MusicDex shows it with Digital on:
 * how good each album's files are, which album of DexVault it is, and whether
 * to buy its CD. Kept while the app is open and in the browser, so coming
 * back shows it at once, brought up to date behind it.
 */

/** A full sync rereads Navidrome and takes editions from the rips: on coming back, at most this often. */
const SYNC_EVERY_MS = 5 * 60 * 1000;

/** Digital on or off in MusicDex, remembered in the browser: the search and its suggestions follow it. */
export const DIGITAL_ON_KEY = 'dexvault-musicdex-digital';
export const isDigitalOn = (): boolean => readStored(DIGITAL_ON_KEY) === '1';
const STORED_KEY = 'dexvault.digital';

interface DigitalState {
  library: DigitalLibrary | null;
  syncedAt: number;
  syncing: boolean;
  error: string | null;
  editions: EditionAdoption[];
}

const readStoredLibrary = (): Pick<DigitalState, 'library' | 'syncedAt'> => {
  try {
    const value = JSON.parse(readStored(STORED_KEY) || 'null');
    return value && Array.isArray(value.library?.albums) ? { library: value.library, syncedAt: Number(value.syncedAt) || 0 } : { library: null, syncedAt: 0 };
  } catch {
    return { library: null, syncedAt: 0 };
  }
};

let state: DigitalState = { syncing: false, error: null, editions: [], ...readStoredLibrary() };
const listeners = new Set<() => void>();

const set = (change: Partial<DigitalState>) => {
  state = { ...state, ...change };
  if (change.library?.configured) writeStored(STORED_KEY, JSON.stringify({ library: state.library, syncedAt: state.syncedAt }));
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** For tests: a library never read. */
export const forgetDigitalLibrary = () => {
  state = { library: null, syncedAt: 0, syncing: false, error: null, editions: [] };
};

const load = async () => {
  try {
    set({ library: await musicService.getDigitalLibrary(), error: null });
  } catch (error) {
    set({ error: (error as Error).message });
  }
};

/**
 * Rereads Navidrome: the plays since, CDs ripped since, the editions Picard
 * identified them as, new digital albums. Answers what went wrong, null when all went well.
 */
const sync = async (): Promise<string | null> => {
  if (state.syncing) return null;
  set({ syncing: true });
  try {
    const result = await musicService.syncDigitalLibrary();
    set({ library: result.library, syncedAt: Date.now(), editions: result.editions.filter(edition => !edition.skipped), error: null });
    // A CD found from its rip, added or come off the wish list, is at the end of Listen Next: its banner reads it again.
    if (result.editions.some(edition => edition.action === 'added' || edition.action === 'promoted')) {
      window.dispatchEvent(new Event(LISTEN_NEXT_CHANGED_EVENT));
    }
  } catch (error) {
    set({ error: (error as Error).message });
  } finally {
    set({ syncing: false });
  }
  return state.error;
};

/** Puts in the library the album the server answered a change with. */
const replace = (updated: DigitalAlbum) => {
  if (!state.library) return;
  set({ library: { ...state.library, albums: state.library.albums.map(album => (album.navidromeId === updated.navidromeId ? updated : album)) } });
};

/** How an album of DexVault stands in Navidrome. */
export interface AlbumDigital {
  /** Its copy in Navidrome; null for a CD not ripped. */
  album: DigitalAlbum | null;
  notRipped: boolean;
}

/**
 * The digital library, read when `enabled` and kept in step: the library at
 * once, then a full sync unless one ran a few minutes ago.
 */
export const useDigitalLibrary = (enabled: boolean) => {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled) return;
    load().then(() => { if (Date.now() - state.syncedAt > SYNC_EVERY_MS) sync(); });
  }, [enabled]);

  const byAlbumId = useMemo(() => {
    const map = new Map<number, AlbumDigital>();
    for (const album of current.library?.albums || []) {
      if (album.albumId !== null && !map.has(album.albumId)) map.set(album.albumId, { album, notRipped: false });
    }
    for (const album of current.library?.physicalOnly || []) map.set(album.id, { album: null, notRipped: true });
    return map;
  }, [current.library]);

  /** Runs a change on one album and keeps the album the server answers with. */
  const change = useCallback(async (action: () => Promise<DigitalAlbum>) => {
    try {
      replace(await action());
    } catch (error) {
      set({ error: (error as Error).message });
    }
  }, []);

  return { ...current, byAlbumId, sync, reload: load, change };
};

/** A search on ricardo.ch for these words, without what a digital title adds: "(Remastered)", "[Disc 1]". */
export const ricardoSearchUrl = (words: string): string => {
  const plain = words.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return `https://www.ricardo.ch/fr/s/${encodeURIComponent(plain)}/`;
};

/**
 * Opens a Ricardo search. On an iPhone or an iPad it goes in the same tab: iOS hands the link to
 * Ricardo's app, and DexVault stays as it was; a tab of its own would stay behind, blank, once the
 * app took the link. Elsewhere it opens in a tab of its own.
 */
export const openRicardo = (url: string): void => {
  if (isAppleMobile()) window.location.assign(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};

/** A search for the CD on ricardo.ch. */
export const ricardoUrl = (album: Pick<DigitalAlbum, 'artist' | 'name'>): string =>
  ricardoSearchUrl(`${album.artist} ${album.name}`);

const LOSSLESS_FORMATS = ['FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'WV'];

/** "MP3 128": the compressed formats and their bitrate; "FLAC" or "FLAC 24-bit" for lossless files. */
export const formatLabel = (album: DigitalAlbum): string => {
  if (album.quality !== 'lossy') {
    const lossless = album.formats.filter(format => LOSSLESS_FORMATS.includes(format)).join('+') || 'Lossless';
    if (album.quality === 'lossless') return album.hiRes ? `${lossless} hi-res` : lossless;
  }
  const format = album.formats.filter(format => !LOSSLESS_FORMATS.includes(format)).join('+') || 'Lossy';
  return album.bitRate ? `${format} ${album.bitRate}` : format;
};

/** Near-lossless counts as lossless: only a copy below 256 kbps is one to do again. */
export const isLossy = (album: DigitalAlbum | null | undefined): boolean => album?.quality === 'lossy';

/** "12.10": the day of a play, as the page says it. */
const shortDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' });
};

/** "43 plays · 3 in 90 days": how often a track was heard, ever and lately. */
export const playsText = ({ totalPlays, plays }: { totalPlays: number; plays: number }): string =>
  `${totalPlays} play${totalPlays === 1 ? '' : 's'} · ${plays > 0 ? plays : 'none'} in 90 days`;

/** Why an album is worth buying, in a few words: "5 tracks ×2+ · 12.10 · ★4". */
export const buyReason = (album: DigitalAlbum): string => {
  const { listening } = album;
  const last = shortDate(listening.lastPlayed);
  return [
    album.buy?.listened ? `${listening.favourites} tracks ×2+${last ? ` · ${last}` : ''}` : null,
    album.rating >= 4 ? `★${album.rating}` : null,
    album.starred ? '♥' : null,
    album.favouriteTracks > 0 && !album.starred && album.rating < 4 ? `★ ${album.favouriteTracks} track${album.favouriteTracks > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');
};

/** Suggested by listening, as opposed to only wished. */
export const isSuggested = (album: DigitalAlbum | null | undefined): boolean => Boolean(album?.buy?.listened || album?.buy?.rated);

/** In Buy: suggested or wished, and not set aside unless wished. */
export const isToBuy = (album: DigitalAlbum | null | undefined): boolean => Boolean(album?.buy && (album.buy.wished || !album.dismissed));

/** Set aside with "Not interested": listening no longer puts it in Buy. */
export const isDismissed = (album: DigitalAlbum | null | undefined): boolean => Boolean(album?.buy && album.dismissed && !album.buy.wished);

/** Buy: what one listens to, the most recent plays first, then what is only wished. */
export const buyOrder = (a: DigitalAlbum, b: DigitalAlbum) =>
  Number(isSuggested(b)) - Number(isSuggested(a)) || b.listening.score - a.listening.score
  || a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
