import { describe, it, expect } from 'vitest';
import { isVideoMedium, soundDiscs, videoDiscs } from './medium';

describe('medium', () => {
  it('knows a disc of pictures from one of sound', () => {
    for (const format of ['DVD-Video', 'DVD', 'Blu-ray', 'VHS']) expect(isVideoMedium(format)).toBe(true);
    for (const format of ['CD', 'SACD', 'DVD-Audio', 'Blu-ray Audio', null, undefined]) expect(isVideoMedium(format)).toBe(false);
  });

  it('splits a CD + DVD into the disc that plays and the film', () => {
    const discs = [{ number: 1, format: 'CD' }, { number: 2, format: 'DVD-Video' }, { number: 3 }];
    expect(soundDiscs(discs).map(disc => disc.number)).toEqual([1, 3]);
    expect(videoDiscs(discs).map(disc => disc.number)).toEqual([2]);
  });
});
