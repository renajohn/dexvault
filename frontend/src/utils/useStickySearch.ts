import { useEffect, type RefObject } from 'react';

/**
 * On a phone, a box holding a search (the app's header, the shelves' tabs and
 * search) scrolls away but for its search, which holds at the top of the
 * screen under the status bar: the box is sticky (`sticky-search`), pulled up
 * by all that stands above the search (`--sticky-tuck`, measured as it
 * changes). Held there, it is `sticky-search--stuck`, for its glass. Where its
 * foot then stands is said to the page (`--sticky-search-bottom` on the root),
 * for what scrolls to an element, or sticks itself, to stop under it. Not a
 * scroll-padding on the page: the search itself would be under it, and once
 * focused, the browser would scroll the page up to show it.
 */
export const useStickySearch = (boxRef: RefObject<HTMLElement | null>, searchRef: RefObject<HTMLElement | null>, enabled: boolean, page: string) => {
  useEffect(() => {
    const box = boxRef.current;
    const search = searchRef.current;
    // Left alone when off: another box (a page's own) may be saying where its foot stands.
    if (!enabled || !box || !search) return undefined;
    const root = document.documentElement;
    const stick = () => {
      // Held: it stands where its sticky top puts it, the page scrolled.
      const top = parseFloat(getComputedStyle(box).top) || 0;
      box.classList.toggle('sticky-search--stuck', window.scrollY > 0 && Math.abs(box.getBoundingClientRect().top - top) < 1);
    };
    const measure = () => {
      const tuck = Math.max(0, Math.round(search.getBoundingClientRect().top - box.getBoundingClientRect().top));
      box.style.setProperty('--sticky-tuck', `${tuck}px`);
      const top = parseFloat(getComputedStyle(box).top) || 0;
      root.style.setProperty('--sticky-search-bottom', `${Math.max(0, Math.round(top + box.offsetHeight))}px`);
      stick();
    };
    box.classList.add('sticky-search');
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(search);
    measure();
    window.addEventListener('scroll', stick, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', stick);
      box.classList.remove('sticky-search', 'sticky-search--stuck');
      box.style.removeProperty('--sticky-tuck');
      root.style.removeProperty('--sticky-search-bottom');
    };
    // Measured again on each page: its search is another, or none.
  }, [boxRef, searchRef, enabled, page]);
};
