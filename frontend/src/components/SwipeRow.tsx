import React, { useCallback, useEffect, useRef } from 'react';
import { BsBookmarkCheck } from 'react-icons/bs';
import './SwipeRow.css';

/**
 * A table's row a finger slides, as in Mail: the row is a plate that follows
 * the finger, what lies under it stays in place. To the right lies the deed
 * (spoken for, or no longer), done when the plate is let go past a threshold;
 * to the left, large buttons, the plate stopping open on them. A touch on a
 * row open closes it; one row open at a time. Off (a wide screen), a plain row.
 */

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  /** plain: grey; gold: what the list is for (bought); danger: red. */
  tone?: 'plain' | 'gold' | 'danger';
  onSelect: () => void;
  disabled?: boolean;
}

/** Past it, a slide to the right does its deed. */
const THRESHOLD = 88;
/** Each button under the plate. */
const ACTION_WIDTH = 76;

/** The row open, closed when another opens. */
let closeOpen: (() => void) | null = null;

interface SwipeRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  enabled: boolean;
  spokenFor: boolean;
  onSpokenFor: () => void;
  /** The buttons a slide to the left lays bare, left to right. */
  actions: SwipeAction[];
  /** Opens a little and closes, once, to show that it slides. */
  hint?: boolean;
}

const SwipeRow: React.FC<SwipeRowProps> = ({ enabled, spokenFor, onSpokenFor, actions, hint = false, className = '', onClick, children, ...rest }) => {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const offset = useRef(0);
  const drag = useRef<{ x: number; y: number; from: number; way: 'h' | 'v' | null } | null>(null);
  const moved = useRef(false);
  const width = actions.length * ACTION_WIDTH;

  // The plate is moved here, not through React: it keeps up with the finger.
  const place = useCallback((x: number, animate: boolean) => {
    offset.current = x;
    const row = rowRef.current;
    if (!row) return;
    row.classList.toggle('swipe-row--moving', !animate);
    // Going back, what lies under stays until the plate covers it again.
    if (x !== 0 || !animate) {
      row.classList.toggle('swipe-row--right', x > 0);
      row.classList.toggle('swipe-row--left', x < 0);
    } else {
      window.setTimeout(() => {
        if (offset.current === 0) row.classList.remove('swipe-row--right', 'swipe-row--left');
      }, 340);
    }
    row.classList.toggle('swipe-row--armed', x >= THRESHOLD);
    row.style.setProperty('--swipe', `${x}px`);
  }, []);
  const close = useCallback(() => place(0, true), [place]);
  useEffect(() => () => { if (closeOpen === close) closeOpen = null; }, [close]);

  if (!enabled) return <tr className={className} onClick={onClick} {...rest}>{children}</tr>;

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    drag.current = { x: touch.clientX, y: touch.clientY, from: offset.current, way: null };
    moved.current = false;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const at = drag.current;
    if (!at) return;
    const touch = event.touches[0];
    const dx = touch.clientX - at.x;
    const dy = touch.clientY - at.y;
    // Across only when the finger goes clearly across: the list scrolls otherwise.
    if (!at.way) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        at.way = 'h';
        // From where the finger is, so the plate does not jump by the 8 px it waited.
        at.x = touch.clientX;
        if (closeOpen && closeOpen !== close) closeOpen();
      } else if (Math.abs(dy) > 8) at.way = 'v';
      return;
    }
    if (at.way !== 'h') return;
    moved.current = true;
    let next = at.from + touch.clientX - at.x;
    // Beyond its buttons the plate resists, by half.
    if (next < -width) next = -width + (next + width) / 2;
    place(next, false);
  };
  const onTouchEnd = () => {
    const at = drag.current;
    drag.current = null;
    if (at?.way !== 'h') return;
    const x = offset.current;
    if (x >= THRESHOLD) {
      onSpokenFor();
      close();
    } else if (x < -width / 2) {
      place(-width, true);
      closeOpen = close;
    } else close();
  };

  const click = (event: React.MouseEvent<HTMLTableRowElement>) => {
    // A slide ends without a click; a touch on a row open closes it.
    if (moved.current) { moved.current = false; return; }
    if (offset.current !== 0) { close(); return; }
    onClick?.(event);
  };

  return (
    <tr ref={rowRef} className={`swipe-row${hint ? ' swipe-row--hint' : ''} ${className}`}
      onClick={click} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} {...rest}>
      {children}
      <td className="swipe-row__under swipe-row__under--deed" aria-hidden="true">
        <span className="swipe-row__deed">
          <BsBookmarkCheck />
          <span>{spokenFor ? 'Not spoken for' : 'Spoken for'}</span>
        </span>
      </td>
      <td className="swipe-row__under swipe-row__under--actions" onClick={event => event.stopPropagation()}>
        <span className="swipe-row__actions">
          {actions.map(action => (
            <button key={action.label} type="button" className={`swipe-row__action swipe-row__action--${action.tone ?? 'plain'}`}
              disabled={action.disabled} onClick={() => { close(); action.onSelect(); }}>
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </span>
      </td>
    </tr>
  );
};

export default SwipeRow;
