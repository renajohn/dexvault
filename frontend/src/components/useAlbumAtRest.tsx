import React, { useEffect, useState } from 'react';
import { BsBoxArrowUpRight, BsXLg } from 'react-icons/bs';
import musicService, { type ListenNextMedium, type RipTracks } from '../services/musicService';
import { player } from '../services/player';
import { setFullPlayer, type ShownAlbum } from '../services/phoneDoor';
import { playerAlbumOf, playerTracksOf } from '../utils/playAlbum';
import { playingTime } from '../utils/albumHead';
import { isAppleMobile, openListen } from '../utils/navidrome';
import Menu from './shared/Menu';
import { toast } from './shared/Toast';
import { mediumOf } from './ListenNextLists';
import { MixtapeEntries, NewMixtapeDialog } from './MixtapeMenu';

/** Told by Listen Next's ⋯ entries here: the page's banner reads its list again. */
export const LISTEN_NEXT_CHANGED_EVENT = 'dexvault:listen-next-changed';

export interface AlbumAtRest {
  title: string;
  artist: string;
  cover: string | null;
  /** Under the title, where the place in the track would be: CD · 12 tracks · 45 min · 2012. */
  line: string;
  /** Its tracks as the player would play them; empty until the rip is read. */
  tracks: { title: string; durationSec: number | null }[];
  /** ▶, or a track touched: the album played from there, the full screen then showing it playing. */
  playFrom: (index: number) => void;
  /** Listen Next, the mixtapes, Amperfy: the album's own entries of ⋯. */
  menu: React.ReactNode;
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
  const [medium, setMedium] = useState<ListenNextMedium | null>(null);
  const [naming, setNaming] = useState(false);
  const albumId = album?.id ?? null;

  useEffect(() => {
    setRip(undefined);
    setMedium(null);
    setNaming(false);
    if (albumId == null) return undefined;
    let current = true;
    musicService.getNavidromeTracks(albumId)
      .then(found => { if (current) setRip(found); })
      .catch(() => { if (current) setRip(null); });
    musicService.getListenNextAlbums()
      .then(list => {
        const entry = (list as Array<{ id: number }>).find(one => one.id === Number(albumId));
        if (current) setMedium(entry ? mediumOf(entry) : null);
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [albumId]);

  const playerTracks = album ? playerTracksOf(album, rip) : [];
  // Read, and nothing to play: its card says why (on CD only, not ripped yet).
  const noRip = album != null && rip !== undefined && playerTracks.length === 0;
  useEffect(() => { if (noRip) onNoRip(album!.id); }, [noRip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!album) return null;

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
  const canBeCd = (album.titleStatus ?? 'owned') === 'owned';
  const songIds = playerTracks.map(track => track.songId);

  /** Listen Next: the album in the list named, or out of it (null). */
  const setListenNext = async (next: ListenNextMedium | null) => {
    try {
      if (next === null) await musicService.toggleListenNext(album.id);
      else await musicService.toggleListenNext(album.id, undefined, next);
      setMedium(next);
      window.dispatchEvent(new Event(LISTEN_NEXT_CHANGED_EVENT));
    } catch (error) {
      toast(`Listen Next was not changed: ${(error as Error).message}`, { tone: 'danger' });
    }
  };

  const menu = (
    <>
      <Menu.Separator />
      <Menu.Section title="Listen Next" />
      <Menu.Choice selected={medium === 'digital'} onSelect={() => { if (medium !== 'digital') void setListenNext('digital'); }}>Streamed</Menu.Choice>
      <Menu.Choice selected={medium === 'cd'} disabled={!canBeCd} onSelect={() => { if (medium !== 'cd') void setListenNext('cd'); }}>From the CD</Menu.Choice>
      {medium && <Menu.Item icon={<BsXLg />} onSelect={() => { void setListenNext(null); }}>Take out of Listen Next</Menu.Item>}
      {songIds.length > 0 && (
        <>
          <Menu.Separator />
          <MixtapeEntries songIds={songIds} onNew={() => setNaming(true)} />
        </>
      )}
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
    tracks: playerTracks.map(track => ({ title: track.title, durationSec: track.durationSec })),
    playFrom: index => { if (playerTracks.length > 0) player.playAlbum(playerAlbumOf(album, rip), playerTracks, index); },
    menu,
    dialog: naming ? <NewMixtapeDialog songIds={songIds} onClose={() => setNaming(false)} /> : null,
  };
};
