import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsChatQuote, BsHeart, BsHeartFill, BsMusicNoteList, BsPauseFill, BsPlayFill, BsSkipBackwardFill, BsSkipForwardFill, BsSpeaker, BsThreeDots, BsX } from 'react-icons/bs';
import { player, usePlayer } from '../services/player';
import { seedFavourite, setFavourite, useFavourite } from '../services/favourites';
import { useOutputs, type Output } from '../services/outputs';
import { isComputer } from '../utils/isComputer';
import toast from './shared/Toast';
import Button, { IconButton } from './shared/Button';
import Menu, { MenuChevron } from './shared/Menu';
import PlayerTracks from './PlayerTracks';
import OutputMenu, { OutputEntries } from './OutputMenu';
import OutputSettings from './OutputSettings';
import { setFullPlayer, showPlaying, useCovered, useShownAlbum } from '../services/phoneDoor';
import PhonePlayer from './PhonePlayer';
import NowPlayingDisc from './NowPlayingDisc';
import { useAlbumAtRest } from './useAlbumAtRest';
import { useMedia } from '../utils/useNarrow';
import { amperfyUrl, isAppleMobile } from '../utils/navidrome';
// Listen Next registers itself with the player, to go on after a reload whatever the page; the bar asks it what comes next.
import { listenNextQueue, playingKey } from '../services/listenNextQueue';
import { parseEntryKey } from '../utils/listenNextEntry';
import musicService from '../services/musicService';
import { loadPlayable } from '../utils/playAlbum';
import './PlayerBar.css';

const time = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The next track is announced this long before the one playing ends. */
const ANNOUNCE_SEC = 10;

/** What comes after the album playing in Listen Next: the albums' length, the first track of the next. */
interface Ahead {
  seconds: number;
  first: { title: string; artist: string } | null;
}

/**
 * Of Listen Next, what is left after the album playing: read as an album
 * starts (`started`, its tracks, change even when the same album starts
 * again) and as it plays on after a pause, the list having moved meanwhile.
 * On an appliance, the entries to come are the server's (`upcoming`).
 */
const useListenNextAhead = (playingEntry: string | null, fromListenNext: boolean, started: unknown, playing: boolean, upcoming: string[] | null): Ahead | null => {
  const [ahead, setAhead] = useState<Ahead | null>(null);
  const coming = upcoming ? upcoming.join(',') : null;
  useEffect(() => {
    // Kept while read again, for the time left not to jump; gone out of Listen Next.
    if (!fromListenNext || playingEntry == null) {
      setAhead(null);
      return undefined;
    }
    let live = true;
    const ids = coming != null ? (coming ? coming.split(',') : []) : listenNextQueue.upcoming(playingEntry);
    const next = ids.length > 0 ? parseEntryKey(ids[0]) : null;
    Promise.all([
      musicService.getListenNextPlay().catch(() => null),
      next ? loadPlayable(next.albumId, { listenNext: true, disc: next.disc }).catch(() => null) : Promise.resolve(null),
    ]).then(([play, next]) => {
      if (!live) return;
      const seconds = ids.reduce((sum, id) => sum + (play?.lengths[id]?.durationSec || 0), 0);
      const track = next?.tracks[0];
      setAhead({ seconds, first: track ? { title: track.title, artist: track.artist ?? next!.album.artist } : null });
    });
    return () => { live = false; };
  }, [playingEntry, fromListenNext, started, playing, coming]);
  return ahead;
};

/** A time left: "38 min", "1 h 12". */
const leftText = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};

/**
 * On a phone whose output is an appliance playing nothing, in MusicDex: the
 * appliance, to choose another, and Listen Next to start there.
 */
const IdleBar: React.FC<{ name: string; away: boolean }> = ({ name, away }) => (
  <div className="player-bar player-bar-out player-bar--idle" role="region" aria-label={`Nothing playing on ${name}`}>
    <div className="player-bar-idle">
      <span className="player-bar-idle__words">Nothing playing</span>
      <OutputMenu drop="up" align="start" trigger={(props, open) => (
        <button type="button" {...props} className="menu-pill player-bar-idle__output">
          <span className="menu-pill__lead"><BsSpeaker /></span>
          {away ? `${name}, away` : name}
          <MenuChevron open={open} />
        </button>
      )} />
      <span className="player-bar-idle__space" />
      <Button size="sm" icon={<BsPlayFill />} disabled={away}
        onClick={() => { void listenNextQueue.start().then(started => { if (!started) toast('Listen Next has nothing to play', { tone: 'warning' }); }); }}>
        Listen Next
      </Button>
    </div>
  </div>
);

/**
 * What DexVault plays, at the foot of every page: the cover, the track and
 * its album, ♥ and the words; ⏮ ⏯ ⏭ and the track's time; what is left
 * of the album, the tracks, the output and ✕. It takes its own room, so
 * nothing goes under it: the pages and the album's card end above it.
 * Its output may be an appliance of the house (Salon): the bar then shows
 * what plays there, and its buttons command it.
 */
const PlayerBar: React.FC = () => {
  const navigate = useNavigate();
  const album = usePlayer(state => state.album);
  const track = usePlayer(state => state.tracks[state.index]);
  // From a list, ⏭ on an album's last track goes on to the next album.
  const hasNext = usePlayer(state => state.index + 1 < state.tracks.length || state.queue !== null);
  const playing = usePlayer(state => state.playing);
  const position = usePlayer(state => state.position);
  const duration = usePlayer(state => state.duration);
  const shown = usePlayer(state => state.barShown);
  const error = usePlayer(state => state.error);
  const lyricsOpen = usePlayer(state => state.lyricsOpen);
  const favourite = useFavourite(track?.songId);
  const [tracksOpen, setTracksOpen] = useState(false);
  const output = usePlayer(state => state.output);
  const outputStatus = usePlayer(state => state.outputStatus);
  const upcoming = usePlayer(state => state.upcoming);
  const known = useOutputs();
  const inMusic = useLocation().pathname.startsWith('/musicdex');
  const outputName = output.kind === 'renderer' ? output.name : '';
  // A phone's width: a pill at the foot, full screen at a tap.
  const phone = useMedia('(max-width: 767px)');
  // On a phone, a record's card over the whole page: the pill gives way to the disc at its foot, and its room
  // goes back to the card. The full screen stays, the disc opening it.
  const covered = useCovered() && phone;
  // The album a cover opened in the full screen player: at rest, unless it is the one playing.
  const shownAlbum = useShownAlbum();
  const shownPlaying = shownAlbum != null && album?.id != null && Number(shownAlbum.id) === album.id;
  const restAlbum = phone && shownAlbum && !shownPlaying ? shownAlbum : null;
  // Played from there (or the one playing touched): the full screen shows it playing, and stays so as Listen Next goes on.
  useEffect(() => { if (shownPlaying) showPlaying(); }, [shownPlaying]);
  // A CD with nothing to play: its card, which says why.
  const atRest = useAlbumAtRest(restAlbum, albumId => { setFullPlayer(false); navigate(`/musicdex?album=${albumId}`); });
  // An iPhone playing on an appliance that plays nothing: a small bar to start something there, in MusicDex.
  const idle = !shown && output.kind === 'renderer' && known.length > 0 && inMusic && !isComputer() && !covered;
  // The settings of an appliance, opened from the ⋯ of a phone's bar.
  const [settingsFor, setSettingsFor] = useState<Output | null>(null);

  // The heart the track had when the album was started, unless the card has told a newer one since.
  useEffect(() => { if (track) seedFavourite(track.songId, track.starred, true); }, [track]);

  // The room the bar takes, for the pages and the cards: --player-h on the root.
  useEffect(() => {
    document.documentElement.style.setProperty('--player-h', (shown && !covered) || idle ? 'var(--player-bar-room)' : '0px');
  }, [shown, idle, covered]);

  // What the bar last showed, kept while it slides away after ✕.
  const last = useRef<{ album: NonNullable<typeof album>; track: NonNullable<typeof track> } | null>(null);
  if (album && track) last.current = { album, track };
  const out = Boolean(shown && album && track);
  // Back where the album was started (the Digital page's tab), else the CD's card, else the album in Navidrome.
  const open = () => {
    // A song of a mixtape: the CD it comes from.
    if (track?.albumId != null) navigate(`/musicdex?album=${track.albumId}`);
    else if (album?.from) navigate(album.from);
    else if (album?.id != null) navigate(`/musicdex?album=${album.id}`);
    else if (album?.url) window.open(album.url, '_blank', 'noopener');
  };
  const length = duration || track?.durationSec || 0;
  const tracks = usePlayer(state => state.tracks);
  const index = usePlayer(state => state.index);
  const fromListenNext = usePlayer(state => state.queue === 'listenNext');
  const ahead = useListenNextAhead(playingKey(album), fromListenNext, tracks, playing, upcoming);
  // What is left: this track's end, the tracks after it, and of Listen Next the albums after this one.
  const left = Math.max(0, length - position) + tracks.slice(index + 1).reduce((sum, one) => sum + (one.durationSec || 0), 0)
    + (ahead?.seconds ?? 0);
  // The track after this one, in the album or, at its end, the next album of Listen Next.
  const following = tracks[index + 1]
    ? { title: tracks[index + 1].title, artist: tracks[index + 1].artist ?? album?.artist ?? '' }
    : ahead?.first ?? null;
  const announcing = Boolean(following && length > 0 && length - position <= ANNOUNCE_SEC);
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (length > 0) player.seek(((event.clientX - box.left) / box.width) * length);
  };

  if (idle && !atRest) return <IdleBar name={outputName} away={outputStatus === 'unreachable'} />;
  const away = outputStatus === 'unreachable';
  const taken = outputStatus === 'taken';

  return (
    <div className={`player-bar${out ? ' player-bar-out' : ''}${away ? ' player-bar--away' : ''}${phone ? ' player-bar--pill' : ''}${covered ? ' player-bar--covered' : ''}`} role="region"
      aria-label={outputName ? `Playing on ${outputName}` : 'Player'} aria-hidden={!out || covered}>
      {restAlbum && atRest ? (
        // A cover's album at rest: the same full screen, ▶ playing it, the disc of what plays at its foot.
        <PhonePlayer title={atRest.title} subtitle={atRest.artist} cover={{ src: atRest.cover, title: atRest.title }}
          playing={false} position={0} length={0} hasNext={false}
          controls={{ toggle: () => atRest.playFrom(0), next: () => undefined, previous: () => undefined, playTrack: atRest.playFrom }}
          guideOf={Number(restAlbum.id)} tracks={atRest.tracks} index={-1} from=""
          onOpen={() => navigate(`/musicdex?album=${restAlbum.id}`)}
          rest={{ albumId: restAlbum.id, line: atRest.line, menu: atRest.menu }}
          door={out ? <NowPlayingDisc exceptAlbumId={restAlbum.id} onOpen={showPlaying} className="now-playing-door" /> : null}
          out />
      ) : last.current && (() => {
        const { album, track } = last.current;
        // A song of a mixtape shows the cover of its CD, and leads there.
        const cover = track.cover !== undefined ? { src: track.cover, title: `the album of ${track.title}` } : { src: album.cover, title: album.title };
        const toggleFavourite = () => setFavourite(track.songId, !favourite)
          .catch(error => toast(`Could not change the favourite: ${(error as Error).message}`, { tone: 'danger' }));
        if (phone) {
          return (
            <PhonePlayer title={track.title} cover={cover} playing={playing} position={position} length={length} hasNext={hasNext}
              subtitle={away ? `${outputName}, away` : error || (track.artist != null ? `${track.artist} · ${album.title}` : album.artist)}
              where={outputName || null} outputId={output.kind === 'renderer' ? output.id : null}
              controls={{
                toggle: () => player.toggle(), next: () => player.next(), previous: () => player.previous(),
                seek: seconds => player.seek(seconds), resume: () => player.resume(), stop: () => player.stop(),
                playTrack: at => player.playTrack(at),
              }}
              lyricsOf={album.id != null ? { albumId: album.id, disc: track.disc, no: track.no } : null} timingSongId={track.songId}
              guideOf={track.albumId ?? album.id} mixtape={{ songId: track.songId, title: track.title }}
              tracks={tracks} index={index} onAllTracks={fromListenNext ? () => setTracksOpen(true) : null}
              onAmperfy={isAppleMobile() && album.navidromeId ? () => {
                // Not both at once: DexVault's player pauses, and Amperfy starts the album.
                player.toggle(false);
                window.location.href = amperfyUrl(album.navidromeId!);
              } : null}
              favourite={{ on: favourite, toggle: () => { void toggleFavourite(); } }}
              away={away} taken={taken ? outputName : null} following={following}
              left={left > 0 ? `${leftText(left)} left of ${fromListenNext ? 'Listen Next' : album.title}` : null}
              from={fromListenNext ? 'Listen Next' : album.title} onOpen={open}
              onOpenMixtape={track.artist != null && album.id != null ? { title: album.title, open: () => navigate(`/musicdex?album=${album.id}`) } : null}
              out={out} />
          );
        }
        return (
        <>
          <div className={`player-bar-progress${playing ? '' : ' player-bar-progress--paused'}`} role="slider" aria-label="Position in the track"
            aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(position)}
            aria-valuetext={`${time(position)} of ${time(length)}`} tabIndex={0} onClick={seek}
            onKeyDown={event => {
              if (event.key === 'ArrowRight') player.seek(position + 10);
              if (event.key === 'ArrowLeft') player.seek(position - 10);
            }}>
            <span style={{ width: `${length > 0 ? Math.min(100, (position / length) * 100) : 0}%` }} />
          </div>
          {/* Three parts: what plays, its words and its ♥; the transport and the track's time; what is left, the tracks and ✕. */}
          <div className="player-bar-inner">
            <div className="player-bar-now">
              {/* The cover opens the album's card (a mixtape's song: its CD's); the track's name, the tracks to jump to. */}
              <div className="player-bar-album">
                <button type="button" className="player-bar-cover" onClick={open} title={`Open ${cover.title}`} aria-label={`Open ${cover.title}`}>
                  {cover.src ? <img src={cover.src} alt="" /> : <span className="player-bar-nocover" aria-hidden="true" />}
                </button>
                {/* The name opens the tracks; a mixtape's name, under it, opens the mixtape's card. */}
                <div className="player-bar-meta" onClick={() => setTracksOpen(true)} title="Tracks">
                  <button type="button" className="player-bar-track" onClick={event => { event.stopPropagation(); setTracksOpen(true); }}>
                    {track.title}
                  </button>
                  <span className="player-bar-from">
                    {/* An appliance away: its name, greyed, says so; the rest of the bar waits for it. */}
                    {/* On a phone, which appliance plays it, its speaker gone into ⋯. */}
                    {!away && outputName && <span className="player-bar-where"><BsSpeaker aria-hidden="true" /> {outputName} · </span>}
                    {away ? `${outputName}, away` : error || (track.artist != null ? (
                      <>
                        {track.artist} · <button type="button" className="player-bar-mixtape" title={`Open ${album.title}`}
                          onClick={event => { event.stopPropagation(); if (album.id != null) navigate(`/musicdex?album=${album.id}`); }}>
                          {album.title}
                        </button>
                      </>
                    ) : `${album.title} · ${album.artist}`)}
                  </span>
                </div>
              </div>
              {/* The words, in their panel on the left: of an album DexVault holds, on a desktop. */}
              {album.id != null && (
                <button type="button" className={`player-bar-button player-bar-lyrics${lyricsOpen ? ' player-bar-lyrics-on' : ''}`}
                  onClick={() => player.showLyrics()} aria-label="Lyrics" aria-pressed={lyricsOpen} title="Lyrics">
                  <BsChatQuote aria-hidden="true" />
                </button>
              )}
              {/* The track's heart, kept in Navidrome: the card's ♥ follows. */}
              <button type="button" className={`player-bar-button player-bar-favourite${favourite ? ' player-bar-favourite-on' : ''}`}
                onClick={() => setFavourite(track.songId, !favourite)
                  .catch(error => toast(`Could not change the favourite: ${(error as Error).message}`, { tone: 'danger' }))}
                aria-label={favourite ? 'Remove from the favourites' : 'Add to the favourites'} aria-pressed={favourite}
                title={favourite ? 'Favourite' : 'Add to the favourites'}>
                {favourite ? <BsHeartFill aria-hidden="true" /> : <BsHeart aria-hidden="true" />}
              </button>
            </div>
            {taken ? (
              // The appliance plays something else (another input, its own app): Resume takes it back at the same place.
              <div className="player-bar-transport player-bar-transport--taken">
                <span className="player-bar-taken">{outputName} is playing something else</span>
                <Button size="sm" icon={<BsPlayFill />} onClick={() => player.resume()}>Resume</Button>
              </div>
            ) : (
            <div className="player-bar-transport">
              <span className="player-bar-time player-bar-time--now">{time(position)}</span>
              <button type="button" className="player-bar-button player-bar-previous" onClick={() => player.previous()} aria-label="Previous">
                <BsSkipBackwardFill aria-hidden="true" />
              </button>
              <button type="button" className="player-bar-button player-bar-play" onClick={() => player.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <BsPauseFill aria-hidden="true" /> : <BsPlayFill aria-hidden="true" />}
              </button>
              <button type="button" className="player-bar-button" onClick={() => player.next()} disabled={!hasNext} aria-label="Next">
                <BsSkipForwardFill aria-hidden="true" />
              </button>
              <span className="player-bar-time">{time(length)}</span>
            </div>
            )}
            <div className="player-bar-tools">
              {/* What is left to hear, of the album or the mixtape, or of Listen Next; in a track's
                  last seconds, what comes next fades in before it, and out once it plays. */}
              <span className="player-bar-ahead">
                {following && (
                  <button type="button" className={`player-bar-next${announcing ? '' : ' player-bar-ahead--off'}`} tabIndex={announcing ? 0 : -1}
                    aria-hidden={!announcing} title="Play it now" onClick={() => player.next()}>
                    Up next: <b>{following.title}</b>{following.artist && <> by {following.artist}</>}
                  </button>
                )}
                {following && left > 0 && (
                  <span className={`player-bar-next-dot${announcing ? '' : ' player-bar-ahead--off'}`} aria-hidden="true">•</span>
                )}
                {left > 0 && (
                  <span className="player-bar-left" title={`${leftText(left)} left of ${fromListenNext ? 'Listen Next' : album.title}`}>{leftText(left)}</span>
                )}
              </span>
              {/* The tracks, to jump to one: of Listen Next, of its albums. */}
              <button type="button" className={`player-bar-button player-bar-tracks${tracksOpen ? ' player-bar-tracks-on' : ''}`}
                onClick={() => setTracksOpen(true)} aria-label="Tracks" aria-pressed={tracksOpen} title="Tracks">
                <BsMusicNoteList aria-hidden="true" />
              </button>
              {/* Where it plays: this browser, or an appliance of the house, with its volume. */}
              <OutputMenu />
              <span className="player-bar-rule" aria-hidden="true" />
              <button type="button" className="player-bar-button player-bar-stop" onClick={() => player.stop()} aria-label="Stop" title="Stop">
                <BsX aria-hidden="true" />
              </button>
              {/* On a phone, ♥, the tracks, the output and ✕ in one menu: the track's name keeps its room. */}
              <Menu drop="up" align="end" label="More" className="output-menu" trigger={props => (
                <IconButton {...props} className="player-bar-more" label="More"><BsThreeDots /></IconButton>
              )}>
                <Menu.Item icon={favourite ? <BsHeartFill /> : <BsHeart />}
                  onSelect={() => setFavourite(track.songId, !favourite)
                    .catch(error => toast(`Could not change the favourite: ${(error as Error).message}`, { tone: 'danger' }))}>
                  {favourite ? 'Remove from the favourites' : 'Add to the favourites'}
                </Menu.Item>
                <Menu.Item icon={<BsMusicNoteList />} onSelect={() => setTracksOpen(true)}>Tracks</Menu.Item>
                {known.length > 0 && (
                  <>
                    <Menu.Separator />
                    <OutputEntries onSettings={setSettingsFor} />
                  </>
                )}
                <Menu.Separator />
                <Menu.Item icon={<BsX />} onSelect={() => player.stop()}>Stop</Menu.Item>
              </Menu>
            </div>
          </div>
        </>
        );
      })()}
      {atRest?.dialog}
      <PlayerTracks show={tracksOpen && out} onClose={() => setTracksOpen(false)} />
      {settingsFor && <OutputSettings output={settingsFor} onClose={() => setSettingsFor(null)} />}
    </div>
  );
};

export default PlayerBar;
