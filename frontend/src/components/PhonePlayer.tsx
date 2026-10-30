import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BsBoxArrowUpRight, BsCassetteFill, BsChatQuote, BsChatQuoteFill, BsHeadphones, BsInfoCircle, BsJournalText, BsDisc, BsHeart, BsHeartFill, BsMusicNoteList, BsPauseFill, BsPlayFill,
  BsSkipBackwardFill, BsSkipForwardFill, BsSpeaker, BsThreeDots, BsX,
} from 'react-icons/bs';
import { infoShownAsAsked, setFullPlayer, tracksShownAsAsked, useFullPlayer, useInfoAsked, useTracksAsked, type ShownAlbum } from '../services/phoneDoor';
import AlbumInfo from './AlbumInfo';
import musicService, { type TrackLyrics } from '../services/musicService';
import { useOutputs } from '../services/outputs';
import { localOutputName } from '../services/player';
import Button from './shared/Button';
import Menu from './shared/Menu';
import { AlbumStarRating } from './RecordStarRating';
import { playingTime } from '../utils/albumHead';
import NowPlayingBars from './shared/NowPlayingBars';
import { Loading } from './shared/Spinner';
import OutputMenu, { OutputVolume } from './OutputMenu';
import { lineAt, type LyricLine } from '../utils/lrc';
import { LyricsMenu, TimingDrawer, TryBar } from './LyricsTiming';
import { useLyricsTiming } from './useLyricsTiming';
import { GuideText, readingOf } from './AlbumGuide';
import { MixtapeEntries, NewMixtapeDialog } from './MixtapeMenu';
import type { AlbumActions, DiscHead } from './useAlbumAtRest';
import { seedFavourite, setFavourite, useFavourite } from '../services/favourites';
import { readStored, writeStored } from '../utils/safeStorage';
import SwipeRow from './SwipeRow';
import toast from './shared/Toast';
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
  /** What is left to hear, with what of: over the tracks, in place of their count and length. */
  left?: string | null;
  /** The album whose owner's stars show over its tracks; none for a mixtape or a computer far away. */
  starsOf?: number | string | null;
  from: string;
  /** The words of the track, for an album DexVault holds. */
  lyricsOf?: { albumId: number; disc: number; no: number } | null;
  /** The track playing in this browser's player, whose words' timing can be fixed here; none for a computer far away. */
  timingSongId?: string | null;
  /** The album whose listening guide can be read, for an album DexVault holds. */
  guideOf?: number | null;
  /**
   * The album playing, for DexVault: its hearts read again from Navidrome as its
   * tracks are shown, those the tracks came with being of the moment it started.
   */
  heartsOf?: number | null;
  /** The album's tracks, the one playing at `index`; a song of Navidrome's slides: its ♥, its mixtapes. */
  tracks?: PhoneTrack[];
  index?: number;
  /** The album DexVault holds, for the info view the (i) opens in place of the tracks; none for a computer far away. */
  infoOf?: { albumId: number; known?: ShownAlbum | null } | null;
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
  /** What is heard: Lossless, AAC 256, MP3…, between the two times under the line. */
  format?: string | null;
  /**
   * An album a cover opened, at rest while another plays or nothing does: its
   * line (CD · 12 tracks · 45 min) where the place in the track would be, ▶
   * alone; grey when there is nothing to play (a CD not ripped).
   */
  rest?: { albumId: number | string; line: React.ReactNode; playable?: boolean } | null;
  /** The album's own entries of ⋯ (Listen Next, mixtapes) and its discs' heads, at rest or playing; none for a mixtape or a computer far away. */
  album?: AlbumActions | null;
  /** At the left of the foot: the disc of what plays, the album shown being another; or, back on what plays, the album left. */
  door?: React.ReactNode;
}

/**
 * The place in the track, under the cover: a line to tap or to draw along,
 * its dot following the finger, the music going there once it is let go;
 * ← → step 10 s.
 */
const Scrubber: React.FC<{ position: number; length: number; playing: boolean; seek?: (seconds: number) => void; format?: string | null }> = ({ position, length, playing, seek, format }) => {
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
        onPointerCancel={() => {
          // Taken by the system (Safari's swipe back from the left edge): the music still goes where the finger was.
          if (held != null) seek!(held);
          setHeld(null);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowRight') seek?.(position + 10);
          if (event.key === 'ArrowLeft') seek?.(position - 10);
        }}>
        <span className="now-playing-scrubber__fill" style={{ width: `${share}%` }} />
        <span className="now-playing-scrubber__dot" style={{ left: `${share}%` }} />
      </div>
      <div className="now-playing-times">
        <span>{time(shown)}</span>
        {format && <span className="now-playing-format" title={format === 'AAC 256' ? 'The lighter file, for a weak network' : undefined}>{format}</span>}
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
const Lyrics: React.FC<{ lyrics: TrackLyrics | null | undefined; lines: LyricLine[]; position: number; seek?: (seconds: number) => void }> = ({ lyrics, lines, position, seek }) => {
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
  if (lyrics === null) return <p className="now-playing-lyrics now-playing-lyrics--note">The words could not be read. Try again in a moment.</p>;
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

/** A line of the player's tracks: its song in Navidrome, hearted there when read, one of the album's most listened. */
export interface PhoneTrack {
  title: string;
  durationSec: number | null;
  /** The disc it is on: an album of several shows each under its head. */
  disc?: number;
  songId?: string;
  starred?: boolean;
  popular?: boolean;
}

/** Set once the first line has shown, on a phone, that the tracks slide. */
const SWIPE_HINT_KEY = 'dexvault-player-tracks-swipe-hint';

/**
 * A line of the player's tracks: a touch plays it, the track playing does
 * nothing; the grey dot of the Mac before the number of a track most listened
 * to, a small gold ♥ by its length when it is a favourite. Slid to the right,
 * let go, it opens the mixtapes; slid to the left, let go, it gives or takes
 * its ♥ (docs/superpowers/specs/2026-10-27-fav-et-populaire).
 */
const TrackLine: React.FC<{ track: PhoneTrack; no: number; now: boolean; playing: boolean; play?: () => void; hint: boolean; onNewMixtape: () => void }> = ({ track, no, now, playing, play, hint, onNewMixtape }) => {
  const favourite = useFavourite(track.songId);
  const [menu, setMenu] = useState(false);
  const songId = track.songId;
  const toggleFavourite = () => {
    if (songId) setFavourite(songId, !favourite).catch(error => toast(`Could not change the favourite: ${(error as Error).message}`, { tone: 'danger' }));
  };
  const line = (props?: React.ComponentProps<'button'>) => (
    <button type="button" {...props} className={`now-playing-tracks__track${now ? ' now-playing-tracks__track--now' : ''}${menu ? ' now-playing-tracks__track--held' : ''}`}
      disabled={!play} onClick={menu ? () => setMenu(false) : now ? undefined : play} aria-current={now ? 'true' : undefined}>
      <span className="now-playing-tracks__no">
        {track.popular && <span className="now-playing-tracks__popular" title="One of the album's most listened tracks"><span className="visually-hidden">Popular: </span></span>}
        {now ? <NowPlayingBars playing={playing} /> : no}
      </span>
      <span className="now-playing-tracks__title">{track.title}</span>
      {favourite && <BsHeartFill className="now-playing-tracks__favourite" aria-label="Favourite" />}
      <span className="now-playing-tracks__time">{track.durationSec ? time(track.durationSec) : ''}</span>
    </button>
  );
  if (!songId) return <li>{line()}</li>;
  return (
    <SwipeRow as="li" enabled hint={hint}
      deed={{ label: 'Mixtape', icon: <BsCassetteFill />, onSelect: () => setMenu(true), tone: 'plain' }}
      leftDeed={{ label: favourite ? 'Not favourite' : 'Favourite', icon: favourite ? <BsHeart /> : <BsHeartFill />, onSelect: toggleFavourite, tone: 'gold' }}>
      <Menu open={menu} onOpenChange={setMenu} label={track.title} trigger={props => line(props as unknown as React.ComponentProps<'button'>)}>
        <MixtapeEntries songIds={[songId]} title={track.title} onNew={onNewMixtape} />
      </Menu>
    </SwipeRow>
  );
};

/** Set once the first disc's head has shown, on a phone, that it slides. */
const DISC_SWIPE_HINT_KEY = 'dexvault-player-disc-swipe-hint';

/**
 * The head of a disc, over its tracks, for an album of several: "Disc 2 ·
 * 4 tracks · 47 min", and a small headphones at its end when the disc is in
 * Listen Next (gold, streamed; the disc, silver, from the CD). A touch opens
 * its menu, with its list (streamed, from the CD, out) and its mixtapes; slid
 * to the left as a track's line, let go, the disc goes in Listen Next
 * (streamed) or out.
 */
const DiscHeadLine: React.FC<{ number: number; tracks: PhoneTrack[]; head: DiscHead | null; hint: boolean }> = ({ number, tracks, head, hint }) => {
  const [menu, setMenu] = useState(false);
  const summary = [
    `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`,
    playingTime(tracks.reduce((sum, one) => sum + (one.durationSec || 0), 0)) || null,
  ].filter(Boolean).join(' · ');
  const line = (props?: React.ComponentProps<'button'>) => (
    <button type="button" {...props} className={`now-playing-disc-head${menu ? ' now-playing-disc-head--held' : ''}`}
      onClick={head ? () => setMenu(open => !open) : undefined}
      aria-label={`Disc ${number} · ${summary}${head?.on ? `, in Listen Next${head.medium === 'cd' ? ' from the CD' : ''}` : ''}`}>
      <span className="now-playing-disc-head__words" aria-hidden="true"><b>Disc {number}</b> · {summary}</span>
      {head?.on && (
        <span className={`now-playing-disc-head__mark now-playing-disc-head__mark--${head.medium ?? 'digital'}`} aria-hidden="true">
          {head.medium === 'cd' ? <BsDisc /> : <BsHeadphones />}
        </span>
      )}
    </button>
  );
  if (!head) return <li className="now-playing-disc-head__line">{line()}</li>;
  // In: out (the whole album there, this disc alone instead); out: in, streamed, or from the CD for a CD with no rip.
  const cd = head.on ? head.medium === 'cd' : head.plainMedium === 'cd';
  return (
    <SwipeRow as="li" enabled hint={hint} className="now-playing-disc-head__line"
      leftDeed={{ label: head.on ? 'Take out' : 'Listen Next', icon: cd ? <BsDisc /> : <BsHeadphones />, onSelect: head.toggle, tone: 'gold' }}>
      <Menu open={menu} onOpenChange={setMenu} label={`Disc ${number}`} trigger={props => line(props as unknown as React.ComponentProps<'button'>)}>
        {head.menu}
      </Menu>
    </SwipeRow>
  );
};

type View = 'cover' | 'lyrics' | 'guide' | 'tracks' | 'info';

/**
 * The player on a phone, as the phone's own music player has it: a pill
 * floating at the foot of the screen (the cover, the track, ⏯ ⏭), which a
 * tap or a finger drawn up opens full screen. There, the cover large, the
 * track, its ♥ and ⋯, the place in the track, ⏮ ⏯ ⏭, the volume; at the
 * foot the words, the output and the tracks, the words and the tracks taking
 * the cover's place, which goes small at the top. The handle, a finger drawn
 * down or Escape make it a pill again. A cover touched in MusicDex opens it
 * on that album, at rest while another plays or nothing does (`rest`): ▶
 * plays it, a track from its tracks, and the disc of what plays, at the
 * left of the foot, goes back to it, the album left taking its place there
 * to come back to.
 */
const PhonePlayer: React.FC<PhonePlayerProps> = props => {
  const { cover, playing, position, length, hasNext, controls, favourite, away = false, taken = null } = props;
  // Shared: the disc at the foot of a music window opens it too (services/phoneDoor).
  const full = useFullPlayer();
  const setFull = setFullPlayer;
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
  // What Navidrome said of the tracks' hearts as they were read, unless a heart is known better already.
  useEffect(() => { props.tracks?.forEach(track => seedFavourite(track.songId, track.starred, true)); }, [props.tracks]);
  // Its tracks shown: Navidrome's hearts of now. A session started on the Salon an hour ago, a heart given since
  // from the Mac or Amperfy, still said none.
  const heartsOf = props.heartsOf ?? null;
  const tracksShown = full && view === 'tracks';
  useEffect(() => {
    if (!tracksShown || heartsOf == null) return undefined;
    let current = true;
    musicService.getNavidromeTracks(heartsOf)
      .then(rip => { if (current) rip?.tracks.forEach(file => seedFavourite(file.id, file.starred)); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [tracksShown, heartsOf]);
  // The album's stars over its tracks: read again from Navidrome as they are shown (given in Amperfy since).
  const starsOf = props.starsOf ?? null;
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => { setStars(null); }, [starsOf]);
  useEffect(() => {
    if (!tracksShown || starsOf == null) return undefined;
    let current = true;
    musicService.syncAlbumRating(starsOf)
      .then(({ userRating }) => { if (current) setStars(userRating ?? null); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [tracksShown, starsOf]);
  const rate = (next: number) => {
    if (starsOf == null) return;
    const before = stars;
    setStars(next || null);
    musicService.setAlbumRating(starsOf, next)
      .then(({ userRating }) => setStars(userRating ?? null))
      .catch(error => { setStars(before); toast(`The stars were not kept: ${(error as Error).message}`, { tone: 'danger' }); });
  };
  const trackCount = props.tracks?.length ?? 0;
  const summary = [
    trackCount > 0 ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}` : null,
    playingTime(props.tracks?.reduce((sum, one) => sum + (one.durationSec || 0), 0) ?? 0) || null,
  ].filter(Boolean).join(' · ');
  // The album's listening guide, read as the album starts: its button shows only when there is one.
  const [guide, setGuide] = useState<string | null>(null);
  // The words of the track, read as they are shown; fixing their timing works on them in place of the controls.
  // Undefined while they are looked for, null when they could not be read.
  const [lyrics, setLyrics] = useState<TrackLyrics | null | undefined>(undefined);
  const lyricsAlbum = props.lyricsOf?.albumId;
  const lyricsDisc = props.lyricsOf?.disc;
  const lyricsNo = props.lyricsOf?.no;
  const wordsShown = view === 'lyrics' && lyricsAlbum != null;
  useEffect(() => {
    if (!wordsShown || lyricsAlbum == null || lyricsDisc == null || lyricsNo == null) return undefined;
    let current = true;
    setLyrics(undefined);
    musicService.getLyrics(lyricsAlbum, lyricsDisc, lyricsNo)
      .then(found => { if (current) setLyrics(found); })
      .catch(() => { if (current) setLyrics(null); });
    return () => { current = false; };
  }, [wordsShown, lyricsAlbum, lyricsDisc, lyricsNo]);
  const timing = useLyricsTiming({ lyrics, setLyrics, albumId: lyricsAlbum, disc: lyricsDisc, no: lyricsNo });
  const canFix = wordsShown && Boolean(props.timingSongId) && Boolean(controls.seek) && timing.lines.length > 0;
  const fixing = timing.fixing && canFix;
  // Away from the words, or the full screen closed: the fixing, or a version being tried, is let go, unsaved.
  const { cancel: cancelFixing, revertTry } = timing;
  useEffect(() => { if (timing.fixing && (!canFix || !full)) cancelFixing(); }, [timing.fixing, canFix, full, cancelFixing]);
  const trying = Boolean(timing.trying) && wordsShown;
  useEffect(() => { if (timing.trying && (!wordsShown || !full)) revertTry(); }, [timing.trying, wordsShown, full, revertTry]);
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
  // Another album at rest starts on its cover (its tracks once read, below, when a cover opened it); played from its tracks, it stays on them.
  const restId = props.rest?.albumId ?? null;
  const tracksAsked = useTracksAsked();
  const infoAsked = useInfoAsked();
  useEffect(() => { if (restId != null && !tracksAsked && !infoAsked) setView('cover'); }, [restId]); // eslint-disable-line react-hooks/exhaustive-deps
  // An album opened on its info (one with no CD, from Buy or the wish list).
  const hasInfo = Boolean(props.infoOf);
  useLayoutEffect(() => {
    if (!full || !infoAsked || !hasInfo) return;
    setView('info');
    infoShownAsAsked();
  }, [full, infoAsked, hasInfo, restId]);
  // A cover touched opens straight on its tracks, before it is first painted, never on the cover first:
  // they fill in as they are read. The tracks button, on, takes them away.
  useLayoutEffect(() => {
    if (!full || !tracksAsked) return;
    setView('tracks');
    if (hasTracks) tracksShownAsAsked();
  }, [full, tracksAsked, hasTracks, restId]);
  // A view the track playing has not (no words for a computer far away): back to the cover. Tracks asked
  // by a cover wait for theirs.
  useEffect(() => {
    if ((view === 'lyrics' && !hasLyrics) || (view === 'tracks' && !hasTracks && !tracksAsked) || (view === 'guide' && !guide) || (view === 'info' && !hasInfo)) setView('cover');
  }, [view, hasLyrics, hasTracks, guide, tracksAsked, hasInfo]);

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
  // The info closed goes back to the view it opened over (the tracks, say), the others to the cover.
  const before = useRef<View>('cover');
  const toggleView = (next: View) => setView(current => {
    if (current === next) return next === 'info' ? (before.current === 'info' ? 'cover' : before.current) : 'cover';
    if (next === 'info') before.current = current;
    return next;
  });

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
    // The stars turn their own dial under the finger: up and down are theirs.
    if ((event.target as HTMLElement).closest('input, [role="slider"], .output-volume, .now-playing-scroll, .lyrics-timing, .ui-stars')) return;
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

  const playButton = (big: boolean, disabled = false) => (
    <button type="button" className={`player-bar-button${big ? ' now-playing-play' : ' player-pill-play'}`}
      onClick={controls.toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={disabled}>
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
      {props.from && <Menu.Section title={`Playing from ${props.from}`} />}
      {props.onOpenMixtape && <Menu.Item icon={<BsDisc />} onSelect={() => leave(props.onOpenMixtape!.open)}>Open {props.onOpenMixtape.title}</Menu.Item>}
      {props.onAllTracks && <Menu.Item icon={<BsMusicNoteList />} onSelect={props.onAllTracks}>Listen Next's tracks…</Menu.Item>}
      {props.album?.menu}
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

  // Over the tracks, the album's stars under the artist; the track's ♥ is on each line there.
  const wordsOf = (withStars: boolean) => (
    <div className="now-playing-words">
      <span className="now-playing-track">{props.title}</span>
      <span className="now-playing-artist">{props.subtitle}</span>
      {withStars && starsOf != null && (
        <AlbumStarRating className="now-playing-stars" value={stars} onChange={rate} size="sm" label={`Your stars for ${cover.title}`} />
      )}
    </div>
  );
  const words = wordsOf(false);

  // Once, the first time tracks are shown, their first line of Navidrome's opens a little to say that it slides.
  const [swipeHint] = useState(() => readStored(SWIPE_HINT_KEY) !== '1');
  const hintSongId = props.tracks?.find(one => one.songId)?.songId;
  const tracksSeen = full && view === 'tracks' && hintSongId != null;
  useEffect(() => { if (tracksSeen && swipeHint) writeStored(SWIPE_HINT_KEY, '1'); }, [tracksSeen, swipeHint]);
  // Once, the first time a disc's head is shown, it opens a little to say that it slides.
  const [discSwipeHint] = useState(() => readStored(DISC_SWIPE_HINT_KEY) !== '1');
  const discHeadsSeen = full && view === 'tracks' && Boolean(props.album) && (props.tracks ?? []).some(one => (one.disc ?? 1) !== 1);
  useEffect(() => { if (discHeadsSeen && discSwipeHint) writeStored(DISC_SWIPE_HINT_KEY, '1'); }, [discHeadsSeen, discSwipeHint]);
  // The tracks by disc, when they are on more than one; else all in one list with no head.
  const discNumbers = [...new Set((props.tracks ?? []).map(one => one.disc ?? 1))].sort((a, b) => a - b);
  const discGroups = (discNumbers.length > 1 ? discNumbers : [null]).map(disc => ({
    disc,
    tracks: (props.tracks ?? []).map((track, index) => ({ track, index })).filter(one => disc == null || (one.track.disc ?? 1) === disc),
  }));
  const tracksList = hasTracks && (
    <div className="now-playing-tracks now-playing-scroll">
      {/* Always there, so the tracks do not move as the album starts: what is left. At rest the line under the
          title says its length already: nothing more here. */}
      <div className="now-playing-tracks__head">
        <span className="now-playing-tracks__ahead">{props.left || (props.rest ? null : summary)}</span>
      </div>
      {/* An album of several discs: each under its head, numbered from 1 again. */}
      {discGroups.map((group, g) => (
          <ol key={group.disc ?? 'all'}>
            {group.disc != null && (
              <DiscHeadLine number={group.disc} tracks={group.tracks.map(one => one.track)} head={props.album?.disc(group.disc) ?? null}
                hint={discSwipeHint && g === 0 && Boolean(props.album)} />
            )}
            {group.tracks.map(({ track: one, index: i }, no) => (
              <TrackLine key={i} track={one} no={no + 1} now={i === props.index} playing={playing}
                play={controls.playTrack ? () => controls.playTrack!(i) : undefined}
                hint={swipeHint && one.songId === hintSongId}
                onNewMixtape={() => one.songId && setNaming({ songId: one.songId, title: one.title })} />
            ))}
          </ol>
      ))}
      {props.onAllTracks && (
        <Button variant="quiet" size="sm" icon={<BsMusicNoteList />} onClick={props.onAllTracks}>All of Listen Next…</Button>
      )}
    </div>
  );

  const sheet = (
    <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={props.rest ? cover.title : 'Now playing'} aria-hidden={!full} inert={!full}
      className={`now-playing now-playing--${view}${full ? ' now-playing--open' : ''}${away ? ' now-playing--away' : ''}${fixing ? ' now-playing--timing' : ''}`}
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
              {wordsOf(view === 'tracks')}{view === 'tracks' && starsOf != null ? null : heart}{wordsShown && lyrics?.status === 'found' && !fixing && !trying && <LyricsMenu timing={timing} canFix={canFix} className="output-menu" />}{more}
            </div>
            {view === 'lyrics' && props.lyricsOf && <Lyrics lyrics={timing.shown} lines={timing.lines} position={position} seek={controls.seek} />}
            {view === 'guide' && guide && (
              <div className="now-playing-guide now-playing-scroll"><GuideText text={guide} /></div>
            )}
            {view === 'tracks' && tracksList}
            {view === 'info' && props.infoOf && (
              <div className="now-playing-info now-playing-scroll"><AlbumInfo albumId={props.infoOf.albumId} known={props.infoOf.known} /></div>
            )}
          </>
        )}

        {fixing ? (
          // Fixing the words' timing: the drawer in place of the place in the track, the buttons and the foot.
          <TimingDrawer timing={timing} songId={props.timingSongId!} touch className="now-playing-timing" />
        ) : trying ? (
          // Trying another version of the words: which, ‹ ›, Keep or Revert, in place of the controls too.
          <TryBar timing={timing} touch className="now-playing-timing" />
        ) : (
          <>
          {/* The info takes the room of the place in the track, the buttons and the output: the foot alone stays. */}
          {view !== 'info' && props.rest ? (
            // At rest: what the album is, where the place in the track would be.
            <p className="now-playing-rest">{props.rest.line}</p>
          ) : view !== 'info' && <Scrubber position={position} length={length} playing={playing} seek={controls.seek} format={props.format} />}

          {view === 'info' ? null : props.rest ? (
            <div className="now-playing-transport now-playing-transport--rest">{playButton(true, props.rest.playable === false)}</div>
          ) : taken ? (
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
          {renderer && view !== 'info' && <div className="now-playing-volume"><OutputVolume output={renderer} slim /></div>}

          {/* Where it plays, over the buttons: "Playing on" and the output's name, which opens the outputs to change it. */}
          {!props.foot && outputs.length > 0 && view !== 'info' && (
            <p className="now-playing-where">
              {props.rest ? 'Plays on' : 'Playing on'}{' '}
              <OutputMenu drop="up" align="start" volume={false} trigger={(triggerProps, open) => (
                <button type="button" {...triggerProps} aria-label={`Output: ${props.where || localOutputName()}`}
                  className={`now-playing-where__output${props.where ? ' now-playing-where__output--away' : ''}${open ? ' now-playing-where__output--open' : ''}`}>
                  {props.where || localOutputName()}
                </button>
              )} />
            </p>
          )}

          {/* The words, the guide, the tracks, the details: as many even columns as there are, each centred in its own. */}
          <footer className={`now-playing-foot${props.door ? ' now-playing-foot--door' : ''}`}>
            {props.door}
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
            {/* The album's info, in place of the tracks: everything its card said that the player does not. */}
            {props.infoOf && (
              <button type="button" className={`player-bar-button now-playing-tool${view === 'info' ? ' now-playing-tool--on' : ''}`}
                onClick={() => toggleView('info')} aria-pressed={view === 'info'} aria-label="Album info">
                <BsInfoCircle aria-hidden="true" />
              </button>
            )}
          </footer>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div ref={pillRef} className="player-pill"
        onPointerDown={event => {
          // ⏯ and ⏭ are their own: a finger that moves a little on them opens nothing.
          pillStart.current = (event.target as HTMLElement).closest('button:not(.player-pill-open)') ? null : event.clientY;
        }}
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
