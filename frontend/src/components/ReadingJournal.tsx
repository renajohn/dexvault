import React, { useEffect, useMemo, useState } from 'react';
import bookSectionsService, { ReadingEntry } from '../services/bookSectionsService';
import bookService from '../services/bookService';
import bookCommentService from '../services/bookCommentService';
import AddBookDialog from './AddBookDialog';
import BookDetailCard from './BookDetailCard';
import BookSheet from './BookSheet';
import BookForm from './BookForm';
import { BsPencil } from 'react-icons/bs';
import Button, { IconButton } from './shared/Button';
import { confirm } from './shared/ConfirmDialog';
import CoverTag from './shared/CoverTag';
import { BookStarRating } from './RecordStarRating';
import { Loading } from './shared/Spinner';
import { TextArea, TextField } from './shared/TextField';
import { CollectionHeader } from './shared';
import toast from './shared/Toast';
import { useMedia } from '../utils/useNarrow';
import './ReadingJournal.css';

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const COMMENTER = 'dv.readingName';
const remembered = () => { try { return localStorage.getItem(COMMENTER) || 'Renault'; } catch { return 'Renault'; } };
const today = () => new Date().toLocaleDateString('sv-SE');
const ORDINALS = ['', '1st', '2nd', '3rd'];
const nth = (n: number) => ORDINALS[n] || `${n}th`;
const keyOf = (entry: ReadingEntry) => `${entry.id}-${entry.readingId ?? 'unread'}`;
/** The last reading of a book, or a book not read yet: where one reads again. */
const isLatest = (entry: ReadingEntry) => entry.readNumber === entry.readCount;

/**
 * The reading journal: what one has read, one's own book or borrowed, by
 * year, the last read first, with one's stars and one's comments. A book
 * read again is there at each of its readings, each with what was written
 * after it. A book borrowed lives here alone, out of the library's shelves.
 */
interface ReadingJournalProps {
  /** Library or Reading, first in the bar. */
  viewSwitch?: React.ReactNode;
  /** The app's header search: a title, an author. */
  searchCriteria?: { searchText?: string } | null;
}

const ReadingJournal: React.FC<ReadingJournalProps> = ({ viewSwitch, searchCriteria }) => {
  const [entries, setEntries] = useState<ReadingEntry[] | null>(null);
  // The library's owner:Alice or type:score mean nothing here: only the words count.
  const filter = (searchCriteria?.searchText || '').replace(/-?\w+:("[^"]*"|\S+)/g, ' ').replace(/\s+/g, ' ').trim();
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState<any>(null);
  // On a phone a book opens full screen at once (BookSheet); the card shows over it for its edit alone.
  const phone = useMedia('(max-width: 767px)');
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [bookView, setBookView] = useState<'edit' | 'volumes' | null>(null);
  const [editing, setEditing] = useState<any>(null);
  // Which reading one writes on: a word on an older reading stays with it.
  const [writing, setWriting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // A comment written before, being rewritten.
  const [revising, setRevising] = useState<{ id: number; text: string } | null>(null);
  // A date of reading being given: a reading again (readingId null) or one corrected.
  // With a reading again, what one thought this time, if one wishes: a comment of that reading.
  const [dating, setDating] = useState<{ key: string; bookId: number; readingId: number | null; date: string; words?: string } | null>(null);

  const load = () => bookSectionsService.reading().then(setEntries).catch(e => { setEntries([]); toast((e as Error).message, { tone: 'danger' }); });
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const words = plain(filter.trim());
    return (entries || []).filter(e => !words || plain(`${e.title} ${(e.authors || []).join(' ')}`).includes(words));
  }, [entries, filter]);
  const years = useMemo(() => {
    const byYear = new Map<string, ReadingEntry[]>();
    for (const entry of shown) {
      const year = entry.readDate?.slice(0, 4) || 'Not dated';
      byYear.set(year, [...(byYear.get(year) || []), entry]);
    }
    return [...byYear];
  }, [shown]);

  const rate = async (entry: ReadingEntry, rating: number) => {
    try {
      const book = await bookService.getBookById(entry.id) as Record<string, unknown>;
      await bookService.updateBook(entry.id, { ...book, rating: rating || null });
      setEntries(prev => (prev || []).map(e => (e.id === entry.id ? { ...e, rating: rating || null } : e)));
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  const comment = async (entry: ReadingEntry) => {
    if (!draft.trim()) return;
    try {
      const name = remembered();
      await bookCommentService.createComment({ bookId: entry.id, readingId: entry.readingId, name, comment: draft.trim(), date: new Date().toISOString() });
      setDraft('');
      setWriting(null);
      load();
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  const open = async (bookId: number) => {
    if (phone) setOpenedId(bookId);
    try { setDetails(await bookService.getBookById(bookId)); } catch (e) { setOpenedId(null); toast((e as Error).message, { tone: 'danger' }); }
  };

  const keepDate = async () => {
    if (!dating?.date) return;
    try {
      if (dating.readingId) await bookSectionsService.changeReading(dating.readingId, dating.date);
      else {
        const reading = await bookSectionsService.addReading(dating.bookId, dating.date);
        if (dating.words?.trim()) {
          await bookCommentService.createComment({ bookId: dating.bookId, readingId: reading.id, name: remembered(), comment: dating.words.trim(), date: new Date().toISOString() });
        }
      }
      setDating(null);
      load();
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  const unread = async (readingId: number) => {
    if (!(await confirm({ title: 'Take this reading away?', message: 'Its date goes; the book and what you wrote stay.', confirmLabel: 'Take away', danger: true }))) return;
    try {
      await bookSectionsService.removeReading(readingId);
      setDating(null);
      load();
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  const revise = async () => {
    if (!revising?.text.trim()) return;
    try {
      await bookCommentService.updateComment(revising.id, { comment: revising.text.trim() });
      setRevising(null);
      load();
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  const unsay = async (id: number) => {
    if (!(await confirm({ title: 'Delete this comment?', message: 'It goes for good.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await bookCommentService.deleteComment(id);
      setRevising(null);
      load();
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  return (
    <div className="reading-journal">
      <CollectionHeader
        leading={viewSwitch}
        filteredCount={shown.length}
        totalCount={entries?.length || 0}
        itemLabel="readings"
        addButtonLabel="Add a reading"
        onAdd={() => setAdding(true)}
        loading={!entries}
      />

      {!entries ? <Loading>Loading your readings…</Loading>
        : !shown.length ? <p className="reading-journal__empty">{filter ? `No reading with “${filter}”.` : 'No reading yet: a book read, its date, your words.'}</p>
          : years.map(([year, list]) => (
            <section key={year}>
              <h3 className="reading-journal__year">{year} <small>{list.length} reading{list.length > 1 ? 's' : ''}</small></h3>
              {list.map(entry => (
                <article key={keyOf(entry)} className="reading-journal__entry">
                  <button type="button" className="reading-journal__cover" onClick={() => open(entry.id)} title="Details">
                    {entry.cover ? <img src={bookService.getImageUrl(entry.cover) || ''} alt="" loading="lazy" /> : <span />}
                  </button>
                  <div className="reading-journal__body">
                    <button type="button" className="reading-journal__title" onClick={() => open(entry.id)}>{entry.title}</button>
                    <div className="reading-journal__by">{[(entry.authors || []).join(', '), entry.publishedYear].filter(Boolean).join(' · ')}</div>
                    <div className="reading-journal__meta">
                      <BookStarRating value={entry.rating} onChange={stars => rate(entry, stars)} size="sm" label={`Your stars for ${entry.title}`} />
                      {entry.readDate && (entry.readingId
                        ? <button type="button" className="reading-journal__date" title="Change the date"
                          onClick={() => setDating({ key: keyOf(entry), bookId: entry.id, readingId: entry.readingId, date: entry.readDate!.slice(0, 10) })}>
                          read {new Date(entry.readDate).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long' })}
                        </button>
                        : <span>read {new Date(entry.readDate).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long' })}</span>)}
                      {entry.readNumber > 1 && <CoverTag variant="plain">{nth(entry.readNumber)} reading</CoverTag>}
                      {entry.readCount > entry.readNumber && (
                        <span className="reading-journal__again">read again in {[...new Set(entry.readDates.slice(entry.readNumber).filter((d): d is string => Boolean(d)).map(d => d.slice(0, 4)))].join(', ')}</span>
                      )}
                      {entry.titleStatus === 'borrowed'
                        ? <CoverTag variant="alert">{entry.owner && entry.owner !== 'Renault' ? `Borrowed · ${entry.owner}` : 'Borrowed'}</CoverTag>
                        : <CoverTag variant="gold">Mine</CoverTag>}
                    </div>
                    {entry.comments.map(c => (revising?.id === c.id ? (
                      <div key={c.id} className="reading-journal__write">
                        <TextArea rows={Math.min(14, Math.max(4, revising.text.split('\n').length + Math.ceil(revising.text.length / 90)))} value={revising.text} autoFocus onChange={e => setRevising({ id: c.id, text: e.target.value })} aria-label={`Rewrite your words on ${entry.title}`} />
                        <div className="reading-journal__write-actions">
                          <Button variant="danger" size="sm" className="reading-journal__unsay" onClick={() => unsay(c.id)}>Delete</Button>
                          <Button variant="quiet" size="sm" onClick={() => setRevising(null)}>Cancel</Button>
                          <Button size="sm" onClick={revise} disabled={!revising.text.trim() || revising.text.trim() === c.comment}>Keep it</Button>
                        </div>
                      </div>
                    ) : (
                      <blockquote key={c.id} className="reading-journal__comment">
                        {c.comment}
                        <small>{c.name}, {new Date(c.date).toLocaleDateString('fr-CH')}</small>
                        <IconButton className="reading-journal__revise" size="sm" label="Edit these words"
                          onClick={() => { setRevising({ id: c.id, text: c.comment }); setWriting(null); }}><BsPencil /></IconButton>
                      </blockquote>
                    )))}
                    {dating?.key === keyOf(entry) && !dating.readingId && (
                      <div className="reading-journal__write">
                        <TextField type="date" size="sm" className="reading-journal__date-field" value={dating.date} max={today()}
                          onChange={e => setDating({ ...dating, date: e.target.value })}
                          aria-label={entry.readCount ? `When you read ${entry.title} again` : `When you read ${entry.title}`} />
                        <TextArea rows={3} value={dating.words || ''} autoFocus className="reading-journal__words"
                          onChange={e => setDating({ ...dating, words: e.target.value })}
                          placeholder={entry.readCount ? 'What you thought this time (optional)…' : 'What you thought of it (optional)…'}
                          aria-label={`Your words on this reading of ${entry.title}`} />
                        <div className="reading-journal__write-actions">
                          <Button variant="quiet" size="sm" onClick={() => setDating(null)}>Cancel</Button>
                          <Button size="sm" onClick={keepDate} disabled={!dating.date}>Keep it</Button>
                        </div>
                      </div>
                    )}
                    {dating?.key === keyOf(entry) && dating.readingId && (
                      <div className="reading-journal__dating">
                        <TextField type="date" size="sm" className="reading-journal__date-field" value={dating.date} max={today()} autoFocus
                          onChange={e => setDating({ ...dating, date: e.target.value })}
                          aria-label={`When you read ${entry.title}`} />
                        <Button variant="danger" size="sm" className="reading-journal__unsay" onClick={() => unread(dating.readingId!)}>Take away</Button>
                        <Button variant="quiet" size="sm" onClick={() => setDating(null)}>Cancel</Button>
                        <Button size="sm" onClick={keepDate} disabled={!dating.date}>Keep it</Button>
                      </div>
                    )}
                    {dating?.key === keyOf(entry) ? null : writing === keyOf(entry) ? (
                      <div className="reading-journal__write">
                        <TextArea rows={3} value={draft} autoFocus onChange={e => setDraft(e.target.value)} placeholder="What you thought of it…" aria-label={`Your words on ${entry.title}`} />
                        <div className="reading-journal__write-actions">
                          <Button variant="quiet" size="sm" onClick={() => { setWriting(null); setDraft(''); }}>Cancel</Button>
                          <Button size="sm" onClick={() => comment(entry)} disabled={!draft.trim()}>Keep it</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="reading-journal__actions">
                        <Button variant="quiet" size="sm" onClick={() => { setWriting(keyOf(entry)); setDraft(''); setDating(null); }}>
                          {entry.comments.length ? 'Add a word' : 'Write what you thought'}
                        </Button>
                        {isLatest(entry) && (
                          <Button variant="quiet" size="sm" onClick={() => { setDating({ key: keyOf(entry), bookId: entry.id, readingId: null, date: today() }); setWriting(null); }}>
                            {entry.readCount ? 'Read again' : 'Mark as read'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>
          ))}

      <AddBookDialog
        show={adding}
        onHide={() => setAdding(false)}
        defaultBookKind="book"
        reading
        onAddBook={async (bookData: any) => bookService.addBook(bookData)}
        onBookAdded={() => load()}
        onShowAlert={(message: string) => toast(message)}
      />
      {phone && openedId != null && (
        <BookSheet
          bookId={openedId}
          book={details?.id === openedId ? details : null}
          onClose={() => { setOpenedId(null); setBookView(null); setDetails(null); }}
          onUpdated={book => { setDetails(book); load(); }}
          onDelete={async id => { await bookService.deleteBook(id); load(); }}
          onBookClick={open}
          onOpenView={view => { if (view === 'edit') setBookView(view); }}
        />
      )}
      {details && (!phone || bookView) && (
        <BookDetailCard
          book={details}
          only={phone ? bookView ?? undefined : undefined}
          onClose={() => { if (phone) setBookView(null); else setDetails(null); }}
          onEdit={() => { setEditing(details); setDetails(null); }}
          onUpdateBook={(id, data) => bookService.updateBook(id, data)}
          onBookUpdated={async () => { load(); if (phone && details) setDetails(await bookService.getBookById(details.id)); }}
          onDelete={async id => { await bookService.deleteBook(id); setDetails(null); setOpenedId(null); load(); }}
        />
      )}
      {editing && (
        <BookForm
          book={editing}
          onSave={async data => { await bookService.updateBook(editing.id, data); setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default ReadingJournal;
