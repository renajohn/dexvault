import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors,
  type Collision, type CollisionDetection, type PointerSensorOptions, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BsX, BsFilm, BsDisc, BsDice5 } from 'react-icons/bs';
import ShelfCode from './ShelfCode';
import CoverButton from './CoverButton';
import './shared.css';
import Spinner from './Spinner';
import { coverReady, thumbProps } from '../../utils/thumb';

interface NextBannerItem {
  id: number;
  title?: string;
  [key: string]: any;
}

interface NextBannerProps {
  items?: NextBannerItem[];
  type?: 'movie' | 'music';
  title?: string;
  icon?: React.ReactNode | string;
  onItemClick?: (id: number) => void;
  onRemove?: (event: React.MouseEvent, item: NextBannerItem) => void;
  getImageUrl?: (item: NextBannerItem) => string | null;
  getTitle?: (item: NextBannerItem) => string;
  getSubtitle?: (item: NextBannerItem) => string;
  getYear?: (item: NextBannerItem) => string | number | null;
  getFormat?: (item: NextBannerItem) => string | null;
  /** The image drawn by the caller, as its grid draws it: tags, title and shelf with it; the card keeps its buttons and its drag. */
  renderCover?: (item: NextBannerItem) => React.ReactNode;
  /** Always-visible markers laid over each image (the hover overlay stays for title/meta). */
  renderBadges?: (item: NextBannerItem) => React.ReactNode;
  onSmartFill?: () => void;
  smartFillLoading?: boolean;
  /** In Help me choose's frame, at its foot: what a draw takes. */
  smartFillFoot?: React.ReactNode;
  onShuffle?: (item: NextBannerItem) => void;
  /** Whether a card offers the die (all of them by default): one drawn, say, not one put there by hand. */
  canShuffle?: (item: NextBannerItem) => boolean;
  /** The die's tooltip: what it draws from. */
  shuffleTitle?: string;
  shufflingItemId?: number | null;
  /** A play button laid on each image, at its foot on the left. */
  renderPlay?: (item: NextBannerItem) => React.ReactNode;
  /** A button laid on an image, at its foot on the right (where a CD's shelf shows under the pointer). */
  renderFootRight?: (item: NextBannerItem) => React.ReactNode;
  /** In the header in place of the count: controls of the list's own. */
  headerControls?: React.ReactNode;
  /** A line under the cards. */
  footer?: React.ReactNode;
  /** A class of a card's own: one leaving the list, say. */
  getCardClassName?: (item: NextBannerItem) => string;
  /** Laid over each image, above everything else on it. */
  renderOverlay?: (item: NextBannerItem) => React.ReactNode;
  /** A card's own key, when an item can be there twice (two discs of an album): its id by default. */
  getKey?: (item: NextBannerItem) => string | number;
  /** The cards can be dragged into a new order: the keys of those that can (their ids by default), from the first to the last. */
  onReorder?: (keys: Array<string | number>) => void;
  /** Whether a card can be dragged (all of them by default); one that cannot keeps its place among the others. */
  canReorder?: (item: NextBannerItem) => boolean;
  /**
   * A card dropped in the other list, or a small cover of the other list
   * dropped in the row, or either on a NextBannerDrop (a list's name): its
   * key; where, 'here' (the row), `other.dropId`, or the drop's id; and the
   * key of the one it stands before there, null at the end, undefined when
   * the drop does not say (a list's name).
   */
  onDropOn?: (key: string, target: string, before?: string | null) => void;
  /** The other list, small, at the foot: its covers dragged into the row and back, its name a place to drop. */
  other?: OtherList;
  /** A class of the banner's own: its tint, say. */
  className?: string;
  /** Shown with no card and no Help me choose: a list of a few, empty for now, with its others in sight. */
  alwaysShow?: boolean;
  /** A round button laid on an image, at its top, left of ✕. */
  renderCornerButton?: (item: NextBannerItem) => React.ReactNode;
}

interface OtherList {
  items: NextBannerItem[];
  /** The name a drop on the strip gives onDropOn. */
  dropId: string;
  /** Its name, first on the strip: a button of the caller's. */
  head: React.ReactNode;
  /** Said on the strip while a cover is dragged: where it goes. */
  dropHint: string;
  /** How many small covers at most, "+N" after; as many as the strip holds when not given. */
  most?: number;
  /** A small cover clicked: that list in sight, at it. */
  onShow: (key: string) => void;
  /** "+N": that list in sight. */
  onOpen: () => void;
  /** After the strip, on the right: the list's length, say. */
  aside?: React.ReactNode;
  /** Its class: its tint. */
  className?: string;
  /** Its covers dragged among themselves: the list's keys in their new order. */
  onReorder?: (keys: string[]) => void;
  /** A small cover's tooltip. */
  titleOf?: (item: NextBannerItem) => string;
}

/** Ids of the places to drop, apart from the cards' keys: the row, the strip, a list's name. */
const DROP = 'drop:';
const ROW = `${DROP}here`;
const STRIP = `${DROP}other`;
/** A small cover's side while dragged; a card's is the image's own width. */
const SMALL_PX = 56;
/** A small cover's side at the foot, and the room between two: how many the strip holds. */
const STRIP_COVER_PX = 30;
const STRIP_GAP_PX = 6;
/** The strip's own room at its two ends (its padding). */
const STRIP_PAD_PX = 4;
/** How long what was dragged takes to land on its place. */
const LAND_MS = 180;

/**
 * The pointer sensor for a mouse or a pen alone. Safari sends a touch's
 * pointerdown before its touchstart, so a plain PointerSensor took the finger
 * first and a swipe along the row dragged its cover; a finger goes to the
 * TouchSensor, which waits for it to hold.
 */
class MousePointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent: event }: React.PointerEvent, { onActivation }: PointerSensorOptions) => {
      if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return false;
      onActivation?.({ event });
      return true;
    },
  }];
}

/** Somewhere a card or a small cover can be dropped, inside a NextBanner: lit while one is over it. */
export const NextBannerDrop: React.FC<{ id: string; className?: string; inline?: boolean; children: React.ReactNode }> = ({ id, className = '', inline = false, children }) => {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${DROP}${id}` });
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag ref={setNodeRef} className={`${className} next-banner-drop${active ? ' next-banner-drop--ready' : ''}${isOver ? ' next-banner-drop--over' : ''}`}>
      {children}
    </Tag>
  );
};

/** A banner's icon when it is given none: a star. */
const BannerStar: React.FC = () => (
  <svg className="next-banner__icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

/**
 * The banner's place, held while its list is read: its title and the places of
 * its covers, a sheen passing over them, as high as the banner will be. A page
 * assumes its banner is there and draws this at once; the banner takes its
 * place, or NextBannerSlot slides it away.
 */
export const NextBannerPending: React.FC<{
  type: 'movie' | 'music';
  title: string;
  icon?: React.ReactNode;
  className?: string;
  /** In the header, as the banner will have them: controls of the list's own. */
  headerControls?: React.ReactNode;
  /** Under the cards, as the banner will have it: the other list's strip, say. */
  footer?: React.ReactNode;
  /** The banner will end with Help me choose (onSmartFill): held too, with what lies under it. */
  smartFill?: boolean;
  smartFillFoot?: React.ReactNode;
}> = ({ type, title, icon, className = '', headerControls, footer, smartFill = false, smartFillFoot }) => (
  <div className={`next-banner next-banner--pending ${className}`} aria-busy="true">
    <div className="next-banner__header">
      <div className="next-banner__title-section">
        {icon ?? <BannerStar />}
        <h2 className="next-banner__title">{title}</h2>
        {headerControls}
      </div>
    </div>
    <div className="next-banner__carousel">
      <div className="next-banner__track">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="next-banner__card">
            <div className={`next-banner__image next-banner__image--${type} next-banner__image--pending`} />
          </div>
        ))}
        {smartFill && (
          <div className={`next-banner__help-card next-banner__help-card--${type} loading`}>
            <button type="button" className="next-banner__help-action" disabled>
              <span className="next-banner__help-text">Help me choose</span>
              <span className="next-banner__help-icon">+</span>
            </button>
            {smartFillFoot && <div className="next-banner__help-foot">{smartFillFoot}</div>}
          </div>
        )}
      </div>
    </div>
    {footer}
  </div>
);

/** How long a banner takes to fade in (bannerFadeIn), and to slide away. */
const FADE_MS = 250;
const SLIDE_MS = 350;

/**
 * Where a page's banner stands. Shown, it holds it; no longer to be shown (its
 * list read and empty, a search typed), it slides it up and away rather than
 * take it off at once, the page under it rising with it.
 */
export const NextBannerSlot: React.FC<{ show: boolean; children: React.ReactNode }> = ({ show, children }) => {
  const slot = useRef<HTMLDivElement>(null);
  // What it showed last: drawn on while it slides away.
  const last = useRef<React.ReactNode>(children);
  if (show) last.current = children;
  const [shown, setShown] = useState(show);
  const [leaving, setLeaving] = useState(false);
  // Once in, faded in: what comes in its place (the banner read, after its place held) comes without a fade.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!show || settled) return undefined;
    const timer = window.setTimeout(() => setSettled(true), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [show, settled]);
  if (show !== shown) {
    setShown(show);
    setLeaving(!show);
  }
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element) return undefined;
    // Shown again before it was gone: its own height back.
    if (!leaving) {
      element.style.height = '';
      return undefined;
    }
    // From its height to none: a height set, read, then 0 for the transition to run.
    element.style.height = `${element.offsetHeight}px`;
    void element.offsetHeight;
    element.style.height = '0px';
    const timer = window.setTimeout(() => { setLeaving(false); setSettled(false); }, SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  if (!show && !leaving) return null;
  return (
    <div ref={slot} className={`next-banner-slot${settled ? ' next-banner-slot--settled' : ''}${leaving ? ' next-banner-slot--leaving' : ''}`}>
      {show ? children : last.current}
    </div>
  );
};

/** A small cover of the other list, at the foot: dragged into the row and back like a card; a click stays a click. */
const SortableSmall: React.FC<{ id: string; title: string; image: string | null; onClick: () => void; fallback: React.ReactNode; landing?: boolean }> = ({ id, title, image, onClick, fallback, landing = false }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners} role={undefined} title={title} onClick={onClick} data-key={id}
      className={`next-banner-other__cover${isDragging || landing ? ' next-banner-other__cover--dragging' : ''}`}
      style={{ transform: isDragging ? undefined : CSS.Translate.toString(transform), transition: transition || undefined }}>
      {image ? <img src={image} alt="" loading="lazy" /> : fallback}
    </button>
  );
};

interface SortableCardProps {
  id: string | number;
  disabled: boolean;
  className: string;
  /** What is dragged follows the pointer on its own: the card waits, faded, at the place it would take. */
  still?: boolean;
  /** What was dragged is landing on it: hidden until it is there. */
  landing?: boolean;
  /** Just dropped, the pointer still on it: it does not lift as under the pointer until the pointer has left it. */
  calm?: boolean;
  onLeave?: () => void;
  children: React.ReactNode;
}

/** A card of the banner, which a drag moves along the others. */
const SortableCard: React.FC<SortableCardProps> = ({ id, disabled, className, still = false, landing = false, calm = false, onLeave, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = { transform: still && isDragging ? undefined : CSS.Translate.toString(transform), transition: transition || undefined };
  // Faded in when it appears, once: a card moved in the row is taken out and put back, which would play it again.
  // One that appears as it is dragged in (a small cover over the row) stays hidden: no fading in of it.
  const [entering, setEntering] = useState(!isDragging);
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-key={id}
      onAnimationEnd={event => { if (event.target === event.currentTarget) setEntering(false); }}
      onMouseLeave={calm ? onLeave : undefined}
      className={`${className}${entering ? ' next-banner__card--entering' : ''}${isDragging ? ` next-banner__card--dragging${still ? ' next-banner__card--waiting' : ''}` : ''}${landing ? ' next-banner__card--landing' : ''}${calm ? ' next-banner__card--calm' : ''}${disabled ? '' : ' next-banner__card--sortable'}`}
      {...attributes}
      {...listeners}
      // The card is not a control of its own: its image and its buttons are.
      role={undefined}
      tabIndex={undefined}
      aria-roledescription={disabled ? undefined : 'sortable'}
    >
      {children}
    </div>
  );
};

const NextBanner: React.FC<NextBannerProps> = ({
  items = [],
  type = 'movie',
  title = 'Next',
  icon,
  onItemClick,
  onRemove,
  getImageUrl,
  getTitle,
  getSubtitle,
  getYear,
  getFormat,
  renderCover,
  renderBadges,
  onSmartFill,
  smartFillLoading = false,
  smartFillFoot,
  onShuffle,
  canShuffle,
  shuffleTitle = 'Replace with another suggestion',
  shufflingItemId = null,
  renderPlay,
  renderFootRight,
  headerControls,
  footer,
  getCardClassName,
  renderOverlay,
  onReorder,
  canReorder,
  onDropOn,
  other,
  className = '',
  alwaysShow = false,
  renderCornerButton,
  getKey = item => item.id
}) => {
  const bannerRef = useRef<HTMLDivElement>(null);
  /** What is being dragged, a card's key or a small cover's: its image follows the pointer. */
  const [dragged, setDragged] = useState<string | null>(null);
  /** While a drag goes on: the row's keys and the strip's, as they stand with the cover dragged where it is now. */
  const [live, setLive] = useState<{ here: string[]; other: string[] } | null>(null);
  /** Where the cover dragged came from. */
  const origin = useRef<'here' | 'other' | null>(null);
  /** The side of what follows the pointer: a card's, or a small cover's; it grows or shrinks between them. */
  const [previewPx, setPreviewPx] = useState(SMALL_PX);
  const cardPx = useRef(180);
  /** Where the pointer is while a cover is dragged: what follows it is centred on it. */
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  /**
   * A cover dropped: what followed the pointer flies to its place, at its
   * size, the cover hidden there until it lands. `at` once its place is known.
   */
  /** The cover just dropped, the pointer still on it: kept still under it. */
  const [calmKey, setCalmKey] = useState<string | null>(null);
  const [landing, setLanding] = useState<{ key: string; image: string | null; from: { x: number; y: number; px: number }; at?: { x: number; y: number; px: number } } | null>(null);
  const startedAt = useRef<{ x: number; y: number } | null>(null);
  // How many small covers the strip holds, as wide as it is now.
  const stripRef = useRef<HTMLDivElement>(null);
  const [holds, setHolds] = useState(16);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return undefined;
    // Not laid out yet (or hidden): as many as before.
    const measure = () => {
      if (strip.clientWidth > 0) setHolds(Math.max(1, Math.floor((strip.clientWidth - STRIP_PAD_PX + STRIP_GAP_PX) / (STRIP_COVER_PX + STRIP_GAP_PX))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [Boolean(other)]);
  /** Set from a drag's end to the click that follows it, which must not open the card. */
  const justDragged = useRef(false);

  // A few pixels before a mouse drags, so that a click stays a click; a touch holds first, so that a swipe scrolls.
  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Show banner if there are items OR if smart fill is available
  const hasSmartFill = typeof onSmartFill === 'function';

  // Remove closing class when items change (banner should reappear fresh)
  useEffect(() => {
    if (bannerRef.current) {
      bannerRef.current.classList.remove('closing');
    }
  }, [items.length]);


  const handleRemove = (e: React.MouseEvent, item: NextBannerItem) => {
    e.stopPropagation();

    // Get the card element for animation
    const cardElement = (e.currentTarget as HTMLElement).closest('.next-banner__card');
    if (cardElement) {
      cardElement.classList.add('removing');
    }

    // Check if this is the last item - use ref instead of querySelector
    const isLastItem = items.length === 1;
    if (isLastItem && bannerRef.current && !hasSmartFill) {
      // Only close if there's no smart fill (otherwise banner should stay)
      bannerRef.current.classList.add('closing');
    }

    // Call the remove handler
    if (onRemove) {
      onRemove(e, item);
    }
  };

  const handleShuffle = (e: React.MouseEvent, item: NextBannerItem) => {
    e.stopPropagation();
    if (onShuffle && shufflingItemId === null) {
      onShuffle(item);
    }
  };

  const keyOf = (item: NextBannerItem) => String(getKey(item));
  const hereKeys = live?.here ?? items.map(keyOf);
  const otherKeys = live?.other ?? (other?.items ?? []).map(keyOf);
  const byKey = new Map([...items, ...(other?.items ?? [])].map(item => [keyOf(item), item]));
  /** The row or the strip an id stands in: a key, or the place itself. */
  const sideOf = (id: string, keys = { here: hereKeys, other: otherKeys }): 'here' | 'other' | null =>
    id === ROW || keys.here.includes(id) ? 'here' : id === STRIP || keys.other.includes(id) ? 'other' : null;

  /**
   * Where a drop goes: a list's name under the pointer first; else, in the
   * row or the strip the pointer is in, the cover nearest it, or the row or
   * the strip itself.
   */
  const collide: CollisionDetection = args => {
    const under = pointerWithin(args);
    const name = under.find(hit => String(hit.id).startsWith(DROP) && hit.id !== ROW && hit.id !== STRIP);
    if (name) return [name];
    if (!other) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(container => !String(container.id).startsWith(DROP)) });
    }
    const side = under.some(hit => sideOf(String(hit.id)) === 'other') ? 'other' : under.some(hit => sideOf(String(hit.id)) === 'here') ? 'here' : null;
    if (!side) return [];
    // The cover nearest the pointer, not the one nearest what is dragged: a card and a small cover differ in size.
    const keys = side === 'here' ? hereKeys : otherKeys;
    const at = args.pointerCoordinates;
    let nearest: Collision | null = null;
    let distance = Infinity;
    for (const container of args.droppableContainers) {
      const rect = args.droppableRects.get(container.id);
      if (!at || !rect || !keys.includes(String(container.id))) continue;
      const d = Math.hypot(rect.left + rect.width / 2 - at.x, rect.top + rect.height / 2 - at.y);
      if (d < distance) { distance = d; nearest = { id: container.id, data: { droppableContainer: container, value: d } }; }
    }
    return nearest ? [nearest] : [{ id: side === 'here' ? ROW : STRIP }];
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const id = String(active.id);
    const width = bannerRef.current?.querySelector('.next-banner__image')?.getBoundingClientRect().width;
    if (width) cardPx.current = width;
    setDragged(id);
    origin.current = sideOf(id);
    startedAt.current = getEventCoordinates(event.activatorEvent);
    setPointer(startedAt.current);
    setPreviewPx(origin.current === 'other' ? SMALL_PX : cardPx.current);
    if (other) setLive({ here: items.map(keyOf), other: other.items.map(keyOf) });
  };

  // Across: the cover leaves its row for the other, at the place of the one under the pointer; the others make room.
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!live || !over) return;
    const id = String(active.id);
    const from = sideOf(id, live);
    const to = sideOf(String(over.id), live);
    if (!from || !to || from === to) return;
    const target = live[to].filter(key => key !== id);
    const at = target.indexOf(String(over.id));
    target.splice(at < 0 ? target.length : at, 0, id);
    setLive({ ...live, [from]: live[from].filter(key => key !== id), [to]: target });
    setPreviewPx(to === 'here' ? cardPx.current : SMALL_PX);
  };

  // The pointer itself, not dnd-kit's delta, which jumps when a cover changes rows.
  useEffect(() => {
    if (!dragged || !other) return undefined;
    const follow = (event: PointerEvent | TouchEvent) => {
      const at = 'touches' in event ? event.touches[0] : event;
      if (at) setPointer({ x: at.clientX, y: at.clientY });
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('touchmove', follow, { passive: true });
    return () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('touchmove', follow);
    };
  }, [dragged, other]);

  // Where the cover dropped now stands, once drawn there: what followed the pointer goes to it, then gives way.
  useLayoutEffect(() => {
    if (!landing || landing.at) return undefined;
    const target = bannerRef.current?.querySelector(`[data-key="${window.CSS.escape(landing.key)}"]`);
    const box = (target?.querySelector('.next-banner__image') ?? target)?.getBoundingClientRect();
    if (!box || box.width === 0) { setLanding(null); return undefined; }
    const frame = requestAnimationFrame(() => setLanding(now => now && { ...now, at: { x: box.left + box.width / 2, y: box.top + box.height / 2, px: box.width } }));
    return () => cancelAnimationFrame(frame);
  }, [landing]);
  useEffect(() => {
    if (!landing?.at) return undefined;
    const timer = window.setTimeout(() => setLanding(null), LAND_MS);
    return () => window.clearTimeout(timer);
  }, [landing]);

  /** The cover dropped, where it now stands: what followed the pointer lands on it. */
  const land = (key: string) => {
    if (!pointer) return;
    const item = byKey.get(key);
    setLanding({ key, image: item && getImageUrl ? getImageUrl(item) : null, from: { x: pointer.x, y: pointer.y, px: previewPx } });
    setCalmKey(key);
  };

  const endDrag = () => {
    setDragged(null);
    setLive(null);
    setPointer(null);
    origin.current = null;
    startedAt.current = null;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const state = live;
    const began = origin.current;
    endDrag();
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const activeId = String(active.id);
    const overId = over ? String(over.id) : null;
    // Onto a list's name: into that list, where it says.
    if (overId?.startsWith(DROP) && overId !== ROW && overId !== STRIP) {
      onDropOn?.(activeId, overId.slice(DROP.length));
      return;
    }
    if (other) land(activeId);
    // Let go away from the row and the strip: nothing moves, the cover goes back to its place.
    if (other && !over) return;
    // Into the other row or strip: where it now stands there, moved on to the one under the pointer.
    if (state && began) {
      const side = sideOf(activeId, state);
      if (side && side !== began) {
        let keys = state[side];
        if (overId && keys.includes(overId) && overId !== activeId) keys = arrayMove(keys, keys.indexOf(activeId), keys.indexOf(overId));
        const before = keys[keys.indexOf(activeId) + 1] ?? null;
        onDropOn?.(activeId, side === 'here' ? 'here' : other!.dropId, before);
        return;
      }
      // Among the small covers: the other list in a new order.
      if (began === 'other') {
        const keys = state.other;
        if (overId && keys.includes(overId) && overId !== activeId) other?.onReorder?.(arrayMove(keys, keys.indexOf(activeId), keys.indexOf(overId)));
        return;
      }
    }
    if (!onReorder || !over || active.id === over.id) return;
    const from = items.findIndex(item => getKey(item) === active.id);
    const to = items.findIndex(item => getKey(item) === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to).filter(item => !canReorder || canReorder(item)).map(getKey));
  };

  const PlaceholderIcon = type === 'music' ? BsDisc : BsFilm;
  const itemLabel = type === 'music' ? 'album' : 'movie';
  const itemLabelPlural = type === 'music' ? 'albums' : 'movies';

  // Render the icon
  const renderIcon = () => {
    if (!icon) return <BannerStar />;

    // If icon is a string, treat it as emoji
    if (typeof icon === 'string') {
      return <span className="next-banner__icon next-banner__icon--emoji">{icon}</span>;
    }

    // Otherwise render as-is (React element)
    return icon;
  };

  // Show the "Help me choose" card if smart fill is available
  const showHelpMeChoose = hasSmartFill;

  if ((!items || items.length === 0) && !hasSmartFill && !alwaysShow) return null;

  const draggedItem = dragged ? byKey.get(dragged) : undefined;
  const preview = draggedItem && getImageUrl ? getImageUrl(draggedItem) : null;
  // The row as it stands, with a cover from the strip in it while it is dragged there.
  const rowItems = hereKeys.flatMap(key => { const item = byKey.get(key); return item ? [item] : []; });
  const smallItems = otherKeys.flatMap(key => { const item = byKey.get(key); return item ? [item] : []; });
  // All of them when they fit; else one fewer than the strip holds, "+N" in the last one's place.
  const room = Math.min(holds, other?.most ?? Infinity);
  const shownSmall = smallItems.length <= room ? smallItems.length : Math.max(1, room - 1);

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={handleDragStart}
      onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={endDrag}>
    <div className={`next-banner ${className}${dragged ? ' next-banner--dragging' : ''}`} ref={bannerRef}>
      <div className="next-banner__header">
        <div className="next-banner__title-section">
          {renderIcon()}
          <h2 className="next-banner__title">{title}</h2>
          {headerControls ?? (
            <span className="next-banner__count">
              {items.length} {items.length === 1 ? itemLabel : itemLabelPlural}
            </span>
          )}
        </div>
      </div>

      <div className="next-banner__carousel">
        <SortableContext items={other ? hereKeys : items.map(getKey)} strategy={horizontalListSortingStrategy}>
        <NextBannerDrop id="here" className="next-banner__track-drop">
        <div className="next-banner__track">
          {(other ? rowItems : items).map((item) => (
            <SortableCard
              key={getKey(item)}
              id={getKey(item)}
              disabled={!onReorder || (canReorder ? !canReorder(item) : false)}
              still={Boolean(other)}
              landing={landing?.key === keyOf(item)}
              calm={calmKey === keyOf(item)}
              onLeave={() => setCalmKey(null)}
              className={`next-banner__card cover-host ${shufflingItemId === item.id ? 'shuffling' : ''} ${getCardClassName ? getCardClassName(item) : ''}`}
            >
              <CoverButton className="next-banner__remove-btn" onClick={(e) => handleRemove(e, item)} label={`Remove from ${title}`}>
                <BsX size={20} />
              </CoverButton>
              {renderCornerButton && renderCornerButton(item)}

              {/* The die: another suggestion in its place; music only. */}
              {type === 'music' && onShuffle && (!canShuffle || canShuffle(item)) && (
                <CoverButton
                  className="next-banner__shuffle-btn"
                  reveal={shufflingItemId === item.id ? 'always' : 'hover'}
                  onClick={(e) => handleShuffle(e, item)}
                  disabled={shufflingItemId !== null}
                  title={shuffleTitle}
                  label="Another suggestion"
                >
                  {shufflingItemId === item.id ? (
                    <Spinner size="sm" />
                  ) : (
                    // A die: another album drawn in its place. Crossed arrows are a mixtape's Shuffle.
                    <BsDice5 />
                  )}
                </CoverButton>
              )}

              <div
                className={`next-banner__image next-banner__image--${type}`}
                onClick={() => !justDragged.current && onItemClick && onItemClick(item.id)}
              >
                {renderCover ? renderCover(item) : getImageUrl && getImageUrl(item) ? (
                  <img
                    {...thumbProps(getImageUrl(item)!)}
                    decoding="async"
                    className="cover-img"
                    onLoad={coverReady}
                    alt={getTitle ? getTitle(item) : ''}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).parentElement!.classList.add('no-image');
                    }}
                  />
                ) : (
                  <div className="next-banner__placeholder">
                    <PlaceholderIcon size={40} />
                  </div>
                )}

                {renderBadges && <div className="next-banner__badges">{renderBadges(item)}</div>}
                {renderPlay && renderPlay(item)}
                {renderFootRight && renderFootRight(item)}
                {!renderCover && <ShelfCode kind={type === 'music' ? 'album' : 'movie'} id={item.id} />}
                {renderOverlay && renderOverlay(item)}

                {/* An album's title and artist under the pointer, in a tag slid out of the cover's left edge, above its ▶. */}
                {type === 'music' && !renderCover && (
                  <div className={`next-banner__caption${renderPlay ? '' : ' next-banner__caption--low'}`} aria-hidden="true">
                    <span className="next-banner__caption-title">{getTitle ? getTitle(item) : item.title}</span>
                    {getSubtitle && getSubtitle(item) && <span className="next-banner__caption-subtitle">{getSubtitle(item)}</span>}
                  </div>
                )}

                {/* Movie-style hover overlay */}
                {type === 'movie' && !renderCover && (
                  <div className="next-banner__overlay">
                    <h3 className="next-banner__overlay-title">
                      {getTitle ? getTitle(item) : item.title}
                    </h3>
                    <div className="next-banner__overlay-meta">
                      {getYear && getYear(item) && (
                        <span>{getYear(item)}</span>
                      )}
                      {getFormat && getFormat(item) && (
                        <span className="next-banner__format-tag">{getFormat(item)}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </SortableCard>
          ))}

          {/* "Help me choose" placeholder card */}
          {showHelpMeChoose && (
            // Its frame holds the click, and at its foot what a draw takes: the covers have no line under them for it.
            <div className={`next-banner__help-card next-banner__help-card--${type}${smartFillLoading ? ' loading' : ''}`}>
              <button type="button" className="next-banner__help-action" onClick={onSmartFill} disabled={smartFillLoading}>
                {smartFillLoading ? (
                  <span className="next-banner__help-loading">
                    <Spinner size="lg" />
                    <span className="next-banner__help-loading-text">Choosing...</span>
                  </span>
                ) : (
                  <>
                    <span className="next-banner__help-text">Help me choose</span>
                    <span className="next-banner__help-icon">+</span>
                  </>
                )}
              </button>
              {smartFillFoot && <div className="next-banner__help-foot">{smartFillFoot}</div>}
            </div>
          )}
        </div>
        </NextBannerDrop>
        </SortableContext>
      </div>
      {other && (
        <div className={`next-banner-other ${other.className ?? ''}`}>
          <NextBannerDrop id="other" className="next-banner-other__drop">
            {other.head}
            <span className="next-banner-other__hint">{other.dropHint}</span>
            <SortableContext items={otherKeys} strategy={horizontalListSortingStrategy}>
              <div className="next-banner-other__covers" ref={stripRef}>
                {smallItems.slice(0, live ? shownSmall + 1 : shownSmall).map(item => (
                  <SortableSmall key={keyOf(item)} id={keyOf(item)} title={other.titleOf?.(item) ?? (getTitle ? getTitle(item) : item.title || '')}
                    image={getImageUrl ? getImageUrl(item) : null} fallback={<PlaceholderIcon size={14} />}
                    onClick={() => { if (!justDragged.current) other.onShow(keyOf(item)); }} landing={landing?.key === keyOf(item)} />
                ))}
                {!live && smallItems.length > shownSmall && (
                  <button type="button" className="next-banner-other__more" onClick={other.onOpen}>+{smallItems.length - shownSmall}</button>
                )}
              </div>
            </SortableContext>
          </NextBannerDrop>
          {other.aside}
        </div>
      )}
      {footer}
    </div>
    {/* What is dragged, above everything, centred on the pointer: a card's side over the row, a small cover's over the strip. */}
    {other && dragged && pointer && typeof document !== 'undefined' && createPortal(
      <div className="next-banner__drag-preview" aria-hidden="true"
        style={{ width: previewPx, height: previewPx, left: pointer.x - previewPx / 2, top: pointer.y - previewPx / 2 }}>
        {preview ? <img src={preview} alt="" /> : <PlaceholderIcon size={28} />}
      </div>,
      document.body,
    )}
    {/* Dropped: it flies from the pointer to its place, straightening, at the size of the place. */}
    {landing && typeof document !== 'undefined' && createPortal(
      (() => {
        const to = landing.at ?? landing.from;
        return (
          <div className={`next-banner__drag-preview next-banner__drag-preview--landing${landing.at ? ' next-banner__drag-preview--landed' : ''}`} aria-hidden="true"
            style={{ width: to.px, height: to.px, left: to.x - to.px / 2, top: to.y - to.px / 2, transitionDuration: `${LAND_MS}ms`, borderRadius: landing.at ? (to.px > SMALL_PX ? 12 : 4) : undefined }}>
            {landing.image ? <img src={landing.image} alt="" /> : <PlaceholderIcon size={28} />}
          </div>
        );
      })(),
      document.body,
    )}
    </DndContext>
  );
};

export default NextBanner;
