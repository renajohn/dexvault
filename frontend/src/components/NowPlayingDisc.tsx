import React, { useRef } from 'react';
import { BsDisc } from 'react-icons/bs';
import { usePlayer } from '../services/player';
import { setFullPlayer } from '../services/phoneDoor';
import NowPlayingBars from './shared/NowPlayingBars';
import './NowPlayingDisc.css';

/** A finger drawn this far up the disc opens the full screen player, as up the pill. */
const SWIPE_OPEN_PX = 24;
/** The ring's radius in its 40 × 40 box, and its length. */
const RADIUS = 18.5;
const CIRCLE = 2 * Math.PI * RADIUS;

/**
 * Whether the disc of what plays shows at the foot of a music window: something
 * plays (or is paused) and it is not the window's own album, whose own Pause,
 * cover and gold track already say so.
 */
export const useNowPlayingDoor = (exceptAlbumId?: number | string | null): boolean => {
  const shown = usePlayer(state => state.barShown && state.album != null && state.tracks.length > 0);
  const albumId = usePlayer(state => state.album?.id ?? null);
  return shown && (exceptAlbumId == null || albumId == null || Number(exceptAlbumId) !== albumId);
};

interface NowPlayingDiscProps {
  /** The album of the window it sits in: this one playing, no disc. */
  exceptAlbumId?: number | string | null;
  /** The track and its artist beside the disc, when the foot has room for them. */
  withWords?: boolean;
  className?: string;
  /** Touched: in the full screen player, back to what plays; else the full screen player opened. */
  onOpen?: () => void;
}

/**
 * What plays, on a phone, at the foot of a record's card, which takes the
 * whole page, or of the full screen player showing another album, the player's pill having given way
 * to it: the cover round as a disc in a ring of the place in the track, gold
 * while it plays, grey when paused, with its bars. A tap, or a finger drawn up,
 * opens the full screen player, whose handle comes back to the window.
 */
const NowPlayingDisc: React.FC<NowPlayingDiscProps> = ({ exceptAlbumId = null, withWords = false, className, onOpen = () => setFullPlayer(true) }) => {
  const door = useNowPlayingDoor(exceptAlbumId);
  const album = usePlayer(state => state.album);
  const track = usePlayer(state => state.tracks[state.index]);
  const playing = usePlayer(state => state.playing);
  const position = usePlayer(state => state.position);
  const duration = usePlayer(state => state.duration);
  const from = useRef<number | null>(null);
  if (!door || !album || !track) return null;

  // A song of a mixtape shows its CD's cover and its own artist, as the pill does.
  const cover = track.cover !== undefined ? track.cover : album.cover;
  const artist = track.artist ?? album.artist;
  const length = duration || track.durationSec || 0;
  const share = length > 0 ? Math.min(1, Math.max(0, position / length)) : 0;
  const label = `Now playing: ${track.title}, ${artist}`;

  return (
    <button type="button" className={`now-playing-disc${playing ? '' : ' now-playing-disc--paused'}${withWords ? ' now-playing-disc--words' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label} title={`${track.title} · ${artist}`}
      onClick={onOpen}
      onPointerDown={event => { from.current = event.clientY; }}
      onPointerUp={event => {
        if (from.current != null && from.current - event.clientY > SWIPE_OPEN_PX) onOpen();
        from.current = null;
      }}
      onPointerCancel={() => { from.current = null; }}>
      <span className="now-playing-disc__disc">
        <svg className="now-playing-disc__ring" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="now-playing-disc__groove" cx="20" cy="20" r={RADIUS} />
          <circle className="now-playing-disc__fill" cx="20" cy="20" r={RADIUS}
            strokeDasharray={CIRCLE} strokeDashoffset={CIRCLE * (1 - share)} />
        </svg>
        {cover ? <img src={cover} alt="" /> : <span className="now-playing-disc__nocover" aria-hidden="true"><BsDisc /></span>}
        <span className="now-playing-disc__bars" aria-hidden="true"><NowPlayingBars playing={playing} /></span>
      </span>
      {withWords && (
        <span className="now-playing-disc__words">
          <span className="now-playing-disc__track-title">{track.title}</span>
          <span className="now-playing-disc__artist">{artist}</span>
        </span>
      )}
    </button>
  );
};

export default NowPlayingDisc;
