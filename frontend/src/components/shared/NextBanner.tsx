import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import {
  DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type PointerSensorOptions, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
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
  /** A class of the banner's own. */
  className?: string;
}

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
  /** Under the cards, as the banner will have it. */
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

interface SortableCardProps {
  id: string | number;
  disabled: boolean;
  className: string;
  children: React.ReactNode;
}

/** A card of the banner, which a drag moves along the others. */
const SortableCard: React.FC<SortableCardProps> = ({ id, disabled, className, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition: transition || undefined };
  // Faded in when it appears, once: a card moved in the row is taken out and put back, which would play it again.
  const [entering, setEntering] = useState(true);
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-key={id}
      onAnimationEnd={event => { if (event.target === event.currentTarget) setEntering(false); }}
      className={`${className}${entering ? ' next-banner__card--entering' : ''}${isDragging ? ' next-banner__card--dragging' : ''}${disabled ? '' : ' next-banner__card--sortable'}`}
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
  className = '',
  getKey = item => item.id
}) => {
  const bannerRef = useRef<HTMLDivElement>(null);
  /** The card being dragged, while it is. */
  const [dragged, setDragged] = useState<string | null>(null);
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

  const handleDragStart = ({ active }: DragStartEvent) => setDragged(String(active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
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

  if ((!items || items.length === 0) && !hasSmartFill) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart}
      onDragEnd={handleDragEnd} onDragCancel={() => setDragged(null)}>
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
        <SortableContext items={items.map(getKey)} strategy={horizontalListSortingStrategy}>
        <div className="next-banner__track">
          {items.map((item) => (
            <SortableCard
              key={getKey(item)}
              id={getKey(item)}
              disabled={!onReorder || (canReorder ? !canReorder(item) : false)}
              className={`next-banner__card cover-host ${shufflingItemId === item.id ? 'shuffling' : ''} ${getCardClassName ? getCardClassName(item) : ''}`}
            >
              <CoverButton className="next-banner__remove-btn" onClick={(e) => handleRemove(e, item)} label={`Remove from ${title}`}>
                <BsX size={20} />
              </CoverButton>

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
        </SortableContext>
      </div>
      {footer}
    </div>
    </DndContext>
  );
};

export default NextBanner;
