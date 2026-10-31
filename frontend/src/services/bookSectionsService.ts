/**
 * The books as three things (backend bookSectionsService): the scores, by
 * composer; the reading journal; and the notes on a series of the library.
 */

export interface Score {
  id: number;
  title: string;
  authors: string[];
  publisher: string | null;
  cover: string | null;
  composer: string | null;
  /** The composer its title, authors or work suggest, when none is kept yet. */
  composerSuggestion: string | null;
  ebookFile: string | null;
  isbn13: string | null;
  urls: Record<string, string>;
  titleStatus: string;
  /** Its pieces, and how many of them the music plays. */
  pieceCount?: number;
  heardCount?: number;
  /** Its PDFs; ebookFile is the one that opens first. */
  fileCount?: number;
  [key: string]: unknown;
}

/** One of a score's PDFs: IMSLP's scan, one's own copy… */
export interface ScoreFile {
  id: number;
  bookId: number;
  filename: string;
  label: string;
  source: 'upload' | 'imslp' | 'scan';
  /** The one that opens first. */
  isDefault: boolean;
  size: number | null;
  /** Its pages, once read by the browser. */
  pageCount: number | null;
  createdAt: string;
}

/** Where a piece lies in one of its PDFs: a part of a set by its work, null for the piece whole. */
export interface ScoreBookmark { pieceId: number; partWorkId: string | null; startPage: number; endPage: number }


/** An edition IMSLP holds of a work (backend imslpEditionsService). */
export interface ImslpEdition {
  section: string;
  name: string;
  editor: string | null;
  publisher: string | null;
  reprinted: string | null;
  copyright: string | null;
  notes: string | null;
  plate: string | null;
  thumbnail: string | null;
  files: Array<{ index: string; title: string; pages: number | null; size: string | null; downloads: number | null; download: string }>;
}

export interface ReadingEntry {
  id: number;
  title: string;
  authors: string[];
  cover: string | null;
  publishedYear: number | null;
  readDate: string | null;
  rating: number | null;
  titleStatus: 'owned' | 'borrowed';
  owner: string | null;
  /** This reading; none for a book borrowed or commented on and not read yet. */
  readingId: number | null;
  /** 1 for the first reading, 2 when read again… */
  readNumber: number;
  readCount: number;
  /** Every reading of the book, the first first. */
  /** Each reading's date, the first first; null for one of no date. */
  readDates: Array<string | null>;
  comments: Array<{ id: number; name: string; comment: string; date: string }>;
  [key: string]: unknown;
}

/** A reading; readDate null when one does not know when. */
export interface BookReading { id: number; bookId: number; readDate: string | null }

export interface SeriesNote { id: number; series: string; name: string | null; note: string; createdAt: string }

const json = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `HTTP error! status: ${response.status}`);
  return data as T;
};
const send = <T>(method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(response => json<T>(response));

const bookSectionsService = {
  scores: () => fetch('/api/scores').then(response => json<Score[]>(response)),
  setComposers: (updates: Array<{ id: number; composer: string | null }>) => send<{ changed: number }>('PUT', '/api/scores/composers', { updates }),
  files: (scoreId: number) => fetch(`/api/scores/${scoreId}/files`).then(response => json<ScoreFile[]>(response)),
  addFile: (scoreId: number, file: File, as: { label?: string; source?: ScoreFile['source'] } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (as.label) form.append('label', as.label);
    if (as.source) form.append('source', as.source);
    return fetch(`/api/scores/${scoreId}/files`, { method: 'POST', body: form }).then(response => json<ScoreFile[]>(response));
  },
  imslpEditions: (scoreId: number) => fetch(`/api/scores/${scoreId}/imslp/editions`).then(response => json<{ page: string | null; editions: ImslpEdition[] }>(response)),
  bookmarks: (scoreId: number, fileId: number) => fetch(`/api/scores/${scoreId}/files/${fileId}/bookmarks`).then(response => json<ScoreBookmark[]>(response)),
  keepBookmarks: (scoreId: number, fileId: number, bookmarks: ScoreBookmark[], pageCount: number) =>
    send<ScoreBookmark[]>('PUT', `/api/scores/${scoreId}/files/${fileId}/bookmarks`, { bookmarks, pageCount }),
  changeFile: (scoreId: number, fileId: number, changes: { label?: string; isDefault?: true }) => send<ScoreFile[]>('PUT', `/api/scores/${scoreId}/files/${fileId}`, changes),
  removeFile: (scoreId: number, fileId: number) => fetch(`/api/scores/${scoreId}/files/${fileId}`, { method: 'DELETE' }).then(response => json<ScoreFile[]>(response)),
  reading: () => fetch('/api/books/reading').then(response => json<ReadingEntry[]>(response)),
  readingsOf: (bookId: number) => fetch(`/api/books/${bookId}/readings`).then(response => json<BookReading[]>(response)),
  addReading: (bookId: number, date: string) => send<BookReading>('POST', `/api/books/${bookId}/readings`, { date }),
  changeReading: (id: number, date: string) => send<BookReading>('PUT', `/api/books/readings/${id}`, { date }),
  removeReading: async (id: number) => {
    const response = await fetch(`/api/books/readings/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  },
  seriesNotes: (series?: string) => fetch(`/api/books/series-notes${series ? `?series=${encodeURIComponent(series)}` : ''}`).then(response => json<SeriesNote[]>(response)),
  addSeriesNote: (series: string, note: string, name?: string) => send<SeriesNote>('POST', '/api/books/series-notes', { series, note, name }),
  deleteSeriesNote: async (id: number) => {
    const response = await fetch(`/api/books/series-notes/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  },
};

/** A score's PDF, opened in the browser. */
export const scorePdfUrl = (id: number) => `/api/books/${id}/ebook/download?inline=1`;

/** One of its PDFs, opened in the browser. */
export const scoreFileUrl = (scoreId: number, fileId: number, page?: number) => `/api/scores/${scoreId}/files/${fileId}/pdf${page ? `#page=${page}` : ''}`;

/** Pieces' pages cut from a PDF and set on A4, to print: "12:" a piece whole, "12:w1" a part of its set, "12:*" all its parts. */
export const scorePrintUrl = (scoreId: number, pieces: string[], options: { file?: number; name?: string } = {}) => {
  const query = new URLSearchParams({ pieces: pieces.join(',') });
  if (options.file) query.set('file', String(options.file));
  if (options.name) query.set('name', options.name);
  return `/api/scores/${scoreId}/print?${query}`;
};

/** IMSLP: the page DexVault knows, else its search for the composer and the piece. */
export const imslpUrl = (score: Pick<Score, 'title' | 'composer' | 'urls'>) =>
  score.urls?.imslp || `https://imslp.org/index.php?search=${encodeURIComponent([score.composer, score.title.replace(/\((?:HN|BA|EB|UT)\s*[\d.]+\)/i, '')].filter(Boolean).join(' '))}`;

export default bookSectionsService;
