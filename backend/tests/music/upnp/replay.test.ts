import { albumOf, rig, tracksOf, urlOf, type Rig } from './helpers';

/**
 * A whole play replayed on each appliance of the house, as recorded: the
 * Onkyo (AVTransport:2, RelTime and AbsTime, h:mm:ss) and the WiiM
 * (AVTransport:1, RelTime alone, AbsTime NOT_IMPLEMENTED, hh:mm:ss, a moment
 * to fetch a file before it plays). Both follow on with no gap; both are
 * sought by REL_TIME only, the one mode they share.
 */

let r: Rig;
afterEach(async () => { await r?.close(); });

describe.each([
  { kind: 'onkyo' as const, volume: 57, restDuration: 246 },
  { kind: 'wiim' as const, volume: 100, restDuration: 0 },
])('a whole play on the $kind', ({ kind, volume, restDuration }) => {
  beforeEach(async () => {
    r = await rig(kind);
    r.fake.slowStart = kind === 'wiim';
  });

  it('plays an album through, with the commands of the bar, as the appliance answers', async () => {
    // At rest, as recorded: no track, whatever duration it keeps.
    expect(await r.renderer.positionInfo()).toEqual({ track: 0, trackUri: '', position: 0, duration: restDuration });
    expect((await r.renderer.transportInfo()).state).toBe('NO_MEDIA_PRESENT');
    await r.session.readVolume();
    expect(r.session.state()).toMatchObject({ volume, muted: false, status: 'stopped' });
    r.fake.calls = [];

    // ▶ an album: the first track given and played, the second given as the next one; its
    // volume read meanwhile, in turn (each call answered a little later: two at once would show).
    r.fake.latencyMs = 5;
    await Promise.all([r.session.playAlbum(albumOf(7), tracksOf(7), 0), r.session.readVolume()]);
    r.fake.latencyMs = 0;
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'SetNextAVTransportURI']);
    expect(r.fake.maxInFlight).toBe(1);
    // The WiiM fetches the file first: asked again until it plays.
    expect(r.fake.of('GetTransportInfo').length).toBe(kind === 'wiim' ? 2 : 1);
    expect(r.session.state()).toMatchObject({ status: 'playing', index: 0, track: { title: 'Track 1' } });

    // It goes on by itself to the second track, with no gap; the third given next.
    r.fake.calls = [];
    await r.playFor(205);
    expect(r.fake.uri).toBe(urlOf('a7t2'));
    expect(r.fake.commands()).toEqual(['SetNextAVTransportURI']);
    expect(r.fake.of('SetNextAVTransportURI')[0].args.NextURI).toBe(urlOf('a7t3'));
    expect(r.session.state()).toMatchObject({ status: 'playing', index: 1, position: 5, duration: 200 });

    // ⏯ twice.
    await r.session.toggle();
    expect(r.fake.state).toBe('PAUSED_PLAYBACK');
    expect(r.session.state().status).toBe('paused');
    await r.session.toggle();
    expect(r.fake.state).toBe('PLAYING');

    // Into the track: REL_TIME, read back by RelTime (the WiiM has no AbsTime).
    await r.session.seek(61);
    expect(r.fake.of('Seek').at(-1)!.args).toMatchObject({ Unit: 'REL_TIME', Target: '0:01:01' });
    await r.playFor(2);
    expect(r.session.state().position).toBe(63);

    // ⏭ to the last track: nothing to give as next.
    r.fake.calls = [];
    await r.session.next();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play']);
    expect(r.fake.uri).toBe(urlOf('a7t3'));
    // ⏮ in its first seconds: the one before, the last given as next again.
    r.fake.calls = [];
    await r.session.previous();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'SetNextAVTransportURI']);
    expect(r.session.state()).toMatchObject({ index: 1, position: 0 });
    // ⏮ past 3 s: back to its start.
    await r.playFor(10);
    r.fake.calls = [];
    await r.session.previous();
    expect(r.fake.commands()).toEqual(['Seek']);
    expect(r.fake.of('Seek')[0].args).toMatchObject({ Unit: 'REL_TIME', Target: '0:00:00' });

    // The volume, never above the ceiling.
    await r.session.setVolume({ volume: 90 });
    expect(r.fake.volume).toBe(70);

    // Another input chosen on the appliance: let go, the place kept; Resume there.
    await r.playFor(30);
    r.fake.takeOver();
    await r.playFor(1);
    expect(r.session.state()).toMatchObject({ status: 'taken', index: 1, position: 30 });
    r.fake.calls = [];
    await r.session.resume();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
    expect(r.fake.position).toBe(30);

    // To the album's end: on its first track, paused, as the page's player does.
    await r.playFor(171);
    expect(r.session.state()).toMatchObject({ index: 2, status: 'playing' });
    await r.playFor(202);
    expect(r.session.state()).toMatchObject({ index: 0, status: 'paused', position: 0 });
    expect(r.fake.uri).toBe(urlOf('a7t1'));

    // Every Seek by REL_TIME, no Next nor Previous of the appliance's own: the list is ours.
    expect(r.fake.of('Seek').every(call => call.args.Unit === 'REL_TIME')).toBe(true);
    expect(r.fake.calls.some(call => call.action === 'Next' || call.action === 'Previous')).toBe(false);
    // Each track counted once at most, each start told as now playing.
    const counted = r.scrobbles.filter(([, submission]) => submission).map(([id]) => id);
    expect(new Set(counted).size).toBe(counted.length);
    expect(counted).toEqual(['a7t1', 'a7t2', 'a7t3']);
  }, 30_000);
});
