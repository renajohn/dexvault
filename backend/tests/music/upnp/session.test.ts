import { OutputTakenError, OutputUnreachableError, type OutputState } from '../../../src/services/upnp/session';
import { albumOf, rig, tracksOf, urlOf, MEDIA_BASE, TOKEN, type Rig } from './helpers';

let r: Rig;
afterEach(async () => { await r?.close(); });

const stateOf = (rig: Rig): OutputState => rig.session.state();

describe('an album played on an appliance that follows on (the Onkyo)', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('gives the first track, plays it, then gives the second as the next one', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.session.idle();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'SetNextAVTransportURI']);
    expect(r.fake.of('SetAVTransportURI')[0].args.CurrentURI).toBe(urlOf('a7t1'));
    expect(r.fake.of('SetNextAVTransportURI')[0].args.NextURI).toBe(urlOf('a7t2'));
    // The track named, its cover by the media listener, never Navidrome.
    const didl = r.fake.of('SetAVTransportURI')[0].args.CurrentURIMetaData;
    expect(didl).toContain('<dc:title>Track 1</dc:title>');
    expect(didl).toContain(`${MEDIA_BASE}/upnp/cover/${TOKEN}/7.jpg`);
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0, count: 3, queue: null, track: { title: 'Track 1', no: 1 } });
    expect(r.scrobbles).toEqual([['a7t1', false]]);
  });

  it('goes on to the next track by itself, then gives the third; scrobbles each once, counted at half', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(99);
    expect(r.scrobbles).toEqual([['a7t1', false]]);
    await r.playFor(2);
    expect(r.scrobbles).toEqual([['a7t1', false], ['a7t1', true]]);

    r.fake.calls = [];
    await r.playFor(100);
    expect(stateOf(r)).toMatchObject({ index: 1, status: 'playing', track: { title: 'Track 2' } });
    // No new SetAVTransportURI: the appliance went on by itself, with no gap.
    expect(r.fake.commands()).toEqual(['SetNextAVTransportURI']);
    expect(r.fake.of('SetNextAVTransportURI')[0].args.NextURI).toBe(urlOf('a7t3'));
    expect(r.scrobbles).toEqual([['a7t1', false], ['a7t1', true], ['a7t2', false]]);

    await r.playFor(150);
    expect(r.scrobbles.filter(([id, counted]) => id === 'a7t2' && counted)).toHaveLength(1);
  });

  it('counts a long track at four minutes, not at its half', async () => {
    const tracks = tracksOf(8, 1, 600);
    r.fake.durations.set(urlOf('a8t1'), 600);
    await r.session.playAlbum(albumOf(8), tracks, 0);
    await r.playFor(239, 10);
    expect(r.scrobbles).toEqual([['a8t1', false]]);
    await r.playFor(10, 10);
    expect(r.scrobbles).toEqual([['a8t1', false], ['a8t1', true]]);
    await r.playFor(100, 10);
    expect(r.scrobbles).toHaveLength(2);
  });

  it('stops on the album’s first track, paused, once its last is over', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7, 2), 0);
    await r.playFor(400);
    await r.playFor(2);
    expect(stateOf(r)).toMatchObject({ status: 'paused', index: 0, position: 0 });
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(r.fake.state).toBe('STOPPED');
  });

  it('pauses, plays on, seeks, goes back to the start of the track, and to the one before in its first seconds', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 1);
    await r.playFor(10);
    await r.session.toggle();
    expect(r.fake.state).toBe('PAUSED_PLAYBACK');
    expect(stateOf(r).status).toBe('paused');
    await r.session.toggle();
    expect(r.fake.state).toBe('PLAYING');

    await r.session.seek(120);
    expect(r.fake.of('Seek').pop()!.args).toMatchObject({ Unit: 'REL_TIME', Target: '0:02:00' });
    await r.session.previous();
    expect(r.fake.of('Seek').pop()!.args.Target).toBe('0:00:00');
    expect(stateOf(r).index).toBe(1);

    await r.playFor(1);
    await r.session.previous();
    expect(stateOf(r).index).toBe(0);
    expect(r.fake.uri).toBe(urlOf('a7t1'));

    await r.session.next();
    await r.session.playTrack(2);
    expect(r.fake.uri).toBe(urlOf('a7t3'));
    expect(stateOf(r)).toMatchObject({ index: 2, track: { title: 'Track 3' } });
  });

  it('starts where a play is carried over, after the appliance plays', async () => {
    r.fake.slowStart = true;
    await r.session.playAlbum(albumOf(7), tracksOf(7), 1, 75);
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
    expect(r.fake.position).toBe(75);
    expect(stateOf(r)).toMatchObject({ index: 1, position: 75, status: 'playing' });
  });

  it('asks Play again while the appliance is still between two tracks, a CD changed', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(30);
    r.fake.settling = 3;
    r.fake.calls = [];
    await r.session.playAlbum(albumOf(8), tracksOf(8), 0);
    await r.session.idle();
    expect(r.fake.commands()).toEqual(['Stop', 'SetAVTransportURI', 'Play', 'Play', 'Play', 'SetNextAVTransportURI']);
    expect(r.fake.state).toBe('PLAYING');
    expect(r.fake.uri).toBe(urlOf('a8t1'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', album: { id: 8 }, index: 0, error: null });
  });

  it('says so when the appliance still refuses Play after three seconds', async () => {
    r.fake.settling = 100;
    await expect(r.session.playAlbum(albumOf(7), tracksOf(7), 0)).rejects.toThrow('Play refused (701)');
    expect(r.fake.commands().filter(action => action === 'Play')).toHaveLength(10);
  });

  it('plays only the last of tracks clicked one after the other quickly, the one under way given up', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7, 5), 0);
    await r.playFor(30);
    r.fake.settling = 3;
    r.fake.calls = [];
    const first = r.session.playTrack(1);
    while (r.fake.of('SetAVTransportURI').length === 0) await new Promise(resolve => setImmediate(resolve));
    await Promise.all([first, ...[2, 3, 4].map(index => r.session.playTrack(index))]);
    await r.session.idle();
    // Track 2 was given, then given up between two Plays refused; 3 and 4, still waiting their turn, never given.
    expect(r.fake.of('SetAVTransportURI').map(call => call.args.CurrentURI)).toEqual([urlOf('a7t2'), urlOf('a7t5')]);
    expect(r.fake.uri).toBe(urlOf('a7t5'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 4, error: null });
    expect(r.scrobbles.map(([id]) => id)).toEqual(['a7t1', 'a7t5']);
  });

  it('goes on from the track a click chose for ⏭ pressed right after it, and twice for ⏭ pressed twice', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7, 6), 0);
    await r.playFor(30);
    r.fake.settling = 3;
    await Promise.all([r.session.playTrack(2), r.session.next()]);
    await r.session.idle();
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 3 });
    r.fake.settling = 3;
    await Promise.all([r.session.next(), r.session.next()]);
    await r.session.idle();
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 5 });
    expect(r.fake.uri).toBe(urlOf('a7t6'));
  });

  it('plays nothing more once ✕ is pressed after a click', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7, 5), 0);
    await r.playFor(30);
    r.fake.calls = [];
    await Promise.all([r.session.playTrack(3), r.session.stop()]);
    await r.session.idle();
    expect(r.fake.of('SetAVTransportURI')).toHaveLength(0);
    expect(stateOf(r).status).toBe('stopped');
  });

  it('never sets the volume above the ceiling', async () => {
    await r.session.setVolume({ volume: 95 });
    expect(r.fake.volume).toBe(70);
    await r.session.setVolume({ volume: -4 });
    expect(r.fake.volume).toBe(0);
    await r.session.setVolume({ volume: 31.6, muted: true });
    expect(r.fake.of('SetVolume').map(call => call.args.DesiredVolume)).toEqual(['70', '0', '32']);
    expect(r.fake.muted).toBe(true);
    expect(stateOf(r)).toMatchObject({ volume: 32, muted: true });
  });
});

describe('an appliance that does not follow on (the Panasonic)', () => {
  beforeEach(async () => { r = await rig('panasonic'); });

  it('gives the next track once the one playing stops at its end', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    expect(r.renderer.gapless).toBe(false);
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play']);
    r.fake.calls = [];
    await r.playFor(201);
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play']);
    expect(r.fake.uri).toBe(urlOf('a7t2'));
    expect(stateOf(r)).toMatchObject({ index: 1, status: 'playing' });
    expect(r.scrobbles).toEqual([['a7t1', false], ['a7t1', true], ['a7t2', false]]);
  });

  it('takes a stop by the appliance’s own remote mid-track for a pause', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(30);
    r.fake.state = 'STOPPED';
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ index: 0, status: 'paused' });
  });
});

describe('an appliance taken by something else, or away', () => {
  beforeEach(async () => { r = await rig('wiim'); });

  it('lets go when it plays someone else’s, read twice: no command, no scrobble, the place kept; Resume plays on there', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 1);
    await r.playFor(42);
    r.fake.takeOver();
    await r.playFor(1);
    // Once may be a step between two tracks: still ours.
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 1 });
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'taken', index: 1, position: 42 });

    r.fake.calls = [];
    const scrobbled = r.scrobbles.length;
    await r.playFor(300);
    expect(r.fake.calls).toEqual([]);
    expect(r.scrobbles).toHaveLength(scrobbled);
    await expect(r.session.toggle()).rejects.toBeInstanceOf(OutputTakenError);
    await expect(r.session.next()).rejects.toBeInstanceOf(OutputTakenError);
    await expect(r.session.setVolume({ volume: 10 })).rejects.toBeInstanceOf(OutputTakenError);
    expect(r.fake.calls).toEqual([]);

    await r.session.resume();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
    expect(r.fake.uri).toBe(urlOf('a7t2'));
    expect(r.fake.of('Seek')[0].args.Target).toBe('0:00:42');
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 1, position: 42 });
  });

  it('lets go when the appliance has no media any more, read twice', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.playFor(2);
    expect(stateOf(r).status).toBe('taken');
  });

  it('plays on when the appliance says nothing for one reading between two tracks', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    const [uri, state] = [r.fake.uri, r.fake.state];
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.playFor(1);
    r.fake.uri = uri;
    r.fake.state = state;
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0 });
    r.fake.takeOver();
    await r.playFor(1);
    r.fake.uri = uri;
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0 });
  });

  it('lets go of a track given by another DexVault, never of one of ours left over', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    // Another DexVault (one in development) plays there: someone else's.
    r.fake.takeOver(urlOf('a9t1').replace(MEDIA_BASE, 'http://192.168.86.51:3002'));
    await r.playFor(2);
    expect(stateOf(r).status).toBe('taken');
  });

  it('is away after three calls unanswered, asked every 5 s, and plays on by itself when back within minutes, its memory wiped', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.down = true;
    await r.playFor(2);
    expect(stateOf(r).status).toBe('playing');
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', position: 10 });
    expect(r.session.pollDelay()).toBe(5000);
    await r.session.tick();
    expect(r.session.pollDelay()).toBe(5000);

    // Switched off and on: it has forgotten our track. Ours is given again, from where it was.
    r.fake.down = false;
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(r.fake.of('Seek')[0].args.Target).toBe('0:00:10');
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0, position: 10 });
  });

  it('takes the appliance back when it comes back holding an earlier track of ours, stopped (the Onkyo as it wakes)', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 2);
    await r.playFor(10);
    r.fake.down = true;
    await r.playFor(3);
    expect(stateOf(r).status).toBe('unreachable');
    // Asked another album while away: kept for when it answers.
    await expect(r.session.playAlbum(albumOf(8), tracksOf(8), 0)).rejects.toBeInstanceOf(OutputUnreachableError);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', index: 0, album: { id: 8 } });
    expect(r.session.pollDelay()).toBe(5000);

    r.fake.down = false;
    r.fake.uri = urlOf('a7t3');
    r.fake.state = 'STOPPED';
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'SetNextAVTransportURI']);
    expect(r.fake.uri).toBe(urlOf('a8t1'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0, album: { id: 8 } });
  });

  it('is taken when back playing someone else’s', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.down = true;
    await r.playFor(3);
    r.fake.down = false;
    r.fake.takeOver();
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ status: 'taken', position: 10 });
    expect(r.session.pollDelay()).toBeNull();
  });

  it('waits for ▶, paused where it was, when back after more than five minutes', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.down = true;
    await r.playFor(3);
    expect(stateOf(r).status).toBe('unreachable');
    await r.session.tick();
    await r.session.tick();
    await r.session.tick();
    expect(r.session.pollDelay()).toBe(5000);
    r.fake.advance(6 * 60);
    expect(r.session.pollDelay()).toBe(60000);
    r.fake.down = false;
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    r.fake.calls = [];
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ status: 'paused', index: 0, position: 10 });
    expect(r.fake.commands()).toEqual([]);
    expect(r.session.pollDelay()).toBeNull();
    await r.session.toggle();
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(stateOf(r).status).toBe('playing');
  });

  it('gives a play asked of it while off as soon as it answers', async () => {
    r.fake.down = true;
    await expect(r.session.playAlbum(albumOf(7), tracksOf(7), 1)).rejects.toBeInstanceOf(OutputUnreachableError);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', index: 1, album: { id: 7 } });
    expect(r.session.pollDelay()).toBe(5000);
    await r.session.tick();
    expect(stateOf(r).status).toBe('unreachable');
    r.fake.down = false;
    await r.session.tick();
    expect(r.fake.uri).toBe(urlOf('a7t2'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 1 });
    await r.playFor(5);
    expect(stateOf(r)).toMatchObject({ status: 'playing', position: 5 });
  });

  it('follows on again when back still playing our track (a blip in the network)', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    r.fake.down = true;
    await r.playFor(3);
    expect(stateOf(r).status).toBe('unreachable');
    r.fake.down = false;
    await r.playFor(1);
    expect(stateOf(r).status).toBe('playing');
  });
});

describe('a restart of DexVault', () => {
  it('follows the appliance on if it still plays our track', async () => {
    const first = await rig('onkyo');
    await first.session.playAlbum(albumOf(7), tracksOf(7), 1);
    await first.playFor(30);
    const saved = first.session.saved();
    expect(saved).toMatchObject({ index: 1, position: 30, token: TOKEN, status: 'playing' });

    r = await rig('onkyo', { saved });
    r.fake.uri = first.fake.uri;
    r.fake.position = 31;
    r.fake.state = 'PLAYING';
    await first.close();
    expect(stateOf(r)).toMatchObject({ status: 'paused', index: 1 });
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 1, position: 31 });
  });

  it('stays paused where it was if the appliance plays nothing of ours', async () => {
    const saved = { album: albumOf(7), tracks: tracksOf(7), index: 2, position: 50, duration: 200, status: 'playing' as const, queue: null, token: TOKEN, turn: null };
    r = await rig('onkyo', { saved });
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ status: 'paused', index: 2, position: 50 });
    expect(r.fake.commands()).toEqual([]);
    await r.session.toggle();
    expect(r.fake.uri).toBe(urlOf('a7t3'));
    expect(r.fake.position).toBe(50);
  });
});
