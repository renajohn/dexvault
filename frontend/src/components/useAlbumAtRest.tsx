import React, { useCallback, useEffect, useState } from 'react';
import { BsBoxArrowUpRight, BsHeadphones, BsXLg } from 'react-icons/bs';
import musicService, { type RipTracks } from '../services/musicService';
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

/** A row of Listen Next as the server sends it: the album, and one disc of it or none. */
interface ListenNextRow { id: number; disc?: number | null }

/** A disc's head in the phone player's tracks: its Listen Next state, what its slides do, its menu. */
export interface DiscHead {
  /** The disc in Listen Next, on its own or with the whole album. */
  on: boolean;
  /** Out of Listen Next, or in; the whole album there, this disc alone instead. */
  toggle: () => void;
  /** Its menu's entries: Listen Next, its mixtapes. */
  menu: React.ReactNode;
}

/**
 * What ⋯ and the discs' heads do for an album in the phone's full screen
 * player, at rest or playing: Listen Next for the album (in, all discs, out)
 * and for each disc, the album or a disc in a mixtape. Listen
 * Next is read as the album is shown and again when changed anywhere
 * (`LISTEN_NEXT_CHANGED_EVENT`).
 */
export interface AlbumActions {
  menu: React.ReactNode;
  disc: (disc: number) => DiscHead;
  /** A new mixtape's name asked over the full screen. */
  dialog: React.ReactNode;
}

export const useAlbumActions = (albumId: number | string | null, tracks: PlayerTrack[]): AlbumActions | null => {
  const [rows, setRows] = useState<ListenNextRow[]>([]);
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


  if (id == null) return null;

  const held = heldOf(rows, id);
  const inListenNext = held === 'all' || held.length > 0;
  const discs = [...new Set(tracks.map(track => track.disc))].sort((a, b) => a - b);
  const songIdsOf = (disc?: number) => tracks.filter(track => disc == null || track.disc === disc).map(track => track.songId);
  /** Listen Next: the album in or out, a disc in or out, or all of its discs. */
  const setListenNext = async (disc?: number | 'all') => {
    try {
      await musicService.toggleListenNext(id, disc);
      window.dispatchEvent(new Event(LISTEN_NEXT_CHANGED_EVENT));
    } catch (error) {
      toast(`Listen Next was not changed: ${(error as Error).message}`, { tone: 'danger' });
    }
  };

  const menu = (
    <>
      <Menu.Separator />
      <Menu.Section title="Listen Next" />
      {discs.length > 1 ? (
        <Menu.Choice selected={held === 'all'} hint={`${discs.length} discs`}
          onSelect={() => { if (held !== 'all') void setListenNext('all'); }}>
          All discs
        </Menu.Choice>
      ) : !inListenNext && (
        <Menu.Item icon={<BsHeadphones />} onSelect={() => { void setListenNext(); }}>Listen to it next</Menu.Item>
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
    const alone = on && held !== 'all';
    const songIds = songIdsOf(number);
    return {
      on,
      // In on its own: out. Out, or in with the whole album: this disc alone.
      toggle: () => { void setListenNext(number); },
      menu: (
        <>
          <Menu.Section title={`Disc ${number} in Listen Next`} />
          {alone ? (
            <Menu.Item icon={<BsXLg />} onSelect={() => { void setListenNext(number); }}>Take out of Listen Next</Menu.Item>
          ) : (
            <Menu.Item icon={<BsHeadphones />} onSelect={() => { void setListenNext(number); }}>
              {on ? `Disc ${number} alone` : 'Listen to it next'}
            </Menu.Item>
          )}
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
  /** Under the title, where the place in the track would be: CD · 12 tracks · 45 min · 2012; "On CD only" first when nothing plays. */
  line: React.ReactNode;
  /** Whether ▶ has anything to play: a rip in Navidrome. */
  playable: boolean;
  /** Its tracks as the player would play them, their ♥ and their dot with them; empty until the rip is read. */
  tracks: PlayerTrack[];
  /** The tracks to show: the player's, or for a CD with no rip the CD's own, which play nothing. */
  shownTracks: PhoneTrackLike[];
  /** ▶, or a track touched: the album played from there, the full screen then showing it playing. */
  playFrom: (index: number) => void;
  /** Listen Next, the mixtapes, Amperfy: the album's own entries of ⋯, and its discs' heads. */
  actions: AlbumActions;
  /** A new mixtape's name asked over the full screen. */
  dialog: React.ReactNode;
}

/** A line of the player's tracks (PhonePlayer.PhoneTrack), for a CD with no rip: no song to play. */
export interface PhoneTrackLike { title: string; durationSec: number | null; disc?: number; songId?: string; starred?: boolean; popular?: boolean }

/**
 * The album a cover opened in the phone's full screen player, while another
 * plays or nothing does: its rip read for ▶ and its tracks, its place in
 * Listen Next for ⋯. A CD with no rip has nothing to play: ▶ is grey, the
 * line says so, its tracks are the CD's own.
 */
export const useAlbumAtRest = (album: ShownAlbum | null): AlbumAtRest | null => {
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
  const actions = useAlbumActions(albumId, playerTracks);

  if (!album || !actions) return null;
  // Read, and nothing to play: on CD only, not ripped yet.
  const noRip = rip !== undefined && playerTracks.length === 0;

  const discs = album.discs || [];
  const trackCount = discs.reduce((count, disc) => count + disc.tracks.length, 0) || playerTracks.length;
  const seconds = discs.reduce((total, disc) => total + disc.tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0), 0)
    || playerTracks.reduce((sum, track) => sum + (track.durationSec || 0), 0);
  const shape = [
    noRip ? null : album.format,
    discs.length > 1 ? `${discs.length} discs` : null,
    trackCount > 0 ? `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}` : null,
    playingTime(seconds) || null,
    album.releaseYear ? String(album.releaseYear) : null,
  ].filter(Boolean).join(' · ');
  // Nothing to play: a CD not ripped, or an album wished or gone from Navidrome.
  const hasCd = album.titleStatus !== 'digital' && album.titleStatus !== 'wish';
  const line = noRip ? (
    hasCd ? <><span className="now-playing-rest__cd" title="Put the CD on, or rip it">On CD only</span>{shape && ` · ${shape}`}</>
      : <>{album.titleStatus === 'wish' ? 'Wished' : 'No files'}{shape && ` · ${shape}`}</>
  ) : shape;
  const shownTracks: PhoneTrackLike[] = playerTracks.length > 0 ? playerTracks
    : discs.flatMap(disc => disc.tracks.map(track => ({ title: track.title, durationSec: track.durationSec ?? null, disc: disc.number })));

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
    playable: playerTracks.length > 0,
    tracks: playerTracks,
    shownTracks,
    playFrom: index => { if (playerTracks.length > 0) player.playAlbum(playerAlbumOf(album, rip), playerTracks, index); },
    actions: { ...actions, menu },
    dialog: actions.dialog,
  };
};
