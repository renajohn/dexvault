import React, { useEffect, useRef, useState } from 'react';
import { BsBook, BsBoxArrowUpRight, BsCamera, BsCheck2, BsDownload, BsFiles, BsPencil, BsPlus, BsThreeDots, BsTrash, BsX } from 'react-icons/bs';
import bookService from '../services/bookService';
import bookCommentService from '../services/bookCommentService';
import bookSectionsService from '../services/bookSectionsService';
import { BookStarRating } from './RecordStarRating';
import SeriesNotes from './SeriesNotes';
import CoverModal from './CoverModal';
import InlineCoverSelector from './InlineCoverSelector';
import CoverButton from './shared/CoverButton';
import CoverTag, { CoverTagStack } from './shared/CoverTag';
import Segmented from './shared/Segmented';
import Menu from './shared/Menu';
import Button, { IconButton, LinkButton } from './shared/Button';
import Select from './shared/Select';
import { TextArea, TextField } from './shared/TextField';
import { confirm } from './shared/ConfirmDialog';
import toast from './shared/Toast';
import PhoneSheet, { Fact, SheetRow, francs, isoDate, longDate, today, usePhoneSheet } from './PhoneSheet';
import './BookSheet.css';

// As the API gives it: getBookById's details, the page's book standing in while they are read.
type Book = any;

interface Review {
  id: number;
  name: string;
  comment: string;
  date?: string;
}

type Tab = 'book' | 'series' | 'copy';

interface BookSheetProps {
  /** The book opened: known at once, before its details. */
  bookId: number;
  /** getBookById's details; null while they are read. */
  book: Book | null;
  /** The book as the page has it. */
  listBook?: Book;
  /** The page's books: the others of its author. */
  books?: Book[];
  onClose: () => void;
  /** Saved: the page reads its books and this one again. */
  onUpdated?: (book: Book) => void;
  onDelete?: (bookId: number) => Promise<void>;
  onSearch?: (query: string) => void;
  onBookClick?: (bookId: number) => void;
  /** The card's edit, over the sheet (BookDetailCard `only`). */
  onEdit?: () => void;
  /** The card's next volumes of the series, over the sheet: the library only. */
  onNextVolumes?: () => void;
  /** The series in the page's search: the library only, which knows `series:`. */
  onShowSeries?: (series: string) => void;
}

const COMMENTER = 'dv.readingName';
const readName = () => { try { return localStorage.getItem(COMMENTER) || ''; } catch { return ''; } };
const keepName = (name: string) => { try { localStorage.setItem(COMMENTER, name); } catch { /* a private window */ } };

const LANGUAGES: Record<string, string> = {
  fr: 'French', en: 'English', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
};
const languageOf = (code?: string) => (code ? LANGUAGES[code.toLowerCase()] ?? code.toUpperCase() : null);

const KINDS: Record<string, string> = { book: 'book', 'graphic-novel': 'graphic novel', score: 'score' };
const FORMATS: Record<string, string> = { physical: 'physical', ebook: 'e-book', audiobook: 'audiobook' };
const STATUSES: Record<string, string> = { owned: 'Owned', borrowed: 'Borrowed', wish: 'Wish List' };

const LINK_NAMES: Record<string, string> = {
  googleBooks: 'Google Books', amazon: 'Amazon', openlibrary: 'Open Library', IMSLP: 'IMSLP',
};
const linkName = (key: string) => LINK_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
// A second page of a site already linked (Info, Preview, Work): one link a site.
const isSecondaryLink = (key: string) => /(Info|Preview|Work)$/.test(key);

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : value ? String(value).split(/,\s*/).filter(Boolean) : [];

const isbnShown = (isbn?: string) => {
  const digits = String(isbn ?? '').replace(/\D/g, '');
  return digits.length === 13 ? `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12)}` : isbn;
};

/**
 * A book on a phone: a full screen as a film's (PhoneSheet) rather than its
 * card. Its cover's light under it, a head that stays (title, authors, year,
 * pages, language), and three tabs: the book, all that one reads; its series;
 * the copy (owned, borrowed or wished).
 */
const BookSheet: React.FC<BookSheetProps> = ({ bookId: id, book: details, listBook, books = [], onClose, onUpdated, onDelete, onSearch, onBookClick, onEdit, onNextVolumes, onShowSeries }) => {
  const [local, setLocal] = useState<Book | null>(details);
  useEffect(() => { setLocal(details); }, [details]);
  const book: Book = { ...(listBook ?? {}), ...(local ?? {}), id };
  const ready = local != null;

  const [tab, setTab] = useState<Tab>('book');
  useEffect(() => { setTab('book'); }, [id]);

  const editingRef = useRef<string | null>(null);
  // Escape cancels an edit before it closes; a review or a reading being written holds it open, its words kept.
  const draftRef = useRef(false);
  // A cover shown whole goes first (CoverModal has no Escape of its own).
  const showingRef = useRef(false);
  const sheet = usePhoneSheet(id, onClose, () => {
    if (showingRef.current) { setShown(null); return true; }
    if (editingRef.current) { setEditing(null); return true; }
    return draftRef.current;
  });
  const { close, leaveFor } = sheet;
  const search = onSearch && ((query: string) => leaveFor(() => onSearch(query)));

  // Saved whole: the server wants every field back (BookDetailCard does so).
  const save = async (changes: Record<string, unknown>) => {
    if (!local) return false;
    const next = { ...local, ...changes };
    setLocal(next);
    try {
      await bookService.updateBook(id, next);
      onUpdated?.(next);
      return true;
    } catch (error) {
      setLocal(local);
      toast(`Failed to save: ${(error as Error).message}`, { tone: 'danger' });
      return false;
    }
  };

  // The readings, every date.
  const [readings, setReadings] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setReadings([]);
    if (book.readDate) {
      bookSectionsService.readingsOf(id)
        .then(list => { if (live) setReadings(list.map(one => one.readDate).filter((day): day is string => Boolean(day)).sort()); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [id, book.readDate]);
  const readDays = readings.length ? readings : book.readDate ? [String(book.readDate).slice(0, 10)] : [];

  // Read (again): the day, today unless changed, and what one thought, if one wishes.
  const [rereading, setRereading] = useState<string | null>(null);
  const [rereadWords, setRereadWords] = useState('');
  const keepReading = async () => {
    if (!rereading) return;
    try {
      const reading = await bookSectionsService.addReading(id, rereading);
      if (rereadWords.trim()) {
        await bookCommentService.createComment({ bookId: id, readingId: reading.id, name: readName() || 'Renault', comment: rereadWords.trim(), date: new Date().toISOString() });
        setRereadWords('');
        void readReviews();
      }
      const days = [...readDays, rereading].sort();
      setReadings(days);
      setRereading(null);
      toast(readDays.length ? 'Read again: a new reading in the journal' : 'Marked as read', { tone: 'success' });
      setLocal((current: Book) => current && { ...current, readDate: days[days.length - 1] });
      onUpdated?.({ ...book, readDate: days[days.length - 1] });
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' });
    }
  };

  // The reviews: read, written, changed, taken away.
  const [reviews, setReviews] = useState<Review[]>([]);
  const readReviews = async () => {
    try { setReviews(await bookCommentService.getCommentsByBookId(id) as Review[]); } catch { setReviews([]); }
  };
  useEffect(() => { setReviews([]); void readReviews(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [writing, setWriting] = useState<{ id: number | null; name: string; comment: string } | null>(null);
  const saveReview = async () => {
    if (!writing || !writing.comment.trim() || !writing.name.trim()) return;
    try {
      const data = { bookId: id, name: writing.name.trim(), comment: writing.comment.trim() };
      if (writing.id != null) await bookCommentService.updateComment(writing.id, data);
      else await bookCommentService.createComment(data);
      keepName(writing.name.trim());
      setWriting(null);
      await readReviews();
    } catch (error) {
      toast(`Failed to save the review: ${(error as Error).message}`, { tone: 'danger' });
    }
  };
  const removeReview = async (review: Review) => {
    if (!await confirm({ title: 'Delete this review?', message: `${review.name}'s words on ${book.title} go.`, confirmLabel: 'Delete', danger: true })) return;
    try {
      await bookCommentService.deleteComment(review.id);
      await readReviews();
    } catch {
      toast('Failed to delete the review', { tone: 'danger' });
    }
  };

  // The others of its series, in their order.
  const [volumes, setVolumes] = useState<Book[]>([]);
  useEffect(() => {
    let live = true;
    setVolumes([]);
    if (book.series) {
      (bookService.getBooksBySeries(book.series) as Promise<Book[]>)
        .then(found => {
          if (!live) return;
          const all = found.some(one => one.id === id) ? found : [...found, book];
          setVolumes([...all].sort((a, b) => (Number(a.seriesNumber) || 999) - (Number(b.seriesNumber) || 999)));
        })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [id, book.series]); // eslint-disable-line react-hooks/exhaustive-deps

  // One field at a time, edited in place.
  const [editing, setEditing] = useState<string | null>(null);
  editingRef.current = editing;
  const [value, setValue] = useState('');
  const [second, setSecond] = useState('');
  const edit = (field: string, current: string, other = '') => { setEditing(field); setValue(current); setSecond(other); };
  const saveEdit = async () => {
    if (!editing) return;
    const changes: Record<string, unknown> = editing === 'series'
      ? { series: value.trim() || null, seriesNumber: value.trim() && second.trim() ? Number(second) : null }
      : editing === 'priceChf' ? { priceChf: value === '' ? null : Number(value) }
      : { [editing]: value === '' ? null : value };
    if (await save(changes)) setEditing(null);
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); void saveEdit(); }
  };
  const editActions = (
    <span className="phone-sheet-edit__actions">
      <IconButton label="Save" tone="confirm" size="sm" onClick={saveEdit}><BsCheck2 /></IconButton>
      <IconButton label="Cancel" size="sm" onClick={() => setEditing(null)}><BsX /></IconButton>
    </span>
  );
  const fact = (field: string, label: string, shown: React.ReactNode, current: string, input: React.ReactNode) => (
    <Fact label={label}>
      {editing === field ? (
        <span className="phone-sheet-edit">{input}{editActions}</span>
      ) : (
        <button type="button" className="phone-sheet-editable" disabled={!ready} onClick={() => edit(field, current)}>
          {shown || <span className="phone-sheet-muted">—</span>}<BsPencil aria-hidden="true" />
        </button>
      )}
    </Fact>
  );
  const textInput = (props: React.ComponentProps<typeof TextField> = {}) => (
    <TextField size="sm" value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} autoFocus {...props} />
  );
  const choice = (options: Record<string, string>) => (
    <Select size="sm" value={value} onChange={event => setValue(event.target.value)} autoFocus>
      {Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </Select>
  );

  const copyRef = () => {
    const urls: Record<string, string> = book.urls || {};
    const link = urls.openlibrary || Object.values(urls)[0] || '';
    const words = `${book.title}${book.subtitle ? ` ${book.subtitle}` : ''} - ${listOf(book.authors).join(', ') || 'Unknown Author'}`;
    (navigator.clipboard?.writeText(link ? `${words}\n\n${link}` : words) ?? Promise.reject(new Error('No clipboard')))
      .then(() => toast('Reference copied', { tone: 'success' }), () => toast('The reference could not be copied', { tone: 'danger' }));
  };

  const askDelete = async () => {
    if (!onDelete) return;
    if (!await confirm({ title: `Delete “${book.title}”?`, message: 'The book leaves DexVault, its cover, its readings and its reviews with it.', confirmLabel: 'Delete', danger: true })) return;
    try {
      await onDelete(id);
      close();
    } catch {
      toast('Failed to delete the book', { tone: 'danger' });
    }
  };

  const downloadEbook = () => { bookService.downloadEbook(id).catch(error => toast(`Failed to download the e-book: ${(error as Error).message}`, { tone: 'danger' })); };

  const authors = listOf(book.authors);
  const artists = listOf(book.artists);
  const genres = listOf(book.genres);
  const cover = bookService.getImageUrl(book.cover);
  const status: string = book.titleStatus || 'owned';
  const wished = status === 'wish';
  const hasEbook = Boolean(book.ebookFile && String(book.ebookFile).trim());
  const links = Object.entries(book.urls || {}).filter((entry): entry is [string, string] => Boolean(entry[1]) && !isSecondaryLink(entry[0]));
  const backCover = bookService.getImageUrl(book.backCover);
  // The cover large on a touch, the back too; another cover chosen under it.
  const [shown, setShown] = useState<{ url: string; type: string } | null>(null);
  showingRef.current = shown != null;
  const [choosingCover, setChoosingCover] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => { setAboutOpen(false); setWriting(null); setRereading(null); setEditing(null); setChoosingCover(false); }, [id]);
  const firstAuthor = authors[0];
  // The author's other books, out of this one's series: shown only when there are some, this one among them.
  const othersByAuthor = firstAuthor ? books.filter(one => one.id !== id && listOf(one.authors).includes(firstAuthor) && (!book.series || one.series !== book.series)) : [];
  const byAuthor = othersByAuthor.length ? [book, ...othersByAuthor] : [];

  const tags = (
    <CoverTagStack className="book-sheet-cover__tags">
      {book.seriesNumber && <CoverTag>#{book.seriesNumber}</CoverTag>}
      {status === 'borrowed' && <CoverTag variant="alert">Borrowed</CoverTag>}
      {wished && <CoverTag variant="on">Wishlist</CoverTag>}
    </CoverTagStack>
  );

  const head = (
    <div className="phone-sheet-head">
      {tab !== 'book' && (
        <button type="button" className="phone-sheet-head__thumb" onClick={() => setTab('book')} aria-label="Back to the book">
          {cover ? <img className="phone-sheet-thumb book-sheet-thumb" src={cover} alt="" /> : <span className="phone-sheet-thumb book-sheet-nocover"><BsBook aria-hidden="true" /></span>}
        </button>
      )}
      <div className="phone-sheet-head__words">
        <span className="phone-sheet-head__title" title={book.subtitle ? `${book.title} – ${book.subtitle}` : book.title}>{book.title}</span>
        {authors.length > 0 && (
          <span className="phone-sheet-head__by">
            {authors.map((author, i) => (
              <React.Fragment key={author}>
                {i > 0 && ', '}
                <button type="button" className="book-sheet-filter" disabled={!search} onClick={() => search?.(`author:"${author}"`)}>{author}</button>
              </React.Fragment>
            ))}
          </span>
        )}
        <span className="phone-sheet-head__facts">
          {[book.publishedYear, book.pageCount ? `${book.pageCount} pages` : null, languageOf(book.language)].filter(Boolean).join(' · ')}
        </span>
      </div>
      <Menu drop="down" align="end" label="More" trigger={props => (
        <button type="button" {...props} className="phone-sheet-head__more" aria-label="More"><BsThreeDots aria-hidden="true" /></button>
      )}>
        <Menu.Item icon={<BsFiles />} onSelect={copyRef}>Copy the reference</Menu.Item>
        {onEdit && <Menu.Item icon={<BsPencil />} disabled={!ready} onSelect={onEdit}>Edit…</Menu.Item>}
        {onDelete && (
          <>
            <Menu.Separator />
            <Menu.Item icon={<BsTrash />} danger onSelect={askDelete}>Delete…</Menu.Item>
          </>
        )}
      </Menu>
    </div>
  );

  draftRef.current = writing != null || rereading !== null;

  const reviewForm = writing && (
    <div className="book-sheet-write">
      <TextField size="sm" value={writing.name} onChange={event => setWriting({ ...writing, name: event.target.value })} placeholder="Who" aria-label="Who writes it" />
      <TextArea rows={5} value={writing.comment} autoFocus onChange={event => setWriting({ ...writing, comment: event.target.value })}
        placeholder={`What you thought of ${book.title}…`} aria-label="The review" />
      <div className="book-sheet-reread__actions">
        <Button variant="quiet" size="sm" onClick={() => setWriting(null)}>Cancel</Button>
        <Button size="sm" onClick={saveReview} disabled={!writing.comment.trim() || !writing.name.trim()}>Save</Button>
      </div>
    </div>
  );

  const bookTab = (
    <div className="phone-sheet-scroll" key="book">
      {/* The cover large, its tags where the grid puts them: the volume and the loan top left, the e-book bottom right;
          another cover top right, where the grid has its ⋯. A touch shows it whole. */}
      <div className="book-sheet-cover">
        {cover ? (
          <button type="button" className="book-sheet-cover__show" onClick={() => setShown({ url: cover, type: 'Cover' })} aria-label="Show the cover">
            <img src={cover} alt={`${book.title} cover`} />
          </button>
        ) : <span className="book-sheet-nocover"><BsBook aria-hidden="true" /></span>}
        {tags}
        {ready && (
          <CoverButton className="book-sheet-cover__change" reveal="always" size="small" active={choosingCover} label="Change the cover" onClick={() => setChoosingCover(!choosingCover)}>
            <BsCamera aria-hidden="true" />
          </CoverButton>
        )}
        {hasEbook && (
          <CoverButton className="book-sheet-cover__ebook" reveal="always" label="Download the e-book" onClick={downloadEbook}><BsDownload aria-hidden="true" /></CoverButton>
        )}
      </div>
      {backCover && (
        <button type="button" className="book-sheet-back" onClick={() => setShown({ url: backCover, type: 'Back Cover' })} title="Its back">
          <img src={backCover} alt={`${book.title} back`} />
          <span>Back</span>
        </button>
      )}
      {choosingCover && local && (
        <div className="book-sheet-covers">
          <InlineCoverSelector book={local} isOpen currentCover={local.cover}
            onCoverSelected={(next: string) => {
              setLocal((current: Book) => current && { ...current, cover: next });
              setChoosingCover(false);
              onUpdated?.({ ...local, cover: next });
            }}
            onBackSelected={(next: string) => {
              setLocal((current: Book) => current && { ...current, backCover: next });
              onUpdated?.({ ...local, backCover: next });
            }}
            onClose={() => setChoosingCover(false)} />
        </div>
      )}

      {!wished && book.bookType !== 'score' && (
        <div className="book-sheet-stars">
          <BookStarRating value={book.rating} onChange={stars => { void save({ rating: stars || null }); }} size="lg" label={`Your stars for ${book.title}`} />
        </div>
      )}

      {(readDays.length > 0 || (!wished && book.bookType !== 'score')) && (
        rereading === null ? (
          <div className="book-sheet-read">
            <span>
              {readDays.length === 0 ? 'Not read yet'
                : readDays.length === 1 ? `Read on ${longDate(readDays[0])}`
                : `Read ${readDays.length} times · last on ${longDate(readDays[readDays.length - 1])}`}
            </span>
            <Button variant="quiet" size="sm" disabled={!ready} onClick={() => setRereading(today())}>{readDays.length ? 'Read again' : 'Mark as read'}</Button>
          </div>
        ) : (
          <div className="book-sheet-reread">
            <TextField type="date" size="sm" value={rereading} max={today()} onChange={event => setRereading(event.target.value)} aria-label={`When you read ${book.title}`} />
            <TextArea rows={3} value={rereadWords} onChange={event => setRereadWords(event.target.value)}
              placeholder={readDays.length ? 'What you thought this time (optional)…' : 'What you thought of it (optional)…'} aria-label={`Your words on this reading of ${book.title}`} />
            <div className="book-sheet-reread__actions">
              <Button variant="quiet" size="sm" onClick={() => { setRereading(null); setRereadWords(''); }}>Cancel</Button>
              <Button size="sm" onClick={keepReading} disabled={!rereading}>Keep it</Button>
            </div>
          </div>
        )
      )}

      {book.description && (
        <section className="phone-sheet-section">
          <h5>About</h5>
          <p className={`phone-sheet-text book-sheet-about${aboutOpen ? ' phone-sheet-text--open' : ''}`}>{book.description}</p>
          {book.description.length > 280 && <Button variant="quiet" size="sm" className="phone-sheet-more" onClick={() => setAboutOpen(!aboutOpen)}>{aboutOpen ? 'Less' : 'More'}</Button>}
        </section>
      )}

      <section className="phone-sheet-section">
        <h5 className="phone-sheet-section__head">
          <span>Reviews</span>
          {reviews.length > 0 && <span className="phone-sheet-muted">{reviews.length}</span>}
        </h5>
        {/* A review being changed is changed in its place; a new one under the others. */}
        {reviews.map(review => (writing?.id === review.id ? <React.Fragment key={review.id}>{reviewForm}</React.Fragment> : (
          <div key={review.id} className="book-sheet-review">
            <div className="book-sheet-review__who">
              <strong>{review.name}</strong>
              {review.date && <span className="phone-sheet-muted"> · {longDate(review.date)}</span>}
              <Menu drop="down" align="end" label="Review" trigger={props => (
                <button type="button" {...props} className="book-sheet-review__more" aria-label={`${review.name}'s review`}><BsThreeDots aria-hidden="true" /></button>
              )}>
                <Menu.Item icon={<BsPencil />} onSelect={() => setWriting({ id: review.id, name: review.name, comment: review.comment })}>Edit</Menu.Item>
                <Menu.Item icon={<BsTrash />} danger onSelect={() => removeReview(review)}>Delete…</Menu.Item>
              </Menu>
            </div>
            <p className="book-sheet-review__words">{review.comment}</p>
          </div>
        )))}
        {writing ? writing.id == null && reviewForm : (
          <button type="button" className="phone-sheet-note" onClick={() => setWriting({ id: null, name: readName(), comment: '' })}>
            <span className="phone-sheet-muted">Write a review…</span>
          </button>
        )}
      </section>

      {genres.length > 0 && (
        <section className="phone-sheet-section">
          <h5>Genres</h5>
          <div className="phone-sheet-chips">
            {genres.map(genre => <button key={genre} type="button" className="phone-sheet-chip" disabled={!search} onClick={() => search?.(`genre:"${genre}"`)}>{genre}</button>)}
          </div>
        </section>
      )}

      <section className="phone-sheet-section">
        <h5>The book</h5>
        <dl className="phone-sheet-facts">
          {book.subtitle && <Fact label="Subtitle">{book.subtitle}</Fact>}
          {/* The head cuts them after two: all of them here, each a search. */}
          {authors.length > 2 && (
            <Fact label="Authors">
              {authors.map((author, i) => (
                <React.Fragment key={author}>
                  {i > 0 && ', '}
                  <button type="button" className="book-sheet-filter" disabled={!search} onClick={() => search?.(`author:"${author}"`)}>{author}</button>
                </React.Fragment>
              ))}
            </Fact>
          )}
          {artists.length > 0 && (
            <Fact label={artists.length > 1 ? 'Artists' : 'Artist'}>
              {artists.map((artist, i) => (
                <React.Fragment key={artist}>
                  {i > 0 && ', '}
                  <button type="button" className="book-sheet-filter" disabled={!search} onClick={() => search?.(`artist:"${artist}"`)}>{artist}</button>
                </React.Fragment>
              ))}
            </Fact>
          )}
          {book.publisher && <Fact label="Publisher">{book.publisher}{book.publishedYear ? `, ${book.publishedYear}` : ''}</Fact>}
          {book.pageCount && <Fact label="Pages">{book.pageCount}</Fact>}
          {book.language && <Fact label="Language">{languageOf(book.language)}</Fact>}
          {fact('bookType', 'Kind', KINDS[book.bookType || 'book'], book.bookType || 'book', choice(KINDS))}
          {(book.isbn13 || book.isbn) && (
            <Fact label="ISBN"><code className="book-sheet-code">{[book.isbn13, book.isbn].filter(Boolean).map(isbnShown).join(' · ')}</code></Fact>
          )}
          {book.narrator && <Fact label="Narrator">{book.narrator}</Fact>}
          {book.runtime && <Fact label="Runtime">{Math.floor(book.runtime / 60)} h {book.runtime % 60} min</Fact>}
          {listOf(book.tags).length > 0 && <Fact label="Tags">{listOf(book.tags).join(' · ')}</Fact>}
        </dl>
      </section>

      {(links.length > 0 || hasEbook) && (
        <section className="phone-sheet-section">
          <h5>Links</h5>
          <div className="phone-sheet-links">
            {hasEbook && <Button size="sm" icon={<BsDownload />} onClick={downloadEbook}>E-book</Button>}
            {links.map(([key, url]) => <LinkButton key={key} size="sm" href={url} external>{linkName(key)} <BsBoxArrowUpRight aria-hidden="true" /></LinkButton>)}
          </div>
        </section>
      )}
    </div>
  );

  const seriesEdit = (
    <div className="book-sheet-series-edit">
      <TextField size="sm" value={value} onChange={event => setValue(event.target.value)} onKeyDown={keys} placeholder="The series" aria-label="The series" autoFocus />
      <TextField size="sm" className="book-sheet-series-edit__number" type="number" inputMode="numeric" min="0" value={second}
        onChange={event => setSecond(event.target.value)} onKeyDown={keys} placeholder="#" aria-label="Its volume" />
      {editActions}
    </div>
  );

  const seriesTab = (
    <div className="phone-sheet-scroll" key="series">
      {book.series ? (
        <>
          <section className="phone-sheet-section">
            <h5 className="phone-sheet-section__head">
              <span>{book.series}</span>
              <span className="phone-sheet-muted">{volumes.length} volume{volumes.length === 1 ? '' : 's'}</span>
            </h5>
            <SheetRow>
              {volumes.map(volume => {
                const here = volume.id === id;
                const volumeCover = bookService.getImageUrl(volume.cover);
                return (
                  <button key={volume.id} type="button" title={volume.title} className={`phone-sheet-mini${here ? ' phone-sheet-mini--here' : ''}`}
                    disabled={here || !onBookClick} onClick={() => onBookClick?.(volume.id)}>
                    <span className="phone-sheet-mini__cover book-sheet-mini">
                      {volumeCover ? <img src={volumeCover} alt="" loading="lazy" /> : <span className="book-sheet-nocover"><BsBook aria-hidden="true" /></span>}
                      {volume.seriesNumber && <CoverTagStack className="book-sheet-mini__tags"><CoverTag>#{volume.seriesNumber}</CoverTag></CoverTagStack>}
                    </span>
                    <span className="phone-sheet-mini__title">{volume.title}</span>
                    <span className="phone-sheet-muted phone-sheet-mini__year">
                      {here ? 'this book' : volume.readDate ? `read${volume.rating ? ` · ★ ${volume.rating}` : ''}` : volume.titleStatus === 'wish' ? 'wished' : 'not read'}
                    </span>
                  </button>
                );
              })}
            </SheetRow>
            {editing === 'series' ? seriesEdit : (
              <div className="book-sheet-actions">
                {onNextVolumes && <Button size="sm" icon={<BsPlus />} disabled={!ready} onClick={onNextVolumes}>Next volumes…</Button>}
                <Button variant="quiet" size="sm" disabled={!ready} onClick={() => edit('series', book.series ?? '', book.seriesNumber != null ? String(book.seriesNumber) : '')}>Change the series…</Button>
                {/* The library holds the books owned alone: a series only borrowed or wished would show none. */}
                {onShowSeries && volumes.some(volume => (volume.titleStatus || 'owned') === 'owned') && (
                  <Button variant="quiet" size="sm" onClick={() => leaveFor(() => onShowSeries(book.series))}>Show in the library</Button>
                )}
              </div>
            )}
          </section>
          <section className="phone-sheet-section book-sheet-notes">
            <h5>Notes on the series</h5>
            <SeriesNotes series={book.series} />
          </section>
        </>
      ) : (
        <section className="phone-sheet-section">
          <h5>Series</h5>
          {editing === 'series' ? seriesEdit : (
            <>
              <p className="phone-sheet-muted book-sheet-line">Not in a series.</p>
              <Button size="sm" disabled={!ready} onClick={() => edit('series', '', '')}>Put it in a series…</Button>
            </>
          )}
        </section>
      )}

      {byAuthor.length > 0 && (
        <section className="phone-sheet-section">
          <h5 className="phone-sheet-section__head">
            <span>By {firstAuthor}</span>
            <span className="phone-sheet-muted">{byAuthor.length} books</span>
          </h5>
          <SheetRow>
            {[...byAuthor]
              .sort((a, b) => (Number(a.publishedYear) || 0) - (Number(b.publishedYear) || 0))
              .map(other => {
                const here = other.id === id;
                const otherCover = bookService.getImageUrl(other.cover);
                return (
                  <button key={other.id} type="button" title={other.title} className={`phone-sheet-mini${here ? ' phone-sheet-mini--here' : ''}`}
                    disabled={here || !onBookClick} onClick={() => onBookClick?.(other.id)}>
                    <span className="phone-sheet-mini__cover book-sheet-mini">
                      {otherCover ? <img src={otherCover} alt="" loading="lazy" /> : <span className="book-sheet-nocover"><BsBook aria-hidden="true" /></span>}
                    </span>
                    <span className="phone-sheet-mini__title">{other.title}</span>
                    <span className="phone-sheet-muted phone-sheet-mini__year">{here ? 'this book' : other.publishedYear}</span>
                  </button>
                );
              })}
          </SheetRow>
        </section>
      )}
    </div>
  );

  const copyTab = (
    <div className="phone-sheet-scroll" key="copy">
      <section className="phone-sheet-section">
        <h5>{wished ? 'Wished' : 'The copy'}</h5>
        <dl className="phone-sheet-facts">
          {fact('titleStatus', 'Status', <span className={status === 'borrowed' ? 'book-sheet-alert' : undefined}>{STATUSES[status] ?? status}</span>, status, choice(STATUSES))}
          {fact('owner', 'Whose', book.owner, book.owner ?? '', textInput({ placeholder: 'Whose is it?' }))}
          {fact('format', 'Format', FORMATS[book.format || 'physical'], book.format || 'physical', choice(FORMATS))}
          {!wished && fact('purchasedAt', 'Bought', longDate(book.purchasedAt), isoDate(book.purchasedAt), textInput({ type: 'date', max: today() }))}
          {fact('priceChf', wished ? 'Price' : 'Paid', francs(book.priceChf), book.priceChf != null ? String(book.priceChf) : '',
            textInput({ type: 'number', inputMode: 'decimal', step: '0.05', min: '0', suffix: 'CHF' }))}
        </dl>
      </section>

      {readDays.length > 0 && (
        <section className="phone-sheet-section">
          <h5 className="phone-sheet-section__head">
            <span>Readings</span>
            <span className="phone-sheet-muted">{readDays.length}</span>
          </h5>
          <ul className="book-sheet-readings">
            {[...readDays].reverse().map((day, i) => <li key={`${day}-${i}`}>{longDate(day)}</li>)}
          </ul>
        </section>
      )}

      {hasEbook && (
        <section className="phone-sheet-section">
          <h5>E-book</h5>
          <dl className="phone-sheet-facts">
            {book.filetype && <Fact label="File">{book.filetype}</Fact>}
            {book.drm && <Fact label="DRM">{book.drm}</Fact>}
          </dl>
          <Button size="sm" icon={<BsDownload />} className="book-sheet-download" onClick={downloadEbook}>Download</Button>
        </section>
      )}

      <section className="phone-sheet-section">
        <h5>Notes</h5>
        {editing === 'annotation' ? (
          <div className="phone-sheet-comments">
            <TextArea rows={4} value={value} onChange={event => setValue(event.target.value)} autoFocus />
            {editActions}
          </div>
        ) : (
          <button type="button" className="phone-sheet-note" disabled={!ready} onClick={() => edit('annotation', book.annotation ?? '')}>
            {book.annotation || <span className="phone-sheet-muted">Write a note…</span>}
          </button>
        )}
      </section>

      <section className="phone-sheet-section">
        <h5>In DexVault</h5>
        <p className="phone-sheet-muted book-sheet-line">
          {[book.createdAt && `added ${longDate(book.createdAt)}`, book.updatedAt && book.updatedAt !== book.createdAt && `updated ${longDate(book.updatedAt)}`].filter(Boolean).join(' · ')}
        </p>
      </section>

      {(onEdit || onDelete) && (
        <div className="phone-sheet-manage book-sheet-manage">
          {onEdit && <Button icon={<BsPencil />} disabled={!ready} onClick={onEdit}>Edit…</Button>}
          {onDelete && <Button variant="danger" icon={<BsTrash />} onClick={askDelete}>Delete</Button>}
        </div>
      )}
    </div>
  );

  return (
    <>
      <PhoneSheet sheet={sheet} label={book.title ?? 'Book'} tab={tab} cover={cover}>
        {head}
        <Segmented<Tab> kind="tabs" size="sm" block label="Show" className="phone-sheet-tabs" value={tab} onChange={setTab} options={[
          { value: 'book', label: 'Book' },
          { value: 'series', label: 'Series', count: book.series && volumes.length > 1 ? volumes.length : undefined },
          { value: 'copy', label: wished ? 'Wished' : status === 'borrowed' ? 'Borrowed' : 'Owned' },
        ]} />
        {tab === 'book' ? bookTab : tab === 'series' ? seriesTab : copyTab}
      </PhoneSheet>
      <CoverModal isOpen={shown != null} onClose={() => setShown(null)} coverUrl={shown?.url ?? ''} title={book.title} artist={authors.join(', ')} coverType={shown?.type ?? 'Cover'} />
    </>
  );
};

export default BookSheet;
