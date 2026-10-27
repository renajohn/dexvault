import { DeviceUnreachableError, UPnPError } from './soap';
import type { Renderer } from './device';
import { didlOf, mimeTypeOf } from './didl';
import { ListenNextTurn, Superseded, entryKey, listenNextDeps, parseEntryKey, type EntryKey, type TurnDeps, type TurnState } from './turn';
import type { Playable, PlayerAlbum, PlayerTrack } from '../playable';
import type { ListenNextDeparture } from '../../models/listenNextPlay';
import logger from '../../logger';

/**
 * What one appliance plays for DexVault: the album and its tracks, which
 * track, where in it, and Listen Next to go on with. The list is ours, not
 * the appliance's: it is given one track at a time (and the next one, for
 * those that follow on with no gap), and asked every second where it is.
 *
 * Commands go to it one after the other, never two at once: the Onkyo does
 * not like two SOAP calls together.
 *
 * When something else takes the appliance (another input chosen on the
 * Onkyo, AirPlay, Spotify), the session lets go: `taken`, no command, no
 * scrobble, the place kept, until Resume. Off or out of the network, it is
 * `unreachable` after three calls unanswered; back within a few minutes
 * with nothing else playing, it is given our play again by itself, from
 * where it was, or the play asked of it while it was away. The Onkyo stops
 * answering for half a minute as it wakes, and comes back holding whatever
 * track of ours it had last: that is not someone else's play.
 */

export type SessionStatus = 'playing' | 'paused' | 'stopped' | 'taken' | 'unreachable';

export interface OutputTrackState {
  songId: string;
  title: string;
  disc: number;
  no: number;
  artist: string;
  cover: string | null;
  durationSec: number | null;
}

/** What a page is told of a session, in `state` events and in GET /api/outputs. */
export interface OutputState {
  id: string;
  name: string;
  album: PlayerAlbum | null;
  track: OutputTrackState | null;
  index: number;
  count: number;
  tracks: PlayerTrack[];
  status: SessionStatus;
  /** Seconds into the track when the appliance was last asked, at `at` (server time, ms): the page moves the hand on from there. */
  position: number;
  duration: number;
  at: number;
  volume: number | null;
  muted: boolean;
  queue: 'listenNext' | null;
  /** The entries of Listen Next still to come in this turn ("12:0"), for the time left. */
  upcoming: EntryKey[];
  error: string | null;
}

/** A session as written in output_sessions, to outlive a restart. */
export interface SavedSession {
  album: PlayerAlbum | null;
  tracks: PlayerTrack[];
  index: number;
  position: number;
  duration: number;
  status: SessionStatus;
  queue: 'listenNext' | null;
  token: string;
  turn: TurnState | null;
}

export interface SessionDeps {
  /** The appliance as last read; null when its description could not be read. */
  renderer: () => Renderer | null;
  /** Its description read again, at the first call unanswered: a WiiM changes port when it restarts. */
  reload?: () => Promise<unknown>;
  /** Where the appliance reaches the media listener: http://dexvault.lab.crog.org:3002 */
  mediaBase: string;
  name: () => string;
  maxVolume: () => number;
  load: (albumId: number, options: { listenNext: boolean; disc: number }) => Promise<Playable>;
  scrobble: (songId: string, submission: boolean) => Promise<{ left: ListenNextDeparture | null }>;
  turnDeps?: TurnDeps;
  issueToken: () => string;
  save: (saved: SavedSession | null) => Promise<void>;
  emit: (event: 'state' | 'left', payload: unknown) => void;
  now?: () => number;
  /** A pause between two questions to an appliance that is starting to play. */
  wait?: (ms: number) => Promise<void>;
}

/** A command refused because the appliance plays something else: 409. */
export class OutputTakenError extends Error {
  constructor(name: string) { super(`${name} is playing something else`); this.name = 'OutputTakenError'; }
}

/** A command the appliance did not answer: 503. */
export class OutputUnreachableError extends Error {
  constructor(name: string) { super(`${name} does not answer: is it on?`); this.name = 'OutputUnreachableError'; }
}

/** A play counts once half the track is heard, or four minutes of it, as the other players count it. */
export const SCROBBLE_AFTER_SEC = 240;
/** ⏮ goes back to the start of the track past this many seconds, to the one before within them. */
const RESTART_AFTER_SEC = 3;
/** Stopped this close to the end of the track: it ended, the next one is to be given. */
const END_SLACK_SEC = 3;
/** This many calls unanswered in a row: the appliance is away. */
const UNREACHABLE_AFTER = 3;
/** Asked how far it is: every second playing, every 5 s paused; away, ever less often. */
const POLL_PLAYING_MS = 1000;
const POLL_PAUSED_MS = 5000;
const POLL_AWAY_MS = [5000, 15000, 60000];
/** Away with a play to give it as soon as it answers: asked this often. */
const POLL_WANTED_MS = 5000;
/** Back within this long of going away, or of a play asked while away, it plays on by itself; later, it waits for ▶. */
const RETAKE_WITHIN_MS = 5 * 60_000;
/** Someone else's track, or none, read this many polls in a row before letting go: one reading alone may be a step between two tracks. */
const FOREIGN_STRIKES = 2;
/** An address of ours (the media listener's) for a track that is not in the list: left over from an earlier play, nobody else's. */
const STALE = -2;
/** Its volume asked every fifth poll, playing: every 5 s. */
const VOLUME_EVERY = 5;
/** Written down this often while it plays, and at every track. */
const SAVE_EVERY_MS = 10_000;
/** A state sent at most this often, but at once when the track or the status changes. */
const EMIT_EVERY_MS = 1000;
/** Formats an appliance cannot play (UPnP 714: illegal MIME type; 716: resource not found). */
const UNPLAYABLE = new Set([714, 716]);
/** Play refused while the appliance is between two tracks: asked again, 300 ms apart, this many times in all. */
const TRANSITION_NOT_AVAILABLE = 701;
const PLAY_TRIES = 10;

const countedAt = (track: PlayerTrack, at: number): boolean =>
  at >= SCROBBLE_AFTER_SEC || (Boolean(track.durationSec) && at >= (track.durationSec as number) / 2);

export class OutputSession {
  readonly id: string;
  private deps: SessionDeps;
  album: PlayerAlbum | null = null;
  tracks: PlayerTrack[] = [];
  index = 0;
  status: SessionStatus = 'stopped';
  position = 0;
  duration = 0;
  at = 0;
  volume: number | null = null;
  muted = false;
  queue: 'listenNext' | null = null;
  error: string | null = null;
  token: string;
  turn: ListenNextTurn | null = null;
  /** The appliance holds our track: what it says is ours to follow. */
  private onDevice = false;
  /** The track given as the next one, which the appliance goes on to by itself; -1 for none. */
  private nextSet = -1;
  private announced = false;
  private counted = false;
  private lastPosition = 0;
  private failures = 0;
  /** When a play was last wanted of the appliance while it was away (it played as it went, or one was asked): given as soon as it answers; null for none. */
  private wantedAt: number | null = null;
  /** The play wanted is a track asked (Play, ▶, ⏭), to give even over what it plays; else to play on as it was. */
  private wantedTrack = false;
  /** Polls in a row that found someone else's track, or none, on the appliance. */
  private strikes = 0;
  private probed = false;
  private awayPolls = 0;
  private polls = 0;
  private lastSaved = 0;
  private lastEmitted = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /**
   * Plays asked (a track, an album, ⏭, ✕, …) and, of them, those that choose
   * where to go rather than go on from where the last one left. The command
   * under way gives up at its next step once a newer play is asked; one still
   * waiting its turn is skipped once a newer one chooses: tracks clicked one
   * after the other quickly, the appliance plays the last alone.
   */
  private asked = 0;
  private chosen = 0;
  /** The play the command under way stands for: `asked` as it was when it was asked. */
  private running = 0;
  /** Scrobbles under way, which commands do not wait for: Navidrome may be slow. */
  private background = new Set<Promise<unknown>>();

  constructor(id: string, deps: SessionDeps, saved?: SavedSession | null) {
    this.id = id;
    this.deps = deps;
    this.token = saved?.token || deps.issueToken();
    if (saved?.album && saved.tracks.length > 0) {
      // Back after a restart: paused where it was, until a poll finds the appliance still playing our track.
      this.album = saved.album;
      this.tracks = saved.tracks;
      this.index = Math.max(0, Math.min(saved.index, saved.tracks.length - 1));
      this.position = saved.position;
      this.duration = saved.duration;
      this.queue = saved.queue;
      this.status = saved.status === 'stopped' ? 'stopped' : 'paused';
      this.at = this.now();
      if (saved.queue === 'listenNext' && saved.turn) this.turn = this.makeTurn(saved.turn);
      this.counted = countedAt(this.tracks[this.index], this.position);
      this.announced = true;
    }
  }

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  private makeTurn(state?: TurnState | null): ListenNextTurn {
    const turn = new ListenNextTurn(this.deps.turnDeps ?? listenNextDeps, state);
    turn.onLeft = left => this.deps.emit('left', { output: this.id, ...left });
    return turn;
  }

  /** One command after the other, a poll included; given up for a newer play, it answers `instead`. */
  private run<T>(work: () => Promise<T>, instead?: T, asked?: number): Promise<T> {
    const result = this.chain.then(() => {
      this.running = asked ?? this.asked;
      return work();
    }).catch(error => {
      if (error instanceof Superseded) return instead as T;
      throw error;
    });
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** A play that chooses its track (an album, a track, Resume, ✕): skipped if another chooses before its turn. */
  private choose<T>(work: () => Promise<T>, instead?: T): Promise<T> {
    const mine = ++this.chosen;
    return this.run(async () => (mine === this.chosen ? work() : instead as T), instead, ++this.asked);
  }

  /** ⏭ or ⏮: from where the plays before it left the track, so never skipped; it still makes them give up. */
  private step(work: () => Promise<void>): Promise<void> {
    return this.run(work, undefined, ++this.asked);
  }

  /** Between two steps of a play: a newer one asked meanwhile, this one goes no further. */
  private stillWanted(): void {
    if (this.running !== this.asked) throw new Superseded();
  }

  /** For the tests: the commands and the scrobbles under way done. */
  async idle(): Promise<void> {
    await this.chain;
    while (this.background.size > 0) await Promise.all([...this.background]);
  }

  private later(work: Promise<unknown>): void {
    const done = work.catch(() => undefined).finally(() => this.background.delete(done));
    this.background.add(done);
  }

  /** A call to the appliance, counted: three unanswered in a row and it is away. */
  private async call<T>(work: (renderer: Renderer) => Promise<T>): Promise<T> {
    const renderer = this.deps.renderer();
    if (!renderer) {
      this.failed();
      throw new OutputUnreachableError(this.deps.name());
    }
    try {
      const value = await work(renderer);
      this.failures = 0;
      return value;
    } catch (error) {
      if (error instanceof DeviceUnreachableError) {
        this.failed();
        throw new OutputUnreachableError(this.deps.name());
      }
      throw error;
    }
  }

  private failed(): void {
    this.failures++;
    if (this.failures === 1) this.deps.reload?.().catch(() => undefined);
    // Stopped by hand, it stays so: switched off and on again it plays nothing of ours, as was asked.
    if (this.failures >= UNREACHABLE_AFTER && this.status !== 'unreachable' && this.status !== 'stopped' && this.album) {
      // Playing as it went: to play on once it answers.
      if (this.status === 'playing') {
        this.wantedAt = this.now();
        this.wantedTrack = false;
      }
      this.status = 'unreachable';
      this.onDevice = false;
      this.awayPolls = 0;
      this.emit(true);
    }
  }

  /** A play asked of an appliance that did not answer: kept, and given as soon as it does. */
  private keepWanted(): void {
    this.wantedAt = this.now();
    this.wantedTrack = true;
    this.status = 'unreachable';
    this.onDevice = false;
    this.awayPolls = 0;
    this.at = this.now();
    this.save();
    this.emit(true);
  }

  /** Whether a play waits for the appliance to answer. */
  private wanted(): boolean {
    return this.wantedAt != null && this.now() - this.wantedAt <= RETAKE_WITHIN_MS;
  }

  /** A play kept for when the appliance answers: the page is told so. */
  wantsPlay(): boolean {
    return this.status === 'unreachable' && this.album !== null && this.wanted();
  }

  // The addresses the appliance is given: the media listener's, by this session's token.

  private urlOf(track: PlayerTrack): string {
    const ext = (track.suffix || 'flac').toLowerCase().replace(/[^a-z0-9]/g, '') || 'flac';
    return `${this.deps.mediaBase}/upnp/stream/${this.token}/${encodeURIComponent(track.songId)}.${ext}`;
  }

  private coverUrlOf(track: PlayerTrack): string | null {
    const albumId = track.albumId !== undefined ? track.albumId : this.album?.id;
    const cover = track.cover !== undefined ? track.cover : this.album?.cover;
    return albumId != null && cover ? `${this.deps.mediaBase}/upnp/cover/${this.token}/${albumId}.jpg` : null;
  }

  private didlOf(track: PlayerTrack): string {
    return didlOf({
      title: track.title,
      artist: track.artist ?? this.album?.artist ?? '',
      album: this.album?.title ?? '',
      trackNumber: track.no,
      durationSec: track.durationSec,
      url: this.urlOf(track),
      mimeType: mimeTypeOf(track.suffix),
      coverUrl: this.coverUrlOf(track),
    });
  }

  /**
   * The track of ours an address stands for: -1 for someone else's (another
   * player's, another DexVault's), STALE for one of ours that is not in the
   * list (left from an earlier play), null for none at all.
   */
  private indexOfUri(uri: string): number | null {
    if (!uri) return null;
    const match = /\/upnp\/stream\/([^/]+)\/([^/?#]+?)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(uri);
    if (!match || !uri.startsWith(`${this.deps.mediaBase}/`)) return -1;
    if (match[1] !== this.token) return STALE;
    const songId = decodeURIComponent(match[2]);
    // A song twice in a mixtape: the one playing, else the next one, else the first.
    for (const at of [this.index, this.index + 1]) if (this.tracks[at]?.songId === songId) return at;
    const index = this.tracks.findIndex(track => track.songId === songId);
    return index === -1 ? STALE : index;
  }

  // What the pages are told.

  state(): OutputState {
    const track = this.tracks[this.index];
    return {
      id: this.id,
      name: this.deps.name(),
      album: this.album,
      track: this.album && track ? {
        songId: track.songId, title: track.title, disc: track.disc, no: track.no,
        // A song of a mixtape: its own artist and its CD's cover.
        artist: track.artist ?? this.album.artist,
        cover: track.cover !== undefined ? track.cover : this.album.cover,
        durationSec: track.durationSec,
      } : null,
      index: this.index,
      count: this.tracks.length,
      tracks: this.tracks,
      status: this.status,
      position: this.position,
      duration: this.duration,
      at: this.at,
      volume: this.volume,
      muted: this.muted,
      queue: this.queue,
      upcoming: this.queue === 'listenNext' && this.turn ? this.turn.upcoming() : [],
      error: this.error,
    };
  }

  private emit(force = false): void {
    const now = this.now();
    if (force || now - this.lastEmitted >= EMIT_EVERY_MS) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.lastEmitted = now;
      this.deps.emit('state', this.state());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.lastEmitted = this.now();
      this.deps.emit('state', this.state());
    }, EMIT_EVERY_MS - (now - this.lastEmitted));
    this.emitTimer.unref?.();
  }

  saved(): SavedSession {
    return {
      album: this.album, tracks: this.tracks, index: this.index, position: Math.floor(this.position), duration: this.duration,
      status: this.status, queue: this.queue, token: this.token, turn: this.turn ? this.turn.snapshot() : null,
    };
  }

  private save(): void {
    this.lastSaved = this.now();
    this.later(this.deps.save(this.album ? this.saved() : null).catch(error => logger.warn(`Saving the play on ${this.deps.name()}: ${(error as Error).message}`)));
  }

  /** How long until the next poll; null for none: nothing playing, or someone else's. */
  pollDelay(): number | null {
    if (!this.album) return null;
    if (this.status === 'playing') return POLL_PLAYING_MS;
    // Paused with nothing of ours on the appliance (after a restart): asked once whether it still plays our track.
    if (this.status === 'paused') return this.onDevice || !this.probed ? POLL_PAUSED_MS : null;
    if (this.status === 'unreachable') return this.wanted() ? POLL_WANTED_MS : POLL_AWAY_MS[Math.min(this.awayPolls, POLL_AWAY_MS.length - 1)];
    return null;
  }

  // Scrobbles: "now playing" as a track starts, "listened to" at half of it or four minutes, once.

  private announce(): void {
    const track = this.tracks[this.index];
    if (!track || this.announced) return;
    this.announced = true;
    this.later(this.deps.scrobble(track.songId, false).catch(error => logger.warn(`Scrobbling song ${track.songId}: ${(error as Error).message}`)));
  }

  private count(): void {
    const track = this.tracks[this.index];
    if (!track || this.counted) return;
    const duration = this.duration || track.durationSec || 0;
    if (!(this.position >= SCROBBLE_AFTER_SEC || (duration > 0 && this.position >= duration / 2))) return;
    this.counted = true;
    this.turn?.noteCounted();
    this.later(this.deps.scrobble(track.songId, true).then(({ left }) => {
      if (!left) return;
      this.turn?.noteDeparted(left.albumId, left.disc);
      this.deps.emit('left', { output: this.id, ...left });
    }).catch(error => logger.warn(`Scrobbling song ${track.songId}: ${(error as Error).message}`)));
  }

  // Playing.

  /** Asked a few times until it plays: the WiiM takes a moment to fetch the file. */
  private async waitPlaying(): Promise<void> {
    const wait = this.deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    for (let tries = 0; tries < 10; tries++) {
      const { state } = await this.call(renderer => renderer.transportInfo());
      if (state === 'PLAYING') return;
      if (state !== 'TRANSITIONING' && state !== 'STOPPED') return;
      await wait(300);
      this.stillWanted();
    }
  }

  /**
   * Play, asked again while the appliance is still between two tracks: the Onkyo, given a track
   * as it stops another (a CD changed), refuses Play (701, transition not available) for a moment.
   * Playing meanwhile by itself, it is not asked again.
   */
  private async playNow(): Promise<void> {
    const wait = this.deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    for (let tries = 1; ; tries++) {
      try {
        await this.call(renderer => renderer.play());
        return;
      } catch (error) {
        if (!(error instanceof UPnPError && error.code === TRANSITION_NOT_AVAILABLE) || tries >= PLAY_TRIES) throw error;
      }
      await wait(300);
      this.stillWanted();
      const { state } = await this.call(renderer => renderer.transportInfo());
      if (state === 'PLAYING') return;
    }
  }

  /** Gives the appliance the track after this one, for it to follow on with no gap. */
  private async postNext(): Promise<void> {
    const renderer = this.deps.renderer();
    const next = this.index + 1;
    if (!renderer?.gapless || next >= this.tracks.length || this.nextSet === next) return;
    // Taken out of Listen Next by hand: this track is its last.
    if (this.queue === 'listenNext' && this.turn?.leaveAfterTrack()) return;
    try {
      await this.call(r => r.setNextUri(this.urlOf(this.tracks[next]), this.didlOf(this.tracks[next])));
      this.nextSet = next;
    } catch (error) {
      if (error instanceof OutputUnreachableError) throw error;
      // Refused: the next track is given when this one stops, with a second's gap.
      logger.warn(`${this.deps.name()} refused the next track: ${(error as Error).message}`);
    }
  }

  /**
   * Plays track `index` from `at` seconds: given, played, sought, and the
   * one after it given as next. Unanswered, the play is kept for when the
   * appliance answers: it is what was asked of it.
   */
  private async startTrack(index: number, at = 0, skipped = 0): Promise<void> {
    try {
      await this.giveTrack(index, at, skipped);
    } catch (error) {
      if (error instanceof OutputUnreachableError) this.keepWanted();
      throw error;
    }
  }

  private async giveTrack(index: number, at: number, skipped: number): Promise<void> {
    const track = this.tracks[index];
    if (!track) return;
    this.index = index;
    this.position = at;
    this.lastPosition = at;
    this.duration = track.durationSec || 0;
    this.at = this.now();
    this.counted = countedAt(track, at);
    this.announced = false;
    this.nextSet = -1;
    this.error = null;
    this.stillWanted();
    try {
      await this.call(renderer => renderer.setUri(this.urlOf(track), this.didlOf(track)));
    } catch (error) {
      if (error instanceof UPnPError && error.code != null && UNPLAYABLE.has(error.code) && skipped < this.tracks.length) {
        // A file it cannot play (a format, a rate too high): said, and the next one.
        logger.warn(`${this.deps.name()} cannot play ${track.songId}: ${error.message}`);
        if (index + 1 < this.tracks.length) {
          await this.startTrack(index + 1, 0, skipped + 1);
          this.error = `${this.deps.name()} cannot play “${track.title}”`;
          this.emit(true);
          return;
        }
        this.error = `${this.deps.name()} cannot play “${track.title}”`;
        this.status = 'paused';
        this.emit(true);
        return;
      }
      throw error;
    }
    this.onDevice = true;
    this.stillWanted();
    await this.playNow();
    this.status = 'playing';
    this.wantedAt = null;
    this.strikes = 0;
    await this.waitPlaying();
    this.stillWanted();
    if (at > 0) await this.call(renderer => renderer.seek(at)).catch(error => {
      if (error instanceof OutputUnreachableError) throw error;
      logger.warn(`${this.deps.name()} would not seek: ${(error as Error).message}`);
    });
    this.at = this.now();
    this.stillWanted();
    this.announce();
    await this.postNext();
    this.save();
    this.emit(true);
  }

  /** An album in, from its track `index` at `at` seconds: what played before stopped first. */
  private async loadAlbum(album: PlayerAlbum, tracks: PlayerTrack[], index: number, at: number, queue: 'listenNext' | null): Promise<void> {
    // Unanswered, the track given next tells so, and is kept for when it answers.
    if (this.onDevice && this.status === 'playing') await this.call(renderer => renderer.stop()).catch(() => undefined);
    this.stillWanted();
    this.album = album;
    this.tracks = tracks;
    this.queue = queue;
    await this.startTrack(Math.max(0, Math.min(index, tracks.length - 1)), at);
  }

  /** An entry of Listen Next played from its track `index`: false when it has nothing to play. */
  private playEntry = async (key: EntryKey, index: number): Promise<boolean> => {
    const { albumId, disc } = parseEntryKey(key);
    const playable = await this.deps.load(albumId, { listenNext: true, disc });
    this.stillWanted();
    if (playable.tracks.length === 0) return false;
    await this.loadAlbum(playable.album, playable.tracks, index, 0, 'listenNext');
    return true;
  };

  /** The album is over: Listen Next goes on, or it waits on its first track, paused, as the page's player does. */
  private async endAlbum(how: 'ended' | 'skipped' | 'removed'): Promise<void> {
    if (this.queue === 'listenNext' && this.turn) {
      const album = this.album;
      const played = await this.turn.albumEnded(this.playEntry, how).catch(error => {
        if (error instanceof OutputUnreachableError || error instanceof Superseded) throw error;
        logger.warn(`Listen Next on ${this.deps.name()}: ${(error as Error).message}`);
        return false;
      });
      if (played || this.album !== album) return;
    } else if (how === 'skipped') return;
    await this.finish();
  }

  private async finish(): Promise<void> {
    const first = this.tracks[0];
    if (!this.album || !first) return;
    this.index = 0;
    this.position = 0;
    this.lastPosition = 0;
    this.duration = first.durationSec || 0;
    this.at = this.now();
    this.status = 'paused';
    this.nextSet = -1;
    this.announced = false;
    this.counted = false;
    try {
      await this.call(renderer => renderer.setUri(this.urlOf(first), this.didlOf(first)));
      this.onDevice = true;
    } catch (error) {
      if (error instanceof OutputUnreachableError) throw error;
      this.onDevice = false;
    }
    this.save();
    this.emit(true);
  }

  /** The track playing is over: the next one, or the album's end. */
  private async trackEnded(): Promise<void> {
    if (this.queue === 'listenNext' && this.turn && await this.turn.shouldLeave()) return this.endAlbum('removed');
    if (this.index + 1 < this.tracks.length) return this.startTrack(this.index + 1);
    return this.endAlbum('ended');
  }

  /** The appliance went on by itself to the track given as next; false when that ended the album instead. */
  private async followed(index: number): Promise<boolean> {
    if (this.queue === 'listenNext' && this.turn && await this.turn.shouldLeave()) {
      await this.endAlbum('removed');
      return false;
    }
    const track = this.tracks[index];
    this.index = index;
    this.nextSet = -1;
    this.announced = false;
    this.counted = false;
    this.position = 0;
    this.lastPosition = 0;
    this.duration = track.durationSec || 0;
    this.error = null;
    this.save();
    this.emit(true);
    return true;
  }

  private letGo(): void {
    this.status = 'taken';
    this.onDevice = false;
    this.nextSet = -1;
    this.strikes = 0;
    this.wantedAt = null;
    this.save();
    this.emit(true);
  }

  /**
   * Back from away without the track wanted playing. A track asked of it
   * while away is given, even over what it plays: it was asked. Otherwise
   * someone else's play is left alone (taken); and whatever it holds
   * (nothing, or a track of ours left over), the play wanted of it is given
   * again, from where it was, if it was wanted within the last minutes;
   * else it waits, paused, for ▶.
   */
  private async cameBack(ours: number | null, playingNow: boolean): Promise<void> {
    if (ours === -1 && playingNow && !(this.wantedTrack && this.wanted())) return this.letGo();
    if (this.wanted()) {
      // Unanswered again, it stays wanted as it was: tried again at the next poll.
      const asked = this.wantedTrack;
      try {
        await this.startTrack(this.index, this.position);
      } catch (error) {
        this.wantedTrack = asked;
        throw error;
      }
      return;
    }
    this.wantedAt = null;
    this.status = 'paused';
    this.at = this.now();
    this.save();
    this.emit(true);
  }

  /** Where the appliance is: the track it plays, how far, whether it went on, ended, or plays someone else's. */
  private async poll(): Promise<void> {
    if (!this.album || this.status === 'stopped' || this.status === 'taken') return;
    const wasAway = this.status === 'unreachable';
    this.probed = true;
    let transport;
    let where;
    try {
      transport = await this.call(renderer => renderer.transportInfo());
      where = await this.call(renderer => renderer.positionInfo());
    } catch (error) {
      if (wasAway) this.awayPolls++;
      if (!(error instanceof OutputUnreachableError)) logger.warn(`Asking ${this.deps.name()} where it is: ${(error as Error).message}`);
      return;
    }
    this.awayPolls = 0;
    const ours = this.indexOfUri(where.trackUri);
    const playingNow = transport.state === 'PLAYING' || transport.state === 'PAUSED_PLAYBACK';

    if (!this.onDevice) {
      // After a restart, or back from away: ours again only if it still plays our track.
      // A track asked of it while it was away is given even when it plays another of ours.
      const asked = this.wantedTrack && this.wanted() && ours !== this.index;
      if (ours != null && ours >= 0 && playingNow && !asked) {
        this.onDevice = true;
        this.strikes = 0;
        if (ours !== this.index && !await this.followed(ours)) return;
      } else {
        if (wasAway) await this.cameBack(ours, playingNow);
        return;
      }
    }

    const track = this.tracks[this.index];
    const duration = this.duration || track?.durationSec || 0;
    const stoppedNow = transport.state === 'STOPPED' || transport.state === 'NO_MEDIA_PRESENT';
    // Stopped at the end of the track: it ended. Some appliances forget the track as they stop.
    if (stoppedNow && this.status === 'playing' && (ours == null || ours === this.index)
      && (duration <= 0 || duration - this.lastPosition <= END_SLACK_SEC)) {
      await this.trackEnded();
      return;
    }
    if (transport.state === 'NO_MEDIA_PRESENT' || ours === -1 || ours === STALE) {
      // Read twice in a row before letting go: between two tracks the appliance may say nothing for a moment.
      if (++this.strikes >= FOREIGN_STRIKES) this.letGo();
      return;
    }
    this.strikes = 0;
    if (ours != null && ours !== this.index) {
      // Gone on to the next track by itself, with no gap; or to another of ours, by its own buttons.
      if (ours !== this.nextSet) this.nextSet = -1;
      if (!await this.followed(ours)) return;
    }

    const before = this.status;
    if (transport.state === 'PLAYING') this.status = 'playing';
    else if (transport.state === 'PAUSED_PLAYBACK') this.status = 'paused';
    // Stopped by its own remote mid-track: paused there.
    else if (transport.state === 'STOPPED' && this.status === 'playing') this.status = 'paused';

    this.position = where.position;
    this.lastPosition = where.position;
    if (where.duration > 0) this.duration = where.duration;
    else if (!this.duration) this.duration = this.tracks[this.index]?.durationSec || 0;
    this.at = this.now();

    if (this.status === 'playing') {
      this.announce();
      this.count();
      await this.postNext().catch(() => undefined);
    }
    if (++this.polls % VOLUME_EVERY === 0) await this.fetchVolume().catch(() => undefined);
    if (this.now() - this.lastSaved >= SAVE_EVERY_MS) this.save();
    this.emit(before !== this.status);
  }

  /** One poll, in turn with the commands. */
  tick(): Promise<void> {
    return this.run(() => this.poll());
  }

  /** Its volume and mute asked, in turn with the commands: the Onkyo wants one call at a time. */
  readVolume(): Promise<void> {
    return this.run(async () => {
      const before = [this.volume, this.muted];
      await this.fetchVolume();
      // Turned on the appliance itself, or read for the first time: the pages told.
      if (before[0] !== this.volume || before[1] !== this.muted) this.emit(true);
    });
  }

  private async fetchVolume(): Promise<void> {
    const renderer = this.deps.renderer();
    if (!renderer?.description.renderingControl) return;
    this.volume = await this.call(r => r.getVolume());
    this.muted = await this.call(r => r.getMute()).catch(() => this.muted);
  }

  // Commands.

  private refuseTaken(): void {
    if (this.status === 'taken') throw new OutputTakenError(this.deps.name());
  }

  /** Plays an album's tracks from `index` (at `at` seconds); Listen Next goes on after it when `turn` is given. */
  playAlbum(album: PlayerAlbum, tracks: PlayerTrack[], index = 0, at = 0, turn: ListenNextTurn | null = null): Promise<void> {
    return this.choose(async () => {
      if (tracks.length === 0) return;
      this.turn = turn;
      if (turn) turn.onLeft = left => this.deps.emit('left', { output: this.id, ...left });
      await this.loadAlbum(album, tracks, index, at, turn ? 'listenNext' : null);
    });
  }

  /**
   * Plays Listen Next from entry `key` (its track `index`), from the top
   * without one; of a turn under way, a jump within it. False when nothing could be played.
   */
  playListenNext(key: EntryKey | null = null, index = 0): Promise<boolean> {
    // Given up for a newer play: not a list with nothing to play.
    return this.choose(async () => {
      if (key != null && this.queue === 'listenNext' && this.turn?.currentKey != null && this.status !== 'taken' && this.onDevice) {
        const turn = this.turn;
        const started = await turn.jumpTo(this.playEntry, async at => this.startTrack(at), key, index, this.index);
        this.emit(true);
        return started;
      }
      const turn = this.makeTurn();
      const previous = { turn: this.turn, queue: this.queue };
      this.turn = turn;
      const started = await turn.start(this.playEntry, key, index);
      if (!started) {
        this.turn = previous.turn;
        this.queue = previous.queue;
      }
      return started;
    }, true);
  }

  /** Carries a play over from elsewhere (the page's player, another appliance), Listen Next's turn with it. */
  carryOver(album: PlayerAlbum, tracks: PlayerTrack[], index: number, at: number, turnState: TurnState | null | 'listenNext'): Promise<void> {
    const turn = turnState == null ? null : this.makeTurn(turnState === 'listenNext' ? null : turnState);
    // From the page: the turn goes on after this entry, the list read at its end.
    if (turn && turnState === 'listenNext' && album.id != null) turn.pickUp(entryKey(album.id, album.disc));
    return this.playAlbum(album, tracks, index, at, turn);
  }

  /** Pauses or plays on; `playing` forces one or the other. Not on the appliance any more: Resume. */
  toggle(playing?: boolean): Promise<void> {
    return this.run(async () => {
      this.refuseTaken();
      if (!this.album) return;
      if (!this.onDevice) {
        if (playing === false) return;
        await this.startTrack(this.index, this.position);
        return;
      }
      const want = playing ?? this.status !== 'playing';
      if (want) {
        await this.playNow();
        this.status = 'playing';
        await this.postNext().catch(() => undefined);
      } else {
        await this.call(renderer => renderer.pause());
        this.status = 'paused';
        this.position = this.positionNow();
      }
      this.at = this.now();
      this.save();
      this.emit(true);
    });
  }

  /** Seconds into the track now, moved on from the last poll while it plays. */
  private positionNow(): number {
    if (this.status !== 'playing') return this.position;
    const moved = this.position + (this.now() - this.at) / 1000;
    return this.duration > 0 ? Math.min(moved, this.duration) : moved;
  }

  /** The next track; on the last one, the next album of Listen Next. */
  next(): Promise<void> {
    return this.step(async () => {
      this.refuseTaken();
      if (!this.album) return;
      if (this.index + 1 < this.tracks.length) await this.startTrack(this.index + 1);
      else if (this.queue === 'listenNext') await this.endAlbum('skipped');
    });
  }

  /** Back to the start of the track, or to the one before in its first seconds. */
  previous(): Promise<void> {
    return this.step(async () => {
      this.refuseTaken();
      if (!this.album) return;
      if (this.positionNow() > RESTART_AFTER_SEC || this.index === 0) await this.seekTo(0);
      else await this.startTrack(this.index - 1);
    });
  }

  /** Another track of the album, from its start, Listen Next kept. */
  playTrack(index: number): Promise<void> {
    return this.choose(async () => {
      this.refuseTaken();
      if (!this.album || !this.tracks[index]) return;
      await this.startTrack(index);
    });
  }

  private async seekTo(seconds: number): Promise<void> {
    const at = Math.max(0, this.duration > 0 ? Math.min(seconds, this.duration) : seconds);
    if (!this.onDevice) {
      this.position = at;
      this.at = this.now();
      this.emit(true);
      return;
    }
    await this.call(renderer => renderer.seek(at));
    this.position = at;
    this.lastPosition = at;
    this.at = this.now();
    this.emit(true);
  }

  seek(seconds: number): Promise<void> {
    return this.run(async () => {
      this.refuseTaken();
      if (!this.album) return;
      await this.seekTo(seconds);
    });
  }

  /** The volume, never above the appliance's ceiling; and its mute. */
  setVolume(change: { volume?: number; muted?: boolean }): Promise<void> {
    return this.run(async () => {
      this.refuseTaken();
      if (change.volume != null) {
        const volume = Math.round(Math.max(0, Math.min(change.volume, this.deps.maxVolume())));
        await this.call(renderer => renderer.setVolume(volume));
        this.volume = volume;
      }
      if (change.muted != null) {
        await this.call(renderer => renderer.setMute(change.muted as boolean));
        this.muted = change.muted;
      }
      this.emit(true);
    });
  }

  /** ✕: stopped, the place kept for Resume. Someone else's play is left alone. */
  stop(): Promise<void> {
    return this.choose(async () => {
      if (this.onDevice && this.status !== 'taken' && this.status !== 'unreachable') {
        this.position = this.positionNow();
        await this.call(renderer => renderer.stop()).catch(error => {
          if (!(error instanceof OutputUnreachableError)) throw error;
        });
      }
      this.status = 'stopped';
      this.onDevice = false;
      this.nextSet = -1;
      this.at = this.now();
      this.save();
      this.emit(true);
    });
  }

  /** The track given again where it was left, after something else took the appliance, a stop, or a restart. */
  resume(): Promise<void> {
    return this.choose(async () => {
      if (!this.album) return;
      this.failures = 0;
      await this.startTrack(this.index, this.position);
    });
  }

  /** Paused, for a play carried over elsewhere: someone else's play is left alone. */
  pauseForTransfer(): Promise<void> {
    return this.run(async () => {
      if (!this.onDevice || this.status !== 'playing') return;
      this.position = this.positionNow();
      await this.call(renderer => renderer.pause()).catch(() => undefined);
      this.status = 'paused';
      this.at = this.now();
      this.save();
      this.emit(true);
    });
  }

  /** The play's place, its turn of Listen Next with it: what another appliance takes over. */
  handOver(): { album: PlayerAlbum; tracks: PlayerTrack[]; index: number; position: number; turn: TurnState | null } | null {
    if (!this.album) return null;
    return { album: this.album, tracks: this.tracks, index: this.index, position: this.positionNow(), turn: this.queue === 'listenNext' && this.turn ? this.turn.snapshot() : null };
  }

  /** For the tests and a shutdown: no state left to send. */
  dispose(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
  }
}
