import React, { useEffect, useRef, useState } from 'react';
import { BsChevronDown, BsChevronUp } from 'react-icons/bs';
import type { ShelvedItem } from '../services/shelvingService';
import { TextField } from '../components/shared/TextField';
import { IconButton } from '../components/shared/Button';
import { highlight, ordinal, thumbnail, type Place } from './shelfFind';

/** How many suggestions show under the field; ↵ and ▼ reach the others. */
const SHOWN = 8;

interface Props {
  query: string;
  onQuery: (query: string) => void;
  /** What matches, in the order it stands. */
  hits: ShelvedItem[];
  /** The one the list was taken to, -1 before any. */
  current: number;
  onGo: (index: number) => void;
  placeOf: (item: ShelvedItem) => Place | undefined;
  /** Its box, for the page to hold it at the top of a phone's screen. */
  boxRef?: React.Ref<HTMLDivElement>;
}

/**
 * The search of a section: typing moves nothing, it lists what matches under
 * the field with the shelf each stands on. The arrows choose one, ↵ takes the
 * list to it, or to the first when none is chosen; once there, ▲ ▼ and ↵ go
 * from one to the next. ⌘F lands in it.
 */
const ShelfSearch: React.FC<Props> = ({ query, onQuery, hits, current, onGo, placeOf, boxRef }) => {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = hits.slice(0, SHOWN);
  const expanded = open && query.trim() !== '';

  // ⌘F, Ctrl+F: the search of the shelves, not the browser's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (index: number) => {
    setOpen(false);
    onGo(index);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // Once at a result the suggestions are closed: an arrow opens them again.
      if (!expanded) { setOpen(true); return; }
      if (!shown.length) return;
      setActive(event.key === 'ArrowDown' ? (active + 1) % shown.length : (active <= 0 ? shown.length : active) - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (hits.length) go(expanded ? Math.max(active, 0) : (current + 1) % hits.length);
    } else if (event.key === 'Escape') {
      if (expanded) setOpen(false);
      else onQuery('');
    }
  };

  const count = !query.trim() ? null : !hits.length ? 'None' : current < 0 ? `${hits.length} found` : `${current + 1} / ${hits.length}`;

  return (
    <div ref={boxRef} className="shelves-search">
      <TextField
        ref={input}
        size="sm"
        type="search"
        placeholder="Find on the shelves…"
        aria-label="Find on the shelves"
        role="combobox"
        aria-expanded={expanded}
        aria-controls="shelf-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `shelf-suggestion-${active}` : undefined}
        autoComplete="off"
        value={query}
        // Always a suffix, even empty: the field would otherwise be drawn anew, and lose the focus, at the first letter.
        suffix={<span className={count && !hits.length ? 'shelves-search-none' : undefined}>{count}</span>}
        onChange={event => { onQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <IconButton label="Previous" size="sm" disabled={hits.length < 2}
        onClick={() => go(current < 0 ? hits.length - 1 : (current - 1 + hits.length) % hits.length)}><BsChevronUp /></IconButton>
      <IconButton label="Next" size="sm" disabled={hits.length < 2}
        onClick={() => go((current + 1) % hits.length)}><BsChevronDown /></IconButton>
      <span className="visually-hidden" role="status">{count}</span>
      {expanded && (
        // The pointer chooses without taking the focus from the field.
        <div className="shelf-suggestions menu-surface" onMouseDown={event => event.preventDefault()}>
          {hits.length === 0 ? (
            <div className="shelf-suggestions-note">Nothing on these shelves matches.</div>
          ) : (
            <ul id="shelf-suggestions" role="listbox" aria-label="On the shelves">
              {shown.map((item, index) => {
                const place = placeOf(item);
                const image = thumbnail(item.image);
                return (
                  <li key={`${item.kind}:${item.id}`} id={`shelf-suggestion-${index}`} role="option" aria-selected={index === active}
                    className={`menu-item shelf-suggestion ${index === active ? 'menu-item--active' : ''}`}
                    onMouseEnter={() => setActive(index)} onClick={() => go(index)}>
                    <span className={`shelf-suggestion-cover ${item.kind === 'album' ? '' : 'shelf-cover-film'}`}>
                      {image && <img src={image} alt="" loading="lazy" />}
                    </span>
                    <span className="shelf-suggestion-info">
                      <span className="shelf-suggestion-name">{highlight(item.sortName, query)}</span>
                      <span className="shelf-suggestion-title">{highlight(item.title, query)}</span>
                    </span>
                    <span className="shelf-suggestion-where">
                      {item.code ? <><strong>{item.code}</strong>{place && <>{ordinal(place.nth)} from the left</>}</> : 'No shelf yet'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {hits.length > SHOWN && (
            <div className="shelf-suggestions-note">{hits.length - SHOWN} more: ↵ goes to the first, then ▼ to the next</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShelfSearch;
