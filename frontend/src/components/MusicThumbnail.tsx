import React, { useState } from 'react';
import { BsDisc, BsBookmark, BsBookmarkFill, BsCassetteFill, BsHeadphones, BsXLg } from 'react-icons/bs';
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
  /** The headphones' tooltip: what of the album Listen Next holds ("In Listen Next: Disc 1 & 2 · take it out"). */
  listenNextTitle?: string;
  dataItemId?: number | string;
  dataFirstLetter?: string;
  /** How the album stands in Navidrome, with Digital on; undefined with it off, and no mark is shown. */
  digital?: AlbumDigital;
  /** In Buy: why, and the bookmark and ✕ under the pointer in place of Listen Next. */
  buy?: { reason: string | null; wished: boolean; onWish: () => void; onDismiss?: () => void };
}

const MusicThumbnail: React.FC<MusicThumbnailProps> = ({ cd, onClick, onListenNextChange, isInListenNext: isInListenNextProp, listenNextTitle, dataItemId, dataFirstLetter, digital, buy }) => {
  const [togglingListenNext, setTogglingListenNext] = useState<boolean>(false);

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

  /** The whole album in or out, whatever of it is there; the discs one by one are its card's. */
  const handleListenNextToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (togglingListenNext) return;

    setTogglingListenNext(true);
    try {
      await musicService.toggleListenNext(cd.id);
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
        <CoverButton className="thumbnail-listen-next" active={isInListenNext}
          onClick={handleListenNextToggle} disabled={togglingListenNext}
          title={listenNextTitle ?? 'Listen Next'}
          label={isInListenNext ? `Take ${cd.title} out of Listen Next` : `Add ${cd.title} to Listen Next`}>
          <BsHeadphones aria-hidden="true" />
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
