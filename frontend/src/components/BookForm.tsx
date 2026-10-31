import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Form, Row, Col } from 'react-bootstrap';
import Dialog, { DialogHeader } from './shared/Dialog';
import { BsX, BsUpload, BsBook, BsCloudDownload, BsFileEarmark, BsTrash, BsChevronDown, BsChevronRight } from 'react-icons/bs';
import bookService from '../services/bookService';
import CoverModal from './CoverModal';
import BookCoverSlots, { type BookCoverPhotos } from './BookCoverSlots';
import './BookForm.css';
import { readStored, writeStored } from '../utils/safeStorage';
import Select from './shared/Select';
import Button from './shared/Button';
import { FieldError, TextArea, TextField } from './shared/TextField';
import Notice from './shared/Notice';
import { toneOf } from './shared/Toast';
import Spinner from './shared/Spinner';

interface MetadataSourceEntry {
  [field: string]: any;
}

interface MetadataSources {
  googleBooks?: MetadataSourceEntry;
  openLibrary?: MetadataSourceEntry;
  original?: MetadataSourceEntry;
  [key: string]: MetadataSourceEntry | undefined;
}

interface BookCover {
  url: string;
  source?: string;
  type?: string;
  language?: string;
  publisher?: string;
  year?: string | number;
  isbn?: string;
  isCurrent?: boolean;
  isCustom?: boolean;
}

interface BookData {
  id?: number | string;
  title?: string;
  subtitle?: string;
  authors?: string | string[];
  artists?: string | string[];
  isbn?: string;
  isbn13?: string;
  publisher?: string;
  publishedYear?: string | number;
  language?: string;
  format?: string;
  filetype?: string;
  drm?: string;
  narrator?: string;
  runtime?: string | number;
  series?: string;
  seriesNumber?: string | number;
  genres?: string | string[];
  tags?: string | string[];
  rating?: string | number;
  cover?: string | null;
  coverUrl?: string | null;
  owner?: string;
  readDate?: string;
  pageCount?: string | number;
  description?: string;
  urls?: Record<string, any>;
  annotation?: string;
  titleStatus?: string;
  bookType?: string;
  ebookFile?: string | null;
  availableCovers?: BookCover[];
  _metadataSources?: MetadataSources;
  [key: string]: any;
}

interface BookFormData {
  title: string;
  subtitle: string;
  authors: string[] | string;
  artists: string[] | string;
  isbn: string;
  isbn13: string;
  publisher: string;
  publishedYear: string | number;
  language: string;
  format: string;
  filetype: string;
  drm: string;
  narrator: string;
  runtime: string | number;
  series: string;
  seriesNumber: string | number;
  genres: string[] | string;
  tags: string[] | string;
  rating: string | number;
  cover: string | null;
  owner: string;
  readDate: string;
  pageCount: string | number;
  description: string;
  urls: Record<string, any>;
  annotation: string;
  titleStatus: string;
  bookType: string;
  coverUrl?: string | null;
  ebookFile?: string | null;
  [key: string]: any;
}

interface CoverModalData {
  coverUrl: string;
  title: string;
  author: string;
  coverType?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

interface MetadataSourceSelection {
  description: string;
  series: string;
}

interface AvailableSource {
  key: string;
  label: string;
  value: any;
}

interface BookFormProps {
  book?: BookData | null;
  availableBooks?: BookData[] | null;
  onSave: (bookData: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
  inline?: boolean;
  onBookUpdated?: ((id: number | string) => Promise<void>) | null;
  defaultTitleStatus?: string;
  onShowAlert?: ((message: string, variant: string) => void) | null;
  onShowOtherResults?: (() => void) | null;
  /** A new book's photographs, those it was filled from: its cover and its back once saved, others chosen in the form. */
  photos?: BookCoverPhotos | null;
  /** The cover and back chosen in the form, to keep once the book is saved. */
  onPhotosChange?: (photos: BookCoverPhotos) => void;
}


// Detect book type from ISBN and genres
const detectBookType = (isbn: string | undefined | null, genres: string[] = []): string => {
  const genreList = Array.isArray(genres) ? genres : [];
  
  // Check for music score by ISBN (ISMN starts with 9790)
  const cleanIsbn = (isbn || '').replace(/[-\s]/g, '');
  if (cleanIsbn.startsWith('9790')) {
    return 'score';
  }
  
  // Check genres for music or comics patterns
  for (const genre of genreList) {
    if (!genre || typeof genre !== 'string') continue;
    const genreLower = genre.toLowerCase();
    
    // Check for music score
    if (genreLower.includes('music /') || genreLower.startsWith('music/')) {
      return 'score';
    }
    
    // Check for graphic novel / comics
    if (
      genreLower.includes('comics & graphic novels') ||
      genreLower.includes('bandes dessinées') ||
      genreLower.includes('comic strips') ||
      genreLower.includes('manga') ||
      genreLower.includes('/manga/') ||
      genreLower.includes('graphic novel')
    ) {
      return 'graphic-novel';
    }
  }
  
  return 'book';
};

const BookForm: React.FC<BookFormProps> = ({ book = null, availableBooks = null, onSave, onCancel, inline = false, onBookUpdated = null, defaultTitleStatus, onShowAlert, onShowOtherResults = null, photos = null, onPhotosChange }) => {
  // A new book's cover and back: those it was read from, or chosen here; uploaded once it is saved.
  const [pendingPhotos, setPendingPhotos] = useState<BookCoverPhotos>(photos || {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ebookInputRef = useRef<HTMLInputElement>(null);
  const ownerInputRef = useRef<HTMLInputElement>(null);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef<number>(0);
  const [uploadingCover, setUploadingCover] = useState<boolean>(false);
  const [uploadingEbook, setUploadingEbook] = useState<boolean>(false);
  const [confirmDeleteEbook, setConfirmDeleteEbook] = useState<boolean>(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverPreviewKey, setCoverPreviewKey] = useState<number>(0);
  const [selectedCoverIndex, setSelectedCoverIndex] = useState<number>(0);
  const [selectedEditionIndex, setSelectedEditionIndex] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadMessageType, setUploadMessageType] = useState<string>('success');
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [showCoverModal, setShowCoverModal] = useState<boolean>(false);
  const [coverModalData, setCoverModalData] = useState<CoverModalData>({ coverUrl: '', title: '', author: '' });
  const [ownerSuggestions, setOwnerSuggestions] = useState<string[]>([]);
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState<boolean>(false);
  const [highlightedOwnerIndex, setHighlightedOwnerIndex] = useState<number>(-1);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({ top: 0, left: 0, width: 0 });
  const [formData, setFormData] = useState<BookFormData>({
    title: '',
    subtitle: '',
    authors: [],
    artists: [],
    isbn: '',
    isbn13: '',
    publisher: '',
    publishedYear: '',
    language: '',
    format: 'physical',
    filetype: '',
    drm: '',
    narrator: '',
    runtime: '',
    series: '',
    seriesNumber: '',
    genres: [],
    tags: [],
    rating: '',
    cover: null,
    owner: '',
    readDate: '',
    pageCount: '',
    description: '',
    urls: {},
    annotation: '',
    titleStatus: 'owned',
    bookType: 'book'
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [enriching, setEnriching] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [selectedMetadataSource, setSelectedMetadataSource] = useState<MetadataSourceSelection>({
    description: 'auto',
    series: 'auto'
  });
  // Show/hide advanced fields - remember preference in localStorage
  const [showAdvanced, setShowAdvanced] = useState(() => {
    return readStored('bookdex-show-advanced-form') === 'true';
  });
  // Track availableCovers separately to ensure React re-renders when it changes
  const [localAvailableCovers, setLocalAvailableCovers] = useState<BookCover[] | null>(null);

  // Collect all available covers from the book group and enriched sources
  const availableCovers = React.useMemo((): BookCover[] => {
    const covers: BookCover[] = [];
    let currentCoverUrl: string | null = null;
    
    // First, add the current cover (if it exists) as the very first item
    // This ensures the user's current cover is always visible and selectable
    if (book) {
      // Check for saved cover image path first (for existing books)
      if (book.cover) {
        currentCoverUrl = book.cover.startsWith('http') ? book.cover : (bookService.getImageUrl(book.cover) || book.cover);
        const isCustomCover = book.cover.includes('/custom/');
        covers.push({
          url: currentCoverUrl,
          source: isCustomCover ? 'Custom Upload' : 'Current',
          type: 'front',
          language: book.language,
          publisher: book.publisher,
          year: book.publishedYear,
          isbn: book.isbn13 || book.isbn,
          isCurrent: true,
          isCustom: isCustomCover
        });
      } 
      // If no saved cover but we have a coverUrl, add it as current
      else if (book.coverUrl) {
        currentCoverUrl = book.coverUrl;
        covers.push({
          url: currentCoverUrl,
          source: 'Current',
          type: 'front',
          language: book.language,
          publisher: book.publisher,
          year: book.publishedYear,
          isbn: book.isbn13 || book.isbn,
          isCurrent: true
        });
      }
    }
    
    // Then, use localAvailableCovers if set (from fetch operation), otherwise use book.availableCovers
    const coversToProcess = localAvailableCovers || (book && book.availableCovers) || [];
    
    // Add covers from availableCovers array (from enrichment)
    if (Array.isArray(coversToProcess) && coversToProcess.length > 0) {
      coversToProcess.forEach((cover: BookCover) => {
        // Skip if it's the same as the current cover we already added
        const coverUrl = cover.url;
        if (currentCoverUrl && coverUrl === currentCoverUrl) {
          return; // Skip duplicate of current cover
        }

        // Filter out covers that are too small (< 100px wide) if we have dimensions
        if (imageDimensions[coverUrl]) {
          const width = imageDimensions[coverUrl].width;
          if (width < 100) {
            return; // Skip this cover
          }
        }

        covers.push({
          url: coverUrl,
          source: cover.source || 'Unknown',
          type: cover.type || 'front',
          language: book?.language as string | undefined,
          publisher: book?.publisher as string | undefined,
          year: book?.publishedYear,
          isbn: (book?.isbn13 || book?.isbn) as string | undefined
        });
      });
    }
    
    // Then add covers from the book group (different editions)
    const booksToCheck = availableBooks && availableBooks.length > 0 ? availableBooks : (book ? [book] : []);
    
    booksToCheck.forEach((b: BookData) => {
      // Add availableCovers from each book in group
      if (b.availableCovers && Array.isArray(b.availableCovers)) {
        b.availableCovers.forEach((cover: BookCover) => {
          if (!covers.some((c: BookCover) => c.url === cover.url)) {
            covers.push({
              url: cover.url,
              source: cover.source || 'Unknown',
              type: cover.type || 'front',
              language: b.language,
              publisher: b.publisher,
              year: b.publishedYear,
              isbn: b.isbn13 || b.isbn
            });
          }
        });
      }
      
      // Add main coverUrl if not already in covers
      if (b.coverUrl && !covers.some((c: BookCover) => c.url === b.coverUrl)) {
        covers.push({
          url: b.coverUrl,
          source: 'Search Result',
          type: 'front',
          language: b.language,
          publisher: b.publisher,
          year: b.publishedYear,
          isbn: b.isbn13 || b.isbn
        });
      }
      
      // Also add the saved cover image path if it exists (for existing books) - but skip if already added as current
      if (b.cover && !b.coverUrl) {
        const coverUrlToAdd = b.cover.startsWith('http') ? b.cover : (bookService.getImageUrl(b.cover) || b.cover);
        if (!covers.some((c: BookCover) => c.url === coverUrlToAdd)) {
          const isCustomCover = b.cover.includes('/custom/');
          covers.push({
            url: coverUrlToAdd,
            source: isCustomCover ? 'Custom Upload' : 'Current',
            type: 'front',
            language: b.language,
            publisher: b.publisher,
            year: b.publishedYear,
            isbn: b.isbn13 || b.isbn,
            isCustom: isCustomCover
          });
        }
      }
    });
    
    // Remove duplicates by URL (but keep the first occurrence, which should be the current cover)
    const uniqueCovers = covers.filter((cover: BookCover, index: number, self: BookCover[]) =>
      index === self.findIndex((c: BookCover) => c.url === cover.url)
    );

    // Filter out covers that are too small (< 100px wide)
    // This uses imageDimensions if available, otherwise allows the cover through
    // BUT: Always keep the current cover (first one) even if it's small
    const filteredCovers = uniqueCovers.filter((cover: BookCover, index: number) => {
      // Always keep the first cover (current cover)
      if (index === 0 && cover.isCurrent) return true;
      
      const dims = imageDimensions[cover.url];
      if (!dims) return true; // Include if we haven't loaded dimensions yet
      return dims.width >= 100; // Only include if >= 100px wide
    });
    
    return filteredCovers.length > 0 ? filteredCovers : uniqueCovers;
  }, [book, availableBooks, localAvailableCovers, imageDimensions]);

  // Helper function to get available metadata sources
  const getAvailableSources = (field: string): AvailableSource[] => {
    if (!book?._metadataSources) return [];
    const sources: AvailableSource[] = [];
    if (book._metadataSources.googleBooks?.[field]) {
      sources.push({ key: 'googleBooks', label: 'Google Books', value: book._metadataSources.googleBooks[field] });
    }
    if (book._metadataSources.openLibrary?.[field]) {
      sources.push({ key: 'openLibrary', label: 'OpenLibrary', value: book._metadataSources.openLibrary[field] });
    }
    if (book._metadataSources.original?.[field]) {
      sources.push({ key: 'original', label: 'Original', value: book._metadataSources.original[field] });
    }
    return sources;
  };

  // Helper function to get current value based on selected source
  const getMetadataValue = (field: string, selectedSource: string): any => {
    if (!book?._metadataSources) {
      // Fallback to book field if no metadata sources
      return book?.[field] || '';
    }
    if (selectedSource === 'auto') {
      // Use the default merged value
      return book[field] || '';
    }
    return book._metadataSources[selectedSource]?.[field] || '';
  };

  // Track the previous book ID to only reset metadata source when book actually changes
  const prevBookIdRef = useRef<string | number | null>(null);
  const userSelectedSourceRef = useRef<boolean>(false); // Track if user has manually selected a source
  const isEnrichingRef = useRef<boolean>(false); // Track if we're currently enriching to prevent useEffect from resetting formData
  const userSelectedCoverRef = useRef<boolean>(false); // Track if user has manually selected a cover
  const userSelectedBookTypeRef = useRef<boolean>(false); // Track if user has manually selected a bookType
  
  useEffect(() => {
    if (book) {
      // Skip initialization if we're currently enriching (let handleFetchFromSources handle the update)
      if (isEnrichingRef.current) {
        return;
      }
      
      // Check if this is a different book (by ID) - only reset metadata source on book change
      const currentBookId: string | number | null = book.id || book.isbn || book.isbn13 || book.title || null;
      const isNewBook = prevBookIdRef.current !== null && prevBookIdRef.current !== currentBookId;
      
      // CRITICAL: If user has manually selected bookType and it's NOT a new book,
      // skip the entire formData update to avoid any chance of resetting their selection
      // Only do this check if it's the same book (not a new one)
      if (userSelectedBookTypeRef.current && !isNewBook && prevBookIdRef.current !== null) {
        console.log('[BookForm] useEffect: User has selected bookType for same book - skipping formData update entirely');
        // Still update the ref to track the current book
        prevBookIdRef.current = currentBookId;
        return; // Exit early - don't update formData at all
      }
      
      // If it's a new book, reset the user selection flags and local available covers
      if (isNewBook) {
        userSelectedSourceRef.current = false;
        userSelectedCoverRef.current = false; // Reset cover selection flag when switching books
        userSelectedBookTypeRef.current = false; // Reset bookType selection flag when switching books
        setLocalAvailableCovers(null); // Reset local covers when switching books
      }
      
      // Check if enriched data is available
      const hasEnrichedData = book._metadataSources && (
        book._metadataSources.googleBooks || book._metadataSources.openLibrary
      );
      
      // Only reset metadata source if this is a new book with enriched data AND user hasn't selected a source
      // For the first book load, initialize to 'auto'
      if ((isNewBook || prevBookIdRef.current === null) && hasEnrichedData && !userSelectedSourceRef.current) {
        setSelectedMetadataSource({
          description: 'auto',
          series: 'auto'
        });
      }
      
      // Update the ref to track the current book
      prevBookIdRef.current = currentBookId;
      
      // Get description based on selected source (default to 'auto' if not set yet)
      const descriptionSource = selectedMetadataSource.description || 'auto';
      const initialDescription = getMetadataValue('description', descriptionSource);
      
      // CRITICAL: Preserve the original title from user input or book data
      // If the book has _metadataSources, check if there's an original title that's longer/more complete
      let suggestedTitle = book.title || '';
      
      // If we have metadata sources, prefer the original title if it's more complete
      if (book._metadataSources?.original?.title) {
        const originalTitle = book._metadataSources.original.title;
        const currentTitle = book.title || '';
        // If original title is longer and more complete (>= 10 chars), use it
        if (originalTitle.trim().length >= 10 && originalTitle.trim().length > currentTitle.trim().length) {
          suggestedTitle = originalTitle;
          console.log('[BookForm] Using original title from metadata:', originalTitle);
        }
      }
      
      // If this is a new book (no ID) with a series number, try to update the title
      if (!book.id && book.seriesNumber && suggestedTitle) {
        // Try to find and replace volume numbers in the title
        // Patterns: T01, T1, Vol. 1, Volume 1, #1, etc.
        const volumePatterns = [
          { regex: /\bT0*(\d+)\b/i, type: 'T' },  // T01, T1, T02, etc.
          { regex: /\bVol\.?\s*0*(\d+)\b/i, type: 'Vol' },  // Vol. 1, Vol 1, etc.
          { regex: /\bVolume\s*0*(\d+)\b/i, type: 'Volume' },  // Volume 1, etc.
          { regex: /\b#0*(\d+)\b/i, type: '#' },  // #1, #01, etc.
          { regex: /\b(\d+)\s*$/i, type: 'trailing' }  // Trailing number like "Book 1"
        ];
        
        for (const patternObj of volumePatterns) {
          const match = book.title!.match(patternObj.regex);
          if (match) {
            const oldNumber = match[1] || match[0];
            const newNumber = String(book.seriesNumber).padStart(oldNumber.length, '0');
            suggestedTitle = book.title!.replace(patternObj.regex, (m: string) => {
              // Preserve the format (T, Vol., etc.) but update the number
              return m.replace(/\d+/, newNumber);
            });
            break;
          }
        }
        
        // If no pattern matched but we have a series number, append it
        if (suggestedTitle === book.title && book.seriesNumber) {
          // Check if title already ends with series number
          const endsWithNumber = /\d+\s*$/.test(book.title.trim());
          if (!endsWithNumber) {
            suggestedTitle = `${book.title} T${String(book.seriesNumber).padStart(2, '0')}`;
          }
        }
      }
      
      // Preserve user's cover selection if they've already selected one
      const preserveCoverUrl = userSelectedCoverRef.current ? formData.coverUrl : (book.coverUrl || null);
      
      // CRITICAL: If user has manually selected bookType and it's NOT a new book, 
      // skip updating formData entirely to avoid resetting their selection
      if (userSelectedBookTypeRef.current && !isNewBook) {
        console.log('[BookForm] useEffect: User has selected bookType and same book - skipping formData update to preserve selection');
        // Still need to update other fields that might have changed, but preserve bookType
        setFormData(prev => ({
          ...prev, // Keep ALL previous values including bookType
          title: suggestedTitle,
          subtitle: book.subtitle || prev.subtitle || '',
          authors: Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : prev.authors || []),
          artists: Array.isArray(book.artists) ? book.artists : (book.artists ? [book.artists] : prev.artists || []),
          isbn: book.isbn || prev.isbn || '',
          isbn13: book.isbn13 || prev.isbn13 || '',
          publisher: book.publisher || prev.publisher || '',
          publishedYear: book.publishedYear || prev.publishedYear || '',
          language: book.language || prev.language || '',
          format: book.format || prev.format || 'physical',
          filetype: book.filetype || prev.filetype || '',
          drm: book.drm || prev.drm || '',
          narrator: book.narrator || prev.narrator || '',
          runtime: book.runtime || prev.runtime || '',
          series: book.series || prev.series || '',
          seriesNumber: book.seriesNumber || prev.seriesNumber || '',
          genres: Array.isArray(book.genres) ? book.genres : (book.genres ? [book.genres] : prev.genres || []),
          tags: Array.isArray(book.tags) ? book.tags : (book.tags ? [book.tags] : prev.tags || []),
          rating: book.rating || prev.rating || '',
          cover: book.cover || prev.cover || null,
          owner: book.owner || prev.owner || '',
          readDate: book.readDate || prev.readDate || '',
          pageCount: book.pageCount || prev.pageCount || '',
          description: initialDescription || prev.description || '',
          urls: { ...prev.urls, ...book.urls },
          annotation: book.annotation || prev.annotation || '',
          titleStatus: book.titleStatus || prev.titleStatus || defaultTitleStatus || 'owned',
          // bookType is NOT updated - preserve user's selection
          coverUrl: preserveCoverUrl || prev.coverUrl,
          ebookFile: book.ebookFile || prev.ebookFile || null
        }));
        return; // Exit early to avoid the full formData reset below
      }
      
      // Normal flow: compute bookType (only for new books or when user hasn't selected)
      let bookTypeToUse;
      if (isNewBook) {
        // It's a new book, so auto-detect or use book's bookType
        if (book.bookType) {
          bookTypeToUse = book.bookType;
        } else {
          // Auto-detect based on ISBN and genres
          const detectedType = detectBookType(book.isbn13, Array.isArray(book.genres) ? book.genres : []);
          bookTypeToUse = detectedType;
        }
        console.log('[BookForm] Auto-detected bookType for new book:', bookTypeToUse);
      } else {
        // Same book: the kind the owner chose, else the book's own (the form's default made a comic edited a book).
        bookTypeToUse = (userSelectedBookTypeRef.current ? formData.bookType : book.bookType) || formData.bookType || 'book';
        console.log('[BookForm] Preserving existing bookType:', bookTypeToUse);
      }
      
      setFormData(prev => {
        return {
          ...prev,
          title: suggestedTitle,
          subtitle: book.subtitle || '',
          authors: Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : []),
          artists: Array.isArray(book.artists) ? book.artists : (book.artists ? [book.artists] : []),
          isbn: book.isbn || '',
          isbn13: book.isbn13 || '',
          publisher: book.publisher || '',
          publishedYear: book.publishedYear || '',
          language: book.language || '',
          format: book.format || 'physical',
          filetype: book.filetype || '',
          drm: book.drm || '',
          narrator: book.narrator || '',
          runtime: book.runtime || '',
          series: book.series || '',
          seriesNumber: book.seriesNumber || '',
          genres: Array.isArray(book.genres) ? book.genres : (book.genres ? [book.genres] : []),
          tags: Array.isArray(book.tags) ? book.tags : (book.tags ? [book.tags] : []),
          rating: book.rating || '',
          cover: book.cover || null,
          owner: book.owner || '',
          readDate: book.readDate || '',
          pageCount: book.pageCount || '',
          description: initialDescription || '',
          urls: book.urls || {},
          annotation: book.annotation || '',
          titleStatus: book.titleStatus || defaultTitleStatus || 'owned',
          bookType: bookTypeToUse,
          coverUrl: preserveCoverUrl,
          ebookFile: book.ebookFile || null
        };
      });
      
      // Set initial cover preview only if user hasn't manually selected one
      if (!userSelectedCoverRef.current) {
        if (book.cover) {
          setCoverPreview(book.cover);
        } else if (book.coverUrl) {
          setCoverPreview(book.coverUrl);
          // Find index in available covers
          const coverIndex = availableCovers.findIndex(c => c.url === book.coverUrl);
          if (coverIndex >= 0) {
            setSelectedCoverIndex(coverIndex);
          } else {
            // If coverUrl not in availableCovers, set it as the first available cover
            if (availableCovers.length > 0) {
              setSelectedCoverIndex(0);
              setCoverPreview(availableCovers[0].url);
            }
          }
        } else if (availableCovers.length > 0) {
          // Use first available cover if no coverUrl set
          setSelectedCoverIndex(0);
          setCoverPreview(availableCovers[0].url);
          setFormData(prev => ({ ...prev, coverUrl: availableCovers[0].url }));
        }
      }
      
      // Find initial edition index if multiple editions available
      if (availableBooks && availableBooks.length > 1) {
        const editionIndex = availableBooks.findIndex(b => 
          b.isbn13 === book.isbn13 || b.isbn === book.isbn
        );
        if (editionIndex >= 0) {
          setSelectedEditionIndex(editionIndex);
        }
      }
    }
  }, [book, availableBooks, availableCovers]);
  
  // Update description when metadata source changes
  useEffect(() => {
    if (book && book._metadataSources && selectedMetadataSource.description) {
      let newDescription;
      if (selectedMetadataSource.description === 'auto') {
        newDescription = book.description || '';
      } else {
        newDescription = book._metadataSources[selectedMetadataSource.description]?.description || '';
      }
      // Only update if we have a valid description source selected
      if (selectedMetadataSource.description === 'auto' || book._metadataSources[selectedMetadataSource.description]) {
        setFormData(prev => {
          // Always update to ensure the description matches the selected source
          return { ...prev, description: newDescription };
        });
      }
    }
  }, [selectedMetadataSource.description, book?._metadataSources]);

  // Reset confirmDeleteEbook when book changes
  useEffect(() => {
    setConfirmDeleteEbook(false);
  }, [book?.ebookFile]);
  
  // Handle edition selection
  const handleEditionChange = (index: number) => {
    if (!availableBooks || index < 0 || index >= availableBooks.length) return;
    
    const selectedEdition = availableBooks[index];
    setSelectedEditionIndex(index);
    
    // Update form data with selected edition
    setFormData(prev => ({
      ...prev,
      isbn: selectedEdition.isbn || prev.isbn,
      isbn13: selectedEdition.isbn13 || prev.isbn13,
      publisher: selectedEdition.publisher || prev.publisher,
      publishedYear: selectedEdition.publishedYear || prev.publishedYear,
      language: selectedEdition.language || prev.language,
      pageCount: selectedEdition.pageCount || prev.pageCount,
      coverUrl: selectedEdition.coverUrl || prev.coverUrl
    }));
    
    // Update cover preview
    if (selectedEdition.coverUrl) {
      setCoverPreview(selectedEdition.coverUrl);
      const coverIndex = availableCovers.findIndex((c: BookCover) => c.url === selectedEdition.coverUrl);
      if (coverIndex >= 0) {
        setSelectedCoverIndex(coverIndex);
      }
    }
  };
  
  // Handle cover selection
  const handleCoverSelect = (coverIndex: number) => {
    if (coverIndex < 0 || coverIndex >= availableCovers.length) return;
    
    const selectedCover = availableCovers[coverIndex];
    userSelectedCoverRef.current = true; // Mark that user has manually selected a cover
    setSelectedCoverIndex(coverIndex);
    setCoverPreview(selectedCover.url);
    setFormData(prev => ({
      ...prev,
      coverUrl: selectedCover.url
    }));
  };
  
  const getLanguageDisplay = (lang: string | undefined | null): string => {
    if (!lang) return 'Unknown';
    const langMap: Record<string, string> = {
      'en': 'English',
      'eng': 'English',
      'fr': 'French',
      'fre': 'French',
      'fra': 'French',
      'es': 'Spanish',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese'
    };
    return langMap[lang.toLowerCase()] || lang.toUpperCase();
  };

  const formatImageSize = (width: number | undefined, height: number | undefined): string => {
    if (!width || !height) return '';
    return `${width}×${height}`;
  };

  const handleImageLoad = (url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    if (target.naturalWidth && target.naturalHeight) {
      setImageDimensions(prev => ({
        ...prev,
        [url]: {
          width: target.naturalWidth,
          height: target.naturalHeight
        }
      }));
    }
  };

  const handleCoverClick = (coverUrl: string | null, coverType: string = 'Cover') => {
    if (coverUrl) {
      const title = formData.title || book?.title || '';
      const author = Array.isArray(formData.authors) 
        ? formData.authors.join(', ') 
        : (formData.authors || (book?.authors ? (Array.isArray(book.authors) ? book.authors.join(', ') : book.authors) : ''));
      
      setCoverModalData({
        coverUrl: coverUrl,
        title: title,
        author: author,
        coverType: coverType
      });
      setShowCoverModal(true);
    }
  };

  const handleCloseCoverModal = () => {
    setShowCoverModal(false);
  };

  const handleInputChange = (field: string, value: any) => {
    console.log('[BookForm] handleInputChange called:', field, '=', value, 'current formData.bookType:', formData.bookType);
    
    // Track when user manually changes bookType - do this FIRST before setState
    if (field === 'bookType') {
      console.log('[BookForm] User is changing bookType to:', value);
      userSelectedBookTypeRef.current = true;
      console.log('[BookForm] Set userSelectedBookTypeRef to true');
    }
    
    setFormData(prev => {
      const updated = {
        ...prev,
        [field]: value
      };
      console.log('[BookForm] Updated formData:', field, '=', updated[field], 'full bookType:', updated.bookType);
      return updated;
    });
    
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }

    // Fetch owner suggestions when typing in owner field (always fetch to show look-ahead)
    if (field === 'owner') {
      fetchOwnerSuggestions(value);
    }
  };

  const fetchOwnerSuggestions = async (query: string = '') => {
    try {
      // Fetch all owners if query is empty, otherwise search
      const searchQuery = query ? query.trim() : '';
      const suggestions = await bookService.getAutocompleteSuggestions('owner', searchQuery);
      
      // Extract owner values from suggestions, filter out null/empty values
      let owners = (suggestions as any[])
        .map((item: any) => {
          // Handle both {owner: "value"} and direct string values
          const ownerValue = item.owner || item;
          return ownerValue as string;
        })
        .filter((owner: any) => owner && typeof owner === 'string' && owner.trim())
        .filter((owner: string, index: number, self: string[]) => self.indexOf(owner) === index); // Remove duplicates

      // If there's a query, prioritize starts-with matches, then contains matches
      if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        owners.sort((a, b) => {
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
        // Sort alphabetically when showing all owners
        owners.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      }

      setOwnerSuggestions(owners);
      setShowOwnerSuggestions(owners.length > 0);
      setHighlightedOwnerIndex(-1);
    } catch (error: any) {
      console.error('Error fetching owner suggestions:', error);
      setOwnerSuggestions([]);
      setShowOwnerSuggestions(false);
    }
  };

  const handleOwnerSuggestionClick = (owner: string) => {
    handleInputChange('owner', owner);
    setShowOwnerSuggestions(false);
    setHighlightedOwnerIndex(-1);
  };

  const handleOwnerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showOwnerSuggestions || ownerSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedOwnerIndex(prev => 
          prev < ownerSuggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedOwnerIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedOwnerIndex >= 0 && highlightedOwnerIndex < ownerSuggestions.length) {
          handleOwnerSuggestionClick(ownerSuggestions[highlightedOwnerIndex]);
        }
        break;
      case 'Escape':
        setShowOwnerSuggestions(false);
        setHighlightedOwnerIndex(-1);
        break;
    }
  };

  const handleOwnerBlur = () => {
    // Delay hiding suggestions to allow clicks on suggestions
    setTimeout(() => {
      setShowOwnerSuggestions(false);
      setHighlightedOwnerIndex(-1);
    }, 150);
  };

  const updateDropdownPosition = () => {
    if (ownerInputRef.current) {
      const rect = ownerInputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom,
        left: rect.left,
        width: rect.width
      });
    }
  };

  const handleOwnerFocus = async () => {
    // Always fetch suggestions on focus to show all existing owners
    updateDropdownPosition();
    await fetchOwnerSuggestions(formData.owner || '');
  };

  useEffect(() => {
    if (showOwnerSuggestions && ownerSuggestions.length > 0) {
      updateDropdownPosition();
      const handleResize = () => updateDropdownPosition();
      const handleScroll = () => updateDropdownPosition();
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }
    return undefined;
  }, [showOwnerSuggestions, ownerSuggestions.length]);

  const handleArrayInputChange = (field: string, value: string) => {
    // Store the raw string value while typing to allow trailing commas
    // This allows users to type "genre1, genre2, " without the comma disappearing
    setFormData(prev => ({
      ...prev,
      [field]: value // Store as string while typing
    }));
    
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const handleArrayInputBlur = (field: string, value: string) => {
    // Process the comma-separated values when user finishes typing (on blur)
    const array = value.split(',').map(item => item.trim()).filter(item => item);
    setFormData(prev => ({
      ...prev,
      [field]: array // Convert to array when done typing
    }));
  };

  const handleAuthorsInputChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      authors: [value]
    }));
  };

  const handleAuthorsInputBlur = (value: string) => {
    if (value.includes(',')) {
      const array = value.split(',').map(item => item.trim()).filter(item => item);
      handleInputChange('authors', array);
    } else {
      handleInputChange('authors', value.trim() ? [value.trim()] : []);
    }
  };

  const handleArtistsInputChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      artists: [value]
    }));
  };

  const handleArtistsInputBlur = (value: string) => {
    if (value.includes(',')) {
      const array = value.split(',').map(item => item.trim()).filter(item => item);
      handleInputChange('artists', array);
    } else {
      handleInputChange('artists', value.trim() ? [value.trim()] : []);
    }
  };

  const handleFileChange = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadMessage('Please select an image file');
      setUploadMessageType('danger');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadMessage('File size must be less than 10MB');
      setUploadMessageType('danger');
      return;
    }

    setUploadingCover(true);
    setUploadMessage(null);

    try {
      if (!book?.id) {
        setUploadMessage('Please save the book first before uploading a cover');
        setUploadMessageType('danger');
        setUploadingCover(false);
        return;
      }

      const result = await bookService.uploadCover(book.id, file) as any;
      setCoverPreview(result.coverPath);
      setCoverPreviewKey(prev => prev + 1); // Force image reload
      handleInputChange('cover', result.coverPath);
      // Mark that user has selected a cover so useEffect doesn't override it
      userSelectedCoverRef.current = true;
      setUploadMessage('Cover uploaded successfully');
      setUploadMessageType('success');
      
      // Refresh the book data if onBookUpdated callback is provided
      if (onBookUpdated) {
        try {
          await onBookUpdated(book.id);
        } catch (error: any) {
          console.error('Error refreshing book data after cover upload:', error);
          // Don't show error to user - cover upload was successful
        }
      }
    } catch (error: any) {
      setUploadMessage('Failed to upload cover: ' + error.message);
      setUploadMessageType('danger');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    
    if (!book?.id) {
      setUploadMessage('Please save the book first before uploading a cover');
      setUploadMessageType('danger');
      return;
    }
    
    // First, try to handle as a file drop
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const fakeEvent = { target: { files: [file] } };
      handleFileChange(fakeEvent);
      return;
    }
    
    // If no file, try to get URL from the drop (e.g., dragging image from another browser tab)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      // Check if it looks like an image URL
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const isImageUrl = imageExtensions.some(ext => url.toLowerCase().includes(ext)) || 
                         url.includes('/images/') || 
                         url.includes('covers.openlibrary.org') ||
                         url.includes('books.google.com');
      
      if (isImageUrl || url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)) {
        try {
          setUploadMessage('Downloading image from URL...');
          setUploadMessageType('info');
          
          // Fetch the image and convert to a blob
          const response = await fetch(url);
          if (!response.ok) throw new Error('Failed to fetch image');
          
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) {
            throw new Error('URL does not point to an image');
          }
          
          // Create a File object from the blob
          const fileName = url.split('/').pop()?.split('?')[0] || 'cover.jpg';
          const imageFile = new File([blob], fileName, { type: blob.type });
          
          const fakeEvent = { target: { files: [imageFile] } };
          handleFileChange(fakeEvent);
          return;
        } catch (error: any) {
          console.error('Error downloading image from URL:', error);
          setUploadMessage('Failed to download image from URL. Try right-click > Copy Image, then paste.');
          setUploadMessageType('danger');
          return;
        }
      }
    }
    
    // Try to extract image URL from HTML (e.g., when dragging an <img> element)
    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) {
        const imgUrl = imgMatch[1];
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
          try {
            setUploadMessage('Downloading image...');
            setUploadMessageType('info');
            
            const response = await fetch(imgUrl);
            if (!response.ok) throw new Error('Failed to fetch image');
            
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) {
              throw new Error('URL does not point to an image');
            }
            
            const fileName = imgUrl.split('/').pop()?.split('?')[0] || 'cover.jpg';
            const imageFile = new File([blob], fileName, { type: blob.type });
            
            const fakeEvent = { target: { files: [imageFile] } };
            handleFileChange(fakeEvent);
            return;
          } catch (error: any) {
            console.error('Error downloading image from HTML:', error);
            setUploadMessage('Failed to download image. Try right-click > Copy Image, then paste.');
            setUploadMessageType('danger');
            return;
          }
        }
      }
    }
    
    // If we get here, we couldn't handle the drop
    if (!file) {
      setUploadMessage('Could not process dropped content. Try copying the image and pasting instead.');
      setUploadMessageType('warning');
    }
  };

  const handlePaste = useCallback(async (e: any) => {
    // Only handle paste if we're editing an existing book
    if (!book?.id) {
      return;
    }

    // Check if clipboard contains image data
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }

    // Find image item in clipboard
    let imageItem = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        imageItem = items[i];
        break;
      }
    }

    if (!imageItem) {
      return;
    }

    // Get the image file from clipboard
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }

    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      setUploadMessage('Pasted image is too large (max 10MB)');
      setUploadMessageType('danger');
      return;
    }

    // Prevent default paste behavior
    e.preventDefault();

    // Upload the image using existing handleFileChange function
    setUploadingCover(true);
    setUploadMessage(null);

    try {
      const result = await bookService.uploadCover(book.id, file) as any;
      setCoverPreview(result.coverPath);
      setCoverPreviewKey(prev => prev + 1); // Force image reload
      // Update form data directly
      setFormData(prev => ({
        ...prev,
        cover: result.coverPath
      }));
      // Mark that user has selected a cover so useEffect doesn't override it
      userSelectedCoverRef.current = true;
      setUploadMessage('Cover uploaded successfully from clipboard');
      setUploadMessageType('success');
      
      // Refresh the book data if onBookUpdated callback is provided
      if (onBookUpdated) {
        try {
          await onBookUpdated(book.id);
        } catch (error: any) {
          console.error('Error refreshing book data after cover upload:', error);
          // Don't show error to user - cover upload was successful
        }
      }
    } catch (error: any) {
      setUploadMessage('Failed to upload cover from clipboard: ' + error.message);
      setUploadMessageType('danger');
    } finally {
      setUploadingCover(false);
    }
  }, [book?.id, onBookUpdated]);

  // Add paste event listener to handle image pasting
  useEffect(() => {
    // Only attach listener when editing an existing book
    if (!book?.id) {
      return;
    }

    // Attach paste event listener to document
    document.addEventListener('paste', handlePaste);

    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [book?.id, handlePaste]); // Re-attach when book ID or handlePaste changes

  const handleEbookFileChange = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    const allowedExtensions = ['.epub', '.mobi', '.azw', '.pdf', '.fb2', '.txt'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!allowedExtensions.includes(ext)) {
      setUploadMessage('Please select an ebook file (EPUB, MOBI, AZW, PDF, FB2, or TXT)');
      setUploadMessageType('danger');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setUploadMessage('File size must be less than 100MB');
      setUploadMessageType('danger');
      return;
    }

    setUploadingEbook(true);
    setUploadMessage(null);

    try {
      if (!book?.id) {
        setUploadMessage('Please save the book first before uploading an ebook');
        setUploadMessageType('danger');
        setUploadingEbook(false);
        return;
      }

      const result = await bookService.uploadEbook(book.id, file) as any;
      console.log('Ebook upload result:', result);
      // Update formData to reflect the uploaded ebook
      handleInputChange('ebookFile', result.filename);
      // Also update the book prop if possible (for inline editing)
      if (book) {
        book.ebookFile = result.filename;
        console.log('Updated book.ebookFile to:', book.ebookFile);
      }
      // Refresh book data if callback is available
      if (onBookUpdated) {
        try {
          console.log('Calling onBookUpdated for book:', book.id);
          await onBookUpdated(book.id);
          console.log('Book data refreshed successfully');
        } catch (err) {
          console.error('Failed to refresh book data after ebook upload:', err);
        }
      } else {
        console.warn('onBookUpdated callback not available');
      }
      setUploadMessage('Ebook uploaded successfully');
      setUploadMessageType('success');
    } catch (error: any) {
      setUploadMessage('Failed to upload ebook: ' + error.message);
      setUploadMessageType('danger');
    } finally {
      setUploadingEbook(false);
    }
  };

  const handleEbookDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      const fakeEvent = { target: { files: [file] } };
      handleEbookFileChange(fakeEvent);
    }
  };

  // Helper function to normalize array fields
  const normalizeArrayField = (value: any): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map(item => typeof item === 'string' ? item.trim() : String(item).trim())
        .filter(item => item);
    }
    if (typeof value === 'string') {
      return value.split(',').map(item => item.trim()).filter(item => item);
    }
    return [];
  };

  const handleFetchFromSources = async () => {
    if (!book || !book.id) {
      return; // Only available when editing existing book
    }

    setEnriching(true);
    isEnrichingRef.current = true; // Prevent useEffect from resetting formData
    setUploadMessage(null);
    setErrors({});

    try {
      // Prepare book data for enrichment (use current form data, fallback to book)
      const bookDataForEnrichment = {
        ...book,
        title: formData.title || book.title,
        isbn: formData.isbn || book.isbn,
        isbn13: formData.isbn13 || book.isbn13,
        authors: formData.authors || book.authors
      };

      // Fetch enriched data from sources
      const enrichedBook = await bookService.enrichBook(bookDataForEnrichment as Record<string, unknown>) as any;

      // First, update the book object with enriched data so useEffect can use it
      // This ensures the form gets the updated data when useEffect runs
      if (enrichedBook) {
        // Update book object with enriched data
        Object.assign(book, {
          description: enrichedBook.description || book.description,
          authors: enrichedBook.authors || book.authors,
          publisher: enrichedBook.publisher || book.publisher,
          publishedYear: enrichedBook.publishedYear || book.publishedYear,
          pageCount: enrichedBook.pageCount || book.pageCount,
          series: enrichedBook.series || book.series,
          seriesNumber: enrichedBook.seriesNumber || book.seriesNumber,
          genres: enrichedBook.genres || book.genres,
          tags: enrichedBook.tags || book.tags,
          urls: { ...book.urls, ...enrichedBook.urls },
          coverUrl: enrichedBook.coverUrl || book.coverUrl,
          _metadataSources: enrichedBook._metadataSources || book._metadataSources,
          availableCovers: enrichedBook.availableCovers || book.availableCovers
        });
        
        console.log('[BookForm] Updated book object with enriched data:', {
          description: book.description ? `${book.description.substring(0, 50)}...` : 'null',
          descriptionLength: book.description?.length || 0,
          authors: book.authors,
          publisher: book.publisher,
          coverUrl: book.coverUrl
        });
      }

      // Update form data with enriched information
      // Force update all fields that were enriched, regardless of current values
      setFormData(prev => {
        // Re-detect book type if genres were updated, but preserve user's manual selection
        let updatedBookType = prev.bookType; // Preserve current selection by default
        const enrichedGenres = enrichedBook.genres && Array.isArray(enrichedBook.genres) && enrichedBook.genres.length > 0 
          ? enrichedBook.genres 
          : (prev.genres && prev.genres.length > 0 ? prev.genres : []);
        
        // Only update bookType if user hasn't manually changed it
        if (!userSelectedBookTypeRef.current) {
          // Check if enriched book has explicit bookType
          if (enrichedBook.bookType) {
            updatedBookType = enrichedBook.bookType;
          } else if (enrichedGenres.length > 0) {
            // Re-detect based on updated genres
            const detectedType = detectBookType(enrichedBook.isbn13 || prev.isbn13, enrichedGenres);
            updatedBookType = detectedType;
          }
        }
        // If user has manually selected, keep their selection (updatedBookType already set to prev.bookType)
        
        const updated = {
          ...prev,
          // Update description - always use enriched if available and longer, or if current is empty
          description: (enrichedBook.description && enrichedBook.description.trim() && 
            (!prev.description || !prev.description.trim() || enrichedBook.description.length > prev.description.length)) 
            ? enrichedBook.description 
            : (prev.description || ''),
          // Update authors - use enriched if current is empty
          authors: (prev.authors && Array.isArray(prev.authors) && prev.authors.length > 0) 
            ? prev.authors 
            : (enrichedBook.authors && Array.isArray(enrichedBook.authors) && enrichedBook.authors.length > 0 ? enrichedBook.authors : []),
          // Update publisher - use enriched if current is empty
          publisher: (prev.publisher && prev.publisher.trim()) || enrichedBook.publisher || '',
          // Update published year - use enriched if current is empty
          publishedYear: prev.publishedYear || enrichedBook.publishedYear || '',
          // Update page count - use enriched if current is empty
          pageCount: prev.pageCount || enrichedBook.pageCount || '',
          // Update series - use enriched if current is empty
          series: (prev.series && prev.series.trim()) || enrichedBook.series || '',
          // Update series number - use enriched if current is empty
          seriesNumber: prev.seriesNumber || enrichedBook.seriesNumber || '',
          // Update genres - merge if both exist, otherwise use whichever is available
          genres: enrichedGenres,
          // Update tags - merge if both exist, otherwise use whichever is available
          tags: (prev.tags && prev.tags.length > 0) 
            ? prev.tags 
            : (enrichedBook.tags && Array.isArray(enrichedBook.tags) && enrichedBook.tags.length > 0 ? enrichedBook.tags : []),
          // Update URLs - merge
          urls: { ...prev.urls, ...enrichedBook.urls },
          // Update cover URL - prefer enriched if available
          coverUrl: enrichedBook.coverUrl || prev.coverUrl || null,
          // Update bookType - but preserve user's manual selection
          bookType: updatedBookType
        };
        
        console.log('[BookForm] Updated formData after enrichment:', {
          description: updated.description ? `${updated.description.substring(0, 50)}...` : 'null/empty',
          descriptionLength: updated.description?.length || 0,
          prevDescriptionLength: prev.description?.length || 0,
          enrichedDescriptionLength: enrichedBook.description?.length || 0,
          authors: updated.authors,
          publisher: updated.publisher,
          coverUrl: updated.coverUrl
        });
        
        return updated;
      });

      // Update the book object reference to include enriched metadata sources
      // This allows the metadata source selector to work
      if (enrichedBook._metadataSources) {
        Object.assign(book, { _metadataSources: enrichedBook._metadataSources });
      }

      // Check if current cover is a custom uploaded cover (stored in /custom/ directory)
      const currentCoverPath = book?.cover || null;
      const isCustomCover = currentCoverPath && currentCoverPath.includes('/custom/');
      
      // Update available covers if enriched book has them
      if (enrichedBook.availableCovers && enrichedBook.availableCovers.length > 0) {
        // Update both book object and local state
        Object.assign(book, { availableCovers: enrichedBook.availableCovers });
        // Update local state to trigger React re-render
        setLocalAvailableCovers(enrichedBook.availableCovers);
        
        // IMPORTANT: Preserve custom covers - don't automatically change them
        // Only update cover selection if user hasn't manually selected one AND it's not a custom cover
        if (!userSelectedCoverRef.current && !isCustomCover) {
          // Find the current cover URL in the new availableCovers list
          const currentCoverUrl = formData.coverUrl || coverPreview || book.coverUrl;
          const currentCoverIndex = (enrichedBook.availableCovers as any[]).findIndex((c: any) => c.url === currentCoverUrl);

          // Update cover selection
          if (currentCoverIndex >= 0) {
            // Keep current selection if it still exists in the new list
            setSelectedCoverIndex(currentCoverIndex);
            setCoverPreview(enrichedBook.availableCovers[currentCoverIndex].url);
            setFormData(prev => ({ ...prev, coverUrl: enrichedBook.availableCovers[currentCoverIndex].url }));
          } else if (enrichedBook.coverUrl) {
            // Use the enriched cover if current one not found
            const enrichedCoverIndex = (enrichedBook.availableCovers as any[]).findIndex((c: any) => c.url === enrichedBook.coverUrl);
            if (enrichedCoverIndex >= 0) {
              setSelectedCoverIndex(enrichedCoverIndex);
              setCoverPreview(enrichedBook.coverUrl);
              setFormData(prev => ({ ...prev, coverUrl: enrichedBook.coverUrl }));
            } else {
              // Fallback to first available cover
              setSelectedCoverIndex(0);
              setCoverPreview(enrichedBook.availableCovers[0].url);
              setFormData(prev => ({ ...prev, coverUrl: enrichedBook.availableCovers[0].url }));
            }
          } else {
            // Use first available cover as fallback
            setSelectedCoverIndex(0);
            setCoverPreview(enrichedBook.availableCovers[0].url);
            setFormData(prev => ({ ...prev, coverUrl: enrichedBook.availableCovers[0].url }));
          }
        } else if (isCustomCover) {
          // For custom covers, keep the current cover and just update availableCovers for selection
          // Find the current cover in the availableCovers list (it should be first)
          const currentCoverUrl = currentCoverPath!.startsWith('http') ? currentCoverPath : bookService.getImageUrl(currentCoverPath!);
          const currentCoverIndex = (enrichedBook.availableCovers as any[]).findIndex((c: any) => c.url === currentCoverUrl);
          if (currentCoverIndex >= 0) {
            setSelectedCoverIndex(currentCoverIndex);
          } else {
            // If custom cover not in list, it will be added first by availableCovers useMemo
            setSelectedCoverIndex(0);
          }
          // Don't change coverPreview or formData.coverUrl for custom covers
        }
        
        console.log('[BookForm] Updated availableCovers:', {
          count: enrichedBook.availableCovers.length,
          isCustomCover,
          userSelectedCover: userSelectedCoverRef.current,
          currentCoverPath,
          selectedIndex: selectedCoverIndex
        });
      } else if (enrichedBook.coverUrl && !isCustomCover && !userSelectedCoverRef.current) {
        // If no availableCovers but we have a coverUrl, update it (only if not custom cover)
        setCoverPreview(enrichedBook.coverUrl);
        setFormData(prev => ({ ...prev, coverUrl: enrichedBook.coverUrl }));
      }

      setUploadMessage('Book metadata fetched successfully from sources!');
      setUploadMessageType('success');
    } catch (error: any) {
      console.error('Error fetching from sources:', error);
      setUploadMessage('Failed to fetch metadata from sources: ' + (error.message || 'Unknown error'));
      setUploadMessageType('danger');
    } finally {
      setEnriching(false);
      isEnrichingRef.current = false; // Allow useEffect to run again
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      setErrors({ title: 'Title is required' });
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      // Normalize array fields before submitting
      const normalizedTags = normalizeArrayField(formData.tags);
      const normalizedGenres = normalizeArrayField(formData.genres);
      const normalizedAuthors = normalizeArrayField(formData.authors);
      const normalizedArtists = normalizeArrayField(formData.artists);

      const bookData = {
        ...formData,
        tags: normalizedTags,
        genres: normalizedGenres,
        authors: normalizedAuthors,
        artists: normalizedArtists,
        publishedYear: formData.publishedYear ? parseInt(String(formData.publishedYear)) : null,
        seriesNumber: formData.seriesNumber ? parseInt(String(formData.seriesNumber)) : null,
        rating: formData.rating ? parseFloat(String(formData.rating)) : null,
        pageCount: formData.pageCount ? parseInt(String(formData.pageCount)) : null,
        runtime: formData.runtime ? parseInt(String(formData.runtime)) : null,
        readDate: formData.readDate || null,
        coverUrl: formData.coverUrl || null,
        ebookFile: formData.ebookFile || null,
        // Include availableCovers so backend can select highest quality version
        availableCovers: availableCovers.length > 0 ? availableCovers.map((c: BookCover) => ({ url: c.url, source: c.source, type: c.type })) : undefined
      };
      
      console.log('BookForm handleSubmit - bookData:', {
        coverUrl: bookData.coverUrl,
        cover: bookData.cover,
        availableCoversCount: bookData.availableCovers?.length || 0,
        ebookFile: bookData.ebookFile,
        formDataCoverUrl: formData.coverUrl,
        userSelectedCover: userSelectedCoverRef.current
      });

      await onSave(bookData);
    } catch (error: any) {
      console.error('Error saving book:', error);
      setLoading(false);
      // For duplicate book errors, show Bootstrap alert directly
      const errorMessage = error.message || 'Failed to save book';
      if (errorMessage.toLowerCase().includes('already exists')) {
        // Show Bootstrap alert directly if onShowAlert is available
        if (onShowAlert) {
          onShowAlert(errorMessage, 'danger');
        } else {
          // Fallback: show error in form if onShowAlert is not available
          setErrors({ submit: errorMessage });
        }
        // Don't set error state in form - alert is shown (or will be shown in form as fallback)
        return;
      }
      // For other errors, show in form
      setErrors({ submit: errorMessage });
    }
  };

  const formContent = (
      <Form onSubmit={handleSubmit}>
      {!inline && (
        <DialogHeader
          icon={<BsBook />}
          title={book?.id ? 'Edit Book' : 'Add New Book'}
          aside={book?.id && (
            <Button size="sm" icon={<BsCloudDownload />} onClick={handleFetchFromSources} loading={enriching} disabled={loading}>
              {enriching ? 'Fetching...' : 'Fetch from Sources'}
            </Button>
          )}
          onClose={() => onCancel?.()}
        />
      )}
      
      {inline && book?.id && (
        <div className="mb-3 d-flex justify-content-end">
          <Button
            size="sm"
            onClick={handleFetchFromSources}
            disabled={enriching || loading}
            style={{ 
              borderColor: '#fbbf24', 
              color: '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {enriching ? (
              <>
                <Spinner size="sm" />
                Fetching...
              </>
            ) : (
              <>
                <BsCloudDownload />
                Fetch from Sources
              </>
            )}
          </Button>
        </div>
      )}
      
      {inline ? (
        <div className="book-form-inline-body">
          {errors.submit && (
            <Notice tone="danger" className="mb-3">
              {errors.submit}
            </Notice>
          )}

          {uploadMessage && (
            <Notice tone={toneOf(uploadMessageType)} className="mb-3">
              {uploadMessage}
            </Notice>
          )}

          <Row>
            <Col md={8}>
              <Form.Group className="mb-3">
                <Form.Label>Title *</Form.Label>
                <TextField
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="Enter book title"
                  isInvalid={!!errors.title}
                  required
                />
                <FieldError>{errors.title}</FieldError>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Subtitle</Form.Label>
                <TextField
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => handleInputChange('subtitle', e.target.value)}
                  placeholder="Enter subtitle"
                />
              </Form.Group>

              <Row className="g-2 mb-2">
                <Col md={6} className="ps-0">
                  <Form.Group className="mb-2">
                    <Form.Label>Book Type</Form.Label>
                    <Select
                      value={formData.bookType || 'book'}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        console.log('[BookForm] User changed bookType dropdown to:', newValue, 'current formData.bookType:', formData.bookType);
                        // Set the ref FIRST - this is critical to prevent useEffect from resetting it
                        userSelectedBookTypeRef.current = true;
                        console.log('[BookForm] Set userSelectedBookTypeRef to true');
                        // Update state directly - this should trigger a re-render with the new value
                        setFormData(prev => {
                          const updated = { ...prev, bookType: newValue };
                          console.log('[BookForm] Direct setFormData update - bookType changed from', prev.bookType, 'to', newValue);
                          return updated;
                        });
                      }}
                    >
                      <option value="book">Book</option>
                      <option value="graphic-novel">Graphic Novel</option>
                      <option value="score">Score</option>
                    </Select>
                  </Form.Group>
                </Col>
                <Col md={6} className="pe-0">
                  <Form.Group className="mb-2">
                    <Form.Label>Status</Form.Label>
                    <Select
                      value={formData.titleStatus}
                      onChange={(e) => handleInputChange('titleStatus', e.target.value)}
                    >
                      <option value="owned">Owned</option>
                      <option value="borrowed">Borrowed</option>
                      <option value="wish">Wish</option>
                    </Select>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-2">
                <Col md={6} className="ps-0">
                  <Form.Group className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <Form.Label className="mb-0">Series</Form.Label>
                      {book?._metadataSources && (book._metadataSources.googleBooks?.series || book._metadataSources.openLibrary?.series) && (
                        <div className="d-flex align-items-center gap-2">
                          <Select
                            size="sm"
                            style={{ width: 'auto', minWidth: '120px' }}
                            value={selectedMetadataSource.series}
                            onChange={(e) => {
                              const source = e.target.value;
                              setSelectedMetadataSource(prev => ({ ...prev, series: source }));
                              const newValue = getMetadataValue('series', source);
                              handleInputChange('series', newValue);
                            }}
                          >
                            <option value="auto">Auto</option>
                            {getAvailableSources('series').map(source => (
                              <option key={source.key} value={source.key}>{source.label}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                    <TextField
                      type="text"
                      value={formData.series}
                      onChange={(e) => handleInputChange('series', e.target.value)}
                      placeholder="Enter series name"
                    />
                  </Form.Group>
                </Col>
                <Col md={6} className="pe-0">
                  <Form.Group className="mb-3">
                    <Form.Label>Series Number</Form.Label>
                    <TextField
                      type="number"
                      value={formData.seriesNumber}
                      onChange={(e) => handleInputChange('seriesNumber', e.target.value)}
                      placeholder="e.g., 1"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Author(s)</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.authors) ? formData.authors.join(', ') : formData.authors}
                  onChange={(e) => handleAuthorsInputChange(e.target.value)}
                  onBlur={(e) => handleAuthorsInputBlur(e.target.value)}
                  placeholder="Enter authors (comma-separated)"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Belongs to</Form.Label>
                <div style={{ position: 'relative' }}>
                  <TextField
                    ref={ownerInputRef}
                    type="text"
                    value={formData.owner}
                    onChange={(e) => {
                      handleInputChange('owner', e.target.value);
                      updateDropdownPosition();
                    }}
                    onKeyDown={handleOwnerKeyDown}
                    onBlur={handleOwnerBlur}
                    onFocus={handleOwnerFocus}
                    placeholder="Enter owner name"
                  />
                </div>
              </Form.Group>
              
              {showOwnerSuggestions && ownerSuggestions.length > 0 && dropdownPosition.width > 0 && createPortal(
                <div 
                  ref={ownerDropdownRef}
                  className="autocomplete-suggestions"
                  style={{
                    position: 'fixed',
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                    width: `${dropdownPosition.width}px`,
                    zIndex: 99999,
                    backgroundColor: '#212529',
                    border: '1px solid #495057',
                    borderRadius: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    marginTop: '2px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)'
                  }}
                >
                  {ownerSuggestions.map((owner, index) => (
                    <div
                      key={index}
                      className={`autocomplete-suggestion ${
                        index === highlightedOwnerIndex ? 'highlighted' : ''
                      }`}
                      onClick={() => handleOwnerSuggestionClick(owner)}
                      style={{
                        padding: '0.5rem',
                        cursor: 'pointer',
                        backgroundColor: index === highlightedOwnerIndex ? '#495057' : 'transparent',
                        color: '#f8f9fa',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={() => setHighlightedOwnerIndex(index)}
                    >
                      {owner}
                    </div>
                  ))}
                </div>,
                document.body
              )}

              {/* Advanced Fields Toggle */}
              <div 
                className="advanced-toggle"
                onClick={() => {
                  const newValue = !showAdvanced;
                  setShowAdvanced(newValue);
                  writeStored('bookdex-show-advanced-form', newValue.toString());
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 0',
                  cursor: 'pointer',
                  color: '#fbbf24',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  borderBottom: showAdvanced ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                  marginTop: '8px',
                  marginBottom: showAdvanced ? '12px' : '0'
                }}
              >
                {showAdvanced ? <BsChevronDown size={14} /> : <BsChevronRight size={14} />}
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                  {showAdvanced ? 'Hide' : 'Show'} Additional Fields
                </span>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)', marginLeft: 'auto' }}>
                  ISBN, Publisher, Genres, Description...
                </span>
              </div>

              {/* Advanced Fields Section - Uses CSS display to avoid JSX issues */}
              <div style={{ display: showAdvanced ? 'block' : 'none' }}>

              <Form.Group className="mb-3">
                <Form.Label>Artist(s) / Illustrator(s)</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.artists) ? formData.artists.join(', ') : formData.artists}
                  onChange={(e) => handleArtistsInputChange(e.target.value)}
                  onBlur={(e) => handleArtistsInputBlur(e.target.value)}
                  placeholder="Enter artists/illustrators (comma-separated, e.g., for comics)"
                />
              </Form.Group>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>ISBN-10</Form.Label>
                    <TextField
                      type="text"
                      value={formData.isbn}
                      onChange={(e) => handleInputChange('isbn', e.target.value)}
                      placeholder="Enter ISBN-10"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>ISBN-13</Form.Label>
                    <TextField
                      type="text"
                      value={formData.isbn13}
                      onChange={(e) => handleInputChange('isbn13', e.target.value)}
                      placeholder="Enter ISBN-13"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Publisher</Form.Label>
                    <TextField
                      type="text"
                      value={formData.publisher}
                      onChange={(e) => handleInputChange('publisher', e.target.value)}
                      placeholder="Enter publisher"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Published Year</Form.Label>
                    <TextField
                      type="number"
                      value={formData.publishedYear}
                      onChange={(e) => handleInputChange('publishedYear', e.target.value)}
                      placeholder="e.g., 2020"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Language</Form.Label>
                    <TextField
                      type="text"
                      value={formData.language}
                      onChange={(e) => handleInputChange('language', e.target.value)}
                      placeholder="e.g., en, fr, de"
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Book Type</Form.Label>
                    <Select
                      value={formData.bookType || 'book'}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        console.log('[BookForm] User changed bookType dropdown to:', newValue, 'current formData.bookType:', formData.bookType);
                        // Set the ref FIRST - this is critical to prevent useEffect from resetting it
                        userSelectedBookTypeRef.current = true;
                        console.log('[BookForm] Set userSelectedBookTypeRef to true');
                        // Update state directly - this should trigger a re-render with the new value
                        setFormData(prev => {
                          const updated = { ...prev, bookType: newValue };
                          console.log('[BookForm] Direct setFormData update - bookType changed from', prev.bookType, 'to', newValue);
                          return updated;
                        });
                      }}
                    >
                      <option value="book">Book</option>
                      <option value="graphic-novel">Graphic Novel</option>
                      <option value="score">Score</option>
                    </Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Format</Form.Label>
                    <Select
                      value={formData.format}
                      onChange={(e) => handleInputChange('format', e.target.value)}
                    >
                      <option value="physical">Physical</option>
                      <option value="ebook">E-book</option>
                      <option value="audiobook">Audiobook</option>
                    </Select>
                  </Form.Group>
                </Col>
              </Row>

              {formData.format === 'ebook' && (
                <>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>File Type</Form.Label>
                        <TextField
                          type="text"
                          value={formData.filetype}
                          onChange={(e) => handleInputChange('filetype', e.target.value)}
                          placeholder="e.g., EPUB, PDF"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>DRM</Form.Label>
                        <TextField
                          type="text"
                          value={formData.drm}
                          onChange={(e) => handleInputChange('drm', e.target.value)}
                          placeholder="e.g., None, Adobe DRM"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}

              {formData.format === 'audiobook' && (
                <>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Narrator</Form.Label>
                        <TextField
                          type="text"
                          value={formData.narrator}
                          onChange={(e) => handleInputChange('narrator', e.target.value)}
                          placeholder="Enter narrator name"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Runtime (minutes)</Form.Label>
                        <TextField
                          type="number"
                          value={formData.runtime}
                          onChange={(e) => handleInputChange('runtime', e.target.value)}
                          placeholder="e.g., 720"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}

              <Form.Group className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <Form.Label className="mb-0">Genres</Form.Label>
                  {book?._metadataSources && (book._metadataSources.googleBooks?.genres || book._metadataSources.openLibrary?.genres) && (
                    <small style={{ color: '#fbbf24' }}>
                      ✓ Aggregated from {[book._metadataSources.googleBooks?.genres, book._metadataSources.openLibrary?.genres].filter(g => g).length} source(s)
                    </small>
                  )}
                </div>
                <TextField
                  type="text"
                  value={Array.isArray(formData.genres) ? formData.genres.join(', ') : (formData.genres || '')}
                  onChange={(e) => handleArrayInputChange('genres', e.target.value)}
                  onBlur={(e) => handleArrayInputBlur('genres', e.target.value)}
                  placeholder="Enter genres (comma-separated)"
                />
                {book?._metadataSources && Array.isArray(formData.genres) && formData.genres.length > 0 && (
                  <Form.Text className="text-muted">
                    Combined from all sources ({formData.genres.length} genre{formData.genres.length !== 1 ? 's' : ''})
                  </Form.Text>
                )}
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Tags</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.tags) ? formData.tags.join(', ') : (formData.tags || '')}
                  onChange={(e) => handleArrayInputChange('tags', e.target.value)}
                  onBlur={(e) => handleArrayInputBlur('tags', e.target.value)}
                  placeholder="Enter tags (comma-separated)"
                />
              </Form.Group>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Rating</Form.Label>
                    <TextField
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      value={formData.rating}
                      onChange={(e) => handleInputChange('rating', e.target.value)}
                      placeholder="0-5"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Page Count</Form.Label>
                    <TextField
                      type="number"
                      value={formData.pageCount}
                      onChange={(e) => handleInputChange('pageCount', e.target.value)}
                      placeholder="e.g., 350"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Read Date</Form.Label>
                    <TextField
                      type="date"
                      value={formData.readDate}
                      onChange={(e) => handleInputChange('readDate', e.target.value)}
                      placeholder="Date when you finished reading this book"
                    />
                    <Form.Text className="text-muted">
                      Leave empty if you haven't read this book yet
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <Form.Label className="mb-0">Description</Form.Label>
                  {book?._metadataSources && (book._metadataSources.googleBooks || book._metadataSources.openLibrary) && (
                    <div className="d-flex align-items-center gap-2">
                      <small className="text-muted">Source:</small>
                      <Select
                        size="sm"
                        style={{ width: 'auto', minWidth: '150px' }}
                        value={selectedMetadataSource.description}
                        onChange={(e) => {
                          const source = e.target.value;
                          userSelectedSourceRef.current = true; // Mark that user has selected a source
                          setSelectedMetadataSource(prev => ({ ...prev, description: source }));
                          // The useEffect will handle updating the formData.description
                        }}
                      >
                        <option value="auto">Auto (Longest)</option>
                        {getAvailableSources('description').map(source => (
                          <option key={source.key} value={source.key}>{source.label}</option>
                        ))}
                      </Select>
                      <small style={{ color: '#fbbf24' }}>
                        ✓ Enriched
                      </small>
                    </div>
                  )}
                </div>
                <TextArea
                  rows={4}
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Enter book description"
                />
                {book?._metadataSources && getAvailableSources('description').length > 0 && (
                  <Form.Text className="text-muted">
                    {getAvailableSources('description').length} source(s) available
                  </Form.Text>
                )}
              </Form.Group>

              {book?.id && (
                <Form.Group className="mb-3">
                  <Form.Label>Ebook File</Form.Label>
                  {book.ebookFile ? (
                    <div className="mb-3">
                      <Notice tone="info" className="mb-2">
                        <BsFileEarmark className="me-2" />
                        Ebook file uploaded: {book.ebookFile.split('_').slice(3).join('_') || book.ebookFile}
                      </Notice>
                      <Button variant="danger"
                        size="sm"
                        onClick={async () => {
                          if (!confirmDeleteEbook) {
                            setConfirmDeleteEbook(true);
                            return;
                          }
                          try {
                            await bookService.deleteEbook(book!.id!);
                            // Refresh book data
                            if (onBookUpdated) {
                              await onBookUpdated(book!.id!);
                            }
                            // Clear formData ebookFile
                            handleInputChange('ebookFile', null);
                            // Also update the book prop if possible
                            if (book) {
                              book.ebookFile = null;
                            }
                            setConfirmDeleteEbook(false);
                          } catch (error: any) {
                            console.error('Error deleting ebook:', error);
                            alert('Failed to delete ebook: ' + error.message);
                            setConfirmDeleteEbook(false);
                          }
                        }}
                      >
                        <BsTrash className="me-1" />
                        {confirmDeleteEbook ? 'Are you sure?' : 'Delete Ebook'}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`cover-upload-area ${isDragging ? 'dragging' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleEbookDrop}
                        onClick={() => ebookInputRef.current?.click()}
                        style={{ cursor: 'pointer', minHeight: '100px' }}
                      >
                        {uploadingEbook ? (
                          <div className="upload-progress">
                            <Spinner size="sm" />
                            <span className="ms-2">Uploading ebook...</span>
                          </div>
                        ) : (
                          <div className="cover-placeholder">
                            <BsUpload size={48} />
                            <p>Click or drag to upload ebook file</p>
                            <small className="text-muted">EPUB, MOBI, AZW, PDF, FB2, TXT (max 100MB)</small>
                          </div>
                        )}
                      </div>
                      <input
                        ref={ebookInputRef}
                        type="file"
                        accept=".epub,.mobi,.azw,.pdf,.fb2,.txt,application/epub+zip,application/x-mobipocket-ebook,application/pdf,application/x-fictionbook+xml,text/plain"
                        onChange={handleEbookFileChange}
                        style={{ display: 'none' }}
                        disabled={uploadingEbook}
                      />
                    </>
                  )}
                </Form.Group>
              )}


              </div>
              {/* End of Advanced Fields Section */}
            </Col>

            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Cover Image</Form.Label>

                {/* Cover Selection - Show when multiple covers available */}
                {availableCovers.length > 1 && (
                  <div className="mb-3">
                    <Form.Label style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                      Select Cover ({availableCovers.length} available)
                    </Form.Label>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '10px',
                      padding: '10px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '6px',
                      maxWidth: '100%',
                      // Show 3 rows (6 covers) above the fold, then scroll
                      maxHeight: '500px',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      scrollBehavior: 'smooth',
                      // Ensure grid items don't overlap
                      alignItems: 'start'
                    }}>
                      {availableCovers.map((cover, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            userSelectedCoverRef.current = true; // Mark that user has manually selected a cover
                            setSelectedCoverIndex(index);
                            setCoverPreview(cover.url);
                            setFormData(prev => ({ ...prev, coverUrl: cover.url }));
                          }}
                          style={{
                            position: 'relative',
                            cursor: 'pointer',
                            border: selectedCoverIndex === index 
                              ? '3px solid rgba(251, 191, 36, 0.9)' 
                              : '2px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            width: '100%',
                            height: 'auto',
                            aspectRatio: '2/3',
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedCoverIndex === index 
                              ? '0 0 0 1px rgba(251, 191, 36, 0.4)' 
                              : 'none'
                          }}
                          onMouseEnter={(e) => {
                            if (selectedCoverIndex !== index) {
                              e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.5)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedCoverIndex !== index) {
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                            }
                          }}
                        >
                          <img 
                            src={cover.url} 
                            alt={`Cover ${index + 1}`}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              cursor: 'pointer',
                              display: 'block'
                            }}
                            onError={(e) => {
                              // Hide the image if it fails to load
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                            onLoad={(e) => {
                              // Ensure image is visible when it loads successfully
                              (e.target as HTMLImageElement).style.display = 'block';
                              handleImageLoad(cover.url, e);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCoverClick(cover.url, cover.type === 'back' ? 'Back Cover' : 'Front Cover');
                            }}
                          />
                          {selectedCoverIndex === index && (
                            <div style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: 'rgba(251, 191, 36, 0.95)',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#1a202c',
                              fontSize: '14px',
                              fontWeight: 'bold'
                            }}>
                              ✓
                            </div>
                          )}
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.9)',
                            color: 'rgba(255, 255, 255, 0.85)',
                            fontSize: '9px',
                            padding: '3px 4px',
                            textAlign: 'center',
                            borderRadius: '0 0 4px 4px',
                            lineHeight: '1.1'
                          }}>
                            <div style={{ fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {cover.source} {cover.type === 'back' ? '(Back)' : ''}
                            </div>
                            {imageDimensions[cover.url] && (
                              <div style={{ fontSize: '8px', opacity: 0.8, marginTop: '1px' }}>
                                {formatImageSize(imageDimensions[cover.url].width, imageDimensions[cover.url].height)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* A new book: its cover and its back, read from its photos or chosen here, kept once it is saved. */}
                {!book?.id ? <BookCoverSlots photos={pendingPhotos} onChange={next => { setPendingPhotos(next); onPhotosChange?.(next); }} /> : (<>
                <div
                  className={`cover-upload-area ${isDragging ? 'dragging' : ''}`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => book?.id && fileInputRef.current?.click()}
                  style={{ 
                    cursor: isDragging ? 'copy' : (book?.id ? 'pointer' : 'not-allowed'), 
                    opacity: book?.id ? 1 : 0.5,
                    pointerEvents: 'auto',
                    position: 'relative'
                  }}
                >
                  {coverPreview ? (
                    <img 
                      key={`${coverPreview}-${coverPreviewKey}`} 
                      src={coverPreview.startsWith('http') ? coverPreview : (bookService.getImageUrl(coverPreview) || coverPreview)}
                      alt="Cover preview" 
                      className="cover-preview"
                      style={{ cursor: inline ? 'default' : 'pointer', pointerEvents: inline ? 'none' : 'auto' }}
                      onClick={inline ? undefined : (e) => {
                        e.stopPropagation();
                        const coverUrl = coverPreview.startsWith('http') ? coverPreview : bookService.getImageUrl(coverPreview);
                        handleCoverClick(coverUrl, 'Cover');
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        // Don't stop propagation - let parent handle it too
                      }}
                      draggable={false}
                      onError={(e) => {
                        // Hide the image if it fails to load
                        (e.target as HTMLImageElement).style.display = 'none';
                        // Don't try to access nextSibling as it may not exist in this structure
                      }}
                      onLoad={(e) => {
                        // Ensure image is visible when it loads successfully
                        (e.target as HTMLImageElement).style.display = '';
                        const coverUrl = coverPreview.startsWith('http') ? coverPreview : (bookService.getImageUrl(coverPreview) || coverPreview);
                        handleImageLoad(coverUrl, e);
                      }}
                    />
                  ) : (
                    <div className="cover-placeholder">
                      <BsUpload size={48} />
                      <p>{book?.id ? 'Click or drag to upload cover' : 'Save book first to upload cover'}</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  disabled={!book?.id || uploadingCover}
                />
                </>)}
                {uploadingCover && (
                  <div className="upload-progress">
                    <Spinner size="sm" />
                    <span className="ms-2">Uploading...</span>
                  </div>
                )}
              </Form.Group>
            </Col>
          </Row>
        </div>
      ) : (
        <Dialog.Body>
          {errors.submit && (
            <Notice tone="danger" className="mb-3">
              {errors.submit}
            </Notice>
          )}

          {uploadMessage && (
            <Notice tone={toneOf(uploadMessageType)} className="mb-3">
              {uploadMessage}
            </Notice>
          )}

          <Row>
            <Col md={8}>
              <Form.Group className="mb-3">
                <Form.Label>Title *</Form.Label>
                <TextField
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="Enter book title"
                  isInvalid={!!errors.title}
                  required
                />
                <FieldError>{errors.title}</FieldError>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Subtitle</Form.Label>
                <TextField
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => handleInputChange('subtitle', e.target.value)}
                  placeholder="Enter subtitle"
                />
              </Form.Group>

              <Row className="g-2 mb-2">
                <Col md={6} className="ps-0">
                  <Form.Group className="mb-2">
                    <Form.Label>Book Type</Form.Label>
                    <Select
                      value={formData.bookType || 'book'}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        console.log('[BookForm] User changed bookType dropdown to:', newValue, 'current formData.bookType:', formData.bookType);
                        // Set the ref FIRST - this is critical to prevent useEffect from resetting it
                        userSelectedBookTypeRef.current = true;
                        console.log('[BookForm] Set userSelectedBookTypeRef to true');
                        // Update state directly - this should trigger a re-render with the new value
                        setFormData(prev => {
                          const updated = { ...prev, bookType: newValue };
                          console.log('[BookForm] Direct setFormData update - bookType changed from', prev.bookType, 'to', newValue);
                          return updated;
                        });
                      }}
                    >
                      <option value="book">Book</option>
                      <option value="graphic-novel">Graphic Novel</option>
                      <option value="score">Score</option>
                    </Select>
                  </Form.Group>
                </Col>
                <Col md={6} className="pe-0">
                  <Form.Group className="mb-2">
                    <Form.Label>Status</Form.Label>
                    <Select
                      value={formData.titleStatus}
                      onChange={(e) => handleInputChange('titleStatus', e.target.value)}
                    >
                      <option value="owned">Owned</option>
                      <option value="borrowed">Borrowed</option>
                      <option value="wish">Wish</option>
                    </Select>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-2">
                <Col md={6} className="ps-0">
                  <Form.Group className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <Form.Label className="mb-0">Series</Form.Label>
                      {book?._metadataSources && (book._metadataSources.googleBooks?.series || book._metadataSources.openLibrary?.series) && (
                        <div className="d-flex align-items-center gap-2">
                          <Select
                            size="sm"
                            style={{ width: 'auto', minWidth: '120px' }}
                            value={selectedMetadataSource.series}
                            onChange={(e) => {
                              const source = e.target.value;
                              setSelectedMetadataSource(prev => ({ ...prev, series: source }));
                              const newValue = getMetadataValue('series', source);
                              handleInputChange('series', newValue);
                            }}
                          >
                            <option value="auto">Auto</option>
                            {getAvailableSources('series').map(source => (
                              <option key={source.key} value={source.key}>{source.label}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                    <TextField
                      type="text"
                      value={formData.series}
                      onChange={(e) => handleInputChange('series', e.target.value)}
                      placeholder="Enter series name"
                    />
                  </Form.Group>
                </Col>
                <Col md={6} className="pe-0">
                  <Form.Group className="mb-3">
                    <Form.Label>Series Number</Form.Label>
                    <TextField
                      type="number"
                      value={formData.seriesNumber}
                      onChange={(e) => handleInputChange('seriesNumber', e.target.value)}
                      placeholder="e.g., 1"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Author(s)</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.authors) ? formData.authors.join(', ') : formData.authors}
                  onChange={(e) => handleAuthorsInputChange(e.target.value)}
                  onBlur={(e) => handleAuthorsInputBlur(e.target.value)}
                  placeholder="Enter authors (comma-separated)"
                />
              </Form.Group>


              <Form.Group className="mb-3">
                <Form.Label>Belongs to</Form.Label>
                <div style={{ position: 'relative' }}>
                  <TextField
                    ref={ownerInputRef}
                    type="text"
                    value={formData.owner}
                    onChange={(e) => {
                      handleInputChange('owner', e.target.value);
                      updateDropdownPosition();
                    }}
                    onKeyDown={handleOwnerKeyDown}
                    onBlur={handleOwnerBlur}
                    onFocus={handleOwnerFocus}
                    placeholder="Enter owner name"
                  />
                </div>
              </Form.Group>
              
              {showOwnerSuggestions && ownerSuggestions.length > 0 && dropdownPosition.width > 0 && createPortal(
                <div 
                  ref={ownerDropdownRef}
                  className="autocomplete-suggestions"
                  style={{
                    position: 'fixed',
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                    width: `${dropdownPosition.width}px`,
                    zIndex: 99999,
                    backgroundColor: '#212529',
                    border: '1px solid #495057',
                    borderRadius: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    marginTop: '2px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)'
                  }}
                >
                  {ownerSuggestions.map((owner, index) => (
                    <div
                      key={index}
                      className={`autocomplete-suggestion ${
                        index === highlightedOwnerIndex ? 'highlighted' : ''
                      }`}
                      onClick={() => handleOwnerSuggestionClick(owner)}
                      style={{
                        padding: '0.5rem',
                        cursor: 'pointer',
                        backgroundColor: index === highlightedOwnerIndex ? '#495057' : 'transparent',
                        color: '#f8f9fa',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={() => setHighlightedOwnerIndex(index)}
                    >
                      {owner}
                    </div>
                  ))}
                </div>,
                document.body
              )}

              {/* Advanced Fields Toggle for Modal Form */}
              <div 
                className="advanced-toggle"
                onClick={() => {
                  const newValue = !showAdvanced;
                  setShowAdvanced(newValue);
                  writeStored('bookdex-show-advanced-form', newValue.toString());
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 0',
                  cursor: 'pointer',
                  color: '#fbbf24',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  borderBottom: showAdvanced ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                  marginTop: '8px',
                  marginBottom: showAdvanced ? '12px' : '0'
                }}
              >
                {showAdvanced ? <BsChevronDown size={14} /> : <BsChevronRight size={14} />}
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                  {showAdvanced ? 'Hide' : 'Show'} Additional Fields
                </span>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)', marginLeft: 'auto' }}>
                  ISBN, Publisher, Genres, Description...
                </span>
              </div>

              {/* Advanced Fields Section for Modal Form */}
              <div style={{ display: showAdvanced ? 'block' : 'none' }}>

              <Form.Group className="mb-3">
                <Form.Label>Artist(s) / Illustrator(s)</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.artists) ? formData.artists.join(', ') : formData.artists}
                  onChange={(e) => handleArtistsInputChange(e.target.value)}
                  onBlur={(e) => handleArtistsInputBlur(e.target.value)}
                  placeholder="Enter artists/illustrators (comma-separated, e.g., for comics)"
                />
              </Form.Group>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>ISBN-10</Form.Label>
                    <TextField
                      type="text"
                      value={formData.isbn}
                      onChange={(e) => handleInputChange('isbn', e.target.value)}
                      placeholder="Enter ISBN-10"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>ISBN-13</Form.Label>
                    <TextField
                      type="text"
                      value={formData.isbn13}
                      onChange={(e) => handleInputChange('isbn13', e.target.value)}
                      placeholder="Enter ISBN-13"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Publisher</Form.Label>
                    <TextField
                      type="text"
                      value={formData.publisher}
                      onChange={(e) => handleInputChange('publisher', e.target.value)}
                      placeholder="Enter publisher"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Published Year</Form.Label>
                    <TextField
                      type="number"
                      value={formData.publishedYear}
                      onChange={(e) => handleInputChange('publishedYear', e.target.value)}
                      placeholder="e.g., 2020"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Language</Form.Label>
                    <TextField
                      type="text"
                      value={formData.language}
                      onChange={(e) => handleInputChange('language', e.target.value)}
                      placeholder="e.g., en, fr, de"
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Book Type</Form.Label>
                    <Select
                      value={formData.bookType || 'book'}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        console.log('[BookForm] User changed bookType dropdown to:', newValue, 'current formData.bookType:', formData.bookType);
                        // Set the ref FIRST - this is critical to prevent useEffect from resetting it
                        userSelectedBookTypeRef.current = true;
                        console.log('[BookForm] Set userSelectedBookTypeRef to true');
                        // Update state directly - this should trigger a re-render with the new value
                        setFormData(prev => {
                          const updated = { ...prev, bookType: newValue };
                          console.log('[BookForm] Direct setFormData update - bookType changed from', prev.bookType, 'to', newValue);
                          return updated;
                        });
                      }}
                    >
                      <option value="book">Book</option>
                      <option value="graphic-novel">Graphic Novel</option>
                      <option value="score">Score</option>
                    </Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Format</Form.Label>
                    <Select
                      value={formData.format}
                      onChange={(e) => handleInputChange('format', e.target.value)}
                    >
                      <option value="physical">Physical</option>
                      <option value="ebook">E-book</option>
                      <option value="audiobook">Audiobook</option>
                    </Select>
                  </Form.Group>
                </Col>
              </Row>

              {formData.format === 'ebook' && (
                <>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>File Type</Form.Label>
                        <TextField
                          type="text"
                          value={formData.filetype}
                          onChange={(e) => handleInputChange('filetype', e.target.value)}
                          placeholder="e.g., EPUB, PDF"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>DRM</Form.Label>
                        <TextField
                          type="text"
                          value={formData.drm}
                          onChange={(e) => handleInputChange('drm', e.target.value)}
                          placeholder="e.g., None, Adobe DRM"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}

              {formData.format === 'audiobook' && (
                <>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Narrator</Form.Label>
                        <TextField
                          type="text"
                          value={formData.narrator}
                          onChange={(e) => handleInputChange('narrator', e.target.value)}
                          placeholder="Enter narrator name"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Runtime (minutes)</Form.Label>
                        <TextField
                          type="number"
                          value={formData.runtime}
                          onChange={(e) => handleInputChange('runtime', e.target.value)}
                          placeholder="e.g., 720"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}

              <Form.Group className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <Form.Label className="mb-0">Genres</Form.Label>
                  {book?._metadataSources && (book._metadataSources.googleBooks?.genres || book._metadataSources.openLibrary?.genres) && (
                    <small style={{ color: '#fbbf24' }}>
                      ✓ Aggregated from {[book._metadataSources.googleBooks?.genres, book._metadataSources.openLibrary?.genres].filter(g => g).length} source(s)
                    </small>
                  )}
                </div>
                <TextField
                  type="text"
                  value={Array.isArray(formData.genres) ? formData.genres.join(', ') : (formData.genres || '')}
                  onChange={(e) => handleArrayInputChange('genres', e.target.value)}
                  onBlur={(e) => handleArrayInputBlur('genres', e.target.value)}
                  placeholder="Enter genres (comma-separated)"
                />
                {book?._metadataSources && Array.isArray(formData.genres) && formData.genres.length > 0 && (
                  <Form.Text className="text-muted">
                    Combined from all sources ({formData.genres.length} genre{formData.genres.length !== 1 ? 's' : ''})
                  </Form.Text>
                )}
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Tags</Form.Label>
                <TextField
                  type="text"
                  value={Array.isArray(formData.tags) ? formData.tags.join(', ') : (formData.tags || '')}
                  onChange={(e) => handleArrayInputChange('tags', e.target.value)}
                  onBlur={(e) => handleArrayInputBlur('tags', e.target.value)}
                  placeholder="Enter tags (comma-separated)"
                />
              </Form.Group>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Rating</Form.Label>
                    <TextField
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      value={formData.rating}
                      onChange={(e) => handleInputChange('rating', e.target.value)}
                      placeholder="0-5"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Page Count</Form.Label>
                    <TextField
                      type="number"
                      value={formData.pageCount}
                      onChange={(e) => handleInputChange('pageCount', e.target.value)}
                      placeholder="e.g., 350"
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Read Date</Form.Label>
                    <TextField
                      type="date"
                      value={formData.readDate}
                      onChange={(e) => handleInputChange('readDate', e.target.value)}
                      placeholder="Date when you finished reading this book"
                    />
                    <Form.Text className="text-muted">
                      Leave empty if you haven't read this book yet
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <Form.Label className="mb-0">Description</Form.Label>
                  {book?._metadataSources && (book._metadataSources.googleBooks || book._metadataSources.openLibrary) && (
                    <div className="d-flex align-items-center gap-2">
                      <small className="text-muted">Source:</small>
                      <Select
                        size="sm"
                        style={{ width: 'auto', minWidth: '150px' }}
                        value={selectedMetadataSource.description}
                        onChange={(e) => {
                          const source = e.target.value;
                          userSelectedSourceRef.current = true; // Mark that user has selected a source
                          setSelectedMetadataSource(prev => ({ ...prev, description: source }));
                          // The useEffect will handle updating the formData.description
                        }}
                      >
                        <option value="auto">Auto (Longest)</option>
                        {getAvailableSources('description').map(source => (
                          <option key={source.key} value={source.key}>{source.label}</option>
                        ))}
                      </Select>
                      <small style={{ color: '#fbbf24' }}>
                        ✓ Enriched
                      </small>
                    </div>
                  )}
                </div>
                <TextArea
                  rows={4}
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Enter book description"
                />
                {book?._metadataSources && getAvailableSources('description').length > 0 && (
                  <Form.Text className="text-muted">
                    {getAvailableSources('description').length} source(s) available
                  </Form.Text>
                )}
              </Form.Group>

              {book?.id && (
                <Form.Group className="mb-3">
                  <Form.Label>Ebook File</Form.Label>
                  {book.ebookFile ? (
                    <div className="mb-3">
                      <Notice tone="info" className="mb-2">
                        <BsFileEarmark className="me-2" />
                        Ebook file uploaded: {book.ebookFile.split('_').slice(3).join('_') || book.ebookFile}
                      </Notice>
                      <Button variant="danger"
                        size="sm"
                        onClick={async () => {
                          if (!confirmDeleteEbook) {
                            setConfirmDeleteEbook(true);
                            return;
                          }
                          try {
                            await bookService.deleteEbook(book!.id!);
                            // Refresh book data
                            if (onBookUpdated) {
                              await onBookUpdated(book!.id!);
                            }
                            // Clear formData ebookFile
                            handleInputChange('ebookFile', null);
                            // Also update the book prop if possible
                            if (book) {
                              book.ebookFile = null;
                            }
                            setConfirmDeleteEbook(false);
                          } catch (error: any) {
                            console.error('Error deleting ebook:', error);
                            alert('Failed to delete ebook: ' + error.message);
                            setConfirmDeleteEbook(false);
                          }
                        }}
                      >
                        <BsTrash className="me-1" />
                        {confirmDeleteEbook ? 'Are you sure?' : 'Delete Ebook'}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`cover-upload-area ${isDragging ? 'dragging' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleEbookDrop}
                        onClick={() => ebookInputRef.current?.click()}
                        style={{ cursor: 'pointer', minHeight: '100px' }}
                      >
                        {uploadingEbook ? (
                          <div className="upload-progress">
                            <Spinner size="sm" />
                            <span className="ms-2">Uploading ebook...</span>
                          </div>
                        ) : (
                          <div className="cover-placeholder">
                            <BsUpload size={48} />
                            <p>Click or drag to upload ebook file</p>
                            <small className="text-muted">EPUB, MOBI, AZW, PDF, FB2, TXT (max 100MB)</small>
                          </div>
                        )}
                      </div>
                      <input
                        ref={ebookInputRef}
                        type="file"
                        accept=".epub,.mobi,.azw,.pdf,.fb2,.txt,application/epub+zip,application/x-mobipocket-ebook,application/pdf,application/x-fictionbook+xml,text/plain"
                        onChange={handleEbookFileChange}
                        style={{ display: 'none' }}
                        disabled={uploadingEbook}
                      />
                    </>
                  )}
                </Form.Group>
              )}


              </div>
              {/* End of Advanced Fields Section for Modal Form */}
            </Col>

            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Cover Image</Form.Label>
                
                {/* Cover Selection - Show when multiple covers available */}
                {availableCovers.length > 1 && (
                  <div className="mb-3">
                    <Form.Label style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                      Select Cover ({availableCovers.length} available)
                    </Form.Label>
                    <div style={{ 
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '10px',
                      padding: '10px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '6px',
                      maxWidth: '100%',
                      // Show 3 rows (6 covers) above the fold, then scroll
                      maxHeight: '500px',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      scrollBehavior: 'smooth',
                      // Ensure grid items don't overlap
                      alignItems: 'start'
                    }}>
                      {availableCovers.map((cover, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            userSelectedCoverRef.current = true; // Mark that user has manually selected a cover
                            setSelectedCoverIndex(index);
                            setCoverPreview(cover.url);
                            setFormData(prev => ({ ...prev, coverUrl: cover.url }));
                          }}
                          style={{
                            position: 'relative',
                            cursor: 'pointer',
                            border: selectedCoverIndex === index 
                              ? '3px solid rgba(251, 191, 36, 0.9)' 
                              : '2px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            width: '100%',
                            height: 'auto',
                            aspectRatio: '2/3',
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedCoverIndex === index 
                              ? '0 0 0 1px rgba(251, 191, 36, 0.4)' 
                              : 'none'
                          }}
                          onMouseEnter={(e) => {
                            if (selectedCoverIndex !== index) {
                              e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.5)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedCoverIndex !== index) {
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                            }
                          }}
                        >
                          <img 
                            src={cover.url} 
                            alt={`Cover ${index + 1}`}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              cursor: 'pointer',
                              display: 'block'
                            }}
                            onError={(e) => {
                              // Hide the image if it fails to load
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                            onLoad={(e) => {
                              // Ensure image is visible when it loads successfully
                              (e.target as HTMLImageElement).style.display = 'block';
                              handleImageLoad(cover.url, e);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCoverClick(cover.url, cover.type === 'back' ? 'Back Cover' : 'Front Cover');
                            }}
                          />
                          {selectedCoverIndex === index && (
                            <div style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: 'rgba(251, 191, 36, 0.95)',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#1a202c',
                              fontSize: '14px',
                              fontWeight: 'bold'
                            }}>
                              ✓
                            </div>
                          )}
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.9)',
                            color: 'rgba(255, 255, 255, 0.85)',
                            fontSize: '9px',
                            padding: '3px 4px',
                            textAlign: 'center',
                            borderRadius: '0 0 4px 4px',
                            lineHeight: '1.1'
                          }}>
                            <div style={{ fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {cover.source} {cover.type === 'back' ? '(Back)' : ''}
                            </div>
                            {imageDimensions[cover.url] && (
                              <div style={{ fontSize: '8px', opacity: 0.8, marginTop: '1px' }}>
                                {formatImageSize(imageDimensions[cover.url].width, imageDimensions[cover.url].height)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* A new book: its cover and its back, read from its photos or chosen here, kept once it is saved. */}
                {!book?.id ? <BookCoverSlots photos={pendingPhotos} onChange={next => { setPendingPhotos(next); onPhotosChange?.(next); }} /> : (<>
                <div
                  className={`cover-upload-area ${isDragging ? 'dragging' : ''}`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => book?.id && fileInputRef.current?.click()}
                  style={{ 
                    cursor: isDragging ? 'copy' : (book?.id ? 'pointer' : 'not-allowed'), 
                    opacity: book?.id ? 1 : 0.5,
                    pointerEvents: 'auto',
                    position: 'relative'
                  }}
                >
                  {coverPreview ? (
                    <img 
                      key={`${coverPreview}-${coverPreviewKey}`} 
                      src={coverPreview.startsWith('http') ? coverPreview : (bookService.getImageUrl(coverPreview) || coverPreview)}
                      alt="Cover preview" 
                      className="cover-preview"
                      style={{ cursor: inline ? 'default' : 'pointer', pointerEvents: inline ? 'none' : 'auto' }}
                      onClick={inline ? undefined : (e) => {
                        e.stopPropagation();
                        const coverUrl = coverPreview.startsWith('http') ? coverPreview : bookService.getImageUrl(coverPreview);
                        handleCoverClick(coverUrl, 'Cover');
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        // Don't stop propagation - let parent handle it too
                      }}
                      draggable={false}
                      onError={(e) => {
                        // Hide the image if it fails to load
                        (e.target as HTMLImageElement).style.display = 'none';
                        // Don't try to access nextSibling as it may not exist in this structure
                      }}
                      onLoad={(e) => {
                        // Ensure image is visible when it loads successfully
                        (e.target as HTMLImageElement).style.display = '';
                        const coverUrl = coverPreview.startsWith('http') ? coverPreview : (bookService.getImageUrl(coverPreview) || coverPreview);
                        handleImageLoad(coverUrl, e);
                      }}
                    />
                  ) : (
                    <div className="cover-placeholder">
                      <BsUpload size={48} />
                      <p>{book?.id ? 'Click or drag to upload cover' : 'Save book first to upload cover'}</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  disabled={!book?.id || uploadingCover}
                />
                </>)}
                {uploadingCover && (
                  <div className="upload-progress">
                    <Spinner size="sm" />
                    <span className="ms-2">Uploading...</span>
                  </div>
                )}
              </Form.Group>
            </Col>
          </Row>
        </Dialog.Body>
      )}
        
      {!inline && (
        <Dialog.Footer>
          {onShowOtherResults && (
            <Button variant="quiet" onClick={onShowOtherResults} disabled={loading}>
              Wrong book? Show other results
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="quiet" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={loading}>
            {loading ? 'Saving...' : (book?.id ? 'Update Book' : 'Create Book')}
          </Button>
        </Dialog.Footer>
      )}
      </Form>
  );

  if (inline) {
    return (
      <>
        {formContent}
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
  }

  return (
    <Dialog
      onClose={() => onCancel?.()}
      size="lg"
      zIndex={10100}
      className="book-form-modal"
      title={book?.id ? 'Edit Book' : 'Add New Book'}
      header={false}
    >
      {formContent}
      
      <CoverModal
        isOpen={showCoverModal}
        onClose={handleCloseCoverModal}
        coverUrl={coverModalData.coverUrl}
        title={coverModalData.title}
        artist={coverModalData.author}
        coverType={coverModalData.coverType || 'Cover'}
      />
    </Dialog>
  );
};

export default BookForm;

