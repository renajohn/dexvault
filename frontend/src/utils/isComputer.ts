/** A computer, with a pointer, rather than a phone or a tablet. */
export const isComputer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
