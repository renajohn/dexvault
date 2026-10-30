import React, { useCallback, useEffect, useState } from 'react';
import { BsBoxArrowUpRight, BsXLg } from 'react-icons/bs';
import musicService, { type ListenNextMedium, type RipTracks } from '../services/musicService';
import { player, type PlayerTrack } from '../services/player';
import { setFullPlayer, type ShownAlbum } from '../services/phoneDoor';
import { playerAlbumOf, playerTracksOf } from '../utils/playAlbum';
import { playingTime } from '../utils/albumHead';
import { isAppleMobile, openListen } from '../utils/navidrome';
import { discsInWords, heldOf } from '../utils/listenNextEntry';
import Menu from './shared/Menu';
import { toast } from './shared/Toast';
import { MixtapeEntries, NewMixtapeDialog } from './MixtapeMenu';

/** Told by Listen Next's ⋯ entries here: the page's banner reads its list again. */
export const LISTEN_NEXT_CHANGED_EVENT = 'dexvault:listen-next-changed';

/** A row of Listen Next as the server sends it: the album, one disc of it or none, and its list. */
interface ListenNextRow { id: number; disc?: number | null; medium?: ListenNextMedium }

/** What an album's standing in the collection says of Listen Next: a CD can go on the player, a CD with no rip only. */
interface AlbumStanding { titleStatus?: string; fileQuality?: string }

/** A disc's head in the phone player's tracks: its Listen Next state, what its slides do, its menu. */
export interface DiscHead {
  /** The disc in Listen Next, on its own or with the whole album. */
  on: boolean;
  /** Its list there: streamed, or from the CD; null out of it. */
  medium: ListenNextMedium | null;
  /** Streamed by default, from the CD for a CD with no rip; what the button puts it in. */
  plainMedium: ListenNextMedium;
  /** Out of Listen Next, or in; the whole album there, this disc alone instead. */
  toggle: () => void;
  /** Its menu's entries: its list, out of Listen Next, its mixtapes. */
  menu: React.ReactNode;
}

/**
 * What ⋯ and the discs' heads do for an album in the phone's full screen
 * player, at rest or playing: Listen Next for the album (streamed, from the CD,
 * all discs, out) and for each disc, the album or a disc in a mixtape. Listen
 * Next is read as the album is shown and again when changed anywhere
 * (`LISTEN_NEXT_CHANGED_EVENT`).
 */
export interface AlbumActions {
  menu: React.ReactNode;
  disc: (disc: number) => DiscHead;
  /** A new mixtape's name asked over the full screen. */
  dialog: React.ReactNode;
}

export const useAlbumActions = (albumId: number | string | null, standing: AlbumStanding | null, tracks: PlayerTrack[]): AlbumActions | null => {
  const [rows, setRows] = useState<ListenNextRow[]>([]);
  // The album's standing read from DexVault when the player knows only its id (the album playing).
  const [read, setRead] = useState<AlbumStanding | null>(null);
  const [naming, setNaming] = useState<{ songIds: string[]; title?: string } | null>(null);
  const id = albumId == null ? null : Number(albumId);

  const readListenNext = useCallback(() => {
    if (id == null) return;
    musicService.getListenNextAlbums()
      .then(list => setRows((list as ListenNextRow[]).filter(row => row.id === id)))
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    setRows([]);
    setNaming(null);
    readListenNext();
    if (id == null) return undefined;
    window.addEventListener(LISTEN_NEXT_CHANGED_EVENT, readListenNext);
    return () => window.removeEventListener(LISTEN_NEXT_CHANGED_EVENT, readListenNext);
  }, [id, readListenNext]);

  const known = standing != null;
  useEffect(() => {
    setRead(null);
    if (id == null || known) return undefined;
    let current = true;
    musicService.getAlbumById(id)
      .then(album => { if (current) setRead(album as AlbumStanding); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [id, known]);

  if (id == null) return null;

  const album = standing ?? read ?? {};
  const canBeCd = (album.titleStatus ?? 'owned') === 'owned';
  const plainMedium: ListenNextMedium = canBeCd && album.fileQuality === 'none' ? 'cd' : 'digital';
  const held = heldOf(rows, id);
  const inListenNext = held === 'all' || held.length > 0;
  const discs = [...new Set(tracks.map(track => track.disc))].sort((a, b) => a - b);
  const songIdsOf = (disc?: number) => tracks.filter(track => disc == null || track.disc === disc).map(track => track.songId);
  /** The list of a disc, the album's when it is there whole. */
  const discMedium = (disc: number): ListenNextMedium | null =>
    (rows.find(row => row.disc === disc) ?? rows.find(row => !row.disc))?.medium ?? null;
  const albumMedium: ListenNextMedium | null = rows.length > 0 && rows.every(row => (row.medium ?? 'digital') === (rows[0].medium ?? 'digital'))
    ? rows[0].medium ?? 'digital' : null;

  /** Listen Next: the album, a disc or all of them in the list named; out of it with no list. */
  const setListenNext = async (disc?: number | 'all', medium?: ListenNextMedium) => {
    try {
      await musicService.toggleListenNext(id, disc, medium);
      window.dispatchEvent(new Event(LISTEN_NEXT_CHANGED_EVENT));
    } catch (error) {
      toast(`Listen Next was not changed: ${(error as Error).message}`, { tone: 'danger' });
    }
  };

  const choices = (selectedMedium: ListenNextMedium | null, choose: (medium: ListenNextMedium) => void) => (['digital', 'cd'] as const).map(medium => (
    <Menu.Choice key={medium} selected={selectedMedium === medium} disabled={medium === 'cd' && !canBeCd}
      hint={medium === plainMedium ? 'Default' : undefined} onSelect={() => { if (selectedMedium !== medium) choose(medium); }}>
      {medium === 'digital' ? 'Streamed' : 'From the CD'}
    </Menu.Choice>
  ));

  const menu = (
    <>
      <Menu.Separator />
      <Menu.Section title="Listen Next" />
      {/* The album's list: what of it is there moves, all of it; nothing there, the whole album goes. */}
      {choices(albumMedium, medium => { void setListenNext(undefined, medium); })}
      {discs.length > 1 && (
        <Menu.Choice selected={held === 'all'} hint={`${discs.length} discs`}
          onSelect={() => { if (held !== 'all') void setListenNext('all', inListenNext ? undefined : plainMedium); }}>
          All discs
        </Menu.Choice>
      )}
      {inListenNext && (
        <Menu.Item icon={<BsXLg />} hint={Array.isArray(held) ? discsInWords(held) : undefined} onSelect={() => { void setListenNext(); }}>
          Take out of Listen Next
        </Menu.Item>
      )}
      {songIdsOf().length > 0 && (
        <>
          <Menu.Separator />
          <MixtapeEntries songIds={songIdsOf()} onNew={() => setNaming({ songIds: songIdsOf() })} />
        </>
      )}
    </>
  );

  const disc = (number: number): DiscHead => {
    const on = held === 'all' || held.includes(number);
    const medium = on ? discMedium(number) : null;
    const songIds = songIdsOf(number);
    return {
      on,
      medium,
      plainMedium,
      // In on its own: out. Out, or in with the whole album: this disc alone, in its list or the plain one.
      toggle: () => { void (on && held !== 'all' ? setListenNext(number) : setListenNext(number, medium ?? plainMedium)); },
      menu: (
        <>
          <Menu.Section title={`Disc ${number} in Listen Next`} />
          {choices(medium, choice => { void setListenNext(number, choice); })}
          {on && <Menu.Item icon={<BsXLg />} onSelect={() => { void setListenNext(number); }}>Take out of Listen Next</Menu.Item>}
          {songIds.length > 0 && (
            <>
              <Menu.Separator />
              <MixtapeEntries songIds={songIds} heading={`Disc ${number} in mixtapes`} onNew={() => setNaming({ songIds, title: `Disc ${number}` })} />
            </>
          )}
        </>
      ),
    };
  };

  return {
    menu,
    disc,
    dialog: naming ? <NewMixtapeDialog songIds={naming.songIds} onClose={() => setNaming(null)} /> : null,
  };
};

export interface AlbumAtRest {
  title: string;
  artist: string;
  cover: string | null;
  /** Under the title, where the place in the track would be: CD · 12 tracks · 45 min · 2012. */
  line: string;
  /** Its tracks as the player would play them, their ♥ and their dot with them; empty until the rip is read. */
  tracks: PlayerTrack[];
  /** ▶, or a track touched: the album played from there, the full screen then showing it playing. */
  playFrom: (index: number) => void;
  /** Listen Next, the mixtapes, Amperfy: the album's own entries of ⋯, and its discs' heads. */
  actions: AlbumActions;
  /** A new mixtape's name asked over the full screen. */
  dialog: React.ReactNode;
}

/**
 * The album a cover opened in the phone's full screen player, while another
 * plays or nothing does: its rip read for ▶ and its tracks, its place in
 * Listen Next for ⋯. A CD with no rip has nothing to play: its card opens
 * instead (`onNoRip`).
 */
export const useAlbumAtRest = (album: ShownAlbum | null, onNoRip: (albumId: number | string) => void): AlbumAtRest | null => {
  // Undefined while Navidrome is asked for the rip, null when it could not be read.
  const [rip, setRip] = useState<RipTracks | null | undefined>(undefined);
  const albumId = album?.id ?? null;

  useEffect(() => {
    setRip(undefined);
    if (albumId == null) return undefined;
    let current = true;
    musicService.getNavidromeTracks(albumId)
      .then(found => { if (current) setRip(found); })
      .catch(() => { if (current) setRip(null); });
    return () => { current = false; };
  }, [albumId]);

  const playerTracks = album ? playerTracksOf(album, rip) : [];
  const actions = useAlbumActions(albumId, album, playerTracks);
  // Read, and nothing to play: its card says why (on CD only, not ripped yet).
  const noRip = album != null && rip !== undefined && playerTracks.length === 0;
  useEffect(() => { if (noRip) onNoRip(album!.id); }, [noRip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!album || !actions) return null;

  const discs = album.discs || [];
  const trackCount = discs.reduce((count, disc) => count + disc.tracks.length, 0) || playerTracks.length;
  const seconds = discs.reduce((total, disc) => total + disc.tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0), 0)
    || playerTracks.reduce((sum, track) => sum + (track.durationSec || 0), 0);
  const line = [
    album.format,
    discs.length > 1 ? `${discs.length} discs` : null,
    trackCount > 0 ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}` : null,
    playingTime(seconds) || null,
    album.releaseYear ? String(album.releaseYear) : null,
  ].filter(Boolean).join(' · ');

  const menu = (
    <>
      {actions.menu}
      {rip?.found && rip.album && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<BsBoxArrowUpRight />} onSelect={() => { setFullPlayer(false); openListen(rip.album!); }}>
            {isAppleMobile() ? 'Open in Amperfy' : 'Open in Navidrome'}
          </Menu.Item>
        </>
      )}
    </>
  );

  return {
    title: album.title,
    artist: Array.isArray(album.artist) ? album.artist.join(', ') : album.artist || '',
    cover: musicService.getImageUrl(album.cover),
    line,
    tracks: playerTracks,
    playFrom: index => { if (playerTracks.length > 0) player.playAlbum(playerAlbumOf(album, rip), playerTracks, index); },
    actions: { ...actions, menu },
    dialog: actions.dialog,
  };
};
