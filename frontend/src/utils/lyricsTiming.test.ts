import { describe, expect, it } from 'vitest';
import { lrcStamp, shiftBetween, shiftLrc } from './lyricsTiming';

describe('lyricsTiming', () => {
  it('writes a time as LRC does, never before the start', () => {
    expect(lrcStamp(5.15)).toBe('[00:05.15]');
    expect(lrcStamp(83.456)).toBe('[01:23.46]');
    expect(lrcStamp(-1)).toBe('[00:00.00]');
  });

  it('moves every line, a line sung twice at both its times, and leaves the tags', () => {
    expect(shiftLrc('[ar:Adele]\n[00:05.15] Fire\n[00:09.74][01:02.00] Reaching\n\nplain', -2.4))
      .toBe('[ar:Adele]\n[00:02.75] Fire\n[00:07.34][00:59.60] Reaching\n\nplain');
    expect(shiftLrc('[00:01.00] Early', -3)).toBe('[00:00.00] Early');
  });

  it('reads how far a fixed timing moved LRCLIB’s', () => {
    expect(shiftBetween('[ar:x]\n[00:08.40] A\n[00:12.00] B', '[00:06.00] A\n[00:09.60] B')).toBe(-2.4);
    expect(shiftBetween('no times', '[00:06.00] A')).toBe(0);
  });
});
