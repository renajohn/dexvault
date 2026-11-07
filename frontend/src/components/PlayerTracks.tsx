import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BsCheck2, BsGripVertical, BsMusicNoteList, BsPlayFill, BsThreeDots } from 'react-icons/bs';
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Dialog, { useDialogClose } from './shared/Dialog';
import Menu from './shared/Menu';
import { UpcomingEntries } from './QueueEntries';
import { IconButton } from './shared/Button';
import CoverTag from './shared/CoverTag';
import { AlbumStarRating } from './RecordStarRating';
import NowPlayingBars from './shared/NowPlayingBars';
import { Loading } from './shared/Spinner';
import toast from './shared/Toast';
import { player, usePlayer, type PlayerAlbum, type PlayerTrack } from '../services/player';
import { listenNextQueue, playingKey } from '../services/listenNextQueue';
import { entryKey, parseEntryKey } from '../utils/listenNextEntry';
import musicService from '../services/musicService';
import { loadPlayable } from '../utils/playAlbum';
import { inAlbumOrder } from '../utils/queueOrder';
import './PlayerTracks.css';

/** An album of the dialog: out of the list (played to its end, or taken out by hand), or in it. */
interface Shown {
  album: PlayerAlbum;
  tracks: PlayerTrack[];
  gone: 'played' | 'out' | null;
}

const time = (seconds: number | null): string => {
  if (seconds == null) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A key for each track that stays with it as it moves: its song, and which of that song's times when it is there twice. */
const keysOf = (tracks: PlayerTrack[]): string[] => {
  const seen = new Map<string, number>();
  return tracks.map(track => {
    const nth = seen.get(track.songId) ?? 0;
    seen.set(track.songId, nth + 1);
    return `${track.songId}#${nth}`;
  });
};

/**
 * A track still to come of what plays: dragged to another place among those
 * to come (a mouse past a few pixels, a finger held a moment), or moved by
 * its ⋯ (next, last, taken out), or Alt ↑ ↓ from the keys.
 */
const Upcoming: React.FC<{ id: string; at: number; title: string; children: React.ReactNode }> = ({ id, at, title, children }) => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition: transition || undefined };
  return (
    <div ref={setNodeRef} style={style} className={`player-tracks-row player-tracks-row--upcoming${isDragging ? ' player-tracks-row--dragging' : ''}`} {...listeners}>
      <BsGripVertical className="player-tracks-grip" aria-hidden="true" />
      {children}
      <span className="player-tracks-more" onPointerDown={event => event.stopPropagation()}>
        <Menu align="end" label={`Move ${title}`} trigger={props => (
          <IconButton {...props} size="sm" label={`Move ${title}`} title="Move"><BsThreeDots aria-hidden="true" /></IconButton>
        )}>
          <UpcomingEntries at={at} />
        </Menu>
      </span>
    </div>
  );
};

/** The albums to show: of Listen Next, those of this play that left it and the list, an album or one disc of it; else the album playing. */
const loadShown = async (album: PlayerAlbum, tracks: PlayerTrack[], fromListenNext: boolean): Promise<Shown[]> => {
  if (!fromListenNext) return [{ album, tracks, gone: null }];
  const [{ gone, listed }, play] = await Promise.all([
    listenNextQueue.albums(),
    musicService.getListenNextPlay().catch(() => null),
  ]);
  const since = listenNextQueue.session().startedAt;
  const playedOut = new Set((play?.departures || []).filter(departure => departure.leftAt >= since)
    .map(departure => entryKey(departure.albumId, departure.disc)));
  const ids = [...gone, ...listed];
  const loaded = await Promise.all(ids.map(id => (id === playingKey(album)
    ? Promise.resolve({ album, tracks })
    : loadPlayable(parseEntryKey(id).albumId, { listenNext: true, disc: parseEntryKey(id).disc }).catch(() => null))));
  return ids.flatMap((id, at) => {
    const one = loaded[at];
    // An album with no rip has nothing to jump to.
    if (!one || one.tracks.length === 0) return [];
    return [{ ...one, gone: at < gone.length ? (playedOut.has(id) ? 'played' : 'out') : null }];
  });
};

const Tracks: React.FC<{ fromListenNext: boolean }> = ({ fromListenNext }) => {
  const close = useDialogClose();
  const album = usePlayer(state => state.album);
  const tracks = usePlayer(state => state.tracks);
  const index = usePlayer(state => state.index);
  const playing = usePlayer(state => state.playing);
  const [shown, setShown] = useState<Shown[] | null>(null);
  const [focus, setFocus] = useState<number>(0);
  const list = useRef<HTMLDivElement>(null);
  // What was playing when it opened: the dialog does not load again as the tracks go by.
  const opened = useRef({ album, tracks });

  useEffect(() => {
    const { album: first, tracks: theirs } = opened.current;
    if (!first) return;
    let live = true;
    loadShown(first, theirs, fromListenNext)
      .then(albums => { if (live) setShown(albums); })
      .catch(() => { if (live) setShown([{ album: first, tracks: theirs, gone: null }]); });
    return () => { live = false; };
  }, [fromListenNext]);

  // Opened on the track playing, a few tracks below the top.
  useLayoutEffect(() => {
    if (!shown || !list.current) return;
    const now = list.current.querySelector<HTMLButtonElement>('.player-tracks-track--now');
    if (!now) return;
    list.current.scrollTop = Math.max(0, now.offsetTop - list.current.offsetTop - 120);
    now.focus({ preventScroll: true });
    setFocus(shown.findIndex(one => playingKey(one.album) === playingKey(album)));
    // Once, when the albums come.
  }, [shown]);

  // The cover on the left is the album whose tracks are at the top of the list, under its head.
  const follow = useCallback(() => {
    const box = list.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const sections = Array.from(box.querySelectorAll<HTMLElement>('.player-tracks-album'));
    const at = sections.findIndex(section => section.getBoundingClientRect().bottom - top > 80);
    setFocus(Math.max(0, at));
  }, []);

  const jump = async (one: Shown, to: number) => {
    close();
    if (!fromListenNext) {
      player.playTrack(to);
      return;
    }
    const started = await listenNextQueue.jumpTo(playingKey(one.album)!, to).catch(() => false);
    if (!started) toast(`Could not play ${one.album.title}`, { tone: 'danger' });
  };

  // A mouse drags past a few pixels, for a click to stay a click; a finger holds first, for a swipe to scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const keys = keysOf(tracks);
  // Said to a screen reader by the tracks' titles, not by their keys.
  const titleOf = (id: string | number | undefined) => tracks[keys.indexOf(String(id))]?.title ?? 'The track';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${titleOf(active.id)} picked up.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} over ${titleOf(over.id)}.` : `${titleOf(active.id)} is no longer over a track.`),
    onDragEnd: ({ active, over }) => (over ? `${titleOf(active.id)} put where ${titleOf(over.id)} was.` : `${titleOf(active.id)} put back.`),
    onDragCancel: ({ active }) => `${titleOf(active.id)} put back where it was.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    player.moveTrack(keys.indexOf(String(active.id)), keys.indexOf(String(over.id)));
  };

  // ↑ ↓ from track to track; Alt ↑ ↓ moves a track to come, the focus with it.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.player-tracks-track') || []);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const moving = event.altKey ? (document.activeElement as HTMLElement | null)?.dataset.upcoming : undefined;
    if (moving != null) {
      event.preventDefault();
      const from = Number(moving);
      const to = from + (event.key === 'ArrowDown' ? 1 : -1);
      if (player.moveTrack(from, to)) {
        requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-upcoming="${to}"]`)?.focus());
      }
      return;
    }
    const next = all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
  };

  // The stars of the album on the left, read once from Navidrome (given in Amperfy since), then given here.
  const sideId = shown ? (shown[focus] || shown[0])?.album.id ?? null : null;
  const [stars, setStars] = useState<Record<number, number | null>>({});
  useEffect(() => {
    if (sideId == null || sideId in stars) return undefined;
    let live = true;
    musicService.syncAlbumRating(sideId)
      .then(({ userRating }) => { if (live) setStars(known => ({ ...known, [sideId]: userRating ?? null })); })
      .catch(() => {});
    return () => { live = false; };
  }, [sideId, stars]);
  const rate = (id: number, next: number) => {
    const before = stars[id] ?? null;
    setStars(known => ({ ...known, [id]: next || null }));
    musicService.setAlbumRating(id, next)
      .then(({ userRating }) => setStars(known => ({ ...known, [id]: userRating ?? null })))
      .catch(error => {
        setStars(known => ({ ...known, [id]: before }));
        toast(`The stars were not kept: ${(error as Error).message}`, { tone: 'danger' });
      });
  };

  if (!shown) return <Dialog.Body><Loading>Loading the tracks…</Loading></Dialog.Body>;
  const side = shown[focus] || shown[0];
  const tagOf = (one: Shown) => {
    if (playingKey(one.album) === playingKey(album)) return <CoverTag variant="on"><BsPlayFill aria-hidden="true" /> Playing</CoverTag>;
    if (one.gone === 'played') return <CoverTag variant="muted"><BsCheck2 aria-hidden="true" /> Played</CoverTag>;
    if (one.gone === 'out') return <CoverTag variant="muted">Taken out</CoverTag>;
    return null;
  };
  // The album's own discs: a track put there by hand from another album counts none.
  const discsOf = (one: Shown) => new Set(one.tracks.filter(track => !track.queued).map(track => track.disc)).size;
  const length = side ? side.tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0) : 0;

  return (
    <Dialog.Body className={`player-tracks${fromListenNext ? '' : ' player-tracks--album'}`}>
      {side && (
        <aside className="player-tracks-side">
          <div className={`player-tracks-cover${side.gone ? ' player-tracks-cover--gone' : ''}`}>
            {side.album.cover ? <img src={side.album.cover} alt="" /> : <span className="player-tracks-nocover" />}
            {fromListenNext && <span className="player-tracks-cover-tag">{tagOf(side)}</span>}
          </div>
          {side.album.id != null && !side.album.radio && (
            <AlbumStarRating className="player-tracks-stars" value={stars[side.album.id] ?? null} size="md"
              label={`Your stars for ${side.album.title}`} onChange={next => rate(side.album.id!, next)} />
          )}
          <div className="player-tracks-side-meta">
            <h3>{side.album.title}</h3>
            <div className="player-tracks-artist">{side.album.artist}</div>
            <div className="player-tracks-facts">
              {[discsOf(side) > 1 ? `${discsOf(side)} discs` : null, `${side.tracks.length} tracks`, length > 0 ? `${Math.round(length / 60)} min` : null]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
        </aside>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: 'Drag a track to come to another place, or use Alt and the arrows.' } }}>
      <div className="player-tracks-list" ref={list} onScroll={follow} onKeyDown={onKeyDown}>
        {shown.map(one => {
          const here = playingKey(one.album) === playingKey(album);
          // The album playing as it now plays: its tracks moved, taken out, or put there by hand.
          const theirs = here ? tracks : one.tracks;
          // Put in another order: numbered by their places, the album's numbers saying nothing any more.
          const ordered = inAlbumOrder(theirs);
          const several = discsOf(one) > 1 && ordered;
          return (
            <section key={playingKey(one.album) ?? 'alone'} className={`player-tracks-album${one.gone ? ' player-tracks-album--gone' : ''}`}
              aria-label={one.album.title}>
              {fromListenNext && (
                <div className="player-tracks-head">
                  {one.album.cover ? <img src={one.album.cover} alt="" /> : <span className="player-tracks-nocover" />}
                  <span className="player-tracks-head-meta">
                    <b>{one.album.title}{one.album.disc ? ` · Disc ${one.album.disc}` : ''}</b>
                    <span>{one.album.artist}</span>
                  </span>
                  {tagOf(one)}
                </div>
              )}
              <SortableContext items={here ? keys.slice(index + 1) : []} strategy={verticalListSortingStrategy}>
              {theirs.map((track, at) => {
                const now = here && at === index;
                // Already heard, before the one playing in its album: dimmed.
                const past = here && at < index;
                const upcoming = here && at > index;
                const button = (
                    <button type="button" className={`player-tracks-track${now ? ' player-tracks-track--now' : ''}${past ? ' player-tracks-track--past' : ''}`}
                      aria-current={now ? 'true' : undefined} onClick={() => jump(one, at)} data-upcoming={upcoming ? at : undefined}
                      aria-keyshortcuts={upcoming ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}>
                      <span className="player-tracks-no">
                        {now ? <NowPlayingBars playing={playing} /> : (
                          <>
                            <span className="player-tracks-number">{ordered ? track.no : at + 1}</span>
                            <BsPlayFill className="player-tracks-play" aria-hidden="true" />
                          </>
                        )}
                      </span>
                      <span className="player-tracks-title">
                        {track.title}
                        {/* A song of a mixtape: whose it is. */}
                        {track.artist && <span className="player-tracks-by"> · {track.artist}</span>}
                      </span>
                      <span className="player-tracks-time">{time(track.durationSec)}</span>
                    </button>
                );
                return (
                  <React.Fragment key={here ? keys[at] : `${track.songId}-${at}`}>
                    {several && (at === 0 || theirs[at - 1].disc !== track.disc) && (
                      <div className="player-tracks-disc">Disc {track.disc}</div>
                    )}
                    {upcoming ? <Upcoming id={keys[at]} at={at} title={track.title}>{button}</Upcoming> : <div className="player-tracks-row">{button}</div>}
                  </React.Fragment>
                );
              })}
              </SortableContext>
            </section>
          );
        })}
      </div>
      </DndContext>
    </Dialog.Body>
  );
};

/**
 * The tracks of what plays, opened from the player bar: a click jumps to one
 * and closes it. From Listen Next, the albums of the list and those of this
 * play that left it, heard, a detour away.
 */
const PlayerTracks: React.FC<{ show: boolean; onClose: () => void }> = ({ show, onClose }) => {
  const album = usePlayer(state => state.album);
  const fromListenNext = usePlayer(state => state.queue === 'listenNext');
  if (!show || !album) return null;
  return (
    <Dialog onClose={onClose} size="lg" zIndex={12000} backdropClassName="over-player-backdrop" className="player-tracks-dialog" icon={<BsMusicNoteList />}
      title={fromListenNext ? 'Listen Next' : album.title} aside={fromListenNext ? undefined : album.artist}>
      <Tracks fromListenNext={fromListenNext} />
    </Dialog>
  );
};

export default PlayerTracks;
