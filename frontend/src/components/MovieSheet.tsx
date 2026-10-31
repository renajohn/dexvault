import React, { useEffect, useRef, useState } from 'react';
import { BsBoxArrowUpRight, BsCheck2, BsCopy, BsPencil, BsPlayFill, BsStar, BsStarFill, BsThreeDots, BsTrash, BsX } from 'react-icons/bs';
import apiService from '../services/api';
import { getLanguageName } from '../services/languageCountryUtils';
import MovieCover from './MovieCover';
import MovieThumbnail from './MovieThumbnail';
import MovieFilmages, { type MovieFilmagesData } from './MovieFilmages';
import MovieWarnings from './MovieWarnings';
import CompactRatingsWidget from './CompactRatingsWidget';
import CollectionTagsInput from './CollectionTagsInput';
import ShelfCode from './shared/ShelfCode';
import CoverButton from './shared/CoverButton';
import Segmented from './shared/Segmented';
import Menu, { MenuChevron } from './shared/Menu';
import Button, { IconButton, LinkButton } from './shared/Button';
import Select from './shared/Select';
import { TextArea, TextField } from './shared/TextField';
import { confirm } from './shared/ConfirmDialog';
import toast from './shared/Toast';
import './MovieSheet.css';

// As the API gives it: getMovieById's details, the grid's movie for the poster's tags.
type Movie = any;

interface CastMember {
  name: string;
  character?: string;
  local_profile_path?: string;
  profile_path?: string;
}

interface CollectionObj {
  id: number;
  name: string;
  type: string;
}

type Tab = 'film' | 'collections' | 'owned';

interface MovieSheetProps {
  /** The film opened: known at once, before its details. */
  movieId: number;
  /** getMovieById's details; null while they are read, the grid's movie standing in. */
  movie: Movie | null;
  /** The movie as the grid has it: its poster's tags (box set, collections, spiders and snakes). */
  listMovie?: Movie;
  /** Watch Next, in its order, as the page has it; without it, the sheet reads it itself. */
  watchNext?: Movie[];
  onWatchNextChange?: () => Promise<void> | void;
  onClose: () => void;
  onDelete?: (movieId: number) => Promise<void>;
  onRefresh?: () => void;
  onSearch?: (query: string) => void;
  onMovieClick?: (movieId: number) => void;
}

const DRAG_FROM_PX = 8;
const SWIPE_CLOSE_PX = 120;
const SLIDE_MS = 320;

/** A day as a date field holds it, YYYY-MM-DD, in the owner's time: toISOString's UTC made it the day before. */
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => dayOf(new Date());
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return dayOf(date); };

const longDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

const isoDate = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : dayOf(date);
};

const runtimeLabel = (minutes?: number) => {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours} h ${String(mins).padStart(2, '0')}` : `${mins} min`;
};

const dollars = (amount?: number) => amount
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 0 }).format(amount)
  : null;

const francs = (price?: number | string | null) => {
  const value = Number(price);
  return price != null && price !== '' && !isNaN(value) && value > 0
    ? new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2 }).format(value)
    : null;
};

const genresOf = (genres: Movie['genre']): string[] => {
  if (!genres) return [];
  if (Array.isArray(genres)) return genres.map((one: any) => (typeof one === 'object' && one ? one.name : String(one))).filter(Boolean);
  return String(genres).split(',').map(one => one.trim()).filter(Boolean);
};

const STATUS_LABELS: Record<string, string> = { owned: 'Owned', wish: 'Wish List', to_sell: 'To Sell' };

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/**
 * A film on a phone: a full screen as an album's, rather than its card. The
 * poster's light under it, a handle to draw it down by, a head that stays
 * (title, director, year, length, age, the shelf), and three tabs: the film,
 * all that one reads, on one scroll; its collections; the copy owned.
 */
const MovieSheet: React.FC<MovieSheetProps> = ({ movieId: id, movie: details, listMovie, watchNext: pageNext, onWatchNextChange, onClose, onDelete, onRefresh, onSearch, onMovieClick }) => {
  const [local, setLocal] = useState<Movie | null>(details);
  useEffect(() => { setLocal(details); }, [details]);
  const movie: Movie = { ...(listMovie ?? {}), ...(local ?? {}), id };
  const ready = local != null;

  // Watch Next: the page's (FilmDex), or read here (the wish list).
  const [ownNext, setOwnNext] = useState<Movie[]>([]);
  const readNext = async () => { setOwnNext(await apiService.getWatchNextMovies() as Movie[]); };
  useEffect(() => { if (!pageNext) readNext().catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const watchNext = pageNext ?? ownNext;

  const [tab, setTab] = useState<Tab>('film');
  useEffect(() => { setTab('film'); }, [id]);

  // In from the foot as it opens, back down as it goes.
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
  // Another film touched while it slides away: it stays, on that film.
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
  // Escape cancels an edit, then leaves a field, then closes.
  const editingRef = useRef<string | null>(null);
  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.modal.show, .menu-surface')) return;
      const field = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, .menu-select');
      if (editingRef.current) setEditing(null);
      else if (field) (document.activeElement as HTMLElement | null)?.blur();
      else close();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The cast, and the collections with their films.
  const [cast, setCast] = useState<CastMember[]>([]);
  const [collections, setCollections] = useState<CollectionObj[]>([]);
  const [members, setMembers] = useState<Record<string, Movie[]>>({});
  useEffect(() => {
    if (!id) return undefined;
    let gone = false;
    setCast([]);
    apiService.getMovieCast(id).then(found => { if (!gone) setCast(found as CastMember[]); }).catch(() => undefined);
    return () => { gone = true; };
  }, [id]);
  const readCollections = async () => {
    const [mine, all] = await Promise.all([
      apiService.getMovieCollections(id) as Promise<Array<{ collection_name: string }>>,
      apiService.getAllCollections() as Promise<CollectionObj[]>,
    ]);
    const objects = mine.map(one => all.find(c => c.name === one.collection_name)).filter((one): one is CollectionObj => one != null);
    setCollections(objects);
    const read = await Promise.all(objects.filter(c => c.type !== 'watch_next').map(async c => {
      try {
        const result = await apiService.getCollectionMovies(c.id) as { movies: Movie[] };
        return [c.name, result.movies] as const;
      } catch {
        return [c.name, [] as Movie[]] as const;
      }
    }));
    setMembers(Object.fromEntries(read));
  };
  useEffect(() => {
    if (!id) return;
    setCollections([]);
    setMembers({});
    readCollections().catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [filmagesAge, setFilmagesAge] = useState<{ movieId: number; age: number | null } | null>(null);
  const age: number | null | undefined = filmagesAge && filmagesAge.movieId === id ? filmagesAge.age : movie.recommended_age;
  const year = movie.release_date ? new Date(movie.release_date).getFullYear() : movie.year;
  const wished = movie.title_status === 'wish';

  const watchNextPlace = watchNext.findIndex((one: Movie) => one.id === id);
  const inWatchNext = watchNextPlace >= 0;
  const [togglingNext, setTogglingNext] = useState(false);
  const toggleWatchNext = async () => {
    setTogglingNext(true);
    try {
      await apiService.toggleWatchNext(id);
      await (onWatchNextChange ?? readNext)();
      if (!inWatchNext) toast(`“${movie.title}” is in Watch Next`, { tone: 'success' });
      else if (!wished) {
        toast(`“${movie.title}” is out of Watch Next`, { action: { label: 'Watched today', onClick: () => { void markWatched(today(), true); } } });
      }
      onRefresh?.();
    } catch {
      toast('Failed to update Watch Next', { tone: 'danger' });
    } finally {
      setTogglingNext(false);
    }
  };

  // Watched: today by default, another day from ▾, as many times as one likes.
  const [marking, setMarking] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const markWatched = async (date: string, increment: boolean) => {
    setMarking(true);
    try {
      const result = await apiService.markMovieAsWatched(id, date, increment) as { last_watched: string; watch_count: number };
      setLocal((current: Movie) => current && { ...current, last_watched: result.last_watched, watch_count: result.watch_count, never_seen: false });
      if (increment) toast(result.watch_count === 1 ? `“${movie.title}” seen` : `“${movie.title}” seen ${result.watch_count} times`, { tone: 'success' });
      onRefresh?.();
    } catch {
      toast('Failed to mark as watched', { tone: 'danger' });
    } finally {
      setMarking(false);
    }
  };
  const setWatchCount = async (count: number) => {
    try {
      const result = await apiService.updateMovieWatchCount(id, Math.max(0, count)) as { watch_count: number };
      setLocal((current: Movie) => current && { ...current, watch_count: result.watch_count });
      onRefresh?.();
    } catch {
      toast('Failed to update the watch count', { tone: 'danger' });
    }
  };
  const clearWatched = async () => {
    if (!await confirm({ title: 'Clear the watching?', message: 'The count goes back to none, and the last date with it.', confirmLabel: 'Clear', danger: true })) return;
    try {
      await apiService.clearMovieWatched(id);
      setLocal((current: Movie) => current && { ...current, last_watched: null, watch_count: 0 });
      onRefresh?.();
    } catch {
      toast('Failed to clear the watching', { tone: 'danger' });
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const [warningsVersion, setWarningsVersion] = useState(0);
  const refreshRatings = async () => {
    setRefreshing(true);
    try {
      const updated = await apiService.refreshMovieRatings(id) as Movie;
      setLocal((current: Movie) => ({ ...current, ...updated }));
      setWarningsVersion(v => v + 1);
    } catch {
      toast('Failed to refresh the ratings', { tone: 'danger' });
    } finally {
      setRefreshing(false);
    }
  };

  // One field of the copy at a time, edited in place.
  const [editing, setEditing] = useState<string | null>(null);
  editingRef.current = editing;
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const edit = (field: string, current: string) => { setEditing(field); setValue(current); };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing === 'title_status') await apiService.updateMovieStatus(id, value);
      else if (editing === 'last_watched') {
        // The last day is the watching's: updateMovie leaves it alone.
        const result = await apiService.markMovieAsWatched(id, value, false) as { last_watched: string; watch_count: number };
        setLocal((current: Movie) => current && { ...current, last_watched: result.last_watched, watch_count: result.watch_count });
      } else await apiService.updateMovie(id, { [editing]: value });
      if (editing !== 'last_watched') setLocal((current: Movie) => current && { ...current, [editing]: value });
      setEditing(null);
      onRefresh?.();
    } catch (error) {
      const err = error as { status?: number; data?: { error?: string }; message?: string };
      toast(err.status === 409 ? 'A movie with this title, format and TMDB ID is in the collection already' : `Failed to update: ${err.data?.error ?? err.message ?? 'unknown error'}`, { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); void save(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); }
  };
  const editActions = (
    <span className="movie-sheet-edit__actions">
      <IconButton label="Save" tone="confirm" size="sm" onClick={save} disabled={saving}><BsCheck2 /></IconButton>
      <IconButton label="Cancel" size="sm" onClick={() => setEditing(null)}><BsX /></IconButton>
    </span>
  );

  const changeCollections = async (names: string[]) => {
    try {
      const kept = collections.filter(c => c.type !== 'user').map(c => c.name);
      await apiService.updateMovieCollections(id, [...names, ...kept]);
      await readCollections();
      onRefresh?.();
    } catch {
      toast('Failed to update the collections', { tone: 'danger' });
    }
  };

  const askDelete = async () => {
    if (!onDelete) return;
    if (!await confirm({ title: `Delete “${movie.title}”?`, message: 'The film leaves DexVault, its poster and its watching with it.', confirmLabel: 'Delete', danger: true })) return;
    try {
      await onDelete(id);
      close();
    } catch {
      toast('Failed to delete the movie', { tone: 'danger' });
    }
  };

  const search = onSearch && ((query: string) => leaveFor(() => onSearch(query)));
  const director: string | undefined = movie.director;
  const genres = genresOf(movie.genre ?? movie.genres);
  const trailer = movie.trailer_key && movie.trailer_site === 'YouTube' ? `https://www.youtube.com/watch?v=${movie.trailer_key}` : null;
  const imdbLink = movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}` : movie.imdb_link;
  const tmdbLink = movie.tmdb_id ? `https://www.themoviedb.org/movie/${movie.tmdb_id}` : movie.tmdb_link;
  const rtLink = movie.rotten_tomatoes_link || (movie.original_title ? `https://www.rottentomatoes.com/m/${String(movie.original_title).toLowerCase().replace(/[^a-z0-9]/g, '_')}` : undefined);
  const plot: string | undefined = movie.plot || movie.overview;
  const backdrop: string | undefined = movie.backdrop_path;
  const scene = backdrop ? (backdrop.startsWith('http') || backdrop.startsWith('/') ? backdrop : `/api/images/${backdrop}`) : null;
  const [plotOpen, setPlotOpen] = useState(false);
  useEffect(() => { setPlotOpen(false); }, [id]);

  const shownCollections = collections.filter(c => c.type !== 'watch_next' && (c.type !== 'box_set' || (members[c.name]?.length ?? 0) > 1));
  const userCollections = collections.filter(c => c.type === 'user').map(c => c.name);
  const collectionCount = shownCollections.length + (inWatchNext ? 1 : 0);

  const thumbnail = (
    <MovieThumbnail imdbLink={imdbLink} title={movie.title} year={year} className="movie-sheet-thumb" disableZoom posterPath={movie.poster_path} recommendedAge={null} />
  );

  const head = (
    <div className="movie-sheet-head">
      {tab !== 'film' && <button type="button" className="movie-sheet-head__thumb" onClick={() => setTab('film')} aria-label="Back to the film">{thumbnail}</button>}
      <div className="movie-sheet-head__words">
        <span className="movie-sheet-head__title" title={movie.title}>{movie.title}</span>
        {director && (
          <button type="button" className="movie-sheet-head__director" disabled={!search} onClick={() => search?.(`director:"${director}"`)}>{director}</button>
        )}
        <span className="movie-sheet-head__facts">
          {[year, runtimeLabel(movie.runtime), age != null ? `${age}+` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      {!wished && <ShelfCode kind="movie" id={id} variant="inline" className="movie-sheet-head__shelf" onOpen={close} />}
      <Menu drop="down" align="end" label="More" trigger={props => (
        <button type="button" {...props} className="movie-sheet-head__more" aria-label="More"><BsThreeDots aria-hidden="true" /></button>
      )}>
        <Menu.Item icon={<BsCopy />} onSelect={() => {
          (navigator.clipboard?.writeText(movie.title ?? '') ?? Promise.reject(new Error('No clipboard')))
            .then(() => toast('Title copied', { tone: 'success' }), () => toast('The title could not be copied', { tone: 'danger' }));
        }}>Copy the title</Menu.Item>
        {onDelete && (
          <>
            <Menu.Separator />
            <Menu.Item icon={<BsTrash />} danger onSelect={askDelete}>Delete…</Menu.Item>
          </>
        )}
      </Menu>
    </div>
  );

  const film = (
    <div className="movie-sheet-scroll" key="film">
      {/* The poster as the grid shows it: its tags down the left, spiders and snakes among them, Watch Next's star top right. */}
      <div className="movie-sheet-poster">
        <MovieCover movie={movie}>
          <CoverButton className="watch-next-badge-large" reveal="always" active={inWatchNext} onClick={toggleWatchNext} disabled={togglingNext}
            label={inWatchNext ? 'Remove from Watch Next' : 'Add to Watch Next'}>
            {inWatchNext ? <BsStarFill aria-hidden="true" /> : <BsStar aria-hidden="true" />}
          </CoverButton>
        </MovieCover>
      </div>

      {!wished && (
        <div className="movie-sheet-watched ui-button-group">
          <Button className="movie-sheet-watched__main" icon={<BsCheck2 />} loading={marking} onClick={() => markWatched(today(), true)}>Watched today</Button>
          <Menu drop="down" align="end" label="Watched another day" trigger={(props, menuOpen) => (
            <Button {...props} className="ui-button--split" aria-label="Watched another day"><MenuChevron open={menuOpen} /></Button>
          )}>
            <Menu.Item onSelect={() => markWatched(daysAgo(1), true)}>Yesterday</Menu.Item>
            <Menu.Item onSelect={() => { dateInput.current?.showPicker?.(); dateInput.current?.focus(); }}>Another day…</Menu.Item>
          </Menu>
          <input ref={dateInput} type="date" className="movie-sheet-date" max={today()} aria-label="The day it was watched"
            onChange={event => { if (event.target.value) void markWatched(event.target.value, true); }} />
        </div>
      )}
      <div className="movie-sheet-seen">
        <span>
          {wished ? 'On your wish list'
            : movie.watch_count > 0 ? `Seen ${movie.watch_count === 1 ? 'once' : `${movie.watch_count} times`}${movie.last_watched ? ` · last on ${longDate(movie.last_watched)}` : ''}`
            : 'Never seen'}
        </span>
        {trailer && (
          <a className="movie-sheet-trailer" href={trailer} target="_blank" rel="noopener noreferrer" title="Opens YouTube">
            <BsPlayFill aria-hidden="true" /> Trailer <BsBoxArrowUpRight aria-hidden="true" />
          </a>
        )}
      </div>

      {/* The widget's own head, "Ratings" and ↻, worn as the sections' (MovieSheet.css). */}
      <section className="movie-sheet-section movie-sheet-ratings">
        <CompactRatingsWidget tmdbRating={movie.tmdb_rating} imdbRating={movie.imdb_rating} rottenTomatoRating={movie.rotten_tomato_rating}
          tmdbLink={tmdbLink} imdbLink={imdbLink} rottenTomatoesLink={rtLink} onRefresh={refreshRatings} refreshing={refreshing} />
      </section>

      {ready && (
        <section className="movie-sheet-section">
          <h5>For whom</h5>
          <MovieFilmages movieId={id} onChange={(data: MovieFilmagesData) => setFilmagesAge({ movieId: data.movieId, age: data.movieAge })} />
          <MovieWarnings key={warningsVersion} movieId={id} onSearch={search || undefined} />
        </section>
      )}

      {plot && (
        <section className="movie-sheet-section">
          <h5>Overview</h5>
          <p className={`movie-sheet-plot${plotOpen ? ' movie-sheet-plot--open' : ''}`}>{plot}</p>
          {plot.length > 280 && <Button variant="quiet" size="sm" className="movie-sheet-more" onClick={() => setPlotOpen(!plotOpen)}>{plotOpen ? 'Less' : 'More'}</Button>}
        </section>
      )}

      {cast.length > 0 && (
        <section className="movie-sheet-section">
          <h5>Cast</h5>
          <div className="movie-sheet-row">
            {cast.map((actor, i) => {
              const photo = actor.local_profile_path || actor.profile_path;
              return (
                <button key={`${actor.name}-${i}`} type="button" className="movie-sheet-person" disabled={!search} onClick={() => search?.(`actor:"${actor.name}"`)}>
                  {photo
                    ? <img className="movie-sheet-person__face" src={photo.startsWith('http') || photo.startsWith('/') ? photo : `/api/images/${photo}`} alt="" loading="lazy" />
                    : <span className="movie-sheet-person__face movie-sheet-person__face--none">{actor.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span>}
                  <span className="movie-sheet-person__name">{actor.name}</span>
                  {actor.character && <span className="movie-sheet-person__role">{actor.character}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {genres.length > 0 && (
        <section className="movie-sheet-section">
          <h5>Genres</h5>
          <div className="movie-sheet-chips">
            {genres.map(genre => <button key={genre} type="button" className="movie-sheet-chip" disabled={!search} onClick={() => search?.(`genre:"${genre}"`)}>{genre}</button>)}
          </div>
        </section>
      )}

      <section className="movie-sheet-section">
        <h5>The film</h5>
        <dl className="movie-sheet-facts">
          {movie.original_title && movie.original_title !== movie.title && <Fact label="Original title">{movie.original_title}</Fact>}
          {movie.original_language && <Fact label="Language">{getLanguageName(movie.original_language)}</Fact>}
          {movie.release_date && <Fact label="Released">{longDate(movie.release_date)}</Fact>}
          {dollars(movie.budget) && <Fact label="Budget">{dollars(movie.budget)}</Fact>}
          {dollars(movie.revenue) && <Fact label="Box office">{dollars(movie.revenue)}</Fact>}
        </dl>
      </section>

      {(tmdbLink || imdbLink || trailer) && (
        <section className="movie-sheet-section">
          <h5>Links</h5>
          <div className="movie-sheet-links">
            {tmdbLink && <LinkButton size="sm" href={tmdbLink} external>TMDB <BsBoxArrowUpRight aria-hidden="true" /></LinkButton>}
            {imdbLink && <LinkButton size="sm" href={imdbLink} external>IMDB <BsBoxArrowUpRight aria-hidden="true" /></LinkButton>}
            {rtLink && <LinkButton size="sm" href={rtLink} external>Rotten Tomatoes <BsBoxArrowUpRight aria-hidden="true" /></LinkButton>}
          </div>
        </section>
      )}
    </div>
  );

  const collectionsTab = (
    <div className="movie-sheet-scroll" key="collections">
      <section className="movie-sheet-section">
        <h5>Watch Next</h5>
        <div className="movie-sheet-next">
          <span className={`movie-sheet-next__star${inWatchNext ? ' movie-sheet-next__star--on' : ''}`} aria-hidden="true">{inWatchNext ? <BsStarFill /> : <BsStar />}</span>
          <span className="movie-sheet-next__words">
            {inWatchNext ? (
              <>
                <strong>{ordinal(watchNextPlace + 1)} of {watchNext.length}</strong>
                {/* The one before alone: two titles joined by "and" read as one ("Ant-Man and the Wasp"). */}
                {watchNextPlace > 0 && <span className="movie-sheet-muted"> · after {watchNext[watchNextPlace - 1].title}</span>}
              </>
            ) : <span className="movie-sheet-muted">Not in Watch Next</span>}
          </span>
          <Button size="sm" onClick={toggleWatchNext} loading={togglingNext}>{inWatchNext ? 'Take out' : 'Add'}</Button>
        </div>
      </section>

      {shownCollections.map(collection => {
        const films = members[collection.name] ?? [];
        return (
          <section key={collection.id} className="movie-sheet-section">
            <h5 className="movie-sheet-section__head">
              <span>{collection.type === 'box_set' ? `Box set · ${collection.name}` : collection.name}</span>
              <span className="movie-sheet-muted">{films.length} film{films.length === 1 ? '' : 's'}</span>
            </h5>
            <FilmRow>
              {films.map((other: Movie) => {
                const otherYear = other.release_date ? new Date(other.release_date).getFullYear() : other.year;
                const here = other.id === id;
                return (
                  <button key={other.id} type="button" title={other.title} className={`movie-sheet-mini${here ? ' movie-sheet-mini--here' : ''}`} disabled={here || !onMovieClick}
                    onClick={() => onMovieClick?.(other.id)}>
                    <MovieThumbnail imdbLink={other.imdb_id ? `https://www.imdb.com/title/${other.imdb_id}` : undefined} title={other.title} year={otherYear}
                      className="movie-sheet-mini__poster" disableZoom posterPath={other.poster_path} recommendedAge={null} />
                    <span className="movie-sheet-mini__title">{other.title}</span>
                    <span className="movie-sheet-muted movie-sheet-mini__year">{here ? 'this film' : otherYear}</span>
                  </button>
                );
              })}
            </FilmRow>
          </section>
        );
      })}

      {!wished && (
        <section className="movie-sheet-section">
          <h5>Your collections</h5>
          <CollectionTagsInput value={userCollections} onChange={changeCollections} placeholder="Add to a collection…" movieId={id} />
        </section>
      )}
    </div>
  );

  const fact = (field: string, label: string, shown: React.ReactNode, current: string, input: React.ReactNode) => (
    <Fact label={label}>
      {editing === field ? (
        <span className="movie-sheet-edit">{input}{editActions}</span>
      ) : (
        <button type="button" className="movie-sheet-editable" onClick={() => edit(field, current)}>
          {shown ?? <span className="movie-sheet-muted">—</span>}<BsPencil aria-hidden="true" />
        </button>
      )}
    </Fact>
  );

  const owned = (
    <div className="movie-sheet-scroll" key="owned">
      <section className="movie-sheet-section">
        <h5>{wished ? 'Wished' : 'The copy'}</h5>
        <dl className="movie-sheet-facts">
          {fact('format', 'Format', movie.format, movie.format ?? '', (
            <Select size="sm" value={value} onChange={event => setValue(event.target.value)} autoFocus>
              <option value="">Select format</option>
              <option value="Blu-ray">Blu-ray</option>
              <option value="Blu-ray 4K">Blu-ray 4K</option>
              <option value="DVD">DVD</option>
              <option value="Digital">Digital</option>
            </Select>
          ))}
          {fact('title_status', 'Status', STATUS_LABELS[movie.title_status ?? 'owned'], movie.title_status ?? 'owned', (
            <Select size="sm" value={value} onChange={event => setValue(event.target.value)} autoFocus>
              <option value="owned">Owned</option>
              <option value="wish">Wish List</option>
              <option value="to_sell">To Sell</option>
            </Select>
          ))}
          {fact('acquired_date', wished ? 'Wished since' : 'Acquired', longDate(movie.acquired_date), isoDate(movie.acquired_date), (
            <TextField size="sm" type="date" value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} autoFocus />
          ))}
          {!wished && fact('price', 'Price', francs(movie.price), movie.price != null ? String(movie.price) : '', (
            <TextField size="sm" type="number" inputMode="decimal" step="0.05" min="0" value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} suffix="CHF" autoFocus />
          ))}
        </dl>
      </section>

      {!wished && (
        <section className="movie-sheet-section">
          <h5>Watched</h5>
          <dl className="movie-sheet-facts">
            <Fact label="Times">
              <span className="movie-sheet-count">
                <IconButton label="Fewer" size="sm" boxed onClick={() => setWatchCount((movie.watch_count || 0) - 1)} disabled={!movie.watch_count}>−</IconButton>
                <span>{movie.watch_count || 0}</span>
                <IconButton label="More" size="sm" boxed onClick={() => setWatchCount((movie.watch_count || 0) + 1)}>+</IconButton>
              </span>
            </Fact>
            {fact('last_watched', 'Last', longDate(movie.last_watched), isoDate(movie.last_watched) || today(), (
              <TextField size="sm" type="date" max={today()} value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} autoFocus />
            ))}
          </dl>
          {(movie.watch_count > 0 || movie.last_watched) && (
            <Button variant="quiet" size="sm" className="movie-sheet-clear" onClick={clearWatched}>Clear the watching</Button>
          )}
        </section>
      )}

      <section className="movie-sheet-section">
        <h5>Comments</h5>
        {editing === 'comments' ? (
          <div className="movie-sheet-comments">
            <TextArea rows={4} value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} autoFocus />
            {editActions}
          </div>
        ) : (
          <button type="button" className="movie-sheet-note" onClick={() => edit('comments', movie.comments ?? '')}>
            {movie.comments || <span className="movie-sheet-muted">Write a comment…</span>}
          </button>
        )}
      </section>

      <section className="movie-sheet-section">
        <h5>In DexVault</h5>
        <p className="movie-sheet-muted movie-sheet-ids">
          {[movie.tmdb_id && `TMDB ${movie.tmdb_id}`, movie.imdb_id && `IMDB ${movie.imdb_id}`].filter(Boolean).join(' · ') || 'No TMDB or IMDB entry'}
        </p>
      </section>

      {onDelete && (
        <div className="movie-sheet-manage">
          <Button variant="danger" icon={<BsTrash />} onClick={askDelete}>Delete</Button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={movie.title}
      className={`movie-sheet movie-sheet--${tab}${open ? ' movie-sheet--open' : ''}`}>
      {/* Under it all, as the card on a computer: the film's scene, faint, fading down; or else its poster, blurred. */}
      <div className={`movie-sheet-backdrop${scene ? ' movie-sheet-backdrop--scene' : ''}`} aria-hidden="true">
        {scene ? <img src={scene} alt="" /> : movie.poster_path && <img src={movie.poster_path} alt="" />}
      </div>
      <div className="movie-sheet-inner">
        <button type="button" className="movie-sheet-handle" onClick={close} aria-label="Close"><span /></button>
        {head}
        <Segmented<Tab> kind="tabs" size="sm" block label="Show" className="movie-sheet-tabs" value={tab} onChange={setTab} options={[
          { value: 'film', label: 'Film' },
          { value: 'collections', label: 'Collections', count: collectionCount > 0 ? collectionCount : undefined },
          { value: 'owned', label: wished ? 'Wished' : 'Owned' },
        ]} />
        {tab === 'film' ? film : tab === 'collections' ? collectionsTab : owned}
      </div>
    </div>
  );
};

/** A collection's films across, opened on this film's place: in the middle when it can be. */
const FilmRow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const row = useRef<HTMLDivElement>(null);
  const count = React.Children.count(children);
  useEffect(() => {
    const here = row.current?.querySelector<HTMLElement>('.movie-sheet-mini--here');
    if (row.current && here) row.current.scrollLeft = here.offsetLeft - (row.current.clientWidth - here.offsetWidth) / 2;
  }, [count]);
  return <div ref={row} className="movie-sheet-row">{children}</div>;
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
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
        sheet.classList.toggle('movie-sheet--drag', dy != null);
        sheet.style.transform = dy != null ? `translateY(${dy}px)` : '';
      });
    };
    const begin = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      touch = event.touches.length === 1 && !target?.closest('input, textarea, .menu-surface')
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: event.timeStamp, list: target?.closest<HTMLElement>('.movie-sheet-scroll') ?? null, mode: 'undecided' }
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
      if (Math.abs(dx) > Math.abs(dy) && target?.closest('.movie-sheet-row')) return;
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
      const list = event.target instanceof Element ? event.target.closest<HTMLElement>('.movie-sheet-scroll') : null;
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

export default MovieSheet;
