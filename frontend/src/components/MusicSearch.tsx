import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import musicService from '../services/musicService';
import { base64ToFile } from '../utils/downscaleImage';
import MusicForm from './MusicForm';
import MusicThumbnail from './MusicThumbnail';
import MusicDetailCard from './MusicDetailCard';
import { showAlbum, type ShownAlbum } from '../services/phoneDoor';
import { LISTEN_NEXT_CHANGED_EVENT } from './useAlbumAtRest';
import AddMusicDialog from './AddMusicDialog';
import AlphabeticalIndex from './AlphabeticalIndex';
import { NextBanner, NextBannerPending, NextBannerSlot, CollectionHeader, EmptyState } from './shared';
import { hasMatchScores, useBestMatch } from './shared/search/bestMatch';
import { useOpenItem } from '../services/openItem';
import { BsChevronDown, BsDisc, BsHeadphones, BsShuffle } from 'react-icons/bs';
import './MusicSearch.css';
import { readStored, writeStored } from '../utils/safeStorage';
import { findById, useDetailSteps } from '../utils/detailSteps';
import { albumImages } from '../utils/detailImages';
import { useAlbumOrder } from '../utils/shelfLocations';
import { artistLetter, artistSortKey, artistSortName } from '../utils/artistOrder';
import AlbumPlayButton from './shared/AlbumPlayButton';
import CoverButton from './shared/CoverButton';
import { LeavingOverlay, ListenNextControls, ListenNextSummary, useListenNextPlay } from './ListenNextPlay';
import { INSTEAD, ListenNextSwitch, MediumIcon, MoveButton, OtherListName, askStars, mediumOf, otherMedium } from './ListenNextLists';
import { toast } from './shared/Toast';
import type { ClassicalChoice, ListenNextMedium } from '../services/musicService';
import { listenNextQueue } from '../services/listenNextQueue';
import { usePlayer } from '../services/player';
import { heldOf, keyOf, listenNextTitle } from '../utils/listenNextEntry';
import CoverTag, { CoverTagStack } from './shared/CoverTag';
import { DigitalChips, DigitalNotices, type DigitalFilter } from './DigitalStrip';
import DigitalMarks from './shared/DigitalMarks';
import BoughtCdDialog from './BoughtCdDialog';
import MixtapeDialog from './MixtapeDialog';
import { reloadMixtapes, useMixtapes } from '../utils/mixtapeStore';
import { isMixtape } from '../utils/mixtape';
import { BsBookmarkFill, BsCartFill, BsChevronRight } from 'react-icons/bs';
import {
  DIGITAL_ON_KEY, buyOrder, buyReason, isDismissed, isSuggested, isToBuy, useDigitalLibrary, type AlbumDigital,
} from '../utils/digitalLibrary';
import Button from './shared/Button';
import Segmented from './shared/Segmented';
import Notice from './shared/Notice';
import Spinner, { Loading } from './shared/Spinner';
import { asksMixtapes, asksNavidrome } from '../utils/musicSearchWords';
import { isKept, useKeptState } from '../utils/kept';
import { useMedia, useNarrow } from '../utils/useNarrow';
import Progressive from './shared/Progressive';

interface MusicSearchProps {
  cds: any;
  loading: boolean;
  onAddCd: (cdData: any) => Promise<any>;
  onAddCdFromMusicBrainz: (releaseId: string, cdData: any) => Promise<any>;
  onAddCdByBarcode: (barcode: string, cdData: any) => Promise<any>;
  onUpdateCd: (id: number | string, cdData: any) => void;
  onDeleteCd: (id: number | string) => Promise<any>;
  onShowAlert?: (message: string, variant: string) => void;
  onOpenAddDialog?: () => void;
  refreshTrigger?: number;
  searchCriteria?: { searchText?: string; [key: string]: any } | null;
}

/** Whether the mixtapes show among the albums: on unless turned off. */
const MIXTAPES_ON_KEY = 'dexvault.musicdex.mixtapes';

interface Album {
  /** How well a search's plain words name it (shared/search/bestMatch.ts). */
  matchScore?: number;
  id: number;
  title: string;
  artist: string | string[];
  cover?: string;
  releaseYear?: number;
  createdAt?: string;
  genres?: string[];
  labels?: string[];
  country?: string;
  recordingQuality?: string;
  [key: string]: any;
}

/** Listen Next's list in sight, Digital or CD. */
const NEXT_MEDIUM_KEY = 'dv.listenNext.medium';
/** What Help me choose and the die draw: everything but classical, or classical. */
const NEXT_CLASSICAL_KEY = 'dv.listenNext.classical';
/** What a draw takes, said after "drawn from": in the die's tooltip and the word after a draw. */
const DRAWN_FROM: Record<ClassicalChoice, string> = { pop: 'pop', classical: 'classical', both: 'the whole collection' };

interface SmartFillResult {
  albums: Album[];
  added: number;
  [key: string]: any;
}

interface ShuffleResult {
  success: boolean;
  albums?: Album[];
  added?: { title?: string; [key: string]: any };
  message?: string;
  [key: string]: any;
}

const FILTERS: DigitalFilter[] = ['all', 'buy'];
const NOTHING_KNOWN: AlbumDigital = { album: null, notRipped: false };

/** An album of the collection, as opposed to a wish or a digital album: there is a CD. */
const hasCd = (album: Album) => album.titleStatus !== 'digital' && album.titleStatus !== 'wish';

const MusicSearch = forwardRef<any, MusicSearchProps>(({
  cds,
  loading,
  onAddCd,
  onAddCdFromMusicBrainz,
  onAddCdByBarcode,
  onUpdateCd,
  onDeleteCd,
  onShowAlert,
  onOpenAddDialog,
  refreshTrigger,
  searchCriteria
}, ref) => {
  // Kept for the session, as the page's albums: the grid and its banner drawn at once on coming back.
  const [allCds, setAllCds] = useKeptState<Album[]>('musicdex:allCds', []);
  const [filteredCds, setFilteredCds] = useKeptState<Album[]>('musicdex:filteredCds', []);
  // Load sort preference from localStorage, default to 'title'
  const [sortBy, setSortBy] = useState(() => {
    const savedSort = readStored('dexvault-musicdex-sort');
    return savedSort || 'title';
  });
  const [sortLoading, setSortLoading] = useState(false);
  // The shelves' order, read by sortCds through the ref: it arrives after the albums.
  const albumOrder = useAlbumOrder();
  // On an appliance of the house (Salon) an iPhone plays as a computer does, there.
  const albumOrderRef = useRef(albumOrder);
  albumOrderRef.current = albumOrder;
  const byArtistSort = sortBy === 'artist' || sortBy === 'artistReverse';
  const letterOf = (cd: Album): string => {
    if (byArtistSort) return artistLetter(cd, albumOrder);
    const firstChar = cd.title?.charAt(0)?.toUpperCase() || '';
    return /[A-Z]/.test(firstChar) ? firstChar : '#';
  };
  const [groupBy, setGroupBy] = useState('none');
  const [groupLoading, setGroupLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set<string>());
  const [expandAllGroups, setExpandAllGroups] = useState(false);
  const [cdCount, setCdCount] = useKeptState('musicdex:cdCount', { filtered: 0, total: 0 });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [addError, setAddError] = useState('');
  const [editingCd, setEditingCd] = useState<any>(null);
  const [reviewingRelease, setReviewingRelease] = useState<any>(null);
  // The sleeve photo waits here: the cover endpoint needs an album id, which
  // only exists once the form has been submitted.
  const [pendingCover, setPendingCover] = useState<{ base64: string; mimeType: string } | null>(null);
  const [pendingBack, setPendingBack] = useState<{ base64: string; mimeType: string } | null>(null);
  const [selectedCdDetails, setSelectedCdDetails] = useState<any>(null);
  // On a phone, a cover opens the full screen player on its album, its card in ⋯.
  const phone = useMedia('(max-width: 767px)');
  const narrow = useNarrow();
  const [, setLoadingDetails] = useState(false);
  const [cdDetailsBeforeEdit, setCdDetailsBeforeEdit] = useState<any>(null);
  const previousSearchTextRef = useRef('');
  const navigate = useNavigate();
  const location = useLocation();
  const [listenNextAlbums, setListenNextAlbums] = useKeptState<Album[]>('musicdex:listenNext', []);
  const [smartFillLoading, setSmartFillLoading] = useState(false);
  const [shufflingAlbumId, setShufflingAlbumId] = useState<number | null>(null);

  // Digital on: the albums with no CD join the grid, each album wears what sets it apart, the filters show.
  const [digitalOn, setDigitalOn] = useState<boolean>(() =>
    new URLSearchParams(location.search).get('digital') === '1' || readStored(DIGITAL_ON_KEY) === '1');
  const [digitalFilter, setDigitalFilter] = useState<DigitalFilter>(() => {
    const asked = new URLSearchParams(location.search).get('filter') as DigitalFilter | null;
    return asked && FILTERS.includes(asked) ? asked : 'all';
  });
  const [showDismissed, setShowDismissed] = useState(false);
  // Mixtapes on: the owner's playlists in Navidrome join the grid among the CDs.
  const [mixtapesOn, setMixtapesOn] = useState<boolean>(() => readStored(MIXTAPES_ON_KEY) !== '0');
  const { mixtapes } = useMixtapes();
  // With a search, the mixtapes it finds, by their name or what they hold.
  const [mixtapesFound, setMixtapesFound] = useState<Album[] | null>(null);
  const [openMixtape, setOpenMixtape] = useState<number | null>(null);
  // The album whose CD was just bought, its dialog open.
  const [buying, setBuying] = useState<any>(null);
  const digital = useDigitalLibrary(digitalOn);
  // The wishes and digital albums, those Navidrome has joining the grid.
  const [extraCds, setExtraCds] = useKeptState<Album[]>('musicdex:extraCds', []);
  // With Digital on, what a search finds among the CDs and the albums with no CD, its keywords and all.
  const [hybridFound, setHybridFound] = useState<Album[] | null>(null);

  // Ref and state for scroll container (for alphabetical index)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The page scrolls as a whole: the alphabetical index follows the document, known from the first render
  // (found in an effect, it drew the whole grid a second time as the section opened).
  const scrollContainer: HTMLElement = document.documentElement;


  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    refresh: loadCds,
    search: performSearch,
    openAddDialog: () => setShowAddDialog(true),
    openAlbumDetails: (album: any) => setSelectedCdDetails(album),
    setSearchQuery: (query: string) => {
      // Update the URL with the new search query
      navigate(`${location.pathname}?search=${encodeURIComponent(query)}`);
    }
  }));

  // Function to update search via URL (which will update the search bar in App.js)
  const updateSearchViaUrl = (query: string) => {
    navigate(`${location.pathname}?search=${encodeURIComponent(query)}`);
  };

  useEffect(() => {
    loadCds();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const loadExtraCds = useCallback(async () => {
    try {
      const [digitalAlbums, wishes] = await Promise.all([
        musicService.getAlbumsByStatus('digital') as Promise<Album[]>,
        musicService.getAlbumsByStatus('wish') as Promise<Album[]>,
      ]);
      setExtraCds([...digitalAlbums, ...wishes]);
    } catch (error) {
      console.warn('Failed to load the albums with no CD:', error);
    }
  }, []);

  // Read again as the library changes: a sync adds digital albums, a wish turns one into another.
  useEffect(() => {
    if (digitalOn) loadExtraCds();
  }, [digitalOn, digital.library, refreshTrigger, loadExtraCds]);

  // ?digital=1&filter=buy, as the old Digital page's links become: taken once, then left out of the address.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('digital') && !params.has('filter')) return;
    if (params.get('digital') === '1') writeStored(DIGITAL_ON_KEY, '1');
    params.delete('digital');
    params.delete('filter');
    const search = params.toString();
    navigate({ search: search ? `?${search}` : '' }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDigital = () => {
    const next = !digitalOn;
    setDigitalOn(next);
    writeStored(DIGITAL_ON_KEY, next ? '1' : '0');
    if (!next) setDigitalFilter('all');
  };

  // cd:, file:, ripped: and favourites: ask what Navidrome has: they turn Digital on.
  useEffect(() => {
    if (digitalOn || !asksNavidrome(searchCriteria?.searchText || '')) return;
    setDigitalOn(true);
    writeStored(DIGITAL_ON_KEY, '1');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria?.searchText]);

  // Load Listen Next albums
  // The banner shows once its lists are read: not first empty, then grown.
  const [listenNextRead, setListenNextRead] = useState(() => isKept('musicdex:listenNext'));
  const refreshListenNextAlbums = useCallback(async () => {
    try {
      const albums = await musicService.getListenNextAlbums() as Album[];
      setListenNextAlbums(albums);
    } catch (error) {
      console.warn('Failed to load Listen Next albums:', error);
      setListenNextAlbums([]);
    } finally {
      setListenNextRead(true);
    }
  }, []);

  useEffect(() => {
    refreshListenNextAlbums();
  }, [refreshTrigger, refreshListenNextAlbums]);
  // Changed from the full screen player's ⋯, an album at rest there: the banner reads its lists again.
  useEffect(() => {
    const changed = () => { void refreshListenNextAlbums(); };
    window.addEventListener(LISTEN_NEXT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(LISTEN_NEXT_CHANGED_EVENT, changed);
  }, [refreshListenNextAlbums]);

  // Playing Listen Next from its banner: ▶, Repeat, the albums leaving it once played.
  const listenNext = useListenNextPlay(listenNextAlbums, refreshListenNextAlbums, albums => setListenNextAlbums(albums as Album[]));

  // Listen Next's list in sight, Digital or CD, kept from one visit to the next; the other at the foot, small.
  const [nextMedium, setNextMedium] = useState<ListenNextMedium>(() => (readStored(NEXT_MEDIUM_KEY) === 'cd' ? 'cd' : 'digital'));
  const [nextClassical, setNextClassical] = useState<ClassicalChoice>(() => {
    const stored = readStored(NEXT_CLASSICAL_KEY);
    // Both is no longer offered (Help me choose stays square on an iPhone): a choice of both kept from before draws pop.
    return stored === 'classical' ? 'classical' : 'pop';
  });
  const chooseNextClassical = useCallback((choice: ClassicalChoice) => {
    setNextClassical(choice);
    writeStored(NEXT_CLASSICAL_KEY, choice);
  }, []);
  // Under Help me choose: what a draw takes.
  const drawFrom = (
    <Segmented label="Draw from" size="sm" value={nextClassical} onChange={chooseNextClassical} options={[
      { value: 'pop', label: 'Pop', tooltip: 'Everything but classical' },
      { value: 'classical', label: 'Classical' },
    ]} />
  );
  const chooseNextMedium = useCallback((medium: ListenNextMedium) => {
    setNextMedium(medium);
    writeStored(NEXT_MEDIUM_KEY, medium);
  }, []);
  const nextCounts = useMemo(() => ({
    digital: listenNextAlbums.filter(album => mediumOf(album) === 'digital').length,
    cd: listenNextAlbums.filter(album => mediumOf(album) === 'cd').length,
  }), [listenNextAlbums]);
  // A card shown from its small cover: scrolled to, lit a moment.
  const [foundNext, setFoundNext] = useState<string | null>(null);
  useEffect(() => {
    if (!foundNext) return undefined;
    // The row alone scrolls to it, sideways: the page stays where it is.
    const card = document.querySelector<HTMLElement>(`.next-banner [data-key="${CSS.escape(foundNext)}"]`);
    const row = card?.closest<HTMLElement>('.next-banner__carousel');
    if (card && row) {
      const left = card.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
      row.scrollTo({ left: left - (row.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' });
    }
    const timer = window.setTimeout(() => setFoundNext(null), 1600);
    return () => window.clearTimeout(timer);
  }, [foundNext]);
  const showNext = useCallback((key: string) => {
    chooseNextMedium(otherMedium(nextMedium));
    setFoundNext(key);
  }, [chooseNextMedium, nextMedium]);

  /**
   * An entry of Listen Next to a list, with its other discs: before the one
   * named, else at its start or its end. Shown at once, then as the server has it.
   */
  const moveNext = useCallback(async (key: string, medium: ListenNextMedium, at: 'start' | 'end', before?: string | null) => {
    const albumId = Number(key.split(':')[0]);
    setListenNextAlbums(previous => {
      const moving = previous.filter(album => album.id === albumId).map(album => ({ ...album, medium }));
      const rest = previous.filter(album => album.id !== albumId);
      const place = before ? rest.findIndex(album => keyOf(album) === before) : -1;
      if (place >= 0) return [...rest.slice(0, place), ...moving, ...rest.slice(place)];
      return at === 'start' ? [...moving, ...rest] : [...rest, ...moving];
    });
    try {
      const result = await musicService.moveListenNext(key, medium, at, before);
      setListenNextAlbums(result.albums as Album[]);
    } catch (error) {
      console.error('Error moving a Listen Next entry:', error);
      refreshListenNextAlbums();
      toast('Listen Next was not changed', { tone: 'danger' });
    }
  }, [refreshListenNextAlbums]);

  /** A CD of the collection can go on the player; a digital album, a wish or a mixtape cannot. */
  const canBeCd = (album: Album) => (album.titleStatus ?? 'owned') === 'owned';
  /**
   * A cover dropped in a list (the row, 'here'; the strip or a list's name):
   * into it, before the one it was dropped at; on a name, at the end of the
   * list in sight, else at the start of the other.
   */
  const dropNext = (key: string, target: string, before?: string | null) => {
    const album = listenNextAlbums.find(one => keyOf(one) === key);
    if (!album) return;
    const to: ListenNextMedium = target === 'here' ? nextMedium : target === 'cd' ? 'cd' : 'digital';
    if (mediumOf(album) === to) return;
    if (to === 'cd' && !canBeCd(album)) {
      toast(`${album.title} is not a CD of the collection: it stays in Digital`, { tone: 'warning' });
      return;
    }
    void moveNext(key, to, before === null ? 'end' : to === nextMedium ? 'end' : 'start', before);
  };

  // Listen Next dragged into a new order: shown at once, then as the server has it; the player goes by it at the next album.
  const handleListenNextReorder = useCallback(async (keys: Array<string | number>) => {
    const order = keys.map(String);
    setListenNextAlbums(previous => [...previous].sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b))));
    try {
      const result = await musicService.reorderListenNext(order);
      setListenNextAlbums(result.albums as Album[]);
    } catch (error) {
      console.error('Error reordering Listen Next:', error);
      refreshListenNextAlbums();
      if (onShowAlert) onShowAlert('Failed to reorder Listen Next', 'danger');
    }
  }, [refreshListenNextAlbums, onShowAlert]);

  // Smart fill Listen Next with suggested albums, drawn from any album: a CD or digital alone.
  const handleSmartFill = useCallback(async () => {
    if (smartFillLoading) return;

    setSmartFillLoading(true);
    try {
      const result = await musicService.smartFillListenNext(nextClassical) as SmartFillResult;
      setListenNextAlbums(result.albums || []);

      if (result.added > 0 && onShowAlert) {
        onShowAlert(`🎲 Added ${result.added} album${result.added !== 1 ? 's' : ''}, drawn from ${DRAWN_FROM[nextClassical]}`, 'success');
      }
    } catch (error) {
      console.error('Error in smart fill:', error);
      if (onShowAlert) {
        onShowAlert('Failed to add suggestions', 'danger');
      }
    } finally {
      setSmartFillLoading(false);
    }
  }, [smartFillLoading, onShowAlert, nextClassical]);

  // Shuffle a specific album in Listen Next (replace with a new suggestion)
  const handleShuffleAlbum = useCallback(async (album: Album) => {
    if (shufflingAlbumId !== null) return;

    setShufflingAlbumId(album.id);
    try {
      const result = await musicService.shuffleListenNextAlbum(album.id, nextClassical) as ShuffleResult;

      if (result.success) {
        setListenNextAlbums(result.albums || []);

        if (onShowAlert) {
          onShowAlert(`🎲 Swapped for "${result.added?.title}", drawn from ${DRAWN_FROM[nextClassical]}`, 'success');
        }
      } else {
        if (onShowAlert) {
          onShowAlert(result.message || 'No replacement available', 'warning');
        }
      }
    } catch (error) {
      console.error('Error shuffling album:', error);
      if (onShowAlert) {
        onShowAlert('Failed to shuffle album', 'danger');
      }
    } finally {
      setShufflingAlbumId(null);
    }
  }, [shufflingAlbumId, onShowAlert, nextClassical]);

  // Handle search from App.js
  useEffect(() => {
    const currentSearchText = searchCriteria?.searchText || '';

    // Only run if search text has actually changed
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
        setFilteredCds(allCds);
        setCdCount({ filtered: allCds.length, total: allCds.length });
      }
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria?.searchText, allCds]);

  const loadCds = async () => {
    try {
      const data = await musicService.getAlbumsByStatus('owned') as Album[];
      // Apply default sorting to loaded data
      const sortedInitial = sortCds(data, sortBy);
      setAllCds(sortedInitial);

      // Respect current search criteria when reloading
      const currentSearchText = searchCriteria?.searchText || '';
      if (currentSearchText.trim()) {
        // Re-apply search filter
        const localResults = await musicService.searchAlbums(currentSearchText) as Album[];
        const sortedResults = sortCds(localResults, sortBy);
        setFilteredCds(sortedResults);
        setCdCount({ filtered: sortedResults.length, total: sortedInitial.length });
      } else {
        // No search - show all albums
        setFilteredCds(sortedInitial);
        setCdCount({ filtered: sortedInitial.length, total: sortedInitial.length });
      }
    } catch (error) {
      console.error('Error loading albums:', error);
      if (onShowAlert) {
        onShowAlert('Failed to load albums: ' + (error as Error).message, 'danger');
      }
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      const sortedAll = sortCds(allCds, sortBy);
      setFilteredCds(sortedAll);
      setCdCount({ filtered: sortedAll.length, total: allCds.length });
      return;
    }

    try {
      // Search local albums
      const localResults = await musicService.searchAlbums(query) as Album[];
      // An answer to letters since changed comes too late: the newer search shows.
      if (query !== previousSearchTextRef.current) return;
      const sortedResults = sortCds(localResults, sortBy);
      setFilteredCds(sortedResults);
      setCdCount({ filtered: sortedResults.length, total: allCds.length });
    } catch (error) {
      console.error('Error searching:', error);
      if (onShowAlert) {
        onShowAlert('Search failed: ' + (error as Error).message, 'danger');
      }
    }
  };

  // While letters are typed the best match comes first, this sort between equals (useBestMatch).
  const bestMatch = useBestMatch(searchCriteria?.searchText || '');

  const sortCdsBy = useCallback((cdsToSort: Album[], sortOption: string) => {
    const sorted = [...cdsToSort];
    const order = albumOrderRef.current;
    const byArtist = (a: Album, b: Album) => {
      const keyA = artistSortKey(a, order);
      const keyB = artistSortKey(b, order);
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    };

    switch (sortOption) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'titleReverse':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      // As the CDs stand on the shelves: "Chapman, Tracy" at C, "-M-" at M.
      case 'artist':
        return sorted.sort(byArtist);
      case 'artistReverse':
        return sorted.sort((a, b) => byArtist(b, a));
      case 'year':
        return sorted.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
      case 'yearReverse':
        return sorted.sort((a, b) => (a.releaseYear || 0) - (b.releaseYear || 0));
      case 'lastAdded':
        return sorted.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
      case 'lastAddedReverse':
        return sorted.sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
      default:
        return sorted;
    }
  }, []);
  const sortCds = useCallback((items: Album[], sortOption: string) =>
    bestMatch.order(sortCdsBy(items, sortOption)), [sortCdsBy, bestMatch.order]);

  // The shelves' order comes after the albums, or changes with them: sort again by it.
  useEffect(() => {
    if (!byArtistSort) return;
    setAllCds(cds => sortCds(cds, sortBy));
    setFilteredCds(cds => sortCds(cds, sortBy));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumOrder]);

  const digitalOf = useCallback((cd: Album): AlbumDigital => digital.byAlbumId.get(Number(cd.id)) ?? NOTHING_KNOWN, [digital.byAlbumId]);

  const searchText = (searchCriteria?.searchText || '').trim();
  useEffect(() => {
    setHybridFound(null);
    if (!digitalOn || !searchText) return undefined;
    let current = true;
    musicService.searchAlbums(searchText, { withNoCd: true })
      .then(found => { if (current) setHybridFound(found as Album[]); })
      .catch(error => console.warn('Search with the digital albums failed:', error));
    return () => { current = false; };
  }, [digitalOn, searchText, extraCds]);

  useEffect(() => {
    setMixtapesFound(null);
    if (!mixtapesOn || !searchText) return undefined;
    let current = true;
    musicService.searchAlbums(searchText, { mixtapes: true })
      .then(found => { if (current) setMixtapesFound(found as Album[]); })
      .catch(error => console.warn('Search among the mixtapes failed:', error));
    return () => { current = false; };
  }, [mixtapesOn, searchText, mixtapes]);

  const toggleMixtapes = () => {
    const next = !mixtapesOn;
    setMixtapesOn(next);
    writeStored(MIXTAPES_ON_KEY, next ? '1' : '0');
  };

  // Read again with the albums: a playlist made or changed in Amperfy shows as the page is opened again.
  useEffect(() => { reloadMixtapes(); }, [refreshTrigger]);

  // mixtape:yes (or -mixtape:no) asks for the mixtapes: it turns Mixtapes on.
  useEffect(() => {
    if (mixtapesOn || !asksMixtapes(searchCriteria?.searchText || '')) return;
    setMixtapesOn(true);
    writeStored(MIXTAPES_ON_KEY, '1');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria?.searchText]);

  // A mixtape asked for as an album (from Listen Next, ‹ ›, the player's bar): its own card.
  useEffect(() => {
    if (!isMixtape(selectedCdDetails)) return;
    setOpenMixtape(Number(selectedCdDetails.id));
    setSelectedCdDetails(null);
  }, [selectedCdDetails]);

  /**
   * The grid with Digital on: the CDs, and the albums with no CD that
   * Navidrome has; when searching, those of them the search finds.
   */
  const hybridCds = useMemo(() => {
    if (!digitalOn) return filteredCds;
    const inNavidrome = (cd: Album) => hasCd(cd) || digital.byAlbumId.has(Number(cd.id));
    if (searchText) return sortCds((hybridFound ?? filteredCds).filter(inNavidrome), sortBy);
    return sortCds([...filteredCds, ...extraCds.filter(inNavidrome)], sortBy);
  }, [digitalOn, filteredCds, extraCds, hybridFound, digital.byAlbumId, searchText, sortCds, sortBy]);

  const filterCounts = useMemo((): Record<DigitalFilter, number> => ({
    all: hybridCds.length,
    buy: hybridCds.filter(cd => !hasCd(cd) && isToBuy(digitalOf(cd).album)).length,
  }), [hybridCds, digitalOf]);

  /** What the grid shows: every album, or those of the filter. Buy is shown in its own sections. */
  const cdsShown = useMemo(() => {
    if (!digitalOn) return filteredCds;
    switch (digitalFilter) {
      case 'buy': return hybridCds.filter(cd => !hasCd(cd) && isToBuy(digitalOf(cd).album))
        .sort((a, b) => buyOrder(digitalOf(a).album!, digitalOf(b).album!));
      default: return hybridCds;
    }
  }, [digitalOn, digitalFilter, filteredCds, hybridCds, digitalOf]);

  /** What the grid shows: the albums, and the mixtapes among them, sorted as they are; not in Buy. */
  const shownCds = useMemo(() => {
    if (!mixtapesOn || (digitalOn && digitalFilter === 'buy')) return cdsShown;
    const found = searchText ? (mixtapesFound ?? []) : mixtapes.map(mixtape => mixtape.album as unknown as Album);
    return found.length === 0 ? cdsShown : sortCds([...cdsShown, ...found], sortBy);
  }, [mixtapesOn, digitalOn, digitalFilter, cdsShown, searchText, mixtapesFound, mixtapes, sortCds, sortBy]);

  const dismissedCds = useMemo(() => (digitalOn && digitalFilter === 'buy'
    ? hybridCds.filter(cd => !hasCd(cd) && isDismissed(digitalOf(cd).album)) : []), [digitalOn, digitalFilter, hybridCds, digitalOf]);

  // Buy on a phone: its count alone in the head, the sort and the grouping doing nothing to its list.
  const buyOnPhone = narrow && digitalOn && digitalFilter === 'buy';

  const chooseFilter = (filter: DigitalFilter) => {
    setDigitalFilter(filter);
    setShowDismissed(false);
  };

  /** The bookmark of an album with no CD: on the wish list or off it, the same album either way. */
  const toggleWish = async (cd: Album) => {
    const album = digitalOf(cd).album;
    if (!album) return;
    await digital.change(() => musicService.setDigitalWished(album.navidromeId, cd.titleStatus !== 'wish'));
    await loadExtraCds();
    if (selectedCdDetails?.id === cd.id) setSelectedCdDetails(await musicService.getAlbumById(cd.id));
  };

  /** A side found for an album missing it: every list showing the album takes it. */
  const setCover = (albumId: Album['id'], side: 'front' | 'back', coverPath: string) => {
    const patch = side === 'front' ? { cover: coverPath } : { backCover: coverPath };
    const apply = (list: Album[]) => list.map(album => album.id === albumId ? { ...album, ...patch } : album);
    setAllCds(apply);
    setFilteredCds(apply);
    setExtraCds(apply);
    setSelectedCdDetails((prev: any) => prev?.id === albumId ? { ...prev, ...patch } : prev);
  };

  const setDismissed = (cd: Album, dismissed: boolean) => {
    const album = digitalOf(cd).album;
    if (album) digital.change(() => musicService.setDigitalDismissed(album.navidromeId, dismissed));
  };

  const handleSortChange = async (sortOption: string) => {
    // A sort chosen while letters are typed holds until they go.
    if (hasMatchScores(filteredCds)) bestMatch.choose(false);
    setSortBy(sortOption);
    writeStored('dexvault-musicdex-sort', sortOption);
    setSortLoading(true);

    // Add a small delay to show loading state for better UX
    await new Promise(resolve => setTimeout(resolve, 150));

    try {
      const sortedCds = sortCds(filteredCds, sortOption);
      setFilteredCds(sortedCds);
      setCdCount({ filtered: sortedCds.length, total: allCds.length });
    } finally {
      setSortLoading(false);
    }
  };

  const handleBestMatch = () => {
    bestMatch.choose(true);
    setFilteredCds(sortCds(filteredCds, sortBy));
  };

  const groupCds = useCallback((cdsToGroup: Album[], groupOption: string) => {
    if (groupOption === 'none') {
      return { 'All Albums': cdsToGroup };
    }

    const groups: Record<string, Album[]> = {};

    cdsToGroup.forEach((cd: Album) => {
      let groupKeys: string[] = [];

      switch (groupOption) {
        case 'artist':
          const artists = Array.isArray(cd.artist) ? cd.artist : [cd.artist];
          groupKeys = artists.map((a: string) => a || 'Unknown Artist');
          break;
        case 'genre':
          if (cd.genres && cd.genres.length > 0) {
            groupKeys = cd.genres;
          } else {
            groupKeys = ['Unknown Genre'];
          }
          break;
        case 'label':
          if (cd.labels && cd.labels.length > 0) {
            groupKeys = cd.labels;
          } else {
            groupKeys = ['Unknown Label'];
          }
          break;
        case 'decade':
          if (cd.releaseYear && !isNaN(cd.releaseYear)) {
            const decade = Math.floor(cd.releaseYear / 10) * 10;
            groupKeys = [`${decade}s`];
          } else {
            groupKeys = ['Unknown Decade'];
          }
          break;
        case 'country':
          groupKeys = [cd.country || 'Unknown Country'];
          break;
        case 'quality':
          groupKeys = [cd.recordingQuality || 'Not Rated'];
          break;
        default:
          groupKeys = ['All Albums'];
      }

      // Add album to each group it belongs to
      groupKeys.forEach((groupKey: string) => {
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(cd);
      });
    });

    // Sort groups alphabetically by key
    const sortedGroups: Record<string, Album[]> = {};
    Object.keys(groups).sort().forEach(key => {
      sortedGroups[key] = groups[key];
    });

    return sortedGroups;
  }, []);

  const handleGroupChange = async (groupOption: string) => {
    setGroupBy(groupOption);
    setGroupLoading(true);

    // Add a small delay to show loading state for better UX
    await new Promise(resolve => setTimeout(resolve, 150));

    // If grouping is enabled, expand all groups initially
    if (groupOption !== 'none') {
      const grouped = groupCds(shownCds, groupOption);
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

    const grouped = groupCds(shownCds, groupBy);
    const allGroupKeys = Object.keys(grouped);

    if (expandAllGroups) {
      setExpandedGroups(new Set());
      setExpandAllGroups(false);
    } else {
      setExpandedGroups(new Set(allGroupKeys));
      setExpandAllGroups(true);
    }
  };

  const handleEditCd = async (cd: Album) => {
    try {
      setLoadingDetails(true);
      const details = await musicService.getAlbumById(cd.id);
      setCdDetailsBeforeEdit(selectedCdDetails);
      setEditingCd(details);
      setSelectedCdDetails(null);
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to load album details for editing: ' + (err as Error).message, 'danger');
      }
      setCdDetailsBeforeEdit(selectedCdDetails);
      setEditingCd(cd);
      setSelectedCdDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };


  /**
   * Store the photographed sleeve as the album cover.
   *
   * A record no database knows has no artwork to download, so the user's own
   * photo is the only cover it will ever have. Failing is not fatal: the album
   * is already saved and a cover can be added later.
   */
  const attachSleevePhoto = async (album: any) => {
    if (!album?.id) return;

    if (pendingCover) {
      try {
        const file = base64ToFile(pendingCover.base64, pendingCover.mimeType, 'sleeve.jpg');
        await musicService.uploadCover(album.id, file);
      } catch (err) {
        console.warn('Could not store the sleeve photo as the cover:', err);
      }
    }

    // The back is worth keeping too: it is the side carrying the track list,
    // and the one to check a transcription against later.
    if (pendingBack) {
      try {
        const file = base64ToFile(pendingBack.base64, pendingBack.mimeType, 'sleeve-back.jpg');
        await musicService.uploadBackCover(album.id, file);
      } catch (err) {
        console.warn('Could not store the sleeve photo as the back cover:', err);
      }
    }

    setPendingCover(null);
    setPendingBack(null);
  };

  const handleReviewMetadata = async (release: any, allReleasesInGroup: any[] | null = null) => {
    try {
      if (!release) {
        // Manual entry - just show empty form
        setReviewingRelease({});
        return;
      }

      // Check if this is an album object (from the new workflow) or a release object (from the old workflow)
      if (release.id && !release.musicbrainzReleaseId) {
        // This is an album object from the new workflow - open detail view
        console.log('Opening detail view for album:', release.title);

        // Refresh the albums list to include the new album
        await loadCds();

        // Find the album in the updated list and show its details
        const updatedCds = await musicService.getAlbumsByStatus('owned') as Album[];
        const addedAlbum = updatedCds.find((cd: Album) => cd.id === release.id);

        if (addedAlbum) {
          setSelectedCdDetails(addedAlbum);
        }

        return;
      }

      // Old workflow - continue with existing logic
      // Extract all available cover art options from the group
      let availableCovers: any[] = [];
      if (allReleasesInGroup && allReleasesInGroup.length > 0) {
        availableCovers = allReleasesInGroup
          .filter((r: any) => r.coverArt?.front?.url || r.coverArt?.url) // Support both old and new format
          .map((r: any) => ({
            url: r.coverArt?.front?.url || r.coverArt?.url, // Use front cover or fallback to old format
            country: r.country,
            year: r.releaseYear,
            catalogNumber: r.catalogNumber
          }));

        // Remove duplicates based on URL
        availableCovers = Array.from(
          new Map(availableCovers.map((c: any) => [c.url, c])).values()
        );
      }

      // Fetch full details from MusicBrainz
      setLoadingDetails(true);
      const details = await musicService.getMusicBrainzReleaseDetails(release.musicbrainzReleaseId) as any;

      // Convert MusicBrainz data to album form data
      const cdData = {
        title: details.title || release.title,
        artist: details.artist || release.artist,
        releaseYear: details.releaseYear || release.releaseYear,
        labels: details.labels || release.labels || [],
        catalogNumber: details.catalogNumber || release.catalogNumber,
        barcode: details.barcode || release.barcode,
        country: details.country || release.country,
        format: details.format || release.format || 'CD',
        genres: details.genres || release.genres || [],
        tags: details.tags || release.tags || [],
        cover: details.coverArt?.front?.url || details.coverArt?.url || release.coverArt?.front?.url || release.coverArt?.url,
        musicbrainzReleaseId: details.musicbrainzReleaseId || release.musicbrainzReleaseId,
        musicbrainzReleaseGroupId: details.musicbrainzReleaseGroupId || release.musicbrainzReleaseGroupId,
        releaseGroupFirstReleaseDate: details.releaseGroupFirstReleaseDate || release.releaseGroupFirstReleaseDate,
        releaseGroupType: details.releaseGroupType || release.releaseGroupType,
        releaseGroupSecondaryTypes: details.releaseGroupSecondaryTypes || release.releaseGroupSecondaryTypes || [],
        urls: details.urls || release.urls,
        discs: details.discs || [],
        editionNotes: details.editionNotes || '',
        annotation: details.annotation || '',
        // Add available covers for the picker
        availableCovers: availableCovers.length > 1 ? availableCovers : null
      };

      setReviewingRelease(cdData);
    } catch (err) {
      console.error('Error in handleReviewMetadata:', err);
      if (onShowAlert) {
        onShowAlert('Failed to load release details: ' + (err as Error).message, 'danger');
      }
      // Still show form with basic data
      setReviewingRelease(release);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleFormCancel = () => {
    setShowAddForm(false);
    setEditingCd(null);
    setReviewingRelease(null);
    if (cdDetailsBeforeEdit) {
      setSelectedCdDetails(cdDetailsBeforeEdit);
      setCdDetailsBeforeEdit(null);
    }
  };

  const handleFormSave = async (createdAlbum: any = null) => {
    setShowAddForm(false);
    setEditingCd(null);
    setReviewingRelease(null);

    if (createdAlbum) {
      // Reload the album list first
      await loadCds();
      // Then fetch the complete album details (including tracks) and show the detail dialog
      try {
        const completeAlbumDetails = await musicService.getAlbumById(createdAlbum.id);
        setSelectedCdDetails(completeAlbumDetails);
      } catch (err) {
        console.error('Failed to load complete album details after creation:', err);
        // Fallback to showing the basic album data
        setSelectedCdDetails(createdAlbum);
      }
    } else {
      // For updates, reload first then show details
      await loadCds();
      if (cdDetailsBeforeEdit) {
        try {
          const updatedDetails = await musicService.getAlbumById(cdDetailsBeforeEdit.id);
          setSelectedCdDetails(updatedDetails);
          setCdDetailsBeforeEdit(null);
        } catch (err) {
          console.error('Failed to reload album details after save:', err);
          setSelectedCdDetails(cdDetailsBeforeEdit);
          setCdDetailsBeforeEdit(null);
        }
      }
    }
  };

  // The albums in the order the grid shows them, so their details step from one to the next.
  // An album opened from Listen Next steps through Listen Next instead.
  const [stepThrough, setStepThrough] = useState<'grid' | 'listenNext'>('grid');
  const gridIds = useMemo(() => {
    if (digitalOn && digitalFilter === 'buy') {
      const suggested = shownCds.filter(cd => isSuggested(digitalOf(cd).album));
      return [...suggested, ...shownCds.filter(cd => !suggested.includes(cd)), ...(showDismissed ? dismissedCds : [])].map(cd => cd.id);
    }
    if (groupBy === 'none') return shownCds.map(cd => cd.id);
    const grouped = groupCds(shownCds, groupBy);
    return Object.keys(grouped).sort()
      .filter(key => expandedGroups.has(key))
      .flatMap(key => sortCds(grouped[key], sortBy).map(cd => cd.id));
  }, [shownCds, groupBy, expandedGroups, groupCds, sortCds, sortBy, digitalOn, digitalFilter, digitalOf, showDismissed, dismissedCds]);
  const shownIds = useMemo(
    () => stepThrough === 'listenNext' ? [...new Set(listenNextAlbums.map(album => album.id))] : gridIds,
    [stepThrough, listenNextAlbums, gridIds]);
  const albumSteps = useDetailSteps(shownIds, selectedCdDetails?.id, id => musicService.getAlbumById(id), setSelectedCdDetails,
    { imagesOf: albumImages, summaryOf: id => findById(id, allCds, extraCds, listenNextAlbums) });

  const handleCdClick = async (cdId: number | string, from: 'grid' | 'listenNext' = 'grid') => {
    setStepThrough(from);
    try {
      setLoadingDetails(true);
      const details = await musicService.getAlbumById(cdId);
      // On a phone a ripped album's cover opens the full screen player on it, not its card; a card open (Also on…)
      // gives way to it. A CD with no rip, a mixtape, has its card: there is nothing to play, or it is played from there.
      if (phone && !isMixtape(details as { titleStatus?: string }) && (details as { fileQuality?: string }).fileQuality !== 'none') {
        setSelectedCdDetails(null);
        showAlbum(details as ShownAlbum);
        return;
      }
      setSelectedCdDetails(details);
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to load album details: ' + (err as Error).message, 'danger');
      }
    } finally {
      setLoadingDetails(false);
    }
  };

  // The search's menu opens a album it guessed from a few letters (services/openItem).
  useOpenItem('album', id => { handleCdClick(id); });

  /** The tooltip of an album's Listen Next button on its cover: what of it the list holds. */
  const listenNextTitleOf = (albumId: number): string | undefined => {
    const entry = listenNextAlbums.find(album => album.id === albumId);
    if (!entry) return undefined;
    // Said as listening: "Next, on CD: Disc 2 · click: off the list".
    return listenNextTitle(heldOf(listenNextAlbums, albumId), entry.discCount)
      .replace('In Listen Next', mediumOf(entry) === 'cd' ? 'Next, on CD' : 'Next, streamed')
      .replace('take it out', 'click: off the list');
  };
  /** The list of Listen Next an album is in, if any. */
  const listenNextMediumOf = (albumId: number): ListenNextMedium | null => {
    const entry = listenNextAlbums.find(album => album.id === albumId);
    return entry ? mediumOf(entry) : null;
  };

  /** ✕ on a card of the banner: that entry out, the album whole or the disc alone. */
  const handleListenNextToggle = async (e: React.MouseEvent, album: Album) => {
    e.stopPropagation(); // Prevent opening album details

    // Check if album is currently in Listen Next
    const isCurrentlyInListenNext = listenNextAlbums.some(a => keyOf(a) === keyOf(album));
    const isLastAlbum = isCurrentlyInListenNext && listenNextAlbums.length === 1;

    // Handle removal animation in background (non-blocking)
    if (isCurrentlyInListenNext) {
      const cardElement = (e.currentTarget as HTMLElement).closest('.listen-next-poster-card');
      if (cardElement) {
        cardElement.classList.add('removing');
      }

      // If this is the last album, also animate the banner closing
      if (isLastAlbum) {
        const bannerElement = document.querySelector('.listen-next-banner');
        if (bannerElement) {
          bannerElement.classList.add('closing');
        }
      }
    }

    // Then make the API call
    try {
      await musicService.toggleListenNext(album.id, album.disc || undefined);

      // Refresh Listen Next albums after successful toggle
      const updatedListenNextAlbums = await musicService.getListenNextAlbums() as Album[];
      setListenNextAlbums(updatedListenNextAlbums);

    } catch (error) {
      console.error('Error toggling listen next:', error);

      if (onShowAlert) {
        onShowAlert('Failed to update Listen Next status', 'danger');
      }
    }
  };


  const buyCard = (cd: Album, dismissedCard = false) => {
    const album = digitalOf(cd).album;
    return (
      <MusicThumbnail
        key={cd.id}
        cd={cd}
        onClick={() => handleCdClick(cd.id)}
        onListenNextChange={refreshListenNextAlbums}
        isInListenNext={listenNextAlbums.some(album => album.id === cd.id)}
        listenNextTitle={listenNextTitleOf(cd.id)}
        listenNextMedium={listenNextMediumOf(cd.id)}
        dataItemId={cd.id}
        digital={digitalOf(cd)}
        buy={{
          reason: album && isSuggested(album) ? buyReason(album) : null,
          wished: cd.titleStatus === 'wish',
          onWish: () => toggleWish(cd),
          // Only what listening suggested can be set aside; restored from the folded list.
          onDismiss: cd.titleStatus === 'wish' ? undefined : () => setDismissed(cd, !dismissedCard),
        }}
      />
    );
  };

  /** Buy in two: what listening suggests, then what is only wished; what was set aside folded at the foot. */
  const renderBuy = () => {
    const suggested = shownCds.filter(cd => isSuggested(digitalOf(cd).album));
    const wishedOnly = shownCds.filter(cd => !suggested.includes(cd));
    const wishedSuggested = suggested.filter(cd => cd.titleStatus === 'wish').length;
    return (
      <div className="digital-buy">
        <h3 className="digital-buy-title"><BsCartFill aria-hidden="true" /> Suggested from your listening <span className="digital-buy-note">{suggested.length}</span></h3>
        <p className="digital-buy-hint">
          Albums with no CD that you play: three of their tracks twice or more over the last 90 days, or rated 4–5 stars,
          or hearted. The most recently played first.
        </p>
        {suggested.length > 0 ? <div className="cd-grid">{suggested.map(cd => buyCard(cd))}</div>
          : <p className="digital-buy-empty">No suggestion yet: they come as you play albums you have no CD of.</p>}
        <h3 className="digital-buy-title">
          <BsBookmarkFill aria-hidden="true" /> Wishlist <span className="digital-buy-note">{wishedOnly.length}
            {wishedSuggested > 0 && ` · ${wishedSuggested} more in the suggestions above`}</span>
        </h3>
        {wishedOnly.length > 0 ? <div className="cd-grid">{wishedOnly.map(cd => buyCard(cd))}</div>
          : <p className="digital-buy-empty">Your wish list has no album from Navidrome.</p>}
        {dismissedCds.length > 0 && (
          <>
            <button type="button" className="digital-dismissed-toggle" aria-expanded={showDismissed} onClick={() => setShowDismissed(open => !open)}>
              {showDismissed ? <BsChevronDown aria-hidden="true" /> : <BsChevronRight aria-hidden="true" />}
              {dismissedCds.length} not interested
            </button>
            {showDismissed && <div className="cd-grid">{dismissedCds.map(cd => buyCard(cd, true))}</div>}
          </>
        )}
      </div>
    );
  };

  const renderCdGrid = () => {
    if (loading) {
      return (
        <Loading />
      );
    }

    if (digitalOn && digitalFilter === 'buy') return renderBuy();

    if (digitalOn && shownCds.length === 0 && allCds.length > 0) {
      return (
        <EmptyState icon="💿" title="Nothing here"
          description={searchCriteria?.searchText ? `No album of this filter matches "${searchCriteria.searchText}"` : 'No album in this filter.'} />
      );
    }

    // Empty State - Check if it's a search or truly empty database
    if (shownCds.length === 0) {
      return searchCriteria?.searchText && searchCriteria.searchText.trim() ? (
        /* Search returned no results */
        <EmptyState
          icon="💿"
          title="No Results Found"
          description={`No albums match "${searchCriteria.searchText}"`}
          hint="Try different keywords or clear your search"
          collectionInfo={`You have <strong>${allCds.length}</strong> ${allCds.length === 1 ? 'album' : 'albums'} in your collection`}
        />
      ) : (
        /* Database is empty */
        <EmptyState
          icon="💿"
          title="Welcome to MusicDex!"
          description="Your music collection is empty. Add your first album to get started and begin tracking your music library."
          action={
            <Button variant="primary" icon={<BsDisc />} className="mt-4"
              onClick={onOpenAddDialog}
            >
              Add Your First Album
            </Button>
          }
        />
      );
    }

    // Ungrouped view - add letter to all items for alphabetical index visibility detection
    if (groupBy === 'none') {
      return (
        <div className={`cd-grid ${sortLoading ? 'sort-loading' : ''}`}>
          <Progressive>{shownCds.map((cd) => {
            // Use artist name for letter tracking when sorting by artist
            const letter = letterOf(cd);

            return (
              <MusicThumbnail
                key={cd.id}
                cd={cd}
                onClick={() => handleCdClick(cd.id)}
                onListenNextChange={refreshListenNextAlbums}
                isInListenNext={listenNextAlbums.some(album => album.id === cd.id)}
                listenNextTitle={listenNextTitleOf(cd.id)}
        listenNextMedium={listenNextMediumOf(cd.id)}
                dataItemId={cd.id}
                dataFirstLetter={letter}
                digital={digitalOn ? digitalOf(cd) : undefined}
              />
            );
          })}</Progressive>
        </div>
      );
    }

    // Grouped view
    const grouped = groupCds(shownCds, groupBy);
    const sortedGroupKeys = Object.keys(grouped).sort();

    return (
      <div className={`cds-groups ${sortLoading || groupLoading ? 'sort-loading' : ''}`}>
        {sortedGroupKeys.map((groupKey) => {
          const groupCdsItems = grouped[groupKey];
          const isExpanded = expandedGroups.has(groupKey);
          const sortedGroupCds = sortCds(groupCdsItems, sortBy);

          return (
            <div key={groupKey} className="cd-group">
              <div
                className="group-header"
                onClick={() => toggleGroup(groupKey)}
              >
                <div className="group-title">
                  <BsChevronDown className={`group-chevron ${isExpanded ? 'expanded' : ''}`} />
                  <span>{groupKey}</span>
                  <span className="group-count">({groupCdsItems.length})</span>
                </div>
              </div>

              {isExpanded && (
                <div className="cd-grid">
                  {sortedGroupCds.map((cd) => {
                    const letter = letterOf(cd);

                    return (
                      <MusicThumbnail
                        key={cd.id}
                        cd={cd}
                        onClick={() => handleCdClick(cd.id)}
                        onListenNextChange={refreshListenNextAlbums}
                        isInListenNext={listenNextAlbums.some(album => album.id === cd.id)}
                        listenNextTitle={listenNextTitleOf(cd.id)}
        listenNextMedium={listenNextMediumOf(cd.id)}
                        dataFirstLetter={letter}
                        digital={digitalOn ? digitalOf(cd) : undefined}
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

  // MusicBrainz search is now handled via the Add Album dialog

  const sortOptions = [
    { value: 'title', label: 'Title A-Z', key: 'Title', direction: 'A-Z' },
    { value: 'titleReverse', label: 'Title Z-A', key: 'Title', direction: 'Z-A' },
    { value: 'artist', label: 'Artist A-Z', key: 'Artist', direction: 'A-Z' },
    { value: 'artistReverse', label: 'Artist Z-A', key: 'Artist', direction: 'Z-A' },
    { value: 'year', label: 'Year (Newest)', key: 'Year', direction: 'Newest' },
    { value: 'yearReverse', label: 'Year (Oldest)', key: 'Year', direction: 'Oldest' },
    { value: 'lastAdded', label: 'Last Added', key: 'Added', direction: 'Last' },
    { value: 'lastAddedReverse', label: 'First Added', key: 'Added', direction: 'First' }
  ];

  const groupOptions = [
    { value: 'none', label: 'No grouping' },
    { value: 'artist', label: 'Group by Artist' },
    { value: 'genre', label: 'Group by Genre' },
    { value: 'label', label: 'Group by Label' },
    { value: 'decade', label: 'Group by Decade' },
    { value: 'country', label: 'Group by Country' },
    { value: 'quality', label: 'Group by Quality' }
  ];

  // Helper function to get cover URL
  const getCoverUrl = (coverPath: string | null | undefined) => {
    if (!coverPath) return null;
    return musicService.getImageUrl(coverPath);
  };

  return (
    <div className="music-search" ref={scrollContainerRef}>
      {/* Alphabetical Index - shows when sorted alphabetically */}
      <AlphabeticalIndex
        items={shownCds}
        getTitle={(cd: Record<string, unknown>) => {
          if (sortBy === 'artist' || sortBy === 'artistReverse') {
            // The name the CD is filed under on the shelves.
            return artistSortName(cd as unknown as Album, albumOrder);
          }
          return String(cd.title || '');
        }}
        scrollContainer={scrollContainer}
        sortBy={sortBy}
        // Keep available during search/filter; disable only when grouping is enabled
        disabled={groupBy !== 'none' || (digitalOn && digitalFilter === 'buy')}
      />

      {/* Listen Next Banner - show when there are albums OR when we have albums in collection to suggest;
          its place held until its lists are read, then filled or slid away. */}
      <NextBannerSlot show={!searchCriteria?.searchText && (!listenNextRead || listenNextAlbums.length > 0 || allCds.length > 0)}>
      {listenNextRead ? (
        <NextBanner
          // Two lists: Digital, streamed, in gold; CD, the CDs to put on the player, in silver, with no ▶.
          items={listenNext.items.filter(album => mediumOf(album) === nextMedium)}
          type="music"
          title="Listen Next"
          className={`listen-next-lists${nextMedium === 'cd' ? ' next-banner--silver' : ''}`}
          alwaysShow
          icon={<MediumIcon medium={nextMedium} className="next-banner__icon" />}
          headerControls={(
            // What one looks at on the left (the list, its length), what one does on the right (▶, Repeat): nothing to play on CD.
            <span className="listen-next-head">
              <ListenNextSwitch medium={nextMedium} counts={nextCounts} onChange={chooseNextMedium} />
              {/* Its place held while the lengths are read: the header does not grow once they come. */}
              <span className="listen-next-head__summary">
                <ListenNextSummary albums={listenNext.items.filter(album => mediumOf(album) === nextMedium && !listenNext.leavingState(keyOf(album)))} play={listenNext.play} />
              </span>
              <span className="listen-next-head__end">
                {nextMedium === 'digital' && (
                  <ListenNextControls count={nextCounts.digital} play={listenNext.play} onRepeat={listenNext.setRepeat}
                    albums={listenNext.items.filter(album => mediumOf(album) === 'digital' && !listenNext.leavingState(keyOf(album)))} />
                )}
              </span>
            </span>
          )}
          other={{
            items: listenNextAlbums.filter(album => mediumOf(album) !== nextMedium),
            dropId: otherMedium(nextMedium),
            // Its small covers tinted in its colour: gold the streamed list, silver the CDs.
            className: `next-banner-other--${otherMedium(nextMedium)}`,
            head: <OtherListName medium={otherMedium(nextMedium)} count={nextCounts[otherMedium(nextMedium)]} onOpen={() => chooseNextMedium(otherMedium(nextMedium))} />,
            dropHint: `Drop here: ${INSTEAD[otherMedium(nextMedium)].toLowerCase()}`,
            onShow: showNext,
            onOpen: () => chooseNextMedium(otherMedium(nextMedium)),
            onReorder: handleListenNextReorder,
            titleOf: album => `${Array.isArray(album.artist) ? album.artist.join(', ') : album.artist || ''} – ${album.title || ''}${album.disc ? ` · disc ${album.disc}` : ''}`,
          }}
          onDropOn={dropNext}
          renderCornerButton={(album) => {
            const to = otherMedium(nextMedium);
            if (listenNext.departureOf(keyOf(album)) || (to === 'cd' && !canBeCd(album as Album))) return null;
            return <MoveButton title={album.title || ''} to={to} onMove={() => moveNext(keyOf(album), to, 'start')} />;
          }}
          // Two discs of an album are two cards: each its own key ("12:1", "12:2").
          getKey={(album) => keyOf(album)}
          getCardClassName={(album) => {
            const leaving = listenNext.leavingState(keyOf(album));
            if (leaving) return `next-banner__card--leaving${leaving.collapsing ? ' next-banner__card--collapsing' : ''}`;
            if (foundNext === keyOf(album)) return 'next-banner__card--found';
            return listenNext.departureOf(keyOf(album)) ? 'next-banner__card--departed' : '';
          }}
          renderOverlay={(album) => {
            const leaving = listenNext.leavingState(keyOf(album));
            return leaving && (
              <LeavingOverlay title={album.title || ''} startedAt={leaving.startedAt} onKeep={() => listenNext.keep(leaving.departureId)} />
            );
          }}
          onItemClick={(id) => handleCdClick(id, 'listenNext')}
          onRemove={(e, item) => {
            // Gone from the list already, played to its end: only off the banner.
            const departure = listenNext.departureOf(keyOf(item));
            if (departure) listenNext.dismiss(departure.id);
            else {
              handleListenNextToggle(e, item as Album);
              // A CD heard, of no stars: its stars asked a moment; Undo puts it back on the CD list.
              if (mediumOf(item) === 'cd' && !item.userRating) {
                askStars(item as Album, () => {
                  musicService.toggleListenNext(item.id, item.disc || undefined, 'cd')
                    .then(() => refreshListenNextAlbums())
                    .catch(() => toast('Listen Next was not changed', { tone: 'danger' }));
                });
              }
            }
          }}
          getImageUrl={(album) => getCoverUrl(album.cover) || ''}
          getTitle={(album) => album.title || ''}
          getSubtitle={(album) => Array.isArray(album.artist) ? album.artist.join(', ') : album.artist}
          // Only the streamed list draws, from any album: a CD or digital alone.
          onSmartFill={nextMedium === 'digital' ? handleSmartFill : undefined}
          smartFillFoot={drawFrom}
          smartFillLoading={smartFillLoading}
          // One disc of an album: its number. With Digital on, what sets each album apart: a disc struck through is left out of the Navidrome playlist.
          renderBadges={(album) => {
            const disc = album.disc ? <CoverTag key="disc" variant="plain" title={`Disc ${album.disc} of ${album.title}`}>Disc {album.disc}</CoverTag> : null;
            if (digitalOn) return <DigitalMarks digital={digitalOf(album as Album)} titleStatus={album.titleStatus} lead={disc} />;
            return disc && <CoverTagStack direction="row" className="digital-marks">{disc}</CoverTagStack>;
          }}
          onShuffle={nextMedium === 'digital' ? (item) => handleShuffleAlbum(item as Album) : undefined}
          // The die only on a disc a draw put there: one put by hand was chosen.
          canShuffle={(album) => Boolean(album.suggested)}
          shuffleTitle={`Another album, drawn from ${DRAWN_FROM[nextClassical]}`}
          shufflingItemId={shufflingAlbumId}
          // An album leaving the list, played to its end, keeps its place: only those in it move.
          onReorder={handleListenNextReorder}
          canReorder={(album) => !listenNext.departureOf(keyOf(album))}
          renderPlay={nextMedium === 'cd' ? undefined : (album) => (
            // ▶ plays Listen Next in DexVault from this album, on an iPhone too; one with no rip opens its card instead.
            <AlbumPlayButton albumId={album.id} title={album.title || ''} offerPlay
              onPlay={() => listenNextQueue.start(keyOf(album))}
              onUnripped={() => handleCdClick(album.id, 'listenNext')} className="next-banner__play" />
          )}
          renderFootRight={(album) => {
            // A mixtape plays shuffled from Listen Next, in an order drawn once, the same in Amperfy.
            if (!isMixtape(album as Album)) return null;
            const shuffled = listenNext.play?.shuffled?.includes(album.id) ?? false;
            return (
              <CoverButton className="next-banner__shuffled" active={shuffled} reveal={shuffled ? 'always' : 'hover'} aria-pressed={shuffled}
                label={shuffled ? `Play ${album.title} in its order` : `Shuffle ${album.title}`}
                title={shuffled ? 'Shuffled: plays in an order drawn once, from its next start' : 'Shuffle: play it in an order drawn at random'}
                onClick={(event) => {
                  event.stopPropagation();
                  listenNext.setShuffled(album.id, !shuffled).catch(() => onShowAlert?.('Shuffle was not changed', 'danger'));
                }}>
                <BsShuffle />
              </CoverButton>
            );
          }}
        />
      ) : (
        // Its header and its strip as the banner will have them, as high, its lengths not read yet.
        <NextBannerPending type="music" title="Listen Next"
          className={`listen-next-lists${nextMedium === 'cd' ? ' next-banner--silver' : ''}`}
          icon={<MediumIcon medium={nextMedium} className="next-banner__icon" />}
          headerControls={(
            <span className="listen-next-head">
              <ListenNextSwitch medium={nextMedium} onChange={chooseNextMedium} />
              <span className="listen-next-head__summary" />
              <span className="listen-next-head__end" />
            </span>
          )}
          smartFill={nextMedium === 'digital'}
          smartFillFoot={drawFrom}
          footer={(
            <div className={`next-banner-other next-banner-other--${otherMedium(nextMedium)}`}>
              <div className="next-banner-other__drop">
                <span className="next-banner-other__pending" />
              </div>
            </div>
          )} />
      )}
      </NextBannerSlot>

      {/* Results Header with Controls */}
      <div className="cds-results">
        <CollectionHeader
          // On a phone the Buy list says how many there are to buy, and has no sort or grouping of its own to offer.
          filteredCount={buyOnPhone ? filterCounts.buy : digitalOn || mixtapesOn ? shownCds.length : cdCount.filtered}
          totalCount={buyOnPhone ? filterCounts.buy : (digitalOn ? filterCounts.all : cdCount.total) + (mixtapesOn && !(digitalOn && digitalFilter === 'buy') ? mixtapes.length : 0)}
          itemLabel={buyOnPhone ? 'to buy' : 'albums'}
          sortBy={sortBy}
          sortOptions={buyOnPhone ? [] : sortOptions}
          onSortChange={handleSortChange}
          bestMatch={bestMatch.on && hasMatchScores(filteredCds)}
          onBestMatch={hasMatchScores(filteredCds) ? handleBestMatch : undefined}
          sortLoading={sortLoading}
          groupBy={groupBy}
          groupOptions={buyOnPhone ? [] : groupOptions}
          onGroupChange={handleGroupChange}
          groupLoading={groupLoading}
          expandAllGroups={expandAllGroups}
          onToggleAllGroups={toggleAllGroups}
          showStackToggle={false}
          addButtonLabel="Add Album"
          onAdd={() => setShowAddDialog(true)}
          loading={loading}
          // The same switches as Stack in BookDex and FilmDex: gold when on.
          toggles={[
            {
              label: 'Digital', checked: digitalOn, onChange: toggleDigital,
              title: digitalOn ? 'Hide the albums with no CD and what sets each album apart' : 'Show the albums with no CD, how good the files are, and what to buy',
            },
            {
              label: 'Mixtapes', checked: mixtapesOn, onChange: toggleMixtapes,
              title: mixtapesOn ? 'Hide the mixtapes' : 'Show your mixtapes, your playlists in Navidrome, among the albums',
            },
          ]}
          extraControls={digitalOn && <DigitalChips filter={digitalFilter} onFilter={chooseFilter} counts={filterCounts} />}
        />

        {digitalOn && <DigitalNotices library={digital.library} error={digital.error} editions={digital.editions} />}

        {/* Album Grid or Grouped Albums */}
        {renderCdGrid()}
      </div>

      {/* Forms and Modals */}
      <AddMusicDialog
        show={showAddDialog}
        onHide={() => setShowAddDialog(false)}
        onAddCd={onAddCd}
        onAddCdFromMusicBrainz={onAddCdFromMusicBrainz}
        onAddCdByBarcode={onAddCdByBarcode}
        onReviewMetadata={handleReviewMetadata}
        onDraftEntry={(result: any) => {
          setPendingCover(result.coverPhoto || null);
          setPendingBack(result.backPhoto || null);
          setReviewingRelease(result.draft);
        }}
        defaultTitleStatus={undefined}
        onAddStart={() => {
          // Close dialog instantly and show overlay
          setShowAddDialog(false);
          setAddingAlbum(true);
          setAddError('');
        }}
        onAlbumAdded={async () => {
          try {
            await loadCds();
          } finally {
            setAddingAlbum(false);
            setAddError('');
          }
        }}
        onAddError={(err: any) => {
          setAddingAlbum(false);
          setAddError(err?.message || 'Failed to add album');
          if (onShowAlert) onShowAlert('Failed to add album: ' + (err?.message || ''), 'danger');
        }}
      />

      {showAddForm && (
        <MusicForm
          onSave={async (cdData: any) => {
            const createdAlbum = await onAddCd(cdData);
            await handleFormSave(createdAlbum);
            return createdAlbum;
          }}
          onCancel={handleFormCancel}
        />
      )}

      {reviewingRelease && (
        <MusicForm
          cd={reviewingRelease}
          pendingPhotos={{ front: pendingCover, back: pendingBack }}
          onSave={async (cdData: any) => {
            let createdAlbum;
            // If this came from MusicBrainz search, use the proper method to download covers
            if (cdData.musicbrainzReleaseId) {
              createdAlbum = await onAddCdFromMusicBrainz(cdData.musicbrainzReleaseId, cdData);
            } else {
              createdAlbum = await onAddCd(cdData);
            }
            // Before handleFormSave, which unmounts the form and refetches the
            // album: otherwise the grid paints a coverless record.
            await attachSleevePhoto(createdAlbum);
            await handleFormSave(createdAlbum);
          }}
          onCancel={handleFormCancel}
        />
      )}

      {editingCd && (
        <MusicForm
          cd={editingCd}
          onSave={async (cdData: any) => {
            onUpdateCd(editingCd.id, cdData);
            await handleFormSave();
          }}
          onCancel={handleFormCancel}
        />
      )}

      {selectedCdDetails && !isMixtape(selectedCdDetails) && (
        <MusicDetailCard
          cd={selectedCdDetails}
          onClose={() => setSelectedCdDetails(null)}
          onEdit={() => handleEditCd(selectedCdDetails)}
          onDelete={async () => {
            try {
              await onDeleteCd(selectedCdDetails.id);
              setSelectedCdDetails(null);
              await loadCds();
            } catch (e) {
              if (onShowAlert) onShowAlert('Failed to delete album: ' + ((e as any)?.message || ''), 'danger');
            }
          }}
          onSearch={updateSearchViaUrl}
          onListenNextChange={refreshListenNextAlbums}
          onPrevious={albumSteps.onPrevious}
          onNext={albumSteps.onNext}
          digital={digitalOn ? digitalOf(selectedCdDetails) : undefined}
          onWish={digitalOn ? () => toggleWish(selectedCdDetails) : null}
          onDismiss={digitalOn ? (dismissed: boolean) => setDismissed(selectedCdDetails, dismissed) : null}
          onBought={() => setBuying(selectedCdDetails)}
          onCoverChange={(side, coverPath) => setCover(selectedCdDetails.id, side, coverPath)}
          onOpenAlbum={albumId => handleCdClick(albumId)}
        />
      )}


      {openMixtape != null && (
        <MixtapeDialog albumId={openMixtape} onClose={() => setOpenMixtape(null)}
          onOpenAlbum={albumId => handleCdClick(albumId)}
          onChange={() => { refreshListenNextAlbums(); reloadMixtapes(); }} />
      )}

      {buying && (
        <BoughtCdDialog
          album={buying}
          onClose={() => setBuying(null)}
          onBought={async (album: any) => {
            setBuying(null);
            if (onShowAlert) onShowAlert(`"${album.title}" is now a CD of your collection`, 'success');
            await Promise.all([loadCds(), loadExtraCds()]);
            if (digitalOn) digital.reload();
            setSelectedCdDetails(await musicService.getAlbumById(album.id));
          }}
        />
      )}

      {addingAlbum && (
        <div className="loading-overlay">
          <Spinner size="lg" />
          <div className="loading-message">
            Adding album to your collection...
          </div>
        </div>
      )}

      {addError && (
        <Notice tone="danger" className="mb-3">{addError}</Notice>
      )}

    </div>
  );
});

export default MusicSearch;
