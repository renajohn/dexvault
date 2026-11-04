import type { PlayerAlbum } from '../../../src/services/playable';
import { rig, tracksOf, urlOf, type Rig } from './helpers';

let r: Rig;
afterEach(async () => { await r?.close(); });

const album: PlayerAlbum = { id: 7, title: 'Album 7', artist: 'Someone', cover: null };

describe('the tracks to come put in order by hand, on an appliance that follows on (the Onkyo)', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('gives the new next track at once, the one playing and its place untouched', async () => {
    await r.session.playAlbum(album, tracksOf(7), 0);
    await r.playFor(30);
    r.fake.calls = [];
    const [, second, third] = tracksOf(7);
    expect(await r.session.queueUp([third, second], album.title, 'a7t1')).toBe(3);
    expect(r.fake.commands()).toEqual(['SetNextAVTransportURI']);
    expect(r.fake.of('SetNextAVTransportURI')[0].args.NextURI).toBe(urlOf('a7t3'));
    await r.playFor(180);
    expect(r.session.state()).toMatchObject({ index: 1, status: 'playing', track: { songId: 'a7t3' } });
  });

  it('forgets the next track there once the last one to come is taken out: the album ends after the one playing', async () => {
    await r.session.playAlbum(album, tracksOf(7, 2), 0);
    await r.playFor(30);
    r.fake.calls = [];
    expect(await r.session.queueUp([], album.title, 'a7t1')).toBe(1);
    expect(r.fake.of('SetNextAVTransportURI').map(call => call.args.NextURI)).toEqual(['']);
    await r.playFor(200);
    expect(r.session.state()).toMatchObject({ status: 'paused', index: 0, count: 1 });
    expect(r.fake.uri).not.toBe(urlOf('a7t2'));
  });

  it('ends the track there all the same when the appliance would not forget the next one, rather than letting go', async () => {
    await r.session.playAlbum(album, tracksOf(7, 2), 0);
    await r.playFor(30);
    r.fake.refuse.set('SetNextAVTransportURI', 701);
    await r.session.queueUp([], album.title, 'a7t1');
    await r.playFor(260);
    // Gone on to the track taken out: stopped there, the album over, the play still ours.
    expect(r.session.state().status).not.toBe('taken');
    expect(r.session.state()).toMatchObject({ status: 'paused', index: 0, count: 1 });
    expect(r.fake.commands()).toContain('Stop');
  });

  it('keeps after them the tracks added since the page saw the play (the radio refilled meanwhile)', async () => {
    const radio: PlayerAlbum = { id: null, title: 'Radio · upbeat', artist: 'Radio', cover: null };
    await r.session.playAlbum(radio, tracksOf(7), 0);
    await r.session.append(tracksOf(8, 1), radio.title);
    // The page saw three tracks, and puts the third before the second.
    const [, second, third] = tracksOf(7);
    await r.session.queueUp([third, second], radio.title, 'a7t1', 3);
    expect(r.session.state().tracks.map(track => track.songId)).toEqual(['a7t1', 'a7t3', 'a7t2', 'a8t1']);
  });
});

