import { ListenNextTurn, albumsAfter, withCurrent, type EntryKey, type TurnDeps } from '../../../src/services/upnp/turn';
import type { Playable } from '../../../src/services/playable';
import { albumOf, rig, tracksOf, urlOf, type Rig } from './helpers';

/**
 * The cases of frontend/src/services/listenNextQueue.test.ts, carried over
 * as they are: the server's turn must go on as the page's did.
 */

/** The list: an album whole by its id, one disc of it as "id:disc". */
const list = { ids: [] as Array<number | string>, ripped: new Set<number>(), repeat: false };
const plays: Array<{ id: number; disc: number; index: number }> = [];

const keyOf = (one: number | string): EntryKey => {
  const [id, disc = '0'] = String(one).split(':');
  return `${Number(id)}:${Number(disc) || 0}`;
};

const deps: TurnDeps = {
  listIds: async () => list.ids.map(keyOf),
  // ⏭ to the end: out of the list, as the server does.
  markPlayed: async key => {
    const [id, disc] = key.split(':').map(Number);
    list.ids = list.ids.filter(one => keyOf(one) !== key);
    return { id: 1, albumId: id, disc, collectionOrder: null, leftAt: 0, suggested: false };
  },
  repeat: async () => list.repeat,
};

const play = async (key: EntryKey, index: number): Promise<boolean> => {
  const [id, disc] = key.split(':').map(Number);
  if (!list.ripped.has(id)) return false;
  plays.push({ id, disc, index });
  return true;
};

let turn: ListenNextTurn;
const playing = () => plays[plays.length - 1];
/** The album playing ends as `how` says; true when another one starts. */
const end = (how: 'ended' | 'skipped' | 'removed') => turn.albumEnded(play, how);

beforeEach(() => {
  turn = new ListenNextTurn(deps);
  plays.length = 0;
  list.ids = [1, 2, 3];
  list.ripped = new Set([1, 2, 3]);
  list.repeat = false;
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

describe('Listen Next on the server', () => {
  it('plays from the top, skipping an album with no rip, and plays the next one when an album ends', async () => {
    list.ripped.delete(1);
    expect(await turn.start(play)).toBe(true);
    expect(playing().id).toBe(2);

    list.ids = [1, 3];
    expect(await end('ended')).toBe(true);
    expect(playing().id).toBe(3);
  });

  it('starts from the album asked for, and puts the ones before it at the end of the turn', async () => {
    await turn.start(play, '2:0');
    expect(playing().id).toBe(2);
    list.ids = [1, 3];
    await end('ended');
    expect(playing().id).toBe(3);
    list.ids = [1];
    await end('ended');
    expect(playing().id).toBe(1);
  });

  it('plays an album added before the one playing at the end of the turn', async () => {
    await turn.start(play, '2:0');
    list.ids = [9, 2, 3];
    list.ripped.add(9);
    await end('skipped');
    expect(playing().id).toBe(3);
    await end('skipped');
    expect(playing().id).toBe(9);
  });

  it('takes an album skipped to its end out of the list, as one played, and stops when the turn comes back to it', async () => {
    await turn.start(play);
    expect(await end('skipped')).toBe(true);
    expect(playing().id).toBe(2);
    expect(list.ids).toEqual([2, 3]);
    expect(turn.heard).toEqual(['1:0']);
    // Put back by hand meanwhile: played in this play, the turn stops there.
    list.ids = [1];
    expect(await end('ended')).toBe(false);
  });

  it('keeps an album skipped to its end in the list with Repeat on', async () => {
    list.repeat = true;
    await turn.start(play);
    await end('skipped');
    expect(playing().id).toBe(2);
    expect(list.ids).toEqual([1, 2, 3]);
  });

  it('tells the albums still to come in the turn, for the bar\'s time left', async () => {
    await turn.start(play, '2:0');
    expect(turn.upcoming()).toEqual(['3:0', '1:0']);
    list.ids = [1, 3];
    await end('ended');
    // 2 played: the turn stops before it.
    expect(turn.upcoming()).toEqual(['1:0']);
  });

  it('goes round for ever with Repeat on', async () => {
    list.repeat = true;
    list.ids = [1];
    await turn.start(play);
    expect(await end('ended')).toBe(true);
    expect(plays.map(one => one.id)).toEqual([1, 1]);
  });

  it('leaves an album taken out by hand once its track ends, not one that left once played', async () => {
    await turn.start(play);
    expect(turn.leaveAfterTrack()).toBe(false);

    turn.noteList(['2:0', '3:0']);
    expect(turn.leaveAfterTrack()).toBe(true);

    turn.noteDeparted(1);
    expect(turn.leaveAfterTrack()).toBe(false);
  });

  it('reads the list again to know an album was taken out by hand: no page tells the server', async () => {
    await turn.start(play);
    list.ids = [2, 3];
    expect(await turn.shouldLeave()).toBe(true);
  });

  it('plays two discs of an album as two turns, each alone, and takes out the one skipped to its end', async () => {
    list.ids = [1, '2:3', '2:1', 3];
    await turn.start(play, '2:3');
    expect(playing()).toMatchObject({ id: 2, disc: 3 });
    expect(turn.upcoming()).toEqual(['2:1', '3:0', '1:0']);

    expect(await end('skipped')).toBe(true);
    expect(playing()).toMatchObject({ id: 2, disc: 1 });
    expect(list.ids).toEqual([1, '2:1', 3]);
    expect(turn.albums).toEqual(['2:3', '2:1']);
  });
});

describe('Listen Next carried over (the page’s “after a reload”)', () => {
  it('goes on with the next album once the album taken up is over', async () => {
    turn.pickUp('1:0');
    expect(await end('ended')).toBe(true);
    expect(plays.map(one => one.id)).toEqual([2]);
  });

  it('takes up a disc where it was left', async () => {
    list.ids = [1, '2:2', 3];
    turn.pickUp('2:2');
    expect(await end('ended')).toBe(true);
    expect(plays.map(one => one.id)).toEqual([3]);
  });

  it('survives a restart: the state written down plays on the same', async () => {
    await turn.start(play, '2:0');
    const again = new ListenNextTurn(deps, JSON.parse(JSON.stringify(turn.snapshot())));
    list.ids = [1, 3];
    expect(await again.albumEnded(play, 'ended')).toBe(true);
    expect(playing().id).toBe(3);
  });
});

describe('the albums of the play, and jumps', () => {
  it('notes the albums played and those a track of which counted', async () => {
    await turn.start(play);
    turn.noteCounted();
    list.ids = [2, 3];
    await end('ended');
    expect(turn.albums).toEqual(['1:0', '2:0']);
    expect(turn.heard).toEqual(['1:0']);
  });

  it('jumps to a track of another album of the list, the one left coming round in the turn', async () => {
    await turn.start(play);
    expect(await turn.jumpTo(play, async () => undefined, '3:0', 4, 0)).toBe(true);
    expect(playing()).toMatchObject({ id: 3, index: 4 });
    expect(await end('ended')).toBe(true);
    expect(playing()).toMatchObject({ id: 1, index: 0 });
  });

  it('jumps within the album playing without leaving it', async () => {
    await turn.start(play);
    const playTrack = jest.fn(async () => undefined);
    expect(await turn.jumpTo(play, playTrack, '1:0', 3, 0)).toBe(true);
    expect(playTrack).toHaveBeenCalledWith(3);
    expect(plays).toHaveLength(1);
  });

  it('takes a detour into an album out of the list, then goes back to the track left', async () => {
    await turn.start(play, '2:0');
    turn.noteCounted();
    list.ids = [1, 3];
    await end('ended');
    expect(playing().id).toBe(3);

    expect(await turn.jumpTo(play, async () => undefined, '2:0', 5, 0)).toBe(true);
    expect(playing()).toMatchObject({ id: 2, index: 5 });
    expect(turn.detour).toEqual({ key: '2:0', back: { key: '3:0', index: 0 } });
    expect(list.ids).toEqual([1, 3]);

    // Over: back to album 3 where it was left, the detour done with.
    expect(await end('ended')).toBe(true);
    expect(playing()).toMatchObject({ id: 3, index: 0 });
    expect(turn.detour).toBeNull();
  });

  it('keeps the way back of the first detour through a second one', async () => {
    list.ids = [3];
    await turn.start(play);
    await turn.jumpTo(play, async () => undefined, '1:0', 2, 0);
    await turn.jumpTo(play, async () => undefined, '2:0', 0, 2);
    expect(turn.detour).toEqual({ key: '2:0', back: { key: '3:0', index: 0 } });
    await end('ended');
    expect(playing().id).toBe(3);
  });
});

describe('Listen Next on an appliance', () => {
  let r: Rig;
  afterEach(async () => { await r?.close(); });

  const albums = new Map<number, Playable>([1, 2, 3].map(id => [id, { album: albumOf(id), tracks: tracksOf(id, 2) }]));

  it('plays the next album of the list once the last track of one is over, and tells the pages an album left', async () => {
    list.ids = [1, 2, 3];
    r = await rig('onkyo', { albums, deps: { turnDeps: deps } });
    r.departures.set('a1t2', { id: 5, albumId: 1, disc: 0, collectionOrder: 0, leftAt: 0, suggested: false });
    expect(await r.session.playListenNext()).toBe(true);
    expect(r.session.state()).toMatchObject({ queue: 'listenNext', album: { id: 1 }, upcoming: ['2:0', '3:0'] });

    // The last track counted: album 1 leaves the list (its scrobble), the pages told.
    await r.playFor(301);
    await r.session.idle();
    expect(r.events.filter(([event]) => event === 'left').map(([, payload]) => payload)).toEqual([expect.objectContaining({ albumId: 1, output: r.session.id })]);
    list.ids = [2, 3];

    await r.playFor(100);
    expect(r.session.state()).toMatchObject({ album: { id: 2 }, index: 0, status: 'playing' });
    expect(r.fake.uri).toBe(urlOf('a2t1'));
  });

  it('goes round with Repeat on, and stops at an album played already with it off', async () => {
    list.ids = [1];
    list.repeat = true;
    r = await rig('wiim', { albums, deps: { turnDeps: deps } });
    await r.session.playListenNext();
    await r.playFor(402);
    expect(r.session.state()).toMatchObject({ album: { id: 1 }, status: 'playing', index: 0 });

    list.repeat = false;
    await r.playFor(402);
    expect(r.session.state()).toMatchObject({ album: { id: 1 }, status: 'paused', index: 0 });
  });

  it('skips to the next album with ⏭ on the last track, which leaves the list', async () => {
    list.ids = [1, 2];
    r = await rig('onkyo', { albums, deps: { turnDeps: deps } });
    await r.session.playListenNext();
    await r.session.next();
    await r.session.next();
    expect(r.session.state().album?.id).toBe(2);
    expect(list.ids).toEqual([2]);
    expect(r.events.some(([event, payload]) => event === 'left' && (payload as { albumId: number }).albumId === 1)).toBe(true);
  });

  it('leaves an album taken out by hand at the end of its track', async () => {
    list.ids = [1, 2];
    r = await rig('onkyo', { albums, deps: { turnDeps: deps } });
    await r.session.playListenNext();
    list.ids = [2];
    r.fake.calls = [];
    await r.playFor(201);
    expect(r.session.state()).toMatchObject({ album: { id: 2 }, index: 0 });
  });

  it('jumps within the turn when an album of the list is asked for', async () => {
    list.ids = [1, 2, 3];
    r = await rig('onkyo', { albums, deps: { turnDeps: deps } });
    await r.session.playListenNext();
    expect(await r.session.playListenNext('3:0', 1)).toBe(true);
    expect(r.session.state()).toMatchObject({ album: { id: 3 }, index: 1, queue: 'listenNext' });
  });
});
