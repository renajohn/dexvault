import React, { useCallback, useEffect, useRef } from 'react';
import './SwipeRow.css';

/**
 * A row a finger slides, as in Mail: the row is a plate that follows the
 * finger, what lies under it stays in place. To the right lies the deed
 * (spoken for, or no longer; a favourite, or no longer), done when the plate
 * is let go past a threshold; to the left, large buttons, the plate stopping
 * open on them, or a deed of its own, done as the one to the right (the
 * mixtapes, their menu opening as the plate is let go). A touch on a row open closes it; one row open at a time. Off
 * (a wide screen), a plain row. A table's row (`tr`, the default), or a
 * list's line (`li`) on a ground of its own, the full screen player's light:
 * its plate has none, what lies under shows only where the plate bares it.
 */

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  /** plain: grey; gold: what the list is for (bought); danger: red. */
  tone?: 'plain' | 'gold' | 'danger';
  onSelect: () => void;
  disabled?: boolean;
}

/** What a slide to the right does, its words saying what it will do. */
export interface SwipeDeed {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Past the threshold: gold for what turns on (spoken for, a ♥), grey for the rest. Gold to the right, grey to the left unless said. */
  tone?: 'gold' | 'plain';
}

/** Past it, a slide to the right does its deed. */
const THRESHOLD = 88;
/** Each button under the plate. */
const ACTION_WIDTH = 76;

/** The row open, closed when another opens. */
let closeOpen: (() => void) | null = null;

interface SwipeRowProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'tr' | 'li';
  enabled: boolean;
  deed: SwipeDeed;
  /** The buttons a slide to the left lays bare, left to right. */
  actions?: SwipeAction[];
  /** In place of the buttons: what a slide to the left does, let go past the threshold. */
  leftDeed?: SwipeDeed;
  /** Opens a little and closes, once, to show that it slides. */
  hint?: boolean;
}

const SwipeRow: React.FC<SwipeRowProps> = ({ as = 'tr', enabled, deed, actions = [], leftDeed, hint = false, className = '', onClick, children, ...rest }) => {
  const rowRef = useRef<HTMLElement>(null);
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
    row.classList.toggle('swipe-row--armed-left', Boolean(leftDeed) && x <= -THRESHOLD);
    row.style.setProperty('--swipe', `${x}px`);
  }, [leftDeed]);
  const close = useCallback(() => place(0, true), [place]);
  useEffect(() => () => { if (closeOpen === close) closeOpen = null; }, [close]);

  const Row = as as React.ElementType;
  const Under = as === 'tr' ? 'td' : 'div';
  if (!enabled) return <Row className={className} onClick={onClick} {...rest}>{children}</Row>;

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
    if (!leftDeed && next < -width) next = -width + (next + width) / 2;
    place(next, false);
  };
  const onTouchEnd = () => {
    const at = drag.current;
    drag.current = null;
    if (at?.way !== 'h') return;
    const x = offset.current;
    if (x >= THRESHOLD) {
      deed.onSelect();
      close();
    } else if (leftDeed) {
      if (x <= -THRESHOLD) leftDeed.onSelect();
      close();
    } else if (x < -width / 2) {
      place(-width, true);
      closeOpen = close;
    } else close();
  };

  // Caught on its way down, so a button on the plate (a track that plays) does nothing either:
  // a slide ends without a click, a touch on a row open closes it. Its own buttons stay theirs.
  const click = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('.swipe-row__under')) return;
    if (!moved.current && offset.current === 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (moved.current) moved.current = false;
    else close();
  };

  return (
    <Row ref={rowRef} className={`swipe-row${as === 'li' ? ' swipe-row--bare' : ''}${hint ? ' swipe-row--hint' : ''} ${className}`}
      onClickCapture={click} onClick={onClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} {...rest}>
      {children}
      <Under className={`swipe-row__under swipe-row__under--deed swipe-row__under--${deed.tone ?? 'gold'}`} aria-hidden="true">
        <span className="swipe-row__deed">
          {deed.icon}
          <span>{deed.label}</span>
        </span>
      </Under>
      {leftDeed ? (
        <Under className={`swipe-row__under swipe-row__under--actions swipe-row__under--left-deed swipe-row__under--${leftDeed.tone ?? 'plain'}`} aria-hidden="true">
          <span className="swipe-row__deed">
            {leftDeed.icon}
            <span>{leftDeed.label}</span>
          </span>
        </Under>
      ) : (
        <Under className="swipe-row__under swipe-row__under--actions" onClick={(event: React.MouseEvent) => event.stopPropagation()}>
          <span className="swipe-row__actions">
            {actions.map(action => (
              <button key={action.label} type="button" className={`swipe-row__action swipe-row__action--${action.tone ?? 'plain'}`}
                disabled={action.disabled} onClick={() => { close(); action.onSelect(); }}>
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </span>
        </Under>
      )}
    </Row>
  );
};

export default SwipeRow;
