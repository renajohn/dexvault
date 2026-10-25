import { OutputTakenError, type OutputState } from '../../../src/services/upnp/session';
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

  it('lets go when it plays someone else’s: no command, no scrobble, the place kept; Resume plays on there', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 1);
    await r.playFor(42);
    r.fake.takeOver();
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

  it('lets go when the appliance has no media any more', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.playFor(1);
    expect(stateOf(r).status).toBe('taken');
  });

  it('is away after three calls unanswered, asked ever less often, and taken when back without our track', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.down = true;
    await r.playFor(2);
    expect(stateOf(r).status).toBe('playing');
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', position: 10 });
    expect(r.session.pollDelay()).toBe(5000);
    await r.session.tick();
    expect(r.session.pollDelay()).toBe(15000);
    await r.session.tick();
    expect(r.session.pollDelay()).toBe(60000);

    // Switched off and on: it has forgotten our track.
    r.fake.down = false;
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ status: 'taken', position: 10 });
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
