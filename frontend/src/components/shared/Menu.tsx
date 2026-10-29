import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsCheck2 } from 'react-icons/bs';
import './menu.css';

/**
 * The one menu of DexVault (menu.css): a panel of the covers' dark glass that
 * opens from a trigger, for actions (⚙︎, a book's …, Play ▾) and for choices
 * (Sort, Grouping, a form's Select). A choice wears a gold ✓; danger is red,
 * put apart. Keys: ↑ ↓ Home End to move, Enter to pick, Esc or Tab to close.
 *
 * It lies in a portal, in the open modal when its trigger is in one: a modal
 * keeps the focus within itself.
 */

export interface MenuTriggerProps {
  ref: React.RefCallback<HTMLButtonElement>;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

export interface MenuProps {
  /** The button that opens it: spread the props on it, its ref included. */
  trigger: (props: MenuTriggerProps, open: boolean) => React.ReactElement;
  /** Its edge against the trigger's: left (start) or right (end). */
  align?: 'start' | 'end';
  /** Up, at the foot of a dialog; down otherwise, up when there is no room below. */
  drop?: 'down' | 'up';
  /** At least as wide as the trigger: a form's Select. */
  matchWidth?: boolean;
  /** For screen readers, when the trigger says nothing. */
  label?: string;
  className?: string;
  /** Opened from outside, not by a click on its trigger (a long press on a track): it then only tells `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

interface MenuContextValue {
  close: (refocus?: boolean) => void;
}

const MenuContext = createContext<MenuContextValue>({ close: () => undefined });

const GAP = 6;
const MARGIN = 8;
const ITEMS = '.menu-item:not(:disabled)';

/** The click that ends a touch, swallowed: gone by itself if none comes. */
const swallowNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const done = () => {
    document.removeEventListener('click', swallow, true);
    window.clearTimeout(timer);
  };
  document.addEventListener('click', swallow, true);
  const timer = window.setTimeout(done, 800);
};

const MenuRoot: React.FC<MenuProps> = ({ trigger, align = 'start', drop = 'down', matchWidth = false, label, className = '', open: held, onOpenChange, children }) => {
  const [own, setOwn] = useState(false);
  const open = held ?? own;
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const setOpenAndTell = useCallback((next: boolean) => {
    if (held === undefined) setOwn(next);
    onOpenChange?.(next);
  }, [held, onOpenChange]);

  // Opened from outside (a finger held on a line), the focus never left for it to come back.
  const close = useCallback((refocus = false) => {
    setOpenAndTell(false);
    if (refocus && held === undefined) triggerRef.current?.focus();
  }, [held, setOpenAndTell]);

  const openMenu = useCallback(() => setOpenAndTell(true), [setOpenAndTell]);

  // In the open modal when its trigger is in one, however it was opened.
  useLayoutEffect(() => {
    if (open) setContainer((triggerRef.current?.closest('.modal') as HTMLElement | null) ?? document.body);
  }, [open]);

  /** Next to its trigger, inside the window: up when asked or when below has no room. */
  const place = useCallback(() => {
    const panel = panelRef.current;
    const button = triggerRef.current;
    if (!panel || !button) return;
    const at = button.getBoundingClientRect();
    if (matchWidth) panel.style.minWidth = `${at.width}px`;
    const size = panel.getBoundingClientRect();
    const roomBelow = window.innerHeight - at.bottom - GAP - MARGIN;
    const roomAbove = at.top - GAP - MARGIN;
    const up = drop === 'up' ? roomAbove >= size.height || roomAbove > roomBelow : size.height > roomBelow && roomAbove > roomBelow;
    const top = up ? Math.max(MARGIN, at.top - GAP - size.height) : at.bottom + GAP;
    const wanted = align === 'end' ? at.right - size.width : at.left;
    const left = Math.max(MARGIN, Math.min(wanted, window.innerWidth - size.width - MARGIN));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.maxHeight = `${Math.max(120, (up ? roomAbove : roomBelow))}px`;
    panel.dataset.side = up ? 'top' : 'bottom';
    panel.dataset.align = align;
  }, [align, drop, matchWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const panel = panelRef.current;
    const items = panel ? Array.from(panel.querySelectorAll<HTMLElement>(ITEMS)) : [];
    (items.find(item => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  }, [open, place, container]);

  useEffect(() => {
    if (!open) return undefined;
    // A finger on an iPhone too: Safari sends no mousedown for a touch on what does nothing (the full screen
    // player's ground), so the pointer's own is listened to as well, the first of the two closing it.
    let closed = false;
    const outside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node;
      if (closed || panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closed = true;
      close();
      // Opened by a finger held on a line, as iOS's own menus: the touch beside it only closes it, it plays no other line.
      if (held !== undefined) swallowNextClick();
    };
    const follow = () => place();
    // Entries that come after it opened (a list read then) move it as they come.
    const grows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (panelRef.current) grows?.observe(panelRef.current, { box: 'border-box' });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      grows?.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, close, place, held]);

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => { event.preventDefault(); items[(index + items.length) % items.length]?.focus(); };
    switch (event.key) {
      case 'ArrowDown': go(at + 1); break;
      case 'ArrowUp': go(at < 0 ? items.length - 1 : at - 1); break;
      case 'Home': go(0); break;
      case 'End': go(items.length - 1); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); break;
      case 'Tab': close(); break;
      default:
        // A letter goes to the next entry it begins, as in a select.
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const letter = event.key.toLocaleLowerCase();
          const next = [...items.slice(at + 1), ...items.slice(0, at + 1)]
            .find(item => (item.querySelector('.menu-item__label')?.textContent ?? '').trim().toLocaleLowerCase().startsWith(letter));
          if (next) { event.preventDefault(); next.focus(); }
        }
        break;
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: element => { triggerRef.current = element; },
    onClick: event => {
      event.stopPropagation();
      if (open) close();
      else openMenu();
    },
    onKeyDown: event => {
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        openMenu();
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    ...(open ? { 'aria-controls': id } : {}),
  };

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger(triggerProps, open)}
      {open && container && createPortal(
        <div ref={panelRef} id={id} role="menu" aria-label={label} className={`menu-surface menu ${className}`}
          onKeyDown={onPanelKeyDown} onClick={event => event.stopPropagation()}>
          {children}
        </div>,
        container,
      )}
    </MenuContext.Provider>
  );
};

interface ItemProps {
  onSelect?: () => void;
  icon?: React.ReactNode;
  /** A word on the right: a count, "new tab". */
  hint?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}

const useSelect = (onSelect?: () => void) => {
  const { close } = useContext(MenuContext);
  return () => {
    close(true);
    onSelect?.();
  };
};

/** An action. */
const Item: React.FC<ItemProps> = ({ onSelect, icon, hint, danger, disabled, title, children }) => {
  const select = useSelect(onSelect);
  return (
    <button type="button" role="menuitem" className={`menu-item${danger ? ' menu-item--danger' : ''}`} disabled={disabled}
      title={title} tabIndex={-1} onClick={select} onMouseMove={event => event.currentTarget.focus({ preventScroll: true })}>
      {icon && <span className="menu-item__icon" aria-hidden="true">{icon}</span>}
      <span className="menu-item__label">{children}</span>
      {hint != null && <span className="menu-item__hint">{hint}</span>}
    </button>
  );
};

interface ChoiceProps extends Omit<ItemProps, 'icon' | 'danger'> {
  selected: boolean;
  /** What it stands for, kept on the entry (data-value) for a form's tests and tools. */
  value?: string;
  /** Quiet, never gold: a field's "Choose…", which chooses nothing. */
  muted?: boolean;
}

/** One of several, the chosen one with a gold ✓. */
const Choice: React.FC<ChoiceProps> = ({ selected, value, muted, onSelect, hint, disabled, title, children }) => {
  const select = useSelect(onSelect);
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} className={`menu-item${muted ? ' menu-item--muted' : ''}`} disabled={disabled} data-value={value}
      title={title} tabIndex={-1} onClick={select} onMouseMove={event => event.currentTarget.focus({ preventScroll: true })}>
      <span className="menu-item__check" aria-hidden="true"><BsCheck2 /></span>
      <span className="menu-item__label">{children}</span>
      {hint != null && <span className="menu-item__hint">{hint}</span>}
    </button>
  );
};

const Section: React.FC<{ title: string }> = ({ title }) => <div className="menu-section" role="presentation">{title}</div>;

const Separator: React.FC = () => <div className="menu-separator" role="separator" />;

/** The chevron of a trigger that opens a menu, turned over while it is open. */
export const MenuChevron: React.FC<{ open?: boolean }> = ({ open }) => (
  <svg className={`menu-chevron${open ? ' menu-chevron--open' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const Menu = Object.assign(MenuRoot, { Item, Choice, Section, Separator });

export default Menu;
