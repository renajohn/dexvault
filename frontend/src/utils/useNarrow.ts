import { useEffect, useState } from 'react';

const NARROW = '(max-width: 575px)';

/** Whether a media query holds, followed as the window turns or is resized. */
export const useMedia = (media: string): boolean => {
  const [holds, setHolds] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(media).matches);
  useEffect(() => {
    const query = window.matchMedia?.(media);
    if (!query) return undefined;
    const changed = () => setHolds(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, [media]);
  return holds;
};

/** A phone's width, followed as the window turns or is resized. */
export const useNarrow = (): boolean => useMedia(NARROW);

export default useNarrow;
