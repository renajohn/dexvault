import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelsOf, peaksOf } from './audioPeaks';

afterEach(() => vi.unstubAllGlobals());

describe('levelsOf', () => {
  it('reads the level of each slice, the loudest at 1, both channels together', () => {
    const left = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
    const right = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
    expect([...levelsOf([left, right], 2, 1)]).toEqual([0, 0.5, 1]);
  });

  it('takes the wave the server keeps, without reading the file', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ bin: 0.02, levels: btoa(String.fromCharCode(0, 51, 255)) })));
    vi.stubGlobal('fetch', fetch);
    const peaks = await peaksOf('s9');
    expect(fetch).toHaveBeenCalledWith('/api/music/navidrome/waveform/s9');
    expect(peaks.bin).toBe(0.02);
    expect([...peaks.levels].map(level => Number(level.toFixed(3)))).toEqual([0, 0.2, 1]);
  });
});
