import type { OutputState } from '../../../src/services/upnp/session';
import type { PlayerAlbum } from '../../../src/services/playable';
import { rig, tracksOf, urlOf, type Rig } from './helpers';

let r: Rig;
afterEach(async () => { await r?.close(); });

/** A radio as the page plays it: tracks it made, under an album with no DexVault id. */
const radio: PlayerAlbum = { id: null, title: 'Radio · rock énergique', artist: 'Radio', cover: null };
const more = tracksOf(9, 2).map(track => ({ ...track, songId: `r${track.songId}` }));
const lastState = (rig: Rig): OutputState => rig.events.filter(([event]) => event === 'state').pop()![1] as OutputState;

describe('tracks added to a radio playing on an appliance that follows on (the Onkyo)', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('grows the queue, leaves the track playing and its place alone, and gives the first added as next', async () => {
    await r.session.playAlbum(radio, tracksOf(7, 2), 1);
    await r.playFor(30);
    r.fake.calls = [];
    expect(await r.session.append(more, radio.title)).toBe(2);
    expect(r.session.state()).toMatchObject({ index: 1, count: 4, status: 'playing', track: { songId: 'a7t2' } });
    expect(r.session.state().position).toBeGreaterThanOrEqual(29);
    // Nothing given again, nothing sought: only the next track, for the appliance to follow on with no gap.
    expect(r.fake.commands()).toEqual(['SetNextAVTransportURI']);
    expect(r.fake.of('SetNextAVTransportURI')[0].args.NextURI).toBe(urlOf('ra9t1'));
    expect(lastState(r)).toMatchObject({ count: 4, index: 1 });
    expect(r.saves.pop()!.tracks).toHaveLength(4);

    // And it goes on to it by itself.
    await r.playFor(180);
    expect(r.session.state()).toMatchObject({ index: 2, status: 'playing', track: { songId: 'ra9t1' } });
  });

  it('only to a radio: never to an album of DexVault, another radio, or nothing playing', async () => {
    await expect(r.session.append(more)).rejects.toMatchObject({ status: 404 });
    await r.session.playAlbum({ ...radio, id: 7, title: 'Album 7' }, tracksOf(7), 0);
    await expect(r.session.append(more)).rejects.toMatchObject({ status: 409 });
    await r.session.playAlbum(radio, tracksOf(7), 0);
    await expect(r.session.append(more, 'Radio · autre chose')).rejects.toMatchObject({ status: 409 });
    expect(r.session.state().count).toBe(3);
    expect(await r.session.append(more)).toBe(2);
  });
});

describe('tracks added on an appliance given one track at a time (the WiiM)', () => {
  beforeEach(async () => { r = await rig('wiim'); });

  it('plays them once the last one is over, instead of stopping', async () => {
    await r.session.playAlbum(radio, tracksOf(7, 1), 0);
    await r.playFor(30);
    await r.session.append(more);
    await r.playFor(175);
    expect(r.session.state()).toMatchObject({ index: 1, status: 'playing', track: { songId: 'ra9t1' } });
  });
});
