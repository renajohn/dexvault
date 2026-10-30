import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import { BsTrash, BsCurrencyDollar, BsBookmarkCheck, BsClipboard, BsDisc, BsFilm, BsBook, BsFileEarmark, BsPlus, BsSearch, BsBoxArrowUp } from 'react-icons/bs';
import apiService from '../services/api';
import musicService from '../services/musicService';
import { base64ToFile } from '../utils/downscaleImage';
import bookService from '../services/bookService';
import MovieThumbnail from '../components/MovieThumbnail';
import MovieDetailCard from '../components/MovieDetailCard';
import MusicDetailCard from '../components/MusicDetailCard';
import { findById, useDetailSteps } from '../utils/detailSteps';
import { albumImages, bookImages, movieImages } from '../utils/detailImages';
import BookThumbnail from '../components/BookThumbnail';
import BookDetailCard from '../components/BookDetailCard';
import AddMusicDialog from '../components/AddMusicDialog';
import BoughtCdDialog from '../components/BoughtCdDialog';
import MovieFinder, { MovieBuying, MovieFinderHead } from '../components/MovieFinder';
import BookFinder, { BookBuying, BookFinderHead } from '../components/BookFinder';
import AddBookDialog from '../components/AddBookDialog';
import MusicForm from '../components/MusicForm';
import CircularProgressBar from '../components/CircularProgressBar';
import './WishListPage.css';
import CoverButton from '../components/shared/CoverButton';
import Select from '../components/shared/Select';
import Button, { IconButton } from '../components/shared/Button';
import Dialog from '../components/shared/Dialog';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { TextArea, TextField } from '../components/shared/TextField';
import Notice from '../components/shared/Notice';
import CoverTag from '../components/shared/CoverTag';
import Spinner, { Loading } from '../components/shared/Spinner';
import { thumbProps } from '../utils/thumb';
import { openRicardo, ricardoSearchUrl } from '../utils/digitalLibrary';
import { parseWishlistSearch } from '../utils/wishlistSearch';
import SwipeRow, { type SwipeAction, type SwipeDeed } from '../components/SwipeRow';
import useNarrow, { useMedia } from '../utils/useNarrow';
import { setAlbumManagement, showAlbum, type ShownAlbum } from '../services/phoneDoor';
import { toast } from '../components/shared/Toast';
import { readStored, writeStored } from '../utils/safeStorage';
import copyText from '../utils/copyText';

/** Set once the first row has shown, on a phone, that the rows slide. */
const SWIPE_HINT_KEY = 'dexvault-wishlist-swipe-hint';


export interface WishListPageRef {
  refreshItems: () => Promise<void>;
}

interface WishListPageProps {
  searchCriteria?: { searchText?: string; [key: string]: any };
  onAddMovie?: (mode: string) => void;
  onAddAlbum?: (mode: string) => void;
  onAddBook?: (mode: string) => void;
  onMovieMovedToCollection?: () => void;
  onAlbumMovedToCollection?: (album: any) => void;
  onBookMovedToCollection?: (book: any) => void;
  onShowAlert?: (message: string, type: string) => void;
  onMovieAdded?: (message: string, type: string) => void;
  onAlbumAdded?: (id?: number) => void;
  onBookAdded?: (id?: number) => void;
  onSearch?: (criteria: any) => void;
}

interface DeleteModalState {
  show: boolean;
  itemId: number | null;
  itemType: string | null;
}

const WishListPage = forwardRef<WishListPageRef, WishListPageProps>(({ searchCriteria, onAddMovie, onAddAlbum, onAddBook, onMovieMovedToCollection, onAlbumMovedToCollection, onBookMovedToCollection, onShowAlert, onMovieAdded, onAlbumAdded, onBookAdded, onSearch }, ref) => {
  const navigate = useNavigate();
  const [allMovies, setAllMovies] = useState<any[]>([]);
  const [movies, setMovies] = useState<any[]>([]);
  const [allAlbums, setAllAlbums] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [allBooks, setAllBooks] = useState<any[]>([]);
  // A wished album bought: which CD, then how it was bought.
  const [buyingAlbum, setBuyingAlbum] = useState<any>(null);
  // A wished movie bought, or its wished box set: which edition, then it is of the collection.
  const [buyingMovies, setBuyingMovies] = useState<MovieBuying | null>(null);
  const [buyingHead, setBuyingHead] = useState<MovieFinderHead>({ title: 'Which edition did you buy?' });
  const [buyingBooks, setBuyingBooks] = useState<BookBuying | null>(null);
  const [buyingBookHead, setBuyingBookHead] = useState<BookFinderHead>({ title: 'Which edition did you buy?' });
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedMovieDetails, setSelectedMovieDetails] = useState<any>(null);
  const [selectedAlbumDetails, setSelectedAlbumDetails] = useState<any>(null);
  const [selectedBookDetails, setSelectedBookDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<DeleteModalState>({ show: false, itemId: null, itemType: null });
  const [showAddMusicDialog, setShowAddMusicDialog] = useState(false);
  const [showMusicForm, setShowMusicForm] = useState(false);
  // A form pre-filled from a photographed sleeve; null means a blank form.
  const [sleeveDraft, setSleeveDraft] = useState<any>(null);
  // The photographed sleeve waits for an album id, which exists only on save.
  const [pendingCover, setPendingCover] = useState<{ base64: string; mimeType: string } | null>(null);
  const [pendingBack, setPendingBack] = useState<{ base64: string; mimeType: string } | null>(null);
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [addError, setAddError] = useState('');
  const [showAddBookDialog, setShowAddBookDialog] = useState(false);
  const [addingBook, setAddingBook] = useState(false);
  const [addBookError, setAddBookError] = useState('');

  useEffect(() => {
    loadWishListItems();
  }, []);

  useImperativeHandle(ref, () => ({
    // Refreshed under an open window (adding a movie): no loading screen.
    refreshItems: () => loadWishListItems({ quiet: true })
  }));

  // quiet: the list refreshed under an open window (the album finder), which a
  // loading screen would unmount, and its search with it.
  const loadWishListItems = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError('');

      // Load movies, albums, and books in parallel
      const [wishListMovies, wishListAlbums, wishListBooks] = await Promise.all([
        apiService.getMoviesByStatus('wish') as Promise<any[]>,
        musicService.getAlbumsByStatus('wish') as Promise<any[]>,
        bookService.getBooksByStatus('wish') as Promise<any[]>
      ]);

      setAllMovies(wishListMovies);
      setMovies(wishListMovies);
      setAllAlbums(wishListAlbums);
      setAlbums(wishListAlbums);
      setAllBooks(wishListBooks);
      setBooks(wishListBooks);
    } catch (err) {
      setError('Failed to load wish list: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Filter items based on search text from searchCriteria
  useEffect(() => {
    const searchText = searchCriteria?.searchText || '';
    if (!searchText || searchText.trim() === '') {
      setMovies(allMovies);
      setAlbums(allAlbums);
      setBooks(allBooks);
    } else {
      // Use the same advanced search logic for movies, albums, and books
      performAdvancedSearch(searchText);
    }
  }, [searchCriteria, allMovies, allAlbums, allBooks]);

  // The search read (utils/wishlistSearch.ts): the movies by the backend, as FilmDex's, the albums and books here.
  const performAdvancedSearch = async (searchText: string) => {
    const search = parseWishlistSearch(searchText);
    setAlbums(allAlbums.filter(album => album.titleStatus === 'wish' && search.matchAlbum(album)));
    setBooks(allBooks.filter(book => book.titleStatus === 'wish' && search.matchBook(book)));
    if (search.movieQuery === null) {
      setMovies([]);
      return;
    }
    if (!search.movieQuery.trim()) {
      setMovies(allMovies);
      return;
    }
    try {
      setMovies(await apiService.searchMovies({ searchText: search.movieQuery, title_status: 'wish' }) as any[]);
    } catch (error) {
      console.error('Wish list search failed:', error);
      // The backend out of reach: its plain words in the movies loaded.
      const searchLower = searchText.toLowerCase().trim();
      setMovies(allMovies.filter(movie => [movie.title, movie.original_title, movie.director, movie.comments]
        .some(field => field && String(field).toLowerCase().includes(searchLower))));
    }
  };

  const handleDeleteItem = async (itemId: number, itemType: string) => {
    try {
      setDeletingId(itemId);
      if (itemType === 'movie') {
        await apiService.deleteMovie(itemId);
        setAllMovies(allMovies.filter(movie => movie.id !== itemId));
        setMovies(movies.filter(movie => movie.id !== itemId));
      } else if (itemType === 'album') {
        await musicService.deleteAlbum(itemId);
        setAllAlbums(allAlbums.filter(album => album.id !== itemId));
        setAlbums(albums.filter(album => album.id !== itemId));
      } else if (itemType === 'book') {
        await bookService.deleteBook(itemId);
        setAllBooks(allBooks.filter(book => book.id !== itemId));
        setBooks(books.filter(book => book.id !== itemId));
      }
    } catch (err) {
      setError(`Failed to delete ${itemType}: ` + (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };


  const handleAddMovie = () => {
    if (onAddMovie) {
      onAddMovie('wishlist');
    } else {
      navigate('/add-movie-simple?mode=wishlist');
    }
  };

  const handleAddAlbum = () => {
    setShowAddMusicDialog(true);
  };

  const handleAddBook = () => {
    setShowAddBookDialog(true);
  };

  const handleAddBookDialogClose = () => {
    setShowAddBookDialog(false);
  };

  const handleAddBookToWishlist = async (bookData: any) => {
    try {
      // Set the book status to 'wish' for wish list, preserving all other data
      const bookDataWithStatus = { ...bookData, titleStatus: 'wish' };
      const newBook = await bookService.addBook(bookDataWithStatus) as any;

      // Refresh the books list
      loadWishListItems();
      setShowAddBookDialog(false);

      if (onBookAdded) {
        onBookAdded(newBook.id);
      }

      return newBook;
    } catch (error) {
      console.error('Error adding book:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add book: ' + (error as Error).message, 'danger');
      }
      throw error;
    }
  };

  const handleAddMusicDialogClose = () => {
    setShowAddMusicDialog(false);
  };

  const handleAddCd = async (cdData: any) => {
    try {
      // Set the album status to 'wish' for wish list, preserving all other data
      const albumData = { ...cdData, titleStatus: 'wish' };
      const newAlbum = await musicService.addAlbum(albumData) as any;

      // A record no database knows has no artwork to download, so the
      // photographed sleeve is the only cover it will ever have. Stored before
      // the list refreshes, or the grid paints a coverless album.
      if (newAlbum?.id && (pendingCover || pendingBack)) {
        if (pendingCover) {
          try {
            const file = base64ToFile(pendingCover.base64, pendingCover.mimeType, 'sleeve.jpg');
            await musicService.uploadCover(newAlbum.id, file);
          } catch (err) {
            console.warn('Could not store the sleeve photo as the cover:', err);
          }
        }
        if (pendingBack) {
          try {
            const file = base64ToFile(pendingBack.base64, pendingBack.mimeType, 'sleeve-back.jpg');
            await musicService.uploadBackCover(newAlbum.id, file);
          } catch (err) {
            console.warn('Could not store the sleeve photo as the back cover:', err);
          }
        }
        setPendingCover(null);
            setPendingBack(null);
          }

      // Refresh the albums list
      loadWishListItems();
      setShowAddMusicDialog(false);

      if (onAlbumAdded) {
        onAlbumAdded(newAlbum.id);
      }
    } catch (error) {
      console.error('Error adding album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add album: ' + (error as Error).message, 'danger');
      }
    }
  };

  const handleAddCdFromMusicBrainz = async (releaseId: string, additionalData: any) => {
    try {
      // Set the album status to 'wish' for wish list
      const albumData = { ...additionalData, titleStatus: 'wish' };
      const newAlbum = await musicService.addAlbumFromMusicBrainz(releaseId, albumData) as any;

      // Refresh the albums list
      loadWishListItems();
      setShowAddMusicDialog(false);

      if (onAlbumAdded) {
        onAlbumAdded(newAlbum.id);
      }
    } catch (error) {
      console.error('Error adding album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add album: ' + (error as Error).message, 'danger');
      }
    }
  };

  const handleAddCdByBarcode = async (barcode: string, additionalData: any) => {
    try {
      // Set the album status to 'wish' for wish list
      const albumData = { ...additionalData, titleStatus: 'wish' };
      const newAlbum = await musicService.addAlbumByBarcode(barcode, albumData) as any;

      // Refresh the albums list
      loadWishListItems();
      setShowAddMusicDialog(false);

      if (onAlbumAdded) {
        onAlbumAdded(newAlbum.id);
      }
    } catch (error) {
      console.error('Error adding album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add album: ' + (error as Error).message, 'danger');
      }
    }
  };

  const handleReviewMetadata = async (release: any, allReleasesInGroup: any) => {
    console.log('handleReviewMetadata called with:', {
      release: release ? (release.title || release.id) : 'null',
      allReleasesInGroup: allReleasesInGroup ? allReleasesInGroup.length : 'undefined'
    });

    if (release === null) {
      // Manual entry case - open MusicForm
      console.log('Opening MusicForm for manual entry');
      setShowAddMusicDialog(false);
      setShowMusicForm(true);
      return;
    }

    // Check if this is an album object (from the new workflow) or a release object (from the old workflow)
    if (release.id && !release.musicbrainzReleaseId) {
      // This is an album object from the new workflow - open detail view
      console.log('Opening detail view for album:', release.title);
      setShowAddMusicDialog(false);

      // Refresh the albums list to include the new album
      loadWishListItems();

      if (onAlbumAdded) {
        onAlbumAdded(release.id);
      }
      return;
    }

    // Old workflow - add the album directly without review
    try {
      console.log('Adding album directly to wish list:', release.title);
      setAddingAlbum(true);

      // Use the MusicBrainz service to add the album with full metadata
      const newAlbum = await musicService.addAlbumFromMusicBrainz(
        release.musicbrainzReleaseId,
        { titleStatus: 'wish' }
      ) as any;

      // Refresh the albums list
      loadWishListItems();
      setShowAddMusicDialog(false);

      if (onAlbumAdded) {
        onAlbumAdded(newAlbum.id);
      }

      console.log('Album added successfully:', newAlbum.title);
    } catch (error) {
      console.error('Error adding album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add album: ' + (error as Error).message, 'danger');
      }
    } finally {
      setAddingAlbum(false);
    }
  };

  const handleMusicFormClose = () => {
    setSleeveDraft(null);
    console.log('Closing MusicForm');
    setShowMusicForm(false);
  };

  const handleMusicFormSave = async (cdData: any) => {
    try {
      // Set the album status to 'wish' for wish list
      const albumData = { ...cdData, titleStatus: 'wish' };
      const newAlbum = await musicService.addAlbum(albumData) as any;

      // Refresh the albums list
      loadWishListItems();
      setShowMusicForm(false);

      if (onAlbumAdded) {
        onAlbumAdded(newAlbum.id);
      }

      return newAlbum;
    } catch (error) {
      console.error('Error adding album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add album: ' + (error as Error).message, 'danger');
      }
      throw error;
    }
  };

  const handleItemClick = async (itemId: number, itemType: string) => {
    try {
      setLoadingDetails(true);
      if (itemType === 'movie') {
        const movieDetails = await apiService.getMovieDetails(itemId);
        setSelectedMovieDetails(movieDetails);
        setSelectedAlbumDetails(null);
        setSelectedBookDetails(null);
      } else if (itemType === 'album') {
        const albumDetails = await musicService.getAlbumById(itemId);
        // On a phone, the full screen player on the album, its info first: what to do about the wish.
        if (phone) showAlbum(albumDetails as ShownAlbum, 'info');
        else setSelectedAlbumDetails(albumDetails);
        setSelectedMovieDetails(null);
        setSelectedBookDetails(null);
      } else if (itemType === 'book') {
        const bookDetails = await bookService.getBookById(itemId);
        setSelectedBookDetails(bookDetails);
        setSelectedMovieDetails(null);
        setSelectedAlbumDetails(null);
      }
    } catch (error) {
      console.error(`Failed to load ${itemType} details:`, error);
      setError(`Failed to load ${itemType} details: ` + (error as Error).message);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedMovieDetails(null);
    setSelectedAlbumDetails(null);
    setSelectedBookDetails(null);
  };

  // An open item's details step through its table, in the table's order.
  const movieSteps = useDetailSteps(movies.map(movie => movie.id), selectedMovieDetails?.id, id => apiService.getMovieDetails(id), setSelectedMovieDetails,
    { imagesOf: movieImages, summaryOf: id => findById(id, movies) });
  const albumSteps = useDetailSteps(albums.map(album => album.id), selectedAlbumDetails?.id, id => musicService.getAlbumById(id), setSelectedAlbumDetails,
    { imagesOf: albumImages, summaryOf: id => findById(id, albums) });
  const bookSteps = useDetailSteps(books.map(book => book.id), selectedBookDetails?.id, id => bookService.getBookById(id), setSelectedBookDetails,
    { imagesOf: bookImages, summaryOf: id => findById(id, books) });

  const handleBookClick = async (bookId: number) => {
    try {
      setLoadingDetails(true);
      const bookDetails = await bookService.getBookById(bookId);
      setSelectedBookDetails(bookDetails);
      setSelectedMovieDetails(null);
      setSelectedAlbumDetails(null);
    } catch (error) {
      console.error('Failed to load book details:', error);
      setError('Failed to load book details: ' + (error as Error).message);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Refresh function for detail card that updates thumbnails without affecting dialog
  const handleRefreshForDetailCard = async () => {
    try {
      const [wishListMovies, wishListAlbums, wishListBooks] = await Promise.all([
        apiService.getMoviesByStatus('wish') as Promise<any[]>,
        musicService.getAlbumsByStatus('wish') as Promise<any[]>,
        bookService.getBooksByStatus('wish') as Promise<any[]>
      ]);

      // Update the lists to refresh thumbnails
      setAllMovies(wishListMovies);
      setMovies(wishListMovies);
      setAllAlbums(wishListAlbums);
      setAlbums(wishListAlbums);
      setAllBooks(wishListBooks);
      setBooks(wishListBooks);

      // If there's a selected item, update its data in the list without changing selected details
      if (selectedMovieDetails) {
        const updatedMovie = wishListMovies.find((movie: any) => movie.id === selectedMovieDetails.id);
        if (updatedMovie) {
          setSelectedMovieDetails((prev: any) => ({
            ...prev,
            ...updatedMovie
          }));
        }
      }

      if (selectedAlbumDetails) {
        const updatedAlbum = wishListAlbums.find((album: any) => album.id === selectedAlbumDetails.id);
        if (updatedAlbum) {
          setSelectedAlbumDetails((prev: any) => ({
            ...prev,
            ...updatedAlbum
          }));
        }
      }

      if (selectedBookDetails) {
        const updatedBook = wishListBooks.find((book: any) => book.id === selectedBookDetails.id);
        if (updatedBook) {
          setSelectedBookDetails((prev: any) => ({
            ...prev,
            ...updatedBook
          }));
        }
      }
    } catch (err) {
      console.error('Failed to refresh wish list:', err);
    }
  };

  const handleDeleteClick = (itemId: number, itemType: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteModal({ show: true, itemId, itemType });
  };

  // A wish already taken care of (ordered, a bid made, a gift to come) is
  // "spoken for": it stays on the list, set back, with nothing more to do.
  // Movies come as their rows (spoken_for 0/1), albums and books formatted.
  const isSpokenFor = (item: any): boolean => item.spokenFor ?? item.spoken_for === 1;

  const handleSpokenForClick = async (item: any, itemType: 'movie' | 'album' | 'book', e?: React.MouseEvent) => {
    e?.stopPropagation();
    const spokenFor = !isSpokenFor(item);
    const mark = (on: boolean) => (list: any[]) => list.map(x => x.id !== item.id ? x
      : itemType === 'movie' ? { ...x, spoken_for: on ? 1 : 0 } : { ...x, spokenFor: on });
    const setters = itemType === 'movie' ? [setAllMovies, setMovies]
      : itemType === 'album' ? [setAllAlbums, setAlbums] : [setAllBooks, setBooks];
    setters.forEach(set => set(mark(spokenFor)));
    try {
      if (itemType === 'movie') await apiService.setMovieSpokenFor(item.id, spokenFor);
      else if (itemType === 'album') await musicService.setAlbumSpokenFor(item.id, spokenFor);
      else await bookService.setBookSpokenFor(item.id, spokenFor);
    } catch (err) {
      setters.forEach(set => set(mark(!spokenFor)));
      setError(`Failed to mark ${itemType} as spoken for: ` + (err as Error).message);
    }
  };

  const spokenForButton = (item: any, itemType: 'movie' | 'album' | 'book') => (
    <IconButton label={isSpokenFor(item) ? 'No longer spoken for' : 'Mark as spoken for'} size="sm" className="action-button spoken-for"
      active={isSpokenFor(item)}
      onClick={(e) => handleSpokenForClick(item, itemType, e)}
    ><BsBookmarkCheck /></IconButton>
  );

  const spokenForTag = (item: any) => isSpokenFor(item) && (
    <CoverTag variant="muted" className="wl-spoken-for-tag">Spoken for</CoverTag>
  );

  // On a phone a row slides: right, spoken for; left, Share, I bought it and Delete.
  const narrow = useNarrow();
  const phone = useMedia('(max-width: 767px)');
  // What the phone's full screen player may do to a wished album from its info view, while the wish list shows.
  useEffect(() => {
    if (!phone) return undefined;
    setAlbumManagement({
      delete: albumId => handleDeleteItemFromDetails(albumId, 'album'),
      bought: albumId => { const album = allAlbums.find(one => one.id === albumId); if (album) setBuyingAlbum(album); },
      coverChange: (albumId, side, coverPath) => {
        const patch = side === 'front' ? { cover: coverPath } : { backCover: coverPath };
        setAlbums(prev => prev.map(album => album.id === albumId ? { ...album, ...patch } : album));
      },
    });
    return () => setAlbumManagement(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const [swipeHint] = useState(() => readStored(SWIPE_HINT_KEY) !== '1');
  useEffect(() => { if (narrow && swipeHint) writeStored(SWIPE_HINT_KEY, '1'); }, [narrow, swipeHint]);
  const hintKind = movies.length > 0 ? 'movie' : albums.length > 0 ? 'album' : 'book';

  /** An item in a line, as the copied list says it. */
  const referenceOf = (item: any, itemType: 'movie' | 'album' | 'book'): string => {
    if (itemType === 'movie') return `${item.title} (${getYear(item)}) in ${item.format || 'Unspecified'}`;
    if (itemType === 'album') {
      const artist = Array.isArray(item.artist) ? item.artist.join(', ') : item.artist;
      return `${item.title} by ${artist} (${item.releaseYear || 'Unknown'}) in ${item.format || 'CD'}`;
    }
    const authors = Array.isArray(item.authors) ? item.authors.join(', ') : item.authors;
    return `${item.title} by ${authors || 'Unknown'} (${item.publishedYear || 'Unknown'}) in ${item.format || 'Hardcover'}`;
  };

  /** The system's sheet where there is one (an iPhone, Safari), the clipboard otherwise. */
  const share = async (item: any, itemType: 'movie' | 'album' | 'book') => {
    const text = referenceOf(item, itemType);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (err) {
        if ((err as Error).name !== 'AbortError') toast('It could not be shared', { tone: 'danger' });
      }
      return;
    }
    if (await copyText(text)) toast(`Copied: ${text}`, { tone: 'success' });
    else toast('It could not be copied', { tone: 'danger' });
  };

  const shareButton = (item: any, itemType: 'movie' | 'album' | 'book', boxed = false) => (
    <IconButton label="Share" size={boxed ? 'md' : 'sm'} boxed={boxed} className="action-button share"
      onClick={(e) => { e.stopPropagation(); share(item, itemType); }}
    ><BsBoxArrowUp /></IconButton>
  );

  /** What a row slid to the left lays bare: Share, I bought it, Delete. */
  const swipeDeed = (item: any, itemType: 'movie' | 'album' | 'book'): SwipeDeed => ({
    label: isSpokenFor(item) ? 'Not spoken for' : 'Spoken for', icon: <BsBookmarkCheck />,
    onSelect: () => handleSpokenForClick(item, itemType),
  });

  const swipeActions = (item: any, itemType: 'movie' | 'album' | 'book'): SwipeAction[] => [
    { label: 'Share', icon: <BsBoxArrowUp />, onSelect: () => share(item, itemType) },
    {
      label: 'Bought', icon: <BsCurrencyDollar />, tone: 'gold',
      onSelect: () => itemType === 'movie' ? buyMovie(item) : itemType === 'album' ? setBuyingAlbum(item) : buyBook(item),
    },
    { label: 'Delete', icon: <BsTrash />, tone: 'danger', disabled: deletingId === item.id, onSelect: () => setShowDeleteModal({ show: true, itemId: item.id, itemType }) },
  ];

  const buyBook = (book: any) => setBuyingBooks({ books: [{
    id: book.id, title: book.title, cover: book.cover || null, authors: book.authors || [],
    year: book.publishedYear ? String(book.publishedYear) : null, series: book.series || null,
    seriesNumber: book.seriesNumber || null, bookType: book.bookType || null, language: book.language || null,
    format: book.format || null, owner: book.owner || null,
  }] });

  const buyMovie = (movie: any) => {
    const asBuying = (m: any) => ({ id: m.id, tmdbId: m.tmdb_id, title: m.title, posterPath: m.poster_path || null, year: getYear(m) ? String(getYear(m)) : null, format: m.format || null });
    const box = movie.box_set_name ? allMovies.filter(m => m.box_set_name === movie.box_set_name) : [movie];
    setBuyingMovies({ movies: box.map(asBuying), boxName: movie.box_set_name || null });
  };

  const handleDeleteConfirm = async () => {
    if (showDeleteModal.itemId && showDeleteModal.itemType) {
      await handleDeleteItem(showDeleteModal.itemId, showDeleteModal.itemType);
      setShowDeleteModal({ show: false, itemId: null, itemType: null });
    }
  };

  const handleCopyToClipboard = async () => {
    if (allMovies.length === 0 && allAlbums.length === 0 && allBooks.length === 0) return;

    // Create markdown list from all items (not filtered)
    let markdown = 'wishlist:\n';

    // Add movies
    allMovies.forEach(movie => {
      markdown += ` - 🎬 ${referenceOf(movie, 'movie')}\n`;
    });

    // Add albums
    allAlbums.forEach(album => {
      markdown += ` - 🎵 ${referenceOf(album, 'album')}\n`;
    });

    // Add books
    allBooks.forEach(book => {
      markdown += ` - 📚 ${referenceOf(book, 'book')}\n`;
    });

    if (await copyText(markdown)) {
      if (onShowAlert) onShowAlert('Wishlist copied to clipboard!', 'success');
    } else if (onShowAlert) {
      onShowAlert('Failed to copy to clipboard', 'danger');
    }
  };

  const handleEditMovie = (movieId: number) => {
    // Navigate to edit page or open edit modal
    console.log('Edit movie:', movieId);
  };

  const handleDeleteItemFromDetails = async (itemId: number, itemType: string) => {
    try {
      if (itemType === 'movie') {
        await apiService.deleteMovie(itemId);
        setAllMovies(allMovies.filter(movie => movie.id !== itemId));
        setMovies(movies.filter(movie => movie.id !== itemId));
        setSelectedMovieDetails(null);
      } else if (itemType === 'album') {
        await musicService.deleteAlbum(itemId);
        setAllAlbums(allAlbums.filter(album => album.id !== itemId));
        setAlbums(albums.filter(album => album.id !== itemId));
        setSelectedAlbumDetails(null);
      } else if (itemType === 'book') {
        await bookService.deleteBook(itemId);
        setAllBooks(allBooks.filter(book => book.id !== itemId));
        setBooks(books.filter(book => book.id !== itemId));
        setSelectedBookDetails(null);
      }
    } catch (err) {
      setError(`Failed to delete ${itemType}: ` + (err as Error).message);
    }
  };

  const handleCopyBarcode = (barcode: string) => {
    navigator.clipboard.writeText(barcode);
    if (onShowAlert) {
      onShowAlert('Barcode copied to clipboard!', 'info');
    }
  };

  const handleCopyCatalogNumber = (catalogNumber: string) => {
    navigator.clipboard.writeText(catalogNumber);
    if (onShowAlert) {
      onShowAlert('Catalog number copied to clipboard!', 'info');
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString();
  };

  const getYear = (movie: any) => {
    if (movie.release_date) {
      return new Date(movie.release_date).getFullYear();
    }
    return movie.year || 'Unknown';
  };

  const getRatingPercentage = (rating: any, maxRating: number = 10) => {
    if (!rating || rating === '-') return 0;
    return Math.min(Math.max((parseFloat(rating) / maxRating) * 100, 0), 100);
  };

  const getRatingColor = (rating: any, maxRating: number = 10) => {
    if (!rating || rating === '-') return '#3a3a3a';

    const percentage = (parseFloat(rating) / maxRating) * 100;

    // Red to green continuum based on score
    if (percentage >= 80) {
      return '#22c55e'; // Excellent - bright green
    } else if (percentage >= 70) {
      return '#4ade80'; // Very good - medium green
    } else if (percentage >= 60) {
      return '#6ee7b7'; // Good - light green
    } else if (percentage >= 50) {
      return '#86efac'; // Fair - pale green
    } else if (percentage >= 40) {
      return '#a7f3d0'; // Below average - very pale green
    } else if (percentage >= 30) {
      return '#fbbf24'; // Poor - amber
    } else if (percentage >= 20) {
      return '#f59e0b'; // Very poor - orange
    } else {
      return '#ef4444'; // Terrible - red
    }
  };

  const formatRating = (rating: any) => {
    return rating ? rating.toString() : '-';
  };

  if (loading) {
    return (
      <div className="wishlist-page">
        <div className="loading">Loading wish list...</div>
      </div>
    );
  }

  const searchText = searchCriteria?.searchText || '';
  const hasSearchText = searchText && searchText.trim() !== '';
  const totalItems = movies.length + albums.length + books.length;
  const totalAllItems = allMovies.length + allAlbums.length + allBooks.length;

  return (
    <div className="wishlist-page">
      <div className="wishlist-header">
        <div className="wishlist-title-section">
          <h1>My Wish List</h1>
          {totalAllItems > 0 && (
            <span className="wishlist-count">
              ({totalItems}{hasSearchText ? ` of ${totalAllItems}` : ''} item{totalItems !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        <div className="wishlist-actions">
          {totalAllItems > 0 && (
            <IconButton label="Copy wishlist to clipboard as markdown" className="copy-clipboard-btn"
              onClick={handleCopyToClipboard}
              title="Copy wishlist to clipboard as markdown"
            ><BsClipboard /></IconButton>
          )}
          <div className="add-buttons">
            <Button icon={<BsFilm />} className="add-movie-btn"
              onClick={handleAddMovie}
              title="Add Movie to Wish List"
            >
              <span className="wishlist-add-word">Add </span>Movie
            </Button>
            <Button icon={<BsDisc />} className="add-album-btn"
              onClick={handleAddAlbum}
              title="Add Album to Wish List"
            >
              <span className="wishlist-add-word">Add </span>Album
            </Button>
            <Button icon={<BsBook />} className="add-book-btn"
              onClick={handleAddBook}
              title="Add Book to Wish List"
            >
              <span className="wishlist-add-word">Add </span>Book
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Notice tone="danger" className="mb-3">{error}</Notice>
      )}

      {totalAllItems === 0 ? (
        <div className="empty-wishlist">
          <h3>Your wish list is empty</h3>
          <p>Add movies, albums, and books you'd like to acquire to your collection.</p>
          <div className="add-buttons">
            <Button variant="primary" icon={<BsFilm />} className="add-movie-btn"
              onClick={handleAddMovie}
            >
              Add Your First Movie
            </Button>
            <Button variant="primary" icon={<BsDisc />} className="add-album-btn"
              onClick={handleAddAlbum}
            >
              Add Your First Album
            </Button>
            <Button variant="primary" icon={<BsBook />} className="add-book-btn"
              onClick={handleAddBook}
            >
              Add Your First Book
            </Button>
          </div>
        </div>
      ) : totalItems === 0 ? (
        <div className="empty-wishlist">
          <h3>No items found</h3>
          <p>Try a different search term.</p>
        </div>
      ) : (
        <div className="wishlist-content">
          {/* Movies Section */}
          {movies.length > 0 && (
            <div className="wishlist-section">
              <h2 className="wish-list-section-title">
                <BsFilm className="me-2" />
                Movies ({movies.length})
              </h2>
              <div className="table-responsive">
                <table className="table table-dark table-striped table-hover wishlist-table">
                  <thead className="thead-dark">
                    <tr>
                      <th scope="col">Poster</th>
                      <th scope="col">Title</th>
                      <th scope="col">Year</th>
                      <th scope="col">Ratings</th>
                      <th scope="col">Added Date</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movies.map((movie, index) => (
                      <SwipeRow
                        key={`movie-${movie.id}`}
                        className={`clickable-row${isSpokenFor(movie) ? ' spoken-for' : ''}`}
                        onClick={() => handleItemClick(movie.id, 'movie')}
                        style={{ cursor: 'pointer' }}
                        enabled={narrow}
                        hint={swipeHint && index === 0 && hintKind === 'movie'}
                        deed={swipeDeed(movie, 'movie')}
                        actions={swipeActions(movie, 'movie')}
                      >
                        <td className="wl-cover">
                          <div className="table-poster">
                            <MovieThumbnail
                              imdbLink={movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}` : movie.imdb_link}
                              title={movie.title}
                              year={getYear(movie)}
                              className="movie-thumbnail-table"
                              disableZoom={true}
                              posterPath={movie.poster_path}
                              recommendedAge={movie.recommended_age}
                            />
                          </div>
                        </td>
                        <td className="wl-title">
                          <div className="movie-title-cell">
                            <strong>{movie.title}</strong>{spokenForTag(movie)}
                            {movie.box_set_name && <div className="wl-box-set"><CoverTag variant="gold" title={`Box set · ${movie.box_set_name}`}><span className="wl-box-set__name">Box set · {movie.box_set_name}</span></CoverTag></div>}
                            {movie.original_title && movie.original_title !== movie.title && (
                              <div className="original-title">{movie.original_title}</div>
                            )}
                          </div>
                        </td>
                        <td className="wl-year">{getYear(movie)}</td>
                        <td className="wl-ratings">
                          <div className="ratings-cell">
                            {movie.tmdb_rating && (
                              <div className="rating-widget">
                                <CircularProgressBar
                                  percentage={getRatingPercentage(movie.tmdb_rating, 10)}
                                  color={getRatingColor(movie.tmdb_rating, 10)}
                                  size="medium"
                                  className="tmdb-progress"
                                >
                                  <span className="rating-score">{movie.tmdb_rating.toFixed(1)}</span>
                                </CircularProgressBar>
                                <span className="rating-label">TMDB</span>
                              </div>
                            )}
                            {movie.imdb_rating && (
                              <div className="rating-widget">
                                <CircularProgressBar
                                  percentage={getRatingPercentage(movie.imdb_rating, 10)}
                                  color={getRatingColor(movie.imdb_rating, 10)}
                                  size="medium"
                                  className="imdb-progress"
                                >
                                  <span className="rating-score">{formatRating(movie.imdb_rating)}</span>
                                </CircularProgressBar>
                                <span className="rating-label">IMDB</span>
                              </div>
                            )}
                            {movie.rotten_tomato_rating && (
                              <div className="rating-widget">
                                <CircularProgressBar
                                  percentage={movie.rotten_tomato_rating}
                                  color={getRatingColor(movie.rotten_tomato_rating, 100)}
                                  size="medium"
                                  className="rt-progress"
                                >
                                  <span className="rating-score">{movie.rotten_tomato_rating}%</span>
                                </CircularProgressBar>
                                <span className="rating-label">RT</span>
                              </div>
                            )}
                            {!movie.tmdb_rating && !movie.imdb_rating && !movie.rotten_tomato_rating && '-'}
                          </div>
                        </td>
                        <td className="wl-added">{formatDate(movie.acquired_date)}</td>
                        <td className="wl-actions">
                          <div className="actions-cell">
                            <IconButton label="Search on Ricardo" size="sm" className="action-button ricardo"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRicardo(ricardoSearchUrl(`${movie.title} ${movie.format || 'Blu-ray'}`));
                              }}
                            ><BsSearch /></IconButton>
                            {!narrow && (<>
                            {spokenForButton(movie, 'movie')}
                            <IconButton label={movie.box_set_name ? 'I bought the box set' : 'I bought it'} size="sm" className="action-button mark-owned"
                              onClick={(e) => {
                                e.stopPropagation();
                                buyMovie(movie);
                              }}
                            ><BsCurrencyDollar /></IconButton>
                            {shareButton(movie, 'movie')}
                            <IconButton label="Delete movie" tone="danger" size="sm" className="action-button delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(movie.id, 'movie', e);
                              }}
                              disabled={deletingId === movie.id}
                              title="Delete movie"
                            ><BsTrash /></IconButton>
                            </>)}
                          </div>
                        </td>
                      </SwipeRow>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Albums Section */}
          {albums.length > 0 && (
            <div className="wishlist-section">
              <h2 className="wish-list-section-title">
                <BsDisc className="me-2" />
                Albums ({albums.length})
              </h2>
              <div className="table-responsive">
                <table className="table table-dark table-striped table-hover wishlist-table">
                  <thead className="thead-dark">
                    <tr>
                      <th scope="col">Cover</th>
                      <th scope="col">Title</th>
                      <th scope="col">Artist</th>
                      <th scope="col">Year</th>
                      <th scope="col">Format</th>
                      <th scope="col">Added Date</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {albums.map((album, index) => (
                      <SwipeRow
                        key={`album-${album.id}`}
                        className={`clickable-row${isSpokenFor(album) ? ' spoken-for' : ''}`}
                        onClick={() => handleItemClick(album.id, 'album')}
                        style={{ cursor: 'pointer' }}
                        enabled={narrow}
                        hint={swipeHint && index === 0 && hintKind === 'album'}
                        deed={swipeDeed(album, 'album')}
                        actions={swipeActions(album, 'album')}
                      >
                        <td className="wl-cover">
                          <div className="album-poster">
                            <img
                              {...thumbProps(musicService.getImageUrl(album.cover) || musicService.getImageUrl('/placeholder-album.png') || '', 120)}
                              loading="lazy"
                              alt={album.title}
                              className="music-thumbnail-table"
                              onError={(e) => {
                                (e.target as HTMLImageElement).removeAttribute('srcset');
                                (e.target as HTMLImageElement).src = musicService.getImageUrl('/placeholder-album.png') || '';
                              }}
                            />
                          </div>
                        </td>
                        <td className="wl-title">
                          <div className="album-title-cell">
                            <strong>{album.title}</strong>{spokenForTag(album)}
                          </div>
                        </td>
                        <td className="wl-by">
                          <div className="artist-cell">
                            {Array.isArray(album.artist) ? album.artist.join(', ') : album.artist}
                          </div>
                        </td>
                        <td className="wl-year">{album.releaseYear || 'Unknown'}</td>
                        <td className="wl-format">{album.format || 'CD'}</td>
                        <td className="wl-added">{formatDate(album.createdAt)}</td>
                        <td className="wl-actions">
                          <div className="actions-cell">
                            <IconButton label="Search on Ricardo" size="sm" className="action-button ricardo"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRicardo(ricardoSearchUrl(`${Array.isArray(album.artist) ? album.artist.join(' ') : album.artist} ${album.title} ${album.format || 'CD'}`));
                              }}
                            ><BsSearch /></IconButton>
                            {!narrow && (<>
                            {spokenForButton(album, 'album')}
                            <IconButton label="I bought the CD" size="sm" className="action-button mark-owned"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBuyingAlbum(album);
                              }}
                            ><BsCurrencyDollar /></IconButton>
                            {shareButton(album, 'album')}
                            <IconButton label="Delete album" tone="danger" size="sm" className="action-button delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(album.id, 'album', e);
                              }}
                              disabled={deletingId === album.id}
                              title="Delete album"
                            ><BsTrash /></IconButton>
                            </>)}
                          </div>
                        </td>
                      </SwipeRow>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Books Section */}
          {books.length > 0 && (
            <div className="wishlist-section">
              <h2 className="wish-list-section-title">
                <BsBook className="me-2" />
                Books ({books.length})
              </h2>
              <div className="table-responsive">
                <table className="table table-dark table-striped table-hover wishlist-table">
                  <thead className="thead-dark">
                    <tr>
                      <th scope="col">Cover</th>
                      <th scope="col">Title</th>
                      <th scope="col">Author</th>
                      <th scope="col">Year</th>
                      <th scope="col">Format</th>
                      <th scope="col">Added Date</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.map((book, index) => (
                      <SwipeRow
                        key={`book-${book.id}`}
                        className={`clickable-row${isSpokenFor(book) ? ' spoken-for' : ''}`}
                        onClick={() => handleItemClick(book.id, 'book')}
                        style={{ cursor: 'pointer' }}
                        enabled={narrow}
                        hint={swipeHint && index === 0 && hintKind === 'book'}
                        deed={swipeDeed(book, 'book')}
                        actions={swipeActions(book, 'book')}
                      >
                        <td className="wl-cover">
                          <div className="book-poster" style={{ position: 'relative' }}>
                            {book.ebookFile && book.ebookFile.trim() && (
                              <CoverButton
                                className="book-thumbnail-ebook-badge"
                                size="small"
                                reveal="always"
                                label="Télécharger l'e-book"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await bookService.downloadEbook(book.id);
                                  } catch (error) {
                                    console.error('Error downloading ebook:', error);
                                    alert('Erreur lors du t\u00e9l\u00e9chargement de l\'e-book: ' + (error as Error).message);
                                  }
                                }}
                              >
                                <BsFileEarmark size={12} />
                              </CoverButton>
                            )}
                            <img
                              {...thumbProps(bookService.getImageUrl(book.cover) || bookService.getImageUrl('/placeholder-book.png') || '')}
                              loading="lazy"
                              alt={book.title}
                              className="book-thumbnail-table"
                              onError={(e) => {
                                (e.target as HTMLImageElement).removeAttribute('srcset');
                                (e.target as HTMLImageElement).src = bookService.getImageUrl('/placeholder-book.png') || '';
                              }}
                            />
                          </div>
                        </td>
                        <td className="wl-title">
                          <div className="book-title-cell">
                            <strong>{book.title}</strong>{spokenForTag(book)}
                            {book.series && (
                              <div className="book-series">{book.series}{book.seriesNumber ? ` #${book.seriesNumber}` : ''}</div>
                            )}
                          </div>
                        </td>
                        <td className="wl-by">
                          <div className="author-cell">
                            {Array.isArray(book.authors) ? book.authors.join(', ') : book.authors || 'Unknown'}
                          </div>
                        </td>
                        <td className="wl-year">{book.publishedYear || 'Unknown'}</td>
                        <td className="wl-format">{book.format || 'Hardcover'}</td>
                        <td className="wl-added">{formatDate(book.createdAt)}</td>
                        <td className="wl-actions">
                          <div className="actions-cell">
                            {!narrow && (<>
                            {spokenForButton(book, 'book')}
                            <IconButton label="I bought it" size="sm" className="action-button mark-owned"
                              onClick={(e) => {
                                e.stopPropagation();
                                buyBook(book);
                              }}
                            ><BsCurrencyDollar /></IconButton>
                            {shareButton(book, 'book')}
                            <IconButton label="Delete book" tone="danger" size="sm" className="action-button delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(book.id, 'book', e);
                              }}
                              disabled={deletingId === book.id}
                              title="Delete book"
                            ><BsTrash /></IconButton>
                            </>)}
                          </div>
                        </td>
                      </SwipeRow>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Cards */}
      {(selectedMovieDetails && !loadingDetails) && (
        <MovieDetailCard
          movieDetails={selectedMovieDetails}
          loading={loadingDetails}
          onClose={handleCloseDetails}
          onEdit={handleEditMovie as (...args: unknown[]) => void}
          onDelete={() => handleDeleteItemFromDetails(selectedMovieDetails.id, 'movie')}
          onShowAlert={onShowAlert}
          onRefresh={handleRefreshForDetailCard}
          onMovieClick={(movieId: number) => handleItemClick(movieId, 'movie')}
          onSearch={onSearch}
          onPrevious={movieSteps.onPrevious}
          onNext={movieSteps.onNext}
        />
      )}

      {(selectedAlbumDetails && !loadingDetails && !phone) && (
        <MusicDetailCard
          cd={selectedAlbumDetails}
          onClose={handleCloseDetails}
          onDelete={() => handleDeleteItemFromDetails(selectedAlbumDetails.id, 'album')}
          onSearch={onSearch}
          onPrevious={albumSteps.onPrevious}
          onNext={albumSteps.onNext}
          onCoverChange={(side, coverPath) => {
            const patch = side === 'front' ? { cover: coverPath } : { backCover: coverPath };
            const id = selectedAlbumDetails.id;
            setAlbums(prev => prev.map(album => album.id === id ? { ...album, ...patch } : album));
            setSelectedAlbumDetails((prev: any) => prev?.id === id ? { ...prev, ...patch } : prev);
          }}
        />
      )}

      {(selectedBookDetails && !loadingDetails) && (
        <BookDetailCard
          book={selectedBookDetails}
          onClose={handleCloseDetails}
          onEdit={() => {}}
          onDelete={() => handleDeleteItemFromDetails(selectedBookDetails.id, 'book')}
          onPrevious={bookSteps.onPrevious}
          onNext={bookSteps.onNext}
          onUpdateBook={async (id: number | string, bookData: any) => {
            await bookService.updateBook(id, bookData);
            handleRefreshForDetailCard();
          }}
          onBookUpdated={handleRefreshForDetailCard}
          onSearch={onSearch}
          onAddNextVolume={() => {}}
          onAddBooksBatch={() => {}}
          onAddStart={() => {}}
          onBookAdded={() => {}}
          onAddError={() => {}}
          onBookClick={handleBookClick}
        />
      )}

      {/* Loading indicator for detail cards */}
      {loadingDetails && (
        <Dialog onClose={() => undefined} size="sm" modal header={false} title="Loading details" className="dialog-waiting">
          <Dialog.Body>
            <Loading>Loading details…</Loading>
          </Dialog.Body>
        </Dialog>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal.show && (
        <ConfirmDialog
          title={`Delete this ${showDeleteModal.itemType === 'movie' ? 'movie' : showDeleteModal.itemType === 'album' ? 'album' : 'book'}?`}
          message={`It leaves your wish list for good.`}
          confirmLabel="Delete"
          danger
          loading={deletingId === showDeleteModal.itemId}
          onAnswer={yes => {
            if (yes) handleDeleteConfirm();
            else setShowDeleteModal({ show: false, itemId: null, itemType: null });
          }}
        />
      )}

      {/* Add Music Dialog */}
      {showAddMusicDialog && (
        <AddMusicDialog
          show={showAddMusicDialog}
          onHide={handleAddMusicDialogClose}
          onAddCd={handleAddCd}
          onAddCdFromMusicBrainz={handleAddCdFromMusicBrainz}
          onAddCdByBarcode={handleAddCdByBarcode}
          onReviewMetadata={handleReviewMetadata}
          onDraftEntry={(result: any) => {
            setSleeveDraft(result.draft);
            setPendingCover(result.coverPhoto || null);
              setPendingBack(result.backPhoto || null);
              setShowAddMusicDialog(false);
            setShowMusicForm(true);
          }}
          defaultTitleStatus="wish"
          onAlbumAdded={() => {
            // Immediately refresh wishlist when album is added, the finder staying open
            loadWishListItems({ quiet: true });
            setAddingAlbum(false);
            setAddError('');
            if (onAlbumAdded) onAlbumAdded();
          }}
          onAddStart={() => {
            setShowAddMusicDialog(false); // close dialog instantly
            setAddingAlbum(true);
            setAddError('');
          }}
          onAddError={(err: any) => {
            setAddingAlbum(false);
            setAddError(err?.message || 'Failed to add album');
            if (onShowAlert) onShowAlert('Failed to add album: ' + (err?.message || ''), 'danger');
          }}
        />
      )}

      {buyingBooks && (
        <Dialog show onClose={() => setBuyingBooks(null)} size="lg" zIndex={10200} title={buyingBookHead.title} onBack={buyingBookHead.onBack}>
          <BookFinder
            mode="owned"
            buying={buyingBooks}
            onHead={setBuyingBookHead}
            onClose={() => setBuyingBooks(null)}
            onChanged={() => {
              const ids = new Set(buyingBooks.books.map(b => b.id));
              setAllBooks(prev => prev.filter(b => !ids.has(b.id)));
              setBooks(prev => prev.filter(b => !ids.has(b.id)));
              if (onBookMovedToCollection) onBookMovedToCollection(buyingBooks.books[0]);
            }}
          />
        </Dialog>
      )}

      {buyingMovies && (
        <Dialog show onClose={() => setBuyingMovies(null)} size="lg" zIndex={10200} title={buyingHead.title} onBack={buyingHead.onBack}>
          <MovieFinder
            mode="owned"
            buying={buyingMovies}
            onHead={setBuyingHead}
            onClose={() => setBuyingMovies(null)}
            onChanged={() => {
              const ids = new Set(buyingMovies.movies.map(m => m.id));
              setAllMovies(prev => prev.filter(m => !ids.has(m.id)));
              setMovies(prev => prev.filter(m => !ids.has(m.id)));
              if (onMovieMovedToCollection) onMovieMovedToCollection();
            }}
          />
        </Dialog>
      )}

      {buyingAlbum && (
        <BoughtCdDialog
          album={{ ...buyingAlbum, cover: musicService.getImageUrl(buyingAlbum.cover) }}
          onClose={() => setBuyingAlbum(null)}
          onBought={(album: any) => {
            setBuyingAlbum(null);
            setAllAlbums(prev => prev.filter(a => a.id !== album.id));
            setAlbums(prev => prev.filter(a => a.id !== album.id));
            if (onShowAlert) onShowAlert(`"${album.title}" is now a CD of your collection`, 'success');
            if (onAlbumMovedToCollection) onAlbumMovedToCollection(album);
          }}
        />
      )}

      {/* Add Book Dialog */}
      {showAddBookDialog && (
        <AddBookDialog
          show={showAddBookDialog}
          onHide={handleAddBookDialogClose}
          onAddBook={handleAddBookToWishlist}
          defaultTitleStatus="wish"
          onShowAlert={onShowAlert || undefined}
          onBookAdded={() => {
            // Immediately refresh wishlist when book is added, the finder staying open
            loadWishListItems({ quiet: true });
            setAddingBook(false);
            setAddBookError('');
            if (onBookAdded) onBookAdded();
          }}
          onAddStart={() => {
            setShowAddBookDialog(false); // close dialog instantly
            setAddingBook(true);
            setAddBookError('');
          }}
          onAddError={(err: any) => {
            setAddingBook(false);
            setAddBookError(err?.message || 'Failed to add book');
            if (onShowAlert) onShowAlert('Failed to add book: ' + (err?.message || ''), 'danger');
          }}
        />
      )}

      {/* Music Form for Manual Entry */}
      {showMusicForm && (
        <MusicForm
          cd={sleeveDraft || undefined}
          pendingPhotos={{ front: pendingCover, back: pendingBack }}
          onCancel={handleMusicFormClose}
          onSave={handleMusicFormSave}
        />
      )}

      {/* Loading indicator for album addition */}
      {addingAlbum && (
        <div className="loading-overlay">
          <Spinner size="lg" />
          <div className="loading-message">
            Adding album to your wish list...
          </div>
        </div>
      )}

      {/* Loading indicator for book addition */}
      {addingBook && (
        <div className="loading-overlay">
          <Spinner size="lg" />
          <div className="loading-message">
            Adding book to your wish list...
          </div>
        </div>
      )}

      {addError && (
        <Notice tone="danger" className="mb-3">{addError}</Notice>
      )}

      {addBookError && (
        <Notice tone="danger" className="mb-3">{addBookError}</Notice>
      )}


      {/* Modal backdrop */}
      {(showAddMusicDialog || showMusicForm || addingAlbum || showAddBookDialog || addingBook) && (
        <div className="modal-backdrop show"></div>
      )}

    </div>
  );
});

WishListPage.displayName = 'WishListPage';

export default WishListPage;
