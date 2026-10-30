import { useSyncExternalStore } from 'react';

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
 * What a phone's player shares with the page: whether the full screen player
 * is open; the album a cover opened in it, at rest, while another plays or
 * nothing does; and the one left for what plays, to go back to.
 */
interface PhoneDoorState {
  full: boolean;
  shown: ShownAlbum | null;
  /** The album at rest left for what plays by its disc: a disc in the same place goes back to it. */
  left: ShownAlbum | null;
  /** A cover just touched: the full screen opens on the tracks, once they are read. */
  tracksAsked: boolean;
  /** An album without a CD opened from Buy or the wish list: the full screen opens on its info. */
  infoAsked: boolean;
}

let state: PhoneDoorState = { full: false, shown: null, left: null, tracksAsked: false, infoAsked: false };
const listeners = new Set<() => void>();

const set = (changes: Partial<PhoneDoorState>) => {
  state = { ...state, ...changes };
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The full screen player opened (true) or back to the pill (false), the album shown at rest, or left, let go. */
export const setFullPlayer = (full: boolean) => {
  if (state.full !== full || (!full && (state.shown || state.left || state.tracksAsked))) {
    set(full ? { full } : { full, shown: null, left: null, tracksAsked: false, infoAsked: false });
  }
};

/** A cover touched on a phone: the full screen player, on that album (at rest, unless it is the one playing), its tracks shown; or its info. */
export const showAlbum = (album: ShownAlbum, view: 'tracks' | 'info' = 'tracks') =>
  set({ full: true, shown: album, left: null, tracksAsked: view === 'tracks', infoAsked: view === 'info' });

/** Back to what plays, the full screen staying open: the album shown played. */
export const showPlaying = () => { if (state.shown || state.left) set({ shown: null, left: null }); };

/** The disc of what plays touched: back to what plays, the album at rest kept to go back to (`useLeftAlbum`). */
export const leaveForPlaying = () => { if (state.shown) set({ shown: null, left: state.shown, tracksAsked: false }); };

/** Whether a cover asked the tracks the full screen has not shown yet. */
export const useTracksAsked = (): boolean => useSyncExternalStore(subscribe, () => state.tracksAsked);

/** The tracks asked by a cover are shown: the full screen is the owner's again. */
export const tracksShownAsAsked = () => { if (state.tracksAsked) set({ tracksAsked: false }); };

/** Whether an album was opened on its info, not shown yet. */
export const useInfoAsked = (): boolean => useSyncExternalStore(subscribe, () => state.infoAsked);
export const infoShownAsAsked = () => { if (state.infoAsked) set({ infoAsked: false }); };

/**
 * What the page under the player can do to an album, for the full screen's
 * info view: Edit, Delete, I bought the CD, the wish list, Not interested, a
 * side of the cover found, a filter of the grid. MusicDex says its own while
 * it shows, the wish list its own; none on another page.
 */
export interface AlbumManagement {
  edit?: (albumId: number) => void;
  delete?: (albumId: number) => Promise<void>;
  bought?: (albumId: number) => void;
  wish?: (albumId: number) => Promise<void>;
  dismiss?: (albumId: number, dismissed: boolean) => Promise<void>;
  /** Whether listening suggests buying it (Buy), or "Not interested" set it aside; null when it is not in Buy at all. */
  interest?: (albumId: number) => 'suggested' | 'dismissed' | null;
  coverChange?: (albumId: number, side: 'front' | 'back', coverPath: string) => void;
  search?: (predicate: string) => void;
}
let management: AlbumManagement | null = null;
const managementListeners = new Set<() => void>();
export const setAlbumManagement = (next: AlbumManagement | null) => {
  management = next;
  managementListeners.forEach(listener => listener());
};
/** Said by a page while it shows (in an effect, cleared as it goes). */
export const useAlbumManagement = (): AlbumManagement | null =>
  useSyncExternalStore(listener => { managementListeners.add(listener); return () => { managementListeners.delete(listener); }; }, () => management);

/** The album a cover opened in the full screen player, at rest; null for what plays. */
export const useShownAlbum = (): ShownAlbum | null => useSyncExternalStore(subscribe, () => state.shown);

/** The album at rest left for what plays, the full screen still open; null when there is none. */
export const useLeftAlbum = (): ShownAlbum | null => useSyncExternalStore(subscribe, () => state.left);

/** Whether the full screen player is open. */
export const useFullPlayer = (): boolean => useSyncExternalStore(subscribe, () => state.full);

/** For tests: the full screen closed. */
export const resetPhoneDoor = () => { set({ full: false, shown: null, left: null, tracksAsked: false, infoAsked: false }); setAlbumManagement(null); };
