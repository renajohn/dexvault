import { useEffect, type RefObject } from 'react';

/** How fast the words slide, and how long they rest at each end. */
const SPEED_PX_PER_S = 40;
const REST_MS = 1800;
/** Left where a finger or a trackpad put them, they rest longer before going on. */
const HELD_MS = 3000;
/** How far a finger goes before it drags the words rather than taps the field. */
const DRAG_PX = 8;

/**
 * Words too long for their field slide to their end, rest, and slide back,
 * again and again, while the field is not being typed in: the field's own
 * scroll, so nothing lies over it. Under a reduced motion, they stay put
 * but for a finger or a trackpad.
 * A finger slid along them drags them, without opening the keyboard (a tap
 * still edits), and a trackpad scrolls them: they stay where they were left a
 * while, then go on sliding from there.
 */
export const useSlideText = (ref: RefObject<HTMLInputElement | null>, text: string): void => {
  useEffect(() => {
    const field = ref.current;
    if (!field || typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let at = 0;
    let toward: 1 | -1 = 1;
    let then = 0;
    /** A finger on the field, not typing in it: where it went down, and whether it drags. */
    let touch: { x: number; y: number; from: number; dragging: boolean } | null = null;

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
      if (end <= 1 || touch || document.activeElement === field) { stop(); return; }
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
    const rest = (ms = REST_MS) => {
      if (still) return;
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(now => { then = now; step(now); });
      }, ms);
    };
    /** Moved by hand: taken where they are, to go on the way they went (back, from an end). */
    const held = () => {
      stop();
      at = field.scrollLeft;
      const end = overflow();
      toward = at >= end - 1 ? -1 : at <= 1 ? 1 : toward;
      if (!touch && document.activeElement !== field) rest(HELD_MS);
    };
    const start = () => {
      stop();
      at = 0;
      toward = 1;
      field.scrollLeft = 0;
      if (overflow() > 1 && document.activeElement !== field) rest();
    };

    start();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (!timer && !frame && !touch) start(); });
    resized?.observe(field);
    // Typed in, the field is the owner's: back at its start once left.
    const focused = () => stop();
    field.addEventListener('focus', focused);
    field.addEventListener('blur', start);
    // A trackpad or a wheel: the field scrolled from somewhere other than here.
    const scrolled = () => {
      if (!touch && document.activeElement !== field && Math.abs(field.scrollLeft - at) > 1.5) held();
    };
    field.addEventListener('scroll', scrolled);
    // A finger: typed in, the field keeps the system's own ways.
    const touched = (event: TouchEvent) => {
      if (event.touches.length !== 1 || document.activeElement === field || overflow() <= 1) return;
      const finger = event.touches[0];
      touch = { x: finger.clientX, y: finger.clientY, from: field.scrollLeft, dragging: false };
      stop();
    };
    const moved = (event: TouchEvent) => {
      if (!touch) return;
      const finger = event.touches[0];
      const dx = finger.clientX - touch.x;
      if (!touch.dragging) {
        const dy = finger.clientY - touch.y;
        if (Math.abs(dy) > DRAG_PX && Math.abs(dy) > Math.abs(dx)) { touch = null; held(); return; }  // the page scrolls
        if (Math.abs(dx) <= DRAG_PX) return;
        touch.dragging = true;
      }
      event.preventDefault();
      field.scrollLeft = Math.max(0, Math.min(overflow(), touch.from - dx));
      at = field.scrollLeft;
    };
    const lifted = (event: TouchEvent) => {
      if (!touch) return;
      // A drag is no tap: the field is not focused, the keyboard stays down.
      if (touch.dragging && event.cancelable) event.preventDefault();
      touch = null;
      held();
    };
    field.addEventListener('touchstart', touched, { passive: true });
    field.addEventListener('touchmove', moved, { passive: false });
    field.addEventListener('touchend', lifted, { passive: false });
    field.addEventListener('touchcancel', lifted);
    return () => {
      stop();
      resized?.disconnect();
      field.removeEventListener('focus', focused);
      field.removeEventListener('blur', start);
      field.removeEventListener('scroll', scrolled);
      field.removeEventListener('touchstart', touched);
      field.removeEventListener('touchmove', moved);
      field.removeEventListener('touchend', lifted);
      field.removeEventListener('touchcancel', lifted);
    };
  }, [ref, text]);
};
