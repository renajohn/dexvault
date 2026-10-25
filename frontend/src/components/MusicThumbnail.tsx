import React, { useRef, useState } from 'react';
import { BsDisc, BsBookmark, BsBookmarkFill, BsCassetteFill, BsHeadphones, BsXLg } from 'react-icons/bs';
import type { ListenNextMedium } from '../services/musicService';
import musicService from '../services/musicService';
import './MusicThumbnail.css';
import ShelfCode from './shared/ShelfCode';
import AlbumPlayButton from './shared/AlbumPlayButton';
import DigitalMarks from './shared/DigitalMarks';
import CoverButton from './shared/CoverButton';
import CoverTag, { CoverTagStack } from './shared/CoverTag';
import { isMixtape, mixtapeArtists } from '../utils/mixtape';
import type { AlbumDigital } from '../utils/digitalLibrary';
import { coverReady, thumbProps } from '../utils/thumb';

interface CdData {
  id: number | string;
  title: string;
  artist: string | string[];
  cover?: string;
  urls?: {
    appleMusic?: string;
    [key: string]: string | undefined;
  };
  [key: string]: unknown;
}

interface MusicThumbnailProps {
  cd: CdData;
  onClick: () => void;
  onListenNextChange?: () => void;
  isInListenNext?: boolean;
  /** The headphones' tooltip: what of the album Listen Next holds ("Next, on CD: Disc 1 & 2 · click: off the list"). */
  listenNextTitle?: string;
  /** The list of Listen Next the album is in: its button wears its icon, the headphones (streamed) or the disc. */
  listenNextMedium?: ListenNextMedium | null;
  dataItemId?: number | string;
  dataFirstLetter?: string;
  /** How the album stands in Navidrome, with Digital on; undefined with it off, and no mark is shown. */
  digital?: AlbumDigital;
  /** In Buy: why, and the bookmark and ✕ under the pointer in place of Listen Next. */
  buy?: { reason: string | null; wished: boolean; onWish: () => void; onDismiss?: () => void };
}

/** Held this long on an iPhone, the button puts the album in the CD list. */
const HOLD_MS = 450;

const MusicThumbnail: React.FC<MusicThumbnailProps> = ({ cd, onClick, onListenNextChange, isInListenNext: isInListenNextProp, listenNextTitle, listenNextMedium, dataItemId, dataFirstLetter, digital, buy }) => {
  const [togglingListenNext, setTogglingListenNext] = useState<boolean>(false);
  const [holding, setHolding] = useState(false);
  const hold = useRef<{ timer: number; done: boolean } | null>(null);

  // Use prop if provided, otherwise local state (for backwards compatibility)
  const isInListenNext = isInListenNextProp !== undefined ? isInListenNextProp : false;
  const mixtape = isMixtape(cd);
  const getArtistDisplay = (): string => {
    if (mixtape) return mixtapeArtists(cd.artist);
    if (Array.isArray(cd.artist)) {
      return cd.artist.join(', ');
    }
    return cd.artist || 'Unknown Artist';
  };

  const getCoverImage = (): string | null => {
    return musicService.getImageUrl(cd.cover);
  };

  // A CD of the collection can go on the player; one not ripped can only: a plain click puts it in the CD list.
  const canBeCd = !mixtape && ((cd.titleStatus as string | undefined) ?? 'owned') === 'owned';
  const plainMedium: ListenNextMedium = canBeCd && cd.fileQuality === 'none' ? 'cd' : 'digital';
  const nextTitle = listenNextTitle
    ?? (canBeCd && plainMedium === 'digital' ? 'Stream it next · Alt-click: play the CD next' : plainMedium === 'cd' ? 'Play the CD next' : 'Stream it next');

  /** In a list: out of it. Out: into the list asked, the CD list for Alt-click or a hold, else the plain one. */
  const handleListenNextToggle = async (e?: React.MouseEvent, onCd = false) => {
    if (e) e.stopPropagation();
    if (togglingListenNext) return;

    setTogglingListenNext(true);
    try {
      const into: ListenNextMedium = onCd && canBeCd ? 'cd' : plainMedium;
      // Alt-click on an album in the streamed list: to the CD list rather than out.
      if (isInListenNext && !(onCd && canBeCd && listenNextMedium !== 'cd')) await musicService.toggleListenNext(cd.id);
      else await musicService.toggleListenNext(cd.id, undefined, into);
      // Refresh the listen next banner immediately (parent will update isInListenNext prop)
      if (onListenNextChange) {
        onListenNextChange();
      }
    } catch (error) {
      console.error('Error toggling Listen Next:', error);
    } finally {
      setTogglingListenNext(false);
    }
  };

  return (
    <div
      className="music-thumbnail cover-host"
      onClick={onClick}
      {...(dataItemId ? { 'data-item-id': dataItemId } : {})}
      {...(dataFirstLetter ? { 'data-first-letter': dataFirstLetter } : {})}
    >
      <div className="music-thumbnail-cover">
        {getCoverImage() ? (
          <img
            {...thumbProps(getCoverImage()!)}
            loading="lazy"
            decoding="async"
            alt={`${cd.title} cover`}
            className="music-thumbnail-image cover-img"
            onLoad={coverReady}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              if (target.nextSibling) {
                (target.nextSibling as HTMLElement).style.display = 'flex';
              }
            }}
          />
        ) : null}
        <div
          className="music-thumbnail-placeholder"
          style={{ display: getCoverImage() ? 'none' : 'flex' }}
        >
          {mixtape ? <BsCassetteFill size={32} /> : <BsDisc size={32} />}
        </div>
        {/* ▶ under the pointer plays the album in DexVault; on an iPhone, always in sight, in Amperfy. One with no rip opens its card. */}
        <AlbumPlayButton albumId={cd.id} title={cd.title} offerPlay
          onUnripped={onClick} className="thumbnail-play" />
        <ShelfCode kind="album" id={cd.id} />
        {mixtape && (
          <CoverTagStack direction="row" className="digital-marks">
            <CoverTag variant="plain" title="A mixtape: a playlist of yours in Navidrome"><BsCassetteFill aria-hidden="true" />Mixtape</CoverTag>
          </CoverTagStack>
        )}
        {digital !== undefined && !mixtape && <DigitalMarks digital={digital} titleStatus={cd.titleStatus as string | undefined} hideWish={Boolean(buy)} />}
        {/* In Buy, at the top right: an album with no CD has no shelf code there. Listen Next keeps its place below. */}
        {buy && (
          <div className="thumbnail-buy-actions">
            {buy.onDismiss && (
              <CoverButton label={`Not interested in ${cd.title}`} title="Not interested"
                onClick={event => { event.stopPropagation(); buy.onDismiss!(); }}>
                <BsXLg aria-hidden="true" />
              </CoverButton>
            )}
            <CoverButton active={buy.wished}
              label={buy.wished ? `Take ${cd.title} off the wish list` : `Add ${cd.title} to the wish list`}
              title={buy.wished ? 'Take off the wish list' : 'Add to the wish list'}
              onClick={event => { event.stopPropagation(); buy.onWish(); }}>
              {buy.wished ? <BsBookmarkFill aria-hidden="true" /> : <BsBookmark aria-hidden="true" />}
            </CoverButton>
          </div>
        )}
        <CoverButton className={`thumbnail-listen-next${holding ? ' thumbnail-listen-next--holding' : ''}`} active={isInListenNext}
          // The whole album in or out, whatever of it is there; the discs one by one are its card's.
          onClick={event => {
            if (hold.current?.done) { hold.current = null; event.stopPropagation(); return; }
            void handleListenNextToggle(event, event.altKey);
          }}
          // Held on an iPhone: into the CD list, a ring growing meanwhile.
          onPointerDown={event => {
            if (event.pointerType === 'mouse' || !canBeCd) return;
            setHolding(true);
            hold.current = { done: false, timer: window.setTimeout(() => {
              hold.current = { timer: 0, done: true };
              setHolding(false);
              navigator.vibrate?.(12);
              void handleListenNextToggle(undefined, true);
            }, HOLD_MS) };
          }}
          onPointerUp={() => { if (hold.current && !hold.current.done) { window.clearTimeout(hold.current.timer); hold.current = null; } setHolding(false); }}
          onPointerCancel={() => { if (hold.current && !hold.current.done) window.clearTimeout(hold.current.timer); hold.current = null; setHolding(false); }}
          onContextMenu={event => event.preventDefault()}
          disabled={togglingListenNext}
          title={nextTitle}
          label={isInListenNext ? `Take ${cd.title} out of Listen Next` : `Add ${cd.title} to Listen Next`}>
          {listenNextMedium === 'cd' || (!isInListenNext && plainMedium === 'cd') ? <BsDisc aria-hidden="true" /> : <BsHeadphones aria-hidden="true" />}
        </CoverButton>
      </div>

      <div className="music-thumbnail-info">
        <h6 className="music-thumbnail-title" title={cd.title}>
          {cd.title}
        </h6>
        <p className="music-thumbnail-artist" title={getArtistDisplay()}>
          {getArtistDisplay()}
        </p>
        {buy?.reason && <p className="music-thumbnail-reason" title={buy.reason}>{buy.reason}</p>}
        {/* Year removed from thumbnail view per Apple Music aesthetic */}
      </div>

    </div>
  );
};

export default MusicThumbnail;
