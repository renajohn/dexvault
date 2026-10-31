import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsPauseFill, BsPlayFill } from 'react-icons/bs';
import { player, usePlayer } from '../services/player';
import { setFullPlayer, useFullPlayer } from '../services/phoneDoor';
import NowPlayingDisc from './NowPlayingDisc';

/** How long the track's words stay unrolled beside the round cover once it changes. */
export const TOLD_MS = 6000;
/** A finger held this long on the round pauses or plays on. */
export const HOLD_MS = 450;
/** A finger that moves this far is not a hold: it scrolls, or draws the full screen up. */
const HOLD_SLACK_PX = 10;

/**
 * What plays, on a phone: its round cover in a drop of glass at the foot of
 * the screen on the left, in place of a pill (PlayerBar.css). A touch, or a
 * finger drawn up, opens the full screen player; a finger held pauses or plays
 * on, ⏸ or ▶ shown in the round a moment. As the track changes, its title and
 * artist unroll beside it a few seconds, then roll back under it, unless the
 * full screen player is open.
 */
const PlayerFold: React.FC = () => {
  const track = usePlayer(state => state.tracks[state.index]);
  const album = usePlayer(state => state.album);
  const playing = usePlayer(state => state.playing);
  const [told, setTold] = useState(false);
  const [glyph, setGlyph] = useState<'pause' | 'play' | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);

  // A new track: its words unroll, and roll back after a while; not while the full screen player
  // shows it already, nor as it closes on a track changed under it.
  const songId = track?.songId;
  const full = useFullPlayer();
  const fullRef = useRef(full);
  fullRef.current = full;
  useEffect(() => {
    if (!songId || fullRef.current) return undefined;
    setTold(true);
    const timer = window.setTimeout(() => setTold(false), TOLD_MS);
    return () => window.clearTimeout(timer);
  }, [songId]);
  useEffect(() => { if (full) setTold(false); }, [full]);

  useEffect(() => {
    if (!glyph) return undefined;
    const timer = window.setTimeout(() => setGlyph(null), 900);
    return () => window.clearTimeout(timer);
  }, [glyph]);

  const letGo = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };

  if (!track || !album) return null;
  const artist = track.artist ?? album.artist;

  return createPortal(
    <div className={`player-fold${told ? ' player-fold--told' : ''}`}
      onContextMenu={event => event.preventDefault()}>
      <div className="player-fold__words" aria-hidden="true">
        <span className="player-fold__track">{track.title}</span>
        <span className="player-fold__from">{`${artist} · ${album.title}`}</span>
      </div>
      <div className="player-fold__drop"
        onPointerDown={event => {
          held.current = false;
          letGo();
          const timer = window.setTimeout(() => {
            hold.current = null;
            held.current = true;
            setGlyph(playing ? 'pause' : 'play');
            navigator.vibrate?.(15);
            player.toggle();
          }, HOLD_MS);
          hold.current = { timer, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={event => {
          const at = hold.current;
          if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > HOLD_SLACK_PX) letGo();
        }}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={letGo}
        // The touch that ends a hold opens nothing.
        onClickCapture={event => {
          if (!held.current) return;
          held.current = false;
          event.stopPropagation();
          event.preventDefault();
        }}>
        <NowPlayingDisc onOpen={() => setFullPlayer(true)} />
        <span className={`player-fold__glyph${glyph ? ' player-fold__glyph--on' : ''}`} aria-hidden="true">
          {glyph === 'pause' ? <BsPauseFill /> : <BsPlayFill />}
        </span>
      </div>
    </div>,
    document.body,
  );
};

export default PlayerFold;
