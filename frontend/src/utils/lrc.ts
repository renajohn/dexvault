/** A line of a timed text; no words is a silence of the voice, shown as three dots. */
export interface LyricLine {
  at: number;
  text: string | null;
  /** The number of its time in the text, in the order written: how a line set by hand is known. None for a silence read from a gap. */
  stamp?: number;
}

/** An empty line opens a silence when the next words are this far. */
const SILENCE_SEC = 4;
/** Without an empty line, a gap this long after a line is a silence too, from a while after it was sung. */
const LONG_GAP_SEC = 12;
const SILENCE_AFTER_SEC = 6;

/**
 * The lines of an LRC text ("[mm:ss.xx] words"), in order, with the
 * silences of the voice: before the first words, at an empty line, in a long
 * gap. A line sung more than once carries all its times.
 */
export const parseLrc = (lrc: string): LyricLine[] => {
  const timed: Array<{ at: number; text: string; stamp: number }> = [];
  let count = 0;
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/^(\s*\[[^\]]*\])+\s?/, '').trim();
    for (const stamp of stamps) timed.push({ at: Number(stamp[1]) * 60 + Number(stamp[2]), text, stamp: count++ });
  }
  timed.sort((a, b) => a.at - b.at);

  const lines: LyricLine[] = [];
  if (timed.length > 0 && timed[0].at > SILENCE_SEC) lines.push({ at: 0, text: null });
  timed.forEach((line, i) => {
    const next = timed[i + 1];
    if (!line.text) {
      if (next && next.at - line.at > SILENCE_SEC) lines.push({ at: line.at, text: null, stamp: line.stamp });
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
