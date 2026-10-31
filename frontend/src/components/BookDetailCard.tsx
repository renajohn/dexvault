import React, { useState, useEffect, useRef } from 'react';
import { Badge, Form } from 'react-bootstrap';
import Dialog from './shared/Dialog';
import { BsPencil, BsTrash, BsBook, BsFileEarmark, BsPlus, BsX, BsCheck, BsArrowLeft, BsDownload, BsFiles, BsCamera, BsChevronRight, BsBoxArrowUpRight } from 'react-icons/bs';
import bookService from '../services/bookService';
import CoverButton from './shared/CoverButton';
import CoverTag, { CoverTagStack } from './shared/CoverTag';
import bookCommentService from '../services/bookCommentService';
import bookSectionsService from '../services/bookSectionsService';
import CoverModal from './CoverModal';
import BookForm from './BookForm';
import { BookStarRating } from './RecordStarRating';
import InlineCoverSelector from './InlineCoverSelector';
import DetailSteps, { useScrollKeys, useStepKeys } from './shared/DetailSteps';
import './BookDetailCard.css';
import './VolumeSelector.css';
import Select from './shared/Select';
import Button, { IconButton } from './shared/Button';
import { FieldError, TextArea, TextField } from './shared/TextField';
import Notice from './shared/Notice';
import Spinner, { Loading } from './shared/Spinner';
import Chip from './shared/Chip';
import { toast } from './shared/Toast';

interface BookDetailCardProps {
  book: any;
  onClose: () => void;
  onEdit: (...args: any[]) => void;
  onUpdateBook: (id: string | number, data: any) => Promise<any>;
  onBookUpdated: (book: any) => void;
  onDelete: (id: string | number) => void;
  onSearch?: (query: string) => void;
  onAddNextVolume?: (...args: any[]) => void;
  onAddBooksBatch?: (...args: any[]) => void;
  onAddStart?: () => void;
  onBookAdded?: (book: any) => void;
  onAddError?: (error: any) => void;
  onBookClick?: (book: any) => void;
  /** The book before or after this one on the page; none at either end. */
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
  /** One view alone, over a phone's full screen book (BookSheet): its edit or its next volumes; done, it closes. */
  only?: 'edit' | 'volumes';
}

interface SeriesBookItemProps {
  bookItem: any;
  onBookClick: (id: any) => void;
  getCoverUrl: (coverPath: string) => string | null;
  currentBookId: number;
}

// Format ISBN for display with dashes
const formatIsbnDisplay = (isbn: any) => {
  if (!isbn) return '';
  
  // Remove all non-digit characters
  const digitsOnly = isbn.toString().replace(/\D/g, '');
  
  // If it's an ISBN-13 starting with 978 or 979, format as prefix-X-XXX-XXXXX-X
  if (digitsOnly.length === 13 && (digitsOnly.startsWith('978') || digitsOnly.startsWith('979'))) {
    return `${digitsOnly.substring(0, 3)}-${digitsOnly.substring(3, 4)}-${digitsOnly.substring(4, 7)}-${digitsOnly.substring(7, 12)}-${digitsOnly.substring(12, 13)}`;
  }
  
  // If it's an ISBN-13 not starting with 978 or 979, format as XXX-X-XXX-XXXXX-X
  if (digitsOnly.length === 13) {
    return `${digitsOnly.substring(0, 3)}-${digitsOnly.substring(3, 4)}-${digitsOnly.substring(4, 7)}-${digitsOnly.substring(7, 12)}-${digitsOnly.substring(12, 13)}`;
  }
  
  // If it's an ISBN-10, format as X-XXX-XXXXX-X
  if (digitsOnly.length === 10) {
    return `${digitsOnly.substring(0, 1)}-${digitsOnly.substring(1, 4)}-${digitsOnly.substring(4, 9)}-${digitsOnly.substring(9, 10)}`;
  }
  
  // For other cases, return as-is
  return isbn;
};

// Series Book Item Component (similar to SortableCollectionMember but without drag-and-drop)
// A link's name from its key: the sites by their names, a key nobody named spelled out.
const LINK_NAMES: Record<string, string> = {
  googleBooks: 'Google Books', googleBooksInfo: 'Google Books (info)', googleBooksPreview: 'Google Books (preview)',
  amazon: 'Amazon', openlibrary: 'Open Library', openlibraryWork: 'Open Library (work)', IMSLP: 'IMSLP',
};
const linkName = (key: string): string =>
  LINK_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
// A second page of a site already linked: in the fold, not in the head.
const isSecondaryLink = (key: string): boolean => /(Info|Preview|Work)$/.test(key);

const BookField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

const SeriesBookItem = ({ bookItem, onBookClick, getCoverUrl, currentBookId }: SeriesBookItemProps) => {
  return (
    <div 
      className={`series-book-item ${bookItem.id === currentBookId ? 'current' : ''}`}
      onClick={() => onBookClick(bookItem.id)}
    >
      <div className="series-book-container">
        {bookItem.cover ? (
          <>
            <img 
              src={getCoverUrl(bookItem.cover) || undefined}
              alt={bookItem.title}
              className="series-book-image"
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                const target = e.target as HTMLElement;
                target.style.display = 'none';
                if (target.nextSibling) {
                  (target.nextSibling as HTMLElement).style.display = 'flex';
                }
              }}
            />
            <div className="series-book-placeholder" style={{ display: 'none' }}>
              <BsBook size={32} />
            </div>
          </>
        ) : (
          <div className="series-book-placeholder">
            <BsBook size={32} />
          </div>
        )}
        <div className="series-book-overlay">
          <div className="series-book-title">{bookItem.title}</div>
          {bookItem.seriesNumber && (
            <div className="series-book-number">#{bookItem.seriesNumber}</div>
          )}
        </div>
      </div>
    </div>
  );
};

const BookDetailCard = ({ book, onClose, onEdit, onUpdateBook, onBookUpdated, onDelete, onSearch, onAddNextVolume, onAddBooksBatch, onAddStart, onBookAdded, onAddError, onBookClick, onPrevious, onNext, only }: BookDetailCardProps) => {
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Every reading of the book, a book read again keeping its first.
  const [readDates, setReadDates] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setReadDates([]);
    if (book?.id && book.readDate) {
      bookSectionsService.readingsOf(book.id).then(list => { if (live) setReadDates(list.map(r => r.readDate).filter((d): d is string => Boolean(d))); }).catch(() => { /* the one date then */ });
    }
    return () => { live = false; };
  }, [book?.id, book?.readDate]);
  // Read (again): the date being given, today unless changed.
  const [rereading, setRereading] = useState<string | null>(null);
  // What one thought this time, if one wishes: a comment of that reading.
  const [rereadWords, setRereadWords] = useState('');
  const keepReading = async () => {
    if (!rereading) return;
    try {
      const reading = await bookSectionsService.addReading(book.id, rereading);
      if (rereadWords.trim()) {
        let name = 'Renault';
        try { name = localStorage.getItem('dv.readingName') || name; } catch { /* a private window */ }
        await bookCommentService.createComment({ bookId: book.id, readingId: reading.id, name, comment: rereadWords.trim(), date: new Date().toISOString() });
        setRereadWords('');
        loadComments();
      }
      const dates = [...(readDates.length ? readDates : book.readDate ? [String(book.readDate).slice(0, 10)] : []), rereading].sort();
      setReadDates(dates);
      setRereading(null);
      toast(readDates.length || book.readDate ? 'Read again: a new reading in the journal' : 'Marked as read', { tone: 'success' });
      onBookUpdated?.({ ...book, readDate: dates[dates.length - 1] });
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };
  const [coverModalData, setCoverModalData] = useState<{ coverUrl: string; title: string; author: string; coverType?: string }>({ coverUrl: '', title: '', author: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteEbook, setConfirmDeleteEbook] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [editingComment, setEditingComment] = useState<any>(null);
  const [commentFormData, setCommentFormData] = useState({ name: '', comment: '' });
  const [commentErrors, setCommentErrors] = useState<Record<string, any>>({});
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const nameInputRef = React.useRef<any>(null);
  const nameDropdownRef = React.useRef<HTMLDivElement>(null);
  const deleteBtnRef = React.useRef<HTMLButtonElement>(null);
  const editFormRef = React.useRef<HTMLDivElement>(null);
  
  // View state: 'detail', 'volumes', or 'edit'
  const [view, setView] = useState<string>(only ?? 'detail');
  // Back to the details, or, opened on one view alone, closed.
  const toDetail = () => { if (only) onClose(); else setView('detail'); };

  // ← → step through the page's books, but only on the details, never while
  // editing or choosing volumes. Each book starts at the top.
  const steps = view === 'detail' ? { onPrevious, onNext } : { onPrevious: null, onNext: null };
  useStepKeys(steps.onPrevious, steps.onNext, showCoverModal);
  const detailViewRef = useRef<HTMLDivElement>(null);
  useScrollKeys(detailViewRef, view !== 'detail' || showCoverModal);
  useEffect(() => {
    detailViewRef.current?.scrollTo?.({ top: 0 });
  }, [book?.id]);
  const [volumes, setVolumes] = useState<any[]>([]);
  const [loadingVolumes, setLoadingVolumes] = useState(false);
  const [volumeError, setVolumeError] = useState('');
  const [selectedVolumes, setSelectedVolumes] = useState<Set<any>>(new Set());
  const [enrichingVolumes, setEnrichingVolumes] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState({ current: 0, total: 0 });
  const [existingBooks, setExistingBooks] = useState<Map<any, any>>(new Map());
  const [copyOwnerInfo, setCopyOwnerInfo] = useState(true);
  const [updatingBook, setUpdatingBook] = useState(false);
  const [seriesMembers, setSeriesMembers] = useState<any[]>([]);
  const [loadingSeriesMembers, setLoadingSeriesMembers] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  
  // Inline editing state
  const [localBookData, setLocalBookData] = useState(book);
  const [showCoverSelector, setShowCoverSelector] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [ownerValue, setOwnerValue] = useState('');
  const [ownerSuggestions, setOwnerSuggestions] = useState<string[]>([]);
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState(false);
  const [highlightedOwnerIndex, setHighlightedOwnerIndex] = useState(-1);
  const [editingSeries, setEditingSeries] = useState(false);
  const [seriesValue, setSeriesValue] = useState('');
  const [seriesNumberValue, setSeriesNumberValue] = useState('');
  const [seriesSuggestions, setSeriesSuggestions] = useState<string[]>([]);
  const [showSeriesSuggestions, setShowSeriesSuggestions] = useState(false);
  const [highlightedSeriesIndex, setHighlightedSeriesIndex] = useState(-1);
  const [savingBookType, setSavingBookType] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const ownerInputRef = useRef<HTMLInputElement>(null);
  const seriesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (book && book.id) {
      loadComments();
    }
  }, [book?.id]);

  // Sync local book data when book prop changes
  useEffect(() => {
    setLocalBookData(book);
  }, [book]);

  // Force re-render when book cover changes (e.g., after upload)
  useEffect(() => {
    // This effect ensures the component re-renders when book.cover changes
    // The key on the img element will force it to reload the image
  }, [book?.cover]);

  useEffect(() => {
    if (view === 'volumes' && book?.series) {
      loadVolumes();
    }
  }, [view, book?.series]);

  useEffect(() => {
    console.log('BookDetailCard: book prop changed, ebookFile:', book?.ebookFile, 'view:', view, 'full book:', book);
  }, [book, view]);

  const [ebookInfo, setEbookInfo] = useState<any>(null);
  const [loadingEbookInfo, setLoadingEbookInfo] = useState(false);

  useEffect(() => {
    const loadEbookInfo = async () => {
      console.log('loadEbookInfo - book?.ebookFile:', book?.ebookFile, 'view:', view, 'book?.id:', book?.id);
      if (book?.ebookFile && book.ebookFile.trim() && view === 'detail') {
        setLoadingEbookInfo(true);
        try {
          const info = await bookService.getEbookInfo(book.id);
          console.log('Ebook info loaded:', info);
          setEbookInfo(info);
        } catch (error) {
          console.error('Failed to load ebook info:', error);
          setEbookInfo(null);
        } finally {
          setLoadingEbookInfo(false);
        }
      } else {
        setEbookInfo(null);
      }
    };
    loadEbookInfo();
  }, [book?.ebookFile, book?.id, view]);

  // Load series members when book has a series
  useEffect(() => {
    const loadSeriesMembers = async () => {
      if (!book?.series || !book?.id || view !== 'detail') {
        setSeriesMembers([]);
        return;
      }

      setLoadingSeriesMembers(true);
      try {
        const books = await bookService.getBooksBySeries(book.series) as any[];
        // Filter out the current book and only show owned/borrowed books
        const members = books.filter((b: any) => b.id !== book.id);
        setSeriesMembers(members);
      } catch (error) {
        console.error('Error loading series members:', error);
        setSeriesMembers([]);
      } finally {
        setLoadingSeriesMembers(false);
      }
    };

    loadSeriesMembers();
  }, [book?.series, book?.id, view]);

  const loadComments = async () => {
    if (!book?.id) return;
    setLoadingComments(true);
    try {
      const fetchedComments = await bookCommentService.getCommentsByBookId(book.id) as any[];
      setComments(fetchedComments || []);
    } catch (error) {
      console.error('Error loading comments:', error);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (e) {
      return dateString;
    }
  };

  // Use local data for display (allows immediate UI updates)
  const currentBook = localBookData || book;

  // Description truncation - show ~5 lines worth of text
  const DESCRIPTION_CHAR_LIMIT = 350;
  const getDescription = () => currentBook?.description || '';
  const isDescriptionLong = getDescription().length > DESCRIPTION_CHAR_LIMIT;
  
  const getDisplayDescription = () => {
    const desc = getDescription();
    if (!desc) return '';
    if (!isDescriptionLong || descriptionExpanded) return desc;
    // Truncate at the last complete word before the limit
    const truncated = desc.substring(0, DESCRIPTION_CHAR_LIMIT);
    const lastSpace = truncated.lastIndexOf(' ');
    return truncated.substring(0, lastSpace > 200 ? lastSpace : DESCRIPTION_CHAR_LIMIT) + '...';
  };

  // Handle rating change with immediate UI update
  const handleRatingChange = async (newRating: number | null) => {
    if (!currentBook?.id) return;
    
    // Optimistic update - update UI immediately
    setLocalBookData((prev: any) => ({
      ...prev,
      rating: newRating
    }));
    
    try {
      // Send full book data to avoid NOT NULL constraint issues
      await bookService.updateBook(currentBook.id, { 
        ...currentBook,
        rating: newRating 
      });
      
      // Notify parent of update
      if (onBookUpdated) {
        onBookUpdated({ ...currentBook, rating: newRating });
      }
    } catch (error) {
      console.error('Error updating rating:', error);
      // Rollback on error
      setLocalBookData((prev: any) => ({
        ...prev,
        rating: book.rating
      }));
    }
  };

  // Handle cover change button click to show selector
  const handleCoverChangeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowCoverSelector((prev: boolean) => !prev);
  };

  // Handle cover selection
  const handleCoverSelected = (newCover: string) => {
    // Update local state immediately
    setLocalBookData((prev: any) => ({
      ...prev,
      cover: newCover
    }));
    
    setShowCoverSelector(false);
    
    // Notify parent of update
    if (onBookUpdated) {
      onBookUpdated({ ...currentBook, cover: newCover });
    }
  };

  // Owner editing handlers
  const startEditingOwner = () => {
    setOwnerValue(currentBook.owner || '');
    setEditingOwner(true);
    setHighlightedOwnerIndex(-1);
    loadOwnerSuggestions('');
  };

  const loadOwnerSuggestions = async (query: string) => {
    try {
      const suggestions = await bookService.getAutocompleteSuggestions('owner', query) as any[];
      // API returns { owner: 'Name' } format - extract the owner value
      const stringValues = ((suggestions || []) as any[]).map((s: any) => s?.owner || '').filter(Boolean);
      setOwnerSuggestions(stringValues);
      setShowOwnerSuggestions(stringValues.length > 0);
    } catch (error) {
      console.error('Error loading owner suggestions:', error);
      setOwnerSuggestions([]);
      setShowOwnerSuggestions(false);
    }
  };

  const handleOwnerChange = (value: string) => {
    setOwnerValue(value);
    setHighlightedOwnerIndex(-1);
    loadOwnerSuggestions(value);
  };

  const handleOwnerSuggestionClick = (value: string) => {
    setOwnerValue(value);
    setShowOwnerSuggestions(false);
    setHighlightedOwnerIndex(-1);
  };

  const handleOwnerKeyDown = (e: React.KeyboardEvent) => {
    if (!showOwnerSuggestions || ownerSuggestions.length === 0) {
      if (e.key === 'Enter') { e.preventDefault(); saveOwner(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEditingOwner(); }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedOwnerIndex((prev: number) => prev < ownerSuggestions.length - 1 ? prev + 1 : prev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedOwnerIndex((prev: number) => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedOwnerIndex >= 0 && highlightedOwnerIndex < ownerSuggestions.length) {
        handleOwnerSuggestionClick(ownerSuggestions[highlightedOwnerIndex]);
      } else {
        saveOwner();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showOwnerSuggestions) {
        setShowOwnerSuggestions(false);
      } else {
        cancelEditingOwner();
      }
    }
  };

  const saveOwner = async () => {
    if (!currentBook?.id) return;
    
    const newOwner = ownerValue || null;
    setLocalBookData((prev: any) => ({ ...prev, owner: newOwner }));
    setEditingOwner(false);
    
    try {
      // Send full book data to avoid NOT NULL constraint issues
      await bookService.updateBook(currentBook.id, { 
        ...currentBook,
        owner: newOwner 
      });
      if (onBookUpdated) {
        onBookUpdated({ ...currentBook, owner: newOwner });
      }
    } catch (error) {
      console.error('Error updating owner:', error);
      setLocalBookData((prev: any) => ({ ...prev, owner: book.owner }));
    }
  };

  const cancelEditingOwner = () => {
    setEditingOwner(false);
    setOwnerValue('');
    setOwnerSuggestions([]);
    setShowOwnerSuggestions(false);
    setHighlightedOwnerIndex(-1);
  };

  // Book type change handler - saves immediately on dropdown change
  const handleBookTypeChange = async (newBookType: string) => {
    if (savingBookType || newBookType === currentBook.bookType) return;
    
    setSavingBookType(true);
    const previousBookType = currentBook.bookType;
    
    // Optimistic update
    setLocalBookData((prev: any) => ({ ...prev, bookType: newBookType }));
    
    try {
      await bookService.updateBook(currentBook.id, { 
        ...currentBook,
        bookType: newBookType 
      });
      if (onBookUpdated) {
        onBookUpdated({ ...currentBook, bookType: newBookType });
      }
    } catch (error) {
      console.error('Error updating book type:', error);
      // Rollback on error
      setLocalBookData((prev: any) => ({ ...prev, bookType: previousBookType }));
    } finally {
      setSavingBookType(false);
    }
  };

  // Series editing handlers
  const startEditingSeries = () => {
    setSeriesValue(currentBook.series || '');
    setSeriesNumberValue(currentBook.seriesNumber?.toString() || '');
    setEditingSeries(true);
    setHighlightedSeriesIndex(-1);
    loadSeriesSuggestions('');
  };

  const loadSeriesSuggestions = async (query: string) => {
    try {
      const suggestions = await bookService.getAutocompleteSuggestions('series', query) as any[];
      // API returns { series: 'Name' } format - extract the series value
      const stringValues = ((suggestions || []) as any[]).map((s: any) => s?.series || '').filter(Boolean);
      setSeriesSuggestions(stringValues);
      setShowSeriesSuggestions(stringValues.length > 0);
    } catch (error) {
      console.error('Error loading series suggestions:', error);
      setSeriesSuggestions([]);
      setShowSeriesSuggestions(false);
    }
  };

  const handleSeriesChange = (value: string) => {
    setSeriesValue(value);
    setHighlightedSeriesIndex(-1);
    loadSeriesSuggestions(value);
  };

  const handleSeriesSuggestionClick = (value: string) => {
    setSeriesValue(value);
    setShowSeriesSuggestions(false);
    setHighlightedSeriesIndex(-1);
  };

  const handleSeriesKeyDown = (e: React.KeyboardEvent) => {
    if (!showSeriesSuggestions || seriesSuggestions.length === 0) {
      if (e.key === 'Enter') { e.preventDefault(); saveSeries(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEditingSeries(); }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedSeriesIndex((prev: number) => prev < seriesSuggestions.length - 1 ? prev + 1 : prev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedSeriesIndex((prev: number) => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedSeriesIndex >= 0 && highlightedSeriesIndex < seriesSuggestions.length) {
        handleSeriesSuggestionClick(seriesSuggestions[highlightedSeriesIndex]);
      } else {
        saveSeries();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showSeriesSuggestions) {
        setShowSeriesSuggestions(false);
      } else {
        cancelEditingSeries();
      }
    }
  };

  const saveSeries = async () => {
    if (!currentBook?.id) return;
    
    const newSeries = seriesValue || null;
    const seriesNum = seriesNumberValue ? parseFloat(seriesNumberValue) : null;
    
    setLocalBookData((prev: any) => ({ 
      ...prev, 
      series: newSeries,
      seriesNumber: seriesNum
    }));
    setEditingSeries(false);
    
    try {
      // Send full book data to avoid NOT NULL constraint issues
      await bookService.updateBook(currentBook.id, { 
        ...currentBook,
        series: newSeries,
        seriesNumber: seriesNum
      });
      if (onBookUpdated) {
        onBookUpdated({ ...currentBook, series: newSeries, seriesNumber: seriesNum });
      }
    } catch (error) {
      console.error('Error updating series:', error);
      setLocalBookData((prev: any) => ({ ...prev, series: book.series, seriesNumber: book.seriesNumber }));
    }
  };

  const cancelEditingSeries = () => {
    setEditingSeries(false);
    setSeriesValue('');
    setSeriesNumberValue('');
    setSeriesSuggestions([]);
    setShowSeriesSuggestions(false);
    setHighlightedSeriesIndex(-1);
  };

  const handleCopyRef = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!book) return;
    try {
      // Format: <Title> <subtitle> - <Author>
      const title = book.title || '';
      const subtitle = book.subtitle ? ` ${book.subtitle}` : '';
      const author = getAuthorDisplay();
      const titleLine = `${title}${subtitle} - ${author}`;
      
      // Get link: prefer openlibrary, otherwise use first available link
      let link = '';
      if (book.urls) {
        if (book.urls.openlibrary) {
          link = book.urls.openlibrary;
        } else {
          // Get first available link
          const linkKeys = Object.keys(book.urls);
          if (linkKeys.length > 0) {
            link = book.urls[linkKeys[0]];
          }
        }
      }
      
      // Combine title and link
      const textToCopy = link ? `${titleLine}\n\n${link}` : titleLine;
      
      // Copy to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Failed to copy reference:', error);
    }
  };

  const fetchNameSuggestions = async (query: string = '') => {
    try {
      const searchQuery = query ? query.trim() : '';
      const suggestions = await bookCommentService.getCommentNameSuggestions(searchQuery) as any[];

      // Extract name values from suggestions
      let names = suggestions
        .map((item: any) => {
          const nameValue = item.name || item;
          return nameValue;
        })
        .filter((name: any) => name && typeof name === 'string' && name.trim())
        .filter((name: any, index: number, self: any[]) => self.indexOf(name) === index); // Remove duplicates

      // If there's a query, prioritize starts-with matches, then contains matches
      if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        names.sort((a: any, b: any) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          const aStartsWith = aLower.startsWith(queryLower);
          const bStartsWith = bLower.startsWith(queryLower);

          // Prioritize starts-with matches
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;

          // If both start with query or neither does, sort alphabetically
          return aLower.localeCompare(bLower);
        });
      } else {
        // Sort alphabetically when showing all names
        names.sort((a: any, b: any) => a.toLowerCase().localeCompare(b.toLowerCase()));
      }

      setNameSuggestions(names);
      setShowNameSuggestions(names.length > 0);
    } catch (error) {
      console.error('Error fetching name suggestions:', error);
      setNameSuggestions([]);
      setShowNameSuggestions(false);
    }
  };

  const handleCommentInputChange = (field: string, value: string) => {
    setCommentFormData((prev: any) => ({ ...prev, [field]: value }));
    if (commentErrors[field]) {
      setCommentErrors((prev: Record<string, any>) => ({ ...prev, [field]: null }));
    }

    // Fetch name suggestions when typing in name field
    if (field === 'name') {
      fetchNameSuggestions(value);
    }
  };

  const handleNameSuggestionClick = (name: string) => {
    setCommentFormData((prev: any) => ({ ...prev, name }));
    setShowNameSuggestions(false);
    setHighlightedNameIndex(-1);
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (!showNameSuggestions || nameSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedNameIndex((prev: number) =>
        prev < nameSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedNameIndex((prev: number) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedNameIndex >= 0 && highlightedNameIndex < nameSuggestions.length) {
        handleNameSuggestionClick(nameSuggestions[highlightedNameIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowNameSuggestions(false);
      setHighlightedNameIndex(-1);
    }
  };

  const handleNameBlur = (e: React.FocusEvent) => {
    // Delay hiding suggestions to allow click events
    setTimeout(() => {
      if (!nameDropdownRef.current?.contains(document.activeElement)) {
        setShowNameSuggestions(false);
        setHighlightedNameIndex(-1);
      }
    }, 200);
  };

  const handleNameFocus = async () => {
    // Only show suggestions if there's already text in the field
    if (commentFormData.name && commentFormData.name.trim()) {
      await fetchNameSuggestions(commentFormData.name);
    }
  };

  const validateCommentForm = () => {
    const newErrors: Record<string, string> = {};
    if (!commentFormData.name || !commentFormData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!commentFormData.comment || !commentFormData.comment.trim()) {
      newErrors.comment = 'Review is required';
    }
    setCommentErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveComment = async () => {
    if (!validateCommentForm()) return;

    setLoadingComments(true);
    try {
      const commentData = {
        bookId: book.id,
        name: commentFormData.name.trim(),
        comment: commentFormData.comment.trim()
        // Date will be automatically set by the backend
      };

      if (editingComment) {
        // When editing, preserve the original date (don't send date field)
        await bookCommentService.updateComment(editingComment.id, commentData);
      } else {
        // When creating, backend will set date automatically
        await bookCommentService.createComment(commentData);
      }

      await loadComments();
      handleCloseCommentModal();
    } catch (error) {
      console.error('Error saving review:', error);
      setCommentErrors({ submit: (error as any).message || 'Failed to save review' });
    } finally {
      setLoadingComments(false);
    }
  };

  const handleEditComment = async (comment: any) => {
    setEditingComment(comment);
    setCommentFormData({
      name: comment.name,
      comment: comment.comment
      // Date is not editable, so we don't include it in formData
    });
    setShowCommentModal(true);
    setCommentErrors({});
    // Don't show suggestions by default - only when user starts typing
    setNameSuggestions([]);
    setShowNameSuggestions(false);
    setDeletingCommentId(null); // Reset delete state when opening edit modal
  };

  const handleDeleteComment = async (id: number) => {
    // If this comment is already pending deletion, confirm and delete
    if (deletingCommentId === id) {
      setLoadingComments(true);
      try {
        await bookCommentService.deleteComment(id);
        await loadComments();
        setDeletingCommentId(null);
      } catch (error) {
        console.error('Error deleting review:', error);
        alert('Failed to delete review');
        setDeletingCommentId(null);
      } finally {
        setLoadingComments(false);
      }
    } else {
      // First click: set as pending deletion
      setDeletingCommentId(id);
    }
  };

  const handleCancelDelete = () => {
    setDeletingCommentId(null);
  };

  const handleAddComment = async () => {
    setEditingComment(null);
    setCommentFormData({ 
      name: '', 
      comment: ''
      // Date will be automatically set by backend
    });
    setShowCommentModal(true);
    setCommentErrors({});
    // Don't fetch suggestions automatically - only when user starts typing
    setNameSuggestions([]);
    setShowNameSuggestions(false);
    setDeletingCommentId(null); // Reset delete state when opening modal
  };

  const handleCloseCommentModal = () => {
    setShowCommentModal(false);
    setEditingComment(null);
    setCommentFormData({ name: '', comment: '' });
    setCommentErrors({});
    setShowNameSuggestions(false);
    setHighlightedNameIndex(-1);
    setNameSuggestions([]);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete(book.id);
  };

  const getAuthorDisplay = () => {
    const bookData = currentBook || book;
    if (Array.isArray(bookData.authors)) {
      return bookData.authors.join(', ');
    }
    return bookData.authors || 'Unknown Author';
  };

  const getArtistDisplay = () => {
    const bookData = currentBook || book;
    if (Array.isArray(bookData.artists)) {
      return bookData.artists.join(', ');
    }
    return bookData.artists || null;
  };

  const getCoverImage = () => {
    const bookData = currentBook || book;
    return bookService.getImageUrl(bookData.cover);
  };

  const getCoverUrl = (coverPath: string) => {
    return bookService.getImageUrl(coverPath);
  };

  const handleBookClick = (bookId: any) => {
    if (onBookClick) {
      onBookClick(bookId);
    }
  };

  // Get book type display name
  const getBookTypeDisplayName = (bookType: string) => {
    const typeMap: Record<string, string> = {
      'book': 'book',
      'graphic-novel': 'graphic novel',
      'score': 'score'
    };
    return typeMap[bookType] || 'book';
  };

  // Get language display name
  const getLanguageDisplayName = (language: string) => {
    if (!language) return null;
    const langMap: Record<string, string> = {
      'fr': 'French',
      'en': 'English',
      'de': 'German',
      'es': 'Spanish',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'ko': 'Korean'
    };
    return langMap[language.toLowerCase()] || language.toUpperCase();
  };

  // What it is, in one murmur: publisher, year, pages, language, then its kind, which a click changes.
  const renderBookFacts = () => {
    const bookData = currentBook || book;
    const format = bookData.format || 'physical';
    const bookType = bookData.bookType || 'book';
    const facts = [
      bookData.publisher,
      bookData.publishedYear,
      bookData.pageCount ? `${bookData.pageCount} pages` : null,
      getLanguageDisplayName(bookData.language),
      format === 'ebook' ? 'e-book' : format === 'audiobook' ? 'audiobook' : null,
    ].filter(Boolean);
    const typeLabel = getBookTypeDisplayName(bookType);
    return (
      <>
        {facts.map((fact, index) => <React.Fragment key={index}>{fact} · </React.Fragment>)}
        <Select
          bare
          className="inline-book-type-select"
          value={bookType}
          onChange={(e) => handleBookTypeChange(e.target.value)}
          disabled={savingBookType}
          onClick={(e) => e.stopPropagation()}
          style={{ width: `calc(${typeLabel.length}ch + 2px)` }}
        >
          <option value="book">book</option>
          <option value="graphic-novel">graphic novel</option>
          <option value="score">score</option>
        </Select>
      </>
    );
  };

  const asList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter(Boolean) : value ? String(value).split(/,\s*/) : [];
  const authorList = asList((currentBook || book).authors);
  const artistList = asList((currentBook || book).artists);
  const allLinks = Object.entries(book.urls || {}).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const mainLinks = allLinks.filter(([key]) => !isSecondaryLink(key));
  // The others of the series, this one besides when the list leaves it out.
  const seriesOwned = seriesMembers.length + (seriesMembers.some(member => member.id === book.id) ? 0 : 1);
  const hasEbook = Boolean(book?.ebookFile && String(book.ebookFile).trim());
  const downloadEbook = async () => {
    try {
      await bookService.downloadEbook(book.id);
    } catch (error) {
      console.error('Error downloading ebook:', error);
      toast('Could not download the e-book: ' + (error as any).message, { tone: 'danger' });
    }
  };

  // Legacy function for compatibility - returns string only
  const formatBookMetadata = () => {
    const bookData = currentBook || book;
    const pages = bookData.pageCount || null;
    const langName = getLanguageDisplayName(bookData.language);
    const bookType = getBookTypeDisplayName(bookData.bookType || 'book');
    const format = bookData.format || 'physical';
    const isNonPhysical = format === 'ebook' || format === 'audiobook';
    
    let sentence = '';
    if (pages) {
      sentence = `${pages}-page `;
    }
    if (langName) {
      sentence += `${langName} `;
    }
    sentence += bookType;
    
    if (isNonPhysical) {
      sentence += ` (${format === 'ebook' ? 'e-book' : 'audiobook'})`;
    }
    
    return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : '';
  };

  const handleSearch = (searchType: string, value: string) => {
    if (onSearch) {
      let predicate = '';
      if (searchType === 'author') {
        predicate = `author:"${value}"`;
      } else if (searchType === 'artist') {
        predicate = `artist:"${value}"`;
      } else if (searchType === 'genre') {
        predicate = `genre:"${value}"`;
      } else if (searchType === 'series') {
        predicate = `series:"${value}"`;
      } else if (searchType === 'owner') {
        predicate = `owner:"${value}"`;
      } else {
        predicate = value;
      }
      onSearch(predicate);
      onClose();
    }
  };

  const handleCoverClick = (coverUrl: string | null, coverType: string = 'Cover') => {
    if (coverUrl) {
      setCoverModalData({
        coverUrl: coverUrl,
        title: book.title,
        author: getAuthorDisplay(),
        coverType: coverType
      });
      setShowCoverModal(true);
    }
  };

  const handleCloseCoverModal = () => {
    setShowCoverModal(false);
  };

  // Volume selection functions
  const loadVolumes = async () => {
    if (!book?.series) return;
    
    setLoadingVolumes(true);
    setVolumeError('');
    setSelectedVolumes(new Set());
    
    try {
      const language = book?.language || 'any';
      const normalizedLanguage = language === 'fre' || language === 'fra' ? 'fr' :
                                 language === 'eng' ? 'en' :
                                 language === 'ger' ? 'de' :
                                 language === 'spa' ? 'es' :
                                 language === 'ita' ? 'it' :
                                 language;
      
      const [results, existing] = await Promise.all([
        bookService.searchSeriesVolumes(book.series, { maxVolumes: 50, language: normalizedLanguage }) as Promise<any[]>,
        bookService.getBooksBySeries(book.series).catch(() => []) as Promise<any[]>
      ]);

      const existingMap = new Map();
      (existing as any[]).forEach((b: any) => {
        if (b.seriesNumber != null) {
          existingMap.set(b.seriesNumber, b);
        }
      });
      setExistingBooks(existingMap);

      setVolumes(results as any[]);

      if (book && book.seriesNumber) {
        const nextVolumeNumber = book.seriesNumber + 1;
        const toSelect = (results as any[])
          .filter((v: any) => {
            if (v.seriesNumber < nextVolumeNumber) return false;
            const existingBook = existingMap.get(v.seriesNumber);
            return !existingBook || existingBook.titleStatus === 'borrowed';
          })
          .map((v: any) => v.seriesNumber);
        setSelectedVolumes(new Set(toSelect));
      }
    } catch (err: any) {
      setVolumeError('Failed to load volumes: ' + err.message);
    } finally {
      setLoadingVolumes(false);
    }
  };

  const toggleVolume = (seriesNumber: any) => {
    const existingBook = existingBooks.get(seriesNumber);
    if (existingBook && existingBook.titleStatus !== 'borrowed') {
      return;
    }
    
    const newSelected = new Set(selectedVolumes);
    if (newSelected.has(seriesNumber)) {
      newSelected.delete(seriesNumber);
    } else {
      newSelected.add(seriesNumber);
    }
    setSelectedVolumes(newSelected);
  };

  const selectAllVolumes = () => {
    const allNumbers = volumes
      .filter((v: any) => {
        const existingBook = existingBooks.get(v.seriesNumber);
        return !existingBook || existingBook.borrowed;
      })
      .map((v: any) => v.seriesNumber)
      .filter((n: any) => n != null);
    setSelectedVolumes(new Set(allNumbers));
  };

  const deselectAllVolumes = () => {
    setSelectedVolumes(new Set());
  };

  const handleAddSelectedVolumes = async () => {
    if (selectedVolumes.size === 0) {
      setVolumeError('Please select at least one volume');
      return;
    }

    setEnrichingVolumes(true);
    setVolumeError('');
    
    try {
      const volumesToAdd = volumes.filter((v: any) => {
        if (!selectedVolumes.has(v.seriesNumber)) return false;
        const existingBook = existingBooks.get(v.seriesNumber);
        return !existingBook || existingBook.borrowed;
      });
      setEnrichmentProgress({ current: 0, total: volumesToAdd.length });

      // Enrich volumes in parallel with concurrency limit
      const BATCH_SIZE = 5; // Process 5 volumes at a time
      const enrichedVolumes: any[] = [];
      
      for (let i = 0; i < volumesToAdd.length; i += BATCH_SIZE) {
        const batch = volumesToAdd.slice(i, i + BATCH_SIZE);
        setEnrichmentProgress({ current: i, total: volumesToAdd.length });
        
        const batchResults = await Promise.allSettled(
          batch.map(async (volume: any) => {
            try {
              const enriched = await bookService.enrichBook(volume) as any;

              if (copyOwnerInfo && book) {
                if (book.owner !== undefined) {
                  enriched.owner = book.owner || null;
                }
                if (book.readDate) {
                  enriched.readDate = book.readDate;
                }
              }
              
              return { success: true, data: enriched };
            } catch (err) {
              console.warn(`Failed to enrich volume ${volume.seriesNumber}:`, err);
              const volumeWithOwner = { ...volume };
              if (copyOwnerInfo && book) {
                if (book.owner !== undefined) {
                  volumeWithOwner.owner = book.owner || null;
                }
                if (book.borrowed !== undefined) {
                  volumeWithOwner.borrowed = book.borrowed;
                }
                if (book.borrowedDate) {
                  volumeWithOwner.borrowedDate = book.borrowedDate;
                }
                if (book.returnedDate) {
                  volumeWithOwner.returnedDate = book.returnedDate;
                }
                if (book.borrowedNotes) {
                  volumeWithOwner.borrowedNotes = book.borrowedNotes;
                }
              }
              return { success: false, data: volumeWithOwner };
            }
          })
        );
        
        // Process batch results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            enrichedVolumes.push(result.value.data);
          } else {
            // If the promise itself was rejected, use the original volume
            const volumeIndex = enrichedVolumes.length;
            if (volumeIndex < volumesToAdd.length) {
              const volumeWithOwner = { ...volumesToAdd[volumeIndex] };
              if (copyOwnerInfo && book) {
                if (book.owner !== undefined) {
                  volumeWithOwner.owner = book.owner || null;
                }
              }
              enrichedVolumes.push(volumeWithOwner);
            }
          }
        });
        
        setEnrichmentProgress({ current: Math.min(i + BATCH_SIZE, volumesToAdd.length), total: volumesToAdd.length });
      }

      if (onAddBooksBatch) {
        if (onAddStart) onAddStart();
        try {
          await onAddBooksBatch(enrichedVolumes);
          if (onBookAdded) {
            onBookAdded(enrichedVolumes[enrichedVolumes.length - 1]);
          }
          // Return to detail view after successful import
          toDetail();
        } catch (err) {
          if (onAddError) onAddError(err);
          throw err;
        }
      }
    } catch (err: any) {
      setVolumeError('Failed to process volumes: ' + err.message);
    } finally {
      setEnrichingVolumes(false);
      setEnrichmentProgress({ current: 0, total: 0 });
    }
  };

  const getVolumeCoverImage = (volume: any) => {
    if (volume.coverUrl) return volume.coverUrl;
    if (volume.cover) return bookService.getImageUrl(volume.cover);
    return null;
  };

  const handleShowVolumes = () => {
    setView('volumes');
  };

  const handleShowEdit = () => {
    setView('edit');
  };

  const handleBackToDetail = () => {
    toDetail();
  };

  const handleEditSave = async (bookData: any) => {
    setUpdatingBook(true);
    try {
      if (onUpdateBook) {
        // Use onUpdateBook if provided (preferred for inline editing)
        await onUpdateBook(book.id, bookData);
        // Refresh the book data after successful update
        if (onBookUpdated) {
          await onBookUpdated(book.id);
        }
      } else if (onEdit && typeof onEdit === 'function') {
        // Fallback to onEdit if it accepts 2 parameters (id, data)
        if (onEdit.length === 2) {
          await onEdit(book.id, bookData);
          // Refresh the book data after successful update
          if (onBookUpdated) {
            await onBookUpdated(book.id);
          }
        }
      }
      toDetail();
    } catch (error) {
      console.error('Error saving book:', error);
      // Don't close the edit view on error - let user fix and retry
      throw error; // Re-throw so BookForm can handle it
    } finally {
      setUpdatingBook(false);
    }
  };

  const handleEditCancel = () => {
    toDetail();
  };

  const handleClose = () => {
    setConfirmDelete(false);
    onClose();
  };

  React.useEffect(() => {
    if (!confirmDelete) return;
    const handleDocClick = (e: MouseEvent) => {
      if (deleteBtnRef.current && !deleteBtnRef.current.contains(e.target as Node)) {
        setConfirmDelete(false);
      }
    };
    document.addEventListener('click', handleDocClick, true);
    return () => document.removeEventListener('click', handleDocClick, true);
  }, [confirmDelete]);

  return (
    <>
      <Dialog
        variant="panel"
        onClose={() => {
          // Check if a dropdown is open before closing
          const openDropdown = document.querySelector('.dropdown-menu.show');
          if (openDropdown) {
            // Don't close the modal if a dropdown is open
            return;
          }
          handleClose();
        }}
        zIndex={only ? 12000 : 10100}
        backdropClassName={only ? 'over-player-backdrop' : undefined}
        className="book-detail-modal"
        modalProps={{ restoreFocus: false, autoFocus: false, enforceFocus: false }}
        onBack={view === 'volumes' || view === 'edit' ? handleBackToDetail : undefined}
        icon={view === 'edit' ? <BsPencil /> : <BsBook />}
        title={view === 'volumes' ? `Select Volumes: ${book.series}`
          : view === 'edit' ? `Edit Book: ${book.title}`
          : `${book.title}${book.subtitle ? ` – ${book.subtitle}` : ''}`}
        aside={view !== 'volumes' && view !== 'edit' ? (
          <IconButton label="Copy reference" size="sm" className="book-copy-ref-icon" onClick={handleCopyRef}><BsFiles /></IconButton>
        ) : undefined}
        steps={{ onPrevious: steps.onPrevious, onNext: steps.onNext, noun: 'book' }}
      >

        <Dialog.Body className="book-detail-modal-body">
          {enrichingVolumes && (
            <div className="enrichment-overlay">
              <div className="enrichment-loading-indicator">
                <Spinner size="lg" className="mb-3" />
                <div className="text-center">
                  <strong>Enriching volumes...</strong>
                  <div className="mt-2">
                    {enrichmentProgress.current} / {enrichmentProgress.total}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className={`book-detail-slider ${
            view === 'edit' ? 'slided-right' : 
            view === 'volumes' ? 'slided-left' : 
            ''
          }`}>
            {/* Detail View */}
            <div ref={detailViewRef} className={`book-detail-view ${view === 'detail' ? 'active' : ''}`}>
          {/* The head, with no frame of its own (the panel is one): the cover; beside it who wrote it, what
              it is and its series; under them the stars and whose it is, then the links; the rest in one fold. */}
          <div className="book-head">
            <div className="book-cover-container cover-host" ref={coverRef}>
              <div style={{ position: 'relative', overflow: 'visible', borderRadius: '4px' }}>
                {(currentBook.borrowed || currentBook.titleStatus === 'borrowed' || currentBook.titleStatus === 'wish') && (
                  <CoverTagStack className="book-cover-tags">
                    {currentBook.borrowed && <CoverTag variant="alert">Read &amp; Gone</CoverTag>}
                    {currentBook.titleStatus === 'borrowed' && !currentBook.borrowed && <CoverTag variant="alert">Borrowed</CoverTag>}
                    {currentBook.titleStatus === 'wish' && <CoverTag variant="on">Wishlist</CoverTag>}
                  </CoverTagStack>
                )}
                {getCoverImage() ? (
                  <img 
                    key={`book-cover-${currentBook.id}-${currentBook.cover || 'no-cover'}`}
                    src={getCoverImage() || undefined}
                    alt={`${currentBook.title} cover`}
                    className="book-cover-image book-cover-clickable"
                    onClick={() => handleCoverClick(getCoverImage(), 'Front Cover')}
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                      const target = e.target as HTMLElement;
                      target.style.display = 'none';
                      if (target.nextSibling) {
                        (target.nextSibling as HTMLElement).style.display = 'flex';
                      }
                    }}
                  />
                ) : null}
                {/* Change Cover Button */}
                <CoverButton
                  className="cover-change-btn"
                  onClick={handleCoverChangeClick}
                  label="Change cover"
                >
                  <BsCamera size={14} />
                </CoverButton>
              </div>
              {(currentBook as any).backCover && (
                <button type="button" className="book-back-cover" title="Its back"
                  onClick={() => handleCoverClick(bookService.getImageUrl((currentBook as any).backCover), 'Back Cover')}>
                  <img src={bookService.getImageUrl((currentBook as any).backCover) || undefined} alt={`${currentBook.title} back`} />
                  <span>Back</span>
                </button>
              )}
              {!getCoverImage() && (
                <div 
                  className="book-cover-placeholder cover-host"
                  style={{ display: 'flex', position: 'relative' }}
                >
                  <BsBook size={64} />
                  <CoverButton
                    className="cover-change-btn"
                    onClick={handleCoverChangeClick}
                    label="Add cover"
                  >
                    <BsCamera size={14} />
                  </CoverButton>
                </div>
              )}
            </div>

            <div className="book-head-who">
              <div className="book-head-author">
                {authorList.map((author: string, index: number) => (
                  <React.Fragment key={author}>
                    {index > 0 && ', '}
                    <button type="button" className="book-head-filter" onClick={() => handleSearch('author', author)}>{author}</button>
                  </React.Fragment>
                ))}
                {artistList.length > 0 && (
                  <span className="book-head-muted book-head-artist">
                    {' · '}{currentBook.bookType === 'graphic-novel' ? 'drawn by' : 'illustrated by'}{' '}
                    {artistList.map((artist: string, index: number) => (
                      <React.Fragment key={artist}>
                        {index > 0 && ', '}
                        <button type="button" className="book-head-filter" onClick={() => handleSearch('artist', artist)}>{artist}</button>
                      </React.Fragment>
                    ))}
                  </span>
                )}
              </div>
              <div className="book-head-facts-line">{renderBookFacts()}</div>
              {/* The series: a shelf to jump to, gold; ✎ to change it. None: a quiet word to put it in one. */}
              <div className="book-head-series">
                {editingSeries ? (
                  <div className="inline-edit-field series-edit">
                    <div style={{ position: 'relative', flex: 1 }}>
                      <TextField size="sm"
                        ref={seriesInputRef}
                        type="text"
                        value={seriesValue}
                        onChange={(e) => handleSeriesChange(e.target.value)}
                        onKeyDown={handleSeriesKeyDown}
                        onBlur={() => setTimeout(() => setShowSeriesSuggestions(false), 150)}
                        placeholder="Series name..."
                        autoFocus
                        autoComplete="off"
                        className="series-name-input"
                      />
                      {showSeriesSuggestions && seriesSuggestions.length > 0 && (
                        <div className="inline-suggestions-dropdown">
                          {seriesSuggestions.map((name, index) => (
                            <div
                              key={index}
                              className={`suggestion-item ${highlightedSeriesIndex === index ? 'highlighted' : ''}`}
                              onClick={() => handleSeriesSuggestionClick(name)}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setHighlightedSeriesIndex(index)}
                            >
                              {name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="series-number-label">#</span>
                    <TextField size="sm"
                      type="number"
                      value={seriesNumberValue}
                      onChange={(e) => setSeriesNumberValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveSeries(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelEditingSeries(); }
                      }}
                      placeholder="1"
                      step="0.5"
                      min="0"
                      className="series-number-input"
                    />
                    <div className="inline-edit-actions">
                      <IconButton label="Save" tone="confirm" size="sm" className="save-btn" onClick={saveSeries}><BsCheck /></IconButton>
                      <IconButton label="Cancel" size="sm" className="cancel-btn" onClick={cancelEditingSeries}><BsX /></IconButton>
                    </div>
                  </div>
                ) : currentBook.series ? (
                  <>
                    <Chip tone="gold" className="book-head-series-chip" onClick={() => handleSearch('series', currentBook.series)}
                      count={currentBook.seriesNumber ? `#${currentBook.seriesNumber}` : undefined}>
                      {currentBook.series}
                    </Chip>
                    <IconButton label="Edit series" size="sm" className="inline-edit-btn"
                      onClick={(e) => { e.stopPropagation(); startEditingSeries(); }}
                    ><BsPencil size={12} /></IconButton>
                  </>
                ) : (
                  <button type="button" className="book-head-link book-head-quiet" onClick={(e) => { e.stopPropagation(); startEditingSeries(); }}>
                    Put it in a series…
                  </button>
                )}
              </div>
            </div>

            <div className="book-head-rest">
              {/* The owner's stars and whose book it is: one line. */}
              <div className="book-head-rating">
                <BookStarRating value={currentBook.rating} onChange={stars => handleRatingChange(stars || null)} />
                <span className="book-head-owner">
                  {editingOwner ? (
                    <div className="inline-edit-field">
                      <div className="input-with-dropdown">
                        <TextField size="sm"
                          ref={ownerInputRef}
                          type="text"
                          value={ownerValue}
                          onChange={(e) => handleOwnerChange(e.target.value)}
                          onKeyDown={handleOwnerKeyDown}
                          onBlur={() => setTimeout(() => setShowOwnerSuggestions(false), 150)}
                          placeholder="Enter owner name"
                          autoFocus
                          autoComplete="off"
                        />
                        {showOwnerSuggestions && ownerSuggestions.length > 0 && (
                          <div className="inline-suggestions-dropdown">
                            {ownerSuggestions.map((name, index) => (
                              <div
                                key={index}
                                className={`suggestion-item ${highlightedOwnerIndex === index ? 'highlighted' : ''}`}
                                onClick={() => handleOwnerSuggestionClick(name)}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setHighlightedOwnerIndex(index)}
                              >
                                {name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="inline-edit-actions">
                        <IconButton label="Save" tone="confirm" size="sm" className="save-btn" onClick={saveOwner}><BsCheck /></IconButton>
                        <IconButton label="Cancel" size="sm" className="cancel-btn" onClick={cancelEditingOwner}><BsX /></IconButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      {currentBook.owner ? (
                        <span className="book-head-cut">
                          Belongs to{' '}
                          <button type="button" className="book-head-filter book-head-owner-name" onClick={() => handleSearch('owner', currentBook.owner)}>{currentBook.owner}</button>
                        </span>
                      ) : (
                        <span className="book-head-cut">Whose is it?</span>
                      )}
                      <IconButton label="Edit owner" size="sm" className="inline-edit-btn"
                        onClick={(e) => { e.stopPropagation(); startEditingOwner(); }}
                      ><BsPencil size={12} /></IconButton>
                    </>
                  )}
                </span>
              </div>

              {/* When it was read, every time, and read again from here. */}
              {(book.readDate || (book.titleStatus !== 'wish' && book.bookType !== 'score')) && (
                <div className="book-head-read">
                  {book.readDate && <span className="book-head-muted">Read</span>}
                  {book.readDate && (readDates.length ? readDates : [book.readDate])
                    .map(date => new Date(date).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })).join(', ')}
                  {rereading === null ? (
                    <Button variant="quiet" size="sm" className="book-read-again" onClick={() => setRereading(new Date().toLocaleDateString('sv-SE'))}>
                      {book.readDate ? 'Read again' : 'Mark as read'}
                    </Button>
                  ) : (
                    <div className="book-read-again__form">
                      <TextField type="date" size="sm" className="book-read-again__date" value={rereading} max={new Date().toLocaleDateString('sv-SE')}
                        onChange={e => setRereading(e.target.value)} aria-label={`When you read ${book.title}`} />
                      <TextArea rows={3} value={rereadWords} autoFocus onChange={e => setRereadWords(e.target.value)}
                        placeholder={book.readDate ? 'What you thought this time (optional)…' : 'What you thought of it (optional)…'}
                        aria-label={`Your words on this reading of ${book.title}`} />
                      <div className="book-read-again__actions">
                        <Button variant="quiet" size="sm" onClick={() => { setRereading(null); setRereadWords(''); }}>Cancel</Button>
                        <Button size="sm" onClick={keepReading} disabled={!rereading}>Keep it</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(mainLinks.length > 0 || hasEbook) && (
                <div className="book-head-links">
                  {hasEbook && (
                    <button type="button" className="book-head-link" onClick={downloadEbook}>
                      <BsDownload aria-hidden="true" /> E-book
                    </button>
                  )}
                  {mainLinks.map(([key, url]) => (
                    <a key={key} className="book-head-link" href={url} target="_blank" rel="noopener noreferrer">
                      {linkName(key)}
                      <BsBoxArrowUpRight aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* What is rarely wanted, in one fold: the ISBN, the genres, the links, the file, the loan. */}
            <div className="book-head-more">
              <button
                type="button"
                className="book-head-link book-head-toggle"
                aria-expanded={showMore}
                aria-controls={`book-more-${currentBook.id}`}
                onClick={() => setShowMore(open => !open)}
              >
                <BsChevronRight aria-hidden="true" className={showMore ? 'book-head-chevron-open' : undefined} />
                ISBN, links and more
              </button>
              {showMore && (
                <dl className="book-head-facts" id={`book-more-${currentBook.id}`}>
                  {(book.isbn || book.isbn13) && (
                    <BookField label="ISBN">
                      <code className="book-head-code">{[book.isbn, book.isbn13].filter(Boolean).map(formatIsbnDisplay).join(' · ')}</code>
                    </BookField>
                  )}
                  {book.publisher && <BookField label="Publisher">{book.publisher}{book.publishedYear ? `, ${book.publishedYear}` : ''}</BookField>}
                  {book.genres && Array.isArray(book.genres) && book.genres.length > 0 && (
                    <BookField label="Genres">
                      {Array.from(new Set<string>(book.genres)).map((genre: string, index: number) => (
                        <React.Fragment key={genre}>
                          {index > 0 && ' · '}
                          <button type="button" className="book-head-filter" onClick={() => handleSearch('genre', genre)}>{genre}</button>
                        </React.Fragment>
                      ))}
                    </BookField>
                  )}
                  {book.tags && Array.isArray(book.tags) && book.tags.length > 0 && <BookField label="Tags">{book.tags.join(' · ')}</BookField>}
                  {allLinks.length > 0 && (
                    <BookField label="Links">
                      <span className="book-head-links-all">
                        {allLinks.map(([key, url]) => (
                          <a key={key} className="book-head-link" href={url} target="_blank" rel="noopener noreferrer">
                            {linkName(key)}
                            <BsBoxArrowUpRight aria-hidden="true" />
                          </a>
                        ))}
                      </span>
                    </BookField>
                  )}
                  {book.filetype && <BookField label="File type">{book.filetype}</BookField>}
                  {book.drm && <BookField label="DRM">{book.drm}</BookField>}
                  {book.narrator && <BookField label="Narrator">{book.narrator}</BookField>}
                  {book.runtime && <BookField label="Runtime">{Math.floor(book.runtime / 60)} h {book.runtime % 60} min</BookField>}
                  {hasEbook && (
                    <BookField label="E-book">
                      {loadingEbookInfo ? (
                        <div className="d-flex align-items-center gap-2">
                          <Spinner size="sm" />
                          <span>Loading ebook info...</span>
                        </div>
                      ) : ebookInfo ? (
                        <div>
                          <div className="d-flex align-items-center gap-2 mb-2">
                            <BsFileEarmark className="me-2" />
                            <div className="flex-grow-1">
                              <div><strong>{ebookInfo.originalName}</strong></div>
                              <small className="ebook-info-meta">
                                Format: {ebookInfo.format} • Size: {ebookInfo.sizeFormatted}
                              </small>
                            </div>
                            <Button icon={<BsDownload />}
                              size="sm"
                              onClick={async () => {
                                try {
                                  await bookService.downloadEbook(book.id);
                                } catch (error) {
                                  console.error('Error downloading ebook:', error);
                                  alert('Failed to download ebook: ' + (error as any).message);
                                }
                              }}
                            >
                              Download
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="d-flex align-items-center gap-2">
                          <BsFileEarmark className="me-2" />
                          <span>{book.ebookFile.split('_').slice(3).join('_') || book.ebookFile}</span>
                          <Button icon={<BsDownload />}
                            size="sm"
                            onClick={async () => {
                              try {
                                await bookService.downloadEbook(book.id);
                              } catch (error) {
                                console.error('Error downloading ebook:', error);
                                alert('Failed to download ebook: ' + (error as any).message);
                              }
                            }} className="ms-2"
                          >
                            Download
                          </Button>
                        </div>
                      )}
                    </BookField>
                  )}
                  {book.borrowed && (book.borrowedDate || book.returnedDate || book.borrowedNotes) && (
                    <BookField label="Lent">
                      {[book.borrowedDate && `on ${book.borrowedDate}`, book.returnedDate && `back ${book.returnedDate}`].filter(Boolean).join(' · ')}
                      {book.borrowedNotes && <span className="book-head-note">{book.borrowedNotes}</span>}
                    </BookField>
                  )}
                  {book.annotation && <BookField label="Notes"><span className="book-head-annotation">{book.annotation}</span></BookField>}
                </dl>
              )}
            </div>

            {showCoverSelector && (
              <div className="book-head-cover-selector">
                <InlineCoverSelector
                  book={currentBook}
                  isOpen={showCoverSelector}
                  onCoverSelected={handleCoverSelected}
                  onBackSelected={backCover => {
                    setLocalBookData((prev: any) => ({ ...prev, backCover }));
                    onBookUpdated?.({ ...currentBook, backCover } as any);
                  }}
                  currentCover={currentBook.cover}
                  onClose={() => setShowCoverSelector(false)}
                />
              </div>
            )}
          </div>

          {/* The series right under the head: from one volume, the others are where one goes. */}
          {book.series && seriesMembers.length > 0 && (
            <section className="book-part">
              <h3 className="book-part-title">
                In the series <span className="book-part-count">{seriesOwned} owned</span>
              </h3>
              <div className="series-books-horizontal">
                {seriesMembers.map((member) => (
                  <SeriesBookItem
                    key={member.id}
                    bookItem={member}
                    onBookClick={handleBookClick}
                    getCoverUrl={getCoverUrl}
                    currentBookId={book.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* The description: the text alone, a few lines, the rest on a click. */}
          {currentBook.description && (
            <section className="book-part book-description">
              <p className="description-text">{getDisplayDescription()}</p>
              {isDescriptionLong && (
                <button type="button" className="book-head-link book-head-quiet" onClick={() => setDescriptionExpanded(!descriptionExpanded)}>
                  {descriptionExpanded ? 'Show less' : 'Read more…'}
                </button>
              )}
            </section>
          )}

          {/* The reviews: a title with their count, each under a hairline; none is no message, a word to write one. */}
          <section className="book-part comments-section">
            {(comments.length > 0 || showCommentModal) && (
              <h3 className="book-part-title">
                Reviews {comments.length > 0 && <span className="book-part-count">{comments.length}</span>}
              </h3>
            )}
            {showCommentModal && (
              <div className="comment-form-inline mb-3 p-3" style={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {commentErrors.submit && (
                  <Notice tone="danger" className="mb-3">{commentErrors.submit}</Notice>
                )}
                <Form>
                  <Form.Group className="mb-3" style={{ position: 'relative', zIndex: 1000 }}>
                    <Form.Label>Name <span className="text-danger">*</span></Form.Label>
                    <TextField
                      ref={nameInputRef}
                      type="text"
                      value={commentFormData.name}
                      onChange={(e) => handleCommentInputChange('name', e.target.value)}
                      onKeyDown={handleNameKeyDown}
                      onBlur={handleNameBlur}
                      onFocus={handleNameFocus}
                      placeholder="Enter your name"
                      isInvalid={!!commentErrors.name}
                      autoComplete="off"
                    />
                    {commentErrors.name && (
                      <FieldError>{commentErrors.name}</FieldError>
                    )}
                    {showNameSuggestions && nameSuggestions.length > 0 && (
                      <div
                        ref={nameDropdownRef}
                        className="autocomplete-dropdown"
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          zIndex: 1001,
                          backgroundColor: '#212529',
                          border: '1px solid #495057',
                          borderRadius: '0.25rem',
                          marginTop: '0.25rem',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                        }}
                      >
                        {nameSuggestions.map((name, index) => (
                          <div
                            key={index}
                            onClick={() => handleNameSuggestionClick(name)}
                            onMouseDown={(e) => e.preventDefault()}
                            style={{
                              padding: '0.5rem 0.75rem',
                              cursor: 'pointer',
                              backgroundColor: highlightedNameIndex === index ? '#495057' : 'transparent',
                              color: '#f8f9fa'
                            }}
                            onMouseEnter={() => setHighlightedNameIndex(index)}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    )}
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Review <span className="text-danger">*</span></Form.Label>
                    <TextArea
                      rows={6}
                      value={commentFormData.comment}
                      onChange={(e) => handleCommentInputChange('comment', e.target.value)}
                      placeholder="Enter your review here..."
                      isInvalid={!!commentErrors.comment}
                      style={{ 
                        overflowY: 'auto',
                        resize: 'vertical',
                        minHeight: '120px',
                        maxHeight: '400px'
                      }}
                    />
                    {commentErrors.comment && (
                      <FieldError>{commentErrors.comment}</FieldError>
                    )}
                  </Form.Group>
                  <div className="d-flex justify-content-end gap-2">
                    <Button variant="quiet" size="sm" onClick={handleCloseCommentModal} disabled={loadingComments}>
                      Cancel
                    </Button>
                    <Button variant="primary" 
                      size="sm"
                      onClick={handleSaveComment}
                      disabled={loadingComments}
                    >
                      {loadingComments ? 'Saving...' : (editingComment ? 'Update' : 'Save')}
                    </Button>
                  </div>
                </Form>
              </div>
            )}
            {!showCommentModal && (
              <>
                {loadingComments ? (
                  <p className="book-head-muted">Loading reviews…</p>
                ) : comments.length > 0 && (
                  <div className="comments-list">
                                              {comments.map((comment) => (
                                                <div key={comment.id} className="comment-item mb-3">
                                                  <div className="d-flex justify-content-between align-items-start mb-1">
                                                    <div>
                                                      <strong className="comment-name">{comment.name}</strong>
                                                      {comment.date && (
                                                        <span className="comment-date ms-2 text-muted">
                                                          {formatDate(comment.date)}
                                                        </span>
                                                      )}
                                                    </div>
                                                    <div className="comment-actions">
                                                      {deletingCommentId === comment.id ? (
                                                        <>
                                                          <Button variant="danger" 
                                                            size="sm" className="me-2"
                                                            onClick={() => handleDeleteComment(comment.id)}
                                                            title="Confirm deletion"
                                                          >
                                                            Confirm deletion
                                                          </Button>
                                                          <Button variant="quiet"
                                                            size="sm"
                                                            onClick={() => setDeletingCommentId(null)}
                                                            title="Cancel"
                                                          >
                                                            Cancel
                                                          </Button>
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Button variant="quiet"
                                                            size="sm" className="me-2"
                                                            onClick={() => handleEditComment(comment)}
                                                            title="Edit review"
                                                          >
                                                            Edit
                                                          </Button>
                                                          <Button variant="danger"
                                                            size="sm"
                                                            onClick={() => handleDeleteComment(comment.id)}
                                                            title="Delete review"
                                                          >
                                                            Delete
                                                          </Button>
                                                        </>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <p className="comment-text mb-0">{comment.comment}</p>
                                                </div>
                                              ))}
                                            </div>
                )}
                <button type="button" className="book-head-link book-head-quiet" onClick={handleAddComment}>
                  Write a review…
                </button>
              </>
            )}
          </section>
            </div>

            {/* Volumes View */}
            <div className={`book-volumes-view ${view === 'volumes' ? 'active' : ''}`}>

              {loadingVolumes && (
                <Loading>Searching for volumes…</Loading>
              )}

              {volumeError && (
                <Notice tone="danger" className="mb-3">
                  {volumeError}
                </Notice>
              )}

              {!loadingVolumes && volumes.length === 0 && !volumeError && (
                <Notice tone="info" className="mb-3">
                  No volumes found for this series. You can still add volumes manually.
                </Notice>
              )}

              {!loadingVolumes && volumes.length > 0 && (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-3 volume-selector-header">
                    <div>
                      <strong>{volumes.length} volume{volumes.length !== 1 ? 's' : ''} found</strong>
                      {selectedVolumes.size > 0 && (
                        <span className="ms-2 text-warning">
                          ({selectedVolumes.size} selected)
                        </span>
                      )}
                    </div>
                    <div>
                      <Button size="sm" onClick={selectAllVolumes} className="me-2">
                        Select All
                      </Button>
                      <Button size="sm" onClick={deselectAllVolumes}>
                        Deselect All
                      </Button>
                    </div>
                  </div>

                  {book && (
                    <div className="mb-3">
                      <Form.Check
                        type="checkbox"
                        label={book.owner 
                          ? `Copy owner information from template book (${book.owner})`
                          : 'Copy owner information from template book'}
                        checked={copyOwnerInfo}
                        onChange={(e) => setCopyOwnerInfo(e.target.checked)}
                        disabled={enrichingVolumes}
                      />
                    </div>
                  )}

                  <div className="volumes-grid-container">
                    <div className="volumes-grid">
                      {volumes.map((volume) => {
                        const isSelected = selectedVolumes.has(volume.seriesNumber);
                        const coverUrl = getVolumeCoverImage(volume);
                        const existingBook = existingBooks.get(volume.seriesNumber);
                        const isAlreadyInCollection = existingBook && existingBook.titleStatus !== 'borrowed';
                        const isBorrowed = existingBook && existingBook.titleStatus === 'borrowed';
                        const isDisabled = isAlreadyInCollection;
                        
                        return (
                          <div
                            key={volume.seriesNumber || volume.title}
                            className={`volume-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !enrichingVolumes && !isDisabled && toggleVolume(volume.seriesNumber)}
                            style={{ 
                              cursor: isDisabled ? 'not-allowed' : 'pointer',
                              opacity: isDisabled ? 0.6 : 1
                            }}
                          >
                            <div className="volume-checkbox">
                              {isSelected && <BsCheck />}
                            </div>
                            {coverUrl ? (
                              <img src={coverUrl} alt={volume.title} className="volume-cover" />
                            ) : (
                              <div className="volume-cover-placeholder">
                                <BsBook size={32} />
                              </div>
                            )}
                            <div className="volume-info">
                              <div className="volume-number">#{volume.seriesNumber}</div>
                              <div className="volume-title" title={volume.title}>
                                {volume.title || `Volume ${volume.seriesNumber}`}
                              </div>
                              {volume.authors && volume.authors.length > 0 && (
                                <div className="volume-authors">
                                  {Array.isArray(volume.authors) ? volume.authors.join(', ') : volume.authors}
                                </div>
                              )}
                              <div className="d-flex flex-wrap justify-content-center gap-1 mt-1">
                                {volume.publishedYear && (
                                  <Badge bg="secondary" className="volume-year">
                                    {volume.publishedYear}
                                  </Badge>
                                )}
                                {isAlreadyInCollection && (
                                  <Badge bg="info" className="volume-status">
                                    Already in collection
                                  </Badge>
                                )}
                                {isBorrowed && (
                                  <Badge bg="warning" text="dark" className="volume-status">
                                    Borrowed
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Edit View */}
            <div className={`book-edit-view ${view === 'edit' ? 'active' : ''}`}>
              {updatingBook && (
                <Loading>Updating book…</Loading>
              )}
              <div className="book-edit-form-container" ref={editFormRef} style={{ display: updatingBook ? 'none' : 'block' }}>
                {view === 'edit' && book && (
                  <BookForm
                    book={book}
                    onSave={handleEditSave}
                    onCancel={handleEditCancel}
                    inline={true}
                    onBookUpdated={onBookUpdated as any}
                  />
                )}
              </div>
            </div>
          </div>
        </Dialog.Body>
        
        <Dialog.Footer>
          {view === 'edit' ? (
            <>
              <Button variant="quiet" onClick={handleEditCancel} disabled={updatingBook}>
                Cancel
              </Button>
              <Button variant="primary" 
                onClick={() => {
                  // Trigger form submit - find the form inside BookForm's modal
                  const form = editFormRef.current?.querySelector('form');
                  if (form) {
                    form.requestSubmit();
                  }
                }}
                disabled={updatingBook}
              >
                {updatingBook ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Updating...
                  </>
                ) : (
                  'Update Book'
                )}
              </Button>
            </>
          ) : view === 'volumes' ? (
            <>
              <Button icon={<BsArrowLeft />} onClick={handleBackToDetail} disabled={enrichingVolumes}>
                Back
              </Button>
              <Button variant="primary"
                onClick={handleAddSelectedVolumes}
                disabled={enrichingVolumes || selectedVolumes.size === 0}
              >
                {enrichingVolumes ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    Import {selectedVolumes.size} Volume{selectedVolumes.size !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <div className="book-detail-footer-buttons d-flex justify-content-between w-100">
                <div className="book-detail-footer-left">
                  {book.series && (
                    <Button icon={<BsPlus />} onClick={handleShowVolumes} aria-label="Add next volume">
                      <span className="book-detail-long">Add next volume</span>
                      <span className="book-detail-short">Volume</span>
                    </Button>
                  )}
                </div>
                <div className="book-detail-footer-right">
                  <Button icon={<BsPencil />} onClick={handleShowEdit} aria-label="Edit">
                    <span className="book-detail-long">Edit</span>
                  </Button>
                  <Button variant="danger" active={confirmDelete} icon={<BsTrash />}
                    ref={deleteBtnRef} 
                    onClick={handleDelete} aria-label={confirmDelete ? 'Confirm Delete' : 'Delete'}
                  >
                    <span className="book-detail-long">{confirmDelete ? 'Confirm Delete' : 'Delete'}</span>
                    {confirmDelete && <span className="book-detail-short">Sure?</span>}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Dialog.Footer>
      </Dialog>
      
      <CoverModal
        isOpen={showCoverModal}
        onClose={handleCloseCoverModal}
        coverUrl={coverModalData.coverUrl}
        title={coverModalData.title}
        artist={coverModalData.author}
        coverType={coverModalData.coverType || 'Cover'}
      />
    </>
  );
};

export default BookDetailCard;

