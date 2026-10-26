/** "[mm:ss.xx]" for a time in seconds, LRC's own way, never before the start. */
export const lrcStamp = (seconds: number): string => {
  const hundredths = Math.max(0, Math.round(seconds * 100));
  const min = Math.floor(hundredths / 6000);
  const sec = (hundredths % 6000) / 100;
  return `[${String(min).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}]`;
};

const STAMPS = /^(\s*\[\d+:\d+(?:\.\d+)?\])+/;
const stampsOf = (line: string): number[] =>
  [...(line.match(STAMPS)?.[0] ?? '').matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].map(([, min, sec]) => Number(min) * 60 + Number(sec));

/** Every time of a timed text, in the order they are written: a stamp's place in it is its number. */
export const allStamps = (lrc: string): number[] => lrc.split('\n').flatMap(stampsOf);

/**
 * The lines set by hand, by the number of their stamp (its place in the text,
 * a line sung twice having two): the time each was put at, which the shift
 * of the others leaves where it is.
 */
export type Pins = ReadonlyMap<number, number>;

const NO_PINS: Pins = new Map();

/**
 * A timed text with every line moved by `shift`, later when positive, but
 * those set by hand, which stand where they were put. A line sung twice moves
 * at both its times; a tag such as "[ar:Adele]" stays.
 */
export const retimeLrc = (lrc: string, shift: number, pins: Pins = NO_PINS): string => {
  let stamp = 0;
  return lrc.split('\n').map(line => {
    const stamps = stampsOf(line);
    if (stamps.length === 0) return line;
    return stamps.map(at => lrcStamp(pins.get(stamp++) ?? at + shift)).join('') + line.replace(STAMPS, '');
  }).join('\n');
};

/** A timed text with every line moved by `seconds`, later when positive. */
export const shiftLrc = (lrc: string, seconds: number): string => retimeLrc(lrc, seconds);

/**
 * How a timing fixed by hand stands against LRCLIB's: the shift most of its
 * lines share, and the lines set apart from it by hand. A text with other
 * lines than LRCLIB's is read as shifted by its first line alone.
 */
export const readTiming = (lrclib: string, fixed: string): { shift: number; pins: Map<number, number> } => {
  const from = allStamps(lrclib);
  const to = allStamps(fixed);
  const pins = new Map<number, number>();
  if (from.length === 0 || to.length === 0) return { shift: 0, pins };
  if (from.length !== to.length) return { shift: Math.round((to[0] - from[0]) * 100) / 100, pins };
  const gaps = from.map((at, i) => Math.round((to[i] - at) * 100) / 100);
  const count = new Map<number, number>();
  for (const gap of gaps) count.set(gap, (count.get(gap) ?? 0) + 1);
  const shift = [...count.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0];
  gaps.forEach((gap, i) => { if (Math.abs(gap - shift) > 0.005) pins.set(i, to[i]); });
  return { shift, pins };
};

/** Dragged this close to 0, the slider rests on it: LRCLIB's own timing is easy to come back to. The arrows step through. */
const STICKY_ZERO_SEC = 0.2;
export const sliderShift = (seconds: number): number => (Math.abs(seconds) < STICKY_ZERO_SEC ? 0 : seconds);

/** "+1.25 s", "−2.40 s", "0.00 s". */
export const shiftLabel = (seconds: number): string =>
  `${seconds > 0.004 ? '+' : seconds < -0.004 ? '−' : ''}${Math.abs(seconds).toFixed(2)} s`;
