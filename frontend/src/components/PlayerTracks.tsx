import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BsCheck2, BsMusicNoteList, BsPlayFill } from 'react-icons/bs';
import Dialog, { useDialogClose } from './shared/Dialog';
import CoverTag from './shared/CoverTag';
import NowPlayingBars from './shared/NowPlayingBars';
import { Loading } from './shared/Spinner';
import toast from './shared/Toast';
import { player, usePlayer, type PlayerAlbum, type PlayerTrack } from '../services/player';
import { listenNextQueue, playingKey } from '../services/listenNextQueue';
import { entryKey, parseEntryKey } from '../utils/listenNextEntry';
import musicService from '../services/musicService';
import { loadPlayable } from '../utils/playAlbum';
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

  // ↑ ↓ from track to track.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.player-tracks-track') || []);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
  };

  if (!shown) return <Dialog.Body><Loading>Loading the tracks…</Loading></Dialog.Body>;
  const side = shown[focus] || shown[0];
  const tagOf = (one: Shown) => {
    if (playingKey(one.album) === playingKey(album)) return <CoverTag variant="on"><BsPlayFill aria-hidden="true" /> Playing</CoverTag>;
    if (one.gone === 'played') return <CoverTag variant="muted"><BsCheck2 aria-hidden="true" /> Played</CoverTag>;
    if (one.gone === 'out') return <CoverTag variant="muted">Taken out</CoverTag>;
    return null;
  };
  const discsOf = (one: Shown) => new Set(one.tracks.map(track => track.disc)).size;
  const length = side ? side.tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0) : 0;

  return (
    <Dialog.Body className={`player-tracks${fromListenNext ? '' : ' player-tracks--album'}`}>
      {side && (
        <aside className="player-tracks-side">
          <div className={`player-tracks-cover${side.gone ? ' player-tracks-cover--gone' : ''}`}>
            {side.album.cover ? <img src={side.album.cover} alt="" /> : <span className="player-tracks-nocover" />}
            {fromListenNext && <span className="player-tracks-cover-tag">{tagOf(side)}</span>}
          </div>
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
      <div className="player-tracks-list" ref={list} onScroll={follow} onKeyDown={onKeyDown}>
        {shown.map(one => {
          const several = discsOf(one) > 1;
          const here = playingKey(one.album) === playingKey(album);
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
              {one.tracks.map((track, at) => {
                const now = here && at === index;
                // Already heard, before the one playing in its album: dimmed.
                const past = here && at < index;
                return (
                  <React.Fragment key={`${track.songId}-${at}`}>
                    {several && (at === 0 || one.tracks[at - 1].disc !== track.disc) && (
                      <div className="player-tracks-disc">Disc {track.disc}</div>
                    )}
                    <button type="button" className={`player-tracks-track${now ? ' player-tracks-track--now' : ''}${past ? ' player-tracks-track--past' : ''}`}
                      aria-current={now ? 'true' : undefined} onClick={() => jump(one, at)}>
                      <span className="player-tracks-no">
                        {now ? <NowPlayingBars playing={playing} /> : (
                          <>
                            <span className="player-tracks-number">{track.no}</span>
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
                  </React.Fragment>
                );
              })}
            </section>
          );
        })}
      </div>
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
