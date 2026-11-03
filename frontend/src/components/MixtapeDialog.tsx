import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BsBoxArrowUpRight, BsCassetteFill, BsCheck2, BsFiles, BsGripVertical, BsHeadphones, BsPauseFill, BsPencil, BsPlayFill, BsShuffle, BsThreeDots, BsTrash, BsX } from 'react-icons/bs';
import Dialog from './shared/Dialog';
import Menu from './shared/Menu';
import Button, { IconButton } from './shared/Button';
import TextField from './shared/TextField';
import NowPlayingBars from './shared/NowPlayingBars';
import { Loading } from './shared/Spinner';
import Notice from './shared/Notice';
import toast from './shared/Toast';
import { confirm } from './shared/ConfirmDialog';
import musicService, { type MixtapeDetails, type MixtapeSong } from '../services/musicService';
import { player, usePlayer } from '../services/player';
import { playAlbumById } from '../utils/playAlbum';
import { mixtapeArtists } from '../utils/mixtape';
import { forgetMixtape, noteMixtape } from '../utils/mixtapeStore';
import { duplicateMixtape } from '../utils/mixtapeActions';
import { moveUnit, unitsOf } from '../utils/mixtapeCompose';
import MixtapeComposer from './MixtapeComposer';
import './MixtapeDialog.css';

interface MixtapeDialogProps {
  albumId: number;
  onClose: () => void;
  /** A song's CD, opened over the mixtape. */
  onOpenAlbum: (albumId: number) => void;
  /** In or out of Listen Next, renamed, its songs changed or deleted: the page reads again. */
  onChange?: () => void;
  /** Just made here: its name ready to be typed, and gone unasked if it is closed with no track. */
  fresh?: boolean;
  /** Opened to be renamed: its name selected, ready to be typed over. */
  naming?: boolean;
  /** Another mixtape to show in its place: the copy just made of this one. */
  onOpenMixtape?: (albumId: number, fresh: boolean) => void;
}

const time = (seconds: number | null): string => {
  if (seconds == null) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const length = (mixtape: MixtapeDetails): string => {
  const seconds = mixtape.songs.reduce((total, song) => total + (song.durationSec || 0), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} min`;
};

/**
 * A mixtape's card: its mosaic, Play, Shuffle and Listen Next on the left; its songs
 * on the right, in order and without numbers, each with the cover of its CD
 * (a click opens the CD's card over this one). A song's title plays the
 * mixtape from there; its grip moves it, its ✕ takes that copy out. The name
 * is changed in place. Every change goes to Navidrome first.
 */
const MixtapeDialog: React.FC<MixtapeDialogProps> = ({ albumId, onClose, onOpenAlbum, onChange, fresh = false, naming = false, onOpenMixtape }) => {
  const [mixtape, setMixtape] = useState<MixtapeDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inListenNext, setInListenNext] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // What Add tracks… asked for, shown at once; Navidrome's answer then takes its place.
  const [wanted, setWanted] = useState<string[] | null>(null);
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const asked = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  // The player's tracks here, and the place in the mixtape of the one playing: shuffled, the two orders differ.
  const tracks = usePlayer(state => (state.album?.id === albumId ? state.tracks : null));
  const placeNow = usePlayer(state => {
    const track = state.album?.id === albumId ? state.tracks[state.index] : undefined;
    return track ? track.place ?? track.no - 1 : null;
  });
  const shuffledHere = Boolean(tracks?.some((track, at) => (track.place ?? at) !== at));
  const playing = usePlayer(state => state.playing);
  const nameField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [details, listenNext] = await Promise.all([
        musicService.getMixtape(albumId),
        musicService.getListenNextAlbums().catch(() => []) as Promise<Array<{ id: number }>>,
      ]);
      setMixtape(details);
      noteMixtape(details);
      setInListenNext(listenNext.some(album => album.id === albumId));
      // Made here: its name is typed first.
      if (fresh || naming) setRenaming(current => current ?? details.album.title);
    } catch {
      setError('This mixtape could not be read from Navidrome.');
    }
  }, [albumId, fresh, naming]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (renaming != null) nameField.current?.select(); }, [renaming != null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sends a change, the mixtape as Navidrome then has it in its place. */
  const change = async (edit: Parameters<typeof musicService.updateMixtape>[1], undoTo?: string[], said?: React.ReactNode) => {
    setBusy(true);
    try {
      const details = await musicService.updateMixtape(albumId, edit);
      setMixtape(details);
      noteMixtape(details);
      onChange?.();
      if (said) {
        toast(said, {
          tone: 'success',
          ...(undoTo ? { action: { label: 'Undo', onClick: () => { change({ songs: undoTo }); } } } : {}),
        });
      }
    } catch {
      toast('The mixtape was not changed: Navidrome did not answer', { tone: 'danger' });
      load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Add tracks…'s toggles: the songs shown as asked at once, sent one change
   * after the other, each the whole list; the last answer is the mixtape.
   */
  const askSongs = (songIds: string[]) => {
    setWanted(songIds);
    const turn = ++asked.current;
    sending.current = sending.current.then(async () => {
      try {
        const details = await musicService.updateMixtape(albumId, { songs: songIds });
        if (turn !== asked.current) return;
        setMixtape(details);
        setWanted(null);
        noteMixtape(details);
        onChange?.();
      } catch {
        if (turn !== asked.current) return;
        setWanted(null);
        toast('The mixtape was not changed: Navidrome did not answer', { tone: 'danger' });
        load();
      }
    });
  };

  /** Closed with no track, a mixtape just made goes: none is left empty in Navidrome. */
  const close = async () => {
    onClose();
    await sending.current;
    if (!fresh) return;
    const details = await musicService.getMixtape(albumId).catch(() => null);
    if (!details || details.songs.length > 0) return;
    try {
      await musicService.deleteMixtape(albumId);
      forgetMixtape(albumId);
      onChange?.();
      toast(<><b>{details.album.title}</b> had no track: not kept</>, { tone: 'info' });
    } catch { /* left in Navidrome, empty */ }
  };

  const duplicate = async () => {
    if (!mixtape) return;
    const copy = await duplicateMixtape(mixtape.album.title, mixtape.songs.map(song => song.songId));
    if (copy != null) { onChange?.(); onOpenMixtape?.(copy, true); }
  };

  const saveName = async () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (!name || !mixtape || name === mixtape.album.title) return;
    await change({ name });
  };

  /**
   * From a song: playing here, shuffled or not, it is found in the player's
   * order, which goes on after it. Play starts again in the mixtape's order,
   * Shuffle in a new one.
   */
  const play = async (at: number, how: 'from' | 'inOrder' | 'shuffled' = 'from') => {
    const shuffle = how === 'shuffled';
    const there = how !== 'from' || !tracks ? -1 : tracks.findIndex((track, i) => (track.place ?? i) === at);
    if (there >= 0) {
      player.playTrack(there);
      return;
    }
    if (!(await playAlbumById(albumId, undefined, at, shuffle).catch(() => false))) toast(`Could not play ${mixtape?.album.title ?? 'the mixtape'}`, { tone: 'danger' });
  };

  const toggleListenNext = async () => {
    try {
      await musicService.toggleListenNext(albumId);
      setInListenNext(!inListenNext);
      onChange?.();
    } catch {
      toast('Listen Next was not changed', { tone: 'danger' });
    }
  };

  const remove = async () => {
    if (!mixtape) return;
    const yes = await confirm({
      title: `Delete ${mixtape.album.title}?`,
      message: `The mixtape goes from Navidrome too, and from Amperfy${inListenNext ? ', and leaves Listen Next' : ''}. Its tracks stay on their albums.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await musicService.deleteMixtape(albumId);
      forgetMixtape(albumId);
      onChange?.();
      onClose();
      toast(<><b>{mixtape.album.title}</b> deleted</>, { tone: 'success' });
    } catch {
      toast('The mixtape was not deleted: Navidrome did not answer', { tone: 'danger' });
    }
  };

  /** A song alone or a work whole, dropped before the unit `to` (after the last for as many as there are). */
  const drop = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setDropAt(null);
    if (from == null || !mixtape || to === from || to === from + 1) return;
    const ids = mixtape.songs.map(song => song.songId);
    change({ songs: moveUnit(ids, unitsOf(mixtape.songs), from, to) });
  };

  const title = renaming != null ? (
    <span className="mixtape-rename">
      <TextField ref={nameField} size="sm" value={renaming} maxLength={200} aria-label="Name of the mixtape"
        onChange={event => setRenaming(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') saveName();
          if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); }
        }} />
      <IconButton label="Save the name" tone="confirm" onClick={saveName}><BsCheck2 /></IconButton>
      <IconButton label="Cancel" onClick={() => setRenaming(null)}><BsX /></IconButton>
    </span>
  ) : (
    <button type="button" className="mixtape-name" title="Rename" onClick={() => mixtape && setRenaming(mixtape.album.title)}>
      {mixtape?.album.title ?? 'Mixtape'}
    </button>
  );

  const more = mixtape && (
    <Menu align="end" label="More" trigger={props => (
      <IconButton {...props} label="More"><BsThreeDots /></IconButton>
    )}>
      <Menu.Item icon={<BsPencil />} onSelect={() => setRenaming(mixtape.album.title)}>Rename</Menu.Item>
      <Menu.Item icon={<BsFiles />} onSelect={duplicate}>Duplicate</Menu.Item>
      <Menu.Item icon={<BsHeadphones />} onSelect={toggleListenNext} hint={inListenNext ? '✓' : undefined}>
        {inListenNext ? 'In Listen Next' : 'Listen Next'}
      </Menu.Item>
      <Menu.Item icon={<BsBoxArrowUpRight />} hint="new tab" onSelect={() => window.open(mixtape.url, '_blank', 'noopener')}>Open in Navidrome</Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<BsTrash />} danger onSelect={remove}>Delete mixtape…</Menu.Item>
    </Menu>
  );

  /** One song's line: a song alone, or a movement under its work's head (`movement`). */
  const songLine = (song: MixtapeSong, at: number, unit: number, movement: boolean) => {
    const now = placeNow === at;
    const twice = mixtape!.songs.filter(one => one.songId === song.songId).length > 1;
    const unitDrag = movement ? {} : dragProps(unit);
    return (
      <div key={`${song.songId}-${at}`}
        className={`mixtape-song${movement ? ' mixtape-song--movement' : ''}${now ? ' mixtape-song--now' : ''}${!movement && dragFrom === unit ? ' mixtape-song--dragging' : ''}${!movement && dropAt === unit ? ' mixtape-song--drop' : ''}`}
        {...unitDrag}>
        <span className="mixtape-grip" title={movement ? undefined : 'Drag to move'} aria-hidden="true">{!movement && <BsGripVertical />}</span>
        {movement ? (
          <button type="button" className="mixtape-movement-no" title={now ? (playing ? 'Pause' : 'Play') : 'Play from here'}
            aria-label={now ? (playing ? `Pause ${song.title}` : `Play ${song.title}`) : `Play from ${song.title}`}
            onClick={() => (now ? player.toggle() : play(at))}>
            {now ? (playing ? <BsPauseFill /> : <BsPlayFill />) : song.track}
          </button>
        ) : (
          // As in Apple Music: ▶ on the cover plays the mixtape from here; the album's name opens the CD.
          <button type="button" className={`mixtape-thumb${now ? ' mixtape-thumb--now' : ''}`}
            title={now ? (playing ? 'Pause' : 'Play') : 'Play from here'}
            aria-label={now ? (playing ? `Pause ${song.title}` : `Play ${song.title}`) : `Play from ${song.title}`}
            onClick={() => (now ? player.toggle() : play(at))}>
            {song.cover ? <img src={musicService.getImageUrl(song.cover) ?? undefined} alt="" /> : <BsCassetteFill aria-hidden="true" />}
            <span className="mixtape-thumb-play" aria-hidden="true">{now && playing ? <BsPauseFill /> : <BsPlayFill />}</span>
          </button>
        )}
        <div className="mixtape-song-text">
          <button type="button" className="mixtape-song-play" onClick={() => play(at)} aria-current={now ? 'true' : undefined}>
            <span className="mixtape-song-title">
              {now && <NowPlayingBars playing={playing} />}
              {movement && song.movement ? song.movement : song.title}
              {twice && <span className="mixtape-twice"> · twice</span>}
            </span>
          </button>
          {!movement && (
            <span className="mixtape-song-from">
              {song.artist} · {song.albumId != null ? (
                <button type="button" className="mixtape-song-album" title={`Open ${song.album}`} onClick={() => onOpenAlbum(song.albumId!)}>
                  {song.album}
                </button>
              ) : song.album}
            </span>
          )}
        </div>
        <span className="mixtape-song-time">{time(song.durationSec)}</span>
        <IconButton size="sm" className="mixtape-song-remove" label={`Take ${song.title} out`} title="Take out" disabled={busy}
          onClick={() => change({ removeAt: at }, mixtape!.songs.map(one => one.songId), <><b>{song.title}</b> taken out</>)}>
          <BsX />
        </IconButton>
      </div>
    );
  };

  /** What makes a unit, a song alone or a work's head, move by dragging. */
  const dragProps = (unit: number) => ({
    draggable: !busy,
    onDragStart: (event: React.DragEvent) => { setDragFrom(unit); event.dataTransfer.effectAllowed = 'move'; },
    onDragEnd: () => { setDragFrom(null); setDropAt(null); },
    onDragOver: (event: React.DragEvent) => { if (dragFrom == null) return; event.preventDefault(); setDropAt(unit); },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); drop(unit); },
  });

  const units = mixtape ? unitsOf(mixtape.songs) : [];

  return (
    <Dialog onClose={close} size="lg" className="mixtape-dialog" icon={<BsCassetteFill />} title={title} aside={more}>
      {error ? (
        <Dialog.Body><Notice tone="warning">{error}</Notice></Dialog.Body>
      ) : !mixtape ? (
        <Dialog.Body><Loading>Reading the mixtape…</Loading></Dialog.Body>
      ) : (
        <Dialog.Body className="mixtape-body">
          <aside className="mixtape-side">
            <div className="mixtape-cover">
              {mixtape.album.cover && mixtape.songs.length > 0
                ? <img src={musicService.getImageUrl(mixtape.album.cover) ?? undefined} alt="" />
                : <span className="mixtape-nocover"><BsCassetteFill aria-hidden="true" /></span>}
            </div>
            <div>
              <div className="mixtape-artists">{mixtapeArtists(mixtape.album.artist)}</div>
              <div className="mixtape-facts">{mixtape.songs.length} {mixtape.songs.length === 1 ? 'track' : 'tracks'} · {length(mixtape)} · in Navidrome</div>
            </div>
            <div className="mixtape-actions">
              <Button variant="primary" icon={<BsPlayFill />} disabled={mixtape.songs.length === 0} onClick={() => play(0, shuffledHere ? 'inOrder' : 'from')}>Play</Button>
              <Button active={shuffledHere} icon={<BsShuffle />} disabled={units.length < 2}
                title={shuffledHere ? 'Playing shuffled: shuffle again' : 'Play in an order drawn at random, a work whole'} onClick={() => play(0, 'shuffled')}>Shuffle</Button>
              <Button active={inListenNext} icon={<BsHeadphones />} onClick={toggleListenNext}>
                {inListenNext ? 'In Listen Next' : 'Listen Next'}
              </Button>
            </div>
          </aside>
          <div className="mixtape-main">
            <div className="mixtape-compose">
              <MixtapeComposer songIds={wanted ?? mixtape.songs.map(song => song.songId)} onSongs={askSongs}
                autoFocus={!fresh && !naming} />
            </div>
            <div className={`mixtape-songs${busy ? ' mixtape-songs--busy' : ''}`}>
              {mixtape.songs.length === 0 && (
                <p className="mixtape-empty">No track yet. Type a title, an artist or an album above: an album ticked comes whole, untick what you don't want.</p>
              )}
              {units.map((unit, n) => {
                if (!unit.work) return songLine(mixtape.songs[unit.start], unit.start, n, false);
                const songs = mixtape.songs.slice(unit.start, unit.end + 1);
                const first = songs[0];
                return (
                  <div key={`w${unit.start}-${first.songId}`} className="mixtape-work">
                    <div className={`mixtape-song mixtape-work-head${dragFrom === n ? ' mixtape-song--dragging' : ''}${dropAt === n ? ' mixtape-song--drop' : ''}`}
                      {...dragProps(n)}>
                      <span className="mixtape-grip" title="Drag to move the whole work" aria-hidden="true"><BsGripVertical /></span>
                      <button type="button" className="mixtape-thumb" title="Play from here" aria-label={`Play ${unit.work}`} onClick={() => play(unit.start)}>
                        {first.cover ? <img src={musicService.getImageUrl(first.cover) ?? undefined} alt="" /> : <BsCassetteFill aria-hidden="true" />}
                        <span className="mixtape-thumb-play" aria-hidden="true"><BsPlayFill /></span>
                      </button>
                      <div className="mixtape-song-text">
                        <span className="mixtape-song-title mixtape-work-name">{unit.work}</span>
                        <span className="mixtape-song-from">
                          {songs.length} movements · {Math.round(songs.reduce((total, song) => total + (song.durationSec || 0), 0) / 60)} min · {first.artist} · {first.albumId != null ? (
                            <button type="button" className="mixtape-song-album" title={`Open ${first.album}`} onClick={() => onOpenAlbum(first.albumId!)}>{first.album}</button>
                          ) : first.album}
                        </span>
                      </div>
                      <IconButton size="sm" className="mixtape-song-remove" label={`Take ${unit.work} out`} title="Take the whole work out" disabled={busy}
                        onClick={() => change({ songs: mixtape.songs.filter((_, at) => at < unit.start || at > unit.end).map(one => one.songId) },
                          mixtape.songs.map(one => one.songId), <><b>{unit.work}</b> taken out</>)}>
                        <BsX />
                      </IconButton>
                    </div>
                    {songs.map((song, k) => songLine(song, unit.start + k, n, true))}
                  </div>
                );
              })}
              {/* Dropped after the last one. */}
              {dragFrom != null && (
                <div className={`mixtape-drop-end${dropAt === units.length ? ' mixtape-song--drop' : ''}`}
                  onDragOver={event => { event.preventDefault(); setDropAt(units.length); }}
                  onDrop={event => { event.preventDefault(); drop(units.length); }} />
              )}
              {mixtape.songs.length > 0 && <div className="mixtape-total">{mixtape.songs.length} {mixtape.songs.length === 1 ? 'track' : 'tracks'} · {length(mixtape)}</div>}
            </div>
          </div>
        </Dialog.Body>
      )}
    </Dialog>
  );
};

export default MixtapeDialog;
