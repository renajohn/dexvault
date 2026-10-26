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

/**
 * A timed text with every line moved by `seconds`, later when positive. A line
 * sung twice moves at both its times; a tag such as "[ar:Adele]" stays.
 */
export const shiftLrc = (lrc: string, seconds: number): string =>
  lrc.split('\n').map(line => {
    const stamps = stampsOf(line);
    if (stamps.length === 0) return line;
    return stamps.map(at => lrcStamp(at + seconds)).join('') + line.replace(STAMPS, '');
  }).join('\n');

/** How far a timing fixed by hand moved LRCLIB's: the gap between their first timed lines. */
export const shiftBetween = (lrclib: string, fixed: string): number => {
  const first = (lrc: string) => lrc.split('\n').map(stampsOf).find(stamps => stamps.length > 0)?.[0];
  const from = first(lrclib);
  const to = first(fixed);
  return from == null || to == null ? 0 : Math.round((to - from) * 100) / 100;
};
