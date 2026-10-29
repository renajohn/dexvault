import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

/**
 * DexVault's tooltips (tooltip.css): what an element's `title` says, in the
 * menus' glass, just under the pointer as the system's own would be, a quarter
 * of a second after the pointer comes to it, at once when another one has just
 * been shown. The TooltipHost mounted once in the app
 * shows them for every `title` on the page: write `title="…"` as before.
 *
 * Under the pointer the title is lifted off the element while it is pointed at,
 * so the system's own tooltip never shows as well, and put back as the pointer
 * leaves. A focus by the keys shows it too, the title left in place for screen
 * readers. On a touch screen, nothing: there is no pointing there.
 *
 * Inside an element marked `data-tooltip-off` (a field being written, its menu
 * open) no tooltip shows: the title is still lifted, so the system's does not
 * show either.
 */

/** Before the first one shows; after one has just gone, the next shows at once. */
const DELAY_MS = 250;
const WARM_MS = 600;
const GAP_PX = 8;
const EDGE_PX = 8;
/** Under the pointer: clear of the arrow's tip, a little to its right. */
const BELOW_POINTER_PX = 18;
const RIGHT_OF_POINTER_PX = 4;

interface Shown {
  text: string;
  anchor: Element;
  /** Where the pointer was as it showed; none for a focus by the keys. */
  pointer: { x: number; y: number } | null;
}

export const TooltipHost: React.FC = () => {
  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The element pointed at, its title lifted off, until the pointer leaves it.
    let lifted: Element | null = null;
    let liftedText = '';
    let watcher: MutationObserver | null = null;
    let timer: number | undefined;
    let lastHidden = 0;
    let visible = false;
    let pointer: { x: number; y: number } | null = null;

    const show = (anchor: Element, text: string) => {
      visible = true;
      setShown({ anchor, text, pointer: anchor === lifted ? pointer : null });
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (visible) lastHidden = Date.now();
      visible = false;
      setShown(null);
    };
    const putBack = () => {
      hide();
      watcher?.disconnect();
      watcher = null;
      if (lifted && !lifted.hasAttribute('title')) lifted.setAttribute('title', liftedText);
      lifted = null;
    };
    const schedule = (anchor: Element, text: string) => {
      window.clearTimeout(timer);
      if (anchor.closest('[data-tooltip-off]')) return;
      if (Date.now() - lastHidden < WARM_MS) show(anchor, text);
      else timer = window.setTimeout(() => show(anchor, text), DELAY_MS);
    };

    // Where the pointer rests while the tooltip waits: it shows where the pointer stopped.
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && !visible) pointer = { x: event.clientX, y: event.clientY };
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      const anchor = (event.target as Element | null)?.closest?.('[title]');
      if (!anchor || anchor === lifted) return;
      const text = anchor.getAttribute('title') || '';
      putBack();
      if (!text.trim()) return;
      lifted = anchor;
      liftedText = text;
      anchor.removeAttribute('title');
      // React may write the title again while it is pointed at: take the new words, and lift them again.
      watcher = new MutationObserver(() => {
        const again = anchor.getAttribute('title');
        if (again === null) return;
        liftedText = again;
        anchor.removeAttribute('title');
        if (visible) show(anchor, again);
      });
      watcher.observe(anchor, { attributes: true, attributeFilter: ['title'] });
      schedule(anchor, text);
    };
    const onOut = (event: PointerEvent) => {
      if (!lifted) return;
      const to = event.relatedTarget as Node | null;
      if (to && lifted.contains(to)) return;
      putBack();
    };
    // Since a finger last touched, and no key since: a focus given then (a menu opened by a slide, its first
    // entry focused) is no keyboard's, even when the browser says it is visible.
    let touched = false;
    // A click, a key or a scroll puts the tooltip away; the title stays off until the pointer leaves.
    const onAct = (event?: Event) => {
      if (event?.type === 'pointerdown') touched = (event as PointerEvent).pointerType !== 'mouse';
      hide();
    };

    const onFocus = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (touched || !target?.matches?.(':focus-visible')) return;
      const text = target.getAttribute('title');
      if (text?.trim()) schedule(target, text);
    };
    const onBlur = () => { if (!lifted) hide(); };
    // A key typed puts it away (one writes, a menu may open under it); Tab and the modifiers leave it, Tab to show the next.
    const onKey = (event: KeyboardEvent) => {
      touched = false;
      if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', onAct, true);
    document.addEventListener('wheel', onAct, { capture: true, passive: true });
    document.addEventListener('scroll', onAct, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      putBack();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', onAct, true);
      document.removeEventListener('wheel', onAct, true);
      document.removeEventListener('scroll', onAct, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Just under the pointer, as the system's own; for a focus, under the element's left edge.
  // Over it when there is no room below; never past the window's edges.
  useLayoutEffect(() => {
    if (!shown || !bubble.current) { setPlace(null); return; }
    const { width, height } = bubble.current.getBoundingClientRect();
    const anchor = shown.anchor.getBoundingClientRect();
    const x = shown.pointer ? shown.pointer.x + RIGHT_OF_POINTER_PX : anchor.left;
    const under = shown.pointer ? shown.pointer.y + BELOW_POINTER_PX : anchor.bottom + GAP_PX;
    const over = (shown.pointer ? shown.pointer.y : anchor.top) - GAP_PX - height;
    const below = under + height <= window.innerHeight - EDGE_PX;
    const left = Math.min(Math.max(EDGE_PX, x), window.innerWidth - width - EDGE_PX);
    setPlace({ left, top: below ? under : Math.max(EDGE_PX, over), below });
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className={`ui-tooltip${place ? ` ui-tooltip--${place.below ? 'below' : 'above'}` : ''}`}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {shown.text}
    </div>,
    document.body,
  );
};

export default TooltipHost;
