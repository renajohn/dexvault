import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './star-rating.css';

/** Bootstrap Icons' star and star-fill, drawn here so that each half can take its own colour. */
const OUTLINE = 'M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z';
const FILL = 'M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z';

type Tone = 'given' | 'adding' | 'leaving' | 'seed' | null;

/** A finger's way up or down for half a star, on the dial. */
export const DIAL_STEP_PX = 12;
/** Where the dial starts on a record of no stars: up or down, never far. */
const DIAL_SEED = 3;
/** How long the dial shows after a mere touch, to say that it slides. */
const DIAL_HINT_MS = 1200;

/** The stars a finger drawn `dy` px up (negative down) from `from` gives: by halves, 0 to 5, no wrapping. */
export const dialValue = (from: number, dy: number): number =>
  Math.max(0, Math.min(5, from + Math.round(dy / DIAL_STEP_PX) / 2));


/**
 * The tone of one half star (1 to 10). Without the pointer, the stars given
 * are gold. Under it, the stars given stay gold, those a click would add are
 * white, those it would take away a pale gold: gold is what is on, never
 * what is pointed at.
 */
export const halfTone = (half: number, value: number, preview: number | null): Tone => {
  const given = value * 2;
  if (preview === null) return half <= given ? 'given' : null;
  const wanted = preview * 2;
  if (half <= Math.min(given, wanted)) return 'given';
  if (half > given && half <= wanted) return 'adding';
  if (half > wanted && half <= given) return 'leaving';
  return null;
};

/** One star of 16 by 16, each half in its tone; `id` keeps the halves' clips its own. */
const StarPaths: React.FC<{ id: string; star: number; tones: [Tone, Tone] }> = ({ id, star, tones }) => (
  <>
    <path className="ui-star__empty" d={OUTLINE} />
    {tones.map((tone, i) => tone && (
      <React.Fragment key={i}>
        <clipPath id={`${id}${star}${i ? 'r' : 'l'}`}>
          <rect x={i ? 8 : -1} y={-1} width={9} height={18} />
        </clipPath>
        <path className={`ui-star__${tone}`} clipPath={`url(#${id}${star}${i ? 'r' : 'l'})`} d={FILL} />
      </React.Fragment>
    ))}
  </>
);

/**
 * The dial a finger opens on the stars: large, in the middle of the screen,
 * above the finger that would hide them; the stars it gives as it goes up or
 * down, grey until the finger moves on a record of no stars. No number under
 * them: what they mean in words when the record has some (`describe`), and
 * under it a note, or how to move.
 */
/** What a number of stars means, and a word on it (where it stands in the collection), for the dial to say. */
export type StarWords = (stars: number) => { words: string; note?: string | null };

const StarDial: React.FC<{ value: number; seeded: boolean; hint: boolean; describe?: StarWords }> = ({ value, seeded, hint, describe }) => {
  const said = describe?.(value);
  const asking = hint || seeded;
  const id = `dial${useId().replace(/[^\w-]/g, '')}`;
  return createPortal(
    <div className="ui-star-dial menu-surface" aria-hidden="true">
      <span className="ui-star-dial__stars">
        {[1, 2, 3, 4, 5].map(star => (
          <svg key={star} viewBox="0 0 16 16">
            <StarPaths id={id} star={star} tones={[1, 0].map(right => (star * 2 - right <= value * 2 ? (seeded ? 'seed' : 'given') : null)) as [Tone, Tone]} />
          </svg>
        ))}
      </span>
      {/* Its lines always there, empty or not: the glass keeps its size as the finger goes. */}
      {said && <span className={`ui-star-dial__words${seeded ? ' ui-star-dial__words--seed' : ''}`}>{said.words}</span>}
      <span className="ui-star-dial__hint">{asking ? '↑ ↓ Slide up or down' : said?.note || '\u00a0'}</span>
    </div>,
    document.body,
  );
};

const starsLabel = (stars: number) => (stars ? `${stars} star${stars > 1 ? 's' : ''}` : 'No stars');

export interface StarRatingProps {
  /** The stars given, 0.5 to 5 by halves; 0 or null for none. */
  value: number | null | undefined;
  /** The stars a click gives, 0 when it takes them away (a click on the stars already given). */
  onChange: (value: number) => void;
  /** sm 13 px (a list), md 16 px (a record's card), lg 20 px. */
  size?: 'sm' | 'md' | 'lg';
  /** What the stars rate, for screen readers. */
  label?: string;
  className?: string;
  /** For the dial: what each number of stars means, in words, and a note on it. */
  describe?: StarWords;
}

/**
 * The owner's stars on a record, by halves: the left half of a star gives the
 * half. Gold, flat, no glow (star-rating.css). The stars never take the focus:
 * the arrows go from one record to the next. Under a finger, a dial instead
 * (StarDial): drawn up the stars go up, down they go down, by halves, from
 * those given or from 3 for none; let go, they are given. Back where it
 * started, or a mere touch, gives nothing: the touch shows the dial a moment.
 */
const StarRating: React.FC<StarRatingProps> = ({ value, onChange, size = 'md', label = 'Your rating', className, describe }) => {
  const [preview, setPreview] = useState<number | null>(null);
  // useId's colons or guillemets would break url(#…).
  const id = `stars${useId().replace(/[^\w-]/g, '')}`;
  const current = value || 0;
  // The finger on the stars: where it went down, from what, and what it gives now.
  const [dial, setDial] = useState<{ value: number; seeded: boolean; hint: boolean } | null>(null);
  const finger = useRef<{ y: number; from: number; seeded: boolean; moved: boolean } | null>(null);
  // The click that follows a finger is the finger's: the dial did the work.
  const touched = useRef(false);
  const hintTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    touched.current = event.pointerType !== 'mouse';
    if (!touched.current) return;
    // Followed wherever the finger goes; a pointer the browser no longer knows is not followed, the dial still opens.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not followed */ }
    window.clearTimeout(hintTimer.current);
    const seeded = !current;
    // From the half nearest: a book's 4.2 of another time turns as a 4.
    const from = seeded ? DIAL_SEED : Math.round(current * 2) / 2;
    finger.current = { y: event.clientY, from, seeded, moved: false };
    setDial({ value: from, seeded, hint: false });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const at = finger.current;
    if (!at) return;
    const dy = at.y - event.clientY;
    if (Math.abs(dy) >= DIAL_STEP_PX / 2) at.moved = true;
    if (!at.moved) return;
    const next = dialValue(at.from, dy);
    // Moved, the 3 of a record of no stars is a choice like the others: gold, given let go there.
    setDial({ value: next, seeded: false, hint: false });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLSpanElement>) => {
    const at = finger.current;
    finger.current = null;
    if (!at) return;
    if (!at.moved) {
      // A mere touch: the dial a moment, to say that it slides.
      setDial({ value: at.from, seeded: at.seeded, hint: true });
      hintTimer.current = window.setTimeout(() => setDial(null), DIAL_HINT_MS);
      return;
    }
    setDial(null);
    // Back to the stars given gives nothing; on a record of none, down to none is the way out.
    const next = dialValue(at.from, at.y - event.clientY);
    if (next !== current && (at.seeded || next !== at.from)) onChange(next);
  };
  const onPointerCancel = () => {
    finger.current = null;
    setDial(null);
  };

  const pointed = (event: React.MouseEvent<HTMLButtonElement>, star: number) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX - box.left < box.width / 2 ? star - 0.5 : star;
  };

  return (
    <span
      className={['ui-stars', `ui-stars--${size}`, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={`${label}: ${starsLabel(current)}`}
      onMouseLeave={() => setPreview(null)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const holds = current === star || current === star - 0.5;
        return (
          <button
            key={star}
            type="button"
            tabIndex={-1}
            className="ui-star"
            aria-label={starsLabel(star)}
            aria-pressed={holds}
            onMouseMove={event => setPreview(pointed(event, star))}
            onClick={event => {
              if (touched.current) return;
              const stars = pointed(event, star);
              setPreview(null);
              onChange(stars === current ? 0 : stars);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <StarPaths id={id} star={star} tones={[halfTone(star * 2 - 1, current, preview), halfTone(star * 2, current, preview)]} />
            </svg>
          </button>
        );
      })}
      {dial && <StarDial {...dial} describe={describe} />}
    </span>
  );
};

export default StarRating;
