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
 * open; the album a cover opened in it, at rest, while another plays or
 * nothing does; and the one left for what plays, to go back to.
 */
interface PhoneDoorState {
  /** How many full-page music windows are open. */
  covered: number;
  full: boolean;
  shown: ShownAlbum | null;
  /** The album at rest left for what plays by its disc: a disc in the same place goes back to it. */
  left: ShownAlbum | null;
  /** A cover just touched: the full screen opens on the tracks, once they are read. */
  tracksAsked: boolean;
}

let state: PhoneDoorState = { covered: 0, full: false, shown: null, left: null, tracksAsked: false };
const listeners = new Set<() => void>();

const set = (changes: Partial<PhoneDoorState>) => {
  state = { ...state, ...changes };
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The full screen player opened (true) or back to the pill or the disc (false), the album shown at rest, or left, let go. */
export const setFullPlayer = (full: boolean) => {
  if (state.full !== full || (!full && (state.shown || state.left || state.tracksAsked))) {
    set(full ? { full } : { full, shown: null, left: null, tracksAsked: false });
  }
};

/** A cover touched on a phone: the full screen player, on that album (at rest, unless it is the one playing), its tracks shown. */
export const showAlbum = (album: ShownAlbum) => set({ full: true, shown: album, left: null, tracksAsked: true });

/** Back to what plays, the full screen staying open: the album shown played. */
export const showPlaying = () => { if (state.shown || state.left) set({ shown: null, left: null }); };

/** The disc of what plays touched: back to what plays, the album at rest kept to go back to (`useLeftAlbum`). */
export const leaveForPlaying = () => { if (state.shown) set({ shown: null, left: state.shown, tracksAsked: false }); };

/** Whether a cover asked the tracks the full screen has not shown yet. */
export const useTracksAsked = (): boolean => useSyncExternalStore(subscribe, () => state.tracksAsked);

/** The tracks asked by a cover are shown: the full screen is the owner's again. */
export const tracksShownAsAsked = () => { if (state.tracksAsked) set({ tracksAsked: false }); };

/** The album a cover opened in the full screen player, at rest; null for what plays. */
export const useShownAlbum = (): ShownAlbum | null => useSyncExternalStore(subscribe, () => state.shown);

/** The album at rest left for what plays, the full screen still open; null when there is none. */
export const useLeftAlbum = (): ShownAlbum | null => useSyncExternalStore(subscribe, () => state.left);

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
export const resetPhoneDoor = () => set({ covered: 0, full: false, shown: null, left: null, tracksAsked: false });
