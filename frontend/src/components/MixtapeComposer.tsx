import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BsCassetteFill, BsCheck2, BsChevronRight, BsDash, BsHeartFill, BsSearch } from 'react-icons/bs';
import TextField from './shared/TextField';
import Spinner from './shared/Spinner';
import musicService, { type MixtapeSearchAlbum, type MixtapeSearchResult, type MixtapeSearchSong, type MixtapeSearchWork } from '../services/musicService';
import { heldOf, toggleSongs, type Held, type Places } from '../utils/mixtapeCompose';
import './MixtapeComposer.css';

interface MixtapeComposerProps {
  /** The mixtape's songs as they stand, a toggle's change in them at once. */
  songIds: string[];
  /** The songs once toggled, for the mixtape to send them to Navidrome. */
  onSongs: (songIds: string[]) => void;
  /** Under the field in the menus' glass, over what follows (a computer); or in a list of its own below it (an iPhone's sheet). */
  variant?: 'popover' | 'sheet';
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

type Row =
  | { kind: 'album'; key: string; album: MixtapeSearchAlbum; section?: string }
  | { kind: 'work'; key: string; work: MixtapeSearchWork | { key: string; name: string; songs: MixtapeSearchSong[] }; nested?: boolean; section?: string }
  | { kind: 'song'; key: string; song: MixtapeSearchSong; under?: 'album' | 'work'; section?: string };

const DEBOUNCE_MS = 150;

const time = (seconds: number | null): string => {
  if (seconds == null) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const minutes = (songs: MixtapeSearchSong[]): string =>
  `${Math.round(songs.reduce((total, song) => total + (song.durationSec || 0), 0) / 60)} min`;

/** "Dvořák · Ozawa": the composer and the last who plays it, by their surnames. */
const whoPlays = (artists: string[]): string => {
  const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0];
  return artists.length > 1 ? `${surname(artists[0])} · ${surname(artists[artists.length - 1])}` : artists[0] || '';
};

const idsOf = (songs: MixtapeSearchSong[]) => songs.map(song => song.songId);

/** An album's songs, its works' movements under their head. */
const albumRows = (album: MixtapeSearchAlbum): Row[] => {
  const rows: Row[] = [];
  for (let at = 0; at < album.songs.length;) {
    const song = album.songs[at];
    let end = at;
    while (song.work && album.songs[end + 1]?.work === song.work && album.songs[end + 1].discNumber === song.discNumber) end++;
    if (end > at) {
      const songs = album.songs.slice(at, end + 1);
      rows.push({ kind: 'work', key: `w${album.albumId}:${at}`, work: { key: `${album.albumId}:${at}`, name: song.work!, songs }, nested: true });
      songs.forEach(one => rows.push({ kind: 'song', key: `s${one.songId}:a`, song: one, under: 'work' }));
    } else rows.push({ kind: 'song', key: `s${song.songId}:a`, song, under: 'album' });
    at = end + 1;
  }
  return rows;
};

const Check: React.FC<{ held: Held }> = ({ held }) => (
  <span className={`mixtape-find__check mixtape-find__check--${held}`} aria-hidden="true">
    {held === 'some' ? <BsDash /> : <BsCheck2 />}
  </span>
);

const Thumb: React.FC<{ cover: string | null }> = ({ cover }) => (
  <span className="mixtape-find__thumb" aria-hidden="true">
    {cover ? <img src={musicService.getImageUrl(cover) ?? undefined} alt="" loading="lazy" /> : <BsCassetteFill />}
  </span>
);

/**
 * A mixtape's Add tracks…: the words typed find what plays, albums, works
 * and songs, each ticked or not as the mixtape holds it; a click or ↵ toggles
 * it there (the list staying open), an album ticked opening for what is not
 * wanted to be unticked. A song taken out and ticked again, the words kept,
 * goes back where it stood.
 */
const MixtapeComposer: React.FC<MixtapeComposerProps> = ({ songIds, onSongs, variant = 'popover', autoFocus, inputRef }) => {
  const [words, setWords] = useState('');
  const [result, setResult] = useState<MixtapeSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const places = useRef<Places>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const idsRef = useRef(songIds);
  idsRef.current = songIds;

  // The words changed: a new search, and the places of the last ones forgotten.
  useEffect(() => {
    places.current.clear();
    setActive(0);
    setExpanded(new Set());
    const query = words.trim();
    if (!query) { setResult(null); setSearching(false); return undefined; }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      musicService.searchForMixtape(query, abort.signal)
        .then(found => { setResult(found); setFailed(false); })
        .catch(error => { if ((error as Error).name !== 'AbortError') setFailed(true); })
        .finally(() => { if (!abort.signal.aborted) setSearching(false); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [words]);

  const rows = useMemo((): Row[] => {
    if (!result) return [];
    const out: Row[] = [];
    const opened = new Set(result.albums.filter(album => expanded.has(`a${album.albumId}`)).map(album => album.albumId));
    result.albums.forEach((album, at) => {
      out.push({ kind: 'album', key: `a${album.albumId}`, album, section: at === 0 ? 'Albums' : undefined });
      if (opened.has(album.albumId)) out.push(...albumRows(album));
    });
    result.works.filter(work => !opened.has(work.albumId)).forEach((work, at) => {
      out.push({ kind: 'work', key: `w${work.key}`, work, section: at === 0 ? 'Works' : undefined });
      if (expanded.has(`w${work.key}`)) work.songs.forEach(song => out.push({ kind: 'song', key: `s${song.songId}:w`, song, under: 'work' }));
    });
    result.tracks.filter(song => !opened.has(song.albumId)).forEach((song, at) => {
      out.push({ kind: 'song', key: `s${song.songId}`, song, section: at === 0 ? 'Tracks' : undefined });
    });
    return out;
  }, [result, expanded]);

  const songsOfRow = (row: Row): MixtapeSearchSong[] =>
    row.kind === 'album' ? row.album.songs : row.kind === 'work' ? row.work.songs : [row.song];

  const toggle = (row: Row) => {
    const next = toggleSongs(idsRef.current, idsOf(songsOfRow(row)), places.current);
    // An album ticked opens, for what is not wanted to be unticked.
    if (row.kind === 'album' && next.length > idsRef.current.length) setExpanded(open => new Set(open).add(row.key));
    setFlash(row.key);
    onSongs(next);
  };

  const fold = (row: Row, open?: boolean) => {
    if (row.kind === 'song' || (row.kind === 'work' && row.nested)) return;
    setExpanded(was => {
      const next = new Set(was);
      if (open ?? !next.has(row.key)) next.add(row.key); else next.delete(row.key);
      return next;
    });
  };

  // The line the keys are on stays in sight.
  useEffect(() => {
    listRef.current?.querySelector('.menu-item--active')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const row = rows[active];
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(rows.length - 1, active + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (row) toggle(row); }
    else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && row && event.currentTarget.selectionStart === words.length) {
      if (row.kind === 'album' || (row.kind === 'work' && !row.nested)) { event.preventDefault(); fold(row, event.key === 'ArrowRight'); }
    } else if (event.key === 'Escape' && words) {
      // Esc empties the field; on an empty one it goes on, and closes the window.
      event.preventDefault();
      event.stopPropagation();
      setWords('');
    }
  };

  const shown = variant === 'sheet' || (focused && words.trim().length > 0);

  const renderRow = (row: Row, at: number) => {
    const held = heldOf(songIds, idsOf(songsOfRow(row)));
    const className = ['menu-item', 'mixtape-find__row', `mixtape-find__row--${row.kind}`,
      row.kind === 'work' && row.nested ? 'mixtape-find__row--nested' : '',
      row.kind === 'song' && row.under ? `mixtape-find__row--under-${row.under}` : '',
      expanded.has(row.key) ? 'mixtape-find__row--open' : '',
      at === active ? 'menu-item--active' : '', flash === row.key ? 'mixtape-find__row--flash' : ''].filter(Boolean).join(' ');
    const chevron = (row.kind === 'album' || (row.kind === 'work' && !row.nested)) && (
      <span role="button" tabIndex={-1} className="mixtape-find__chevron"
        title={expanded.has(row.key) ? 'Fold' : row.kind === 'album' ? 'Show its tracks' : 'Show its movements'}
        onClick={event => { event.stopPropagation(); fold(row); }}>
        <BsChevronRight />
      </span>
    );
    let body: React.ReactNode;
    if (row.kind === 'album') {
      body = <>
        {chevron}<Thumb cover={row.album.cover} />
        <span className="mixtape-find__text"><b>{row.album.title}</b><span>Album · {row.album.artist} · {row.album.songs.length} tracks</span></span>
      </>;
    } else if (row.kind === 'work') {
      const work = row.work;
      body = row.nested ? (
        <span className="mixtape-find__text"><b>{work.name}</b><span>{work.songs.length} movements · {minutes(work.songs)}</span></span>
      ) : <>
        {chevron}<Thumb cover={(work as MixtapeSearchWork).cover} />
        <span className="mixtape-find__text"><b>{work.name}</b>
          <span>Work · {work.songs.length} movements · {minutes(work.songs)} · {whoPlays((work as MixtapeSearchWork).artists)}</span></span>
      </>;
    } else {
      const song = row.song;
      body = <>
        {row.under ? <span className="mixtape-find__no">{song.track}</span> : null}
        <span className="mixtape-find__dot" title={song.popular ? "One of the album's most listened" : undefined}>{song.popular && <i />}</span>
        {!row.under && <Thumb cover={song.cover} />}
        <span className="mixtape-find__text">
          <b>{row.under === 'work' && song.movement ? song.movement : song.title}</b>
          {!row.under && <span>{song.artist} · {song.album}</span>}
        </span>
        {song.starred && <BsHeartFill className="mixtape-find__heart" aria-label="A favourite" />}
        <span className="mixtape-find__time">{time(song.durationSec)}</span>
      </>;
    }
    const label = row.kind === 'album' ? row.album.title : row.kind === 'work' ? row.work.name
      : row.under === 'work' && row.song.movement ? row.song.movement : row.song.title;
    return (
      <React.Fragment key={row.key}>
        {row.section && <div className="menu-section mixtape-find__section">{row.section}</div>}
        <div role="option" aria-selected={held === 'all'} aria-label={label} className={className}
          onClick={() => { setActive(at); toggle(row); }}
          onMouseMove={() => { if (active !== at) setActive(at); }}>
          {body}
          {held === 'some' && <span className="mixtape-find__some">{idsOf(songsOfRow(row)).filter(id => songIds.includes(id)).length} of {songsOfRow(row).length}</span>}
          <Check held={held} />
        </div>
      </React.Fragment>
    );
  };

  return (
    <div className={`mixtape-find mixtape-find--${variant}`}>
      <TextField ref={inputRef} icon={<BsSearch />} value={words} autoFocus={autoFocus} autoComplete="off" spellCheck={false}
        placeholder="Add tracks… a title, an artist, an album" aria-label="Add tracks" enterKeyHint="search"
        suffix={searching ? <Spinner size="sm" /> : undefined}
        // Typed in, it has the focus, told or not (a window behind another is told no focus).
        onChange={event => { setWords(event.target.value); setFocused(true); }}
        onFocus={() => setFocused(true)}
        // Left, the places are forgotten: a song ticked again after goes at the end.
        onBlur={() => { setFocused(false); places.current.clear(); }}
        onKeyDown={onKeyDown} />
      {shown && words.trim() && (
        <div ref={listRef} role="listbox" aria-label="Found"
          className={`mixtape-find__list${variant === 'popover' ? ' menu-surface' : ''}`}
          // A click on a line keeps the field's focus, and its places.
          onMouseDown={event => event.preventDefault()}>
          {failed ? <div className="mixtape-find__none">Navidrome did not answer.</div>
            : result && rows.length === 0 && !searching ? <div className="mixtape-find__none">Nothing that plays for “{words.trim()}”.</div>
              : rows.map(renderRow)}
        </div>
      )}
    </div>
  );
};

export default MixtapeComposer;
