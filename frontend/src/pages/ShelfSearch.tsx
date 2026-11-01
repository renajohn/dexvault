import React, { useEffect, useRef, useState } from 'react';
import { BsChevronDown, BsChevronUp, BsSearch, BsX } from 'react-icons/bs';
import type { ShelvedItem } from '../services/shelvingService';
import { IconButton } from '../components/shared/Button';
import '../components/shared/search/search-pills.css';
import { highlight, ordinal, thumbnail, type Hit, type Place } from './shelfFind';

/** How many suggestions of each section show under the field; ↵ and ▼ reach the others. */
const SHOWN = 5;

interface Props {
  query: string;
  onQuery: (query: string) => void;
  /** What matches in every section, section by section, each in the order it stands. */
  hits: Hit[];
  /** The one the list was taken to, -1 before any. */
  current: number;
  /** Where ↵ goes with none chosen: the first of the section shown, if it has one. */
  start: number;
  onGo: (index: number) => void;
  placeOf: (item: ShelvedItem) => Place | undefined;
}

/**
 * The search of the shelves, every section at once: typing moves nothing, it
 * lists what matches under the field, section by section, with the shelf each
 * stands on. The arrows choose one, ↵ takes the list to it (its section shown),
 * or to the first when none is chosen; once there, ▲ ▼ and ↵ go from one to
 * the next. ⌘F lands in it.
 */
const ShelfSearch: React.FC<Props> = ({ query, onQuery, hits, current, start, onGo, placeOf }) => {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  // The first few of each section, in sections; the arrows go through them in that order.
  const groups: Array<{ label: string; count: number; rows: Array<{ hit: Hit; index: number }> }> = [];
  hits.forEach((hit, index) => {
    const last = groups[groups.length - 1];
    const group = last?.label === hit.label ? last : (groups.push({ label: hit.label, count: 0, rows: [] }), groups[groups.length - 1]);
    group.count += 1;
    if (group.rows.length < SHOWN) group.rows.push({ hit, index });
  });
  const shown = groups.flatMap(group => group.rows);
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
      if (hits.length) go(expanded ? (active >= 0 ? shown[active].index : start) : (current + 1) % hits.length);
    } else if (event.key === 'Escape') {
      if (expanded) setOpen(false);
      else onQuery('');
    }
  };

  const count = !query.trim() ? null : !hits.length ? 'None' : current < 0 ? `${hits.length} found` : `${current + 1} / ${hits.length}`;

  return (
    // The field of the other sections' search (components/shared/search), words without pills.
    <div className={`search-pills shelves-search${focused ? ' is-focused' : ''}`}>
      <div className="search-pills__field"
        onMouseDown={event => { if (!(event.target as HTMLElement).closest('button')) { event.preventDefault(); input.current?.focus(); } }}>
        <BsSearch className="search-pills__lens" aria-hidden="true" />
        <div className="search-pills__content">
          <span className="search-pills__entry">
            <span className="search-pills__typing">
              <input
                ref={input}
                className="search-pills__input"
                type="text"
                placeholder="Find on the shelves…"
                aria-label="Find on the shelves"
                role="combobox"
                aria-expanded={expanded}
                aria-controls="shelf-suggestions"
                aria-autocomplete="list"
                aria-activedescendant={expanded && active >= 0 ? `shelf-suggestion-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={event => { onQuery(event.target.value); setOpen(true); setActive(-1); }}
                onKeyDown={onKeyDown}
                onFocus={() => { setFocused(true); setOpen(true); }}
                onBlur={() => { setFocused(false); setOpen(false); }}
              />
            </span>
          </span>
        </div>
        <div className="search-pills__end">
          {count && <span className={`shelves-search-count${!hits.length ? ' shelves-search-none' : ''}`} aria-hidden="true">{count}</span>}
          {query && (
            <IconButton label="Clear the search" size="sm" onClick={() => { onQuery(''); input.current?.focus(); }}><BsX /></IconButton>
          )}
          <IconButton label="Previous" size="sm" disabled={hits.length < 2}
            onClick={() => go(current < 0 ? hits.length - 1 : (current - 1 + hits.length) % hits.length)}><BsChevronUp /></IconButton>
          <IconButton label="Next" size="sm" disabled={hits.length < 2}
            onClick={() => go((current + 1) % hits.length)}><BsChevronDown /></IconButton>
        </div>
      </div>
      <span className="visually-hidden" role="status">{count}</span>
      {expanded && (
        // The pointer chooses without taking the focus from the field.
        <div className="menu-surface search-pills__menu shelf-suggestions" onMouseDown={event => event.preventDefault()}>
          {hits.length === 0 ? (
            <div className="shelf-suggestions-note">Nothing on the shelves matches.</div>
          ) : (
            <ul id="shelf-suggestions" role="listbox" aria-label="On the shelves">
              {groups.map(group => (
                <li key={group.label} role="group" aria-label={group.label}>
                  <div className="menu-section shelf-suggestions-section" aria-hidden="true">
                    {group.label} <span className="shelf-suggestions-count">{group.count}</span>
                  </div>
                  <ul role="none">
                    {group.rows.map(({ hit: { item, kept }, index }) => {
                      const at = shown.findIndex(row => row.index === index);
                      const place = placeOf(item);
                      const image = thumbnail(item.image);
                      return (
                        <li key={`${item.kind}:${item.id}`} id={`shelf-suggestion-${at}`} role="option" aria-selected={at === active}
                          className={`menu-item shelf-suggestion ${at === active ? 'menu-item--active' : ''}`}
                          onMouseEnter={() => setActive(at)} onClick={() => go(index)}>
                          <span className={`shelf-suggestion-cover ${item.kind === 'album' ? '' : 'shelf-cover-film'}`}>
                            {image && <img src={image} alt="" loading="lazy" />}
                          </span>
                          <span className="shelf-suggestion-info">
                            <span className="shelf-suggestion-name">{highlight(item.sortName, query)}</span>
                            <span className="shelf-suggestion-title">{highlight(item.title, query)}</span>
                          </span>
                          <span className="shelf-suggestion-where">
                            {kept ? <strong>{kept}</strong>
                              : item.code ? <><strong>{item.code}</strong>{place && <>{ordinal(place.nth)} from the left</>}</>
                              : 'No shelf yet'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {group.count > group.rows.length && (
                    <div className="shelf-suggestions-more">{group.count - group.rows.length} more in {group.label}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shown.length < hits.length && (
            <div className="shelf-suggestions-note">All of them: ↵, then ▼ from one to the next</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShelfSearch;
