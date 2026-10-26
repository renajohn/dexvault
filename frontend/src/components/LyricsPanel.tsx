import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsStopwatch, BsX } from 'react-icons/bs';
import musicService, { type TimingKept, type TrackLyrics } from '../services/musicService';
import { player, usePlayer } from '../services/player';
import { shiftBetween, shiftLrc } from '../utils/lyricsTiming';
import Button, { IconButton } from './shared/Button';
import LyricsWave from './LyricsWave';
import Menu from './shared/Menu';
import Segmented from './shared/Segmented';
import { Loading } from './shared/Spinner';
import { toast } from './shared/Toast';
import './LyricsPanel.css';

/** A line of a timed text; no words is a silence of the voice, shown as three dots. */
export interface LyricLine {
  at: number;
  text: string | null;
}

/** The eye reads a little before the voice sings: a line lights a fifth of a second early. */
const LEAD_SEC = 0.2;
/** Scrolled by hand, the words go back to the song after this long. */
const FOLLOW_AGAIN_MS = 5000;
/** An empty line opens a silence when the next words are this far. */
const SILENCE_SEC = 4;
/** Without an empty line, a gap this long after a line is a silence too, from a while after it was sung. */
const LONG_GAP_SEC = 12;
const SILENCE_AFTER_SEC = 6;
/** The line sung stands at this height of the panel. */
const ANCHOR = 0.3;
/** How far the slider moves the words, either way. */
const MOST_SHIFT_SEC = 10;

/** Slower to hear where the voice comes in; the pitch stays. */
const SPEEDS = ['1', '0.75', '0.5', '0.25'] as const;
type Speed = typeof SPEEDS[number];

const roundShift = (seconds: number) => Math.round(Math.min(MOST_SHIFT_SEC, Math.max(-MOST_SHIFT_SEC, seconds)) * 100) / 100;

/** "+1.25 s", "−2.40 s", "0.00 s". */
export const shiftLabel = (seconds: number): string =>
  `${seconds > 0.004 ? '+' : seconds < -0.004 ? '−' : ''}${Math.abs(seconds).toFixed(2)} s`;

/** What the .lrc beside the rip became, when the timing was meant to go there. */
const lrcWord = (kept: TimingKept, into: boolean): string | null => {
  if (!into) return null;
  if (kept.lrc === 'kept') return 'The .lrc beside the rip was not DexVault’s: left as it was.';
  if (kept.lrc === 'none' && kept.lyrics.timing === 'saved') return 'Saved into the lyrics: no rip to write it beside yet.';
  return null;
};

/**
 * The lines of an LRC text ("[mm:ss.xx] words"), in order, with the
 * silences of the voice: before the first words, at an empty line, in a long
 * gap. A line sung more than once carries all its times.
 */
export const parseLrc = (lrc: string): LyricLine[] => {
  const timed: Array<{ at: number; text: string }> = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/^(\s*\[[^\]]*\])+\s?/, '').trim();
    for (const stamp of stamps) timed.push({ at: Number(stamp[1]) * 60 + Number(stamp[2]), text });
  }
  timed.sort((a, b) => a.at - b.at);

  const lines: LyricLine[] = [];
  if (timed.length > 0 && timed[0].at > SILENCE_SEC) lines.push({ at: 0, text: null });
  timed.forEach((line, i) => {
    const next = timed[i + 1];
    if (!line.text) {
      if (next && next.at - line.at > SILENCE_SEC) lines.push({ at: line.at, text: null });
      return;
    }
    lines.push(line);
    if (next?.text && next.at - line.at > LONG_GAP_SEC) lines.push({ at: line.at + SILENCE_AFTER_SEC, text: null });
  });
  return lines;
};

/** The line sung at `seconds`: the last to have started, -1 before the first. */
export const lineAt = (lines: LyricLine[], seconds: number): number => {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].at <= seconds; i++) index = i;
  return index;
};

/**
 * How far the lines may be moved by hand: from the first line to the last
 * standing where the line sung stands, as the song itself takes them.
 */
export const withinLines = (y: number, anchor: number, firstTop: number, lastTop: number): number =>
  Math.min(anchor - firstTop, Math.max(anchor - lastTop, y));

/**
 * The words of the track playing, in a card at the bottom left above the
 * player's bar, on a desktop: the line sung in white, the cover's colours
 * turning slowly behind. A click on a line plays from there. A record's card
 * opens beside it, on the right. It lies on the page's body, as the dialogs
 * do, to stand above a card's shade.
 */
const LyricsPanel: React.FC = () => {
  const open = usePlayer(state => state.lyricsOpen && state.barShown);
  const album = usePlayer(state => state.album);
  const track = usePlayer(state => state.tracks[state.index]);
  const albumId = album?.id ?? null;
  const shown = Boolean(open && album && albumId != null && track);
  const disc = track?.disc;
  const no = track?.no;

  // Undefined while they are looked for, null when they could not be read.
  const [lyrics, setLyrics] = useState<TrackLyrics | null | undefined>(undefined);
  useEffect(() => {
    if (!shown || albumId == null || disc == null || no == null) return undefined;
    let current = true;
    setLyrics(undefined);
    musicService.getLyrics(albumId, disc, no)
      .then(found => { if (current) setLyrics(found); })
      .catch(() => { if (current) setLyrics(null); });
    return () => { current = false; };
  }, [shown, albumId, disc, no]);

  // Fixing the timing: LRCLIB's lines moved by the slider, as the song plays.
  const [fixing, setFixing] = useState(false);
  const [shift, setShift] = useState(0);
  const [intoLyrics, setIntoLyrics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [speed, setSpeed] = useState<Speed>('1');
  // An appliance plays at its own pace: slower is for this browser alone.
  const here = usePlayer(state => state.output.kind === 'local');
  const lrclib = lyrics?.lrclibSynced ?? lyrics?.synced ?? null;
  useEffect(() => { setFixing(false); }, [lyrics]);
  // Back to the song's own pace as the drawer closes, however it closes.
  useEffect(() => {
    if (!fixing) return undefined;
    setSpeed('1');
    return () => player.setRate(1);
  }, [fixing]);
  const changeSpeed = (next: Speed) => {
    setSpeed(next);
    player.setRate(Number(next));
  };

  const lines = useMemo(() => {
    const text = fixing && lrclib ? shiftLrc(lrclib, shift) : lyrics?.synced;
    return text ? parseLrc(text) : [];
  }, [lyrics, lrclib, fixing, shift]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const timed = lines.length > 0;
  const [index, setIndex] = useState(-1);
  const [following, setFollowing] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const offset = useRef(0);
  const followTimer = useRef<number | undefined>(undefined);

  // The line sung, read from the audio at each frame: the bar's position moves a few times a second only.
  // The lines are read as they are: the slider moves them while the song plays.
  useEffect(() => {
    setIndex(-1);
    setFollowing(true);
    offset.current = 0;
    if (!shown || !timed) return undefined;
    let frame = 0;
    const tick = () => {
      setIndex(lineAt(linesRef.current, player.currentTime() + LEAD_SEC));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [shown, timed, lyrics]);

  const moveTo = useCallback((y: number, smooth = true) => {
    offset.current = y;
    const list = listRef.current;
    if (!list) return;
    list.classList.toggle('lyrics-panel-still', !smooth);
    list.style.transform = `translateY(${y}px)`;
  }, []);

  const place = useCallback(() => {
    const box = boxRef.current;
    const line = listRef.current?.children[Math.max(0, index)] as HTMLElement | undefined;
    if (box && line) moveTo(box.clientHeight * ANCHOR - line.offsetTop);
  }, [index, moveTo]);

  useLayoutEffect(() => {
    if (following) place();
  }, [following, place]);

  useEffect(() => {
    if (!following) return undefined;
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [following, place]);

  const followAgain = useCallback(() => {
    window.clearTimeout(followTimer.current);
    setFollowing(true);
  }, []);
  useEffect(() => () => window.clearTimeout(followTimer.current), []);

  // Scrolled by hand, the words stop following the song a while. Not passive: the page must not scroll beneath.
  useEffect(() => {
    const box = boxRef.current;
    if (!shown || !box || !timed) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const lines = listRef.current?.children;
      const first = lines?.[0] as HTMLElement | undefined;
      const last = lines?.[lines.length - 1] as HTMLElement | undefined;
      if (!first || !last) return;
      moveTo(withinLines(offset.current - event.deltaY, box.clientHeight * ANCHOR, first.offsetTop, last.offsetTop), false);
      setFollowing(false);
      window.clearTimeout(followTimer.current);
      followTimer.current = window.setTimeout(() => setFollowing(true), FOLLOW_AGAIN_MS);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [shown, timed, moveTo]);

  const startFixing = () => {
    if (!lyrics?.synced || !lrclib) return;
    setShift(shiftBetween(lrclib, lyrics.synced));
    setIntoLyrics(lyrics.timing === 'saved');
    setFixing(true);
    if (!player.getState().playing) player.toggle(true);
  };

  const keep = async (changes: () => Promise<TimingKept>, into: boolean, said: string, offerInto: boolean) => {
    if (albumId == null || disc == null || no == null) return;
    setSaving(true);
    try {
      const kept = await changes();
      setLyrics(kept.lyrics);
      const word = lrcWord(kept, into);
      toast(word ?? said, {
        tone: word ? 'warning' : 'success',
        action: offerInto && !word ? { label: 'Save into the lyrics', onClick: () => void saveInto(kept.lyrics) } : undefined,
      });
    } catch (error) {
      toast(`The timing was not kept: ${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const saveInto = (from: TrackLyrics | null | undefined = lyrics) => {
    if (!from?.synced || albumId == null || disc == null || no == null) return Promise.resolve();
    return keep(() => musicService.fixLyricsTiming(albumId, disc, no, from.synced!, true), true, 'Timing saved into the lyrics.', false);
  };

  const save = () => {
    if (!lrclib || albumId == null || disc == null || no == null) return;
    if (Math.abs(shift) < 0.005) {
      void keep(() => musicService.resetLyricsTiming(albumId, disc, no), false, 'Back to LRCLIB’s timing.', false);
      return;
    }
    void keep(() => musicService.fixLyricsTiming(albumId, disc, no, shiftLrc(lrclib, shift), intoLyrics), intoLyrics,
      intoLyrics ? 'Timing saved into the lyrics.' : 'Timing fixed, in DexVault only.', !intoLyrics);
  };

  const reset = () => {
    if (albumId == null || disc == null || no == null) return;
    void keep(() => musicService.resetLyricsTiming(albumId, disc, no), lyrics?.timing === 'saved', 'Back to LRCLIB’s timing.', false);
  };

  // While fixing, the arrows move the words and Esc lets go: caught first and kept, so that neither the slider,
  // nor a record's card (its arrows go from record to record, its Esc closes it), nor the page scrolling takes them too.
  useEffect(() => {
    if (!fixing) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const field = event.target instanceof Element ? event.target : null;
      if (field?.closest('input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = (event.shiftKey ? 1 : 0.1) * (event.key === 'ArrowLeft' ? -1 : 1);
        setShift(previous => roundShift(previous + step));
      } else if (event.key === 'Escape') {
        setFixing(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fixing]);

  if (!shown || !album || !track) return null;

  const playFrom = (line: LyricLine) => {
    player.seek(Math.max(0, line.at - 0.05));
    if (!player.getState().playing) player.toggle(true);
    followAgain();
  };

  let body: React.ReactNode;
  if (lyrics === undefined) {
    body = <Loading className="lyrics-panel-wait">Looking for the words…</Loading>;
  } else if (lyrics?.status === 'instrumental') {
    body = <p className="lyrics-panel-none">An instrumental: no words to sing.</p>;
  } else if (lines.length > 0) {
    body = (
      // Read by hand, every line comes clear; back with the song, those far from it blur again.
      <div className={`lyrics-panel-lines${following && !fixing ? '' : ' lyrics-panel-browsing'}`} ref={boxRef}>
        <ol ref={listRef}>
          {lines.map((line, i) => {
            const state = i === index ? ' lyrics-panel-now' : i < index ? ' lyrics-panel-past' : '';
            const far = Math.abs(i - index) > 2 ? ' lyrics-panel-far' : '';
            return line.text === null ? (
              <li key={i} className={`lyrics-panel-silence${state}`} onClick={() => playFrom(line)} aria-label="Instrumental break">
                <i /><i /><i />
              </li>
            ) : (
              <li key={i} className={`${state}${far}`.trim() || undefined} onClick={() => playFrom(line)}
                aria-current={i === index ? 'true' : undefined}>
                {line.text}
              </li>
            );
          })}
        </ol>
        {!following && !fixing && (
          <Button size="sm" className="lyrics-panel-follow" onClick={followAgain}>Back to the song</Button>
        )}
      </div>
    );
  } else if (lyrics?.plain) {
    body = (
      <div className="lyrics-panel-untimed">
        <span className="lyrics-panel-tag">Not timed</span>
        {lyrics.plain.split('\n').map((line, i) => (line.trim() ? <p key={i}>{line}</p> : <br key={i} />))}
      </div>
    );
  } else {
    body = <p className="lyrics-panel-none">No words found for this track.</p>;
  }

  return createPortal(
    <aside className="lyrics-panel" aria-label="Lyrics">
      {album.cover && (
        // Two copies of the cover turning against each other, blurred: the panel takes the album's colours.
        <div className="lyrics-panel-cover" key={album.cover} aria-hidden="true">
          <i style={{ backgroundImage: `url("${album.cover}")` }} />
          <i style={{ backgroundImage: `url("${album.cover}")` }} />
        </div>
      )}
      {/* No head: the bar below says the track, its album and its cover already. */}
      <div className="lyrics-panel-actions">
        {timed && !fixing && (
          <Menu align="end" label="Timing" trigger={props => (
            <IconButton {...props} label={lyrics?.timing === 'saved' ? 'Timing saved into the lyrics' : lyrics?.timing === 'fixed' ? 'Timing fixed' : 'Timing'}
              active={lyrics?.timing === 'fixed' || lyrics?.timing === 'saved'} loading={saving}><BsStopwatch /></IconButton>
          )}>
            <Menu.Item onSelect={startFixing} hint="Shift the words to the voice">Fix timing…</Menu.Item>
            {lyrics?.timing === 'fixed' && (
              <Menu.Item onSelect={() => void saveInto()} hint="Navidrome, Amperfy">Save timing into the lyrics</Menu.Item>
            )}
            {(lyrics?.timing === 'fixed' || lyrics?.timing === 'saved') && (
              <>
                <Menu.Separator />
                <Menu.Item danger onSelect={reset}>Reset timing</Menu.Item>
              </>
            )}
          </Menu>
        )}
        <IconButton label="Close lyrics" onClick={() => player.showLyrics(false)}><BsX /></IconButton>
      </div>
      {body}
      {fixing && timed && (
        <div className="lyrics-panel-fix menu-surface" role="group" aria-label="Fix timing">
          <div className="lyrics-panel-fix-head">
            <span>Words <output className={Math.abs(shift) > 0.004 ? 'lyrics-panel-fix-moved' : undefined} aria-live="polite">{shiftLabel(shift)}</output></span>
            {here && (
              <Segmented label="Speed" size="sm" value={speed} onChange={changeSpeed}
                options={SPEEDS.map(value => ({ value, label: `${value}×`, tooltip: value === '1' ? 'The song’s own pace' : 'Slower, the same pitch' }))} />
            )}
          </div>
          <LyricsWave songId={track.songId} lines={lines} />
          <div className="lyrics-panel-fix-slider">
            <Button size="sm" variant="quiet" onClick={() => setShift(previous => roundShift(previous - 0.1))} title="Words earlier">−0.1</Button>
            <input type="range" className="ui-range" aria-label="Shift the words" min={-MOST_SHIFT_SEC} max={MOST_SHIFT_SEC} step={0.05}
              value={shift} onChange={event => setShift(roundShift(Number(event.target.value)))} />
            <Button size="sm" variant="quiet" onClick={() => setShift(previous => roundShift(previous + 0.1))} title="Words later">+0.1</Button>
          </div>
          <p className="lyrics-panel-fix-hint">Slide until each mark stands where the voice comes in: <kbd>←</kbd> <kbd>→</kbd> by 0.1 s, with <kbd>⇧</kbd> by 1 s. Drag the wave to go back or on in the track.</p>
          <div className="lyrics-panel-fix-foot">
            <label className="lyrics-panel-fix-into" title="Written in the .lrc beside the rip, for Navidrome and Amperfy, and kept whatever LRCLIB says next">
              <input type="checkbox" checked={intoLyrics} onChange={event => setIntoLyrics(event.target.checked)} /> Save into the lyrics too
            </label>
            <Button variant="quiet" size="sm" onClick={() => setFixing(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={saving} onClick={() => { setFixing(false); save(); }}>Save</Button>
          </div>
        </div>
      )}
    </aside>,
    document.body,
  );
};

export default LyricsPanel;
