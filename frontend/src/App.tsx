
import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import FilmDexPage from './components/FilmDexPage';
import AddMovieDialog from './components/AddMovieDialog';
import WishListPage from './pages/WishListPage';
import MusicDexPage from './pages/MusicDexPage';
import BookDexPage from './pages/BookDexPage';
import ScoresPage from './pages/ScoresPage';
import AnalyticsPage from './pages/AnalyticsPage';
import BackupPage from './pages/BackupPage';
import ShelvesPage from './pages/ShelvesPage';
import CogDropdown from './components/CogDropdown';
import Menu, { MenuChevron } from './components/shared/Menu';
import SearchPills from './components/shared/search/SearchPills';
import { getSearchSchema } from './components/shared/search/schemas';
import Segmented from './components/shared/Segmented';
import ShelfMovesNotice from './components/shared/ShelfMovesNotice';
import { refreshShelfLocations } from './utils/shelfLocations';
import ScrollToTop from './components/ScrollToTop';
import apiService from './services/api';
import bookService from './services/bookService';
import bookSectionsService from './services/bookSectionsService';
import { BsX, BsCollectionFill, BsBookmark, BsDisc, BsArrowLeft, BsBarChart, BsFilm, BsBook, BsFileMusic } from 'react-icons/bs';
import 'bootstrap/dist/css/bootstrap.min.css';
// After Bootstrap, so that its radios and checkboxes wear DexVault's look.
import './components/shared/check.css';
import './components/shared/range.css';
import './App.css';
import { readStored, writeStored } from './utils/safeStorage';
import { useDigitalLibrary } from './utils/digitalLibrary';
import PlayerBar from './components/PlayerBar';
import LyricsPanel from './components/LyricsPanel';
import { ConfirmHost } from './components/shared/ConfirmDialog';
import { IconButton } from './components/shared/Button';
import { toast, toneOf, ToastHost } from './components/shared/Toast';
import { TooltipHost } from './components/shared/Tooltip';
import RemoteReporter from './components/RemoteReporter';
import RemoteBar from './components/RemoteBar';
import { connectOutputs } from './services/outputs';
import { isComputer } from './services/remote';

interface SearchCriteria {
  searchText: string;
}

/** The old Digital page's tabs, as MusicDex with Digital on: Buy, or words of the search. */
const DIGITAL_TAB_SEARCHES: Record<string, string> = { nocd: 'cd:no', lossy: 'file:lossy', physical: 'ripped:no' };

const DigitalRedirect = () => {
  const tab = new URLSearchParams(useLocation().search).get('tab') || 'buy';
  const search = DIGITAL_TAB_SEARCHES[tab];
  return <Navigate to={search ? `/musicdex?digital=1&search=${encodeURIComponent(search)}` : '/musicdex?digital=1&filter=buy'} replace />;
};

/** The sections of the header's buttons, in their order, Shelves last. */
const SECTIONS = ['/filmdex', '/musicdex', '/bookdex', '/scores', '/wishlist', '/analytics', '/shelves'];
const LAST_SECTION_KEY = 'dexvault-last-section';

/**
 * DexVault installed as an app (on an iPhone, from the home screen) starts where its icon was
 * saved, / or a section, and so comes back to the section left last, before anything reads the
 * address. In a browser's tab an address stays the one asked.
 */
const isInstalledApp = (): boolean => {
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch (_) {
    return false;
  }
};
if (typeof window !== 'undefined' && isInstalledApp() && !window.location.search && !window.location.hash) {
  const last = readStored(LAST_SECTION_KEY);
  const at = window.location.pathname;
  if (last && SECTIONS.includes(last) && last !== at && (at === '/' || SECTIONS.includes(at))) {
    window.history.replaceState(window.history.state, '', last);
  }
}

/** The app opened at its root comes back to the section left last. */
const LastSection = () => {
  const last = readStored(LAST_SECTION_KEY);
  return <Navigate to={last && SECTIONS.includes(last) ? last : '/filmdex'} replace />;
};

function AppContent() {
  const [refreshTrigger] = useState<number>(0);
  const movieSearchRef = useRef<any>(null);
  const wishListRef = useRef<any>(null);
  const musicDexRef = useRef<any>(null);
  const bookDexRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The appliances of the house the player can play on (Salon), and what plays there, as it changes.
  useEffect(() => { void connectOutputs(); }, []);
  const navigate = useNavigate();
  const location = useLocation();
  // ⌘F (Ctrl+F) goes to the search, its words selected, where a section has one; elsewhere the browser finds.
  useEffect(() => {
    const toSearch = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      const input = searchInputRef.current;
      if (!input || !input.isConnected) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', toSearch);
    return () => window.removeEventListener('keydown', toSearch);
  }, []);
  // ⌘1…⌘7 (Ctrl+1…7) go to a section, in the order of the header's buttons, Shelves last.
  // In a browser's tab ⌘1…⌘9 stay the browser's (Ctrl works there on a Mac); in DexVault installed as an app they are its own.
  useEffect(() => {
    const toSection = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const path = SECTIONS[Number(e.code.replace('Digit', '')) - 1];
      if (!path || !e.code.startsWith('Digit')) return;
      e.preventDefault();
      navigate(path);
    };
    window.addEventListener('keydown', toSection);
    return () => window.removeEventListener('keydown', toSection);
  }, [navigate]);
  // The section shown, for the next start.
  useEffect(() => {
    if (SECTIONS.includes(location.pathname)) writeStored(LAST_SECTION_KEY, location.pathname);
  }, [location.pathname]);
  // Helper to get product name from path
  const getProductFromPath = (path: string): string | null => {
    if (path === '/filmdex') return 'filmdex';
    if (path === '/musicdex') return 'musicdex';
    if (path === '/bookdex') return 'bookdex';
    if (path === '/scores') return 'scores';
    if (path === '/wishlist') return 'wishlist';
    return null;
  };

  // Initialize search from localStorage based on current product
  const [searchCriteria, setSearchCriteria] = useState<SearchCriteria>(() => {
    const currentPath = window.location.pathname;
    const product = getProductFromPath(currentPath);
    if (product) {
      const savedText = readStored(`dexvault-${product}-search`) || '';
      return { searchText: savedText };
    }
    return { searchText: '' };
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [hasCheckedBackfill, setHasCheckedBackfill] = useState<boolean>(false);
  const [showAddMovieDialog, setShowAddMovieDialog] = useState<boolean>(false);
  const [addMovieMode, setAddMovieMode] = useState<string>('collection');
  const [collections, setCollections] = useState<string[]>([]);
  const [boxSets, setBoxSets] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [scoreComposers, setScoreComposers] = useState<string[]>([]);
  const [scorePublishers, setScorePublishers] = useState<string[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // The search's keys and the recent searches of the section shown.
  const searchSchema = getSearchSchema(location.pathname);
  const product = getProductFromPath(location.pathname);

  // Check if we're on the thumbnail view (filmdex path)
  const isThumbnailView = location.pathname === '/filmdex';

  // Check if we should show the search bar (filmdex, musicdex, bookdex, wishlist)
  const showSearchBar = location.pathname === '/filmdex' || location.pathname === '/musicdex' || location.pathname === '/bookdex' || location.pathname === '/scores' || location.pathname === '/wishlist';

  // Check if we should show the navigation pills (all main sections)
  const showNavigationPills = location.pathname === '/filmdex' || location.pathname === '/musicdex' || location.pathname === '/bookdex' || location.pathname === '/scores' || location.pathname === '/wishlist' || location.pathname === '/shelves' || location.pathname === '/analytics' || location.pathname === '/backup';

  // Get the page title based on current route
  const getPageTitle = (): string => {
    switch (location.pathname) {
      case '/filmdex':
        return 'DexVault';
      case '/musicdex':
        return 'MusicDex';
      case '/bookdex':
        return 'BookDex';
      case '/scores':
        return 'Scores';
      case '/wishlist':
        return 'DexVault';
      case '/shelves':
        return 'Shelves';
      case '/analytics':
        return 'FilmDex Analytics';
      case '/backup':
        return 'Backup Management';
      default:
        return 'DexVault';
    }
  };


  // Fetch collections and box sets for filter dropdown
  const fetchFilterData = async () => {
    try {
      if (location.pathname === '/musicdex') {
        // MusicDex's filters are fixed
        return;
      } else if (location.pathname === '/scores') {
        // The scores' composers and publishers, each once
        const scores = await bookSectionsService.scores();
        const names = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => !!v && !!v.trim()))]
          .sort((a, b) => a.localeCompare(b));
        // By their surname, as the page files them: Bach before Debussy
        const surname = (name: string) => name.split(' ').slice(-1)[0];
        setScoreComposers(names(scores.map(s => s.composer)).sort((a, b) => surname(a).localeCompare(surname(b))));
        setScorePublishers(names(scores.map(s => s.publisher)));
      } else if (location.pathname === '/bookdex') {
        // Fetch owners for BookDex
        try {
          const ownersData = await bookService.getAutocompleteSuggestions('owner', '') as any[];
          const ownerNames = ownersData
            .map((item: any) => item.owner || item)
            .filter((owner: any) => owner && typeof owner === 'string' && owner.trim())
            .filter((owner: string, index: number, self: string[]) => self.indexOf(owner) === index) // Remove duplicates
            .sort();
          setOwners(ownerNames);
        } catch (error) {
          console.error('Failed to fetch owners:', error);
          setOwners([]);
        }
      } else {
        // Fetch all collections (both user collections and box sets) for FilmDex
        const collectionsData = await apiService.getAllCollections() as any[];

        // Separate user collections from box sets
        const userCollections = collectionsData
          .filter((c: any) => c.type === 'user')
          .map((c: any) => c.name)
          .sort();

        const boxSetCollections = collectionsData
          .filter((c: any) => c.type === 'box_set')
          .map((c: any) => c.name)
          .sort();

        setCollections(userCollections);
        setBoxSets(boxSetCollections);
      }
    } catch (error) {
      console.error('Failed to fetch filter data:', error);
    }
  };

  // A word of the search written from a card (an actor, a director, an artist): the field shows it in pills.
  const handleSearchFromMovieDetail = (predicate: string) => {
    setSearchCriteria({ searchText: predicate });
  };

  // Handle filter selection and generate predicates
  const handleFilterSelection = (filterType: string, filterValue: string) => {
    let predicate = '';

    switch (filterType) {
      case 'media_type':
        predicate = `media_type:${filterValue}`;
        break;
      case 'format':
        predicate = `format:"${filterValue}"`;
        break;
      case 'type':
        predicate = `type:${filterValue}`;
        break;
      case 'genre':
        predicate = `genre:"${filterValue}"`;
        break;
      case 'collection':
        predicate = `collection:"${filterValue}"`;
        break;
      case 'box_set':
        predicate = `box_set:"${filterValue}"`;
        break;
      case 'age_group':
        const ageRanges: Record<string, string> = {
          'All Ages (0-3)': 'recommended_age:0-3',
          'Children (4-9)': 'recommended_age:4-9',
          'Pre-teens (10-14)': 'recommended_age:10-14',
          'Teens & Adults (15+)': 'recommended_age:>=15'
        };
        predicate = ageRanges[filterValue] || '';
        break;
      case 'imdb_rating':
        predicate = `imdb_rating:>=${filterValue}`;
        break;
      case 'tmdb_rating':
        predicate = `tmdb_rating:>=${filterValue}`;
        break;
      case 'rotten_tomato_rating':
        predicate = `rotten_tomato_rating:>=${filterValue}`;
        break;
      case 'year':
        predicate = `year:${filterValue}`;
        break;
      case 'comments':
        predicate = 'has_comments:yes';
        break;
      case 'no_spiders':
        predicate = 'spiders:no';
        break;
      case 'no_snakes':
        predicate = 'snakes:no';
        break;
      case 'no_spiders_snakes':
        predicate = 'spiders:no snakes:no';
        break;
      case 'owner':
        predicate = `owner:"${filterValue}"`;
        break;
      case 'title_status':
        predicate = `title_status:${filterValue}`;
        break;
      case 'has_ebook':
        predicate = 'has_ebook:yes';
        break;
      case 'music':
      case 'score':
      case 'book':
        predicate = filterValue;
        break;
      default:
        return;
    }

    if (predicate) {
      let currentText = searchCriteria.searchText.trim();
      if (filterType === 'music' || filterType === 'score' || filterType === 'book' || filterType === 'age_group' || filterType === 'format') {
        // A filter takes the place of one of its family already there: stars and rated are one, a second age group or format replaces the first
        const key = predicate.split(':')[0];
        const family = key === 'stars' || key === 'rated' ? 'stars|rated' : key === 'heard' || key === 'contents' ? 'heard|contents'
          : key === 'favourites' ? 'favourites|favorites|fav' : key;
        currentText = currentText.replace(new RegExp(`(^|\\s)[-!]?(${family}):(?:"[^"]*"|[^\\s"])+`, 'gi'), '').replace(/\s+/g, ' ').trim();
      }
      const newText = currentText ? `${currentText} ${predicate}` : predicate;

      setSearchCriteria({ searchText: newText });
    }

  };

  /** The search's filters, by section, for the page shown: each one adds its words to the search. */
  const filterSections = (): Array<{ title: string; options: Array<{ label: string; type: string; value: string }> }> => {
    const plain = (type: string, labels: Array<[string, string]>) => labels.map(([value, label]) => ({ label, type, value }));
    const of = (type: string, values: string[]) => values.map(value => ({ label: value, type, value }));
    const decades = [2020, 2010, 2000, 1990, 1980, 1970, 1960].map(year => ({ label: `${year}s`, type: 'music', value: `year:${year}-${year + 9}` }));
    const sections = location.pathname === '/musicdex' ? [
      { title: 'Medium', options: plain('music', [['cd:yes', 'CDs only'], ['cd:no', 'Digital only'], ['mixtape:yes', 'Mixtapes only'], ['mixtape:no', 'No mixtapes']]) },
      { title: 'Files', options: plain('music', [['file:lossless', 'Lossless'], ['file:lossy', 'Lossy'], ['ripped:no', 'Not ripped']]) },
      { title: 'Music', options: plain('music', [['classical:yes', 'Classical only'], ['classical:no', 'Everything but classical']]) },
      { title: 'Your stars', options: plain('music', [['stars:5', '★★★★★'], ['stars:>=4', '4 stars or more'], ['rated:no', 'Not rated yet'], ['favourites:yes', 'Favourites']]) },
      { title: 'Decades', options: [...decades, { label: 'Before 1960', type: 'music', value: 'year:<1960' }] },
    ] : location.pathname === '/bookdex' ? [
      { title: 'Book Type', options: plain('book', [['type:book', 'Book'], ['type:graphic-novel', 'Graphic Novel'], ['type:score', 'Score']]) },
      { title: 'Formats', options: plain('book', [['format:physical', 'Physical'], ['format:ebook', 'E-book'], ['format:audiobook', 'Audiobook']]) },
      { title: 'Title Status', options: plain('book', [['title_status:owned', 'Owned'], ['title_status:borrowed', 'Borrowed']]) },
      { title: 'E-book File', options: plain('book', [['has_ebook:yes', 'With an e-book file'], ['has_ebook:no', 'Without an e-book file']]) },
      { title: 'Owners', options: [
        ...owners.map(name => ({ label: name, type: 'book', value: `owner:${/[\s,:]/.test(name) ? `"${name}"` : name}` })),
        ...(owners.length ? [{ label: 'No owner', type: 'book', value: 'owner:none' }] : []),
      ] },
    ] : location.pathname === '/scores' ? [
      { title: 'PDF', options: plain('score', [['pdf:yes', 'With a PDF'], ['pdf:no', 'Without a PDF']]) },
      { title: 'Your Music', options: plain('score', [['heard:yes', 'Played in your music'], ['heard:no', 'Not in your music'], ['contents:no', 'Contents unknown']]) },
      { title: 'Composers', options: [
        ...scoreComposers.map(name => ({ label: name, type: 'score', value: `composer:"${name}"` })),
        { label: 'Anthologies & methods', type: 'score', value: 'composer:none' },
      ] },
      { title: 'Publishers', options: scorePublishers.map(name => ({ label: name, type: 'score', value: `publisher:"${name}"` })) },
    ] : [
      { title: 'Age Groups', options: of('age_group', ['All Ages (0-3)', 'Children (4-9)', 'Pre-teens (10-14)', 'Teens & Adults (15+)']) },
      { title: 'Formats', options: of('format', ['Blu-ray 4K', 'Blu-ray', 'DVD']) },
      { title: 'Special', options: [
        { label: 'Has Comments', type: 'comments', value: '' },
        { label: 'No spiders', type: 'no_spiders', value: '' },
        { label: 'No snakes', type: 'no_snakes', value: '' },
        { label: 'No spiders or snakes', type: 'no_spiders_snakes', value: '' },
      ] },
      { title: 'Collections', options: of('collection', collections) },
      { title: 'Box Sets', options: of('box_set', boxSets) },
    ];
    return sections.filter(section => section.options.length > 0);
  };
  const handleDexVaultClick = () => {
    navigate('/filmdex');
  };

  const handleAddMovie = () => {
    setAddMovieMode('collection');
    setShowAddMovieDialog(true);
  };

  const handleAnalytics = () => {
    navigate('/analytics');
  };

  const handleShelves = () => {
    navigate('/shelves');
  };

  const handleBackup = () => {
    navigate('/backup');
  };


  const handleCollection = () => {
    navigate('/filmdex');
  };

  const handleMusicDex = () => {
    navigate('/musicdex');
  };

  const handleBookDex = () => {
    navigate('/bookdex');
  };

  // Navidrome, read again from ⚙︎: the store MusicDex shows with Digital on, not read here otherwise.
  const navidrome = useDigitalLibrary(false);
  const handleSyncNavidrome = async () => {
    const error = await navidrome.sync();
    toast(error ? `Could not read Navidrome: ${error}` : 'Navidrome read again', { tone: error ? 'danger' : 'success' });
  };

  const handleWishList = () => {
    navigate('/wishlist');
  };

  const handleAddMovieDialogClose = () => {
    setShowAddMovieDialog(false);
  };

  const handleWishListAddMovie = (mode: string) => {
    setAddMovieMode(mode);
    setShowAddMovieDialog(true);
  };

  const handleMovieAddedToWishList = (movie: any) => {
    // Refresh the wish list when a movie is added
    if (wishListRef.current && wishListRef.current.refreshItems) {
      wishListRef.current.refreshItems();
    }
  };

  const handleWishListAddAlbum = (mode: string) => {
    // Navigate to musicdex and open add dialog
    navigate('/musicdex');
    setTimeout(() => {
      if (musicDexRef.current && musicDexRef.current.openAddDialog) {
        musicDexRef.current.openAddDialog();
      }
    }, 100);
  };

  const handleWishListAddBook = (mode: string) => {
    // Navigate to bookdex and open add dialog
    navigate('/bookdex');
    setTimeout(() => {
      if (bookDexRef.current && bookDexRef.current.openAddDialog) {
        bookDexRef.current.openAddDialog();
      }
    }, 100);
  };

  const handleBookMovedToCollection = (book: any) => {
    // Refresh book dex if it's open
    // Note: BookDexPage doesn't have a refreshBooks method yet, but this is ready for future use
  };

  const handleBookAdded = (_id?: number) => {
    // Don't show success messages for wish list additions
    // Only show errors if needed
  };

  const handleAlbumMovedToCollection = (album: any) => {
    refreshShelfLocations();
    // Refresh music dex if it's open
    if (musicDexRef.current && musicDexRef.current.refreshAlbums) {
      musicDexRef.current.refreshAlbums();
    }
  };

  const handleAlbumAdded = (_id?: number) => {
    refreshShelfLocations();
    // Don't show success messages for wish list additions
    // Only show errors if needed
  };

  const handleSearchFromAlbumDetail = (criteria: SearchCriteria) => {
    setSearchCriteria(criteria);
  };

  const handleMovieMovedToCollection = () => {
    refreshShelfLocations();
    // Refresh collection when a movie is moved from wish list to collection
    if (movieSearchRef.current && movieSearchRef.current.refreshMovies) {
      movieSearchRef.current.refreshMovies();
    }
  };

  const handleAddMovieSuccess = () => {
    refreshShelfLocations();
    // Refresh movies when a movie is successfully added
    if (movieSearchRef.current && movieSearchRef.current.refreshMovies) {
      movieSearchRef.current.refreshMovies();
    }
    // Also refresh wish list if we're on the wish list page
    if (wishListRef.current && wishListRef.current.refreshItems) {
      wishListRef.current.refreshItems();
    }
  };

  const handleShowAlert = (message: string, type: string) => {
    toast(message, { tone: toneOf(type) });
  };

  const handleMovieAdded = (message: string, type: string) => {
    // Don't show success messages when on wish list page
    if (location.pathname !== '/wishlist' || type !== 'success') {
      handleShowAlert(message, type);
    }

    // Refresh the appropriate list based on current page
    setTimeout(() => {
      if (location.pathname === '/wishlist' && wishListRef.current && wishListRef.current.refreshMovies) {
        wishListRef.current.refreshMovies();
      } else if (movieSearchRef.current && movieSearchRef.current.refreshMovies) {
        movieSearchRef.current.refreshMovies();
      }
    }, 100);
  };

  // Handle search query parameter from URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchParam = params.get('search');

    // An empty one counts too: the last filter taken away empties the search.
    if (searchParam !== null) {
      // Set the search criteria
      setSearchCriteria({ searchText: searchParam });
      // Clear the URL parameter after a brief delay to keep URL clean
      setTimeout(() => {
        navigate(location.pathname, { replace: true });
      }, 100);
    }
  }, [location.search, navigate, location.pathname]);

  // The same words kept as they are: a section opened with the search it had is not drawn twice.
  const setSearchText = (searchText: string) =>
    setSearchCriteria(previous => (previous.searchText === searchText ? previous : { searchText }));

  // The section the search belongs to. Arriving in another, its own search comes back in the
  // same render (the address's ?search= first, else the one it had): its page is drawn once,
  // with its search, not first with the last section's, then again with its own.
  const [searchProduct, setSearchProduct] = useState<string | null>(product);
  if (product !== searchProduct) {
    setSearchProduct(product);
    const asked = new URLSearchParams(location.search).get('search');
    setSearchText(asked || (product ? readStored(`dexvault-${product}-search`) || '' : ''));
  }

  // Save the search, per section, to the section it belongs to.
  useEffect(() => {
    if (searchProduct) writeStored(`dexvault-${searchProduct}-search`, searchCriteria.searchText || '');
  }, [searchCriteria.searchText, searchProduct]);

  // Check for backfill on app startup
  useEffect(() => {
    const checkBackfillStatus = async () => {
      if (hasCheckedBackfill) return;

      // Check if user has previously ignored the backfill
      const hasIgnoredBackfill = readStored('dexvault_backfill_ignored') === 'true';
      if (hasIgnoredBackfill) {
        setHasCheckedBackfill(true);
        return;
      }

      try {
        // Backfill check removed - no longer needed
        console.log('Backfill check skipped');
      } catch (error) {
        console.error('Error in backfill check:', error);
      } finally {
        setHasCheckedBackfill(true);
      }
    };

    checkBackfillStatus();
  }, [hasCheckedBackfill]);


  return (
    <div className="App">
      <header className="App-header">
        <div className={`App-header-content ${!showSearchBar ? 'no-search' : ''} ${isSearchFocused ? 'search-focused' : ''}`}>
          {/* First row: Navigation and toolbar */}
          <div className="App-header-top">
            {showNavigationPills ? (
              <Segmented
                label="Collections"
                size="lg"
                tone="gold"
                className="app-sections"
                reselect
                value={location.pathname.startsWith('/musicdex') ? 'musicdex' : location.pathname.slice(1)}
                onChange={section => ({ filmdex: handleCollection, musicdex: handleMusicDex, bookdex: handleBookDex, scores: () => navigate('/scores'), wishlist: handleWishList, analytics: handleAnalytics } as Record<string, () => void>)[section]?.()}
                options={[
                  { value: 'filmdex', icon: <BsFilm />, tooltip: 'FilmDex - My precious movies \u00B7 \u23181' },
                  { value: 'musicdex', icon: <BsDisc />, tooltip: 'MusicDex - My precious albums \u00B7 \u23182' },
                  { value: 'bookdex', icon: <BsBook />, tooltip: 'BookDex - My precious books \u00B7 \u23183' },
                  { value: 'scores', icon: <BsFileMusic />, tooltip: 'Scores - My sheet music \u00B7 \u23184' },
                  { value: 'wishlist', icon: <BsBookmark />, tooltip: 'Wish List - My precious to come \u00B7 \u23185' },
                  { value: 'analytics', icon: <BsBarChart />, tooltip: 'Analytics - The palant\u00EDr of data \u00B7 \u23186' },
                ]}
              />
            ) : (
              <div className="App-title">
                <div onClick={handleDexVaultClick}>
                  <h1>{getPageTitle()}</h1>
                </div>

              </div>
            )}
            <div className="App-toolbar">
              <CogDropdown
                onSyncNavidrome={handleSyncNavidrome}
                syncingNavidrome={navidrome.syncing}
                onBackup={handleBackup}
                onShelves={handleShelves}
                currentPage={location.pathname === '/musicdex' ? 'musicdex' : location.pathname === '/bookdex' ? 'bookdex' : 'filmdex'}
              />
            </div>
          </div>

          {/* Second row on a phone: the search, in pills (components/shared/search). */}
          {showSearchBar && searchSchema && (
            <div className="App-search">
              <SearchPills
                schema={searchSchema}
                value={searchCriteria.searchText}
                onChange={searchText => setSearchCriteria({ searchText })}
                inputRef={searchInputRef}
                recentKey={product ? `dexvault-${product}-recent-searches` : undefined}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                endAdornment={<>
                  {searchCriteria.searchText && (
                    <IconButton label="Clear the search" size="sm" onClick={() => setSearchCriteria({ searchText: '' })}><BsX /></IconButton>
                  )}
                  {location.pathname !== '/wishlist' && (
                    <Menu align="end" label="Advanced filters" onOpenChange={open => { if (open) fetchFilterData(); }}
                      trigger={(props, open) => (
                        <IconButton {...props} label="Advanced filters" size="sm"><MenuChevron open={open} /></IconButton>
                      )}>
                      {filterSections().map((section, index) => (
                        <React.Fragment key={section.title}>
                          {index > 0 && <Menu.Separator />}
                          <Menu.Section title={section.title} />
                          {section.options.map(option => (
                            <Menu.Item key={option.label} onSelect={() => handleFilterSelection(option.type, option.value)}>{option.label}</Menu.Item>
                          ))}
                        </React.Fragment>
                      ))}
                    </Menu>
                  )}
                </>}
              />
            </div>
          )}
        </div>
      </header>

      <ShelfMovesNotice />
      <main className="App-main">
        <Routes>
          <Route
            path="/"
            element={<LastSection />}
          />
          <Route
            path="/filmdex"
            element={
              <FilmDexPage
                ref={movieSearchRef}
                refreshTrigger={refreshTrigger}
                searchCriteria={searchCriteria}
                loading={loading}
                setLoading={setLoading}
                onShowAlert={handleMovieAdded}
                onAddMovie={handleAddMovie}
                onSearch={handleSearchFromMovieDetail}
              />
            }
          />
          <Route path="/musicdex" element={<MusicDexPage ref={musicDexRef} searchCriteria={searchCriteria} />} />
          {/* The Digital page is MusicDex with Digital on: its tabs are filters there. */}
          <Route path="/musicdex/digital" element={<DigitalRedirect />} />
          <Route path="/musicdex/rip" element={<Navigate to="/musicdex?digital=1" replace />} />
          <Route path="/bookdex" element={<BookDexPage ref={bookDexRef} searchCriteria={searchCriteria} />} />
          <Route path="/scores" element={<ScoresPage searchCriteria={searchCriteria} />} />
          <Route path="/wishlist" element={<WishListPage ref={wishListRef} searchCriteria={searchCriteria} onAddMovie={handleWishListAddMovie} onAddAlbum={handleWishListAddAlbum} onAddBook={handleWishListAddBook} onMovieMovedToCollection={handleMovieMovedToCollection} onAlbumMovedToCollection={handleAlbumMovedToCollection} onBookMovedToCollection={handleBookMovedToCollection} onShowAlert={handleShowAlert} onMovieAdded={handleMovieAdded} onAlbumAdded={handleAlbumAdded} onBookAdded={handleBookAdded} onSearch={handleSearchFromMovieDetail} />} />
          <Route path="/shelves" element={<ShelvesPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/backup" element={<BackupPage />} />
        </Routes>
      </main>
      <PlayerBar />
      {/* The remote: a computer tells what it plays and does what it is told; a phone tells it. */}
      {isComputer() ? <RemoteReporter /> : <RemoteBar />}
      <LyricsPanel />
      <ConfirmHost />
      <ToastHost />
      <TooltipHost />


      <AddMovieDialog
        isOpen={showAddMovieDialog}
        onClose={handleAddMovieDialogClose}
        initialMode={addMovieMode}
        onSuccess={handleAddMovieSuccess}
        onMovieAdded={handleMovieAdded}
      />

      {/* Scroll to Top FAB - Mobile Only */}
      <ScrollToTop />
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
