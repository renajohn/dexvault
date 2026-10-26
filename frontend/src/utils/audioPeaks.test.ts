import { describe, expect, it } from 'vitest';
import { levelsOf } from './audioPeaks';

describe('levelsOf', () => {
  it('reads the level of each slice, the loudest at 1, both channels together', () => {
    const left = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
    const right = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
    expect([...levelsOf([left, right], 2, 1)]).toEqual([0, 0.5, 1]);
  });
});
