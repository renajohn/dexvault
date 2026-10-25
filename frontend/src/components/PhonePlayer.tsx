import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BsBoxArrowUpRight, BsChatQuote, BsChatQuoteFill, BsJournalText, BsDisc, BsHeart, BsHeartFill, BsMusicNoteList, BsPauseFill, BsPlayFill,
  BsSkipBackwardFill, BsSkipForwardFill, BsSpeaker, BsThreeDots, BsX,
} from 'react-icons/bs';
import musicService, { type TrackLyrics } from '../services/musicService';
import { useOutputs } from '../services/outputs';
import { localOutputName } from '../services/player';
import Button from './shared/Button';
import Menu from './shared/Menu';
import NowPlayingBars from './shared/NowPlayingBars';
import { Loading } from './shared/Spinner';
import OutputMenu, { OutputVolume } from './OutputMenu';
import { lineAt, parseLrc } from './LyricsPanel';
import { GuideText, readingOf } from './AlbumGuide';
import { MixtapeEntries, NewMixtapeDialog } from './MixtapeMenu';
import './PhonePlayer.css';

const time = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A finger drawn this far down the full screen lets it go back to the pill; up the pill, it opens. */
const SWIPE_CLOSE_PX = 90;
/** A finger moved this far is a drag, not a tap. */
const DRAG_FROM_PX = 8;
const SWIPE_OPEN_PX = 24;
/** The eye reads a little before the voice sings. */
const LEAD_SEC = 0.2;
/** Scrolled by hand, the words go back to the song after this long. */
const FOLLOW_AGAIN_MS = 5000;

/** What ⏮ ⏯ ⏭ and the scrubber do: this browser's player, or a computer's sent from here. */
export interface PhoneControls {
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** None: the place in the track is shown, not moved (a computer far away). */
  seek?: (seconds: number) => void;
  resume?: () => void;
  stop?: () => void;
  /** A track of the album, from its place in it. */
  playTrack?: (index: number) => void;
}

export interface PhonePlayerProps {
  title: string;
  /** Under the title: the artist and the album, or what went wrong. */
  subtitle: string;
  /** Before the subtitle in the pill: where it plays (Salon), when not here. */
  where?: string | null;
  cover: { src: string | null; title: string };
  playing: boolean;
  position: number;
  length: number;
  hasNext: boolean;
  controls: PhoneControls;
  /** The track's ♥; none for a computer far away. */
  favourite?: { on: boolean; toggle: () => void } | null;
  /** The appliance it plays on, for its volume; null on this iPhone. */
  outputId?: string | null;
  away?: boolean;
  /** The appliance plays something else: its name, and Resume. */
  taken?: string | null;
  /** The track after this one, and what is left to hear, with what of. */
  following?: { title: string; artist: string } | null;
  left?: string | null;
  from: string;
  /** The words of the track, for an album DexVault holds. */
  lyricsOf?: { albumId: number; disc: number; no: number } | null;
  /** The album whose listening guide can be read, for an album DexVault holds. */
  guideOf?: number | null;
  /** The album's tracks, the one playing at `index`. */
  tracks?: { title: string; durationSec: number | null }[];
  index?: number;
  onOpen?: (() => void) | null;
  onOpenMixtape?: { title: string; open: () => void } | null;
  /** The track playing, to put in a mixtape from ⋯; none for a computer far away. */
  mixtape?: { songId: string; title: string } | null;
  /** The album in Amperfy, which plays it from the start; this player stops. */
  onAmperfy?: (() => void) | null;
  /** Listen Next's albums and their tracks, in a dialog. */
  onAllTracks?: (() => void) | null;
  /** At the foot of the full screen, in place of the output: the computer spoken to. */
  foot?: React.ReactNode;
  /** Out of sight (the bar slid away): the full screen goes back to the pill. */
  out: boolean;
}

/**
 * The place in the track, under the cover: a line to tap or to draw along,
 * its dot following the finger, the music going there once it is let go;
 * ← → step 10 s.
 */
const Scrubber: React.FC<{ position: number; length: number; playing: boolean; seek?: (seconds: number) => void }> = ({ position, length, playing, seek }) => {
  const [held, setHeld] = useState<number | null>(null);
  const line = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const box = line.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * length;
  };
  const shown = held ?? position;
  const share = length > 0 ? Math.min(100, (shown / length) * 100) : 0;
  return (
    <div className="now-playing-seek">
      <div ref={line} className={`now-playing-scrubber${playing ? '' : ' now-playing-scrubber--paused'}${held != null ? ' now-playing-scrubber--held' : ''}`}
        role="slider" tabIndex={seek ? 0 : -1} aria-label="Position in the track" aria-readonly={!seek}
        aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(shown)} aria-valuetext={`${time(shown)} of ${time(length)}`}
        onPointerDown={event => {
          if (length <= 0 || !seek) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setHeld(at(event.clientX));
        }}
        onPointerMove={event => { if (held != null) setHeld(at(event.clientX)); }}
        onPointerUp={event => {
          if (held == null) return;
          seek!(at(event.clientX));
          setHeld(null);
        }}
        onPointerCancel={() => setHeld(null)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight') seek?.(position + 10);
          if (event.key === 'ArrowLeft') seek?.(position - 10);
        }}>
        <span className="now-playing-scrubber__fill" style={{ width: `${share}%` }} />
        <span className="now-playing-scrubber__dot" style={{ left: `${share}%` }} />
      </div>
      <div className="now-playing-times">
        <span>{time(shown)}</span>
        <span>-{time(Math.max(0, length - shown))}</span>
      </div>
    </div>
  );
};

/**
 * The words of the track, large, in place of the cover: the line sung in
 * white, those sung and to sing dimmed, following the song; scrolled by hand
 * they wait a while, and a tap on a line plays from there.
 */
const Lyrics: React.FC<{ of: { albumId: number; disc: number; no: number }; position: number; seek?: (seconds: number) => void }> = ({ of, position, seek }) => {
  // Undefined while they are looked for, null when they could not be read.
  const [lyrics, setLyrics] = useState<TrackLyrics | null | undefined>(undefined);
  const { albumId, disc, no } = of;
  useEffect(() => {
    let current = true;
    setLyrics(undefined);
    musicService.getLyrics(albumId, disc, no)
      .then(found => { if (current) setLyrics(found); })
      .catch(() => { if (current) setLyrics(null); });
    return () => { current = false; };
  }, [albumId, disc, no]);

  const lines = useMemo(() => (lyrics?.synced ? parseLrc(lyrics.synced) : []), [lyrics]);
  const index = lineAt(lines, position + LEAD_SEC);
  const box = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The line sung a third of the way down, measured from the top of the words (the box holds its lines' offsets).
  useLayoutEffect(() => {
    const list = box.current;
    const line = list?.querySelector<HTMLElement>(`[data-line="${Math.max(0, index)}"]`);
    if (!following || !list || !line) return;
    list.scrollTo({ top: line.offsetTop - list.clientHeight * 0.35, behavior: 'smooth' });
  }, [index, following, lines]);

  const byHand = () => {
    setFollowing(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFollowing(true), FOLLOW_AGAIN_MS);
  };

  if (lyrics === undefined) return <div className="now-playing-lyrics now-playing-lyrics--note"><Loading>Looking for the words…</Loading></div>;
  if (lyrics?.status === 'instrumental') return <p className="now-playing-lyrics now-playing-lyrics--note">An instrumental: no words to sing.</p>;
  if (lines.length === 0 && !lyrics?.plain) return <p className="now-playing-lyrics now-playing-lyrics--note">No words found for this track.</p>;

  return (
    <div ref={box} className={`now-playing-lyrics now-playing-scroll${following ? '' : ' now-playing-lyrics--browsing'}`}
      onTouchStart={byHand} onWheel={byHand}>
      {lines.length > 0 ? (
        <ol>
          {lines.map((line, i) => (
            <li key={i} data-line={i} className={i === index ? 'now-playing-lyrics__now' : i < index ? 'now-playing-lyrics__past' : undefined}
              onClick={() => { if (seek) { seek(Math.max(0, line.at - 0.05)); setFollowing(true); } }}>
              {line.text ?? <span className="now-playing-lyrics__pause" aria-label="Instrumental break">• • •</span>}
            </li>
          ))}
        </ol>
      ) : (
        <div className="now-playing-lyrics__plain">
          {lyrics!.plain!.split('\n').map((line, i) => (line.trim() ? <p key={i}>{line}</p> : <br key={i} />))}
        </div>
      )}
    </div>
  );
};

type View = 'cover' | 'lyrics' | 'guide' | 'tracks';

/**
 * The player on a phone, as the phone's own music player has it: a pill
 * floating at the foot of the screen (the cover, the track, ⏯ ⏭), which a
 * tap or a finger drawn up opens full screen. There, the cover large, the
 * track, its ♥ and ⋯, the place in the track, ⏮ ⏯ ⏭, the volume; at the
 * foot the words, the output and the tracks, the words and the tracks taking
 * the cover's place, which goes small at the top. The handle, a finger drawn
 * down or Escape make it a pill again.
 */
const PhonePlayer: React.FC<PhonePlayerProps> = props => {
  const { cover, playing, position, length, hasNext, controls, favourite, away = false, taken = null } = props;
  const [full, setFull] = useState(false);
  const [view, setView] = useState<View>('cover');
  // A new mixtape for the track, its name asked over the full screen.
  const [naming, setNaming] = useState<{ songId: string; title: string } | null>(null);
  // A finger drawing the full screen down: where it started, and whether it has moved enough to be a drag.
  const start = useRef<{ y: number; at: number; dragging: boolean } | null>(null);
  const frame = useRef(0);
  // A drag just ended over a button: its click is not a tap.
  const dragged = useRef(false);
  const pillStart = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pillButton = useRef<HTMLButtonElement>(null);
  const outputs = useOutputs();
  const renderer = outputs.find(one => one.id === props.outputId) ?? null;
  const hasLyrics = Boolean(props.lyricsOf);
  const hasTracks = Boolean(props.tracks && props.tracks.length > 0);
  // The album's listening guide, read as the album starts: its button shows only when there is one.
  const [guide, setGuide] = useState<string | null>(null);
  const guideOf = props.guideOf ?? null;
  useEffect(() => {
    setGuide(null);
    if (guideOf == null) return undefined;
    let current = true;
    musicService.getAlbumGuide(guideOf)
      .then(found => { if (current) setGuide(found?.text ? readingOf(found.text) : null); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [guideOf]);

  useEffect(() => { if (!props.out) setFull(false); }, [props.out]);
  // A view the track playing has not (no words for a computer far away): back to the cover.
  useEffect(() => {
    if ((view === 'lyrics' && !hasLyrics) || (view === 'tracks' && !hasTracks) || (view === 'guide' && !guide)) setView('cover');
  }, [view, hasLyrics, hasTracks, guide]);

  // A finger drawn on the pill or the full screen never scrolls the page under them: iOS's Safari scrolls it
  // through a fixed layer whatever its touch-action, unless the move is refused. A slider and a list keep their own.
  const pillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      if (!(event.target instanceof Element && event.target.closest('input, .now-playing-scroll'))) event.preventDefault();
    };
    const layers = [pillRef.current, sheetRef.current].filter((one): one is HTMLDivElement => one != null);
    layers.forEach(layer => layer.addEventListener('touchmove', hold, { passive: false }));
    return () => layers.forEach(layer => layer.removeEventListener('touchmove', hold));
  }, []);

  // Open, Escape closes it, and the focus goes into it (not on a button, whose tooltip would show); closed, back to the pill.
  // The body is left alone: the page under it holds still by its refused moves, and a record's card (Bootstrap)
  // sets and gives back the body's overflow itself, which a second hand on it left stuck, the page no longer scrolling.
  useEffect(() => {
    if (!full) return undefined;
    sheetRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      // A menu or a dialog over it takes its own Escape.
      if (event.key === 'Escape' && !document.querySelector('.modal.show, .menu-surface')) setFull(false);
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.now-playing')) {
        pillButton.current?.focus({ preventScroll: true });
      }
    };
  }, [full]);

  const leave = (then: () => void) => { setFull(false); then(); };
  const toggleView = (next: View) => setView(current => (current === next ? 'cover' : next));

  // A finger drawn down from anywhere, the cover and the buttons too, but the scrubber, the volume and a list.
  // The sheet follows it straight, frame by frame, without React: a render at each move made it lag.
  const place = (dy: number | null) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      sheet.classList.toggle('now-playing--drag', dy != null);
      sheet.style.transform = dy != null ? `translateY(${dy}px)` : '';
    });
  };
  const grab = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, [role="slider"], .output-volume, .now-playing-scroll')) return;
    start.current = { y: event.clientY, at: event.timeStamp, dragging: false };
  };
  const pull = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (!from) return;
    const dy = event.clientY - from.y;
    if (!from.dragging) {
      if (dy < DRAG_FROM_PX) return;
      from.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    place(Math.max(0, dy));
  };
  const letGo = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    if (!from?.dragging) return;
    const dy = event.clientY - from.y;
    // Drawn far enough, or flicked.
    const fast = dy > 30 && dy / Math.max(1, event.timeStamp - from.at) > 0.5;
    dragged.current = true;
    window.setTimeout(() => { dragged.current = false; }, 0);
    place(null);
    if (dy > SWIPE_CLOSE_PX || fast) setFull(false);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const share = length > 0 ? Math.min(100, (position / length) * 100) : 0;

  const playButton = (big: boolean) => (
    <button type="button" className={`player-bar-button${big ? ' now-playing-play' : ' player-pill-play'}`}
      onClick={controls.toggle} aria-label={playing ? 'Pause' : 'Play'}>
      {playing ? <BsPauseFill aria-hidden="true" /> : <BsPlayFill aria-hidden="true" />}
    </button>
  );

  const heart = favourite && (
    <button type="button" className={`player-bar-button now-playing-favourite${favourite.on ? ' now-playing-favourite--on' : ''}`}
      onClick={favourite.toggle} aria-pressed={favourite.on}
      aria-label={favourite.on ? 'Remove from the favourites' : 'Add to the favourites'}>
      {favourite.on ? <BsHeartFill aria-hidden="true" /> : <BsHeart aria-hidden="true" />}
    </button>
  );

  const more = (
    <Menu drop="down" align="end" label="More" className="output-menu" trigger={triggerProps => (
      <button type="button" {...triggerProps} className="player-bar-button now-playing-more" aria-label="More"><BsThreeDots aria-hidden="true" /></button>
    )}>
      <Menu.Section title={`Playing from ${props.from}`} />
      {props.onOpen && <Menu.Item icon={<BsDisc />} onSelect={() => leave(props.onOpen!)}>Open {cover.title}</Menu.Item>}
      {props.onOpenMixtape && <Menu.Item icon={<BsDisc />} onSelect={() => leave(props.onOpenMixtape!.open)}>Open {props.onOpenMixtape.title}</Menu.Item>}
      {props.onAllTracks && <Menu.Item icon={<BsMusicNoteList />} onSelect={props.onAllTracks}>Listen Next's tracks…</Menu.Item>}
      {props.onAmperfy && <Menu.Item icon={<BsBoxArrowUpRight />} onSelect={() => leave(props.onAmperfy!)}>Open in Amperfy</Menu.Item>}
      {props.mixtape && (
        <>
          <Menu.Separator />
          <MixtapeEntries songIds={[props.mixtape.songId]} title={props.mixtape.title} onNew={() => setNaming(props.mixtape!)} />
        </>
      )}
      {controls.stop && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<BsX />} onSelect={() => leave(controls.stop!)}>Stop</Menu.Item>
        </>
      )}
    </Menu>
  );

  const words = (
    <div className="now-playing-words">
      <span className="now-playing-track">{props.title}</span>
      <span className="now-playing-artist">{props.subtitle}</span>
    </div>
  );

  const tracksList = hasTracks && (
    <div className="now-playing-tracks now-playing-scroll">
      {(props.following || props.left) && (
        <p className="now-playing-tracks__ahead">
          {props.following && <>Up next: <b>{props.following.title}</b>{props.following.artist && <> · {props.following.artist}</>}</>}
          {props.following && props.left && <br />}
          {props.left}
        </p>
      )}
      <ol>
        {props.tracks!.map((one, i) => (
          <li key={i}>
            <button type="button" className={`now-playing-tracks__track${i === props.index ? ' now-playing-tracks__track--now' : ''}`}
              disabled={!controls.playTrack} onClick={() => controls.playTrack?.(i)} aria-current={i === props.index ? 'true' : undefined}>
              <span className="now-playing-tracks__no">{i === props.index ? <NowPlayingBars playing={playing} /> : i + 1}</span>
              <span className="now-playing-tracks__title">{one.title}</span>
              <span className="now-playing-tracks__time">{one.durationSec ? time(one.durationSec) : ''}</span>
            </button>
          </li>
        ))}
      </ol>
      {props.onAllTracks && (
        <Button variant="quiet" size="sm" icon={<BsMusicNoteList />} onClick={props.onAllTracks}>All of Listen Next…</Button>
      )}
    </div>
  );

  const sheet = (
    <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Now playing" aria-hidden={!full} inert={!full}
      className={`now-playing now-playing--${view}${full ? ' now-playing--open' : ''}${away ? ' now-playing--away' : ''}`}
      onPointerDown={grab} onPointerMove={pull} onPointerUp={letGo} onPointerCancel={() => { start.current = null; place(null); }}
      onClickCapture={event => { if (dragged.current) { event.stopPropagation(); event.preventDefault(); } }}>
      {/* The cover again, blurred, under it all: each album its own light. */}
      <div className="now-playing-backdrop" aria-hidden="true">{cover.src && <img src={cover.src} alt="" />}</div>
      <div className="now-playing-inner">
        {/* The handle: a tap, as a finger drawn down from anywhere, makes it a pill again. */}
        <button type="button" className="now-playing-handle" onClick={() => setFull(false)} aria-label="Back to the pill"><span /></button>

        {view === 'cover' ? (
          <>
            {/* The cover only shows: its card is in ⋯. */}
            <div className={`now-playing-cover${playing ? '' : ' now-playing-cover--paused'}`}>
              {cover.src ? <img src={cover.src} alt="" /> : <span className="now-playing-nocover" aria-hidden="true" />}
            </div>
            <div className="now-playing-title">{words}{heart}{more}</div>
          </>
        ) : (
          <>
            {/* The cover gone small at the top, the words or the tracks under it. */}
            <div className="now-playing-title now-playing-title--small">
              <button type="button" className="now-playing-thumb" onClick={() => setView('cover')} aria-label="Back to the cover">
                {cover.src ? <img src={cover.src} alt="" /> : <span className="now-playing-nocover" aria-hidden="true" />}
              </button>
              {words}{heart}{more}
            </div>
            {view === 'lyrics' && props.lyricsOf && <Lyrics of={props.lyricsOf} position={position} seek={controls.seek} />}
            {view === 'guide' && guide && (
              <div className="now-playing-guide now-playing-scroll"><GuideText text={guide} /></div>
            )}
            {view === 'tracks' && tracksList}
          </>
        )}

        <Scrubber position={position} length={length} playing={playing} seek={controls.seek} />

        {taken ? (
          // The appliance plays something else: Resume takes it back at the same place.
          <div className="now-playing-taken">
            <span>{taken} is playing something else</span>
            <Button icon={<BsPlayFill />} onClick={controls.resume}>Resume</Button>
          </div>
        ) : (
          <div className="now-playing-transport">
            <button type="button" className="player-bar-button now-playing-step" onClick={controls.previous} aria-label="Previous">
              <BsSkipBackwardFill aria-hidden="true" />
            </button>
            {playButton(true)}
            <button type="button" className="player-bar-button now-playing-step" onClick={controls.next} disabled={!hasNext} aria-label="Next">
              <BsSkipForwardFill aria-hidden="true" />
            </button>
          </div>
        )}

        {/* An appliance's volume, under its ceiling. This iPhone's is its own buttons': a page cannot set it. */}
        {renderer && <div className="now-playing-volume"><OutputVolume output={renderer} slim /></div>}

        {/* Where it plays, over the buttons: "Playing on" and the output's name, which opens the outputs to change it. */}
        {!props.foot && outputs.length > 0 && (
          <p className="now-playing-where">
            Playing on{' '}
            <OutputMenu drop="up" align="start" volume={false} trigger={(triggerProps, open) => (
              <button type="button" {...triggerProps} aria-label={`Output: ${props.where || localOutputName()}`}
                className={`now-playing-where__output${props.where ? ' now-playing-where__output--away' : ''}${open ? ' now-playing-where__output--open' : ''}`}>
                {props.where || localOutputName()}
              </button>
            )} />
          </p>
        )}

        {/* The words, the guide, the tracks: as many even columns as there are, each centred in its own. */}
        <footer className="now-playing-foot">
          {hasLyrics && (
            <button type="button" className={`player-bar-button now-playing-tool${view === 'lyrics' ? ' now-playing-tool--on' : ''}`}
              onClick={() => toggleView('lyrics')} aria-pressed={view === 'lyrics'} aria-label="Lyrics">
              {view === 'lyrics' ? <BsChatQuoteFill aria-hidden="true" /> : <BsChatQuote aria-hidden="true" />}
            </button>
          )}
          {guide && (
            <button type="button" className={`player-bar-button now-playing-tool${view === 'guide' ? ' now-playing-tool--on' : ''}`}
              onClick={() => toggleView('guide')} aria-pressed={view === 'guide'} aria-label="Listening guide">
              <BsJournalText aria-hidden="true" />
            </button>
          )}
          {props.foot}
          {hasTracks && (
            <button type="button" className={`player-bar-button now-playing-tool${view === 'tracks' ? ' now-playing-tool--on' : ''}`}
              onClick={() => toggleView('tracks')} aria-pressed={view === 'tracks'} aria-label="Tracks">
              <BsMusicNoteList aria-hidden="true" />
            </button>
          )}
        </footer>
      </div>
    </div>
  );

  return (
    <>
      <div ref={pillRef} className="player-pill"
        onPointerDown={event => { pillStart.current = event.clientY; }}
        onPointerUp={event => {
          if (pillStart.current != null && pillStart.current - event.clientY > SWIPE_OPEN_PX) setFull(true);
          pillStart.current = null;
        }}>
        <button ref={pillButton} type="button" className="player-pill-open" onClick={() => setFull(true)} aria-label="Full screen player" aria-expanded={full}>
          {cover.src ? <img src={cover.src} alt="" /> : <span className="player-pill-nocover" aria-hidden="true" />}
          <span className="player-pill-words">
            <span className="player-pill-track">{props.title}</span>
            <span className="player-pill-from">
              {!away && props.where && <><BsSpeaker aria-hidden="true" /> {props.where} · </>}
              {props.subtitle}
            </span>
          </span>
        </button>
        {taken ? (
          <Button size="sm" icon={<BsPlayFill />} onClick={controls.resume}>Resume</Button>
        ) : (
          <>
            {playButton(false)}
            <button type="button" className="player-bar-button player-pill-next" onClick={controls.next} disabled={!hasNext} aria-label="Next">
              <BsSkipForwardFill aria-hidden="true" />
            </button>
          </>
        )}
        <span className={`player-pill-progress${playing ? '' : ' player-pill-progress--paused'}`} aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </span>
      </div>
      {createPortal(sheet, document.body)}
      {naming && <NewMixtapeDialog songIds={[naming.songId]} title={naming.title} onClose={() => setNaming(null)} />}
    </>
  );
};

export default PhonePlayer;
