import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BsBookmarkCheck, BsChevronLeft, BsChevronRight, BsX, BsZoomIn } from 'react-icons/bs';
import bookSectionsService, { ScoreBookmark, ScoreFile, scoreFileUrl } from '../services/bookSectionsService';
import type { ScorePiece } from '../services/scorePiecesService';
import { openPdf, PdfDocument } from '../utils/pdf';
import Button, { IconButton } from './shared/Button';
import Segmented from './shared/Segmented';
import Dialog from './shared/Dialog';
import { Loading } from './shared/Spinner';
import { TextField } from './shared/TextField';
import toast from './shared/Toast';
import './ScoreBookmarks.css';

/** A row to mark: a piece whole, or a part of a set (a prélude of its book). */
export interface MarkRow { key: string; pieceId: number; partWorkId: string | null; name: string; group: string | null }

export const keyOf = (pieceId: number, partWorkId: string | null) => `${pieceId}:${partWorkId ?? ''}`;

/** A score's pieces as the rows to mark, in their order: a set by its parts, a piece of one movement whole. */
export const rowsOf = (pieces: ScorePiece[]): MarkRow[] => pieces.flatMap<MarkRow>(piece => (piece.single || !piece.parts.length
  ? [{ key: keyOf(piece.id, null), pieceId: piece.id, partWorkId: null, name: piece.title, group: null }]
  : piece.parts.map(part => ({ key: keyOf(piece.id, part.workId), pieceId: piece.id, partWorkId: part.workId, name: part.name, group: piece.title }))));

type Marks = Record<string, { start: number | null; end: number | null }>;

/**
 * Each row's last page, when not given: the page before the next piece's
 * first, that very page when the next begins on it (short preludes share
 * one), the PDF's last for the last. The next is by page, then by order.
 */
export const endsOf = (rows: MarkRow[], marks: Marks, pageCount: number): Record<string, number> => {
  const marked = rows.map((row, index) => ({ row, index, start: marks[row.key]?.start ?? null }))
    .filter((entry): entry is { row: MarkRow; index: number; start: number } => entry.start != null)
    .sort((a, b) => a.start - b.start || a.index - b.index);
  const ends: Record<string, number> = {};
  marked.forEach((entry, at) => {
    const next = marked[at + 1];
    ends[entry.row.key] = marks[entry.row.key]?.end ?? (!next ? pageCount : next.start === entry.start ? entry.start : next.start - 1);
  });
  return ends;
};

/** How large the pages are shown to mark them: small to see many, large to read where a piece begins. */
export const SIZES = { s: 112, m: 200, l: 320 } as const;
export type ThumbSize = keyof typeof SIZES;
const SIZE_KEY = 'dv.bookmarks.size';
const storedSize = (): ThumbSize => { try { const kept = localStorage.getItem(SIZE_KEY); return kept === 's' || kept === 'l' ? kept : 'm'; } catch { return 'm'; } };

/** A page drawn into a canvas that fills its frame, which has the page's own proportions. */
const drawInto = async (pdf: PdfDocument, page: number, canvas: HTMLCanvasElement, width: number) => {
  await pdf.draw(page, canvas, width);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
};

/** A page drawn small once it comes into view, framed whole, with a way to see it large. */
const PageThumb: React.FC<{
  pdf: PdfDocument; page: number; width: number; marked: string | null; inSelected: boolean; first: boolean;
  onPick: (page: number, end: boolean) => void; onLarge: (page: number) => void;
}> = ({ pdf, page, width, marked, inSelected, first, onPick, onLarge }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  // Its proportions, A4's until its own are read.
  const [ratio, setRatio] = useState(595 / 842);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let current = true;
    const draw = () => {
      pdf.sizeOf(page).then(size => { if (current) setRatio(size.width / size.height); }).catch(() => undefined);
      drawInto(pdf, page, canvas, width).catch(() => undefined);
    };
    if (typeof IntersectionObserver === 'undefined') { draw(); return () => { current = false; }; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); draw(); } }, { rootMargin: '400px' });
    observer.observe(canvas);
    return () => { current = false; observer.disconnect(); };
  }, [pdf, page, width]);
  return (
    <div className={`score-bookmarks__page${inSelected ? ' score-bookmarks__page--in' : ''}${first ? ' score-bookmarks__page--first' : ''}`} style={{ width: width + 12 }}>
      <button type="button" className="score-bookmarks__sheet" style={{ aspectRatio: String(ratio) }}
        onClick={event => onPick(page, event.shiftKey)} aria-label={`Page ${page}`} title={marked ? `Page ${page}: ${marked}` : `Page ${page}`}>
        <canvas ref={ref} />
      </button>
      <div className="score-bookmarks__caption">
        <span className="score-bookmarks__number">{page}</span>
        {marked && <span className="score-bookmarks__marked">{marked}</span>}
        <IconButton size="sm" label={`See page ${page} large`} onClick={() => onLarge(page)}><BsZoomIn /></IconButton>
      </div>
    </div>
  );
};

/** One page as large as the pane allows, to read it: through the pages with ‹ ›, its piece begun or ended here. */
const LargePage: React.FC<{
  pdf: PdfDocument; page: number; rowName: string | null; onPage: (page: number) => void; onPick: (page: number, end: boolean) => void; onClose: () => void;
}> = ({ pdf, page, rowName, onPage, onPick, onClose }) => {
  const paneRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    (async () => {
      const pane = paneRef.current;
      if (!pane) return;
      const size = await pdf.sizeOf(page);
      const width = Math.floor(Math.min(pane.clientWidth - 8, (pane.clientHeight - 8) * (size.width / size.height)));
      const canvas = document.createElement('canvas');
      await pdf.draw(page, canvas, width);
      if (current) holderRef.current?.replaceChildren(canvas);
    })().catch(() => undefined);
    return () => { current = false; };
  }, [pdf, page]);
  useEffect(() => { paneRef.current?.focus(); }, []);
  return (
    <div className="score-bookmarks__large" tabIndex={-1} aria-label={`Page ${page}, large`}
      onKeyDown={event => {
        // Its own keys: the dialog stays open on Escape, the arrows go through the pages.
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'ArrowRight' && page < pdf.pageCount) onPage(page + 1);
        if (event.key === 'ArrowLeft' && page > 1) onPage(page - 1);
      }}>
      <div className="score-bookmarks__large-bar">
        <IconButton size="sm" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><BsChevronLeft /></IconButton>
        <span>Page {page} of {pdf.pageCount}</span>
        <IconButton size="sm" label="Next page" disabled={page >= pdf.pageCount} onClick={() => onPage(page + 1)}><BsChevronRight /></IconButton>
        {rowName && (
          <>
            <Button size="sm" onClick={() => onPick(page, false)}>{rowName} begins here</Button>
            <Button size="sm" variant="quiet" onClick={() => onPick(page, true)}>Ends here</Button>
          </>
        )}
        <IconButton size="sm" label="Back to the pages" className="score-bookmarks__large-close" onClick={onClose}><BsX /></IconButton>
      </div>
      <div className="score-bookmarks__large-page" ref={paneRef}><div ref={holderRef} /></div>
    </div>
  );
};

/**
 * Where each piece lies in one of a score's PDFs. A row chosen on the left,
 * a page touched on the right is its first, and the next row unmarked comes;
 * with Shift, its last. A last page not given is the one before the next
 * piece's first. A PDF with bookmarks of its own gives them in order.
 */
const ScoreBookmarks: React.FC<{
  scoreId: number;
  file: ScoreFile;
  pieces: ScorePiece[];
  onClose: () => void;
  onSaved: (bookmarks: ScoreBookmark[]) => void;
}> = ({ scoreId, file, pieces, onClose, onSaved }) => {
  const rows = useMemo(() => rowsOf(pieces), [pieces]);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [outline, setOutline] = useState<Array<{ title: string; page: number }>>([]);
  const [selected, setSelected] = useState<string | null>(rows[0]?.key ?? null);
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState<ThumbSize>(storedSize);
  // The page seen large, to read where a piece begins; none while the pages show small.
  const [large, setLarge] = useState<number | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    let opened: PdfDocument | null = null;
    openPdf(scoreFileUrl(scoreId, file.id))
      .then(doc => {
        opened = doc;
        if (!current) { doc.close(); return; }
        setPdf(doc);
        doc.outline().then(found => { if (current) setOutline(found); }).catch(() => undefined);
      })
      .catch(error => { if (current) setFailed((error as Error).message); });
    bookSectionsService.bookmarks(scoreId, file.id)
      .then(list => {
        if (!current) return;
        const kept: Marks = {};
        for (const mark of list) kept[keyOf(mark.pieceId, mark.partWorkId)] = { start: mark.startPage, end: mark.endPage };
        setMarks(kept);
        // The first row not marked yet is the one to mark.
        const first = rows.find(row => kept[row.key]?.start == null);
        if (first) setSelected(first.key);
      })
      .catch(() => { if (current) setMarks({}); });
    return () => { current = false; opened?.close(); };
  }, [scoreId, file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = pdf?.pageCount ?? file.pageCount ?? 0;
  const ends = useMemo(() => endsOf(rows, marks || {}, pageCount), [rows, marks, pageCount]);
  // Each page's name: the rows beginning on it.
  const beginning = useMemo(() => {
    const names = new Map<number, string[]>();
    for (const row of rows) {
      const start = marks?.[row.key]?.start;
      if (start != null) names.set(start, [...(names.get(start) || []), row.name]);
    }
    return names;
  }, [rows, marks]);
  const range = selected && marks?.[selected]?.start != null ? [marks[selected].start!, ends[selected]] : null;

  const set = (key: string, field: 'start' | 'end', value: number | null) =>
    setMarks(prev => ({ ...prev, [key]: { start: prev?.[key]?.start ?? null, end: prev?.[key]?.end ?? null, [field]: value } }));
  const pick = (page: number, end: boolean) => {
    if (!selected) return;
    if (end) {
      const start = marks?.[selected]?.start;
      if (start != null && page < start) { toast(`Page ${page} comes before its first, ${start}`, { tone: 'warning' }); return; }
      set(selected, 'end', page);
      return;
    }
    // Its first page set again: its last follows the next piece again.
    setMarks(prev => ({ ...prev, [selected]: { start: page, end: null } }));
    const at = rows.findIndex(row => row.key === selected);
    const next = rows.slice(at + 1).find(row => marks?.[row.key]?.start == null) || rows[at + 1];
    if (next) setSelected(next.key);
  };
  const number = (text: string) => (text.trim() && Number.isInteger(Number(text)) ? Number(text) : null);
  const takeOutline = () => {
    setMarks(prev => {
      const next = { ...prev };
      rows.forEach((row, index) => { if (outline[index]) next[row.key] = { start: outline[index].page, end: null }; });
      return next;
    });
  };
  const goTo = (page: number) => pagesRef.current?.querySelector(`[aria-label="Page ${page}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  const save = async () => {
    if (!marks) return;
    const bookmarks = rows.filter(row => marks[row.key]?.start != null).map(row => ({
      pieceId: row.pieceId, partWorkId: row.partWorkId, startPage: marks[row.key].start!, endPage: Math.max(marks[row.key].start!, ends[row.key]),
    }));
    const backwards = rows.find(row => marks[row.key]?.start != null && marks[row.key]?.end != null && marks[row.key].end! < marks[row.key].start!);
    if (backwards) { toast(`${backwards.name}: its last page comes before its first`, { tone: 'warning' }); return; }
    const wrong = bookmarks.find(mark => mark.startPage > pageCount || mark.endPage > pageCount);
    if (wrong) { toast(`Page ${wrong.endPage} is past the PDF's ${pageCount}`, { tone: 'warning' }); return; }
    setSaving(true);
    try {
      onSaved(await bookSectionsService.keepBookmarks(scoreId, file.id, bookmarks, pageCount));
      onClose();
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); } finally { setSaving(false); }
  };

  const marked = rows.filter(row => marks?.[row.key]?.start != null).length;
  return (
    <Dialog show onClose={onClose} modal={saving} size="lg" icon={<BsBookmarkCheck />} title={`The pages of its pieces: ${file.label}`} className="score-bookmarks">
      <Dialog.Body>
        {failed ? <p className="score-bookmarks__hint">The PDF could not be read: {failed}</p>
          : !pdf || !marks ? <Loading>Reading the PDF…</Loading>
            : !rows.length ? <p className="score-bookmarks__hint">Its pieces are not known yet: find them first, then mark their pages.</p>
              : (
                <>
                  <div className="score-bookmarks__hint">
                    <span>Choose a piece, then touch the page it begins on; the next comes. Shift and a page, or 🔍 and Ends here: its last.</span>
                    {outline.length > 0 && (
                      <Button size="sm" variant="quiet" onClick={takeOutline}>Take the PDF’s own {outline.length} bookmarks</Button>
                    )}
                    <Segmented<ThumbSize> label="Size of the pages" size="sm" className="score-bookmarks__size" value={size}
                      onChange={value => { setSize(value); try { localStorage.setItem(SIZE_KEY, value); } catch { /* private browsing */ } }}
                      options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} />
                  </div>
                  <div className="score-bookmarks__layout">
                    <ol className="score-bookmarks__rows">
                      {rows.map((row, index) => {
                        const mark = marks[row.key];
                        const groupStarts = row.group && rows[index - 1]?.group !== row.group;
                        return (
                          <React.Fragment key={row.key}>
                            {groupStarts && <li className="score-bookmarks__group">{row.group}</li>}
                            <li className={`score-bookmarks__row${selected === row.key ? ' score-bookmarks__row--selected' : ''}`}
                              onClick={() => { setSelected(row.key); if (mark?.start) goTo(mark.start); }}>
                              <span className="score-bookmarks__name">{row.name}</span>
                              <TextField size="sm" inputMode="numeric" className="score-bookmarks__field" aria-label={`First page of ${row.name}`}
                                value={mark?.start != null ? String(mark.start) : ''} placeholder="p."
                                onChange={e => set(row.key, 'start', number(e.target.value))} />
                              <span className="score-bookmarks__dash">–</span>
                              <TextField size="sm" inputMode="numeric" className="score-bookmarks__field" aria-label={`Last page of ${row.name}`}
                                isInvalid={mark?.start != null && mark?.end != null && mark.end < mark.start}
                                value={mark?.end != null ? String(mark.end) : ''} placeholder={ends[row.key] ? String(ends[row.key]) : ''}
                                onChange={e => set(row.key, 'end', number(e.target.value))} />
                            </li>
                          </React.Fragment>
                        );
                      })}
                    </ol>
                    {large != null ? (
                      <LargePage pdf={pdf} page={large} rowName={rows.find(row => row.key === selected)?.name ?? null}
                        onPage={setLarge} onPick={pick} onClose={() => { const at = large; setLarge(null); setTimeout(() => goTo(at), 0); }} />
                    ) : (
                      <div className="score-bookmarks__pages" ref={pagesRef} style={{ ['--thumb' as string]: `${SIZES[size] + 12}px` }}>
                        {Array.from({ length: pdf.pageCount }, (_, i) => i + 1).map(page => (
                          <PageThumb key={page} pdf={pdf} page={page} width={SIZES[size]} marked={beginning.get(page)?.join(', ') || null}
                            inSelected={Boolean(range && page >= range[0] && page <= range[1])} first={Boolean(range && page === range[0])}
                            onPick={pick} onLarge={setLarge} />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
      </Dialog.Body>
      <Dialog.Footer>
        {rows.length > 0 && <span className="score-bookmarks__count">{marked} of {rows.length} marked</span>}
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!pdf || !marks || !rows.length}>Keep the pages</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default ScoreBookmarks;
