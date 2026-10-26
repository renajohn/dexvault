import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import musicService, { type LyricsVersion, type TimingKept, type TrackLyrics } from '../services/musicService';
import { player } from '../services/player';
import { parseLrc } from '../utils/lrc';
import { readTiming, retimeLrc } from '../utils/lyricsTiming';
import { toast } from './shared/Toast';

/** How far the slider moves the words, either way. */
export const MOST_SHIFT_SEC = 10;
/** A line set by hand keeps this far from its neighbours: the words stay in their order. */
const LINE_GAP_SEC = 0.05;
/** Slower to hear where the voice comes in; the pitch stays. */
export const SPEEDS = ['1', '0.5'] as const;
type Speed = typeof SPEEDS[number];

/** How the drawer is used, under its (i). */
export const HELP = {
  mouse: 'The slider moves every line: ← → by 0.1 s, with ⇧ by 1 s. Drag a mark to set its line alone: the music holds while it is held. '
    + 'A double click resets it; drag the wave to go back or on in the track.',
  touch: 'The slider moves every line. Drag a mark to set its line alone: the music holds while it is held. '
    + 'A double tap resets it; drag the wave to go back or on in the track.',
};

const roundShift = (seconds: number) => Math.round(Math.min(MOST_SHIFT_SEC, Math.max(-MOST_SHIFT_SEC, seconds)) * 100) / 100;

/** What the .lrc beside the rip became, when the timing was meant to go there. */
const lrcWord = (kept: TimingKept, into: boolean): string | null => {
  if (!into) return null;
  if (kept.lrc === 'kept') return 'The .lrc beside the rip was not DexVault’s: left as it was.';
  if (kept.lrc === 'none' && kept.lyrics.timing === 'saved') return 'Saved into the lyrics: no rip to write it beside yet.';
  return null;
};

interface TimingOf {
  lyrics: TrackLyrics | null | undefined;
  setLyrics: (lyrics: TrackLyrics) => void;
  albumId: number | null | undefined;
  disc: number | null | undefined;
  no: number | null | undefined;
}

/**
 * Fixing a track's timing, wherever its words are shown: LRCLIB's lines moved
 * by the slider as the song plays, those set by hand on the wave left where
 * they were put. `lines` are the words to show, moved as they are being fixed.
 * Saved, the timing is kept in DexVault, or into the lyrics too.
 */
export const useLyricsTiming = ({ lyrics, setLyrics, albumId, disc, no }: TimingOf) => {
  const [fixing, setFixing] = useState(false);
  const [shift, setShift] = useState(0);
  const [intoLyrics, setIntoLyrics] = useState(false);
  const [saving, setSaving] = useState(false);
  // The lines set by hand on the wave, by the number of their stamp: the slider leaves them where they were put.
  const [pins, setPins] = useState<ReadonlyMap<number, number>>(new Map());
  const [speed, setSpeed] = useState<Speed>('1');
  const lrclib = lyrics?.lrclibSynced ?? lyrics?.synced ?? null;
  useEffect(() => { setFixing(false); }, [lyrics]);

  // Trying another of LRCLIB's versions on the song: its words shown in place of those in use, until kept or let go.
  const [trying, setTrying] = useState<{ versions: LyricsVersion[]; index: number; where: { albumId: number; disc: number; no: number } } | null>(null);
  const tried = trying ? trying.versions[trying.index] : null;
  const tryingRef = useRef(trying);
  tryingRef.current = trying;
  // The track over before a choice: nothing is kept, and the toast offers to keep it all the same.
  useEffect(() => {
    const was = tryingRef.current;
    if (!was) return;
    setTrying(null);
    const version = was.versions[was.index];
    if (version.current) return;
    toast('The version tried was not kept.', {
      action: { label: 'Keep it', onClick: () => {
        musicService.chooseLyricsVersion(was.where.albumId, was.where.disc, was.where.no, version.id)
          .then(() => toast('Kept for that track.', { tone: 'success' }))
          .catch(error => toast(`It was not kept: ${(error as Error).message}`, { tone: 'danger' }));
      } },
    });
  }, [albumId, disc, no]);
  // The words to show: those tried, else those in use.
  const shown: TrackLyrics | null | undefined = tried && lyrics ? { ...lyrics, synced: tried.synced, plain: tried.plain } : lyrics;
  // Back to the song's own pace as the drawer closes, however it closes.
  useEffect(() => {
    if (!fixing) return undefined;
    setSpeed('1');
    return () => player.setRate(1);
  }, [fixing]);

  const lines = useMemo(() => {
    // A version tried shows its own words.
    const text = tried ? tried.synced : fixing && lrclib ? retimeLrc(lrclib, shift, pins) : lyrics?.synced;
    return text ? parseLrc(text) : [];
  }, [lyrics, lrclib, fixing, shift, pins, tried]);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const start = () => {
    if (!lyrics?.synced || !lrclib) return;
    const fixed = readTiming(lrclib, lyrics.synced);
    setShift(fixed.shift);
    setPins(fixed.pins);
    setIntoLyrics(lyrics.timing === 'saved');
    setFixing(true);
    if (!player.getState().playing) player.toggle(true);
  };

  const keep = async (changes: () => Promise<TimingKept>, into: boolean, said: string, offerInto: boolean,
    action?: { label: string; onClick: () => void }) => {
    if (albumId == null || disc == null || no == null) return;
    setSaving(true);
    try {
      const kept = await changes();
      setLyrics(kept.lyrics);
      const word = lrcWord(kept, into);
      toast(word ?? said, {
        tone: word ? 'warning' : 'success',
        action: action ?? (offerInto && !word ? { label: 'Save into the lyrics', onClick: () => void saveInto(kept.lyrics) } : undefined),
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
    setFixing(false);
    if (!lrclib || albumId == null || disc == null || no == null) return;
    if (Math.abs(shift) < 0.005 && pins.size === 0) {
      void keep(() => musicService.resetLyricsTiming(albumId, disc, no), false, 'Back to LRCLIB’s timing.', false);
      return;
    }
    void keep(() => musicService.fixLyricsTiming(albumId, disc, no, retimeLrc(lrclib, shift, pins), intoLyrics), intoLyrics,
      intoLyrics ? 'Timing saved into the lyrics.' : 'Timing fixed, in DexVault only.', !intoLyrics);
  };

  const reset = () => {
    if (albumId == null || disc == null || no == null) return;
    void keep(() => musicService.resetLyricsTiming(albumId, disc, no), lyrics?.timing === 'saved', 'Back to LRCLIB’s timing.', false);
  };

  // Another of LRCLIB's texts, chosen: its own timing, none fixed yet.
  const choose = (sourceId: string) => {
    if (albumId == null || disc == null || no == null) return;
    const before = lyrics?.sourceId;
    void keep(() => musicService.chooseLyricsVersion(albumId, disc, no, sourceId), false, 'Another version of the words.', false,
      before ? { label: 'Undo', onClick: () => choose(before) } : undefined);
  };

  const tryVersion = (versions: LyricsVersion[], index: number) => {
    if (albumId == null || disc == null || no == null) return;
    setFixing(false);
    setTrying({ versions, index, where: { albumId, disc, no } });
    if (!player.getState().playing) player.toggle(true);
  };
  const stepTry = (by: number) => setTrying(now => (now ? { ...now, index: (now.index + by + now.versions.length) % now.versions.length } : now));
  const keepTried = () => {
    setTrying(null);
    if (tried && !tried.current) choose(tried.id);
  };

  // A line's mark dragged on the wave: it stands there from now on, between its neighbours, whatever the slider does.
  const pin = useCallback((stamp: number, at: number) => {
    const sung = linesRef.current.filter(line => line.text !== null && line.stamp != null);
    const i = sung.findIndex(line => line.stamp === stamp);
    if (i < 0) return;
    const after = (sung[i - 1]?.at ?? 0) + (i > 0 ? LINE_GAP_SEC : 0);
    const before = (sung[i + 1]?.at ?? Infinity) - LINE_GAP_SEC;
    const put = Math.round(Math.min(before, Math.max(after, at)) * 100) / 100;
    setPins(previous => new Map(previous).set(stamp, put));
  }, []);
  const release = useCallback((stamp: number) => {
    setPins(previous => {
      const next = new Map(previous);
      next.delete(stamp);
      return next;
    });
  }, []);

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

  return {
    lyrics, shown, lines, fixing, start,
    trying: trying && tried ? { version: tried, index: trying.index, count: trying.versions.length } : null,
    tryVersion, stepTry, keepTried, revertTry: () => setTrying(null), cancel: () => setFixing(false), save, saveInto, reset, saving, choose,
    where: albumId != null && disc != null && no != null ? { albumId, disc, no } : null,
    shift, setShift: (seconds: number) => setShift(roundShift(seconds)), pins, pin, release, resetPins: () => setPins(new Map()),
    intoLyrics, setIntoLyrics, speed,
    changeSpeed: (next: Speed) => { setSpeed(next); player.setRate(Number(next)); },
  };
};

export type LyricsTiming = ReturnType<typeof useLyricsTiming>;
