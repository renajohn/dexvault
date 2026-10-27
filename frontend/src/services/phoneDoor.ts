import { useEffect, useSyncExternalStore } from 'react';

/** An album as its card reads it (musicService.getAlbumById), for the full screen player to show at rest. */
export interface ShownAlbum {
  id: number | string;
  title: string;
  artist?: string | string[];
  cover?: string | null;
  format?: string;
  releaseYear?: string | number;
  titleStatus?: string;
  fileQuality?: string;
  discs?: Array<{ number: number; tracks: Array<{ no?: number | string; title: string; durationSec?: number }> }>;
}

/**
 * What a phone's player shares with the page: whether a record's card takes
 * the whole page, the player's pill then giving way to a disc at its foot;
 * whether the full screen player is open, which the pill and that disc both
 * open; and the album a cover opened in it, at rest, while another plays or
 * nothing does.
 */
interface PhoneDoorState {
  /** How many full-page music windows are open. */
  covered: number;
  full: boolean;
  shown: ShownAlbum | null;
}

let state: PhoneDoorState = { covered: 0, full: false, shown: null };
const listeners = new Set<() => void>();

const set = (changes: Partial<PhoneDoorState>) => {
  state = { ...state, ...changes };
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The full screen player opened (true) or back to the pill or the disc (false), the album shown at rest let go. */
export const setFullPlayer = (full: boolean) => {
  if (state.full !== full || (!full && state.shown)) set(full ? { full } : { full, shown: null });
};

/** A cover touched on a phone: the full screen player, on that album (at rest, unless it is the one playing). */
export const showAlbum = (album: ShownAlbum) => set({ full: true, shown: album });

/** Back to what plays, the full screen staying open: the disc of what plays touched. */
export const showPlaying = () => { if (state.shown) set({ shown: null }); };

/** The album a cover opened in the full screen player, at rest; null for what plays. */
export const useShownAlbum = (): ShownAlbum | null => useSyncExternalStore(subscribe, () => state.shown);

/** Whether the full screen player is open. */
export const useFullPlayer = (): boolean => useSyncExternalStore(subscribe, () => state.full);

/** Whether a music window takes the whole page: the pill then stays out of sight, its room given back. */
export const useCovered = (): boolean => useSyncExternalStore(subscribe, () => state.covered > 0);

/** Said by a music window while it takes the whole page (and `active`): the pill gives way to it. */
export const useCoversPlayer = (active = true) => {
  useEffect(() => {
    if (!active) return undefined;
    set({ covered: state.covered + 1 });
    return () => set({ covered: Math.max(0, state.covered - 1) });
  }, [active]);
};

/** For tests: nothing covered, the full screen closed. */
export const resetPhoneDoor = () => set({ covered: 0, full: false, shown: null });
