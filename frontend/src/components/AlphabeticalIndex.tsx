import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import './AlphabeticalIndex.css';

interface AlphabeticalIndexProps {
  items?: Record<string, unknown>[];
  getTitle?: (item: Record<string, unknown>) => string;
  onLetterSelect?: (letter: string, item?: Record<string, unknown>) => void;
  scrollContainer?: HTMLElement | null;
  sortBy?: string;
  disabled?: boolean;
}

// Distance from the right edge, past any scrollbar, at which the mouse shows the index
const EDGE_ZONE_WIDTH = 40;

/**
 * AlphabeticalIndex - iOS-style alphabetical quick navigation
 */
const AlphabeticalIndex = ({
  items = [],
  getTitle = (item) => item.title as string,
  onLetterSelect,
  scrollContainer,
  sortBy = 'title',
  disabled = false
}: AlphabeticalIndexProps) => {
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [visibleLetters, setVisibleLetters] = useState<Set<string>>(new Set()); // Letters currently visible on screen
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [hasScrollbar, setHasScrollbar] = useState<boolean>(false);
  const indexRef = useRef<HTMLDivElement>(null);
  const nearEdgeRef = useRef<boolean>(false);
  const letterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTopRef = useRef<number>(0);

  // Show when sorting alphabetically (title or artist, ascending or descending)
  const isReversed = sortBy === 'titleReverse' || sortBy === 'artistReverse' || sortBy === 'authorReverse';
  const shouldShow = (
    sortBy === 'title' ||
    sortBy === 'titleReverse' ||
    sortBy === 'artist' ||
    sortBy === 'artistReverse' ||
    sortBy === 'author' ||
    sortBy === 'authorReverse'
  ) && !disabled;

  // Helper function to remove articles (determinants) for letter calculation
  const removeArticles = (text: string): string => {
    if (!text) return '';
    const trimmed = text.trim();
    // French articles: Le, La, Les, Un, Une, Des, Du, De
    // English articles: The, A, An
    const articlePattern = /^(le|la|les|un|une|des|du|de|the|a|an)\s+/i;
    return trimmed.replace(articlePattern, '').trim() || trimmed;
  };

  // Calculate which letters have items
  const availableLetters = useMemo(() => {
    if (!items.length) return new Set<string>();

    const letters = new Set<string>();
    items.forEach(item => {
      const title = getTitle(item);
      if (title && typeof title === 'string') {
        // Remove articles before getting first character to match sorting behavior
        const titleWithoutArticles = removeArticles(title);
        const firstChar = titleWithoutArticles.charAt(0).toUpperCase();
        if (/[A-Z]/.test(firstChar)) {
          letters.add(firstChar);
        } else if (/[0-9]/.test(firstChar)) {
          letters.add('#');
        } else {
          // Special characters go under #
          letters.add('#');
        }
      }
    });
    return letters;
  }, [items, getTitle]);

  // Create letter index array - reversed for titleReverse sort
  const allLetters = useMemo(() => {
    const letters: string[] = [];
    for (let i = 65; i <= 90; i++) {
      letters.push(String.fromCharCode(i));
    }
    letters.push('#'); // # at end for A-Z

    if (isReversed) {
      // For Z-A sorting: Z...A, then #
      return letters.reverse();
    }
    // For A-Z sorting: #, A...Z
    return ['#', ...letters.slice(0, -1)];
  }, [isReversed]);

  // Handle hover zone mouse events
  const handleHoverEnter = useCallback(() => {
    setIsHovering(true);
    // Clear any hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
  }, []);

  const handleHoverLeave = useCallback(() => {
    setIsHovering(false);
    // Start hide timer if not scrolled enough
    const currentScrollTop = scrollContainer === document.documentElement
      ? window.scrollY
      : (scrollContainer?.scrollTop || 0);

    if (currentScrollTop <= 100 && !isDragging) {
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 300);
    }
  }, [scrollContainer, isDragging]);

  // Show the index when the mouse nears the right edge. A listener rather than an
  // invisible strip laid over the page, which ate the clicks meant for the covers there.
  useEffect(() => {
    if (!shouldShow) return;

    const setNearEdge = (near: boolean) => {
      if (near === nearEdgeRef.current) return;
      nearEdgeRef.current = near;
      if (near) handleHoverEnter();
      else handleHoverLeave();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      setNearEdge(window.innerWidth - e.clientX <= EDGE_ZONE_WIDTH + scrollbarWidth);
    };
    const handleMouseLeaveWindow = () => setNearEdge(false);

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', handleMouseLeaveWindow);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeaveWindow);
    };
  }, [shouldShow, handleHoverEnter, handleHoverLeave]);

  // Detect a scrollbar that takes room (macOS overlay scrollbars take none)
  useEffect(() => {
    if (!scrollContainer) return;

    const checkScrollbar = () => {
      if (scrollContainer === document.documentElement) {
        // For window/document scrolling
        setHasScrollbar(window.innerWidth > document.documentElement.clientWidth);
      } else {
        // For custom scroll container
        setHasScrollbar(scrollContainer.offsetWidth > scrollContainer.clientWidth);
      }
    };

    // Check initially
    checkScrollbar();

    // Use ResizeObserver to detect size changes
    const resizeObserver = new ResizeObserver(checkScrollbar);
    const targetElement = scrollContainer === document.documentElement
      ? document.body
      : scrollContainer;
    resizeObserver.observe(targetElement);

    // Also listen to window resize
    window.addEventListener('resize', checkScrollbar);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkScrollbar);
    };
  }, [scrollContainer]);

  // Track scrolling to show/hide the index and detect current letter
  useEffect(() => {
    if (!shouldShow || !scrollContainer) return;

    const handleScroll = () => {
      const currentScrollTop = scrollContainer === document.documentElement
        ? window.scrollY
        : scrollContainer.scrollTop;

      // Only show if we've scrolled more than 100px
      if (currentScrollTop > 100) {
        setIsVisible(true);

        // Clear existing hide timeout
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }

        // Hide after 1.5s of no scrolling (unless dragging or hovering)
        hideTimeoutRef.current = setTimeout(() => {
          if (!isDragging && !isHovering) {
            setIsVisible(false);
          }
        }, 1500);
      } else if (!isHovering) {
        setIsVisible(false);
      }

      // Detect all letters currently visible on screen
      const searchRoot = scrollContainer === document.documentElement
        ? document.body
        : scrollContainer;

      // Get viewport bounds (using viewport-relative coordinates)
      const viewportTop = scrollContainer === document.documentElement
        ? 0
        : scrollContainer.getBoundingClientRect().top;
      const viewportBottom = scrollContainer === document.documentElement
        ? window.innerHeight
        : scrollContainer.getBoundingClientRect().bottom;

      // The letters of the cards on screen, read in one pass over the cards
      // rather than a query per letter, and only told when they change
      const nowVisible = new Set<string>();
      const under = Math.max(60, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-search-bottom')) || 0);
      searchRoot.querySelectorAll<HTMLElement>('[data-first-letter]').forEach(element => {
        const letter = element.dataset.firstLetter!;
        if (nowVisible.has(letter) || !availableLetters.has(letter)) return;
        const rect = element.getBoundingClientRect();
        // Partly in sight, below the sticky header (60px, or on a phone the search held at the top)
        if (rect.bottom > viewportTop + under && rect.top < viewportBottom) nowVisible.add(letter);
      });

      setVisibleLetters(previous =>
        previous.size === nowVisible.size && [...nowVisible].every(letter => previous.has(letter))
          ? previous
          : nowVisible);

      lastScrollTopRef.current = currentScrollTop;
    };

    // Once a frame at most: a scroll sends several events a frame
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        handleScroll();
      });
    };
    const target = scrollContainer === document.documentElement ? window : scrollContainer;
    target.addEventListener('scroll', onScroll, { passive: true });

    // Initial check
    handleScroll();

    return () => {
      target.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [shouldShow, scrollContainer, isDragging, isHovering, availableLetters]);

  // Find the first item starting with a letter and scroll to it
  const scrollToLetter = useCallback((letter: string) => {
    if (!items.length || !scrollContainer) return;

    // Find the DOM element with data-first-letter attribute
    const searchRoot = scrollContainer === document.documentElement
      ? document.body
      : scrollContainer;

    const element = searchRoot.querySelector(`[data-first-letter="${letter}"]`);

    if (element) {
      // Get the element's position relative to the document
      const elementRect = element.getBoundingClientRect();
      // Under the sticky headers: on a phone, the search held at the top of the screen.
      const stuck = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-search-bottom')) || 0;
      const offset = Math.max(120, stuck + 16);

      if (scrollContainer === document.documentElement) {
        // For window scrolling, use window.scrollTo with absolute position
        const absoluteTop = window.scrollY + elementRect.top - offset;
        window.scrollTo({
          top: Math.max(0, absoluteTop),
          behavior: 'smooth'
        });
      } else {
        // For custom scroll container
        const containerRect = scrollContainer.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top) - offset;
        scrollContainer.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'smooth'
        });
      }
    }

    // Call the callback
    if (onLetterSelect) {
      const targetItem = items.find(item => {
        const title = getTitle(item);
        if (!title || typeof title !== 'string') return false;
        // Remove articles before getting first character to match sorting behavior
        const titleWithoutArticles = removeArticles(title);
        const firstChar = titleWithoutArticles.charAt(0).toUpperCase();
        if (letter === '#') return !/[A-Z]/.test(firstChar);
        return firstChar === letter;
      });
      onLetterSelect(letter, targetItem);
    }
  }, [items, getTitle, scrollContainer, onLetterSelect]);

  // Handle letter selection
  const handleLetterSelect = useCallback((letter: string, fromDrag: boolean = false) => {
    if (!availableLetters.has(letter)) return;

    setActiveLetter(letter);
    scrollToLetter(letter);

    // Clear previous timeout
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }

    // Keep letter highlighted briefly after selection
    if (!fromDrag) {
      feedbackTimeoutRef.current = setTimeout(() => {
        setActiveLetter(null);
      }, 500);
    }
  }, [availableLetters, scrollToLetter]);

  // Get letter from touch/mouse position
  const getLetterFromPosition = useCallback((clientY: number): string | null => {
    if (!indexRef.current) return null;

    const indexRect = indexRef.current.getBoundingClientRect();
    const letters = indexRef.current.querySelectorAll('.alpha-index-letter');

    for (const letterEl of letters) {
      const rect = letterEl.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return (letterEl as HTMLElement).dataset.letter || null;
      }
    }

    // Check if above or below the index
    if (clientY < indexRect.top) {
      return allLetters.find(l => availableLetters.has(l)) || null;
    }
    if (clientY > indexRect.bottom) {
      return [...allLetters].reverse().find(l => availableLetters.has(l)) || null;
    }

    return null;
  }, [allLetters, availableLetters]);

  // Touch handlers for iOS-style dragging
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    // Keep visible while dragging
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    const touch = e.touches[0];
    const letter = getLetterFromPosition(touch.clientY);
    if (letter) {
      handleLetterSelect(letter, true);
    }
  }, [getLetterFromPosition, handleLetterSelect]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const letter = getLetterFromPosition(touch.clientY);
    if (letter && letter !== activeLetter) {
      handleLetterSelect(letter, true);
    }
  }, [isDragging, activeLetter, getLetterFromPosition, handleLetterSelect]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    feedbackTimeoutRef.current = setTimeout(() => {
      setActiveLetter(null);
    }, 500);
    // Start hide timer
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 1500);
  }, []);

  // Mouse handlers for desktop
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    // Keep visible while dragging
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    const letter = getLetterFromPosition(e.clientY);
    if (letter) {
      handleLetterSelect(letter, true);
    }
  }, [getLetterFromPosition, handleLetterSelect]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const letter = getLetterFromPosition(e.clientY);
    if (letter && letter !== activeLetter) {
      handleLetterSelect(letter, true);
    }
  }, [isDragging, activeLetter, getLetterFromPosition, handleLetterSelect]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      feedbackTimeoutRef.current = setTimeout(() => {
        setActiveLetter(null);
      }, 500);
      // Start hide timer
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 1500);
    }
  }, [isDragging]);

  // Add global mouse up listener when dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('mousemove', handleMouseMove);
    }
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, handleMouseUp, handleMouseMove]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  if (!shouldShow || availableLetters.size === 0) {
    return null;
  }

  // Show if scrolled, hovering, or dragging
  const showIndex = isVisible || isHovering || isDragging;

  return (
    <>
      {/* Letter feedback indicator */}
      {activeLetter && isDragging && (
        <div className="alpha-index-feedback">
          <span className="alpha-index-feedback-letter">{activeLetter}</span>
        </div>
      )}

      {/* Alphabetical index */}
      <div
        ref={indexRef}
        className={`alpha-index ${isDragging ? 'dragging' : ''} ${showIndex ? 'visible' : ''} ${hasScrollbar ? 'has-scrollbar' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
      >
        {allLetters.map(letter => {
          const isAvailable = availableLetters.has(letter);
          const isActive = activeLetter === letter;
          const isLetterVisible = visibleLetters.has(letter) && !isActive;

          return (
            <div
              key={letter}
              ref={el => { letterRefs.current[letter] = el; }}
              data-letter={letter}
              className={`alpha-index-letter ${isAvailable ? 'available' : 'disabled'} ${isActive ? 'active' : ''} ${isLetterVisible ? 'visible-on-screen' : ''}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (isAvailable) {
                  handleLetterSelect(letter);
                }
              }}
            >
              {letter}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default AlphabeticalIndex;
