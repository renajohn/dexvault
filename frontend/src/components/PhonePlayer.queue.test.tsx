import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhonePlayer from './PhonePlayer';
import { player } from '../services/player';
import { playingQueue, restQueue } from './QueueEntries';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../services/musicService', () => ({
  default: { getMixtapes: vi.fn(async () => ({ configured: true, mixtapes: [] })), getLyrics: vi.fn(async () => null), getAlbumGuide: vi.fn(async () => null),
    syncAlbumRating: vi.fn(async () => ({ userRating: 0 })), getImageUrl: (src: string | null) => src },
}));
vi.mock('../services/player', () => ({
  usePlayer: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  player: {
    currentTime: () => 8, seek: vi.fn(), toggle: vi.fn(), setRate: vi.fn(), getState: () => mocks.state,
    moveTrack: vi.fn(() => true), removeTrack: vi.fn(() => true), enqueue: vi.fn(() => true),
  },
  localOutputName: () => 'iPhone',
  streamUrl: (id: string) => `/api/music/navidrome/stream/${id}`,
}));
vi.mock('./shared/Toast', async original => ({ ...(await original<object>()), default: vi.fn(), toast: vi.fn() }));

Element.prototype.scrollTo = (() => undefined) as unknown as Element['scrollTo'];

const tracks = [
  { songId: 's1', title: 'Airbag', disc: 1, no: 1, durationSec: 284 },
  { songId: 's2', title: 'Paranoid Android', disc: 1, no: 2, durationSec: 383 },
  { songId: 's3', title: 'Subterranean Homesick Alien', disc: 1, no: 3, durationSec: 267 },
  { songId: 's4', title: 'Exit Music', disc: 1, no: 4, durationSec: 264 },
];

const phone = (changes: Record<string, unknown> = {}) => (
  <PhonePlayer title="Airbag" subtitle="Radiohead · OK Computer" cover={{ src: null, title: 'OK Computer' }} playing position={8} length={284}
    hasNext controls={{ toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), playTrack: vi.fn() }} from="OK Computer" out={false}
    tracks={tracks} index={0} {...changes} />
);

const toTracks = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Full screen player' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tracks' }));
};

/** A finger slid to the right on a line, past its threshold: its menu opens. */
const slideRight = (line: Element) => {
  const row = line.closest('.swipe-row')!;
  const touch = (type: string, x: number) => fireEvent[type as 'touchStart'](row, { touches: [{ clientX: x, clientY: 100 }] });
  touch('touchStart', 10);
  touch('touchMove', 30);
  touch('touchMove', 160);
  fireEvent.touchEnd(row, { touches: [] });
};

/** A finger's touch on a menu's entry: the line it opened from no longer takes it for the end of its slide. */
const tap = (target: Element) => {
  fireEvent.touchStart(target, { touches: [{ clientX: 0, clientY: 0 }] });
  fireEvent.touchEnd(target, { touches: [] });
  fireEvent.click(target);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { playing: true, output: { kind: 'local' }, index: 0, tracks, album: { id: 7, title: 'OK Computer' } };
});

afterEach(() => vi.useRealTimers());

describe('PhonePlayer, the tracks to come of what plays', () => {
  it('puts a track next, last, or out from its menu, the track playing offering none of it', () => {
    render(phone({ queue: playingQueue(0) }));
    toTracks();
    slideRight(screen.getByRole('button', { name: /Subterranean Homesick Alien/ }));
    tap(screen.getByRole('menuitem', { name: 'Play next' }));
    expect(player.moveTrack).toHaveBeenCalledWith(2, 1);

    slideRight(screen.getByRole('button', { name: /Paranoid Android/ }));
    // Next already: Play next does nothing.
    expect(screen.getByRole('menuitem', { name: 'Play next' })).toBeDisabled();
    tap(screen.getByRole('menuitem', { name: 'Take out' }));
    expect(player.removeTrack).toHaveBeenCalledWith(1);

    slideRight(screen.getByRole('button', { name: /Airbag/ }));
    expect(screen.queryByRole('menuitem', { name: 'Play next' })).not.toBeInTheDocument();
  });

  it('lifts a track to come held half a second, and moves it where it is let go; the one playing does not lift', () => {
    vi.useFakeTimers();
    render(phone({ queue: playingQueue(0) }));
    toTracks();
    const units = [...document.querySelectorAll<HTMLElement>('[data-unit]')];
    // The tracks to come alone, numbered from the first of them.
    expect(units.map(unit => unit.dataset.unit)).toEqual(['0', '1', '2']);
    units.forEach((unit, at) => { unit.getBoundingClientRect = () => ({ top: 100 + at * 40, height: 40, bottom: 140 + at * 40 } as DOMRect); });
    const list = document.querySelector('.now-playing-tracks')!;
    const pointer = (type: string, target: Element, y: number) =>
      fireEvent(target, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType: 'mouse', clientX: 50, clientY: y }));

    // Exit Music (the last) held, drawn over Paranoid Android: it goes next.
    pointer('pointerdown', units[2], 190);
    act(() => { vi.advanceTimersByTime(500); });
    expect(units[2]).toHaveClass('now-playing-unit--lifted');
    pointer('pointermove', list, 105);
    pointer('pointerup', list, 105);
    expect(player.moveTrack).toHaveBeenCalledWith(3, 1);

    // Paranoid Android drawn past the last: it goes last.
    pointer('pointerdown', units[0], 110);
    act(() => { vi.advanceTimersByTime(500); });
    pointer('pointermove', list, 400);
    pointer('pointerup', list, 400);
    expect(player.moveTrack).toHaveBeenLastCalledWith(1, 3);
  });

  it('numbers a play put in another order by its places, under no disc head, a track of another album with its artist', () => {
    const moved = [
      { ...tracks[0], disc: 1 }, { songId: 'b1', title: 'Love Me Do', disc: 1, no: 1, durationSec: 144, queued: true, artist: 'The Beatles' },
      { ...tracks[2], disc: 2, no: 1 }, { ...tracks[1], disc: 1 },
    ];
    render(phone({ tracks: moved, queue: playingQueue(0) }));
    toTracks();
    expect(document.querySelector('.now-playing-tracks')).not.toHaveTextContent('Disc 2');
    expect(screen.getByRole('button', { name: /^2\s*Love Me Do · The Beatles/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^4\s*Paranoid Android/ })).toBeInTheDocument();
  });

  it('puts a track of an album at rest next or last in what plays', () => {
    const album = { id: 8, title: 'Kid A', artist: 'Radiohead', cover: null };
    render(phone({ index: -1, queue: restQueue(tracks, album) }));
    toTracks();
    slideRight(screen.getByRole('button', { name: /Exit Music/ }));
    tap(screen.getByRole('menuitem', { name: 'Play last' }));
    expect(player.enqueue).toHaveBeenCalledWith([tracks[3]], 'last', album);
  });
});
