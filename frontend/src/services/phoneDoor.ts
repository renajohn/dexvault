import { useEffect, useSyncExternalStore } from 'react';

/**
 * What a phone's player shares with the music windows that take the whole
 * page (an album's sheet, a record's card): whether one of them is open, the
 * player's pill then giving way to a disc at their foot, and whether the full
 * screen player is open, which the pill and that disc both open.
 */
interface PhoneDoorState {
  /** How many full-page music windows are open: a card stacks over a sheet. */
  covered: number;
  full: boolean;
}

let state: PhoneDoorState = { covered: 0, full: false };
const listeners = new Set<() => void>();

const set = (changes: Partial<PhoneDoorState>) => {
  state = { ...state, ...changes };
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The full screen player opened (true) or back to the pill or the disc (false). */
export const setFullPlayer = (full: boolean) => {
  if (state.full !== full) set({ full });
};

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
export const resetPhoneDoor = () => set({ covered: 0, full: false });
