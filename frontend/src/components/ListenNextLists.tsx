import React from 'react';
import { BsDisc, BsHeadphones } from 'react-icons/bs';
import Segmented from './shared/Segmented';
import CoverButton from './shared/CoverButton';
import { AlbumStarRating } from './RecordStarRating';
import { NextBannerDrop } from './shared/NextBanner';
import { toast } from './shared/Toast';
import musicService, { type ListenNextMedium } from '../services/musicService';
import './ListenNextLists.css';

/**
 * Listen Next's two lists: Digital, streamed here or in Amperfy, and CD,
 * the CDs to put on the player. The one in sight, its name and the other's
 * as Digital | CD; the other at the foot, small; a cover dragged from one to
 * the other, or sent by its round button.
 */

export const MEDIUM_NAMES: Record<ListenNextMedium, string> = { digital: 'Digital', cd: 'CD' };
export const otherMedium = (medium: ListenNextMedium): ListenNextMedium => (medium === 'cd' ? 'digital' : 'cd');
export const mediumOf = (album: object): ListenNextMedium => ((album as { medium?: unknown }).medium === 'cd' ? 'cd' : 'digital');
export const MediumIcon: React.FC<{ medium: ListenNextMedium; className?: string }> = ({ medium, className }) =>
  (medium === 'cd' ? <BsDisc className={className} aria-hidden="true" /> : <BsHeadphones className={className} aria-hidden="true" />);

/** What a click does, said as listening. */
export const INSTEAD: Record<ListenNextMedium, string> = { digital: 'Stream it instead', cd: 'Play the CD instead' };

interface SwitchProps {
  medium: ListenNextMedium;
  /** None while the lists are read. */
  counts?: Record<ListenNextMedium, number>;
  onChange: (medium: ListenNextMedium) => void;
}

/** Digital | CD by the title, each name a place to drop a cover for its list. */
export const ListenNextSwitch: React.FC<SwitchProps> = ({ medium, counts, onChange }) => (
  <Segmented<ListenNextMedium>
    className="listen-next-switch"
    // The list chosen in its colour, as the banner's tint: gold streamed, silver on CD.
    tone={medium === 'cd' ? 'silver' : 'gold'}
    label="Which list"
    value={medium}
    onChange={onChange}
    options={(['digital', 'cd'] as ListenNextMedium[]).map(value => ({
      value,
      label: <NextBannerDrop id={value} inline className="listen-next-switch__drop">{MEDIUM_NAMES[value]}</NextBannerDrop>,
      count: counts?.[value],
      tooltip: value === 'cd' ? 'Listen Next, on CD' : 'Listen Next, streamed',
    }))}
  />
);

interface MoveButtonProps {
  title: string;
  to: ListenNextMedium;
  onMove: () => void;
}

/** On a card: the other list's icon, to send it there. */
export const MoveButton: React.FC<MoveButtonProps> = ({ title, to, onMove }) => (
  <CoverButton className="listen-next-move" size="small" title={INSTEAD[to]} label={`${INSTEAD[to]}: ${title}`}
    onClick={event => { event.stopPropagation(); onMove(); }}>
    <MediumIcon medium={to} />
  </CoverButton>
);

/** The other list's name at the foot, its icon and its length: a click puts it in sight. */
export const OtherListName: React.FC<{ medium: ListenNextMedium; count: number; onOpen: () => void }> = ({ medium, count, onOpen }) => (
  <button type="button" className={`listen-next-strip__name listen-next-strip__name--${medium}`} onClick={onOpen}
    title={medium === 'cd' ? 'Listen Next, on CD' : 'Listen Next, streamed'}>
    <MediumIcon medium={medium} /> {MEDIUM_NAMES[medium]} <span>· {count}</span>
  </button>
);

/** A CD of no stars taken off the CD list, played: its stars asked a few seconds, with Undo. */
export const askStars = (album: { id: number; title?: string }, onUndo: () => void): void => {
  const Rate: React.FC = () => {
    const [stars, setStars] = React.useState<number | null>(null);
    return (
      <span className="listen-next-rate">
        <span className="listen-next-rate__words">{stars ? `${stars} ★ kept` : 'Rate it'} <b>{album.title}</b></span>
        <AlbumStarRating value={stars} size="lg" label={`Stars for ${album.title}`} onChange={value => {
          setStars(value || null);
          musicService.setAlbumRating(album.id, value).catch(() => toast('The stars were not kept', { tone: 'danger' }));
        }} />
      </span>
    );
  };
  toast(<Rate />, { duration: 8000, action: { label: 'Undo', onClick: onUndo } });
};
