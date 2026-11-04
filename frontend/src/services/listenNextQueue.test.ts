import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlbumEnd, PlayOptions } from './player';

/** The list: an album whole by its id, one disc of it as "id:disc". */
const list = vi.hoisted(() => ({ ids: [] as Array<number | string>, ripped: new Set<number>() }));
const plays = vi.hoisted(() => [] as Array<{ id: number; disc: number; options: PlayOptions; index: number }>);
const entryOf = vi.hoisted(() => (one: number | string) => {
  const [id, disc = '0'] = String(one).split(':');
  return { id: Number(id), disc: Number(disc) || null };
});

vi.mock('./musicService', () => ({
  default: {
    getListenNextAlbums: vi.fn(async () => list.ids.map(entryOf)),
    // ⏭ to the end: out of the list, as the server does.
    markListenNextPlayed: vi.fn(async (id: number, disc = 0) => {
      list.ids = list.ids.filter(one => !(entryOf(one).id === id && (entryOf(one).disc || 0) === disc));
      return { left: { albumId: id, disc } };
    }),
  },
}));
const ripOrder = vi.hoisted(() => ({ songIds: ['s1', 's2', 's3'] }));
vi.mock('../utils/playAlbum', () => ({
  // The album as it comes again, in its own order: where the way back of a detour finds the track it left.
  loadPlayable: vi.fn(async (id: number) => ({ album: { id, title: `Album ${id}`, artist: '', cover: null },
    tracks: ripOrder.songIds.map((songId, at) => ({ songId, title: songId, disc: 1, no: at + 1, durationSec: 200 })) })),
  playAlbumById: vi.fn(async (id: number, options: PlayOptions, index = 0, _shuffle = false, disc = 0) => {
    if (!list.ripped.has(id)) return false;
    plays.push({ id, disc, options, index });
    return true;
  }),
}));

import { albumsAfter, listenNextQueue, resetListenNextQueue, sessionAlbums, withCurrent } from './listenNextQueue';
import { player, resetPlayer, restorePlayer } from './player';

const playing = () => plays[plays.length - 1];
/** The album playing ends as `how` says; true when another one starts. */
const end = (how: Parameters<AlbumEnd>[0]) => playing().options.onAlbumEnd!(how);

beforeEach(() => {
  // A storage of its own for each test: the play's session and the player's resume.
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  resetListenNextQueue();
  plays.length = 0;
  list.ids = [1, 2, 3];
  list.ripped = new Set([1, 2, 3]);
});

describe('the turn of Listen Next', () => {
  it('goes on after the album playing, from the top after the last; with Repeat, itself last', () => {
    expect(albumsAfter([1, 2, 3, 4], 2, false)).toEqual([3, 4, 1]);
    expect(albumsAfter([1, 2, 3], 2, true)).toEqual([3, 1, 2]);
    expect(albumsAfter([1, 2], null, false)).toEqual([1, 2]);
  });

  it('keeps an album that left the list at its place, after the one before it still there', () => {
    expect(withCurrent([1, 3, 4], [1, 2, 3, 4], 2)).toEqual([1, 2, 3, 4]);
    expect(withCurrent([3, 4], [1, 2, 3, 4], 2)).toEqual([2, 3, 4]);
    expect(withCurrent([1, 2], [1, 2], 2)).toEqual([1, 2]);
  });
});

describe('listenNextQueue', () => {
  it('plays from the top, skipping an album with no rip, and plays the next one when an album ends', async () => {
    list.ripped.delete(1);
    expect(await listenNextQueue.start()).toBe(true);
    expect(playing().id).toBe(2);
    expect(playing().options.queue).toBe('listenNext');

    list.ids = [1, 3];
    expect(await end('ended')).toBe(true);
    expect(playing().id).toBe(3);
  });

  it('starts from the album asked for, and puts the ones before it at the end of the turn', async () => {
    await listenNextQueue.start('2:0');
    expect(playing().id).toBe(2);
    list.ids = [1, 3];
    await end('ended');
    expect(playing().id).toBe(3);
    list.ids = [1];
    await end('ended');
    expect(playing().id).toBe(1);
  });

  it('plays an album added before the one playing at the end of the turn', async () => {
    await listenNextQueue.start('2:0');
    list.ids = [9, 2, 3];
    list.ripped.add(9);
    await end('skipped');
    expect(playing().id).toBe(3);
    await end('skipped');
    expect(playing().id).toBe(9);
  });

  it('takes an album skipped to its end out of the list, as one played, and stops when the turn comes back to it', async () => {
    await listenNextQueue.start();
    expect(await end('skipped')).toBe(true);
    expect(playing().id).toBe(2);
    expect(list.ids).toEqual([2, 3]);
    expect(listenNextQueue.session().heard).toEqual(['1:0']);
    // Put back by hand meanwhile: played in this play, the turn stops there.
    list.ids = [1];
    expect(await end('ended')).toBe(false);
  });

  it('keeps an album skipped to its end in the list with Repeat on', async () => {
    listenNextQueue.setRepeat(true);
    await listenNextQueue.start();
    await end('skipped');
    expect(playing().id).toBe(2);
    expect(list.ids).toEqual([1, 2, 3]);
  });

  it('tells the albums still to come in the turn, for the bar\'s time left', async () => {
    await listenNextQueue.start('2:0');
    expect(listenNextQueue.upcoming()).toEqual(['3:0', '1:0']);
    list.ids = [1, 3];
    await end('ended');
    // 2 played: the turn stops before it.
    expect(listenNextQueue.upcoming()).toEqual(['1:0']);
  });

  it('goes round for ever with Repeat on', async () => {
    listenNextQueue.setRepeat(true);
    list.ids = [1];
    await listenNextQueue.start();
    expect(await end('ended')).toBe(true);
    expect(plays.map(play => play.id)).toEqual([1, 1]);
  });

  it('leaves an album taken out by hand once its track ends, not one that left once played', async () => {
    await listenNextQueue.start();
    const { leaveAfterTrack } = playing().options;
    expect(leaveAfterTrack!()).toBe(false);
    const { player } = await import('./player');
    const getState = vi.spyOn(player, 'getState').mockReturnValue({ ...player.getState(), queue: 'listenNext' });

    listenNextQueue.noteList(['2:0', '3:0']);
    expect(leaveAfterTrack!()).toBe(true);

    window.dispatchEvent(new CustomEvent('dexvault:listen-next-left', { detail: { albumId: 1 } }));
    expect(leaveAfterTrack!()).toBe(false);
    getState.mockRestore();
  });

  it('plays two discs of an album as two turns, each alone, and takes out the one skipped to its end', async () => {
    list.ids = [1, '2:3', '2:1', 3];
    await listenNextQueue.start('2:3');
    expect(playing()).toMatchObject({ id: 2, disc: 3 });
    expect(listenNextQueue.upcoming()).toEqual(['2:1', '3:0', '1:0']);

    expect(await end('skipped')).toBe(true);
    expect(playing()).toMatchObject({ id: 2, disc: 1 });
    expect(list.ids).toEqual([1, '2:1', 3]);
    expect(listenNextQueue.session().albums).toEqual(['2:3', '2:1']);
  });
});

describe('Listen Next after a reload', () => {
  let made: HTMLAudioElement[] = [];

  beforeEach(() => {
    made = [];
    const RealAudio = window.Audio;
    vi.stubGlobal('Audio', function Audio() { const element = new RealAudio(); made.push(element); return element; });
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    resetPlayer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('goes on with the next album once the album taken up again is over', async () => {
    window.localStorage.setItem('dexvault.player.resume', JSON.stringify({
      album: { id: 1, title: 'One', artist: 'A', cover: null },
      tracks: [{ songId: 's1', title: 't', disc: 1, no: 1, durationSec: 100 }],
      index: 0, position: 30, barOpen: true, queue: 'listenNext',
    }));

    restorePlayer();
    expect(player.getState()).toMatchObject({ queue: 'listenNext', playing: false, barShown: true });

    // Played on to its end: Listen Next takes over, as before the reload.
    player.toggle(true);
    made.find(audio => audio.src.endsWith('/stream/s1'))!.dispatchEvent(new Event('ended'));

    await vi.waitFor(() => expect(plays.map(play => play.id)).toEqual([2]));
  });

  it('takes up a disc again where a reload left it', async () => {
    list.ids = [1, '2:2', 3];
    window.localStorage.setItem('dexvault.player.resume', JSON.stringify({
      album: { id: 2, disc: 2, title: 'Two', artist: 'A', cover: null },
      tracks: [{ songId: 's1', title: 't', disc: 2, no: 1, durationSec: 100 }],
      index: 0, position: 30, barOpen: true, queue: 'listenNext',
    }));

    restorePlayer();
    player.toggle(true);
    made.find(audio => audio.src.endsWith('/stream/s1'))!.dispatchEvent(new Event('ended'));

    await vi.waitFor(() => expect(plays.map(play => play.id)).toEqual([3]));
  });
});

describe('the tracks dialog of Listen Next', () => {
  const session = { startedAt: 1, albums: ['1:0', '2:0', '3:0'], heard: ['1:0'], detour: null };

  it('shows the albums of the play out of the list that were heard, or play, then the list', () => {
    // 1 heard then out, 2 taken out unheard, 3 still listed.
    expect(sessionAlbums(session, ['3:0', '4:0'], null)).toEqual({ gone: ['1:0'], listed: ['3:0', '4:0'] });
    expect(sessionAlbums(session, ['3:0', '4:0'], '2:0')).toEqual({ gone: ['1:0', '2:0'], listed: ['3:0', '4:0'] });
  });

  it('reads a session kept before the discs, its albums each whole', () => {
    window.localStorage.setItem('dexvault.listenNext.session', JSON.stringify({
      startedAt: 1, albums: [1, 2], heard: [1], detour: { albumId: 2, back: { albumId: 1, index: 3 } },
    }));
    expect(listenNextQueue.session()).toEqual({
      startedAt: 1, albums: ['1:0', '2:0'], heard: ['1:0'], detour: { key: '2:0', back: { key: '1:0', index: 3 } },
    });
  });

  it('notes the albums played and those a track of which counted', async () => {
    await listenNextQueue.start();
    playing().options.onCounted!();
    list.ids = [2, 3];
    await end('ended');
    expect(listenNextQueue.session()).toMatchObject({ albums: ['1:0', '2:0'], heard: ['1:0'] });
    expect((await listenNextQueue.albums())).toEqual({ gone: ['1:0'], listed: ['2:0', '3:0'] });
  });

  it('jumps to a track of another album of the list, the one left coming round in the turn', async () => {
    await listenNextQueue.start();
    expect(await listenNextQueue.jumpTo('3:0', 4)).toBe(true);
    expect(playing()).toMatchObject({ id: 3, index: 4 });
    expect(await end('ended')).toBe(true);
    expect(playing()).toMatchObject({ id: 1, index: 0 });
  });

  it('jumps within the album playing without leaving it', async () => {
    await listenNextQueue.start();
    const playTrack = vi.spyOn(player, 'playTrack').mockImplementation(() => undefined);
    expect(await listenNextQueue.jumpTo('1:0', 3)).toBe(true);
    expect(playTrack).toHaveBeenCalledWith(3);
    expect(plays).toHaveLength(1);
    playTrack.mockRestore();
  });

  it('takes a detour into an album out of the list, then goes back to the track left', async () => {
    await listenNextQueue.start('2:0');
    playing().options.onCounted!();
    list.ids = [1, 3];
    await end('ended');
    expect(playing().id).toBe(3);

    expect(await listenNextQueue.jumpTo('2:0', 5)).toBe(true);
    expect(playing()).toMatchObject({ id: 2, index: 5 });
    expect(listenNextQueue.session().detour).toEqual({ key: '2:0', back: { key: '3:0', index: 0, songId: 's1' } });
    expect(list.ids).toEqual([1, 3]);

    // Over: back to album 3 where it was left, the detour done with.
    expect(await end('ended')).toBe(true);
    expect(playing()).toMatchObject({ id: 3, index: 0 });
    expect(listenNextQueue.session().detour).toBeNull();
  });

  it('goes back to the track left in the album as it comes again, its tracks moved by hand meanwhile', async () => {
    await listenNextQueue.start('2:0');
    list.ids = [1, 3];
    await end('ended');
    expect(await listenNextQueue.jumpTo('2:0', 5)).toBe(true);
    // The track left, s1, is the third of album 3 as it comes again.
    ripOrder.songIds = ['s3', 's2', 's1'];
    await end('ended');
    expect(playing()).toMatchObject({ id: 3, index: 2 });
    ripOrder.songIds = ['s1', 's2', 's3'];
  });

  it('keeps the way back of the first detour through a second one', async () => {
    list.ids = [3];
    await listenNextQueue.start();
    window.localStorage.setItem('dexvault.listenNext.session', JSON.stringify({
      startedAt: 1, albums: ['1:0', '2:0', '3:0'], heard: ['1:0', '2:0'], detour: null,
    }));
    await listenNextQueue.jumpTo('1:0', 2);
    await listenNextQueue.jumpTo('2:0', 0);
    expect(listenNextQueue.session().detour).toEqual({ key: '2:0', back: { key: '3:0', index: 0, songId: 's1' } });
    await end('ended');
    expect(playing().id).toBe(3);
  });
});
