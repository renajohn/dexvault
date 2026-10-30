import React from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { BsBookshelf } from 'react-icons/bs';
import { useShelfLocation } from '../../utils/shelfLocations';
import './ShelfCode.css';
import CoverTag from './CoverTag';

interface ShelfCodeProps {
  kind: 'movie' | 'album';
  id: number | string | null | undefined;
  /** "overlay" sits on a poster or cover; "inline" beside a title. */
  variant?: 'overlay' | 'inline';
  className?: string;
  /** Before the Shelves page shows: what holds the code makes way (the phone's full screen player). */
  onOpen?: () => void;
}

/** The Shelves page, taken to a film or a CD: its section, its shelf, the object lit. */
export const shelvesHref = (kind: ShelfCodeProps['kind'], id: number | string) => `/shelves?${kind}=${encodeURIComponent(String(id))}`;

interface TagProps extends ShelfCodeProps {
  where: string;
  go: (href: string) => void;
}

const ShelfCodeTag: React.FC<TagProps> = ({ kind, id, variant, className, where, go, onOpen }) => {
  const href = shelvesHref(kind, id!);
  // The cover or the card under it keeps its own click: this one goes to the shelves alone.
  // A press without moving starts no drag (6 px), so the Listen Next cards still let it through.
  const open = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onOpen?.();
    go(href);
  };
  const link = {
    role: 'link',
    tabIndex: 0,
    title: 'Show it on the shelves',
    'aria-label': `On the shelves: ${where}`,
    onClick: open,
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter') open(event); },
  };
  if (variant === 'overlay') {
    return (
      <CoverTag variant="gold" className={`shelf-code-badge shelf-code-overlay${className ? ` ${className}` : ''}`} {...link}>
        {where}
      </CoverTag>
    );
  }
  return (
    <span className={`shelf-code-badge shelf-code-inline${className ? ` ${className}` : ''}`} {...link}>
      <BsBookshelf aria-hidden="true" />
      {where}
    </span>
  );
};

/** In the app: the router's way, the page not loaded again. */
const RoutedShelfCode: React.FC<Omit<TagProps, 'go'>> = props => {
  const navigate = useNavigate();
  return <ShelfCodeTag {...props} go={navigate} />;
};

/**
 * Where to find the film or CD: its shelf, "B-3", or the place it is kept in. Nothing until the furniture gives it one.
 * A click shows it on the Shelves page.
 */
const ShelfCode: React.FC<ShelfCodeProps> = ({ kind, id, variant = 'overlay', className, onOpen }) => {
  const where = useShelfLocation(kind, id);
  const routed = useInRouterContext();
  if (!where || id == null) return null;
  const props = { kind, id, variant, className, where, onOpen };
  // Outside the app's router (a test, say): a plain page change.
  return routed ? <RoutedShelfCode {...props} /> : <ShelfCodeTag {...props} go={href => window.location.assign(href)} />;
};

export default ShelfCode;
