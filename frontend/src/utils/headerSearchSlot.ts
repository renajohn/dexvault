import { createContext, useContext } from 'react';

/**
 * The place in the app's header where a page without the pills (the shelves)
 * puts a search of its own, through a portal: the same row as the other
 * sections' search. Null outside the app (a page tested alone), where the
 * page keeps its search in itself.
 */
export const HeaderSearchSlot = createContext<HTMLElement | null>(null);

export const useHeaderSearchSlot = () => useContext(HeaderSearchSlot);
