import React, { useEffect, useRef, useState } from 'react';
import { player } from '../services/player';
import { peaksOf, type Peaks } from '../utils/audioPeaks';
import type { LyricLine } from './LyricsPanel';
import { Spinner } from './shared/Spinner';
import './LyricsWave.css';

/** The wave shows this long before the position and after it: what is coming, mostly. */
const BEFORE_SEC = 2;
const AFTER_SEC = 6;
/** The eye reads a little before the voice sings, as the panel lights its lines. */
const LEAD_SEC = 0.2;
/** Scrubbed, the track is asked for its new place at most this often: each seek fetches the file anew. */
const SEEK_EVERY_MS = 150;

interface LyricsWaveProps {
  songId: string;
  /** The lines as they stand, moved by the shift. */
  lines: LyricLine[];
}

const colour = (element: Element, name: string, fallback: string) =>
  getComputedStyle(element).getPropertyValue(name).trim() || fallback;

/**
 * The track's wave running past under its lines' starts, for fixing its
 * timing: a step in the wave is the voice coming in, and the line's mark
 * should stand there. Dragged sideways, it scrubs the track, as a tape
 * pulled by hand: to the right, back. The music holds while it is held, and
 * plays on from there as it is let go.
 */
const LyricsWave: React.FC<LyricsWaveProps> = ({ songId, lines }) => {
  // Undefined while the track is read, null when it could not be.
  const [peaks, setPeaks] = useState<Peaks | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    setPeaks(undefined);
    peaksOf(songId).then(found => { if (current) setPeaks(found); }).catch(() => { if (current) setPeaks(null); });
    return () => { current = false; };
  }, [songId]);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // Where the hand holds the track while scrubbing: drawn at once, the audio following.
  const scrubbing = useRef<{ x: number; from: number; at: number; seekAt: number; timer?: number; wasPlaying: boolean } | null>(null);

  // Drawn at each frame from the audio's own position, as the panel follows it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !peaks) return undefined;
    const ink = { now: colour(canvas, '--dv-text', '#e5e5e5'), mark: colour(canvas, '--dv-gold', '#fbbf24') };
    let frame = 0;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const now = scrubbing.current?.at ?? player.currentTime();
      const perSec = width / (BEFORE_SEC + AFTER_SEC);
      const x = (at: number) => (at - now + BEFORE_SEC) * perSec;
      const middle = height * 0.6;
      // The wave: what was played dimmer than what is coming. Each bar holds the same slices of the track from
      // one frame to the next and only slides; read afresh under each pixel, the bars would flicker as it plays.
      const per = Math.max(1, Math.round(2 / perSec / peaks.bin));
      const barSec = per * peaks.bin;
      const first = Math.max(0, Math.floor((now - BEFORE_SEC) / barSec));
      const last = Math.min(Math.ceil(peaks.levels.length / per), Math.ceil((now + AFTER_SEC) / barSec));
      for (let bar = first; bar < last; bar++) {
        let level = 0;
        for (let slice = bar * per; slice < Math.min(peaks.levels.length, (bar + 1) * per); slice++) level = Math.max(level, peaks.levels[slice]);
        const half = Math.max(0.5, level * height * 0.36);
        context.fillStyle = (bar + 0.5) * barSec < now ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.55)';
        context.fillRect(x(bar * barSec), middle - half, Math.max(1, barSec * perSec - 0.5), half * 2);
      }
      // Each line's start, with its first words: the one lit in white, the others gold.
      const lit = linesRef.current.reduce((found, line, i) => (line.at <= now + LEAD_SEC ? i : found), -1);
      context.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.textBaseline = 'top';
      const marks = linesRef.current.flatMap((line, i) => (line.text === null ? [] : [{ i, at: x(line.at), text: line.text }]));
      marks.forEach((mark, k) => {
        if (mark.at < -160 || mark.at > width + 4) return;
        context.fillStyle = mark.i === lit ? ink.now : ink.mark;
        context.fillRect(mark.at, 15, 1.5, height - 15);
        context.beginPath();
        context.moveTo(mark.at - 4, 15);
        context.lineTo(mark.at + 5.5, 15);
        context.lineTo(mark.at + 0.75, 21);
        context.fill();
        // Its first words, as many as fit before the next mark.
        const room = (marks[k + 1]?.at ?? Infinity) - mark.at - 12;
        const words = mark.text.split(/\s+/).slice(0, 3);
        while (words.length > 0 && context.measureText(`${words.join(' ')}…`).width > room) words.pop();
        if (words.length > 0) context.fillText(`${words.join(' ')}…`, mark.at + 5, 2);
      });
      context.fillStyle = ink.now;
      context.fillRect(x(now) - 1, 0, 2, height);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [peaks]);

  // Dragged sideways, the track follows the pointer: to the right, back in it. The lines follow too, the music held.
  const [dragging, setDragging] = useState(false);
  const perSec = () => (boxRef.current?.clientWidth || 1) / (BEFORE_SEC + AFTER_SEC);
  const length = peaks ? peaks.levels.length * peaks.bin : 0;
  const seekNow = () => {
    const scrub = scrubbing.current;
    if (!scrub) return;
    window.clearTimeout(scrub.timer);
    scrub.timer = undefined;
    scrub.seekAt = Date.now();
    player.seek(scrub.at);
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!peaks) return;
    const from = player.currentTime();
    const wasPlaying = Boolean(player.getState().playing);
    scrubbing.current = { x: event.clientX, from, at: from, seekAt: 0, wasPlaying };
    if (wasPlaying) player.toggle(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const scrub = scrubbing.current;
    if (!scrub) return;
    scrub.at = Math.min(length, Math.max(0, scrub.from - (event.clientX - scrub.x) / perSec()));
    const wait = SEEK_EVERY_MS - (Date.now() - scrub.seekAt);
    if (wait <= 0) seekNow();
    else if (scrub.timer === undefined) scrub.timer = window.setTimeout(seekNow, wait);
  };
  const onPointerUp = () => {
    const scrub = scrubbing.current;
    if (scrub && scrub.at !== scrub.from) seekNow();
    scrubbing.current = null;
    setDragging(false);
    if (scrub?.wasPlaying) player.toggle(true);
  };
  useEffect(() => () => window.clearTimeout(scrubbing.current?.timer), []);

  return (
    <div ref={boxRef} className={`lyrics-wave${dragging ? ' lyrics-wave--dragging' : ''}${peaks ? ' lyrics-wave--ready' : ''}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      title={peaks ? 'Drag to move in the track' : undefined}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {peaks === undefined && <span className="lyrics-wave-word"><Spinner size="sm" /> Reading the track…</span>}
      {peaks === null && <span className="lyrics-wave-word">The wave could not be read: the slider still moves the words.</span>}
    </div>
  );
};

export default LyricsWave;
