import React from 'react';
import { BsXLg } from 'react-icons/bs';
import { MdPlaylistAdd, MdPlaylistPlay } from 'react-icons/md';
import Menu from './shared/Menu';
import toast from './shared/Toast';
import { player, usePlayer, type PlayerAlbum, type PlayerTrack } from '../services/player';
import type { PhoneQueue } from './PhonePlayer';

/**
 * A menu's entries for a track to come of what plays: next, last, or taken
 * out of the play. The track playing and those heard have none.
 */
export const UpcomingEntries: React.FC<{ at: number }> = ({ at }) => {
  const index = usePlayer(state => state.index);
  const count = usePlayer(state => state.tracks.length);
  if (at <= index) return null;
  return (
    <>
      <Menu.Item icon={<MdPlaylistPlay />} disabled={at === index + 1} onSelect={() => player.moveTrack(at, index + 1)}>Play next</Menu.Item>
      <Menu.Item icon={<MdPlaylistAdd />} disabled={at === count - 1} onSelect={() => player.moveTrack(at, count - 1)}>Play last</Menu.Item>
      <Menu.Item icon={<BsXLg />} onSelect={() => player.removeTrack(at)}>Take out</Menu.Item>
    </>
  );
};

/** Tracks put after the one playing, or at the end of what plays, said by a toast: `title`, a track's or an album's. */
export const enqueue = (tracks: PlayerTrack[], where: 'next' | 'last', from: PlayerAlbum, title: string): void => {
  if (player.enqueue(tracks, where, from)) toast(`${title} plays ${where}`, { tone: 'success' });
};

/** A menu's entries putting tracks of an album that does not play next or last in what plays. */
export const EnqueueEntries: React.FC<{ tracks: PlayerTrack[]; from: PlayerAlbum; title: string }> = ({ tracks, from, title }) => (
  <>
    <Menu.Item icon={<MdPlaylistPlay />} onSelect={() => enqueue(tracks, 'next', from, title)}>Play next</Menu.Item>
    <Menu.Item icon={<MdPlaylistAdd />} onSelect={() => enqueue(tracks, 'last', from, title)}>Play last</Menu.Item>
  </>
);

/** The phone's tracks of what plays: those to come held move, and their menus put them next, last, or out. */
export const playingQueue = (index: number): PhoneQueue => ({
  movable: { first: index + 1, move: (from, to) => { player.moveTrack(from, to); } },
  entries: at => (at > index ? <UpcomingEntries at={at} /> : null),
});

/** The phone's tracks of an album at rest while another plays: their menus put them next or last in what plays. */
export const restQueue = (tracks: PlayerTrack[], from: PlayerAlbum): PhoneQueue => ({
  entries: at => (tracks[at] ? <EnqueueEntries tracks={[tracks[at]]} from={from} title={tracks[at].title} /> : null),
});
