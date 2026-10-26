import { describe, expect, it } from 'vitest';
import { lrcStamp, readTiming, retimeLrc, shiftLrc } from './lyricsTiming';

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

  it('leaves the lines set by hand where they were put, by the number of their stamp', () => {
    expect(retimeLrc('[00:05.00] A\n[00:09.00][01:00.00] B\n[00:12.00] C', -2, new Map([[2, 59.5]])))
      .toBe('[00:03.00] A\n[00:07.00][00:59.50] B\n[00:10.00] C');
  });

  it('reads the shift most lines share, and the lines set apart by hand', () => {
    const lrclib = '[ar:x]\n[00:08.40] A\n[00:12.00] B\n[00:20.00] C';
    expect(readTiming(lrclib, '[00:06.00] A\n[00:09.60] B\n[00:17.60] C')).toEqual({ shift: -2.4, pins: new Map() });
    expect(readTiming(lrclib, '[00:06.00] A\n[00:10.00] B\n[00:17.60] C')).toEqual({ shift: -2.4, pins: new Map([[1, 10]]) });
    expect(readTiming(lrclib, lrclib)).toEqual({ shift: 0, pins: new Map() });
    expect(readTiming('no times', '[00:06.00] A').shift).toBe(0);
  });
});
