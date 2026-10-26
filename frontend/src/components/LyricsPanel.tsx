import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsX } from 'react-icons/bs';
import musicService, { type TrackLyrics } from '../services/musicService';
import { player, usePlayer } from '../services/player';
import { lineAt, withinLines, type LyricLine } from '../utils/lrc';
import Button, { IconButton } from './shared/Button';
import { LyricsMenu, TimingDrawer, TryBar } from './LyricsTiming';
import { useLyricsTiming } from './useLyricsTiming';
import { Loading } from './shared/Spinner';
import './LyricsPanel.css';

/** The eye reads a little before the voice sings: a line lights a fifth of a second early. */
const LEAD_SEC = 0.2;
/** Scrolled by hand, the words go back to the song after this long. */
const FOLLOW_AGAIN_MS = 5000;
/** The line sung stands at this height of the panel. */
const ANCHOR = 0.3;

/**
 * The words of the track playing, in a card at the bottom left above the
 * player's bar, on a desktop: the line sung in white, the cover's colours
 * turning slowly behind. A click on a line plays from there. A record's card
 * opens beside it, on the right. It lies on the page's body, as the dialogs
 * do, to stand above a card's shade.
 */
const LyricsPanel: React.FC = () => {
  const open = usePlayer(state => state.lyricsOpen && state.barShown);
  const album = usePlayer(state => state.album);
  const track = usePlayer(state => state.tracks[state.index]);
  const albumId = album?.id ?? null;
  const shown = Boolean(open && album && albumId != null && track);
  const disc = track?.disc;
  const no = track?.no;

  // Undefined while they are looked for, null when they could not be read.
  const [lyrics, setLyrics] = useState<TrackLyrics | null | undefined>(undefined);
  useEffect(() => {
    if (!shown || albumId == null || disc == null || no == null) return undefined;
    let current = true;
    setLyrics(undefined);
    musicService.getLyrics(albumId, disc, no)
      .then(found => { if (current) setLyrics(found); })
      .catch(() => { if (current) setLyrics(null); });
    return () => { current = false; };
  }, [shown, albumId, disc, no]);

  // Fixing the timing: the lines shown are those being moved.
  const timing = useLyricsTiming({ lyrics, setLyrics, albumId, disc, no });
  const { lines, fixing } = timing;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const timed = lines.length > 0;
  const [index, setIndex] = useState(-1);
  const [following, setFollowing] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const offset = useRef(0);
  const followTimer = useRef<number | undefined>(undefined);

  // The line sung, read from the audio at each frame: the bar's position moves a few times a second only.
  // The lines are read as they are: the slider moves them while the song plays.
  useEffect(() => {
    setIndex(-1);
    setFollowing(true);
    offset.current = 0;
    if (!shown || !timed) return undefined;
    let frame = 0;
    const tick = () => {
      setIndex(lineAt(linesRef.current, player.currentTime() + LEAD_SEC));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [shown, timed, lyrics]);

  const moveTo = useCallback((y: number, smooth = true) => {
    offset.current = y;
    const list = listRef.current;
    if (!list) return;
    list.classList.toggle('lyrics-panel-still', !smooth);
    list.style.transform = `translateY(${y}px)`;
  }, []);

  const place = useCallback(() => {
    const box = boxRef.current;
    const line = listRef.current?.children[Math.max(0, index)] as HTMLElement | undefined;
    if (box && line) moveTo(box.clientHeight * ANCHOR - line.offsetTop);
  }, [index, moveTo]);

  useLayoutEffect(() => {
    if (following) place();
  }, [following, place]);

  useEffect(() => {
    if (!following) return undefined;
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [following, place]);

  const followAgain = useCallback(() => {
    window.clearTimeout(followTimer.current);
    setFollowing(true);
  }, []);
  useEffect(() => () => window.clearTimeout(followTimer.current), []);

  // Scrolled by hand, the words stop following the song a while. Not passive: the page must not scroll beneath.
  useEffect(() => {
    const box = boxRef.current;
    if (!shown || !box || !timed) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const lines = listRef.current?.children;
      const first = lines?.[0] as HTMLElement | undefined;
      const last = lines?.[lines.length - 1] as HTMLElement | undefined;
      if (!first || !last) return;
      moveTo(withinLines(offset.current - event.deltaY, box.clientHeight * ANCHOR, first.offsetTop, last.offsetTop), false);
      setFollowing(false);
      window.clearTimeout(followTimer.current);
      followTimer.current = window.setTimeout(() => setFollowing(true), FOLLOW_AGAIN_MS);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [shown, timed, moveTo]);

  if (!shown || !album || !track) return null;

  const playFrom = (line: LyricLine) => {
    player.seek(Math.max(0, line.at - 0.05));
    if (!player.getState().playing) player.toggle(true);
    followAgain();
  };

  const shownLyrics = timing.shown;
  let body: React.ReactNode;
  if (shownLyrics === undefined) {
    body = <Loading className="lyrics-panel-wait">Looking for the words…</Loading>;
  } else if (shownLyrics?.status === 'instrumental') {
    body = <p className="lyrics-panel-none">An instrumental: no words to sing.</p>;
  } else if (lines.length > 0) {
    body = (
      // Read by hand, every line comes clear; back with the song, those far from it blur again.
      <div className={`lyrics-panel-lines${following && !fixing ? '' : ' lyrics-panel-browsing'}`} ref={boxRef}>
        <ol ref={listRef}>
          {lines.map((line, i) => {
            const state = i === index ? ' lyrics-panel-now' : i < index ? ' lyrics-panel-past' : '';
            const far = Math.abs(i - index) > 2 ? ' lyrics-panel-far' : '';
            return line.text === null ? (
              <li key={i} className={`lyrics-panel-silence${state}`} onClick={() => playFrom(line)} aria-label="Instrumental break">
                <i /><i /><i />
              </li>
            ) : (
              <li key={i} className={`${state}${far}`.trim() || undefined} onClick={() => playFrom(line)}
                aria-current={i === index ? 'true' : undefined}>
                {line.text}
              </li>
            );
          })}
        </ol>
        {!following && !fixing && (
          <Button size="sm" className="lyrics-panel-follow" onClick={followAgain}>Back to the song</Button>
        )}
      </div>
    );
  } else if (shownLyrics?.plain) {
    body = (
      <div className="lyrics-panel-untimed">
        <span className="lyrics-panel-tag">Not timed</span>
        {shownLyrics.plain.split('\n').map((line, i) => (line.trim() ? <p key={i}>{line}</p> : <br key={i} />))}
      </div>
    );
  } else if (shownLyrics === null) {
    // Not "no words": they could not be asked for (the server away a moment, say).
    body = <p className="lyrics-panel-none">The words could not be read. Try again in a moment.</p>;
  } else {
    body = <p className="lyrics-panel-none">No words found for this track.</p>;
  }

  return createPortal(
    <aside className="lyrics-panel" aria-label="Lyrics">
      {album.cover && (
        // Two copies of the cover turning against each other, blurred: the panel takes the album's colours.
        <div className="lyrics-panel-cover" key={album.cover} aria-hidden="true">
          <i style={{ backgroundImage: `url("${album.cover}")` }} />
          <i style={{ backgroundImage: `url("${album.cover}")` }} />
        </div>
      )}
      {/* No head: the bar below says the track, its album and its cover already. */}
      <div className="lyrics-panel-actions">
        {lyrics?.status === 'found' && !fixing && !timing.trying && <LyricsMenu timing={timing} canFix={timed} />}
        <IconButton label="Close lyrics" onClick={() => player.showLyrics(false)}><BsX /></IconButton>
      </div>
      {body}
      {fixing && timed && <TimingDrawer timing={timing} songId={track.songId} className="lyrics-panel-fix" />}
      {timing.trying && <TryBar timing={timing} className="lyrics-panel-fix" />}
    </aside>,
    document.body,
  );
};

export default LyricsPanel;
