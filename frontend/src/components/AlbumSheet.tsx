import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BsBoxArrowUpRight, BsDisc, BsHeadphones, BsInfoCircle, BsJournalText, BsMusicNoteList, BsPauseFill, BsPlayFill,
  BsSkipBackwardFill, BsSkipForwardFill, BsSpeaker, BsThreeDots, BsXLg,
} from 'react-icons/bs';
import musicService, { type ListenNextMedium, type RipTracks } from '../services/musicService';
import { localOutputName, player, usePlayer } from '../services/player';
import { useCoversPlayer } from '../services/phoneDoor';
import { playerAlbumOf, playerTracksOf } from '../utils/playAlbum';
import { ripFileFor } from '../utils/trackDetail';
import { playingTime } from '../utils/albumHead';
import { isAppleMobile, openListen } from '../utils/navidrome';
import Button, { IconButton } from './shared/Button';
import CoverButton from './shared/CoverButton';
import Menu from './shared/Menu';
import Segmented from './shared/Segmented';
import Spinner from './shared/Spinner';
import NowPlayingBars from './shared/NowPlayingBars';
import { toast } from './shared/Toast';
import NowPlayingDisc, { useNowPlayingDoor } from './NowPlayingDisc';
import OutputMenu from './OutputMenu';
import { GuideText, readingOf } from './AlbumGuide';
import { MixtapeEntries, NewMixtapeDialog } from './MixtapeMenu';
import './AlbumSheet.css';

/** A finger drawn this far down the sheet closes it, as the phone's player has it. */
const SWIPE_CLOSE_PX = 90;
/** A finger moved this far is a drag, not a tap. */
const DRAG_FROM_PX = 8;
/** How long the sheet takes to slide out, after which the page is told it is closed (AlbumSheet.css). */
const LEAVE_MS = 320;

interface SheetTrack {
  no?: number | string;
  title: string;
  durationSec?: number;
}

interface SheetDisc {
  number: number;
  tracks: SheetTrack[];
}

/** What the sheet reads of an album, as its card gets it (musicService.getAlbumById). */
export interface SheetAlbum {
  id: number | string;
  title: string;
  artist: string | string[];
  cover?: string | null;
  format?: string;
  releaseYear?: string | number;
  titleStatus?: string;
  fileQuality?: string;
  discs?: SheetDisc[];
}

export interface AlbumSheetProps {
  album: SheetAlbum;
  onClose: () => void;
  /** (i), or ⋯ › Album card: the album's full card, which stacks over the sheet. */
  onOpenCard: () => void;
  isInListenNext?: boolean;
  /** The list of Listen Next the album is in, when it is there. */
  listenNextMedium?: ListenNextMedium | null;
  onListenNextChange?: (() => void) | null;
}

const time = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The discs of a rip, its files in their order, for an album DexVault knows no tracks of (a wish, say). */
const discsOfRip = (rip: RipTracks | null | undefined): SheetDisc[] => {
  if (!rip?.found) return [];
  const byDisc = new Map<number, SheetTrack[]>();
  for (const file of [...rip.tracks].sort((a, b) => a.discNumber - b.discNumber || a.track - b.track)) {
    byDisc.set(file.discNumber, [...(byDisc.get(file.discNumber) || []), { no: file.track, title: file.title, durationSec: file.durationSec ?? undefined }]);
  }
  return [...byDisc].map(([number, tracks]) => ({ number, tracks }));
};

/**
 * The place in the track, in the band once the album plays: a line to tap or
 * to draw along, its dot following the finger, the music going there once it
 * is let go; ← → step 10 s.
 */
const Scrubber: React.FC<{ position: number; length: number; playing: boolean }> = ({ position, length, playing }) => {
  const [held, setHeld] = useState<number | null>(null);
  const line = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const box = line.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - box.left) / Math.max(1, box.width))) * length;
  };
  const shown = held ?? position;
  const share = length > 0 ? Math.min(100, (shown / length) * 100) : 0;
  return (
    <div className="album-sheet-seek">
      <div ref={line} className={`album-sheet-scrubber${playing ? '' : ' album-sheet-scrubber--paused'}${held != null ? ' album-sheet-scrubber--held' : ''}`}
        role="slider" tabIndex={0} aria-label="Position in the track"
        aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(shown)} aria-valuetext={`${time(shown)} of ${time(length)}`}
        onPointerDown={event => {
          if (length <= 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setHeld(at(event.clientX));
        }}
        onPointerMove={event => { if (held != null) setHeld(at(event.clientX)); }}
        onPointerUp={event => {
          if (held == null) return;
          player.seek(at(event.clientX));
          setHeld(null);
        }}
        onPointerCancel={() => {
          if (held != null) player.seek(held);
          setHeld(null);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowRight') player.seek(position + 10);
          if (event.key === 'ArrowLeft') player.seek(position - 10);
        }}>
        <span className="album-sheet-scrubber__fill" style={{ width: `${share}%` }} />
        <span className="album-sheet-scrubber__dot" style={{ left: `${share}%` }} />
      </div>
      <div className="album-sheet-times">
        <span>{time(shown)}</span>
        <span>-{time(Math.max(0, length - shown))}</span>
      </div>
    </div>
  );
};

/**
 * An album as a phone opens it from its cover: the player's sheet, at rest.
 * The cover at a fixed height, who and what in a line each, then a band of
 * one height that holds a gold ▶ between Listen Next and the output, and
 * the tracks, a tap on one playing from it. Once this album plays, the band
 * shows the place in the track and ⏮ ⏯ ⏭ instead, in a fade, nothing else
 * moving. (i) and ⋯ › Album card open the card over it. The handle, a finger
 * drawn down or Escape close it; another album playing keeps playing, the
 * player's pill giving way to its disc at the sheet's foot, which opens the
 * full screen player.
 */
const AlbumSheet: React.FC<AlbumSheetProps> = ({ album, onClose, onOpenCard, isInListenNext = false, listenNextMedium = null, onListenNextChange }) => {
  const [open, setOpen] = useState(false);
  const leaving = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'tracks' | 'guide'>('tracks');
  // Undefined while Navidrome is asked for the rip, null when it could not be read.
  const [rip, setRip] = useState<RipTracks | null | undefined>(undefined);
  const [guide, setGuide] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  // A new mixtape for the album, its name asked over the sheet.
  const [naming, setNaming] = useState(false);
  // A finger drawing the sheet down: where it started, and whether it has moved enough to be a drag.
  const start = useRef<{ y: number; at: number; dragging: boolean } | null>(null);
  const frame = useRef(0);
  // A drag just ended over a button: its click is not a tap.
  const dragged = useRef(false);

  const albumId = Number(album.id);
  const here = usePlayer(state => state.album?.id === albumId);
  const playing = usePlayer(state => state.playing);
  const position = usePlayer(state => state.position);
  const duration = usePlayer(state => state.duration);
  const nowSongId = usePlayer(state => state.tracks[state.index]?.songId ?? null);
  const nowLength = usePlayer(state => state.tracks[state.index]?.durationSec ?? 0);
  const hasNext = usePlayer(state => state.index + 1 < state.tracks.length);
  const output = usePlayer(state => state.output);
  // The sheet takes the whole page: the pill gives way to the disc of what plays, at its foot.
  useCoversPlayer();
  const door = useNowPlayingDoor(album.id);

  // Slid in once mounted; slid out, then the page is told.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    setOpen(false);
    window.setTimeout(onClose, LEAVE_MS);
  };

  // The rip, for ▶ and the tracks; the guide, for its tab.
  useEffect(() => {
    let current = true;
    setRip(undefined);
    setGuide(null);
    setView('tracks');
    musicService.getNavidromeTracks(album.id)
      .then(found => { if (current) setRip(found); })
      .catch(() => { if (current) setRip(null); });
    musicService.getAlbumGuide(album.id)
      .then(found => { if (current) setGuide(found?.text ? readingOf(found.text) : null); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [album.id]);

  // Open, the focus goes into it and Escape closes it; closed, the focus goes back where it was.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      // A card, a dialog or a menu over it takes its own Escape.
      if (event.key === 'Escape' && !document.querySelector('.modal.show, .menu-surface')) leave();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      before?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finger drawn on the sheet never scrolls the page under it: iOS's Safari scrolls it through a fixed
  // layer whatever its touch-action, unless the move is refused. The tracks and a slider keep their own.
  useEffect(() => {
    const layer = sheetRef.current;
    if (!layer) return undefined;
    const hold = (event: TouchEvent) => {
      if (!(event.target instanceof Element && event.target.closest('input, [role="slider"], .album-sheet-scroll'))) event.preventDefault();
    };
    layer.addEventListener('touchmove', hold, { passive: false });
    return () => layer.removeEventListener('touchmove', hold);
  }, []);

  // The sheet follows the finger straight, frame by frame, without React: a render at each move made it lag.
  const place = (dy: number | null) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      sheet.classList.toggle('album-sheet--drag', dy != null);
      sheet.style.transform = dy != null ? `translateY(${dy}px)` : '';
    });
  };
  const grab = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, [role="slider"], .album-sheet-scroll, .menu-surface')) return;
    start.current = { y: event.clientY, at: event.timeStamp, dragging: false };
  };
  const pull = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (!from) return;
    const dy = event.clientY - from.y;
    if (!from.dragging) {
      if (dy < DRAG_FROM_PX) return;
      from.dragging = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
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
    if (dy > SWIPE_CLOSE_PX || fast) leave();
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The album as the player plays it, and the tracks DexVault knows; for an album it knows none of, those of its rip.
  const playerTracks = playerTracksOf(album, rip);
  const ripped = Boolean(rip?.found) && playerTracks.length > 0;
  const discs: SheetDisc[] = (album.discs || []).some(disc => disc.tracks.length > 0) ? album.discs! : discsOfRip(rip);
  const trackCount = discs.reduce((count, disc) => count + disc.tracks.length, 0);
  const seconds = discs.reduce((total, disc) => total + disc.tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0), 0)
    || playerTracks.reduce((sum, track) => sum + (track.durationSec || 0), 0);
  const length = playingTime(seconds);
  const hasCd = album.titleStatus !== 'digital' && album.titleStatus !== 'wish';
  // Listen Next's list for a plain tap: streamed, unless the CD has no rip to stream; a CD alone can go in the CD list.
  const canBeCd = (album.titleStatus ?? 'owned') === 'owned';
  const plainMedium: ListenNextMedium = canBeCd && album.fileQuality === 'none' ? 'cd' : 'digital';
  const artist = Array.isArray(album.artist) ? album.artist.join(', ') : album.artist || '';
  const cover = musicService.getImageUrl(album.cover);
  // Inside the sentence ("Plays on this iPhone"), this browser's own name loses its capital.
  const outputName = output.kind === 'renderer' ? output.name : localOutputName().replace(/^This\b/, 'this');
  const appleMobile = isAppleMobile();
  const songIds = playerTracks.map(track => track.songId);

  const murmur = [
    album.format,
    discs.length > 1 ? `${discs.length} discs` : null,
    trackCount > 0 ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}` : null,
    length || null,
    album.releaseYear ? String(album.releaseYear) : null,
  ].filter(Boolean).join(' · ');

  /** Plays the album from its track at `index` in the player's list; this album already on, that track of it. */
  const playFrom = (index: number) => {
    if (!ripped) return;
    if (here) player.playTrack(index);
    else player.playAlbum(playerAlbumOf(album, rip), playerTracks, index);
  };

  /** Listen Next: the album in the list named, or out of it (null). */
  const setListenNext = async (medium: ListenNextMedium | null) => {
    if (toggling) return;
    setToggling(true);
    try {
      if (medium === null) await musicService.toggleListenNext(album.id);
      else await musicService.toggleListenNext(album.id, undefined, medium);
      onListenNextChange?.();
    } catch (error) {
      toast(`Listen Next was not changed: ${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setToggling(false);
    }
  };

  const nextIcon = (isInListenNext ? listenNextMedium : plainMedium) === 'cd' ? <BsDisc /> : <BsHeadphones />;

  const more = (
    <Menu drop="down" align="end" label="More" trigger={triggerProps => (
      <IconButton {...triggerProps} label="More" className="album-sheet-more"><BsThreeDots /></IconButton>
    )}>
      <Menu.Item icon={<BsDisc />} onSelect={onOpenCard}>Album card</Menu.Item>
      <Menu.Separator />
      <Menu.Section title="Listen Next" />
      <Menu.Choice selected={isInListenNext && listenNextMedium !== 'cd'} onSelect={() => { if (!(isInListenNext && listenNextMedium !== 'cd')) setListenNext('digital'); }}>
        Streamed
      </Menu.Choice>
      <Menu.Choice selected={isInListenNext && listenNextMedium === 'cd'} disabled={!canBeCd}
        onSelect={() => { if (!(isInListenNext && listenNextMedium === 'cd')) setListenNext('cd'); }}>
        From the CD
      </Menu.Choice>
      {isInListenNext && <Menu.Item icon={<BsXLg />} onSelect={() => setListenNext(null)}>Take out of Listen Next</Menu.Item>}
      {songIds.length > 0 && (
        <>
          <Menu.Separator />
          <MixtapeEntries songIds={songIds} onNew={() => setNaming(true)} />
        </>
      )}
      {rip?.found && rip.album && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<BsBoxArrowUpRight />} hint={appleMobile ? undefined : 'new tab'} onSelect={() => openListen(rip.album!)}>
            {appleMobile ? 'Open in Amperfy' : 'Open in Navidrome'}
          </Menu.Item>
        </>
      )}
    </Menu>
  );

  // Under the band: where it plays, or why it cannot.
  const where = rip === undefined ? null
    : ripped ? <span className="album-sheet-where"><BsSpeaker aria-hidden="true" /> {here && playing ? 'Playing' : 'Plays'} on {outputName}{length && ` · ${length}`}</span>
    : hasCd ? <span className="album-sheet-where album-sheet-where--cd"><BsDisc aria-hidden="true" /> On CD only — put it on, or rip it</span>
    : <span className="album-sheet-where">Not ripped yet</span>;

  const tracks = (
    <div className="album-sheet-tracks album-sheet-scroll">
      {discs.map(disc => (
        <React.Fragment key={disc.number}>
          {discs.length > 1 && <p className="album-sheet-disc">Disc {disc.number} · {disc.tracks.length} tracks</p>}
          <ol>
            {disc.tracks.map((track, i) => {
              const file = rip?.found ? ripFileFor(rip.tracks, disc.number, Number(track.no)) : null;
              const index = file?.id ? playerTracks.findIndex(one => one.songId === file.id) : -1;
              const now = here && index >= 0 && file!.id === nowSongId;
              const seconds = file?.durationSec ?? track.durationSec;
              return (
                <li key={`${disc.number}-${track.no ?? i}`}>
                  <button type="button" className={`album-sheet-track${now ? ' album-sheet-track--now' : ''}`}
                    disabled={index < 0} onClick={() => playFrom(index)} aria-current={now ? 'true' : undefined}
                    title={index < 0 && rip !== undefined ? 'No file for this track' : undefined}>
                    <span className="album-sheet-track__no">{now ? <NowPlayingBars playing={playing} /> : track.no ?? i + 1}</span>
                    <span className="album-sheet-track__title">{track.title}</span>
                    <span className="album-sheet-track__time">{seconds ? time(seconds) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </React.Fragment>
      ))}
      {discs.length === 0 && rip !== undefined && <p className="album-sheet-empty">No tracks known for this album.</p>}
    </div>
  );

  const sheet = (
    <>
      <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={album.title}
        className={`album-sheet${open ? ' album-sheet--open' : ''}${here ? ' album-sheet--here' : ''}${here && playing ? ' album-sheet--playing' : ''}`}
        onPointerDown={grab} onPointerMove={pull} onPointerUp={letGo} onPointerCancel={() => { start.current = null; place(null); }}
        onClickCapture={event => { if (dragged.current) { event.stopPropagation(); event.preventDefault(); } }}>
        {/* The cover again, blurred, under it all: each album its own light. */}
        <div className="album-sheet-backdrop" aria-hidden="true">{cover && <img src={cover} alt="" />}</div>
        <div className="album-sheet-inner">
          {/* The handle: a tap, as a finger drawn down from anywhere, closes it. */}
          <button type="button" className="album-sheet-handle" onClick={leave} aria-label="Close"><span /></button>

          <div className="album-sheet-cover">
            {cover ? <img src={cover} alt="" /> : <span className="album-sheet-nocover" aria-hidden="true"><BsDisc /></span>}
          </div>

          <div className="album-sheet-words">
            <div className="album-sheet-text">
              <span className="album-sheet-artist">{artist}</span>
              <span className="album-sheet-title">{album.title}</span>
              <span className="album-sheet-murmur">
                {rip !== undefined && !ripped && <><span className="album-sheet-murmur__cd">Not ripped</span>{murmur && ' · '}</>}
                {murmur}
              </span>
            </div>
            <IconButton label="Album card" className="album-sheet-info" onClick={onOpenCard}><BsInfoCircle /></IconButton>
            {more}
          </div>

          {/* The band: ▶ between Listen Next and the output at rest; the place in the track and ⏮ ⏯ ⏭ once it plays. */}
          <div className="album-sheet-band">
            <div className="album-sheet-idle">
              <CoverButton size="large" reveal="always" active={isInListenNext} className="album-sheet-next" disabled={toggling}
                label={isInListenNext ? 'Take out of Listen Next' : plainMedium === 'cd' ? 'Play the CD next' : 'Stream it next'}
                onClick={() => setListenNext(isInListenNext ? null : plainMedium)}>
                {nextIcon}
              </CoverButton>
              {rip === undefined ? (
                <span className="album-sheet-wait"><Spinner size="lg" label="Reading the rip" /></span>
              ) : (
                <Button variant="primary" className="album-sheet-play" aria-label="Play" disabled={!ripped} onClick={() => playFrom(0)}>
                  <BsPlayFill aria-hidden="true" />
                </Button>
              )}
              <span className="album-sheet-output">
                <OutputMenu drop="down" align="end" trigger={(triggerProps, _open, current) => (
                  <CoverButton {...triggerProps} size="large" reveal="always" active={current.kind === 'renderer'} className="album-sheet-output__button"
                    label={current.kind === 'renderer' ? `Output: ${current.name}` : 'Output'}>
                    <BsSpeaker />
                  </CoverButton>
                )} />
              </span>
            </div>
            {here && (
              <div className="album-sheet-live">
                <Scrubber position={position} length={duration || nowLength} playing={playing} />
                <div className="album-sheet-transport">
                  <IconButton label="Previous" className="album-sheet-step" onClick={() => player.previous()}><BsSkipBackwardFill /></IconButton>
                  <Button variant="primary" className="album-sheet-play album-sheet-play--live" aria-label={playing ? 'Pause' : 'Play'} onClick={() => player.toggle()}>
                    {playing ? <BsPauseFill aria-hidden="true" /> : <BsPlayFill aria-hidden="true" />}
                  </Button>
                  <IconButton label="Next" className="album-sheet-step" disabled={!hasNext} onClick={() => player.next()}><BsSkipForwardFill /></IconButton>
                </div>
              </div>
            )}
          </div>
          <p className="album-sheet-line">{where}</p>

          {view === 'guide' && guide ? (
            <div className="album-sheet-guide album-sheet-scroll"><GuideText text={guide} /></div>
          ) : tracks}

          {(guide || door) && (
            <footer className={`album-sheet-foot${guide ? '' : ' album-sheet-foot--now'}`}>
              {/* Another album playing: its disc, which opens the full screen player; alone, its words beside it. */}
              {door && <NowPlayingDisc exceptAlbumId={album.id} withWords={!guide} className="album-sheet-now" />}
              {guide && <Segmented kind="tabs" tone="neutral" block label="Show" value={view} onChange={setView} options={[
                { value: 'tracks', label: 'Tracks', icon: <BsMusicNoteList /> },
                { value: 'guide', label: 'Guide', icon: <BsJournalText /> },
              ]} />}
            </footer>
          )}
        </div>
      </div>
      {naming && <NewMixtapeDialog songIds={songIds} onClose={() => setNaming(false)} />}
    </>
  );

  return createPortal(sheet, document.body);
};

export default AlbumSheet;
