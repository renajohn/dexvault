import React, { useEffect, useRef, useState } from 'react';
import './PhoneSheet.css';

const DRAG_FROM_PX = 8;
const SWIPE_CLOSE_PX = 120;
const SLIDE_MS = 320;

/** A day as a date field holds it, YYYY-MM-DD, in the owner's time: toISOString's UTC made it the day before. */
export const dayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const today = () => dayOf(new Date());
export const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return dayOf(date); };

export const longDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const isoDate = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : dayOf(date);
};

export const francs = (price?: number | string | null) => {
  const value = Number(price);
  return price != null && price !== '' && !isNaN(value) && value > 0
    ? new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2 }).format(value)
    : null;
};

/**
 * A record full screen on a phone (a film, a book): in from the foot as it
 * opens, back down as it goes, a finger drawn down or Escape closing it. Escape
 * first gives `cancel` its chance (an edit in place), then leaves a field.
 * Another record shown while it slides away keeps it open, on that one.
 */
export const usePhoneSheet = (id: unknown, onClose: () => void, cancel: () => boolean = () => false) => {
  const [open, setOpen] = useState(false);
  const closing = useRef<number | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const close = () => {
    if (closing.current != null) return;
    setOpen(false);
    closing.current = window.setTimeout(() => { closing.current = null; onClose(); }, SLIDE_MS);
  };
  useEffect(() => {
    if (closing.current == null) return;
    window.clearTimeout(closing.current);
    closing.current = null;
    setOpen(true);
  }, [id]);
  useEffect(() => () => { if (closing.current != null) window.clearTimeout(closing.current); }, []);
  const leaveFor = (then: () => void) => { close(); then(); };

  const sheetRef = useRef<HTMLDivElement>(null);
  usePullToClose(sheetRef, close);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.modal.show, .menu-surface')) return;
      const field = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, .menu-select');
      if (cancelRef.current()) return;
      if (field) (document.activeElement as HTMLElement | null)?.blur();
      else closeRef.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return { sheetRef, open, close, leaveFor };
};

interface PhoneSheetProps {
  sheet: ReturnType<typeof usePhoneSheet>;
  label: string;
  /** The tab shown, for its stylesheet: `phone-sheet--<tab>`. */
  tab: string;
  /** Under it all: a film's scene (`scene`), or else its cover, blurred. */
  scene?: string | null;
  cover?: string | null;
  children: React.ReactNode;
}

/** The frame of a record full screen: its light under it, the handle, then the head, the tabs and the tab the sheet gives. */
const PhoneSheet: React.FC<PhoneSheetProps> = ({ sheet, label, tab, scene, cover, children }) => (
  <div ref={sheet.sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
    className={`phone-sheet phone-sheet--${tab}${sheet.open ? ' phone-sheet--open' : ''}`}>
    <div className={`phone-sheet-backdrop${scene ? ' phone-sheet-backdrop--scene' : ''}`} aria-hidden="true">
      {scene ? <img src={scene} alt="" /> : cover && <img src={cover} alt="" />}
    </div>
    <div className="phone-sheet-inner">
      <button type="button" className="phone-sheet-handle" onClick={sheet.close} aria-label="Close"><span /></button>
      {children}
    </div>
  </div>
);

/** Records across (a collection's films, a series' volumes), opened on this one's place: in the middle when it can be. */
export const SheetRow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const row = useRef<HTMLDivElement>(null);
  const count = React.Children.count(children);
  useEffect(() => {
    const here = row.current?.querySelector<HTMLElement>('.phone-sheet-mini--here');
    if (row.current && here) row.current.scrollLeft = here.offsetLeft - (row.current.clientWidth - here.offsetWidth) / 2;
  }, [count]);
  return <div ref={row} className="phone-sheet-row">{children}</div>;
};

/** A line of a list of facts (`phone-sheet-facts`): its label, then what it says. */
export const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

/**
 * A finger drawn down closes the sheet: anywhere off its lists, or on a list
 * at its top. The page under it never scrolls (iOS's Safari scrolls it through
 * a fixed layer unless the move is refused); a list scrolls while it has
 * somewhere to go, and a row across (the cast, a collection) slides its way.
 * The stars' dial keeps up and down for itself.
 */
const usePullToClose = (sheetRef: React.RefObject<HTMLDivElement | null>, close: () => void) => {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    let touch: { x: number; y: number; at: number; list: HTMLElement | null; mode: 'undecided' | 'pull' | 'native' } | null = null;
    let frame = 0;
    const place = (dy: number | null) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        sheet.classList.toggle('phone-sheet--drag', dy != null);
        sheet.style.transform = dy != null ? `translateY(${dy}px)` : '';
      });
    };
    const begin = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      touch = event.touches.length === 1 && !target?.closest('input, textarea, .menu-surface, .ui-stars')
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: event.timeStamp, list: target?.closest<HTMLElement>('.phone-sheet-scroll') ?? null, mode: 'undecided' }
        : null;
    };
    const move = (event: TouchEvent) => {
      if (!touch) return;
      const dy = event.touches[0].clientY - touch.y;
      const dx = event.touches[0].clientX - touch.x;
      const list = touch.list;
      const atTop = !list || list.scrollTop <= 0;
      if (touch.mode === 'undecided' && Math.max(Math.abs(dx), Math.abs(dy)) >= 3) {
        touch.mode = dy > Math.abs(dx) && atTop ? 'pull' : 'native';
      }
      if (touch.mode === 'undecided') {
        if (dy > 0 && atTop && event.cancelable) event.preventDefault();
        return;
      }
      if (touch.mode === 'pull') {
        if (event.cancelable) event.preventDefault();
        place(dy >= DRAG_FROM_PX ? dy : null);
        return;
      }
      // Across, in a row that slides: its own.
      const target = event.target instanceof Element ? event.target : null;
      if (Math.abs(dx) > Math.abs(dy) && target?.closest('.phone-sheet-row')) return;
      const room = list ? list.scrollHeight - list.clientHeight : 0;
      if (event.cancelable && (!list || room <= 1 || (dy < 0 && list.scrollTop >= room - 1))) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const from = touch;
      touch = null;
      if (from?.mode !== 'pull') return;
      const dy = (event.changedTouches[0]?.clientY ?? from.y) - from.y;
      place(null);
      if (dy > SWIPE_CLOSE_PX || (dy > 30 && dy / Math.max(1, event.timeStamp - from.at) > 0.5)) closeRef.current();
    };
    const wheel = (event: WheelEvent) => {
      const list = event.target instanceof Element ? event.target.closest<HTMLElement>('.phone-sheet-scroll') : null;
      const room = list ? list.scrollHeight - list.clientHeight : 0;
      const free = list != null && room > 1 && (event.deltaY < 0 ? list.scrollTop > 0 : event.deltaY > 0 ? list.scrollTop < room - 1 : true);
      if (!free && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) event.preventDefault();
    };
    sheet.addEventListener('touchstart', begin, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
    sheet.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      sheet.removeEventListener('touchstart', begin);
      sheet.removeEventListener('touchmove', move);
      sheet.removeEventListener('touchend', end);
      sheet.removeEventListener('touchcancel', end);
      sheet.removeEventListener('wheel', wheel);
    };
  }, [sheetRef]);
};

export default PhoneSheet;
