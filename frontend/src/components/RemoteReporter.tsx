import { useEffect, useRef, useState } from 'react';
import { player, usePlayer } from '../services/player';
import { listenNextQueue } from '../services/listenNextQueue';
import { playAlbumById } from '../utils/playAlbum';
import remote, { deviceName, type RemoteCommand } from '../services/remote';
import toast from './shared/Toast';

/** How often the place in a track is told, while it plays: the remote's bar moves between. */
const POSITION_EVERY_MS = 10_000;
/** How often a page playing nothing says it is still there: a computer asleep goes silent. */
const ALIVE_EVERY_MS = 30_000;
const LOCK = 'dv.remote.speaker';

/** What a browser's refusal to play unasked says to the remote. */
const errorOf = (error: string | null): string | null =>
  !error ? null : /NotAllowed|interact|gesture|user agent|denied/i.test(error) ? 'needs a click to play' : error;

/**
 * Whether this tab speaks for its computer to the remote: one tab alone,
 * the others would each do every command. The first open is it, until a
 * tab starts playing, which takes its place; when it closes, the next.
 * A browser without locks: each tab is.
 */
const useSpeaker = (playing: boolean): boolean => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const [speaker, setSpeaker] = useState(!locks);
  const release = useRef<(() => void) | null>(null);
  const ask = useRef<(steal: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!locks) return undefined;
    let live = true;
    // A request for its turn already waiting: one is enough.
    let queued = false;
    ask.current = (steal: boolean) => {
      if (!steal) {
        if (queued) return;
        queued = true;
      }
      locks.request(LOCK, steal ? { steal: true } : {}, () => new Promise<void>(resolve => {
        if (!steal) queued = false;
        if (!live) { resolve(); return; }
        release.current = resolve;
        setSpeaker(true);
      })).catch(() => {
        // Its place taken by a tab that started playing: it waits for its turn again.
        if (!steal) queued = false;
        release.current = null;
        if (!live) return;
        setSpeaker(false);
        ask.current(false);
      });
    };
    ask.current(false);
    return () => { live = false; release.current?.(); };
  }, [locks]);

  useEffect(() => {
    if (locks && playing && !speaker) ask.current(true);
  }, [locks, playing, speaker]);

  return speaker;
};

/** A command from the remote, done here as a click on the bar would. */
const run = async (command: RemoteCommand): Promise<void> => {
  switch (command.action) {
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'previous': player.previous(); break;
    case 'listenNext':
      if (!(await listenNextQueue.start())) toast('Listen Next has nothing to play', { tone: 'warning' });
      break;
    case 'playAlbum':
      if (!(await playAlbumById(command.albumId, undefined, command.index || 0, false, command.disc || 0))) {
        toast('Not in Navidrome: this album has no rip to play', { tone: 'warning' });
      }
      break;
    default: break;
  }
};

/**
 * On a computer, the player told to the remote: what it plays, as it changes
 * and every few seconds while it plays; and the remote's commands, done.
 * Nothing on screen.
 */
const RemoteReporter: React.FC = () => {
  const album = usePlayer(state => state.album);
  const tracks = usePlayer(state => state.tracks);
  const index = usePlayer(state => state.index);
  const playing = usePlayer(state => state.playing);
  const error = usePlayer(state => state.error);
  const name = useRef(deviceName());
  const speaker = useSpeaker(playing);

  const tell = () => {
    // On an appliance (Salon), the computer itself plays nothing: the remote is told so.
    const state = player.getState().output.kind === 'local' ? player.getState() : { ...player.getState(), playing: false, album: null, tracks: [], index: 0, duration: 0, error: null };
    const track = state.tracks[state.index];
    remote.report({
      name: name.current,
      playing: state.playing,
      album: state.album ? { id: state.album.id, title: state.album.title, artist: state.album.artist, cover: track?.cover || state.album.cover } : null,
      track: track ? { title: track.title, disc: track.disc, no: track.no } : null,
      index: state.index,
      count: state.tracks.length,
      position: Math.round(player.currentTime()),
      duration: Math.round(state.duration || track?.durationSec || 0),
      error: errorOf(state.error),
    }).catch(() => undefined);
  };

  // Its commands, from the remote, while this tab speaks for its computer; what it plays told each time its connection opens.
  useEffect(() => {
    if (!speaker) return undefined;
    return remote.listen(command => { void run(command).catch(e => toast((e as Error).message, { tone: 'danger' })); }, tell);
  }, [speaker]); // eslint-disable-line react-hooks/exhaustive-deps

  // What it plays, at once when it changes.
  useEffect(() => { if (speaker) tell(); }, [speaker, album, tracks, index, playing, error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Its place in the track now and then while it plays; that it is there, less often, while it does not.
  useEffect(() => {
    if (!speaker) return undefined;
    const timer = window.setInterval(tell, playing ? POSITION_EVERY_MS : ALIVE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [speaker, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

export default RemoteReporter;
