
import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import CoverButton from './shared/CoverButton';
import { BsStar, BsStarFill, BsX } from 'react-icons/bs';
import apiService from '../services/api';
import MovieDetailCard from './MovieDetailCard';
import MovieSheet from './MovieSheet';
import BoxSetStack from './BoxSetStack';
import AlphabeticalIndex from './AlphabeticalIndex';
import { NextBanner, NextBannerPending, NextBannerSlot, CollectionHeader, EmptyState } from './shared';
import { hasMatchScores, stacksMatchFirst, useBestMatch } from './shared/search/bestMatch';
import { useOpenItem } from '../services/openItem';
import MovieCover, { combinedScore } from './MovieCover';
import {
  BsChevronDown,
  BsFilm
} from 'react-icons/bs';
import './FilmDexPage.css';
import { sortOptions } from './filmDexSort';
import { readStored, writeStored } from '../utils/safeStorage';
import { findById, shownIds, useDetailSteps, type Id } from '../utils/detailSteps';
import { movieImages } from '../utils/detailImages';
import { isKept, useKeptState } from '../utils/kept';
import { useMedia } from '../utils/useNarrow';
import Button, { IconButton } from './shared/Button';
import Progressive from './shared/Progressive';

export interface FilmDexPageRef {
  refreshMovies: () => void;
}

interface FilmDexPageProps {
  refreshTrigger?: number;
  searchCriteria?: { searchText?: string; [key: string]: any };
  loading: boolean;
  setLoading: (loading: boolean) => void;
  onShowAlert?: (message: string, type: string) => void;
  onAddMovie?: (mode?: string) => void;
  onSearch?: (criteria: any) => void;
}

interface GroupOption {
  value: string;
  label: string;
}

const FilmDexPage = forwardRef<FilmDexPageRef, FilmDexPageProps>(({ refreshTrigger, searchCriteria, loading, setLoading, onShowAlert, onAddMovie, onSearch }, ref) => {
  // Kept for the session: coming back to FilmDex draws its posters at once, then reads again.
  const [movies, setMovies] = useKeptState<any[]>('filmdex:movies', []);
  const [allMovies, setAllMovies] = useKeptState<any[]>('filmdex:allMovies', []); // Store all movies from backend
  const allMoviesRef = useRef<any[]>([]);
  allMoviesRef.current = allMovies;
  const [filteredMovies, setFilteredMovies] = useKeptState<any[]>('filmdex:filteredMovies', []); // Store filtered movies
  // Load sort preference from localStorage, default to 'title'
  const [sortBy, setSortBy] = useState(() => {
    const savedSort = readStored('dexvault-filmdex-sort');
    return savedSort || 'title';
  });
  const [sortLoading, setSortLoading] = useState(false); // Sort loading state
  const [groupBy, setGroupBy] = useState('none'); // Current group option
  const [groupLoading, setGroupLoading] = useState(false); // Group loading state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); // Track expanded groups
  const [expandAllGroups, setExpandAllGroups] = useState(false); // Expand/collapse all state
  const previousSearchTextRef = useRef(''); // Track previous search text to avoid infinite loops
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedMovieDetails, setSelectedMovieDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  // On a phone a movie opens full screen at once, on the grid's movie, its details filling in as they are read.
  const phone = useMedia('(max-width: 767px)');
  const [openedId, setOpenedId] = useState<number | null>(null);

  // Load box set stacking preference from localStorage, default to true
  const [stackEnabled, setStackEnabled] = useState(() => {
    const savedStackPref = readStored('dexvault-filmdex-stack');
    return savedStackPref === null ? true : savedStackPref === 'true';
  });

  // Track expanded box set
  const [expandedBoxSet, setExpandedBoxSet] = useState<string | null>(null);

  // Ref for scroll container (for alphabetical index)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The page scrolls as a whole: the alphabetical index follows the document, known from the first render
  // (found in an effect, it drew the whole grid a second time as the section opened).
  const scrollContainer: HTMLElement = document.documentElement;


  // Keep letter logic consistent with AlphabeticalIndex (handles FR/EN leading articles)
  const removeArticlesForIndex = useCallback((text: string) => {
    if (!text) return '';
    const trimmed = String(text).trim();
    // French: Le, La, Les, Un, Une, Des, Du, De
    // English: The, A, An
    const articlePattern = /^(le|la|les|un|une|des|du|de|the|a|an)\s+/i;
    return trimmed.replace(articlePattern, '').trim() || trimmed;
  }, []);

  const getFirstLetterForIndex = useCallback((title: string) => {
    const t = removeArticlesForIndex(title);
    const firstChar = t?.charAt(0)?.toUpperCase() || '';
    return /[A-Z]/.test(firstChar) ? firstChar : '#';
  }, [removeArticlesForIndex]);

  const getCombinedScore = combinedScore;

  // While letters are typed the best match comes first, this sort between equals (useBestMatch).
  const bestMatch = useBestMatch(searchCriteria?.searchText || '');

  const sortMoviesBy = useCallback((moviesToSort: any[], sortOption: string) => {
    const sorted = [...moviesToSort];

    switch (sortOption) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'titleReverse':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'lastAddedFirst':
        return sorted.sort((a, b) => new Date(b.acquired_date || b.created_at || b.updated_at).getTime() - new Date(a.acquired_date || a.created_at || a.updated_at).getTime());
      case 'lastAddedLast':
        return sorted.sort((a, b) => new Date(a.acquired_date || a.created_at || a.updated_at).getTime() - new Date(b.acquired_date || b.created_at || b.updated_at).getTime());
      case 'rating':
        return sorted.sort((a, b) => {
          const ratingA = getCombinedScore(a) || 0;
          const ratingB = getCombinedScore(b) || 0;
          return ratingB - ratingA; // Higher ratings first
        });
      case 'ratingLowest':
        return sorted.sort((a, b) => {
          const ratingA = getCombinedScore(a) || 0;
          const ratingB = getCombinedScore(b) || 0;
          return ratingA - ratingB; // Lower ratings first
        });
      case 'ageAsc':
        return sorted.sort((a, b) => {
          const ageA = a.recommended_age ?? 999; // Treat null/undefined as highest (oldest)
          const ageB = b.recommended_age ?? 999;
          return ageA - ageB; // Youngest first
        });
      case 'ageDesc':
        return sorted.sort((a, b) => {
          const ageA = a.recommended_age ?? -1; // Treat null/undefined as lowest (youngest)
          const ageB = b.recommended_age ?? -1;
          return ageB - ageA; // Oldest first
        });
      default:
        return sorted;
    }
  }, []);
  const sortMovies = useCallback((items: any[], sortOption: string) =>
    bestMatch.order(sortMoviesBy(items, sortOption)), [sortMoviesBy, bestMatch.order]);

  // `quiet`: the movies already on screen stay until the answer, without "Loading".
  const loadAllMovies = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const data = await apiService.getAllMovies() as any[];

      setAllMovies(data);
      // A search shown stays: the search's own answer comes after.
      if (quiet && searchCriteria?.searchText?.trim()) return;
      setFilteredMovies(data);
      // Apply current sort to all movies
      const sorted = sortMovies(data, sortBy);
      setMovies(sorted);

      // If we have a selected movie, refresh its details to get updated collection data
      if (selectedMovieDetails?.id) {
        try {
          const updatedDetails = await apiService.getMovieDetails(selectedMovieDetails.id);
          setSelectedMovieDetails(updatedDetails);
        } catch (error) {
          // Failed to refresh selected movie details
        }
      }
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to load movies: ' + (err as Error).message, 'danger');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, selectedMovieDetails?.id, searchCriteria?.searchText]);

  // Refresh only Watch Next movies
  const refreshWatchNextMovies = useCallback(async () => {
    try {
      const watchNextMoviesData = await apiService.getWatchNextMovies() as any[];
      setWatchNextMovies(watchNextMoviesData);
    } catch (error) {
      // Failed to refresh Watch Next movies
    }
  }, []);

  // Refresh movie data while preserving current search/filter state
  const refreshMovieData = useCallback(async (skipSelectedMovieRefresh = false) => {
    try {
      const data = await apiService.getAllMovies() as any[];
      setAllMovies(data);

      // Reapply search if there's a search term
      if (searchCriteria?.searchText) {
        handleSearch(searchCriteria);
      } else {
        // No search, just apply current sort
        const sorted = sortMovies(data, sortBy);
        setMovies(sorted);
        setFilteredMovies(data);
      }

      // If we have a selected movie, refresh its details to get updated collection data
      // Skip this if called from detail card to avoid closing/reopening dialog
      if (selectedMovieDetails?.id && !skipSelectedMovieRefresh) {
        try {
          const updatedDetails = await apiService.getMovieDetails(selectedMovieDetails.id);
          setSelectedMovieDetails(updatedDetails);
        } catch (error) {
          console.warn('Failed to refresh selected movie details:', error);
        }
      }
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to refresh movies: ' + (err as Error).message, 'danger');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria, sortBy, selectedMovieDetails?.id]);

  // Refresh all movie data including box set status (used by detail view)
  const refreshAllMovieData = useCallback(async (skipSelectedMovieRefresh = false) => {
    try {
      await refreshWatchNextMovies();
      await refreshMovieData(skipSelectedMovieRefresh);
    } catch (error) {
      console.error('Failed to refresh movie data:', error);
    }
  }, [refreshWatchNextMovies, refreshMovieData]);

  // Wrapper for detail card that skips selected movie refresh to avoid dialog closing/reopening
  const refreshForDetailCard = useCallback(async () => {
    await refreshAllMovieData(true);
  }, [refreshAllMovieData]);

  // While letters are typed (`typing`), the grid stays as it is until the answer, and the
  // collection already loaded serves: no "Loading", no posters drawn again at each letter.
  const handleSearch = useCallback(async (criteria: any, { typing = false }: { typing?: boolean } = {}) => {
    try {
      if (!typing) setLoading(true);

      // If no search text, load all movies, otherwise search
      if (criteria.searchText && criteria.searchText.trim()) {
        // When searching, we need both: all movies for count AND search results for display
        const known = typing ? allMoviesRef.current : [];
        const [allData, searchData] = await Promise.all([
          known.length ? known : apiService.getAllMovies() as Promise<any[]>,
          apiService.searchMovies({ searchText: criteria.searchText }) as Promise<any[]>
        ]);
        // An answer to letters since changed comes too late: the newer search shows.
        if (typing && criteria.searchText !== previousSearchTextRef.current) return;

        setAllMovies(allData); // Keep full collection for count
        setFilteredMovies(searchData);
        const sorted = sortMovies(searchData, sortBy);
        setMovies(sorted);
      } else {
        // No search - load all movies
        const data = await apiService.getAllMovies() as any[];
        setAllMovies(data);
        setFilteredMovies(data);
        const sorted = sortMovies(data, sortBy);
        setMovies(sorted);
      }
    } catch (err) {
      if (onShowAlert) {
        onShowAlert('Failed to search movies: ' + (err as Error).message, 'danger');
      }
    } finally {
      if (!typing) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    refreshMovies: () => {
      // When refreshing, respect current search criteria
      if (searchCriteria?.searchText && searchCriteria.searchText.trim()) {
        handleSearch(searchCriteria);
      } else {
        loadAllMovies();
      }
    },
  }));

  // Initial load on mount
  useEffect(() => {
    loadAllMovies({ quiet: isKept('filmdex:allMovies') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Load movies based on search criteria with debouncing
  useEffect(() => {
    const currentSearchText = searchCriteria?.searchText || '';

    // Only run if search text has actually changed
    if (currentSearchText !== previousSearchTextRef.current) {
      const previous = previousSearchTextRef.current;
      previousSearchTextRef.current = currentSearchText;
      let fired = false;

      // Debounce search by 200ms
      const timeoutId = setTimeout(() => {
        fired = true;
        // Only run search if searchText has a value, otherwise load all
        if (currentSearchText.trim()) {
          handleSearch(searchCriteria, { typing: true });
        } else if (allMoviesRef.current.length) {
          // The letters gone: the whole collection again, as loaded, without drawing the grid anew.
          setFilteredMovies(allMoviesRef.current);
          setMovies(sortMovies(allMoviesRef.current, sortBy));
        } else {
          loadAllMovies();
        }
      }, 200);

      // A search called off before it ran is still to run (React's StrictMode mounts twice).
      return () => {
        clearTimeout(timeoutId);
        if (!fired) previousSearchTextRef.current = previous;
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCriteria?.searchText]); // Only re-run when the actual search text changes

  useEffect(() => {
    if (refreshTrigger) {
      refreshMovieData();
    }
  }, [refreshTrigger, refreshMovieData]);

  // Handle ESC key press for modals
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showExportModal) {
          setShowExportModal(false);
        } else if (selectedMovieDetails) {
          setSelectedMovieDetails(null);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExportModal, selectedMovieDetails]);


  // Edit is now handled directly in the detail card - no separate form needed




  // An open movie's details step through the movies in the order the grid
  // shows them, or through the Watch Next banner or the box set it was opened from.
  const resultsRef = useRef<HTMLDivElement>(null);
  const [stepIds, setStepIds] = useState<Id[] | null>(null);
  const movieSteps = useDetailSteps(
    selectedMovieDetails ? stepIds ?? shownIds(resultsRef.current) : [],
    selectedMovieDetails?.id,
    id => apiService.getMovieDetails(id),
    setSelectedMovieDetails,
    { imagesOf: movieImages, summaryOf: id => findById(id, allMovies, watchNextMovies) });

  const handleMovieClick = async (movieId: number, siblings?: Id[]) => {
    setStepIds(siblings ?? null);
    setOpenedId(movieId);
    try {
      setLoadingDetails(true);
      console.log('Loading movie details for ID:', movieId);
      const details = await apiService.getMovieDetails(movieId);
      console.log('Movie details loaded:', details);
      setSelectedMovieDetails(details);
    } catch (err) {
      console.error('Error loading movie details:', err);
      if (onShowAlert) {
        onShowAlert('Failed to load movie details: ' + (err as Error).message, 'danger');
      }
      // Reset loading state on error
      setLoadingDetails(false);
      setSelectedMovieDetails(null);
      setOpenedId(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  // The search's menu opens a movie it guessed from a few letters (services/openItem).
  useOpenItem('movie', id => { handleMovieClick(id); });


  // Large poster view renderer
  const renderMovieCardLarge = (movie: any, includeLetter = false, letter: string | null = null) => {
    const inWatchNext = watchNextMovies.some((wm: any) => wm.id === movie.id);
    return (
      <div
        key={movie.id}
        className="movie-card-large cover-host"
        onClick={() => handleMovieClick(movie.id)}
        data-item-id={movie.id}
        {...(includeLetter && letter ? { 'data-first-letter': letter } : {})}
      >
        <MovieCover movie={movie}>
          <CoverButton
            className="watch-next-badge-large"
            active={inWatchNext}
            onClick={(e) => handleWatchNextToggle(e, movie)}
            label={inWatchNext ? 'Remove from Watch Next' : 'Add to Watch Next'}
          >
            {inWatchNext ? <BsStarFill aria-hidden="true" /> : <BsStar aria-hidden="true" />}
          </CoverButton>
        </MovieCover>
      </div>
    );
  };

  const handleCloseDetails = () => {
    setSelectedMovieDetails(null);
  };

  const handleDeleteMovie = async (movieId: number) => {
    try {
      await apiService.deleteMovie(movieId);
      // Close the detail view since the movie no longer exists
      setSelectedMovieDetails(null);

      // Update local state by removing the deleted movie
      const updatedMovies = allMovies.filter(movie => movie.id !== movieId);
      setAllMovies(updatedMovies);

      // Apply current sort to updated data
      const sorted = sortMovies(updatedMovies, sortBy);
      setMovies(sorted);
      setFilteredMovies(updatedMovies);

      if (onShowAlert) {
        onShowAlert('Movie deleted successfully', 'success');
      }
    } catch (error) {
      if (onShowAlert) {
        onShowAlert('Failed to delete movie: ' + (error as Error).message, 'danger');
      }
    }
  };

  const handleWatchNextToggle = async (e: React.MouseEvent, movie: any) => {
    e.stopPropagation(); // Prevent opening movie details

    // Check if movie is currently in Watch Next
    const isCurrentlyInWatchNext = watchNextMovies.some((m: any) => m.id === movie.id);
    const newWatchNextValue = !isCurrentlyInWatchNext;
    const isAdding = newWatchNextValue; // true if adding to watch next

    // Check if this is the last movie in watch next
    const isLastMovie = isCurrentlyInWatchNext && watchNextMovies.length === 1;

    // Handle removal animation in background (non-blocking)
    if (!isAdding && isCurrentlyInWatchNext) {
      const cardElement = (e.currentTarget as HTMLElement).closest('.watch-next-poster-card');
      if (cardElement) {
        cardElement.classList.add('removing');
      }

      // If this is the last movie, also animate the banner closing
      if (isLastMovie) {
        const bannerElement = document.querySelector('.watch-next-banner');
        if (bannerElement) {
          bannerElement.classList.add('closing');
        }
      }
    }

    // Then make the API call
    try {
      await apiService.toggleWatchNext(movie.id);

      // Refresh Watch Next movies after successful toggle
      const updatedWatchNextMovies = await apiService.getWatchNextMovies() as any[];
      setWatchNextMovies(updatedWatchNextMovies);

      // If removing from Watch Next, show the "Did you watch?" prompt
      if (isCurrentlyInWatchNext) {
        setPromptMovie(movie);
        setShowWatchedPrompt(true);
        // Auto-hide after 8 seconds
        setTimeout(() => setShowWatchedPrompt(false), 8000);
      }

    } catch (error) {
      console.error('Error toggling watch next:', error);

      if (onShowAlert) {
        onShowAlert('Failed to update Watch Next status', 'danger');
      }
    }
  };

  // Watch Next dragged into a new order: shown at once, then as the server has it; a movie's card reads the same order.
  const handleWatchNextReorder = async (ids: number[]) => {
    setWatchNextMovies(previous => [...previous].sort((a: any, b: any) => ids.indexOf(a.id) - ids.indexOf(b.id)));
    try {
      const result = await apiService.reorderWatchNext(ids);
      setWatchNextMovies(result.movies as any[]);
    } catch (error) {
      console.error('Error reordering Watch Next:', error);
      refreshWatchNextMovies();
      if (onShowAlert) onShowAlert('Failed to reorder Watch Next', 'danger');
    }
  };

  // Handle marking movie as watched from prompt
  const handlePromptMarkWatched = async (daysAgo: number = 0) => {
    if (!promptMovie) return;

    try {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split('T')[0];

      const result = await apiService.markMovieAsWatched(promptMovie.id, dateStr) as { watch_count: number };
      const title = promptMovie.title;
      const count = result.watch_count;

      // Fun messages based on watch count
      const messages = count === 1
        ? [
            `🎬 "${title}" — First time! Hope you enjoyed it!`,
            `🍿 "${title}" checked off! What did you think?`,
            `✨ "${title}" — Another one for the memory bank!`,
          ]
        : [
            `🎬 "${title}" — ${count}× now! A new favorite?`,
            `🍿 "${title}" again! (${count}×) — Must be good!`,
            `🔄 "${title}" for the ${count}${count === 2 ? 'nd' : count === 3 ? 'rd' : 'th'} time!`,
          ];

      const message = messages[Math.floor(Math.random() * messages.length)];

      if (onShowAlert) {
        onShowAlert(message, 'success');
      }

      setShowWatchedPrompt(false);
      setPromptMovie(null);
    } catch (error) {
      console.error('Error marking movie as watched:', error);
      if (onShowAlert) {
        onShowAlert('Failed to mark as watched', 'danger');
      }
    }
  };

  const groupOptions: GroupOption[] = [
    { value: 'none', label: 'No grouping' },
    { value: 'collection', label: 'Group by Box Set' },
    { value: 'director', label: 'Group by Director' },
    { value: 'genre', label: 'Group by Genre' },
    { value: 'format', label: 'Group by Format' },
    { value: 'decade', label: 'Group by Decade' },
    { value: 'ageGroup', label: 'Group by Age Rating' }
  ];

  const handleSortChange = async (sortOption: string) => {
    // A sort chosen while letters are typed holds until they go.
    if (hasMatchScores(filteredMovies)) bestMatch.choose(false);
    setSortBy(sortOption);
    writeStored('dexvault-filmdex-sort', sortOption);
    setSortLoading(true);

    // Add a small delay to show loading state for better UX
    await new Promise(resolve => setTimeout(resolve, 150));

    // Apply sorting to current filtered movies
    const sorted = sortMovies(filteredMovies, sortOption);
    setMovies(sorted);
    setSortLoading(false);
  };

  const handleBestMatch = () => {
    bestMatch.choose(true);
    setMovies(sortMovies(filteredMovies, sortBy));
  };

  // Grouping functions
  const groupMoviesFunc = (moviesToGroup: any[], groupOption: string) => {
    if (groupOption === 'none') {
      return { 'All Movies': moviesToGroup };
    }

    const groups: Record<string, any[]> = {};

    moviesToGroup.forEach(movie => {
      let groupKeys: string[] = [];

      switch (groupOption) {
        case 'collection':
          // Box sets are now managed via collections - grouping removed from thumbnail view
          groupKeys = ['All Movies'];
          break;
        case 'director':
          groupKeys = [movie.director || 'Unknown Director'];
          break;
        case 'genre':
          if (movie.genre) {
            // Split comma-separated genres and trim whitespace
            groupKeys = movie.genre.split(',').map((g: string) => g.trim()).filter((g: string) => g.length > 0);
          } else {
            groupKeys = ['Unknown Genre'];
          }
          break;
        case 'format':
          groupKeys = [movie.format || 'Unknown Format'];
          break;
        case 'decade': {
          const year = movie.release_date ? new Date(movie.release_date).getFullYear() : movie.year;
          if (year && !isNaN(year)) {
            const decade = Math.floor(year / 10) * 10;
            groupKeys = [`${decade}s`];
          } else {
            groupKeys = ['Unknown Decade'];
          }
          break;
        }
        case 'ageGroup':
          if (movie.recommended_age !== null && movie.recommended_age !== undefined) {
            const age = movie.recommended_age;
            if (age <= 3) {
              groupKeys = ['All Ages (0-3)'];
            } else if (age < 10) {
              groupKeys = ['Children (4-9)'];
            } else if (age <= 14) {
              groupKeys = ['Pre-teens (10-14)'];
            } else {
              groupKeys = ['Teens & Adults (15+)'];
            }
          } else {
            groupKeys = ['Not Rated'];
          }
          break;
        default:
          groupKeys = ['All Movies'];
      }

      // Add movie to each group it belongs to
      groupKeys.forEach(groupKey => {
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(movie);
      });
    });

    // Sort groups alphabetically by key
    const sortedGroups: Record<string, any[]> = {};
    Object.keys(groups).sort().forEach(key => {
      sortedGroups[key] = groups[key];
    });

    return sortedGroups;
  };

  const handleGroupChange = async (groupOption: string) => {
    setGroupBy(groupOption);
    setGroupLoading(true);

    // Add a small delay to show loading state for better UX
    await new Promise(resolve => setTimeout(resolve, 150));

    // Apply grouping to current filtered movies
    const grouped = groupMoviesFunc(filteredMovies, groupOption);

    // If grouping is enabled, expand all groups initially
    if (groupOption !== 'none') {
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

    const grouped = groupMoviesFunc(filteredMovies, groupBy);
    const allGroupKeys = Object.keys(grouped);

    if (expandAllGroups) {
      setExpandedGroups(new Set());
      setExpandAllGroups(false);
    } else {
      setExpandedGroups(new Set(allGroupKeys));
      setExpandAllGroups(true);
    }
  };

  // Group movies by box set for stacking
  const groupMoviesByBoxSet = (moviesToGroup: any[]) => {
    const boxSetMap = new Map<string, any[]>();
    const standaloneMovies: any[] = [];

    moviesToGroup.forEach(movie => {
      if (movie.has_box_set && movie.box_set_name) {
        if (!boxSetMap.has(movie.box_set_name)) {
          boxSetMap.set(movie.box_set_name, []);
        }
        boxSetMap.get(movie.box_set_name)!.push(movie);
      } else {
        standaloneMovies.push(movie);
      }
    });

    return { boxSetMap, standaloneMovies };
  };

  // The stacks come from the whole collection, without the search's scores: while letters are
  // typed, put the best match first among them, a box set by its best movie (useBestMatch).
  const stacksBestFirst = useCallback((items: any[]) => (bestMatch.on
    ? stacksMatchFirst(items, filteredMovies, item => (item.type === 'boxset' ? item.movies : [item.movie]))
    : items), [bestMatch.on, filteredMovies]);

  // Items used to compute the A-Z index letters; must match the titles actually rendered (box set name vs movie title)
  const alphabeticalIndexItems = useMemo(() => {
    // Index doesn't make sense in grouped view (many items are collapsed)
    if (groupBy !== 'none') return [];

    // If stacking is disabled, the rendered list is just movies
    if (!stackEnabled) {
      return (movies || []).map(m => ({ title: m?.title || '' }));
    }

    const hasActiveFilter = !!searchCriteria?.searchText?.trim();
    const moviesToGroup = hasActiveFilter ? allMovies : movies;
    const { boxSetMap: allBoxSetMap, standaloneMovies: allStandaloneMovies } = groupMoviesByBoxSet(moviesToGroup || []);

    // When filtering, we only render stacks/movies that match filteredMovies, but we keep stack grouping from allMovies
    let boxSetMap = allBoxSetMap;
    let standaloneMovies = allStandaloneMovies;

    if (hasActiveFilter) {
      const filteredMovieIds = new Set((filteredMovies || []).map(m => m.id));

      boxSetMap = new Map();
      allBoxSetMap.forEach((boxSetMovies, boxSetName) => {
        const matchingMovies = boxSetMovies.filter(m => filteredMovieIds.has(m.id));
        if (matchingMovies.length > 0) {
          boxSetMap.set(boxSetName, matchingMovies);
        }
      });

      standaloneMovies = allStandaloneMovies.filter(m => filteredMovieIds.has(m.id));
    }

    // Build combined list in the same order as the stacked renderer
    const combinedItems: any[] = [];

    boxSetMap.forEach((boxSetMovies, boxSetName) => {
      const sortedMoviesInSet = [...boxSetMovies].sort((a, b) => {
        const orderA = a.collection_order != null ? Number(a.collection_order) : 999999;
        const orderB = b.collection_order != null ? Number(b.collection_order) : 999999;
        if (orderA !== orderB) return orderA - orderB;
        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
        return dateA - dateB;
      });

      combinedItems.push({
        type: 'boxset',
        boxSetName,
        movies: boxSetMovies,
        representativeMovie: sortedMoviesInSet[0],
      });
    });

    standaloneMovies.forEach(movie => {
      combinedItems.push({
        type: 'movie',
        movie,
      });
    });

    combinedItems.sort((a, b) => {
      const movieA = a.type === 'boxset' ? a.representativeMovie : a.movie;
      const movieB = b.type === 'boxset' ? b.representativeMovie : b.movie;

      switch (sortBy) {
        case 'title': {
          const titleA = a.type === 'boxset' ? a.boxSetName : movieA.title;
          const titleB = b.type === 'boxset' ? b.boxSetName : movieB.title;
          return titleA.localeCompare(titleB);
        }
        case 'titleReverse': {
          const titleA = a.type === 'boxset' ? a.boxSetName : movieA.title;
          const titleB = b.type === 'boxset' ? b.boxSetName : movieB.title;
          return titleB.localeCompare(titleA);
        }
        case 'lastAddedFirst':
          return new Date(movieB.acquired_date || movieB.created_at || movieB.updated_at).getTime() -
                 new Date(movieA.acquired_date || movieA.created_at || movieA.updated_at).getTime();
        case 'lastAddedLast':
          return new Date(movieA.acquired_date || movieA.created_at || movieA.updated_at).getTime() -
                 new Date(movieB.acquired_date || movieB.created_at || movieB.updated_at).getTime();
        case 'rating': {
          const ratingA = getCombinedScore(movieA) || 0;
          const ratingB = getCombinedScore(movieB) || 0;
          return ratingB - ratingA;
        }
        case 'ratingLowest': {
          const ratingA = getCombinedScore(movieA) || 0;
          const ratingB = getCombinedScore(movieB) || 0;
          return ratingA - ratingB;
        }
        case 'ageAsc': {
          const ageA = movieA.recommended_age ?? 999;
          const ageB = movieB.recommended_age ?? 999;
          return ageA - ageB;
        }
        case 'ageDesc': {
          const ageA = movieA.recommended_age ?? -1;
          const ageB = movieB.recommended_age ?? -1;
          return ageB - ageA;
        }
        default:
          return 0;
      }
    });
    stacksBestFirst(combinedItems);

    return combinedItems.map(item => ({
      title: item.type === 'boxset' ? item.boxSetName : (item.movie?.title || ''),
    }));
  }, [groupBy, stackEnabled, movies, searchCriteria?.searchText, allMovies, filteredMovies, sortBy, getCombinedScore, stacksBestFirst]);

  // Toggle box set stack expansion
  const toggleBoxSetExpansion = (boxSetName: string) => {
    setExpandedBoxSet(expandedBoxSet === boxSetName ? null : boxSetName);
  };

  // Close box set expansion
  const handleCloseBoxSetExpansion = () => {
    setExpandedBoxSet(null);
  };

  // Get Watch Next movies for banner (already sorted by API)
  const [watchNextMovies, setWatchNextMovies] = useKeptState<any[]>('filmdex:watchNext', []);
  // Until its list is read, the banner is taken to be there: its place held, then filled or slid away.
  const [watchNextRead, setWatchNextRead] = useState(() => isKept('filmdex:watchNext'));
  const [showWatchedPrompt, setShowWatchedPrompt] = useState(false);
  const [promptMovie, setPromptMovie] = useState<any>(null); // Store full movie object for prompt

  useEffect(() => {
    const loadWatchNextMovies = async () => {
      try {
        const watchNextData = await apiService.getWatchNextMovies() as any[];
        setWatchNextMovies(watchNextData);
      } catch (error) {
        console.warn('Failed to load Watch Next movies:', error);
        setWatchNextMovies([]);
      } finally {
        setWatchNextRead(true);
      }
    };

    loadWatchNextMovies();
  }, [refreshTrigger]);

  // Helper function to get poster URL
  const getPosterUrl = (posterPath: string | null | undefined) => {
    if (!posterPath) return null;
    // If it's already a local path, return as is
    if (posterPath.startsWith('/images/') || posterPath.startsWith('/api/images/')) {
      return posterPath;
    }
    // If it's already a full URL, return as is
    return posterPath;
  };

  return (
    <div className="movie-search" ref={scrollContainerRef}>
      {/* Alphabetical Index - only shows when sorted by title */}
      <AlphabeticalIndex
        items={alphabeticalIndexItems}
        getTitle={(item: any) => item.title}
        scrollContainer={scrollContainer}
        sortBy={sortBy}
        // Keep available during filtering/search; disable only when grouping is enabled
        disabled={groupBy !== 'none'}
      />

      {/* Watch Next Banner: its place held until its list is read, then filled or slid away. */}
      <NextBannerSlot show={!searchCriteria?.searchText && (!watchNextRead || watchNextMovies.length > 0)}>
        {watchNextRead ? (
          <NextBanner
            items={watchNextMovies}
            type="movie"
            title="Watch Next"
            className="watch-next-banner"
            onItemClick={(id) => handleMovieClick(id, watchNextMovies.map((movie: any) => movie.id))}
            onRemove={handleWatchNextToggle}
            onReorder={keys => handleWatchNextReorder(keys as number[])}
            getImageUrl={(movie: any) => getPosterUrl(movie.poster_path)}
            getTitle={(movie: any) => movie.title}
            renderCover={(movie: any) => <MovieCover movie={allMovies.find(m => m.id === movie.id) ?? movie} />}
          />
        ) : <NextBannerPending type="movie" title="Watch Next" className="watch-next-banner" />}
      </NextBannerSlot>

      <div className="movies-results" ref={resultsRef}>
        <CollectionHeader
          filteredCount={filteredMovies.length}
          totalCount={allMovies.length}
          itemLabel="movies"
          sortBy={sortBy}
          sortOptions={sortOptions}
          onSortChange={handleSortChange}
          bestMatch={bestMatch.on && hasMatchScores(filteredMovies)}
          onBestMatch={hasMatchScores(filteredMovies) ? handleBestMatch : undefined}
          sortLoading={sortLoading}
          groupBy={groupBy}
          groupOptions={groupOptions}
          onGroupChange={handleGroupChange}
          groupLoading={groupLoading}
          expandAllGroups={expandAllGroups}
          onToggleAllGroups={toggleAllGroups}
          stackEnabled={stackEnabled}
          onStackChange={(newValue: boolean) => {
            setStackEnabled(newValue);
            writeStored('dexvault-filmdex-stack', newValue.toString());
            setExpandedBoxSet(null);
          }}
          addButtonLabel="Add Movie"
          onAdd={() => onAddMovie && onAddMovie('collection')}
          loading={loading}
        />

        {loading ? (
          <div className="loading">Loading movies...</div>
        ) : movies.length === 0 ? (
          /* Empty State - Check if it's a search or truly empty database */
          searchCriteria?.searchText && searchCriteria.searchText.trim() ? (
            /* Search returned no results */
            <EmptyState
              icon="🎬"
              title="No Results Found"
              description={`No movies match "${searchCriteria.searchText}"`}
              hint="Try different keywords or clear your search"
              collectionInfo={`You have <strong>${allMovies.length}</strong> ${allMovies.length === 1 ? 'movie' : 'movies'} in your collection`}
            />
          ) : (
            /* Database is empty */
            <EmptyState
              icon="🍿"
              title="Welcome to FilmDex!"
              description="Your movie collection is empty. Add your first movie to get started and begin tracking your film library."
              action={
                <Button variant="primary" icon={<BsFilm />} className="mt-4"
                  onClick={() => onAddMovie && onAddMovie()}
                >
                  Add Your First Movie
                </Button>
              }
            />
          )
        ) : (
          <>
            {/* Movies Grid - Grouped or Ungrouped */}
            {groupBy === 'none' ? (
              <div className={`movies-grid movies-grid-large ${sortLoading ? 'sort-loading' : ''}`}>
                <Progressive>{(() => {
                  // Check if box set stacking should be used
                  const shouldUseStack = stackEnabled;
                  const hasActiveFilter = searchCriteria?.searchText?.trim();

                  if (shouldUseStack) {
                    // When searching, group ALL movies by box set, then filter each stack
                    // When not searching, just group the current movies
                    const moviesToGroup = hasActiveFilter ? allMovies : movies;
                    const { boxSetMap: allBoxSetMap, standaloneMovies: allStandaloneMovies } = groupMoviesByBoxSet(moviesToGroup);

                    // If searching, filter each box set to only include matching movies
                    let boxSetMap = allBoxSetMap;
                    let standaloneMovies = allStandaloneMovies;
                    const boxSetTotalCounts = new Map<string, number>(); // Track total counts for each box set

                    if (hasActiveFilter) {
                      // Create a Set of filtered movie IDs for quick lookup
                      const filteredMovieIds = new Set(filteredMovies.map(m => m.id));

                      // Store total counts before filtering
                      allBoxSetMap.forEach((boxSetMovies, boxSetName) => {
                        boxSetTotalCounts.set(boxSetName, boxSetMovies.length);
                      });

                      // Filter box sets to only include matching movies
                      boxSetMap = new Map();
                      allBoxSetMap.forEach((boxSetMovies, boxSetName) => {
                        const matchingMovies = boxSetMovies.filter(m => filteredMovieIds.has(m.id));
                        if (matchingMovies.length > 0) {
                          boxSetMap.set(boxSetName, matchingMovies);
                        }
                      });

                      // Filter standalone movies
                      standaloneMovies = allStandaloneMovies.filter(m => filteredMovieIds.has(m.id));
                    }

                    // Create a combined list for sorting
                    const combinedItems: any[] = [];

                    // Add box sets (represented by their first movie for sorting)
                    boxSetMap.forEach((boxSetMovies, boxSetName) => {
                      // Sort movies within box set by collection_order, then by release_date
                      const sortedMoviesInSet = [...boxSetMovies].sort((a, b) => {
                        const orderA = a.collection_order != null ? Number(a.collection_order) : 999999;
                        const orderB = b.collection_order != null ? Number(b.collection_order) : 999999;

                        // If collection_order is different, sort by that
                        if (orderA !== orderB) {
                          return orderA - orderB;
                        }

                        // If collection_order is the same (or both null), sort by release_date
                        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
                        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
                        return dateA - dateB;
                      });

                      combinedItems.push({
                        type: 'boxset',
                        boxSetName,
                        movies: boxSetMovies,
                        sortedMovies: sortedMoviesInSet,
                        representativeMovie: sortedMoviesInSet[0], // Use first movie for sorting
                      });
                    });

                    // Add standalone movies
                    standaloneMovies.forEach(movie => {
                      combinedItems.push({
                        type: 'movie',
                        movie,
                      });
                    });

                    // Sort the combined list according to current sortBy
                    combinedItems.sort((a, b) => {
                      const movieA = a.type === 'boxset' ? a.representativeMovie : a.movie;
                      const movieB = b.type === 'boxset' ? b.representativeMovie : b.movie;

                      switch (sortBy) {
                        case 'title': {
                          // For box sets, use box set name; for movies, use title
                          const titleA = a.type === 'boxset' ? a.boxSetName : movieA.title;
                          const titleB = b.type === 'boxset' ? b.boxSetName : movieB.title;
                          return titleA.localeCompare(titleB);
                        }
                        case 'titleReverse': {
                          const titleRevA = a.type === 'boxset' ? a.boxSetName : movieA.title;
                          const titleRevB = b.type === 'boxset' ? b.boxSetName : movieB.title;
                          return titleRevB.localeCompare(titleRevA);
                        }
                        case 'lastAddedFirst':
                          return new Date(movieB.acquired_date || movieB.created_at || movieB.updated_at).getTime() -
                                 new Date(movieA.acquired_date || movieA.created_at || movieA.updated_at).getTime();
                        case 'lastAddedLast':
                          return new Date(movieA.acquired_date || movieA.created_at || movieA.updated_at).getTime() -
                                 new Date(movieB.acquired_date || movieB.created_at || movieB.updated_at).getTime();
                        case 'rating': {
                          const ratingA = getCombinedScore(movieA) || 0;
                          const ratingB = getCombinedScore(movieB) || 0;
                          return ratingB - ratingA;
                        }
                        case 'ratingLowest': {
                          const ratingLowestA = getCombinedScore(movieA) || 0;
                          const ratingLowestB = getCombinedScore(movieB) || 0;
                          return ratingLowestA - ratingLowestB;
                        }
                        case 'ageAsc': {
                          const ageA = movieA.recommended_age ?? 999;
                          const ageB = movieB.recommended_age ?? 999;
                          return ageA - ageB;
                        }
                        case 'ageDesc': {
                          const ageDescA = movieA.recommended_age ?? -1;
                          const ageDescB = movieB.recommended_age ?? -1;
                          return ageDescB - ageDescA;
                        }
                        default:
                          return 0;
                      }
                    });
                    stacksBestFirst(combinedItems);

                    // Render the sorted combined items with letter tracking for index
                    const items: React.ReactNode[] = [];

                    combinedItems.forEach(item => {
                      // Determine the title for letter tracking
                      const title = item.type === 'boxset' ? item.boxSetName : item.movie?.title;
                      const letter = getFirstLetterForIndex(title);

                      if (item.type === 'boxset') {
                        if (item.movies.length > 1) {
                          const isExpanded = expandedBoxSet === item.boxSetName;
                          const totalCount = hasActiveFilter ? boxSetTotalCounts.get(item.boxSetName) : undefined;
                          items.push(
                            <BoxSetStack
                              key={`boxset-${item.boxSetName}`}
                              boxSetName={item.boxSetName}
                              movies={item.movies}
                              onMovieClick={handleMovieClick}
                              isExpanded={isExpanded}
                              onToggleExpanded={() => toggleBoxSetExpansion(item.boxSetName)}
                              sortedMovies={item.sortedMovies}
                              onClose={handleCloseBoxSetExpansion}
                              watchNextMovies={watchNextMovies}
                              onWatchNextToggle={handleWatchNextToggle}
                              dataFirstLetter={letter}
                              totalCount={totalCount}
                            />
                          );
                        } else {
                          // Single movie box set, render normally
                          items.push(renderMovieCardLarge(item.movies[0], true, letter));
                        }
                      } else {
                        items.push(renderMovieCardLarge(item.movie, true, letter));
                      }
                    });

                    return items;
                  } else {
                    // Normal rendering without stacking - add letter to all items for index detection
                    return movies && movies.map((movie) => {
                      const letter = getFirstLetterForIndex(movie.title);
                      return renderMovieCardLarge(movie, true, letter);
                    });
                  }
                })()}</Progressive>
              </div>
            ) : (
              <div className={`movies-groups ${sortLoading || groupLoading ? 'sort-loading' : ''}`}>
                {(() => {
                  const grouped = groupMoviesFunc(filteredMovies, groupBy);

                  // Sort group keys logically for age groups
                  const sortedGroupKeys = Object.keys(grouped).sort((a, b) => {
                    if (groupBy === 'ageGroup') {
                      // Custom sorting for age groups: logical order
                      const ageGroupOrder: Record<string, number> = {
                        'All Ages (0-3)': 1,
                        'Children (4-9)': 2,
                        'Pre-teens (10-14)': 3,
                        'Teens & Adults (15+)': 4,
                        'Not Rated': 5
                      };

                      const orderA = ageGroupOrder[a] || 999;
                      const orderB = ageGroupOrder[b] || 999;
                      return orderA - orderB;
                    }
                    return a.localeCompare(b);
                  });

                  return sortedGroupKeys.map((groupKey) => {
                    const groupMoviesList = grouped[groupKey];
                    const isExpanded = expandedGroups.has(groupKey);
                    const sortedGroupMovies = sortMovies(groupMoviesList, sortBy);

                    return (
                      <div key={groupKey} className="movie-group">
                        <div
                          className="group-header"
                          onClick={() => toggleGroup(groupKey)}
                        >
                          <div className="group-title">
                            <BsChevronDown className={`group-chevron ${isExpanded ? 'expanded' : ''}`} />
                            <span>{groupKey}</span>
                            <span className="group-count">({groupMoviesList.length})</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="movies-grid movies-grid-large">
                            {sortedGroupMovies.map((movie: any) => {
                              const letter = getFirstLetterForIndex(movie.title);
                              return renderMovieCardLarge(movie, true, letter);
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {phone && openedId != null && (
        <MovieSheet
          movieId={openedId}
          movie={selectedMovieDetails?.id === openedId ? selectedMovieDetails : null}
          listMovie={findById(openedId, allMovies, watchNextMovies) as any}
          watchNext={watchNextMovies}
          onWatchNextChange={refreshWatchNextMovies}
          onClose={() => { setOpenedId(null); setSelectedMovieDetails(null); }}
          onDelete={handleDeleteMovie}
          onRefresh={refreshForDetailCard}
          onMovieClick={id => handleMovieClick(id)}
          onSearch={onSearch}
        />
      )}

      {/* Movie Detail Card */}
      {!phone && (selectedMovieDetails || loadingDetails) && (
        <MovieDetailCard
          movieDetails={selectedMovieDetails}
          loading={loadingDetails}
          onClose={handleCloseDetails}
          onEdit={undefined}
          onDelete={handleDeleteMovie}
          onShowAlert={onShowAlert}
          onRefresh={refreshForDetailCard}
          onMovieClick={handleMovieClick}
          onSearch={onSearch}
          onPrevious={movieSteps.onPrevious}
          onNext={movieSteps.onNext}
        />
      )}

      {/* "Did you watch?" prompt after removing from Watch Next */}
      {showWatchedPrompt && (
        <div className="watched-prompt-toast">
          <span className="watched-prompt-text">Did you watch this movie?</span>
          <div className="watched-prompt-buttons">
            <Button size="sm"
              className="watched-prompt-btn"
              onClick={() => handlePromptMarkWatched(0)}
            >
              Today
            </Button>
            <Button size="sm"
              className="watched-prompt-btn"
              onClick={() => handlePromptMarkWatched(1)}
            >
              Yesterday
            </Button>
            <IconButton label="Dismiss" size="sm" className="watched-prompt-dismiss"
              onClick={() => {
                setShowWatchedPrompt(false);
                setPromptMovie(null);
              }}
              title="Dismiss"
            ><BsX /></IconButton>
          </div>
        </div>
      )}

    </div>
  );
});

FilmDexPage.displayName = 'FilmDexPage';

export default FilmDexPage;
