import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BsChevronLeft, BsChevronRight, BsFileEarmarkPdf, BsLayoutSplit, BsListUl, BsPauseFill, BsPlayFill, BsX } from 'react-icons/bs';
import bookSectionsService, { ScoreBookmark, ScoreFile, scoreFileUrl } from '../services/bookSectionsService';
import scorePiecesService, { ScorePiece } from '../services/scorePiecesService';
import bookService from '../services/bookService';
import { player, usePlayer } from '../services/player';
import { openPdf, PdfDocument } from '../utils/pdf';
import { keyOf as recordingKey, play, recordingOf, usePlaying } from '../utils/playPiece';
import { pieceOf } from '../utils/scoreTitle';
import { keyOf as markKey, rowsOf } from '../components/ScoreBookmarks';
import { IconButton } from '../components/shared/Button';
import Menu from '../components/shared/Menu';
import { Loading } from '../components/shared/Spinner';
import './ScoreReader.css';

const PAGE_KEY = (fileId: number) => `dv.reader.page.${fileId}`;
const LAYOUT_KEY = 'dv.reader.layout';
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private browsing */ } };

/** The pages shown: one, or two side by side when the screen is wider than high (unless one is asked). */
export const spreadOf = (page: number, pageCount: number, twoUp: boolean): number[] =>
  (twoUp && page < pageCount ? [page, page + 1] : [page]);

/** The page a turn leads to: by one, or by two side by side; never past the first or the last. */
export const turned = (page: number, by: 1 | -1, pageCount: number, twoUp: boolean): number => {
  const step = twoUp ? 2 : 1;
  return Math.min(Math.max(1, page + by * step), Math.max(1, pageCount - (twoUp && pageCount > 1 ? 1 : 0)));
};

/**
 * The piece a page is in: the one asked (opened at, chosen in ☰) while the page
 * is in it, else the last to begin on or before it that has not ended, the
 * later in the score of two beginning on the same page.
 */
export const pieceAt = (page: number, marks: ScoreBookmark[], asked: string | null = null): ScoreBookmark | null => {
  const holding = marks.filter(mark => mark.startPage <= page && mark.endPage >= page);
  return holding.find(mark => markKey(mark.pieceId, mark.partWorkId) === asked)
    ?? holding.reduce<ScoreBookmark | null>((last, mark) => (!last || mark.startPage >= last.startPage ? mark : last), null);
};

/** A page drawn to fit its box, swapped in once drawn so a turn never shows a blank. */
const Page: React.FC<{ pdf: PdfDocument; page: number; box: { width: number; height: number } }> = ({ pdf, page, box }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    (async () => {
      const size = await pdf.sizeOf(page);
      const width = Math.floor(Math.min(box.width, box.height * (size.width / size.height)));
      const canvas = document.createElement('canvas');
      await pdf.draw(page, canvas, width);
      if (current && ref.current) ref.current.replaceChildren(canvas);
    })().catch(() => undefined);
    return () => { current = false; };
  }, [pdf, page, box.width, box.height]);
  return <div ref={ref} className="score-reader__page" data-page={page} />;
};

/**
 * A score read full screen, as on a stand: its PDF a page or two at a time
 * (two when the screen lies wider than high), turned by a touch at its edges,
 * a swipe, the arrows or a pedal (which sends them), from its last page read
 * or a piece's first. Its bar, shown by a touch in the middle, says the piece
 * on the page, goes to another, plays its recording from the music, and
 * leaves. The screen stays awake while it is open.
 */
const ScoreReader: React.FC = () => {
  const scoreId = Number(useParams().id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<ScoreFile[] | null>(null);
  const [marks, setMarks] = useState<ScoreBookmark[]>([]);
  const [pieces, setPieces] = useState<ScorePiece[]>([]);
  const [title, setTitle] = useState('');
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // The piece asked for, by its key ("12:w1"): it names a page it shares with another.
  const [asked, setAsked] = useState<string | null>(() => params.get('piece'));
  const [barShown, setBarShown] = useState(true);
  const [oneUp, setOneUp] = useState(() => stored(LAYOUT_KEY) === 'one');
  const [box, setBox] = useState({ width: window.innerWidth, height: window.innerHeight });
  const playingKey = usePlaying();
  const playing = usePlayer(state => state.playing);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // A swipe turned the page: the click that follows it is not a touch.
  const swiped = useRef(false);

  const wanted = Number(params.get('file')) || null;
  const file = files ? files.find(f => f.id === wanted) || files.find(f => f.isDefault) || files[0] || null : null;
  const close = useCallback(() => navigate(`/scores?score=${scoreId}`), [navigate, scoreId]);

  useEffect(() => {
    bookSectionsService.files(scoreId).then(setFiles).catch(error => setFailed((error as Error).message));
    scorePiecesService.pieces(scoreId).then(setPieces).catch(() => undefined);
    bookService.getBookById(scoreId).then(book => setTitle(pieceOf(String((book as { title?: string })?.title || '')))).catch(() => undefined);
  }, [scoreId]);

  useEffect(() => {
    if (!file) return undefined;
    let current = true;
    let opened: PdfDocument | null = null;
    setPdf(null);
    bookSectionsService.bookmarks(scoreId, file.id).then(list => { if (current) setMarks(list); }).catch(() => undefined);
    openPdf(scoreFileUrl(scoreId, file.id))
      .then(doc => {
        opened = doc;
        if (!current) { doc.close(); return; }
        const asked = Number(params.get('page')) || Number(stored(PAGE_KEY(file.id))) || 1;
        setPage(Math.min(Math.max(1, asked), doc.pageCount));
        setPdf(doc);
      })
      .catch(error => { if (current) setFailed((error as Error).message); });
    return () => { current = false; opened?.close(); };
  }, [scoreId, file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = pdf?.pageCount ?? 0;
  const twoUp = !oneUp && box.width > box.height * 1.15 && pageCount > 1;
  const shown = spreadOf(page, pageCount, twoUp);
  useEffect(() => { if (file && pdf) store(PAGE_KEY(file.id), String(page)); }, [file, pdf, page]);

  const turn = useCallback((by: 1 | -1) => setPage(at => turned(at, by, pageCount, twoUp)), [pageCount, twoUp]);

  // The arrows, Page Up and Down, the space bar: a pedal sends one of them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); turn(-1); }
      else if (event.key === 'Home') setPage(1);
      else if (event.key === 'End') setPage(turned(pageCount, 1, pageCount, twoUp));
      else if (event.key === 'Escape' && !document.querySelector('.menu-surface')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, close, pageCount, twoUp]);

  useEffect(() => {
    const onResize = () => setBox({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The page under it does not scroll, and the screen does not sleep while one plays.
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let lock: { release: () => Promise<void> } | null = null;
    const wake = () => {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
      nav.wakeLock?.request('screen').then(found => { lock = found; }).catch(() => undefined);
    };
    wake();
    const again = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', again);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('visibilitychange', again);
      lock?.release().catch(() => undefined);
    };
  }, []);

  const rows = useMemo(() => rowsOf(pieces), [pieces]);
  const nameOf = (mark: ScoreBookmark) => rows.find(row => row.key === markKey(mark.pieceId, mark.partWorkId))?.name ?? null;
  const marked = rows.map(row => ({ row, mark: marks.find(mark => markKey(mark.pieceId, mark.partWorkId) === row.key) }))
    .filter((entry): entry is { row: typeof rows[number]; mark: ScoreBookmark } => Boolean(entry.mark));
  const here = pieceAt(shown[0], marks, asked);
  const herePiece = here ? pieces.find(piece => piece.id === here.pieceId) : null;
  const recording = here && herePiece ? recordingOf(herePiece, here.partWorkId) : null;
  const thisPlays = Boolean(recording && playingKey === recordingKey(recording));

  const tap = (event: React.MouseEvent) => {
    const x = event.clientX / box.width;
    if (x < 0.3) turn(-1);
    else if (x > 0.7) turn(1);
    else setBarShown(shown => !shown);
  };
  const pointerDown = (event: React.PointerEvent) => { swipe.current = { x: event.clientX, y: event.clientY }; };
  const pointerUp = (event: React.PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(event.clientY - from.y)) { swiped.current = true; turn(dx < 0 ? 1 : -1); }
  };

  const pagesBox = { width: twoUp ? box.width / 2 - 6 : box.width - 8, height: box.height - 8 };
  return (
    <div className="score-reader" role="dialog" aria-label={`Reading ${title}`}>
      {failed ? <p className="score-reader__message">{failed}</p>
        : files && !file ? <p className="score-reader__message">This score has no PDF yet.</p>
          : !pdf ? <Loading>Opening the score…</Loading>
            : (
              <div className={`score-reader__spread${twoUp ? ' score-reader__spread--two' : ''}`}
                onClick={event => { if (swiped.current) swiped.current = false; else tap(event); }}
                onPointerDown={pointerDown} onPointerUp={pointerUp}>
                {shown.map(number => <Page key={`${number}:${twoUp}`} pdf={pdf} page={number} box={pagesBox} />)}
              </div>
            )}

      {barShown && (
        <div className="score-reader__bar">
          <IconButton label="Close" onClick={close}><BsX /></IconButton>
          <div className="score-reader__title">
            <span>{title}</span>
            {here && <small>{nameOf(here) || herePiece?.title}</small>}
          </div>
          {marked.length > 0 && (
            <Menu align="end" trigger={props => <IconButton {...props} label="Go to a piece"><BsListUl /></IconButton>}>
              {marked.map(({ row, mark }) => (
                <Menu.Choice key={row.key} selected={here === mark} hint={`p. ${mark.startPage}`} onSelect={() => { setAsked(row.key); setPage(mark.startPage); }}>
                  {row.name}
                </Menu.Choice>
              ))}
            </Menu>
          )}
          <IconButton label={!recording ? 'Not in your music' : thisPlays && playing ? 'Pause' : `Play ${nameOf(here!) || herePiece?.title}`}
            active={thisPlays && playing} disabled={!recording}
            onClick={() => (thisPlays ? player.toggle() : recording && play([recording]))}>
            {thisPlays && playing ? <BsPauseFill /> : <BsPlayFill />}
          </IconButton>
          {pageCount > 1 && box.width > box.height * 1.15 && (
            <IconButton label={oneUp ? 'Two pages side by side' : 'One page at a time'} active={!oneUp}
              onClick={() => { setOneUp(one => { store(LAYOUT_KEY, one ? 'two' : 'one'); return !one; }); }}><BsLayoutSplit /></IconButton>
          )}
          {file && files && files.length > 1 && (
            <Menu align="end" trigger={props => <IconButton {...props} label="Another of its PDFs"><BsFileEarmarkPdf /></IconButton>}>
              {files.map(other => (
                <Menu.Choice key={other.id} selected={other.id === file.id} onSelect={() => navigate(`/scores/${scoreId}/read?file=${other.id}`, { replace: true })}>
                  {other.label}
                </Menu.Choice>
              ))}
            </Menu>
          )}
        </div>
      )}
      {pdf && barShown && (
        <div className="score-reader__foot">
          <IconButton label="Previous page" disabled={page <= 1} onClick={() => turn(-1)}><BsChevronLeft /></IconButton>
          <span>{shown.length > 1 ? `${shown[0]}–${shown[1]}` : shown[0]} / {pageCount}</span>
          <IconButton label="Next page" disabled={shown[shown.length - 1] >= pageCount} onClick={() => turn(1)}><BsChevronRight /></IconButton>
        </div>
      )}
    </div>
  );
};

export default ScoreReader;
