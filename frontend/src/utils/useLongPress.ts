import { useCallback, useEffect, useRef } from 'react';

/** How long a finger rests on a line before its menu opens, and how far it may wander meanwhile. */
export const LONG_PRESS_MS = 480;
const WANDER_PX = 10;

/**
 * A finger resting on a line: `onLong` after half a second, unless it moved
 * (the list scrolls) or lifted first. The click that follows a long press is
 * swallowed, so the line does not also play or open. Spread the handlers on
 * the line; its stylesheet keeps iOS from selecting its words (`user-select`,
 * `-webkit-touch-callout`).
 */
export const useLongPress = (onLong: (() => void) | null) => {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  if (!onLong) return {};
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > WANDER_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (event: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };
};
