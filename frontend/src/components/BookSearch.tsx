import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import bookService from '../services/bookService';
import BookForm from './BookForm';
import BookThumbnail from './BookThumbnail';
import BookDetailCard from './BookDetailCard';
import BookSheet from './BookSheet';
import AddBookDialog from './AddBookDialog';
import SeriesStack from './SeriesStack';
import AlphabeticalIndex from './AlphabeticalIndex';
import { CollectionHeader, EmptyState } from './shared';
import { hasMatchScores, stacksMatchFirst, useBestMatch } from './shared/search/bestMatch';
import { useOpenItem } from '../services/openItem';
import { Modal, Form } from 'react-bootstrap';
import { BsChevronDown, BsBook, BsX, BsPerson } from 'react-icons/bs';
import './BookSearch.css';
import { readStored, writeStored } from '../utils/safeStorage';
import { findById, shownIds, useDetailSteps } from '../utils/detailSteps';
import { bookImages } from '../utils/detailImages';
import { chosenOwners, clickOwner as clickOwnerIn, isOwnerIn, withOwners } from '../utils/bookOwners';
import useNarrow, { useMedia } from '../utils/useNarrow';
import Button from './shared/Button';
import Chip from './shared/Chip';
import Menu, { MenuChevron } from './shared/Menu';
import Dialog from './shared/Dialog';
import { ConfirmDialog } from './shared/ConfirmDialog';
import { TextField } from './shared/TextField';
import Spinner, { Loading } from './shared/Spinner';
import { useKeptState } from '../utils/kept';
import Progressive from './shared/Progressive';

interface BookSearchProps {
  books: any;
  loading: boolean;
  onAddBook: (bookData: any) => Promise<any>;
  onUpdateBook: (id: number | string, bookData: any) => Promise<any>;
  onDeleteBook: (id: number | string) => Promise<any>;
  onShowAlert?: (message: string, variant: string) => void;
  onOpenAddDialog?: () => void;
  refreshTrigger?: number;
  searchCriteria?: { searchText?: string; [key: string]: any } | null;
  defaultTitleStatus?: string;
  /** Library or Reading, first in the header's controls. */
  viewSwitch?: React.ReactNode;
}

interface Book {
  /** How well a search's plain words name it (shared/search/bestMatch.ts). */
  matchScore?: number;
  id: number;
  title: string;
  authors: string | string[];
  author?: string;
  cover?: string;
  publishedYear?: number;
  createdAt?: string;
  genres?: string[];
  series?: string;
  seriesNumber?: number | string;
  format?: string;
  language?: string;
  [key: string]: any;
}

interface BatchResult {
  success?: any[];
  errors?: Array<{ book: string; error: string }>;
  [key: string]: any;
}

interface DeleteModalState {
  show: boolean;
  bookId: number | null;
}

interface CreateSeriesData {
  draggedBook: Book | null;
  targetBook: Book | null;
  suggestedName: string;
}

interface MergeSeriesData {
  sourceSeries: string;
  sourceBooks: Book[];
  targetSeries: string;
  targetBooks: Book[];
  selectedName: string;
}

interface CombinedItem {
  type: 'series' | 'book';
  seriesName?: string;
  books?: Book[];
  sortedBooks?: Book[];
  representativeBook?: Book;
  book?: Book;
}

/**
 * The books of the shelves at home: the scores have a section of their own
 * (/scores), and a book borrowed lives in the reading journal alone.
 */
const onShelf = (books: Book[]): Book[] => books.filter(book => book.bookType !== 'score' && book.titleStatus !== 'borrowed');

const BookSearch = forwardRef<any, BookSearchProps>(({
  books,
  loading,
  onAddBook,
  onUpdateBook,
  onDeleteBook,
  onShowAlert,
  onOpenAddDialog,
  refreshTrigger,
  searchCriteria,
  defaultTitleStatus,
  viewSwitch
}, ref) => {
  // Kept for the session, as the page's books: the grid drawn at once on coming back.
  const [allBooks, setAllBooks] = useKeptState<Book[]>('bookdex:allBooks', []);
  const [filteredBooks, setFilteredBooks] = useKeptState<Book[]>('bookdex:filteredBooks', []);
  // Load sort preference from localStorage, default to 'series'
  const [sortBy, setSortBy] = useState(() => {
    const savedSort = readStored('dexvault-bookdex-sort');
    return savedSort || 'series';
  });
  const [sortLoading, setSortLoading] = useState(false);
  const [groupBy, setGroupBy] = useState('none');
  const [groupLoading, setGroupLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set<string>());
  const [expandAllGroups, setExpandAllGroups] = useState(false);
  const [bookCount, setBookCount] = useKeptState('bookdex:bookCount', { filtered: 0, total: 0 });
  const [expandedSeries, setExpandedSeries] = useState<string | null>(() => {
    // Restore expanded series from sessionStorage on mount
    const saved = sessionStorage.getItem('bookSearchExpandedSeries');
    return saved || null;
  });
  const expandedSeriesRef = useRef<string | null>(null);
  // Load stack preference from localStorage
  const [stackEnabled, setStackEnabled] = useState(() => {
    const saved = readStored('dexvault-bookdex-stack');
    return saved !== null ? saved === 'true' : true;
  });

  // Initialize and keep ref in sync with state
  useEffect(() => {
    if (expandedSeriesRef.current === null) {
      // Initialize ref on first render
      expandedSeriesRef.current = expandedSeries;
    } else {
      // Keep ref in sync with state
      expandedSeriesRef.current = expandedSeries;
    }
  }, [expandedSeries]);

  // Persist stack preference to localStorage
  useEffect(() => {
    writeStored('dexvault-bookdex-stack', stackEnabled.toString());
  }, [stackEnabled]);


  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [editingBook, setEditingBook] = useState<any>(null);
  const [selectedBookDetails, setSelectedBookDetails] = useState<any>(null);
  // On a phone a book opens full screen at once (BookSheet), its details filling in as they are read;
  // the card shows over it for its edit or its next volumes alone.
  const phone = useMedia('(max-width: 767px)');
  const [openedBookId, setOpenedBookId] = useState<number | null>(null);
  const [bookView, setBookView] = useState<'edit' | 'volumes' | null>(null);
  const [bookDetailsBeforeEdit, setBookDetailsBeforeEdit] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<DeleteModalState>({ show: false, bookId: null });
  const [templateBook, setTemplateBook] = useState<Book | null>(null);
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);
  const [createSeriesData, setCreateSeriesData] = useState<CreateSeriesData>({ draggedBook: null, targetBook: null, suggestedName: '' });
  const [seriesNameInput, setSeriesNameInput] = useState('');
  const [showMergeSeriesModal, setShowMergeSeriesModal] = useState(false);
  const [mergeSeriesData, setMergeSeriesData] = useState<MergeSeriesData>({
    sourceSeries: '', sourceBooks: [],
    targetSeries: '', targetBooks: [],
    selectedName: ''
  });
  const previousSearchTextRef = useRef('');
  const navigate = useNavigate();
  const location = useLocation();

  // Ref and state for scroll container (for alphabetical index)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The page scrolls as a whole: the alphabetical index follows the document, known from the first render
  // (found in an effect, it drew the whole grid a second time as the section opened).
  const scrollContainer: HTMLElement = document.documentElement;


  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    refresh: loadBooks,
    search: performSearch,
    openAddDialog: () => setShowAddDialog(true),
    openBookDetails: (book: any) => setSelectedBookDetails(book),
    setSearchQuery: (query: string) => {
      navigate(`${location.pathname}?search=${encodeURIComponent(query)}`);
    }
  }));

  const updateSearchViaUrl = (query: string) => {
    navigate(`${location.pathname}?search=${encodeURIComponent(query)}`);
  };

  useEffect(() => {
    loadBooks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  useEffect(() => {
    const currentSearchText = searchCriteria?.searchText || '';

    if (currentSearchText !== previousSearchTextRef.current) {
      const previous = previousSearchTextRef.current;
      previousSearchTextRef.current = currentSearchText;

      // A search 200 ms after the last key, as FilmDex's: not one request per letter.
      if (currentSearchText.trim()) {
        let fired = false;
        const timer = setTimeout(() => { fired = true; performSearch(currentSearchText); }, 200);
        // Called off before it ran (another key, StrictMode's second mount), it is still to run.
        return () => {
          clearTimeout(timer);
          if (!fired) previousSearchTextRef.current = previous;
        };
      } else {
        const sortedAll = sortBooks(allBooks, sortBy);
        setFilteredBooks(sortedAll);
        setBookCount({ filtered: sortedAll.length, total: allBooks.length });
      }
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria?.searchText, allBooks]);

  const loadBooks = async () => {
    try {
      // getAllBooks() now returns both 'owned' and 'borrowed' books (excludes 'wish');
      // the scores have a section of their own.
      const data = onShelf(await bookService.getAllBooks() as Book[]);
      const sortedInitial = sortBooks(data, sortBy);
      setAllBooks(data); // Keep all books for total count

      const currentSearchText = searchCriteria?.searchText || '';
      if (currentSearchText.trim()) {
        const localResults = onShelf(await bookService.searchBooks(currentSearchText) as Book[]);
        const sortedResults = sortBooks(localResults, sortBy);
        setFilteredBooks(sortedResults);
        setBookCount({ filtered: sortedResults.length, total: data.length });
      } else {
        setFilteredBooks(sortedInitial);
        setBookCount({ filtered: sortedInitial.length, total: data.length });
      }
    } catch (error) {
      console.error('Error loading books:', error);
      if (onShowAlert) {
        onShowAlert('Failed to load books: ' + (error as Error).message, 'danger');
      }
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      const sortedAll = sortBooks(allBooks, sortBy);
      setFilteredBooks(sortedAll);
      setBookCount({ filtered: sortedAll.length, total: allBooks.length });
      return;
    }

    try {
      const localResults = onShelf(await bookService.searchBooks(query) as Book[]);
      // An answer to letters since changed comes too late: the newer search shows.
      if (query !== previousSearchTextRef.current) return;
      const sortedResults = sortBooks(localResults, sortBy);
      setFilteredBooks(sortedResults);
      setBookCount({ filtered: sortedResults.length, total: allBooks.length });
    } catch (error) {
      console.error('Error searching:', error);
      if (onShowAlert) {
        onShowAlert('Search failed: ' + (error as Error).message, 'danger');
      }
    }
  };

  // Whose books: one of the family's, at a click, written into the search as owner:Alice,
  // so the buttons and the owner pill say the same thing whichever one changes. An Alt-click
  // adds a name or takes it away: owner:Alice,Oriane is either's (utils/bookOwners).
  const narrow = useNarrow();
  const ownerFilter = chosenOwners(searchCriteria?.searchText || '');
  const isOwnerChosen = (owner: string) => isOwnerIn(ownerFilter, owner);
  const clickOwner = (owner: string, toggle: boolean) =>
    updateSearchViaUrl(clickOwnerIn(searchCriteria?.searchText || '', owner, toggle));
  // The books of no one come last, as owner:none, when there are any.
  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    let noOne = 0;
    for (const book of allBooks) {
      if (book.owner?.trim()) counts.set(book.owner, (counts.get(book.owner) || 0) + 1);
      else noOne++;
    }
    const pills: Array<[string, number, string]> = [...counts].sort((a, b) => b[1] - a[1]).map(([owner, count]) => [owner, count, owner]);
    return noOne ? [...pills, ['none', noOne, 'No owner'] as [string, number, string]] : pills;
  }, [allBooks]);
  const displayBooks = filteredBooks;

  // Helper function to remove articles (determinants) for sorting
  const removeArticlesForSorting = useCallback((text: string) => {
    if (!text) return '';
    // Ensure text is a string
    const textStr = typeof text === 'string' ? text : String(text || '');
    const trimmed = textStr.trim();
    // French articles: Le, La, Les, Un, Une, Des, Du, De
    // English articles: The, A, An
    const articlePattern = /^(le|la|les|un|une|des|du|de|the|a|an)\s+/i;
    return trimmed.replace(articlePattern, '').trim() || trimmed;
  }, []);

  // While letters are typed the best match comes first, this sort between equals (useBestMatch).
  const bestMatch = useBestMatch(searchCriteria?.searchText || '');

  const sortBooksBy = useCallback((booksToSort: Book[], sortOption: string) => {
    const sorted = [...booksToSort];

    switch (sortOption) {
      case 'authorSeries':
        // Sort by author A-Z, then by series name, then by series number
        // Books without series are sorted by author
        return sorted.sort((a, b) => {
          // First, compare authors
          const authorA = Array.isArray(a.authors) ? a.authors.join(', ') : (a.authors || '');
          const authorB = Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || '');
          const authorCompare = authorA.localeCompare(authorB);
          if (authorCompare !== 0) return authorCompare;

          // Same author: compare series
          const seriesA = a.series || '';
          const seriesB = b.series || '';

          // If both have series and same series name, sort by series number
          if (seriesA && seriesB && seriesA === seriesB) {
            // Convert to number for proper numeric sorting
            const numA = a.seriesNumber != null ? Number(a.seriesNumber) : 999999;
            const numB = b.seriesNumber != null ? Number(b.seriesNumber) : 999999;
            // Handle NaN cases
            if (isNaN(numA) && isNaN(numB)) return a.title.localeCompare(b.title);
            if (isNaN(numA)) return 1;
            if (isNaN(numB)) return -1;
            return numA - numB;
          }

          // If one has series and other doesn't, series comes first
          if (seriesA && !seriesB) return -1;
          if (!seriesA && seriesB) return 1;

          // Both have series but different: sort by series name (without articles)
          if (seriesA && seriesB) {
            const seriesAForSort = removeArticlesForSorting(seriesA);
            const seriesBForSort = removeArticlesForSorting(seriesB);
            return seriesAForSort.localeCompare(seriesBForSort);
          }

          // Neither has series: sort by title
          return a.title.localeCompare(b.title);
        });
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'titleReverse':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'author':
        return sorted.sort((a, b) => {
          const authorA = Array.isArray(a.authors) ? a.authors.join(', ') : (a.authors || '');
          const authorB = Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || '');
          return authorA.localeCompare(authorB);
        });
      case 'authorReverse':
        return sorted.sort((a, b) => {
          const authorA = Array.isArray(a.authors) ? a.authors.join(', ') : (a.authors || '');
          const authorB = Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || '');
          return authorB.localeCompare(authorA);
        });
      case 'year':
        return sorted.sort((a, b) => (b.publishedYear || 0) - (a.publishedYear || 0));
      case 'yearReverse':
        return sorted.sort((a, b) => (a.publishedYear || 0) - (b.publishedYear || 0));
      case 'lastAdded':
        return sorted.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
      case 'lastAddedReverse':
        return sorted.sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
      case 'series':
        // Sort by series name, treating books without series as their own series
        // Within each series, sort by series number, then by title
        return sorted.sort((a, b) => {
          // Use series name if available, otherwise use title as the "series" identifier
          const seriesA = a.series || a.title;
          const seriesB = b.series || b.title;

          // Remove articles for sorting comparison
          const seriesAForSort = removeArticlesForSorting(seriesA);
          const seriesBForSort = removeArticlesForSorting(seriesB);

          // Compare series names (or titles for non-series books) without articles
          const seriesCompare = seriesAForSort.localeCompare(seriesBForSort);
          if (seriesCompare !== 0) return seriesCompare;

          // Same series: if both have series numbers, sort by that
          if (a.series && b.series) {
            // Convert to number for proper numeric sorting
            const numA = a.seriesNumber != null ? Number(a.seriesNumber) : 999999;
            const numB = b.seriesNumber != null ? Number(b.seriesNumber) : 999999;
            // Handle NaN cases
            if (isNaN(numA) && isNaN(numB)) return a.title.localeCompare(b.title);
            if (isNaN(numA)) return 1;
            if (isNaN(numB)) return -1;
            if (numA !== numB) return numA - numB;
          }

          // Same series and same number (or no series), sort by title
          return a.title.localeCompare(b.title);
        });
      default:
        return sorted;
    }
  }, [removeArticlesForSorting]);
  const sortBooks = useCallback((items: Book[], sortOption: string) =>
    bestMatch.order(sortBooksBy(items, sortOption)), [sortBooksBy, bestMatch.order]);

  const handleSortChange = async (sortOption: string) => {
    // A sort chosen while letters are typed holds until they go.
    if (hasMatchScores(filteredBooks)) bestMatch.choose(false);
    setSortBy(sortOption);
    writeStored('dexvault-bookdex-sort', sortOption);
    setSortLoading(true);

    await new Promise(resolve => setTimeout(resolve, 150));

    try {
      const sortedBooks = sortBooks(filteredBooks, sortOption);
      setFilteredBooks(sortedBooks);
      setBookCount({ filtered: sortedBooks.length, total: allBooks.length });
    } finally {
      setSortLoading(false);
    }
  };

  const handleBestMatch = () => {
    bestMatch.choose(true);
    setFilteredBooks(sortBooks(filteredBooks, sortBy));
  };

  const groupBooks = useCallback((booksToGroup: Book[], groupOption: string) => {
    if (groupOption === 'none') {
      return { 'All Books': booksToGroup };
    }

    const groups: Record<string, Book[]> = {};

    booksToGroup.forEach((book: Book) => {
      let groupKeys: string[] = [];

      switch (groupOption) {
        case 'author':
          const authors = Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : []);
          groupKeys = authors.length > 0 ? authors : ['Unknown Author'];
          break;
        case 'genre':
          if (book.genres && book.genres.length > 0) {
            groupKeys = book.genres;
          } else {
            groupKeys = ['Unknown Genre'];
          }
          break;
        case 'series':
          groupKeys = [book.series || 'No Series'];
          break;
        case 'format':
          groupKeys = [book.format || 'Unknown Format'];
          break;
        case 'decade':
          if (book.publishedYear && !isNaN(book.publishedYear)) {
            const decade = Math.floor(book.publishedYear / 10) * 10;
            groupKeys = [`${decade}s`];
          } else {
            groupKeys = ['Unknown Decade'];
          }
          break;
        case 'language':
          groupKeys = [book.language || 'Unknown Language'];
          break;
        default:
          groupKeys = ['All Books'];
      }

      groupKeys.forEach((groupKey: string) => {
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(book);
      });
    });

    const sortedGroups: Record<string, Book[]> = {};
    Object.keys(groups).sort().forEach(key => {
      sortedGroups[key] = groups[key];
    });

    return sortedGroups;
  }, []);

  const handleGroupChange = async (groupOption: string) => {
    setGroupBy(groupOption);
    setGroupLoading(true);

    await new Promise(resolve => setTimeout(resolve, 150));

    if (groupOption !== 'none') {
      const grouped = groupBooks(filteredBooks, groupOption);
      const allGroupKeys = Object.keys(grouped);
      setExpandedGroups(new Set(allGroupKeys));
      setExpandAllGroups(true);
    } else {
      setExpandedGroups(new Set());
      setExpandAllGroups(false);
    }

    setGroupLoading(false);
  };

  const toggleGroup = (groupKey: string) => {
    const newExpandedGroups = new Set(expandedGroups);
    if (newExpandedGroups.has(groupKey)) {
      newExpandedGroups.delete(groupKey);
    } else {
      newExpandedGroups.add(groupKey);
    }
    setExpandedGroups(newExpandedGroups);
  };

  const toggleAllGroups = () => {
    if (groupBy === 'none') return;

    const grouped = groupBooks(filteredBooks, groupBy);
    const allGroupKeys = Object.keys(grouped);

    if (expandAllGroups) {
      setExpandedGroups(new Set());
      setExpandAllGroups(false);
    } else {
      setExpandedGroups(new Set(allGroupKeys));
      setExpandAllGroups(true);
    }
  };

  const handleEditBook = async (book: Book) => {
    try {
      const details = await bookService.getBookById(book.id);
      setBookDetailsBeforeEdit(selectedBookDetails);
      setEditingBook(details);
      setSelectedBookDetails(null);
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to load book details for editing: ' + (err as Error).message, 'danger');
      }
      setBookDetailsBeforeEdit(selectedBookDetails);
      setEditingBook(book);
      setSelectedBookDetails(null);
    }
  };

  const handleFormCancel = () => {
    setEditingBook(null);
    if (bookDetailsBeforeEdit) {
      setSelectedBookDetails(bookDetailsBeforeEdit);
      setBookDetailsBeforeEdit(null);
    }
  };

  const handleFormSave = async (createdBook: any = null) => {
    setEditingBook(null);

    if (createdBook) {
      await loadBooks();
      try {
        const completeBookDetails = await bookService.getBookById(createdBook.id);
        setSelectedBookDetails(completeBookDetails);
      } catch (err) {
        console.error('Failed to load complete book details after creation:', err);
        setSelectedBookDetails(createdBook);
      }
    } else {
      await loadBooks();
      if (bookDetailsBeforeEdit) {
        try {
          const updatedDetails = await bookService.getBookById(bookDetailsBeforeEdit.id);
          setSelectedBookDetails(updatedDetails);
          setBookDetailsBeforeEdit(null);
        } catch (err) {
          console.error('Failed to reload book details after save:', err);
          setSelectedBookDetails(bookDetailsBeforeEdit);
          setBookDetailsBeforeEdit(null);
        }
      }
    }
  };

  // Extract series number from book title using common patterns
  const extractSeriesNumberFromTitle = (title: string) => {
    if (!title) return null;

    // Common volume/series number patterns
    const volumePatterns = [
      /\bT0*(\d+)\b/i,           // T01, T1, T02, etc.
      /\bVol\.?\s*0*(\d+)\b/i,   // Vol. 1, Vol 1, etc.
      /\bVolume\s*0*(\d+)\b/i,   // Volume 1, etc.
      /\b#0*(\d+)\b/i,           // #1, #01, etc.
      /\bBook\s*0*(\d+)\b/i,     // Book 1, Book 01, etc.
      /\bPart\s*0*(\d+)\b/i,     // Part 1, Part 01, etc.
      /\bTome\s*0*(\d+)\b/i,     // Tome 1, Tome 01, etc.
      /\b(\d+)\s*$/i             // Trailing number like "Series Name 1"
    ];

    for (const pattern of volumePatterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        const number = parseInt(match[1], 10);
        if (!isNaN(number) && number > 0) {
          return number;
        }
      }
    }

    return null;
  };

  // Handle book dropped onto a series stack
  const handleBookDroppedOnSeries = async (bookId: any, bookData: any, seriesName: string, seriesBooks: any[]) => {
    try {
      // Try to infer series number from the book's title
      let seriesNumber: number | null = extractSeriesNumberFromTitle(bookData.title);

      // If no series number could be inferred from title, use next number in series
      if (seriesNumber === null) {
        // Find the highest series number in the current series
        const maxSeriesNumber = seriesBooks.reduce((max: number, book: any) => {
          const num = book.seriesNumber != null ? Number(book.seriesNumber) : 0;
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        seriesNumber = maxSeriesNumber + 1;
      }

      // Update the book with the new series and series number
      const updatedBook = await onUpdateBook(bookId, {
        ...bookData,
        series: seriesName,
        seriesNumber: seriesNumber
      });

      // Save expanded series state
      const currentExpanded = expandedSeries;

      // Reload books
      await loadBooks();

      // Restore expanded series state
      if (currentExpanded) {
        setExpandedSeries(currentExpanded);
        sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
      }

      if (onShowAlert) {
        onShowAlert(`Added "${bookData.title}" to ${seriesName} as #${seriesNumber}`, 'success');
      }

      return updatedBook;
    } catch (error) {
      console.error('Error adding book to series:', error);
      if (onShowAlert) {
        onShowAlert(`Failed to add book to series: ${(error as Error).message}`, 'danger');
      }
    }
  };

  // Infer a series name from two books
  const inferSeriesName = (book1: Book, book2: Book) => {
    const title1 = book1.title || '';
    const title2 = book2.title || '';

    // Remove common volume/number patterns from titles for comparison
    const cleanTitle = (title: string) => {
      return title
        .replace(/\s*[-–—:]\s*(T|Vol\.?|Volume|Book|Part|Tome|#)\s*\d+\s*$/i, '')
        .replace(/\s*(T|Vol\.?|Volume|Book|Part|Tome|#)\s*\d+\s*$/i, '')
        .replace(/\s*\d+\s*$/, '')
        .trim();
    };

    const clean1 = cleanTitle(title1);
    const clean2 = cleanTitle(title2);

    // If cleaned titles are the same, use that as series name
    if (clean1 && clean1.toLowerCase() === clean2.toLowerCase()) {
      return clean1;
    }

    // Try to find common prefix
    const words1 = clean1.split(/\s+/);
    const words2 = clean2.split(/\s+/);
    const commonWords: string[] = [];

    for (let i = 0; i < Math.min(words1.length, words2.length); i++) {
      if (words1[i].toLowerCase() === words2[i].toLowerCase()) {
        commonWords.push(words1[i]);
      } else {
        break;
      }
    }

    if (commonWords.length >= 2) {
      return commonWords.join(' ');
    }

    // If same author, suggest author name + "Series"
    const author1 = Array.isArray(book1.authors) ? book1.authors[0] : book1.authors;
    const author2 = Array.isArray(book2.authors) ? book2.authors[0] : book2.authors;

    if (author1 && author2 && author1.toLowerCase() === author2.toLowerCase()) {
      return `${author1} Series`;
    }

    // Fallback to the first cleaned title
    return clean1 || clean2 || 'New Series';
  };

  // Handle book dropped on another book to create a new series
  const handleBookDroppedForNewSeries = (draggedBookId: number | string, draggedBookData: any, targetBook: any) => {
    // Infer a suggested series name
    const suggestedName = inferSeriesName(draggedBookData, targetBook);

    // Set up the modal data
    setCreateSeriesData({
      draggedBook: draggedBookData,
      targetBook: targetBook,
      suggestedName: suggestedName
    });
    setSeriesNameInput(suggestedName);
    setShowCreateSeriesModal(true);
  };

  // Confirm series creation
  const handleConfirmCreateSeries = async () => {
    const { draggedBook, targetBook } = createSeriesData;
    const seriesName = seriesNameInput.trim();

    if (!seriesName) {
      if (onShowAlert) {
        onShowAlert('Please enter a series name', 'warning');
      }
      return;
    }

    try {
      // Extract series numbers from titles
      const draggedNumber = draggedBook ? extractSeriesNumberFromTitle(draggedBook.title) : null;
      const targetNumber = targetBook ? extractSeriesNumberFromTitle(targetBook.title) : null;

      // Determine series numbers
      let draggedSeriesNumber: number, targetSeriesNumber: number;

      if (draggedNumber !== null && targetNumber !== null) {
        // Both have numbers, use them
        draggedSeriesNumber = draggedNumber;
        targetSeriesNumber = targetNumber;
      } else if (draggedNumber !== null) {
        // Only dragged book has number
        draggedSeriesNumber = draggedNumber;
        targetSeriesNumber = draggedNumber === 1 ? 2 : 1;
      } else if (targetNumber !== null) {
        // Only target book has number
        targetSeriesNumber = targetNumber;
        draggedSeriesNumber = targetNumber === 1 ? 2 : 1;
      } else {
        // Neither has a number, assign 1 and 2
        targetSeriesNumber = 1;
        draggedSeriesNumber = 2;
      }

      // Update both books
      await onUpdateBook(targetBook!.id, {
        ...targetBook!,
        series: seriesName,
        seriesNumber: targetSeriesNumber
      });

      await onUpdateBook(draggedBook!.id, {
        ...draggedBook!,
        series: seriesName,
        seriesNumber: draggedSeriesNumber
      });

      // Close modal and reload
      setShowCreateSeriesModal(false);
      setCreateSeriesData({ draggedBook: null, targetBook: null, suggestedName: '' });
      setSeriesNameInput('');

      await loadBooks();

      if (onShowAlert) {
        onShowAlert(`Created series "${seriesName}" with 2 books`, 'success');
      }
    } catch (error) {
      console.error('Error creating series:', error);
      if (onShowAlert) {
        onShowAlert(`Failed to create series: ${(error as Error).message}`, 'danger');
      }
    }
  };

  // Cancel series creation
  const handleCancelCreateSeries = () => {
    setShowCreateSeriesModal(false);
    setCreateSeriesData({ draggedBook: null, targetBook: null, suggestedName: '' });
    setSeriesNameInput('');
  };

  // Handle series dropped on another series - prompt for merge
  const handleSeriesMerge = (sourceSeriesName: string, sourceBooks: any[], targetSeriesName: string, targetBooks: any[]) => {
    setMergeSeriesData({
      sourceSeries: sourceSeriesName,
      sourceBooks: sourceBooks,
      targetSeries: targetSeriesName,
      targetBooks: targetBooks,
      selectedName: targetSeriesName // Default to the target series name
    });
    setShowMergeSeriesModal(true);
  };

  // Confirm series merge
  const handleConfirmMergeSeries = async () => {
    const { sourceSeries, sourceBooks, targetSeries, targetBooks, selectedName } = mergeSeriesData;

    try {
      // Determine which books need to be updated
      const booksToUpdate = selectedName === sourceSeries ? targetBooks : sourceBooks;

      // Get the highest series number from the series we're keeping
      const keptBooks = selectedName === sourceSeries ? sourceBooks : targetBooks;
      const maxSeriesNumber = keptBooks.reduce((max: number, book: Book) => {
        const num = book.seriesNumber != null ? Number(book.seriesNumber) : 0;
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);

      // Update each book to use the selected series name
      // Assign new series numbers to avoid conflicts
      for (let i = 0; i < booksToUpdate.length; i++) {
        const book = booksToUpdate[i];
        // Try to keep original series number if it doesn't conflict
        let newSeriesNumber: number | string | null | undefined = book.seriesNumber;

        // Check if this number conflicts with kept books
        const conflicts = keptBooks.some((b: Book) => b.seriesNumber === newSeriesNumber);
        if (conflicts || newSeriesNumber == null) {
          // Assign next available number
          newSeriesNumber = maxSeriesNumber + i + 1;
        }

        await onUpdateBook(book.id, {
          ...book,
          series: selectedName,
          seriesNumber: newSeriesNumber
        });
      }

      // Close modal and reload
      setShowMergeSeriesModal(false);
      setMergeSeriesData({
        sourceSeries: '', sourceBooks: [],
        targetSeries: '', targetBooks: [],
        selectedName: ''
      });

      await loadBooks();

      if (onShowAlert) {
        const totalBooks = sourceBooks.length + targetBooks.length;
        onShowAlert(`Merged series into "${selectedName}" (${totalBooks} books)`, 'success');
      }
    } catch (error) {
      console.error('Error merging series:', error);
      if (onShowAlert) {
        onShowAlert(`Failed to merge series: ${(error as Error).message}`, 'danger');
      }
    }
  };

  // Cancel series merge
  const handleCancelMergeSeries = () => {
    setShowMergeSeriesModal(false);
    setMergeSeriesData({
      sourceSeries: '', sourceBooks: [],
      targetSeries: '', targetBooks: [],
      selectedName: ''
    });
  };

  // Rename a series
  const handleSeriesRename = async (oldName: string, newName: string, seriesBooks: any[]) => {
    try {
      // Update all books in the series with the new name
      for (const book of seriesBooks) {
        await onUpdateBook(book.id, {
          ...book,
          series: newName
        });
      }

      // Save expanded state
      const currentExpanded = expandedSeries;

      await loadBooks();

      // Update expanded series to new name
      if (currentExpanded === oldName) {
        setExpandedSeries(newName);
        sessionStorage.setItem('bookSearchExpandedSeries', newName);
      }

      if (onShowAlert) {
        onShowAlert(`Renamed series to "${newName}"`, 'success');
      }
    } catch (error) {
      console.error('Error renaming series:', error);
      if (onShowAlert) {
        onShowAlert(`Failed to rename series: ${(error as Error).message}`, 'danger');
      }
    }
  };

  // Remove a book from its series
  const handleRemoveFromSeries = async (book: any) => {
    try {
      await onUpdateBook(book.id, {
        ...book,
        series: null,
        seriesNumber: null
      });

      // Save expanded state
      const currentExpanded = expandedSeries;

      await loadBooks();

      // Restore expanded state if there are still books in the series
      if (currentExpanded) {
        setExpandedSeries(currentExpanded);
        sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
      }

      if (onShowAlert) {
        onShowAlert(`Removed "${book.title}" from series`, 'success');
      }
    } catch (error) {
      console.error('Error removing book from series:', error);
      if (onShowAlert) {
        onShowAlert(`Failed to remove book from series: ${(error as Error).message}`, 'danger');
      }
    }
  };

  // Add books to series - opens the add dialog with template
  const handleAddBooksToSeries = (seriesName: string, existingBooks: any[]) => {
    // Find the book with the highest series number to use as template
    const tmplBook = existingBooks.reduce((best: Book, book: Book) => {
      const num = book.seriesNumber != null ? Number(book.seriesNumber) : 0;
      const bestNum = best?.seriesNumber != null ? Number(best.seriesNumber) : 0;
      return num > bestNum ? book : best;
    }, existingBooks[0]);

    setTemplateBook(tmplBook);
    setShowAddDialog(true);
  };

  // An open book's details step through the books in the order the page shows them.
  const bookSteps = useDetailSteps(
    selectedBookDetails ? shownIds(scrollContainerRef.current) : [],
    selectedBookDetails?.id,
    id => bookService.getBookById(id),
    setSelectedBookDetails,
    { imagesOf: bookImages, summaryOf: id => findById(id, allBooks) });

  const handleBookClick = async (bookId: number | string) => {
    if (phone) setOpenedBookId(Number(bookId));
    try {
      const details = await bookService.getBookById(bookId);
      setSelectedBookDetails(details);
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to load book details: ' + (err as Error).message, 'danger');
      }
    }
  };

  // A book saved from its card or its full screen: the page reads its books again, and the book.
  const handleBookUpdated = async (bookOrId: any) => {
    try {
      // Handle both cases: bookOrId can be a book object or just an ID
      const bookId = typeof bookOrId === 'object' ? bookOrId?.id : bookOrId;
      console.log('BookSearch: Refreshing book data for ID:', bookId);

      // Save expanded series state before reloading
      const currentExpanded = expandedSeries;
      // Refresh the book list to show updated covers
      await loadBooks();
      // Restore expanded series state after reload
      if (currentExpanded) {
        setExpandedSeries(currentExpanded);
        sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
      }

      // Also update the detail card if it's open
      // If we already have the full book object, use it directly; otherwise fetch
      let updatedBook;
      if (typeof bookOrId === 'object' && bookOrId?.id) {
        updatedBook = bookOrId;
      } else if (bookId) {
        updatedBook = await bookService.getBookById(bookId);
      }

      if (updatedBook) {
        console.log('BookSearch: Updated book data:', updatedBook);
        console.log('BookSearch: ebookFile value:', updatedBook?.ebookFile);
        setSelectedBookDetails(updatedBook);
      }
    } catch (err) {
      console.error('Failed to reload book details after update:', err);
      if (onShowAlert) {
        onShowAlert('Book updated but failed to refresh details', 'warning');
      }
    }
  };

  // The search's menu opens a book it guessed from a few letters (services/openItem).
  useOpenItem('book', id => { handleBookClick(id); });

  const groupBooksBySeries = useCallback((booksToGroup: Book[]) => {
    const seriesMap = new Map<string, Book[]>();
    const standaloneBooks: Book[] = [];

    booksToGroup.forEach((book: Book) => {
      if (book.series && book.series.trim()) {
        const seriesName = book.series.trim();
        if (!seriesMap.has(seriesName)) {
          seriesMap.set(seriesName, []);
        }
        seriesMap.get(seriesName)!.push(book);
      } else {
        standaloneBooks.push(book);
      }
    });

    return { seriesMap, standaloneBooks };
  }, []);

  const renderBookGrid = () => {
    if (loading) {
      return (
        <Loading />
      );
    }

    if (displayBooks.length === 0) {
      const hasSearchText = searchCriteria?.searchText && searchCriteria.searchText.trim();

      if (hasSearchText) {
        return (
          <EmptyState
            icon="📚"
            title="No Results Found"
            description={`No books match "${searchCriteria.searchText}"`}
            hint="Try different keywords or clear your search"
            collectionInfo={`You have <strong>${allBooks.length}</strong> ${allBooks.length === 1 ? 'book' : 'books'} in your collection`}
          />
        );
      }

      return (
        <EmptyState
          icon="📖"
          title="Welcome to BookDex!"
          description="Your book collection is empty. Add your first book to get started and begin tracking your library."
          action={
            <Button variant="primary" icon={<BsBook />} className="mt-4"
              onClick={onOpenAddDialog}
            >
              Add Your First Book
            </Button>
          }
        />
      );
    }

    if (groupBy === 'none') {
      // Check if there's an active filter
      const hasActiveFilter = searchCriteria?.searchText?.trim() || (defaultTitleStatus && defaultTitleStatus !== 'all');
      const shouldUseStack = stackEnabled;

      // When searching, group ALL books by series, then filter each stack
      // When not searching, just group the current books
      const booksToGroup = hasActiveFilter ? allBooks : displayBooks;
      const { seriesMap: allSeriesMap, standaloneBooks: allStandaloneBooks } = groupBooksBySeries(booksToGroup);

      // If searching, filter each series to only include matching books
      let seriesMap = allSeriesMap;
      let standaloneBooks = allStandaloneBooks;
      const seriesTotalCounts = new Map<string, number>(); // Track total counts for each series

      if (hasActiveFilter) {
        // Create a Set of filtered book IDs for quick lookup (with type filters applied)
        const filteredBookIds = new Set(displayBooks.map((b: Book) => b.id));

        // Store total counts before filtering
        allSeriesMap.forEach((seriesBooks, seriesName) => {
          seriesTotalCounts.set(seriesName, seriesBooks.length);
        });

        // Filter series to only include matching books
        seriesMap = new Map();
        allSeriesMap.forEach((seriesBooks, seriesName) => {
          const matchingBooks = seriesBooks.filter((b: Book) => filteredBookIds.has(b.id));
          if (matchingBooks.length > 0) {
            seriesMap.set(seriesName, matchingBooks);
          }
        });

        // Filter standalone books
        standaloneBooks = allStandaloneBooks.filter((b: Book) => filteredBookIds.has(b.id));
      }

      // Create a combined list of items for unified sorting
      const combinedItems: CombinedItem[] = [];

      // Add series stacks (represented by their first book for sorting)
      seriesMap.forEach((booksInSeries, seriesName) => {
        // Sort books within series by series number
        const sortedSeriesBooks = [...booksInSeries].sort((a, b) => {
          const numA = a.seriesNumber != null ? Number(a.seriesNumber) : 999999;
          const numB = b.seriesNumber != null ? Number(b.seriesNumber) : 999999;
          if (isNaN(numA) && isNaN(numB)) return a.title.localeCompare(b.title);
          if (isNaN(numA)) return 1;
          if (isNaN(numB)) return -1;
          return numA - numB;
        });

        combinedItems.push({
          type: 'series',
          seriesName,
          books: booksInSeries,
          sortedBooks: sortedSeriesBooks,
          representativeBook: sortedSeriesBooks[0], // Use first book for sorting
        });
      });

      // Add standalone books
      standaloneBooks.forEach((book: Book) => {
        combinedItems.push({
          type: 'book',
          book,
        });
      });

      // Sort the combined list according to current sortBy option
      combinedItems.sort((a, b) => {
        const bookA = a.type === 'series' ? a.representativeBook! : a.book!;
        const bookB = b.type === 'series' ? b.representativeBook! : b.book!;

        switch (sortBy) {
          case 'title':
            // For series, use series name; for books, use title
            const titleA = a.type === 'series' ? a.seriesName! : bookA.title;
            const titleB = b.type === 'series' ? b.seriesName! : bookB.title;
            return titleA.localeCompare(titleB);
          case 'titleReverse':
            const titleRevA = a.type === 'series' ? a.seriesName! : bookA.title;
            const titleRevB = b.type === 'series' ? b.seriesName! : bookB.title;
            return titleRevB.localeCompare(titleRevA);
          case 'author':
            const authorA = Array.isArray(bookA.authors) ? bookA.authors.join(', ') : (bookA.authors || '');
            const authorB = Array.isArray(bookB.authors) ? bookB.authors.join(', ') : (bookB.authors || '');
            return authorA.localeCompare(authorB);
          case 'authorReverse':
            const authorRevA = Array.isArray(bookA.authors) ? bookA.authors.join(', ') : (bookA.authors || '');
            const authorRevB = Array.isArray(bookB.authors) ? bookB.authors.join(', ') : (bookB.authors || '');
            return authorRevB.localeCompare(authorRevA);
          case 'year':
            return (bookB.publishedYear || 0) - (bookA.publishedYear || 0);
          case 'yearReverse':
            return (bookA.publishedYear || 0) - (bookB.publishedYear || 0);
          case 'lastAdded':
            return new Date(bookB.createdAt || '').getTime() - new Date(bookA.createdAt || '').getTime();
          case 'lastAddedReverse':
            return new Date(bookA.createdAt || '').getTime() - new Date(bookB.createdAt || '').getTime();
          case 'series':
          case 'authorSeries':
          default:
            // Default: sort by series name (removing articles)
            const seriesA = a.type === 'series' ? a.seriesName! : bookA.title;
            const seriesB = b.type === 'series' ? b.seriesName! : bookB.title;
            const seriesAForSort = removeArticlesForSorting(seriesA);
            const seriesBForSort = removeArticlesForSorting(seriesB);
            return seriesAForSort.localeCompare(seriesBForSort);
        }
      });
      // While letters are typed, the best match first, a series by its best book (useBestMatch).
      if (bestMatch.on) stacksMatchFirst(combinedItems, filteredBooks, item => (item.type === 'series' ? item.books! : [item.book!]));

      // Render the sorted combined items with letter on all items for index visibility detection
      const items: React.ReactNode[] = [];

      combinedItems.forEach(item => {
        // Determine the field for letter tracking based on sort type
        let sortField: string;
        if (sortBy === 'author' || sortBy === 'authorReverse') {
          const book = item.type === 'series' ? item.books![0] : item.book;
          if (book) {
            // Handle authors field (can be array or string)
            if (Array.isArray(book.authors) && book.authors.length > 0) {
              sortField = String(book.authors[0] || '');
            } else if (typeof book.authors === 'string') {
              sortField = book.authors;
            } else {
              sortField = String(book.author || '');
            }
          } else {
            sortField = '';
          }
        } else {
          sortField = item.type === 'series' ? item.seriesName! : (item.book?.series || item.book?.title || '');
        }
        // Remove articles before getting first character to match sorting behavior
        const sortFieldWithoutArticles = removeArticlesForSorting(sortField || '');
        const firstChar = sortFieldWithoutArticles?.charAt(0)?.toUpperCase() || '';
        const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';

        if (item.type === 'series') {
          if (item.books!.length > 1 && shouldUseStack) {
            const isExpanded = expandedSeries === item.seriesName;
            const totalCount = hasActiveFilter ? seriesTotalCounts.get(item.seriesName!) : undefined;

            items.push(
              <SeriesStack
                key={`series-${item.seriesName}`}
                seriesName={item.seriesName!}
                books={item.books!}
                isExpanded={isExpanded}
                sortedBooks={item.sortedBooks}
                onToggleExpanded={() => {
                  const newExpanded = isExpanded ? null : item.seriesName!;
                  setExpandedSeries(newExpanded);
                  if (newExpanded) {
                    sessionStorage.setItem('bookSearchExpandedSeries', newExpanded);
                  } else {
                    sessionStorage.removeItem('bookSearchExpandedSeries');
                  }
                }}
                onBookClick={(book: any) => handleBookClick(book.id)}
                onEdit={(book: any) => { handleEditBook(book); }}
                onDelete={(book: any) => setShowDeleteModal({ show: true, bookId: book.id })}
                onBookDropped={handleBookDroppedOnSeries}
                onSeriesMerge={handleSeriesMerge}
                onSeriesRename={handleSeriesRename}
                onRemoveFromSeries={handleRemoveFromSeries}
                onAddBooksToSeries={handleAddBooksToSeries}
                onClose={() => {
                  setExpandedSeries(null);
                  sessionStorage.removeItem('bookSearchExpandedSeries');
                }}
                dataFirstLetter={letter}
                totalCount={totalCount}
              />
            );
          } else {
            // Single book in series or stack disabled, show as regular thumbnails
            item.books!.forEach((book: Book) => {
              // Each book gets its own letter based on its title/series
              let bookSortField: string;
              if (sortBy === 'author' || sortBy === 'authorReverse') {
                // Handle authors field (can be array or string)
                if (Array.isArray(book.authors) && book.authors.length > 0) {
                  bookSortField = String(book.authors[0] || '');
                } else if (typeof book.authors === 'string') {
                  bookSortField = book.authors;
                } else {
                  bookSortField = String(book.author || '');
                }
              } else {
                bookSortField = book.series || book.title || '';
              }
              // Remove articles before getting first character to match sorting behavior
              const bookSortFieldWithoutArticles = removeArticlesForSorting(bookSortField || '');
              const bookFirstChar = bookSortFieldWithoutArticles?.charAt(0)?.toUpperCase() || '';
              const bookLetter = /[A-Z]/.test(bookFirstChar) ? bookFirstChar : '#';

              items.push(
                <BookThumbnail
                  key={book.id}
                  book={book}
                  onClick={() => handleBookClick(book.id)}
                  onEdit={() => handleEditBook(book)}
                  onDelete={() => setShowDeleteModal({ show: true, bookId: book.id })}
                  onBookDroppedForSeries={!book.series ? handleBookDroppedForNewSeries : null}
                  onAddToExistingSeries={handleBookDroppedOnSeries}
                  onSeriesMerge={handleSeriesMerge}
                  dataItemId={book.id}
                  dataFirstLetter={bookLetter}
                />
              );
            });
          }
        } else {
          items.push(
            <BookThumbnail
              key={item.book!.id}
              onBookDroppedForSeries={!item.book!.series ? handleBookDroppedForNewSeries : null}
              onAddToExistingSeries={handleBookDroppedOnSeries}
              onSeriesMerge={handleSeriesMerge}
              book={item.book!}
              onClick={() => handleBookClick(item.book!.id)}
              onEdit={() => handleEditBook(item.book!)}
              onDelete={() => setShowDeleteModal({ show: true, bookId: item.book!.id })}
              dataItemId={item.book!.id}
              dataFirstLetter={letter}
            />
          );
        }
      });

      return (
        <div className={`book-grid ${sortLoading ? 'sort-loading' : ''} ${expandedSeries ? 'has-expanded' : ''}`}>
          <Progressive>{items}</Progressive>
        </div>
      );
    }

    const grouped = groupBooks(displayBooks, groupBy);
    const sortedGroupKeys = Object.keys(grouped).sort();

    return (
      <div className={`books-groups ${sortLoading || groupLoading ? 'sort-loading' : ''}`}>
        {sortedGroupKeys.map((groupKey) => {
          const groupBooksItems = grouped[groupKey];
          const isExpanded = expandedGroups.has(groupKey);
          const sortedGroupBooks = sortBooks(groupBooksItems, sortBy);

          return (
            <div key={groupKey} className="book-group">
              <div
                className="group-header"
                onClick={() => toggleGroup(groupKey)}
              >
                <div className="group-title">
                  <BsChevronDown className={`group-chevron ${isExpanded ? 'expanded' : ''}`} />
                  <span>{groupKey}</span>
                  <span className="group-count">({groupBooksItems.length})</span>
                </div>
              </div>

              {isExpanded && (
                <div className="book-grid">
                  {sortedGroupBooks.map((book) => {
                    const bookSortField = (sortBy === 'author' || sortBy === 'authorReverse')
                      ? book.author
                      : (book.series || book.title);
                    const firstChar = bookSortField?.charAt(0)?.toUpperCase() || '';
                    const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';

                    return (
                      <BookThumbnail
                        key={book.id}
                        book={book}
                        onClick={() => handleBookClick(book.id)}
                        onBookDroppedForSeries={!book.series ? handleBookDroppedForNewSeries : null}
                        onAddToExistingSeries={handleBookDroppedOnSeries}
                        onSeriesMerge={handleSeriesMerge}
                        onEdit={() => handleEditBook(book)}
                        onDelete={() => setShowDeleteModal({ show: true, bookId: book.id })}
                        dataFirstLetter={letter}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const sortOptions = [
    { value: 'title', label: 'Title A-Z', key: 'Title', direction: 'A-Z' },
    { value: 'titleReverse', label: 'Title Z-A', key: 'Title', direction: 'Z-A' },
    { value: 'author', label: 'Author A-Z', key: 'Author', direction: 'A-Z' },
    { value: 'authorReverse', label: 'Author Z-A', key: 'Author', direction: 'Z-A' },
    { value: 'series', label: 'Series A-Z', key: 'Series' },
    { value: 'year', label: 'Year (Newest)', key: 'Year', direction: 'Newest' },
    { value: 'yearReverse', label: 'Year (Oldest)', key: 'Year', direction: 'Oldest' },
    { value: 'lastAdded', label: 'Last Added', key: 'Added', direction: 'Last' },
    { value: 'lastAddedReverse', label: 'First Added', key: 'Added', direction: 'First' }
  ];

  // On a phone the owners' chips would not hold on the header's one line: one menu, a choice per owner.
  const ownerControls = owners.length > 1 && (narrow ? (
    <Menu label="Whose books" align="end" trigger={(props, open) => (
      <button type="button" {...props} title="Whose books" aria-label="Whose books"
        className={`menu-pill book-owner-menu ${ownerFilter.length ? 'menu-pill--on' : 'menu-pill--icon'}`}>
        {ownerFilter.length
          ? <span className="book-owner-menu__names">{owners.filter(([owner]) => isOwnerChosen(owner)).map(([, , label]) => label).join(', ')}</span>
          : <BsPerson />}
        <MenuChevron open={open} />
      </button>
    )}>
      <Menu.Choice selected={!ownerFilter.length} onSelect={() => updateSearchViaUrl(withOwners(searchCriteria?.searchText || '', [], { replace: true }))}>
        Everyone's
      </Menu.Choice>
      <Menu.Separator />
      {owners.map(([owner, count, label]) => (
        <Menu.Choice key={owner} selected={isOwnerChosen(owner)} hint={count} onSelect={() => updateSearchViaUrl(withOwners(searchCriteria?.searchText || '', [owner], { replace: true }))}>
          {label}
        </Menu.Choice>
      ))}
    </Menu>
  ) : (
    <span className="book-owner-chips" role="group" aria-label="Whose books">
      {owners.map(([owner, count, label]) => (
        <Chip key={owner} active={isOwnerChosen(owner)} count={count} title="Alt-click to add or remove" onClick={event => clickOwner(owner, event.altKey)}>{label}</Chip>
      ))}
    </span>
  ));

  const groupOptions = [
    { value: 'none', label: 'No grouping' },
    { value: 'author', label: 'Group by Author' },
    { value: 'genre', label: 'Group by Genre' },
    { value: 'series', label: 'Group by Series' },
    { value: 'format', label: 'Group by Format' },
    { value: 'decade', label: 'Group by Decade' },
    { value: 'language', label: 'Group by Language' }
  ];

  return (
    <div className="book-search" ref={scrollContainerRef}>
      {/* Alphabetical Index - shows when sorted alphabetically */}
      <AlphabeticalIndex
        items={filteredBooks}
        getTitle={(book: Record<string, unknown>) => {
          if (sortBy === 'author' || sortBy === 'authorReverse') {
            // Handle authors field (can be array or string)
            if (Array.isArray(book.authors) && book.authors.length > 0) {
              return String(book.authors[0] || '');
            } else if (typeof book.authors === 'string') {
              return book.authors;
            } else {
              return String(book.author || '');
            }
          }
          return String(book.series || book.title || '');
        }}
        scrollContainer={scrollContainer}
        sortBy={
          sortBy === 'series' || sortBy === 'authorSeries' ? 'title' :
          sortBy === 'seriesReverse' ? 'titleReverse' :
          sortBy
        }
        // Keep available during search/filter (e.g. "-type:score"); disable only when grouping is enabled
        disabled={groupBy !== 'none'}
      />

      <div className="books-results">
        <CollectionHeader
          filteredCount={displayBooks.length}
          totalCount={bookCount.total}
          itemLabel="books"
          sortBy={sortBy}
          sortOptions={sortOptions}
          onSortChange={handleSortChange}
          bestMatch={bestMatch.on && hasMatchScores(filteredBooks)}
          onBestMatch={hasMatchScores(filteredBooks) ? handleBestMatch : undefined}
          sortLoading={sortLoading}
          groupBy={groupBy}
          groupOptions={groupOptions}
          onGroupChange={handleGroupChange}
          groupLoading={groupLoading}
          expandAllGroups={expandAllGroups}
          onToggleAllGroups={toggleAllGroups}
          stackEnabled={stackEnabled}
          onStackChange={setStackEnabled}
          addButtonLabel="Add Book"
          onAdd={() => setShowAddDialog(true)}
          loading={loading}
          leading={viewSwitch}
          extraControls={ownerControls}
        />

        {renderBookGrid()}
      </div>

      <AddBookDialog
        show={showAddDialog}
        onHide={() => {
          setShowAddDialog(false);
          setTemplateBook(null); // Clear template when dialog closes
        }}
        onAddBook={onAddBook}
        defaultTitleStatus={defaultTitleStatus}
        onShowAlert={onShowAlert}
        onAddStart={() => {
          setShowAddDialog(false);
          setAddingBook(true);
        }}
        onBookAdded={async (book: any) => {
          try {
            await loadBooks();
          } finally {
            setAddingBook(false);
            setTemplateBook(null); // Clear template after book is added
            // Re-open dialog if it was closed but we're in "add multiple" mode
            // The dialog component will handle keeping itself open if addMultipleBooks is true
          }
        }}
        onAddError={(err: any) => {
          setAddingBook(false);
          const errorMessage = err?.message || 'Failed to add book';
          if (onShowAlert) {
            onShowAlert(errorMessage, 'danger');
          }
        }}
        templateBook={(templateBook || undefined) as any}
      />

      {editingBook && (
        <BookForm
          book={editingBook}
          onSave={async (bookData: any) => {
            await onUpdateBook(editingBook.id, bookData);
            await handleFormSave();
          }}
          onCancel={handleFormCancel}
          defaultTitleStatus={defaultTitleStatus}
          onShowAlert={onShowAlert}
        />
      )}

      {phone && openedBookId != null && (
        <BookSheet
          bookId={openedBookId}
          book={selectedBookDetails?.id === openedBookId ? selectedBookDetails : null}
          listBook={findById(openedBookId, allBooks)}
          books={allBooks}
          onClose={() => { setOpenedBookId(null); setBookView(null); setSelectedBookDetails(null); }}
          onUpdated={handleBookUpdated}
          onDelete={async (bookId: number) => { await onDeleteBook(bookId); await loadBooks(); }}
          onSearch={updateSearchViaUrl}
          onBookClick={handleBookClick}
          onOpenView={setBookView}
        />
      )}

      {selectedBookDetails && (!phone || bookView) && (
        <BookDetailCard
          book={selectedBookDetails}
          only={phone ? bookView ?? undefined : undefined}
          onClose={() => {
            // Over a phone's full screen book, its one view done: back to the book.
            if (phone) { setBookView(null); return; }
            // Save current expanded series before closing (use ref to get latest value)
            const currentExpanded = expandedSeriesRef.current;
            if (currentExpanded) {
              sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
            }
            // Close modal first
            setSelectedBookDetails(null);
            // Immediately restore expanded series state after modal closes
            // Use a small delay to ensure DOM has updated
            requestAnimationFrame(() => {
              if (currentExpanded) {
                setExpandedSeries(currentExpanded);
              }
            });
          }}
          onEdit={() => handleEditBook(selectedBookDetails)}
          onPrevious={bookSteps.onPrevious}
          onNext={bookSteps.onNext}
          onUpdateBook={onUpdateBook}
          onBookUpdated={handleBookUpdated}
          onDelete={async () => {
            try {
              // Save expanded series state before reloading
              const currentExpanded = expandedSeries;
              await onDeleteBook(selectedBookDetails.id);
              setSelectedBookDetails(null);
              await loadBooks();
              // Restore expanded series state after reload
              if (currentExpanded) {
                setExpandedSeries(currentExpanded);
                sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
              }
            } catch (e) {
              if (onShowAlert) onShowAlert('Failed to delete book: ' + ((e as any)?.message || ''), 'danger');
            }
          }}
          onSearch={updateSearchViaUrl}
          onAddNextVolume={() => {
            setShowAddDialog(true);
          }}
          onBookClick={handleBookClick}
          onAddBooksBatch={async (books: any[]) => {
            try {
              // Save expanded series state before reloading
              const currentExpanded = expandedSeries;
              const result = await bookService.addBooksBatch(books) as BatchResult;
              if (result.errors && result.errors.length > 0) {
                const errorMsg = result.errors.map((e: { book: string; error: string }) => `${e.book}: ${e.error}`).join(', ');
                throw new Error(errorMsg);
              }
              await loadBooks();
              // Restore expanded series state after reload
              if (currentExpanded) {
                setExpandedSeries(currentExpanded);
                sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
              }
              return result.success || [];
            } catch (error) {
              console.error('Error adding books batch:', error);
              throw error;
            }
          }}
          onAddStart={() => {
            setAddingBook(true);
          }}
          onBookAdded={async () => {
            try {
              // Save expanded series state before reloading
              const currentExpanded = expandedSeries;
              await loadBooks();
              // Restore expanded series state after reload
              if (currentExpanded) {
                setExpandedSeries(currentExpanded);
                sessionStorage.setItem('bookSearchExpandedSeries', currentExpanded);
              }
            } finally {
              setAddingBook(false);
            }
          }}
          onAddError={(err: any) => {
            setAddingBook(false);
            const errorMessage = err?.message || 'Failed to add book';
            if (onShowAlert) {
              onShowAlert(errorMessage, 'danger');
            }
          }}
        />
      )}

      {addingBook && (
        <div className="loading-overlay">
          <Spinner size="lg" />
          <div className="loading-message">
            Adding book to your collection...
          </div>
        </div>
      )}


      {showDeleteModal.show && (
        <ConfirmDialog
          title="Delete this book?"
          message="It leaves your collection for good."
          confirmLabel="Delete"
          danger
          onAnswer={async yes => {
            if (!yes) {
              setShowDeleteModal({ show: false, bookId: null });
              return;
            }
            const id = showDeleteModal.bookId;
            try {
              await onDeleteBook(id!);
              if (selectedBookDetails && selectedBookDetails.id === id) {
                setSelectedBookDetails(null);
              }
              await loadBooks();
            } finally {
              setShowDeleteModal({ show: false, bookId: null });
            }
          }}
        />
      )}

      {/* Create Series Modal */}
      <Dialog show={showCreateSeriesModal} onClose={handleCancelCreateSeries} className="create-series-modal" title="Create New Series">
        <Dialog.Body>
          <p className="text-muted mb-3">
            You're about to create a new series with these two books:
          </p>
          <div className="create-series-books mb-4">
            <div className="create-series-book">
              <strong>{createSeriesData.targetBook?.title}</strong>
              {createSeriesData.targetBook?.authors && (
                <div className="text-muted small">
                  {Array.isArray(createSeriesData.targetBook.authors)
                    ? createSeriesData.targetBook.authors.join(', ')
                    : createSeriesData.targetBook.authors}
                </div>
              )}
            </div>
            <div className="create-series-book">
              <strong>{createSeriesData.draggedBook?.title}</strong>
              {createSeriesData.draggedBook?.authors && (
                <div className="text-muted small">
                  {Array.isArray(createSeriesData.draggedBook.authors)
                    ? createSeriesData.draggedBook.authors.join(', ')
                    : createSeriesData.draggedBook.authors}
                </div>
              )}
            </div>
          </div>
          <Form.Group>
            <Form.Label>Series Name</Form.Label>
            <TextField
              type="text"
              value={seriesNameInput}
              onChange={(e) => setSeriesNameInput(e.target.value)}
              placeholder="Enter series name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirmCreateSeries();
                }
              }}
            />
            <Form.Text className="text-muted">
              Series numbers will be inferred from the titles if possible
            </Form.Text>
          </Form.Group>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="quiet" onClick={handleCancelCreateSeries}>
            Cancel
          </Button>
          <Button variant="primary"
            onClick={handleConfirmCreateSeries}
            disabled={!seriesNameInput.trim()}
          >
            Create Series
          </Button>
        </Dialog.Footer>
      </Dialog>

      {/* Merge Series Modal */}
      <Dialog show={showMergeSeriesModal} onClose={handleCancelMergeSeries} className="create-series-modal" title="Merge Series">
        <Dialog.Body>
          <p className="text-muted mb-3">
            You're about to merge two series. Choose which series name to keep:
          </p>
          <div className="merge-series-options mb-4">
            <div
              className={`merge-series-option ${mergeSeriesData.selectedName === mergeSeriesData.targetSeries ? 'selected' : ''}`}
              onClick={() => setMergeSeriesData(prev => ({ ...prev, selectedName: prev.targetSeries }))}
            >
              <Form.Check
                type="radio"
                name="seriesName"
                id="targetSeries"
                checked={mergeSeriesData.selectedName === mergeSeriesData.targetSeries}
                onChange={() => setMergeSeriesData(prev => ({ ...prev, selectedName: prev.targetSeries }))}
                label={
                  <div>
                    <strong>{mergeSeriesData.targetSeries}</strong>
                    <div className="text-muted small">{mergeSeriesData.targetBooks.length} books</div>
                  </div>
                }
              />
            </div>
            <div
              className={`merge-series-option ${mergeSeriesData.selectedName === mergeSeriesData.sourceSeries ? 'selected' : ''}`}
              onClick={() => setMergeSeriesData(prev => ({ ...prev, selectedName: prev.sourceSeries }))}
            >
              <Form.Check
                type="radio"
                name="seriesName"
                id="sourceSeries"
                checked={mergeSeriesData.selectedName === mergeSeriesData.sourceSeries}
                onChange={() => setMergeSeriesData(prev => ({ ...prev, selectedName: prev.sourceSeries }))}
                label={
                  <div>
                    <strong>{mergeSeriesData.sourceSeries}</strong>
                    <div className="text-muted small">{mergeSeriesData.sourceBooks.length} books</div>
                  </div>
                }
              />
            </div>
          </div>
          <p className="text-muted small mb-0">
            Total: {mergeSeriesData.sourceBooks.length + mergeSeriesData.targetBooks.length} books will be in the merged series
          </p>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="quiet" onClick={handleCancelMergeSeries}>
            Cancel
          </Button>
          <Button variant="primary"
            onClick={handleConfirmMergeSeries}
            disabled={!mergeSeriesData.selectedName}
          >
            Merge Series
          </Button>
        </Dialog.Footer>
      </Dialog>
    </div>
  );
});

BookSearch.displayName = 'BookSearch';

export default BookSearch;
