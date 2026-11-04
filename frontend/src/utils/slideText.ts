import { useEffect, type RefObject } from 'react';

/** How fast the words slide, and how long they rest at each end. */
const SPEED_PX_PER_S = 40;
const REST_MS = 1800;

/**
 * Words too long for their field slide to their end, rest, and slide back,
 * again and again, while the field is not being typed in: the field's own
 * scroll, so nothing lies over it. Under a reduced motion, they stay put.
 */
export const useSlideText = (ref: RefObject<HTMLInputElement | null>, text: string): void => {
  useEffect(() => {
    const field = ref.current;
    if (!field || typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let at = 0;
    let toward: 1 | -1 = 1;
    let then = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const overflow = () => field.scrollWidth - field.clientWidth;
    const step = (now: number) => {
      frame = 0;
      const end = overflow();
      if (end <= 1 || document.activeElement === field) { stop(); return; }
      // A page left unpainted a while (another tab in front) goes on from where it was, without a leap.
      at = Math.max(0, Math.min(end, at + toward * SPEED_PX_PER_S * Math.min(now - then, 50) / 1000));
      then = now;
      field.scrollLeft = at;
      if ((toward === 1 && at >= end) || (toward === -1 && at <= 0)) {
        toward = toward === 1 ? -1 : 1;
        rest();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    const rest = () => {
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(now => { then = now; step(now); });
      }, REST_MS);
    };
    const start = () => {
      stop();
      at = 0;
      toward = 1;
      field.scrollLeft = 0;
      if (overflow() > 1 && document.activeElement !== field) rest();
    };

    start();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (!timer && !frame) start(); });
    resized?.observe(field);
    // Typed in, the field is the owner's: back at its start once left.
    const focused = () => stop();
    field.addEventListener('focus', focused);
    field.addEventListener('blur', start);
    return () => {
      stop();
      resized?.disconnect();
      field.removeEventListener('focus', focused);
      field.removeEventListener('blur', start);
    };
  }, [ref, text]);
};
