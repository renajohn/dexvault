import React, { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { BsBoxArrowUpRight, BsCamera, BsPrinter, BsFileEarmarkPdf, BsFileMusic, BsListCheck, BsPaperclip, BsPencil, BsPlayFill, BsSearch, BsThreeDots, BsTrash, BsUpcScan, BsVolumeUpFill, BsYoutube } from 'react-icons/bs';
import scorePiecesService, { imslpPieceUrl, PieceRecording, PieceSuggestion, ScoreLookup, ScorePiece, youtubeUrl } from '../services/scorePiecesService';
import bookCommentService from '../services/bookCommentService';
import { decodeBarcode } from '../utils/decodeBarcode';
import { pieceOf, referenceOf, titleWithNumber } from '../utils/scoreTitle';
import bookSectionsService, { imslpUrl, Score, ScoreBookmark, ScoreFile, scoreFileUrl, scorePdfUrl, scorePrintUrl } from '../services/bookSectionsService';
import bookService from '../services/bookService';
import Button, { IconButton } from './shared/Button';
import CoverTag from './shared/CoverTag';
import Dialog from './shared/Dialog';
import Menu, { MenuChevron } from './shared/Menu';
import Notice from './shared/Notice';
import Spinner, { Loading } from './shared/Spinner';
import { TextArea, TextField } from './shared/TextField';
import Segmented from './shared/Segmented';
import { confirm } from './shared/ConfirmDialog';
import toast from './shared/Toast';
import CoverModal from './CoverModal';
import ScoreSheet from './ScoreSheet';
import { keyOf, mainOf, play, recordingsOfSingle, usePlaying } from '../utils/playPiece';
import ScoreFiles, { openScoreFile } from './ScoreFiles';
import ImslpEditions from './ImslpEditions';
import ScoreBookmarks, { keyOf as markKey, rowsOf as markRowsOf } from './ScoreBookmarks';
import { useMedia } from '../utils/useNarrow';
import { francs } from './PhoneSheet';
import './ScoreCard.css';

const fmt = (seconds: number | null) => (seconds == null ? '' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`);
const surnameOf = (names: string[]) => (names[0] || '').split(' ').slice(-1)[0] || 'Play';
const WHY: Record<PieceSuggestion['why'], string> = { number: 'by its number', 'your music': 'in your music', wikidata: 'from Wikidata', imslp: 'from IMSLP', title: 'by its title', photo: 'read on the photo', search: '' };


const GERMAN = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'sich', 'auch', 'eine', 'einen', 'dem', 'den', 'des', 'zu', 'von', 'wurde', 'werden', 'gelten', 'bei', 'nach', 'aus']);
const OTHERS = new Set(['the', 'and', 'of', 'is', 'with', 'for', 'to', 'was', 'le', 'la', 'les', 'et', 'est', 'des', 'du', 'une', 'pour', 'dans', 'que', 'qui']);
/** Words not shown, as the server does not keep them: a shop's listing, a page's menu, or German. */
const isUnwanted = (text: string): boolean => {
  if (/^\s*(?:Support\s*-\s*Partition|Search\b)/.test(text)) return true;
  const words = text.toLowerCase().split(/[^a-zäöüßàâçéèêëîïôûù]+/);
  const german = words.filter(word => GERMAN.has(word)).length;
  return german >= 3 && german > words.filter(word => OTHERS.has(word)).length;
};

interface ScoreCardProps {
  /** The score; none to add one. */
  score: Score | null;
  onClose: () => void;
  /** It changed (its pieces, its edition): the list's counts and titles. */
  onChanged: () => void;
  /** Added: its id, for its card to open. */
  onCreated?: (id: number) => void;
  onDeleted?: () => void;
  onAttach: (score: Score) => void;
  /** Its PDF read full screen (ScoreReader): one of them, at a page; the browser's own viewer when none is given. */
  onRead?: (scoreId: number, fileId?: number, page?: number, piece?: string) => void;
}

/** What one edits of an edition, as typed. */
interface EditionValues {
  title: string;
  composer: string;
  publisher: string;
  number: string;
  code: string;
  priceChf: string;
  purchasedAt: string;
  borrowed: boolean;
  owner: string;
}

const today = () => new Date().toLocaleDateString('sv-SE');
const COMMENTER = 'dv.readingName';
const commenter = () => { try { return localStorage.getItem(COMMENTER) || 'Renault'; } catch { return 'Renault'; } };

/** Its edition as one line: "G. Henle Verlag · HN 383 · Henle level 7 · CHF 24.50, 30.11.2025". */
const editionLine = (values: EditionValues, level: number | null) => [
  values.publisher.trim() || null,
  values.number.trim() || null,
  level ? `Henle level ${level}` : null,
  values.borrowed ? `Borrowed${values.owner.trim() ? ` from ${values.owner.trim()}` : ''}`
    : [values.priceChf.trim() ? `CHF ${values.priceChf.trim()}` : null, values.purchasedAt ? new Date(values.purchasedAt).toLocaleDateString('fr-CH') : null].filter(Boolean).join(', ') || null,
].filter(Boolean) as string[];

/** Its edition, unfolded in place: title, composer, publisher and number, its code, its price and date, borrowed. */
const EditionForm: React.FC<{ values: EditionValues; onChange: (values: EditionValues) => void }> = ({ values, onChange }) => {
  const set = (field: keyof EditionValues) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...values, [field]: event.target.value });
  return (
    <div className="score-edition">
      <label htmlFor="score-title">Title</label><TextField id="score-title" size="sm" value={values.title} onChange={set('title')} />
      <label htmlFor="score-composer">Composer</label><TextField id="score-composer" size="sm" value={values.composer} onChange={set('composer')} placeholder="Several: an anthology" />
      <label htmlFor="score-publisher">Publisher</label>
      <TextField id="score-publisher" size="sm" value={values.publisher} onChange={set('publisher')} placeholder="G. Henle Verlag, Bärenreiter, Wiener Urtext, Peters…" />
      <label htmlFor="score-number">Its number</label><TextField id="score-number" size="sm" value={values.number} onChange={set('number')} placeholder="HN 383, BA 5234…" />
      <label htmlFor="score-code">ISMN / ISBN</label><TextField id="score-code" size="sm" value={values.code} onChange={set('code')} placeholder="979-0-… on its back" />
      <label>Whose</label>
      <div className="score-edition__whose">
        <Segmented label="Whose" size="sm" value={values.borrowed ? 'borrowed' : 'mine'}
          // Borrowed: whom from, typed afresh; the owner of one's own is not its lender.
          onChange={value => onChange({ ...values, borrowed: value === 'borrowed', owner: value === 'borrowed' && !values.borrowed ? '' : values.owner })}
          options={[{ value: 'mine', label: 'Mine' }, { value: 'borrowed', label: 'Borrowed' }]} />
        {values.borrowed
          ? <TextField size="sm" value={values.owner} onChange={set('owner')} placeholder="From whom" aria-label="Borrowed from" />
          : (
            <>
              <TextField size="sm" className="score-edition__price" value={values.priceChf} onChange={set('priceChf')} placeholder="CHF" aria-label="Its price" />
              <TextField size="sm" type="date" className="score-edition__date" value={values.purchasedAt} onChange={set('purchasedAt')} aria-label="Bought on" />
            </>
          )}
      </div>
    </div>
  );
};

/**
 * A score in one window: to add it, to read it, to change it. Its head (its
 * composer, its edition in a line unfolded in place by ✎), its PDF and its
 * pages (IMSLP, henle.de), its pieces with the recordings of the music that
 * play them, its notes. Added from a title or the ISMN on its back: its works
 * to check, its edition from Henle's site when the ISMN is Henle's.
 */
const ScoreCard: React.FC<ScoreCardProps> = props => (props.score ? <ScoreView {...props} score={props.score} /> : <AddScore {...props} />);

const ScoreView: React.FC<ScoreCardProps & { score: Score }> = ({ score, onClose, onChanged, onDeleted, onAttach, onRead }) => {
  const [pieces, setPieces] = useState<ScorePiece[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [book, setBook] = useState<Record<string, any> | null>(null);
  const [editing, setEditing] = useState<EditionValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [henle, setHenle] = useState<{ url: string | null; level: number | null }>({ url: null, level: null });
  const [notes, setNotes] = useState<Array<{ id: number; name: string; comment: string; date: string }>>([]);
  const [writing, setWriting] = useState<string | null>(null);
  // Its page on IMSLP, where its free editions are: the one its pieces or its title find.
  const [imslpPage, setImslpPage] = useState<string | null>(null);
  const [coverShown, setCoverShown] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Its PDFs, read again when the page adds one.
  const [files, setFiles] = useState<ScoreFile[]>([]);
  const [editionsShown, setEditionsShown] = useState(false);
  // The PDF whose pages are being marked, and where each piece lies in the one that opens first.
  const [marking, setMarking] = useState<ScoreFile | null>(null);
  const [marks, setMarks] = useState<ScoreBookmark[]>([]);
  const playing = usePlaying();
  // On a phone the score is a full screen as a film's or a book's (ScoreSheet), its parts the same.
  const phone = useMedia('(max-width: 767px)');
  // The row last played from: several pieces one track holds (waltzes 1, 2 and 5 in one) light that one alone.
  const [playedFrom, setPlayedFrom] = useState<{ row: string; track: string } | null>(null);

  const loadBook = () => bookService.getBookById(score.id).then(found => setBook(found as Record<string, any>)).catch(() => undefined);
  const loadNotes = () => bookCommentService.getCommentsByBookId(score.id).then(list => setNotes(Array.isArray(list) ? list as typeof notes : [])).catch(() => undefined);
  useEffect(() => {
    setImslpPage(null); setBook(null); setEditing(null); setNotes([]); setHenle({ url: null, level: null });
    loadBook(); loadNotes();
    scorePiecesService.henle(score.id).then(found => {
      setHenle(found || { url: null, level: null });
      // henle.de gave it a larger cover or its words: shown at once, and in the list.
      if (found?.changed) { loadBook(); onChanged(); }
    }).catch(() => undefined);
  }, [score.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let current = true;
    // Asked again once its pieces are known or change: a set's page is the score's.
    scorePiecesService.imslpPage(score.id).then(found => { if (current && found?.page) setImslpPage(found.page); }).catch(() => undefined);
    return () => { current = false; };
  }, [score.id, pieces?.length]);
  const imslp = imslpPage ? imslpPieceUrl(imslpPage) : imslpUrl(score);
  useEffect(() => {
    let current = true;
    if (!score.ebookFile && !score.fileCount) { setFiles([]); return undefined; }
    bookSectionsService.files(score.id).then(list => { if (current) setFiles(list); }).catch(() => undefined);
    return () => { current = false; };
  }, [score.id, score.fileCount, score.ebookFile]);
  const filesChanged = (list: ScoreFile[]) => { setFiles(list); onChanged(); };
  const first = files.find(file => file.isDefault) || null;
  useEffect(() => {
    let current = true;
    if (!first) { setMarks([]); return undefined; }
    bookSectionsService.bookmarks(score.id, first.id).then(list => { if (current) setMarks(list); }).catch(() => undefined);
    return () => { current = false; };
  }, [score.id, first?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A piece's first page in the PDF that opens first, to open it there. */
  const pageOf = (pieceId: number, partWorkId: string | null) => marks.find(mark => markKey(mark.pieceId, mark.partWorkId) === markKey(pieceId, partWorkId))?.startPage ?? null;
  const openAt = (page: number, piece?: string) => first && (onRead ? onRead(score.id, first.id, page, piece) : window.open(scoreFileUrl(score.id, first.id, page), '_blank', 'noopener'));
  const openFile = (file: ScoreFile) => (onRead ? onRead(score.id, file.id) : openScoreFile(file));
  /** Pieces' pages on A4, opened to print: "12:" a piece, "12:w1" a part, "12:*" a set's parts marked. */
  const print = (keys: string[], name?: string) => first && window.open(scorePrintUrl(score.id, keys, { file: first.id, name }), '_blank', 'noopener');
  const [printing, setPrinting] = useState(false);

  const load = () => scorePiecesService.pieces(score.id)
    .then(list => { setPieces(list); if (!list.length) setFinding(true); })
    .catch(error => { setPieces([]); toast((error as Error).message, { tone: 'danger' }); });
  useEffect(() => { setPieces(null); setFinding(false); load(); }, [score.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (list: ScorePiece[]) => { setPieces(list); setFinding(false); onChanged(); };
  const heard = (pieces || []).reduce((n, p) => n + (p.single ? (p.albums.length ? 1 : 0) : p.parts.filter(part => part.recordings.length).length), 0);
  const total = (pieces || []).reduce((n, p) => n + (p.single ? 1 : p.parts.length), 0);

  const values: EditionValues = {
    title: pieceOf(String(book?.title ?? score.title)),
    composer: String(book?.composer ?? score.composer ?? ''),
    publisher: String(book?.publisher ?? score.publisher ?? ''),
    number: referenceOf(String(book?.title ?? score.title)) || '',
    code: String(book?.isbn13 ?? score.isbn13 ?? ''),
    priceChf: book?.priceChf != null ? String(book.priceChf) : '',
    purchasedAt: book?.purchasedAt ? String(book.purchasedAt).slice(0, 10) : '',
    borrowed: (book?.titleStatus ?? score.titleStatus) === 'borrowed',
    owner: String(book?.owner ?? ''),
  };
  const level = henle.level ?? (book?.difficulty as number | null) ?? null;

  const save = async () => {
    if (!editing || !book) return;
    setSaving(true);
    try {
      const price = parseFloat(editing.priceChf.replace(',', '.'));
      await bookService.updateBook(score.id, {
        ...book,
        // Its PDF is its files' to say: the one read when the card opened may be gone.
        ebookFile: undefined,
        // Its title as kept when neither its words nor its number changed: "Préludes Vol. 1 - piano - (HN 383)" stays whole.
        title: editing.title === values.title && editing.number === values.number ? book.title : titleWithNumber(editing.title, editing.number),
        composer: editing.composer.trim() || null,
        publisher: editing.publisher.trim() || null,
        isbn13: editing.code.replace(/[\s-]/g, '') || null,
        titleStatus: editing.borrowed ? 'borrowed' : 'owned',
        // The owner is the lender of a score borrowed: one kept as one's own again has none of it left.
        owner: editing.borrowed ? editing.owner.trim() || null : values.borrowed ? null : book.owner ?? null,
        priceChf: editing.borrowed || !Number.isFinite(price) ? null : price,
        purchasedAt: editing.borrowed ? null : editing.purchasedAt || null,
      });
      setEditing(null);
      await loadBook();
      onChanged();
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this score?', message: 'Its pieces and its notes go with it.', confirmLabel: 'Delete', danger: true }))) return;
    try { await bookService.deleteBook(score.id); onDeleted?.(); onClose(); } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };

  const keepNote = async () => {
    if (!writing?.trim()) return;
    try {
      await bookCommentService.createComment({ bookId: score.id, name: commenter(), comment: writing.trim(), date: new Date().toISOString() });
      setWriting(null);
      loadNotes();
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };
  const removeNote = async (id: number) => {
    if (!(await confirm({ title: 'Delete this note?', message: 'It goes for good.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await bookCommentService.deleteComment(id);
      setNotes(prev => prev.filter(note => note.id !== id));
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };

  const choose = async (piece: ScorePiece, albumId: number) => {
    setPieces(prev => (prev || []).map(p => (p.id === piece.id ? { ...p, preferredAlbumId: albumId } : p)));
    try { await scorePiecesService.choose(score.id, piece.id, albumId); } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };
  const keepParts = async (piece: ScorePiece, workIds: string[]) => {
    try { setPieces(await scorePiecesService.keepParts(score.id, piece.id, workIds)); onChanged(); } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };
  const removePiece = async (piece: ScorePiece) => {
    if (!(await confirm({ title: 'Take this piece out?', message: `${piece.title} leaves the score; its recordings stay in your music.`, confirmLabel: 'Take it out', danger: true }))) return;
    try {
      await scorePiecesService.removePiece(score.id, piece.id);
      const left = (pieces || []).filter(p => p.id !== piece.id);
      setPieces(left);
      if (!left.length) setFinding(true);
      onChanged();
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };

  const cover = book?.cover ?? score.cover;
  // What its publisher writes of it, in French or English; a shop's listing taken for words ("Support - Partition…") is not shown.
  const about = typeof book?.description === 'string' && !isUnwanted(book.description) ? book.description.trim() : '';
  const title = pieceOf(String(book?.title ?? score.title));
  const coverUrl = cover ? bookService.getImageUrl(String(cover)) || '' : '';
  const openPdf = () => (onRead ? onRead(score.id) : window.open(scorePdfUrl(score.id), '_blank', 'noopener'));
  const filesBody = <ScoreFiles scoreId={score.id} files={files} onChange={filesChanged} onAdd={() => onAttach(score)} onImslp={() => setEditionsShown(true)}
    onMark={pieces?.length ? setMarking : undefined} onOpen={onRead ? openFile : undefined} />;
  const openImslp = () => window.open(imslp, '_blank', 'noopener');
  const openHenle = henle.url ? () => window.open(henle.url!, '_blank', 'noopener') : null;
  const editionForm = editing && (
    <>
      <EditionForm values={editing} onChange={setEditing} />
      <div className="score-edition__actions">
        <Button size="sm" variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
        <Button size="sm" onClick={save} loading={saving} disabled={!editing.title.trim()}>Keep it</Button>
      </div>
    </>
  );
  const aboutText = !editing && about && (
    <div className={`score-card__about-text${aboutOpen ? ' score-card__about-text--open' : ''}`}>
      {about.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {(about.length > 260 || about.includes('\n')) && (
        <Button size="sm" variant="quiet" onClick={() => setAboutOpen(open => !open)}>{aboutOpen ? 'Less' : 'Read more'}</Button>
      )}
    </div>
  );
  const piecesBody = !pieces ? <Loading>Reading its pieces…</Loading> : (
    <>
      {pieces.map(piece => (
        <PieceBlock key={piece.id} piece={piece} composer={score.composer} playing={playing} pageOf={pageOf} onOpenPage={first ? openAt : undefined}
          onPrint={first ? (keys, name) => print(keys, name && `${title} – ${name}`) : undefined}
          heard={playedFrom?.track === playing ? playedFrom.row : null} onHeard={(row, track) => setPlayedFrom({ row, track })}
          onChoose={albumId => choose(piece, albumId)} onKeep={workIds => keepParts(piece, workIds)} onRemove={() => removePiece(piece)} />
      ))}
      {finding && <FindPieces score={score} first={!pieces.length} onAdded={changed} onCancel={pieces.length ? () => setFinding(false) : undefined} />}
    </>
  );
  const addPiece = pieces?.length && !finding ? () => setFinding(true) : null;
  // Several pieces to print at once: those marked in the PDF that opens first.
  const marked = markRowsOf(pieces || []).filter(row => pageOf(row.pieceId, row.partWorkId));
  const printSeveral = first && marked.length > 1 ? () => setPrinting(true) : null;
  const notesBody = (
    <>
      {notes.map(note => (
        <blockquote key={note.id} className="score-card__note">
          {note.comment}
          <small>
            {note.name}, {new Date(note.date).toLocaleDateString('fr-CH')}
            <IconButton size="sm" tone="danger" label="Delete this note" onClick={() => removeNote(note.id)}><BsTrash /></IconButton>
          </small>
        </blockquote>
      ))}
      {writing !== null && (
        <div className="score-card__write">
          <TextArea rows={3} value={writing} autoFocus onChange={e => setWriting(e.target.value)} placeholder="What to work on, a fingering, a tempo…" aria-label="A note on the score" />
          <div className="score-edition__actions">
            <Button size="sm" variant="quiet" onClick={() => setWriting(null)}>Cancel</Button>
            <Button size="sm" onClick={keepNote} disabled={!writing.trim()}>Keep it</Button>
          </div>
        </div>
      )}
      {!notes.length && writing === null && <p className="score-card__empty">No note yet.</p>}
    </>
  );
  const coverModal = (
    <>
      <CoverModal isOpen={coverShown} onClose={() => setCoverShown(false)} coverUrl={coverUrl} title={title} artist={values.composer || undefined} coverType="Cover" />
      {editionsShown && <ImslpEditions scoreId={score.id} reference={values.number || null} onClose={() => setEditionsShown(false)} onAdded={filesChanged} />}
      {printing && (
        <PrintPieces rows={marked} pageOf={pageOf} onClose={() => setPrinting(false)}
          onPrint={keys => {
            print(keys, `${title} – ${keys.length === 1 ? marked.find(row => markKey(row.pieceId, row.partWorkId) === keys[0])?.name : `${keys.length} pieces`}`);
            setPrinting(false);
          }} />
      )}
      {marking && (
        <ScoreBookmarks scoreId={score.id} file={marking} pieces={pieces || []} onClose={() => setMarking(null)}
          onSaved={list => {
            if (marking.id === first?.id) setMarks(list);
            toast(`${list.length} piece${list.length === 1 ? '' : 's'} marked in ${marking.label}`, { tone: 'success' });
            bookSectionsService.files(score.id).then(setFiles).catch(() => undefined);
          }} />
      )}
    </>
  );

  if (phone) {
    return (
      <>
        <ScoreSheet id={score.id} title={title} composer={values.composer} edition={editionLine(values, level)} reference={values.number}
          code={values.code} cover={coverUrl} borrowed={values.borrowed} hasPdf={Boolean(score.ebookFile)} imslpPage={imslpPage}
          heard={heard} total={total} about={aboutText} pieces={piecesBody} pieceCount={pieces?.length ?? 0} onAddPiece={addPiece} onPrintSeveral={printSeveral}
          notes={notesBody} noteCount={notes.length} onAddNote={writing === null ? () => setWriting('') : null}
          editing={editing != null} editionForm={editionForm} onEdit={() => setEditing(values)}
          onCancelEdit={() => setEditing(null)} writing={writing !== null}
          onShowCover={() => setCoverShown(true)} coverShown={coverShown} onHideCover={() => setCoverShown(false)} onPdf={openPdf} onImslp={openImslp} onFindPdf={() => setEditionsShown(true)} onHenle={openHenle}
          onAttach={() => onAttach(score)} onDelete={remove} onClose={onClose} files={filesBody} fileCount={files.length}
          facts={[
            ['Publisher', values.publisher || null],
            ['Number', values.number || null],
            [values.code.length === 13 && values.code.startsWith('9790') ? 'ISMN' : 'ISBN', values.code || null],
            ['Henle level', level ? String(level) : null],
            ...(values.borrowed
              ? [['Borrowed', values.owner ? `from ${values.owner}` : 'yes'] as [string, string]]
              : [['Paid', francs(values.priceChf.replace(',', '.'))], ['Bought', values.purchasedAt ? new Date(values.purchasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null]] as Array<[string, string | null]>),
          ]} />
        {coverModal}
      </>
    );
  }

  return (
    <Dialog show onClose={onClose} variant="panel" size="lg" icon={<BsFileMusic />} title={title} className="score-card">
      <Dialog.Body>
        <div className="score-card__head">
          {cover ? (
            <button type="button" className="score-card__cover" onClick={() => setCoverShown(true)} title="See it large">
              <img src={coverUrl} alt="" />
            </button>
          ) : <span className="score-card__blank" />}
          <div className="score-card__about">
            <div className="score-card__composer">{values.composer || 'Composer unknown'}</div>
            {!editing && (
              <div className="score-card__facts">
                {editionLine(values, level).join(' · ') || 'Its edition'}
                <IconButton size="sm" label="Change its edition" onClick={() => setEditing(values)}><BsPencil /></IconButton>
              </div>
            )}
            {!editing && values.code && <div className="score-card__code">{values.code.length === 13 && values.code.startsWith('9790') ? 'ISMN' : 'ISBN'} {values.code}</div>}
            <div className="score-card__acts">
              {score.ebookFile ? (
                <>
                  {files.length > 1 ? (
                    // Several: the one that opens first, the others under its ▾.
                    <span className="ui-button-group">
                      <Button size="sm" icon={<BsFileEarmarkPdf />} onClick={openPdf}>PDF</Button>
                      <Menu align="start" trigger={(props, open) => (
                        <Button {...props} size="sm" className="ui-button--split" aria-label="Its other PDFs"><MenuChevron open={open} /></Button>
                      )}>
                        {files.map(file => <Menu.Item key={file.id} icon={<BsFileEarmarkPdf />} hint={file.isDefault ? 'opens first' : undefined} onSelect={() => openFile(file)}>{file.label}</Menu.Item>)}
                      </Menu>
                    </span>
                  ) : <Button size="sm" icon={<BsFileEarmarkPdf />} onClick={openPdf}>PDF</Button>}
                  <Button size="sm" variant="quiet" icon={<BsBoxArrowUpRight />} onClick={openImslp}>On IMSLP</Button>
                </>
              ) : (
                <>
                  <Button size="sm" icon={<BsBoxArrowUpRight />} onClick={() => setEditionsShown(true)}
                    title={imslpPage ? `Its editions on IMSLP: ${imslpPage}` : 'Its editions on IMSLP'}>Find the PDF on IMSLP</Button>
                  <Button size="sm" variant="quiet" icon={<BsPaperclip />} onClick={() => onAttach(score)}>Attach PDF</Button>
                </>
              )}
              {openHenle && <Button size="sm" variant="quiet" icon={<BsBoxArrowUpRight />} onClick={openHenle}>henle.de</Button>}
              {total > 0 && heard > 0 && <CoverTag variant="gold">♪ {heard} of {total} in your music</CoverTag>}
              <Menu align="end" trigger={props => <IconButton {...props} label="More" size="sm"><BsThreeDots /></IconButton>}>
                <Menu.Item icon={<BsPencil />} onSelect={() => setEditing(values)}>Change its edition</Menu.Item>
                {score.ebookFile && <Menu.Item icon={<BsPaperclip />} onSelect={() => onAttach(score)}>Add a PDF</Menu.Item>}
                <Menu.Separator />
                <Menu.Item danger onSelect={remove}>Delete the score</Menu.Item>
              </Menu>
            </div>
          </div>
        </div>
        {editionForm}
        {aboutText}

        <section className="score-card__section">
          <h4>
            {pieces?.length ? 'Its pieces' : 'Its pieces, to find'}
            {printSeveral && <Button size="sm" variant="quiet" className="score-card__add" icon={<BsPrinter />} onClick={printSeveral}>Print several…</Button>}
            {addPiece && <Button size="sm" variant="quiet" className={printSeveral ? undefined : 'score-card__add'} onClick={addPiece}>+ Add a piece</Button>}
          </h4>
          {piecesBody}
        </section>

        {files.length > 0 && (
          <section className="score-card__section">
            <h4>Its PDFs</h4>
            {filesBody}
          </section>
        )}

        <section className="score-card__section">
          <h4>
            Notes
            {writing === null && <Button size="sm" variant="quiet" className="score-card__add" onClick={() => setWriting('')}>+ A note</Button>}
          </h4>
          {notesBody}
        </section>
      </Dialog.Body>
      {coverModal}
    </Dialog>
  );
};

/** Several of its pieces to print as one: those marked, all of them checked at first. */
const PrintPieces: React.FC<{
  rows: Array<{ key: string; pieceId: number; partWorkId: string | null; name: string; group: string | null }>;
  pageOf: (pieceId: number, partWorkId: string | null) => number | null;
  onClose: () => void;
  onPrint: (keys: string[]) => void;
}> = ({ rows, pageOf, onClose, onPrint }) => {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return (
    <Dialog show onClose={onClose} title="Print several of its pieces" icon={<BsPrinter />} className="score-print">
      <Dialog.Body>
        {rows.map((row, index) => (
          <React.Fragment key={row.key}>
            {row.group && rows[index - 1]?.group !== row.group && <div className="score-print__group">{row.group}</div>}
            <Form.Check type="checkbox" id={`print-${row.key}`} checked={picked.has(row.key)} onChange={() => toggle(row.key)}
              label={<>{row.name} <small>p. {pageOf(row.pieceId, row.partWorkId)}</small></>} />
          </React.Fragment>
        ))}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<BsPrinter />} disabled={!picked.size}
          onClick={() => onPrint(rows.filter(row => picked.has(row.key)).map(row => row.key))}>
          {picked.size ? `Print ${picked.size} piece${picked.size === 1 ? '' : 's'}` : 'Print'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

/** A score to add, in a dialog as the other sections' are: from a title or its ISMN, its works to check, its edition in a line; its card opens once added. */
const AddScore: React.FC<ScoreCardProps> = ({ onClose, onCreated }) => {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ScoreLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<EditionValues>({ title: '', composer: '', publisher: '', number: '', code: '', priceChf: '', purchasedAt: today(), borrowed: false, owner: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverShown, setCoverShown] = useState(true);
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Another work in it, found by a search: Impromptus beside Ballades.
  const [extra, setExtra] = useState<PieceSuggestion[]>([]);
  const [another, setAnother] = useState('');
  const [hits, setHits] = useState<PieceSuggestion[] | null>(null);
  useEffect(() => {
    if (another.trim().length < 2) { setHits(null); return undefined; }
    const timer = setTimeout(() => { scorePiecesService.search(another).then(setHits).catch(() => setHits([])); }, 400);
    return () => clearTimeout(timer);
  }, [another]);
  const addAnother = (hit: PieceSuggestion) => {
    setExtra(prev => (prev.some(work => work.workId === hit.workId) ? prev : [...prev, hit]));
    setPicked(prev => new Set(prev).add(hit.workId));
    setAnother('');
    setHits(null);
  };

  useEffect(() => {
    const words = query.trim();
    if (words.length < 3) { setFound(null); return undefined; }
    setLooking(true);
    let current = true;
    const timer = setTimeout(() => {
      scorePiecesService.lookup(words)
        .then(result => {
          if (!current) return;
          setFound(result);
          setCoverShown(true);
          setPicked(new Set(result.works.filter(work => work.likely !== false).map(work => work.workId)));
          setValues(prev => ({
            ...prev,
            title: result.edition.title || prev.title,
            composer: result.edition.composer || '',
            publisher: result.edition.publisher || (result.from === 'words' ? prev.publisher : ''),
            number: result.edition.number || (result.from === 'words' ? prev.number : ''),
            code: result.edition.code || (result.from === 'words' ? prev.code : ''),
          }));
        })
        .catch(error => { if (current) toast((error as Error).message, { tone: 'danger' }); })
        .finally(() => { if (current) setLooking(false); });
    }, 600);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);

  const scan = async (file: File | undefined) => {
    if (!file) return;
    try {
      const code = await decodeBarcode(file);
      if (code) setQuery(code); else toast('No barcode read on the photo', { tone: 'warning' });
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally { if (scanRef.current) scanRef.current.value = ''; }
  };

  const add = async () => {
    setSaving(true);
    try {
      const { id } = await scorePiecesService.create({
        title: values.title.trim(),
        composer: values.composer.trim() || null,
        publisher: values.publisher.trim() || null,
        number: values.number.trim() || null,
        code: values.code.replace(/[\s-]/g, '') || null,
        cover: found?.edition.cover ?? null,
        level: found?.edition.level ?? null,
        url: found?.edition.url ?? null,
        description: found?.edition.description ?? null,
        priceChf: values.borrowed ? null : values.priceChf.trim() || null,
        purchasedAt: values.borrowed ? null : values.purchasedAt || null,
        titleStatus: values.borrowed ? 'borrowed' : 'owned',
        owner: values.borrowed ? values.owner.trim() || null : null,
        workIds: [...picked],
      });
      toast(`${values.title.trim()}: added to Scores`, { tone: 'success' });
      onCreated?.(id);
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally { setSaving(false); }
  };

  const works = [...(found?.works || []), ...extra.filter(work => !(found?.works || []).some(other => other.workId === work.workId))];
  const slow = works.some(work => picked.has(work.workId) && /^(?:wd|imslp):/.test(work.workId));
  return (
    <Dialog show onClose={onClose} modal={saving} size="lg" icon={<BsFileMusic />} title="Add a score" className="score-card score-add" onEntered={() => searchRef.current?.focus()}>
      <Dialog.Body>
        <div className="score-add__search">
          <TextField ref={searchRef} icon={<BsSearch />} value={query} onChange={e => setQuery(e.target.value)} aria-label="A work, a composer, or its ISMN"
            placeholder="A work, a composer, or the ISMN on its back" suffix={looking ? <Spinner size="sm" /> : undefined} />
          <Button icon={<BsUpcScan />} onClick={() => scanRef.current?.click()} title="Photograph its barcode">Scan</Button>
          <input ref={scanRef} type="file" accept="image/*" capture="environment" hidden data-testid="score-scan" onChange={e => scan(e.target.files?.[0])} />
        </div>

        {found?.from === 'henle' && (
          <Notice className="score-add__notice" title="An edition of G. Henle Verlag">
            {[found.edition.composer, found.edition.title, found.edition.number].filter(Boolean).join(' · ')}: its title and its cover come with it.
          </Notice>
        )}
        {found?.from === 'code' && (
          <Notice className="score-add__notice" tone="warning">
            This code says nothing found{found.edition.number ? ` (${found.edition.number}, not on henle.de)` : ''}: type its title to find its work.
          </Notice>
        )}

        {found && (
          <>
            <div className="score-card__head">
              {found.edition.cover && coverShown
                ? <img src={found.edition.cover} alt="" onError={() => setCoverShown(false)} />
                : <span className="score-card__blank" title="Its cover: from Henle when known, else a photo on its card" />}
              <div className="score-card__about">
                <div className="score-card__composer">{values.composer || (works.length ? 'Composer unknown' : 'Several composers')}</div>
                <div className="score-add__title">{values.title || 'Its title'}</div>
                {!editing && (
                  <div className="score-card__facts">
                    {editionLine(values, found.edition.level).join(' · ') || 'Its edition'}
                    <IconButton size="sm" label="Change its edition" onClick={() => setEditing(true)}><BsPencil /></IconButton>
                  </div>
                )}
              </div>
            </div>
            {editing && <EditionForm values={values} onChange={setValues} />}

            <section className="score-card__section">
              <h4>Its pieces <span className="score-add__hint">— check what it holds</span></h4>
              {works.length ? works.map(work => (
                <label key={work.workId} className={`score-find__sugg${picked.has(work.workId) ? ' score-find__sugg--on' : ''}`}>
                  <Form.Check type="checkbox" checked={picked.has(work.workId)} aria-label={work.title}
                    onChange={() => setPicked(prev => { const next = new Set(prev); if (next.has(work.workId)) next.delete(work.workId); else next.add(work.workId); return next; })} />
                  <span className="score-find__text">
                    {work.title}
                    <small>{[work.parts ? `${work.parts} pieces` : 'one piece', work.inYourMusic ? `${work.inYourMusic} in your music` : null].filter(Boolean).join(' · ')}</small>
                  </span>
                  {WHY[work.why] && <span className="score-find__why">{WHY[work.why]}</span>}
                </label>
              )) : (
                <Notice className="score-find__notice">
                  No work found for it: a book of pieces by several hands, a method. Its pieces come after, on its card: a photo of its contents, or one by one.
                </Notice>
              )}
              <div className="score-find__more">
                <TextField size="sm" icon={<BsSearch />} value={another} onChange={e => setAnother(e.target.value)}
                  placeholder="Another work in it: a title, a number (op. 29)" aria-label="Another work in it" />
                {hits && (
                  <div className="score-find__hits menu-surface" role="listbox" aria-label="Works found">
                    {!hits.length ? <div className="menu-item" aria-disabled="true">Nothing found</div> : hits.map(hit => (
                      <button key={hit.workId} type="button" role="option" aria-selected="false" className="menu-item" onClick={() => addAnother(hit)}>
                        <span className="menu-item__label">{hit.title}</span>
                        <span className="menu-item__hint">{[hit.composers.join(', '), hit.inYourMusic ? 'in your music' : ''].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        {slow && saving && <Loading>Finding each of its pieces: about a second a piece…</Loading>}
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={add} loading={saving} disabled={!found || !values.title.trim()}>Add the score</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

interface PieceBlockProps {
  piece: ScorePiece;
  composer: string | null;
  playing: string | null;
  /** The row last played from, while its track plays. */
  heard: string | null;
  onHeard: (row: string, track: string) => void;
  onChoose: (albumId: number) => void;
  /** The parts of its work the score holds. */
  onKeep: (workIds: string[]) => Promise<void>;
  onRemove: () => void;
  /** Its first page in the PDF that opens first, a part of a set by its work. */
  pageOf: (pieceId: number, partWorkId: string | null) => number | null;
  onOpenPage?: (page: number, piece: string) => void;
  /** Its pages, or a part's, on A4 to print. */
  onPrint?: (keys: string[], name?: string) => void;
}

/** A piece: its parts, each with the chosen recording, the others behind +N. */
const PieceBlock: React.FC<PieceBlockProps> = ({ piece, composer, playing, heard, onHeard, onChoose, onKeep, onRemove, pageOf, onOpenPage, onPrint }) => {
  const chosen = piece.albums.find(album => album.albumId === piece.preferredAlbumId) || piece.albums[0];
  const rows = piece.single
    ? [{ workId: piece.workId || String(piece.id), title: piece.title, name: '', sub: null as string | null, imslp: piece.imslp, recordings: piece.albums.length ? recordingsOfSingle(piece) : [] }]
    : piece.parts;
  const heardHere = piece.single ? (piece.albums.length ? 1 : 0) : piece.parts.filter(part => part.recordings.length).length;
  // A long set (24 préludes, 67 pieces of a notebook) shows its first five, the others on asking.
  const [allShown, setAllShown] = useState(rows.length <= 7);
  // Choosing the parts it holds (a sonata's funeral march alone): every part of the work, checked or not.
  const [keeping, setKeeping] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const total = piece.choices.length;
  // Its parts in the chosen recording; an album playing it whole in one track plays that track.
  const partsOfChosen = chosen ? rows.flatMap(row => row.recordings.filter(r => r.albumId === chosen.albumId).slice(0, 1)) : [];
  const ofChosen = partsOfChosen.length || !chosen ? partsOfChosen : piece.whole.filter(r => r.albumId === chosen.albumId).slice(0, 1);
  // The row playing: the one played from, else the first whose recording the player is on.
  const mains = rows.map(row => mainOf(row.recordings, chosen?.albumId ?? null));
  const rowId = (index: number) => `${piece.id}:${index}`;
  const playingAt = !playing ? -1
    : heard?.startsWith(`${piece.id}:`) ? Number(heard.split(':')[1])
    : heard ? -1 : mains.findIndex(main => main && keyOf(main) === playing);

  return (
    <div className="score-piece">
      <div className="score-piece__head">
        <div className="score-piece__title">
          <b>{piece.title}</b>
          <small>
            {piece.single ? 'One piece' : piece.parts.length < total ? `${piece.parts.length} of its ${total} pieces` : `${piece.parts.length} pieces`}
            {heardHere > 0 && ` · ${heardHere} in your music${piece.albums.length > 1 ? `, ${piece.albums.length} recordings` : ''}`}
            {!piece.workId && ' · not found in MusicBrainz'}
          </small>
        </div>
        {keeping ? (
          <span className="score-piece__keeping">
            <Button size="sm" variant="quiet" onClick={() => setKeeping(null)}>Cancel</Button>
            <Button size="sm" loading={saving} disabled={!keeping.size}
              onClick={async () => { setSaving(true); await onKeep([...keeping]); setSaving(false); setKeeping(null); }}>
              Keep {keeping.size} of {total}
            </Button>
          </span>
        ) : chosen && !piece.single && (
          <span className="ui-button-group">
            <Button size="sm" icon={<BsPlayFill />} onClick={() => play(ofChosen)} title={`${chosen.title} (${chosen.year ?? '—'})`}>
              All · {surnameOf(chosen.performers)}
            </Button>
            {piece.albums.length > 1 && (
              <Menu align="end" label="Which recording" trigger={(props, open) => (
                <Button {...props} size="sm" className="ui-button--split" aria-label="Which recording" title="Which recording"><MenuChevron open={open} /></Button>
              )}>
                <Menu.Section title="Played first" />
                {piece.albums.map(album => (
                  <Menu.Choice key={album.albumId} selected={album.albumId === chosen.albumId} onSelect={() => onChoose(album.albumId)}
                    hint={`${album.year ?? ''}${piece.single ? '' : ` · ${album.covered} of ${piece.parts.length}`}`}>
                    {album.performers.join(', ') || album.title}
                  </Menu.Choice>
                ))}
              </Menu>
            )}
          </span>
        )}
        <Menu align="end" trigger={props => <IconButton {...props} label="More" size="sm"><BsThreeDots /></IconButton>}>
          <Menu.Item icon={<BsBoxArrowUpRight />} hint={piece.imslp ? 'its page' : 'a search'}
            onSelect={() => window.open(imslpPieceUrl(piece.imslp, composer, piece.title), '_blank', 'noopener')}>On IMSLP</Menu.Item>
          <Menu.Item icon={<BsYoutube />} onSelect={() => window.open(youtubeUrl(composer, piece.title), '_blank', 'noopener')}>On YouTube</Menu.Item>
          {onPrint && !piece.single && rows.some(row => pageOf(piece.id, row.workId)) && (
            <Menu.Item icon={<BsPrinter />} onSelect={() => onPrint([`${piece.id}:*`], piece.title)}>Print it all</Menu.Item>
          )}
          <Menu.Separator />
          {total > 1 && (
            <Menu.Item icon={<BsListCheck />} hint={piece.parts.length < total ? `${total - piece.parts.length} left out` : undefined}
              onSelect={() => setKeeping(new Set(piece.choices.filter(c => c.kept).map(c => c.workId)))}>Choose the parts it holds</Menu.Item>
          )}
          <Menu.Item danger onSelect={onRemove}>Take it out of the score</Menu.Item>
        </Menu>
      </div>

      {keeping && piece.choices.map(choice => (
        <label key={choice.workId} className={`score-piece__row score-piece__row--choice${keeping.has(choice.workId) ? '' : ' score-piece__row--none'}`}>
          <Form.Check type="checkbox" checked={keeping.has(choice.workId)} aria-label={choice.name}
            onChange={() => setKeeping(prev => { const next = new Set(prev); if (next.has(choice.workId)) next.delete(choice.workId); else next.add(choice.workId); return next; })} />
          <span className="score-piece__name">{choice.name}{choice.sub && <small>{choice.sub}</small>}</span>
        </label>
      ))}
      {!keeping && (allShown ? rows : rows.slice(0, 5)).map((row, index) => (
        <div key={row.workId + index} className={`score-piece__row${row.recordings.length ? '' : ' score-piece__row--none'}${index === playingAt ? ' score-piece__row--playing' : ''}`}>
          <span className="score-piece__n">{index === playingAt ? <BsVolumeUpFill aria-label="Playing" /> : piece.single ? '' : index + 1}</span>
          <span className="score-piece__name">{row.name}{row.sub && <small>{row.sub}</small>}</span>
          <span className="score-piece__recs">
            {(() => {
              const page = pageOf(piece.id, piece.single ? null : row.workId);
              return page && onOpenPage ? (
                <>
                  <Button size="sm" variant="quiet" onClick={() => onOpenPage(page, markKey(piece.id, piece.single ? null : row.workId))} title={`Open the PDF at page ${page}`}>p. {page}</Button>
                  {onPrint && (
                    <IconButton size="sm" label={`Print ${row.name || piece.title}`}
                      onClick={() => onPrint([markKey(piece.id, piece.single ? null : row.workId)], row.name || piece.title)}><BsPrinter /></IconButton>
                  )}
                </>
              ) : null;
            })()}
            <Recordings recordings={row.recordings} piece={piece} chosenAlbumId={chosen?.albumId ?? null}
              onPlay={recording => onHeard(rowId(index), keyOf(recording))}
              youtube={youtubeUrl(composer, piece.single ? piece.title : `${piece.title} ${row.name}`)} single={piece.single} />
            {row.imslp && (
              <IconButton size="sm" label="Its score on IMSLP" onClick={() => window.open(imslpPieceUrl(row.imslp), '_blank', 'noopener')}>
                <BsBoxArrowUpRight />
              </IconButton>
            )}
          </span>
        </div>
      ))}
      {!keeping && !allShown && (
        <Button size="sm" variant="quiet" className="score-piece__more" onClick={() => setAllShown(true)}>{rows.length - 5} more pieces</Button>
      )}
    </div>
  );
};

const RecordingButton: React.FC<{ recording: PieceRecording; label: string; onPlay: (recording: PieceRecording) => void }> = ({ recording, label, onPlay }) => (
  <Button size="sm" className="score-piece__play" icon={<BsPlayFill />}
    onClick={() => { onPlay(recording); play([recording]); }} title={recording.title}>
    {label} <span className="score-piece__time">{fmt(recording.durationSec)}</span>
  </Button>
);


const Recordings: React.FC<{ recordings: PieceRecording[]; piece: ScorePiece; chosenAlbumId: number | null; onPlay: (recording: PieceRecording) => void; youtube: string; single: boolean }> = ({
  recordings, piece, chosenAlbumId, onPlay, youtube, single,
}) => {
  if (!recordings.length) {
    return (
      <>
        <span className="score-piece__none">{single ? 'Not in your music' : '—'}</span>
        <Button size="sm" variant="quiet" icon={<BsYoutube />} onClick={() => window.open(youtube, '_blank', 'noopener')} title="Search it on YouTube">YouTube</Button>
      </>
    );
  }
  const main = mainOf(recordings, chosenAlbumId)!;
  const rest = recordings.filter(r => r !== main);
  const by = (r: PieceRecording) => surnameOf(piece.albums.find(a => a.albumId === r.albumId)?.performers || []);
  return (
    <>
      <RecordingButton recording={main} label={by(main)} onPlay={onPlay} />
      {rest.length > 0 && (
        <Menu align="end" label="Its other recordings" trigger={props => (
          <Button {...props} size="sm" variant="quiet" title="Its other recordings">+{rest.length}</Button>
        )}>
          {rest.map(r => {
            const album = piece.albums.find(a => a.albumId === r.albumId);
            return (
              <Menu.Item key={keyOf(r)} icon={<BsPlayFill />} hint={`${album?.year ?? ''} · ${fmt(r.durationSec)}`} onSelect={() => { onPlay(r); play([r]); }}>
                {album?.performers.join(', ') || album?.title}
              </Menu.Item>
            );
          })}
          <Menu.Separator />
          <Menu.Item icon={<BsYoutube />} onSelect={() => window.open(youtube, '_blank', 'noopener')}>On YouTube</Menu.Item>
        </Menu>
      )}
    </>
  );
};

/**
 * What a score holds, to confirm: suggested from its numbers, the music's own
 * works and its title; a search; a photo of its table of contents.
 */
const FindPieces: React.FC<{ score: Score; first: boolean; onAdded: (pieces: ScorePiece[]) => void; onCancel?: () => void }> = ({ score, first, onAdded, onCancel }) => {
  const [suggestions, setSuggestions] = useState<PieceSuggestion[] | null>(first ? null : []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PieceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!first) return;
    setSuggestions(null);
    setFailed(null);
    scorePiecesService.suggestions(score.id)
      .then(list => { setSuggestions(list); setPicked(new Set(list.filter(s => s.likely !== false).map(s => s.workId))); })
      .catch(error => { setSuggestions([]); setFailed((error as Error).message); });
  }, [score.id, first, attempt]);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return undefined; }
    setSearching(true);
    const timer = setTimeout(() => {
      scorePiecesService.search(query).then(setHits).catch(() => setHits([])).finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const keep = async (workIds: string[], titles: string[] = []) => {
    setSaving(true);
    try {
      let list: ScorePiece[] | null = null;
      if (workIds.length) list = await scorePiecesService.addPieces(score.id, { workIds });
      for (const title of titles) list = await scorePiecesService.addPieces(score.id, { title });
      if (list) onAdded(list);
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally { setSaving(false); }
  };

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { suggestions: read, truncated } = await scorePiecesService.contentsPhoto(score.id, image, file.type || 'image/jpeg');
      setSuggestions(read);
      setPicked(new Set(read.map((s, i) => s.workId || `title:${i}`)));
      if (truncated) toast('The contents were long: the last pieces may be missing', { tone: 'warning' });
      if (!read.length) toast('No piece could be read on the photo', { tone: 'warning' });
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally {
      setReading(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  const keyOfSuggestion = (s: PieceSuggestion, i: number) => s.workId || `title:${i}`;
  const chosen = (suggestions || []).filter((s, i) => picked.has(keyOfSuggestion(s, i)));

  return (
    <div className="score-find">
      {suggestions === null ? <Loading>Looking for its pieces in MusicBrainz…</Loading> : suggestions.length > 0 ? (
        <>
          <p className="score-find__hint">What it likely holds: check what the score has.</p>
          {suggestions.map((s, i) => {
            const key = keyOfSuggestion(s, i);
            return (
              <label key={key} className={`score-find__sugg${picked.has(key) ? ' score-find__sugg--on' : ''}`}>
                <Form.Check type="checkbox" checked={picked.has(key)} aria-label={s.title}
                  onChange={() => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />
                <span className="score-find__text">
                  {s.title}
                  <small>
                    {s.read && s.read !== s.title ? `read “${s.read}” · ` : ''}
                    {!s.workId ? 'not found in MusicBrainz: kept by its title' : [
                      s.parts ? `${s.parts} parts` : 'one piece',
                      s.inYourMusic ? `${s.inYourMusic} in your music` : 'none in your music',
                    ].join(' · ')}
                  </small>
                </span>
                {WHY[s.why] && <span className="score-find__why">{WHY[s.why]}</span>}
              </label>
            );
          })}
          {saving && chosen.some(s => /^(?:wd|imslp):/.test(s.workId)) && (
            <Loading>Finding each of its pieces in MusicBrainz: about a second a piece…</Loading>
          )}
          <div className="score-find__keep">
            {onCancel && <Button variant="quiet" size="sm" onClick={onCancel}>Cancel</Button>}
            <Button variant="primary" size="sm" loading={saving} disabled={!chosen.length}
              onClick={() => keep(chosen.filter(s => s.workId).map(s => s.workId), chosen.filter(s => !s.workId).map(s => s.title))}>
              {chosen.length > 1 ? `Keep these ${chosen.length}` : 'Keep it'}
            </Button>
          </div>
        </>
      ) : failed ? (
        <Notice className="score-find__notice" tone="warning" action={<Button size="sm" onClick={() => setAttempt(n => n + 1)}>Try again</Button>}>
          {failed}
        </Notice>
      ) : first && (
        <Notice className="score-find__notice">
          Its title says nothing of its pieces: an anthology, a method. Photograph its table of contents, or add its pieces one by one.
        </Notice>
      )}

      <div className="score-find__more">
        <h5>{suggestions?.length ? 'Something else in it' : 'Add a piece'}</h5>
        <div className="score-find__tools">
          <TextField size="sm" icon={<BsSearch />} value={query} onChange={e => setQuery(e.target.value)} autoFocus={!first}
            placeholder="A piece: a title, a composer, a number (op. 28, BWV 816)" aria-label="Find a piece" suffix={searching ? <Spinner size="sm" /> : undefined} />
          <Button size="sm" icon={<BsCamera />} loading={reading} onClick={() => photoRef.current?.click()}>Photo of the contents</Button>
          {!first && onCancel && !suggestions?.length && <Button variant="quiet" size="sm" onClick={onCancel}>Cancel</Button>}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden data-testid="contents-photo" onChange={e => readPhoto(e.target.files?.[0])} />
        </div>
        {hits && (
          <div className="score-find__hits menu-surface" role="listbox" aria-label="Pieces found">
            {!hits.length ? <div className="menu-item" aria-disabled="true">Nothing found</div> : hits.map(hit => (
              <button key={hit.workId} type="button" role="option" aria-selected="false" className="menu-item" disabled={saving}
                onClick={() => { setQuery(''); setHits(null); keep([hit.workId]); }}>
                <span className="menu-item__label">{hit.title}</span>
                <span className="menu-item__hint">{[hit.composers.join(', '), hit.inYourMusic ? 'in your music' : ''].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            {query.trim() && (
              <button type="button" className="menu-item" onClick={() => { const t = query.trim(); setQuery(''); setHits(null); keep([], [t]); }}>
                <span className="menu-item__label">Keep “{query.trim()}” by its title alone</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScoreCard;
