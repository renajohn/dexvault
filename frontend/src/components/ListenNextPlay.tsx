import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BsArrowCounterclockwise, BsBoxArrowUpRight, BsCheckLg, BsPauseFill, BsPlayFill, BsRepeat } from 'react-icons/bs';
import musicService, { type AlbumLength, type ListenNextDeparture, type ListenNextPlayState } from '../services/musicService';
import { LISTEN_NEXT_LEFT_EVENT, localOutputName, player, sameOutput, usePlayer, type PlayerOutput, type PlayerState } from '../services/player';
import { useOutputs } from '../services/outputs';
import { listenNextQueue, playingKey } from '../services/listenNextQueue';
import { entryKey, keyOf, type EntryKey } from '../utils/listenNextEntry';
import { amperfyUrl, isAppleMobile } from '../utils/navidrome';
import { readStored, writeStored } from '../utils/safeStorage';
import CoverButton from './shared/CoverButton';
import Button from './shared/Button';
import Menu, { MenuChevron } from './shared/Menu';
import './ListenNextPlay.css';

/** How long an album played to its end stays on the page, greyed, to be kept. */
export const GRACE_MS = 10_000;
const COLLAPSE_MS = 600;
/** Played in Amperfy: the page finds out when it is looked at again, or within a minute while it is. */
const POLL_MS = 60_000;
const SEEN_KEY = 'dexvault.listenNext.seenDepartures';

interface ListAlbum {
  id: number;
  title?: string;
  titleStatus?: string;
  /** One disc of the album in the list, null or absent for the whole album. */
  disc?: number | null;
  [key: string]: unknown;
}

/** An entry leaving the list, as the banner shows it. */
type LeavingItem = ListAlbum & { departureId: number };

const readSeen = (): Set<number> => {
  try {
    const value = JSON.parse(readStored(SEEN_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id: unknown) => typeof id === 'number') : []);
  } catch {
    return new Set();
  }
};

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Seconds left of the entry the player plays from Listen Next, after its key ("12:2|600"); null otherwise. */
const remainingOf = (state: PlayerState): string | null => {
  if (state.queue !== 'listenNext' || !state.album?.id) return null;
  const after = state.tracks.slice(state.index + 1).reduce((sum, track) => sum + (track.durationSec || 0), 0);
  const left = Math.max(0, (state.duration || 0) - state.position) + after;
  // By the minute: the banner need not draw again at each tick.
  return `${playingKey(state.album)}|${Math.ceil(left / 60) * 60}`;
};

/**
 * Playing Listen Next from its banner: Repeat, the albums leaving it once
 * played, kept here or not, and their lengths. The list itself stays the
 * page's (`albums`), read again with `refreshAlbums`.
 */
export const useListenNextPlay = (albums: ListAlbum[], refreshAlbums: () => Promise<unknown>, setAlbums: (albums: ListAlbum[]) => void) => {
  const [play, setPlay] = useState<ListenNextPlayState | null>(null);
  const [seen, setSeen] = useState<Set<number>>(readSeen);
  const [startedAt, setStartedAt] = useState<Record<number, number>>({});
  const [collapsing, setCollapsing] = useState<Set<number>>(() => new Set());
  const playingEntry = usePlayer(state => (state.playing ? playingKey(state.album) : null));

  const load = useCallback(async () => {
    try {
      const state = await musicService.getListenNextPlay();
      setPlay(state);
      listenNextQueue.setRepeat(state.repeat);
    } catch {
      // Without it the banner is the list alone, as before.
    }
  }, []);

  const reload = useCallback(() => Promise.all([refreshAlbums(), load()]), [refreshAlbums, load]);

  useEffect(() => {
    const looked = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', looked);
    window.addEventListener('focus', looked);
    window.addEventListener(LISTEN_NEXT_LEFT_EVENT, reload);
    const timer = setInterval(looked, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', looked);
      window.removeEventListener('focus', looked);
      window.removeEventListener(LISTEN_NEXT_LEFT_EVENT, reload);
      clearInterval(timer);
    };
  }, [load, reload]);

  // Listen Next can change while it plays here: the player goes by the list as it now is.
  // A new album has a length to tell, and maybe no rip.
  const ids = albums.map(keyOf).join(',');
  useEffect(() => {
    listenNextQueue.noteList(ids ? ids.split(',') : []);
    load();
  }, [ids, load]);

  const markSeen = useCallback((departureId: number) => {
    setSeen(previous => {
      const next = new Set(previous).add(departureId);
      writeStored(SEEN_KEY, JSON.stringify([...next].slice(-100)));
      return next;
    });
  }, []);

  /** Departures to show: not seen in this browser, and not back in the list. */
  const departures = useMemo(() => (play?.departures || [])
    .filter(departure => !seen.has(departure.id) && !albums.some(album => keyOf(album) === entryKey(departure.albumId, departure.disc))),
  [play, seen, albums]);

  // The grace starts once the entry is no longer playing: its last track goes on to its end first.
  useEffect(() => {
    const now = Date.now();
    const waiting = departures.filter(departure => startedAt[departure.id] == null && entryKey(departure.albumId, departure.disc) !== playingEntry);
    if (waiting.length > 0) setStartedAt(previous => ({ ...previous, ...Object.fromEntries(waiting.map(departure => [departure.id, now])) }));
  }, [departures, playingEntry, startedAt]);

  useEffect(() => {
    const timers = departures
      .filter(departure => startedAt[departure.id] != null && !collapsing.has(departure.id))
      .map(departure => setTimeout(() => {
        setCollapsing(previous => new Set(previous).add(departure.id));
        setTimeout(() => markSeen(departure.id), reduceMotion() ? 0 : COLLAPSE_MS);
      }, Math.max(0, startedAt[departure.id] + GRACE_MS - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [departures, startedAt, collapsing, markSeen]);

  /** The list with the entries leaving it at their places. */
  const items = useMemo(() => {
    const list: Array<ListAlbum | LeavingItem> = [...albums];
    for (const departure of departures) {
      const item: LeavingItem = { ...(departure.album as ListAlbum), disc: departure.disc || null, departureId: departure.id };
      const at = departure.beforeKey == null ? -1 : list.findIndex(album => keyOf(album) === departure.beforeKey);
      if (at < 0) list.push(item);
      else list.splice(at, 0, item);
    }
    return list;
  }, [albums, departures]);

  const departureOf = useCallback((key: EntryKey): ListenNextDeparture | undefined =>
    departures.find(departure => entryKey(departure.albumId, departure.disc) === key), [departures]);

  const keep = useCallback(async (departureId: number) => {
    try {
      const result = await musicService.keepListenNextDeparture(departureId);
      setAlbums(result.albums as ListAlbum[]);
    } finally {
      markSeen(departureId);
      load();
    }
  }, [setAlbums, markSeen, load]);

  const setRepeat = useCallback(async (repeat: boolean) => {
    setPlay(previous => (previous ? { ...previous, repeat } : previous));
    listenNextQueue.setRepeat(repeat);
    try {
      await musicService.setListenNextRepeat(repeat);
    } catch {
      load();
    }
  }, [load]);

  /** A mixtape played shuffled from Listen Next, from its next start: in an order drawn once, the same on the Mac and in Amperfy. */
  const setShuffled = useCallback(async (albumId: number, shuffled: boolean) => {
    setPlay(previous => (previous ? {
      ...previous,
      shuffled: shuffled ? [...(previous.shuffled || []), albumId] : (previous.shuffled || []).filter(id => id !== albumId),
    } : previous));
    try {
      await musicService.setListenNextShuffled(albumId, shuffled);
    } finally {
      load();
    }
  }, [load]);

  return {
    play, items, departureOf, keep, setRepeat, setShuffled,
    /** An entry leaving: greyed, its ring running down; one still playing its last track is not yet. */
    leavingState: (key: EntryKey): { departureId: number; startedAt: number; collapsing: boolean } | null => {
      const departure = departureOf(key);
      if (!departure || startedAt[departure.id] == null) return null;
      return { departureId: departure.id, startedAt: startedAt[departure.id], collapsing: collapsing.has(departure.id) };
    },
    /** Taken out of the banner at once, as ✕ on a card leaving already. */
    dismiss: markSeen,
  };
};

interface ControlsProps {
  count: number;
  play: ListenNextPlayState | null;
  onRepeat: (repeat: boolean) => void;
}

/** ▶ and Repeat, in the banner's header in place of its count. */
export const ListenNextControls: React.FC<ControlsProps> = ({ count, play, onRepeat }) => {
  const here = usePlayer(state => state.queue === 'listenNext' && state.album !== null);
  const playing = usePlayer(state => state.playing);
  const [starting, setStarting] = useState(false);
  const appleMobile = isAppleMobile();
  // An iPhone plays in Amperfy, unless its output is an appliance of the house (Salon): then as a computer, there.
  const output = usePlayer(state => state.output);
  const amperfy = appleMobile && output.kind === 'local';
  const known = useOutputs();
  const repeat = play?.repeat ?? false;
  const nothing = play !== null && (amperfy ? !play.playlistId : play.ripped.length === 0);
  const albums = `${count} album${count === 1 ? '' : 's'}`;
  const openAmperfy = () => { if (play?.playlistId) window.location.href = amperfyUrl(play.playlistId, 'playlist', { repeat }); };
  // The outputs, the current one ✓, to start Listen Next there, which is then the output; an iPhone's own is Amperfy, apart.
  const elsewhere: PlayerOutput[] = known.length === 0 ? [] : [
    ...(appleMobile ? [] : [{ kind: 'local' } as PlayerOutput]),
    ...known.filter(one => one.reachable || sameOutput(output, { kind: 'renderer', id: one.id, name: one.name }))
      .map(one => ({ kind: 'renderer', id: one.id, name: one.name }) as PlayerOutput),
  ];

  const start = async () => {
    setStarting(true);
    try {
      await listenNextQueue.start();
    } finally {
      setStarting(false);
    }
  };

  const click = async () => {
    if (amperfy) {
      openAmperfy();
      return;
    }
    if (here) {
      player.toggle();
      return;
    }
    await start();
  };

  const pause = here && playing;
  const where = amperfy ? ' in Amperfy' : output.kind === 'renderer' ? ` on ${output.name}` : '';
  const title = nothing ? 'Nothing ripped yet' : pause ? 'Pause Listen Next' : `Play Listen Next · ${albums}${where}`;
  // Its ▾: the other outputs; Amperfy on an iPhone playing on an appliance.
  const more = elsewhere.length > 0 || (appleMobile && !amperfy && Boolean(play?.playlistId));
  return (
    <span className="listen-next-controls">
      {/* Navidrome's own player, in a tab of its own: on an iPhone ▶ opens Amperfy already. Before ▶ and Repeat, so they
          keep their place at the end whether it shows or not. */}
      {!appleMobile && play?.playlistUrl && (
        <a className="listen-next-controls__navidrome" href={play.playlistUrl} target="_blank" rel="noopener noreferrer"
          title="Play Listen Next in Navidrome, in another tab">
          Play on Navidrome <BsBoxArrowUpRight aria-hidden="true" />
        </a>
      )}
      {/* ▶ and Repeat side by side as one, the switch's height: gold while it plays, gold when Repeat is on. */}
      <span className="ui-button-group">
        <Button className="listen-next-controls__button" active={here || undefined} loading={starting}
          onClick={click} disabled={nothing} title={title} aria-label={title}
          icon={pause ? <BsPauseFill /> : <BsPlayFill />} />
        {more && (
          <Menu align="end" label="Where to play Listen Next" trigger={(props, open) => (
            <Button {...props} className="listen-next-controls__button ui-button--split" active={here || undefined}
              aria-label="Where to play Listen Next" title="Where to play">
              <MenuChevron open={open} />
            </Button>
          )}>
            {elsewhere.length > 0 && <Menu.Section title="Play on" />}
            {elsewhere.map(target => (
              <Menu.Choice key={target.kind === 'local' ? 'local' : target.id} selected={sameOutput(target, output)}
                onSelect={() => { player.setOutput(target, { transfer: false }); void start(); }}>
                {target.kind === 'renderer' ? target.name : localOutputName()}
              </Menu.Choice>
            ))}
            {appleMobile && !amperfy && play?.playlistId && (
              <>
                {elsewhere.length > 0 && <Menu.Separator />}
                <Menu.Item icon={<BsBoxArrowUpRight />} onSelect={openAmperfy}>Open in Amperfy</Menu.Item>
              </>
            )}
          </Menu>
        )}
        <Button className="listen-next-controls__button" active={repeat} onClick={() => onRepeat(!repeat)} aria-pressed={repeat}
          title={repeat ? 'Repeat: keep albums once played' : 'Albums leave the list once played'}
          aria-label="Repeat" icon={<BsRepeat />} />
      </span>
    </span>
  );
};

interface LeavingProps {
  title: string;
  startedAt: number;
  onKeep: () => void;
}

/** On a cover leaving the list: Played, and Keep here in a ring that runs down clockwise. */
export const LeavingOverlay: React.FC<LeavingProps> = ({ title, startedAt, onKeep }) => {
  // A card drawn again mid-way goes on where the ring was.
  const elapsed = Math.min(GRACE_MS, Date.now() - startedAt);
  return (
    <div className="listen-next-leaving" onClick={event => event.stopPropagation()}>
      <span className="cover-tag listen-next-leaving__played"><BsCheckLg aria-hidden="true" />Played</span>
      <CoverButton className="listen-next-leaving__keep" size="large" reveal="always" onClick={onKeep}
        title="Keep here" label={`Keep ${title} in Listen Next`}>
        <BsArrowCounterclockwise className="listen-next-leaving__icon" aria-hidden="true" />
        <svg className="listen-next-leaving__ring" viewBox="0 0 40 40" aria-hidden="true"
          style={{ '--leave-ms': `${GRACE_MS}ms`, '--leave-delay': `-${elapsed}ms` } as React.CSSProperties}>
          <circle className="listen-next-leaving__ring-track" cx="20" cy="20" r="18" />
          <circle className="listen-next-leaving__ring-left" cx="20" cy="20" r="18" />
        </svg>
      </CoverButton>
      <span className="listen-next-leaving__label">Keep here</span>
    </div>
  );
};

const formatLength = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
};

/**
 * The words of the line under the cards: `5 discs · 63 tracks · ~4 h 10`, or
 * the time left while it plays; a disc of an album counts as one disc, its
 * length its own.
 */
export const summaryOf = (
  albums: ListAlbum[], lengths: Record<string, AlbumLength>, playing: { key: EntryKey; leftSec: number } | null, repeat: boolean,
): string | null => {
  let discs = 0;
  let digital = 0;
  let tracks = 0;
  let seconds = 0;
  let missing = false;
  for (const album of albums) {
    const length = lengths[keyOf(album)];
    if (album.titleStatus === 'digital') digital++;
    else discs += Math.max(1, length?.discs || 0);
    if (!length) {
      missing = true;
      continue;
    }
    tracks += length.tracks;
    if (length.missing > 0) missing = true;
    if (!(playing && playing.key === keyOf(album) && !repeat)) seconds += length.durationSec;
  }
  const left = Boolean(playing) && !repeat;
  if (left && playing) seconds += playing.leftSec;
  const parts = [
    discs > 0 && `${discs} disc${discs === 1 ? '' : 's'}`,
    digital > 0 && `${digital} digital`,
    tracks > 0 && `${tracks} track${tracks === 1 ? '' : 's'}`,
    seconds > 0 && `${missing || left ? '~' : ''}${formatLength(seconds)}${left ? ' left' : ''}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};

interface SummaryProps {
  albums: ListAlbum[];
  play: ListenNextPlayState | null;
}

export const ListenNextSummary: React.FC<SummaryProps> = ({ albums, play }) => {
  const remaining = usePlayer(remainingOf);
  if (!play) return null;
  const [key, leftSec] = remaining ? remaining.split('|') : [];
  const text = summaryOf(albums, play.lengths, remaining ? { key, leftSec: Number(leftSec) } : null, play.repeat);
  return text ? <div className="listen-next-summary">{text}</div> : null;
};
