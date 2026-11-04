import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BsBoxArrowUpRight, BsFiles, BsHeadphones, BsPencil, BsPlus, BsShuffle, BsTrash } from 'react-icons/bs';
import musicService, { type MixtapeDetails } from '../services/musicService';
import { setFullPlayer, showAlbum, type ShownAlbum } from '../services/phoneDoor';
import { playAlbumById, mixtapeTracksOf } from '../utils/playAlbum';
import { usePlayer } from '../services/player';
import { playingTime } from '../utils/albumHead';
import { forgetMixtape, noteMixtape, reloadMixtapes } from '../utils/mixtapeStore';
import { duplicateMixtape } from '../utils/mixtapeActions';
import { moveUnit, unitsOf } from '../utils/mixtapeCompose';
import { isMixtape } from '../utils/mixtape';
import Menu from './shared/Menu';
import Dialog from './shared/Dialog';
import TextField from './shared/TextField';
import { toast } from './shared/Toast';
import { confirm } from './shared/ConfirmDialog';
import MixtapeComposer from './MixtapeComposer';
import { LISTEN_NEXT_CHANGED_EVENT, type AlbumAtRest } from './useAlbumAtRest';

/** What the phone's full screen player lets a finger do to a mixtape's songs. */
export interface MixtapeEditing {
  /** Slid to the left: the song at `index` goes out. */
  takeOut: (index: number) => void;
  /** Held, then drawn: the unit `from` (a song alone, a work whole) goes before the unit `to`. */
  move: (from: number, to: number) => void;
  /** The unit of each track, by its index: what a finger holding it moves. */
  unitOf: number[];
}

/** Asked as a mixtape is shown: its sheet opened at once, on its name for one just made. */
let pendingSheet: { albumId: number; naming: boolean; fresh: boolean } | null = null;

/** A mixtape opened in the full screen player, its Add tracks… sheet open at once (a new one: on its name). */
export const showMixtapeOnPhone = async (albumId: number, sheet?: { naming: boolean; fresh: boolean }): Promise<void> => {
  if (sheet) pendingSheet = { albumId, ...sheet };
  const album = await musicService.getAlbumById(albumId);
  showAlbum(album as ShownAlbum, 'tracks');
};

/**
 * A mixtape in the phone's full screen player, at rest: its songs as tracks
 * (the movements of a work under its head), ▶ playing it from a song, ⋯ its
 * Add tracks… sheet, Shuffle, Rename, Duplicate, Listen Next, Navidrome and
 * Delete. A song slid to the left goes out, held it moves, a work whole.
 */
export const useMixtapeAtRest = (album: ShownAlbum | null): (AlbumAtRest & { editing: MixtapeEditing }) | null => {
  const busy = usePlayer(state => state.album !== null);
  const albumId = album && isMixtape(album) ? Number(album.id) : null;
  const [mixtape, setMixtape] = useState<MixtapeDetails | null>(null);
  const [inListenNext, setInListenNext] = useState(false);
  const [sheet, setSheet] = useState<{ naming: boolean; fresh: boolean } | null>(null);
  const [name, setName] = useState('');
  const [wanted, setWanted] = useState<string[] | null>(null);
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const asked = useRef(0);
  const nameField = useRef<HTMLInputElement>(null);

  const read = useCallback(async () => {
    if (albumId == null) return;
    try {
      const [details, listenNext] = await Promise.all([
        musicService.getMixtape(albumId),
        musicService.getListenNextAlbums().catch(() => []) as Promise<Array<{ id: number }>>,
      ]);
      setMixtape(details);
      setInListenNext(listenNext.some(row => row.id === albumId));
    } catch {
      toast('This mixtape could not be read from Navidrome', { tone: 'danger' });
    }
  }, [albumId]);

  useEffect(() => {
    setMixtape(null);
    setWanted(null);
    setSheet(null);
    if (albumId == null) return;
    read();
    if (pendingSheet?.albumId === albumId) {
      setSheet({ naming: pendingSheet.naming, fresh: pendingSheet.fresh });
      pendingSheet = null;
    }
  }, [albumId, read]);

  useEffect(() => { if (sheet && mixtape) setName(mixtape.album.title); }, [sheet != null, mixtape?.album.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sheet?.naming && mixtape) setTimeout(() => nameField.current?.select(), 50); }, [sheet?.naming, mixtape != null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One change after the other, each the whole list; the last answer is the mixtape. */
  const send = (songIds: string[]) => {
    if (albumId == null) return;
    setWanted(songIds);
    const turn = ++asked.current;
    sending.current = sending.current.then(async () => {
      try {
        const details = await musicService.updateMixtape(albumId, { songs: songIds });
        if (turn !== asked.current) return;
        setMixtape(details);
        setWanted(null);
        noteMixtape(details);
      } catch {
        if (turn !== asked.current) return;
        setWanted(null);
        toast('The mixtape was not changed: Navidrome did not answer', { tone: 'danger' });
        read();
      }
    });
  };

  if (albumId == null || !mixtape) return null;
  const songs = mixtape.songs;
  const ids = songs.map(song => song.songId);
  const units = unitsOf(songs);
  const unitOf = songs.map((_, at) => units.findIndex(unit => at >= unit.start && at <= unit.end));
  const tracks = mixtapeTracksOf(mixtape);
  const seconds = songs.reduce((total, song) => total + (song.durationSec || 0), 0);
  const line = ['Mixtape', `${songs.length} ${songs.length === 1 ? 'track' : 'tracks'}`, playingTime(seconds) || null].filter(Boolean).join(' · ');

  const closeSheet = async () => {
    const was = sheet;
    setSheet(null);
    const typed = name.trim();
    if (typed && typed !== mixtape.album.title) {
      try {
        setMixtape(await musicService.updateMixtape(albumId, { name: typed }));
        reloadMixtapes();
      } catch { toast('The name was not changed: Navidrome did not answer', { tone: 'danger' }); }
    }
    await sending.current;
    // Just made and left with no track: none is left empty in Navidrome.
    if (was?.fresh && (wanted ?? ids).length === 0) {
      const details = await musicService.getMixtape(albumId).catch(() => null);
      if (details && details.songs.length === 0) {
        await musicService.deleteMixtape(albumId).catch(() => undefined);
        forgetMixtape(albumId);
        setFullPlayer(false);
        toast(<><b>{details.album.title}</b> had no track: not kept</>, { tone: 'info' });
      }
    }
  };

  const toggleListenNext = async () => {
    try {
      await musicService.toggleListenNext(albumId);
      setInListenNext(!inListenNext);
      window.dispatchEvent(new Event(LISTEN_NEXT_CHANGED_EVENT));
    } catch { toast('Listen Next was not changed', { tone: 'danger' }); }
  };

  const remove = async () => {
    const yes = await confirm({
      title: `Delete ${mixtape.album.title}?`,
      message: `${songs.length} tracks. It leaves Navidrome and Amperfy${inListenNext ? ', and Listen Next' : ''}; its tracks stay on their albums.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await musicService.deleteMixtape(albumId);
      forgetMixtape(albumId);
      setFullPlayer(false);
      toast(<><b>{mixtape.album.title}</b> deleted</>, { tone: 'success' });
    } catch { toast('The mixtape was not deleted: Navidrome did not answer', { tone: 'danger' }); }
  };

  const openInNavidrome = () => window.open(mixtape.url, '_blank', 'noopener');

  const menu = (
    <>
      <Menu.Item icon={<BsPlus />} onSelect={() => setSheet({ naming: false, fresh: false })}>Add tracks…</Menu.Item>
      <Menu.Item icon={<BsShuffle />} disabled={units.length < 2} onSelect={() => { playAlbumById(albumId, undefined, 0, true).catch(() => undefined); }}>Shuffle</Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<BsPencil />} onSelect={() => setSheet({ naming: true, fresh: false })}>Rename</Menu.Item>
      <Menu.Item icon={<BsFiles />} onSelect={async () => {
        const copy = await duplicateMixtape(mixtape.album.title, ids);
        if (copy != null) await showMixtapeOnPhone(copy, { naming: true, fresh: false });
      }}>Duplicate</Menu.Item>
      <Menu.Item icon={<BsHeadphones />} hint={inListenNext ? '✓' : undefined} onSelect={toggleListenNext}>
        {inListenNext ? 'In Listen Next' : 'Listen Next'}
      </Menu.Item>
      <Menu.Item icon={<BsBoxArrowUpRight />} onSelect={openInNavidrome}>Open in Navidrome</Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<BsTrash />} danger onSelect={remove}>Delete mixtape…</Menu.Item>
    </>
  );

  // Add tracks…: its name on top, ready to be typed for one just made, then the same search as a computer's.
  const dialog = sheet && (
    <Dialog variant="sheet" tall onClose={closeSheet} zIndex={12000} backdropClassName="over-player-backdrop" className="mixtape-sheet"
      title={(
        <TextField ref={nameField} value={name} maxLength={200} aria-label="Name of the mixtape" className="mixtape-sheet__name" size="sm"
          onChange={event => setName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); (event.currentTarget.closest('.modal')?.querySelector('[aria-label="Add tracks"]') as HTMLInputElement | null)?.focus(); } }} />
      )}>
      <Dialog.Body className="mixtape-sheet__body">
        <div className="mixtape-sheet__state">
          {(wanted ?? ids).length ? `${(wanted ?? ids).length} tracks · ${playingTime(seconds) || '0 min'}` : "An album ticked comes whole: untick what you don't want."}
        </div>
        <MixtapeComposer variant="sheet" songIds={wanted ?? ids} onSongs={send} autoFocus={!sheet.naming} />
      </Dialog.Body>
    </Dialog>
  );

  return {
    title: mixtape.album.title,
    artist: songs.length ? [...new Set(songs.map(song => song.artist))].slice(0, 2).join(' & ') + (new Set(songs.map(song => song.artist)).size > 2 ? ' & more' : '') : 'Empty mixtape',
    cover: songs.length ? musicService.getImageUrl(mixtape.album.cover) : null,
    line,
    playable: songs.length > 0,
    tracks,
    shownTracks: tracks,
    playFrom: index => { playAlbumById(albumId, undefined, index).catch(() => undefined); },
    // Something else plays: a song put next or last in it, with its own artist, CD and cover.
    queueFrom: busy && tracks.length > 0
      ? { id: albumId, title: mixtape.album.title, artist: 'Mixtape', cover: musicService.getImageUrl(mixtape.album.cover) }
      : null,
    actions: { menu, disc: () => ({ on: false, toggle: () => undefined, menu: null }), dialog },
    dialog,
    editing: {
      takeOut: index => {
        const before = ids;
        send(ids.filter((_, at) => at !== index));
        toast(<><b>{songs[index].title}</b> taken out</>, { tone: 'success', action: { label: 'Undo', onClick: () => send(before) } });
      },
      move: (from, to) => send(moveUnit(ids, units, from, to)),
      unitOf,
    },
  };
};
