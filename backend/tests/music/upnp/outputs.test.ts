import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import app from '../../../index';
import { getDatabase } from '../../../src/database';
import outputs from '../../../src/services/upnp/outputs';
import * as media from '../../../src/services/upnp/media';
import { upnpOptionsOf, type UpnpOptions } from '../../../src/services/upnp/options';
import type { Playable } from '../../../src/services/playable';
import type { TurnDeps } from '../../../src/services/upnp/turn';
import { FakeRenderer } from './fakeRenderer';
import { albumOf, tracksOf } from './helpers';

const ONKYO = 'uuid:4a11a401-6c01-a4BB-4a70-6c724a11a401';
const WIIM = 'uuid:FF970016-C1C1-E478-77CC-8CC5FF970016';
const BASE = 'http://dexvault.test:3002';

const run = (sql: string) => new Promise<void>((resolve, reject) => getDatabase().run(sql, (err: Error | null) => (err ? reject(err) : resolve())));
const rows = <T>(sql: string) => new Promise<T[]>((resolve, reject) => getDatabase().all(sql, (err: Error | null, found: T[]) => (err ? reject(err) : resolve(found))));

const albums = new Map<number, Playable>([[7, { album: albumOf(7), tracks: tracksOf(7) }], [8, { album: albumOf(8), tracks: tracksOf(8) }]]);
const scrobbles: Array<[string, boolean]> = [];
const turnDeps: TurnDeps = { listIds: async () => ['7:0', '8:0'], markPlayed: async () => null, repeat: async () => false };

const overrides = {
  listen: false, poll: false, wait: async () => undefined, turnDeps,
  load: async (albumId: number) => albums.get(albumId) ?? { album: albumOf(albumId), tracks: [] },
  scrobble: async (songId: string, submission: boolean) => { scrobbles.push([songId, submission]); return { left: null }; },
};

const optionsWith = (renderers: string[], change: Partial<UpnpOptions> = {}): UpnpOptions =>
  ({ ...upnpOptionsOf({}, {}, {}), renderers, mediaBaseUrl: BASE, mediaPort: 0, ...change });

afterAll(async () => { await outputs.shutdown(); });

describe('without UPNP_MEDIA_BASE_URL', () => {
  it('opens no port, reads no appliance, and lists none', async () => {
    const start = jest.spyOn(media, 'startMediaServer');
    await outputs.init(upnpOptionsOf({}, { upnp_renderers: 'http://192.0.2.1:8888/upnp_descriptor_0' }, {}));
    expect(start).not.toHaveBeenCalled();
    expect(outputs.mediaServer).toBeNull();
    expect((await request(app).get('/api/outputs')).body).toEqual([]);
    expect((await request(app).post(`/api/outputs/${ONKYO}/toggle`)).status).toBe(404);
    start.mockRestore();
  });

  it('reads the options in order: deployment, options.json, then the environment', () => {
    const options = upnpOptionsOf(
      { upnp_media_port: 4000, upnp_discovery: 'ssdp' },
      { upnp_renderers: 'http://a/1.xml, http://b/2.xml', upnp_media_port: 5000, upnp_max_volume: 55 },
      { UPNP_MEDIA_BASE_URL: 'http://dexvault.lab.crog.org:3002/', UPNP_MAX_VOLUME: '60' });
    expect(options).toEqual({
      renderers: ['http://a/1.xml', 'http://b/2.xml'], mediaPort: 5000, mediaBaseUrl: 'http://dexvault.lab.crog.org:3002',
      discovery: 'ssdp', maxVolume: 60, remoteEnabled: true,
    });
    expect(upnpOptionsOf({}, {}, {})).toMatchObject({ renderers: [], mediaPort: 3002, mediaBaseUrl: '', discovery: 'off', maxVolume: 70 });
    expect(upnpOptionsOf({}, {}, { REMOTE_ENABLED: 'false' }).remoteEnabled).toBe(false);
  });
});

describe('with it', () => {
  let onkyo: FakeRenderer;
  let wiim: FakeRenderer;

  beforeEach(async () => {
    await run('DELETE FROM output_settings');
    await run('DELETE FROM output_sessions');
    scrobbles.length = 0;
    onkyo = await new FakeRenderer('onkyo').start();
    wiim = await new FakeRenderer('wiim').start();
    await outputs.init(optionsWith([onkyo.location, wiim.location]), overrides);
  });

  afterEach(async () => {
    await outputs.shutdown();
    await onkyo.stop();
    await wiim.stop();
  });

  it('opens the media listener on its port', async () => {
    await outputs.init(optionsWith([]), { ...overrides, listen: true });
    expect((outputs.mediaServer!.address() as AddressInfo).port).toBeGreaterThan(0);
  });

  it('lists the appliances, their volume and ceiling, nothing playing', async () => {
    const res = await request(app).get('/api/outputs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: ONKYO, name: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true, volume: 57, maxVolume: 70, session: expect.objectContaining({ status: 'stopped', album: null }) }),
      expect.objectContaining({ id: WIIM, name: 'Bureau', model: 'WiiM Mini Receiver', reachable: true, gapless: true, volume: 100, maxVolume: 70 }),
    ]);
  });

  it('lists the appliances in the order configured, whichever answers first', async () => {
    onkyo.latencyMs = 50;
    await outputs.init(optionsWith([onkyo.location, wiim.location]), overrides);
    expect((await request(app).get('/api/outputs')).body.map((output: { id: string }) => output.id)).toEqual([ONKYO, WIIM]);
    // Configured the other way round: listed so.
    await outputs.init(optionsWith([wiim.location, onkyo.location]), overrides);
    expect((await request(app).get('/api/outputs')).body.map((output: { id: string }) => output.id)).toEqual([WIIM, ONKYO]);
  });

  it('plays an album there, and answers each command with the state', async () => {
    const res = await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7, index: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ONKYO, name: 'Salon', status: 'playing', index: 1, count: 3, album: { id: 7 }, track: { title: 'Track 2' } });
    expect(onkyo.commands()).toEqual(['SetAVTransportURI', 'Play', 'SetNextAVTransportURI']);

    expect((await request(app).post(`/api/outputs/${ONKYO}/toggle`)).body.status).toBe('paused');
    expect((await request(app).post(`/api/outputs/${ONKYO}/seek`).send({ position: 30 })).body.position).toBe(30);
    expect((await request(app).post(`/api/outputs/${ONKYO}/track`).send({ index: 2 })).body.index).toBe(2);
    expect((await request(app).post(`/api/outputs/${ONKYO}/track`).send({ index: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/outputs/${ONKYO}/previous`)).body.index).toBe(1);
    expect((await request(app).post(`/api/outputs/${ONKYO}/next`)).body.index).toBe(2);
    expect((await request(app).post(`/api/outputs/${ONKYO}/stop`)).body).toMatchObject({ status: 'stopped', index: 2 });
    expect((await request(app).post('/api/outputs/uuid:nobody/toggle')).status).toBe(404);
    expect((await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 99 })).status).toBe(404);
  });

  it('plays tracks a page sends, carried over at their place', async () => {
    const res = await request(app).post(`/api/outputs/${WIIM}/play`).send({ album: albumOf(8), tracks: tracksOf(8), index: 2, position: 61 });
    expect(res.body).toMatchObject({ status: 'playing', index: 2, position: 61 });
    expect(wiim.of('Seek')[0].args.Target).toBe('0:01:01');
    expect((await request(app).post(`/api/outputs/${WIIM}/play`).send({ album: albumOf(8), tracks: [{ songId: '../x' }] })).status).toBe(400);
  });

  it('carries a play over from one appliance to the other, the first paused', async () => {
    await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7, index: 1 }).expect(200);
    onkyo.advance(20);
    await outputs.session(ONKYO)!.tick();
    const res = await request(app).post(`/api/outputs/${WIIM}/play`).send({ from: ONKYO });
    expect(res.body).toMatchObject({ status: 'playing', index: 1, album: { id: 7 } });
    expect(wiim.position).toBeGreaterThanOrEqual(20);
    expect(onkyo.state).toBe('PAUSED_PLAYBACK');
    expect(outputs.session(ONKYO)!.state().status).toBe('paused');
  });

  it('plays Listen Next there', async () => {
    const res = await request(app).post(`/api/outputs/${ONKYO}/listen-next`).send({});
    expect(res.body).toMatchObject({ queue: 'listenNext', album: { id: 7 }, upcoming: ['8:0'] });
    const jump = await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 8, index: 1, listenNext: true });
    expect(jump.body).toMatchObject({ queue: 'listenNext', album: { id: 8 }, index: 1 });
  });

  it('keeps the volume under the ceiling, which the owner sets with the name shown', async () => {
    expect((await request(app).put(`/api/outputs/${ONKYO}/volume`).send({ volume: 99 })).body.volume).toBe(70);
    expect(onkyo.volume).toBe(70);
    const set = await request(app).put(`/api/outputs/${ONKYO}/settings`).send({ name: 'Living room', maxVolume: 40 });
    expect(set.body).toMatchObject({ id: ONKYO, name: 'Living room', deviceName: 'Salon', maxVolume: 40 });
    expect((await request(app).put(`/api/outputs/${ONKYO}/volume`).send({ volume: 60, muted: true })).body).toMatchObject({ volume: 40, muted: true });
    expect(onkyo.volume).toBe(40);
    expect((await request(app).put(`/api/outputs/${ONKYO}/settings`).send({ maxVolume: 140 })).status).toBe(400);
    expect((await request(app).put(`/api/outputs/${ONKYO}/volume`).send({ volume: 'loud' })).status).toBe(400);
    // Kept: read again at the next start.
    await outputs.init(optionsWith([onkyo.location, wiim.location]), overrides);
    expect((await request(app).get('/api/outputs')).body[0]).toMatchObject({ name: 'Living room', maxVolume: 40 });
  });

  it('answers 409 when the appliance plays something else, 503 when it does not answer', async () => {
    await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7 }).expect(200);
    onkyo.takeOver();
    await outputs.session(ONKYO)!.tick();
    await outputs.session(ONKYO)!.tick();
    const taken = await request(app).post(`/api/outputs/${ONKYO}/toggle`);
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: 'Salon is playing something else', status: 'taken' });
    expect((await request(app).post(`/api/outputs/${ONKYO}/resume`)).body.status).toBe('playing');

    onkyo.down = true;
    const volume = await request(app).put(`/api/outputs/${ONKYO}/volume`).send({ volume: 30 });
    expect(volume.status).toBe(503);
    expect(volume.body).toEqual({ error: 'Salon does not answer: is it on?', status: 'unreachable' });
    // A track asked of it while away is kept, and given once it answers.
    const away = await request(app).post(`/api/outputs/${ONKYO}/next`);
    expect(away.status).toBe(503);
    expect(away.body).toEqual({ error: 'Salon is waking up: it plays as soon as it answers', status: 'unreachable', kept: true });
    expect((await request(app).get('/api/outputs')).body[0].session).toMatchObject({ status: 'unreachable', index: 1 });
    onkyo.down = false;
    await outputs.session(ONKYO)!.tick();
    expect((await request(app).get('/api/outputs')).body[0].session).toMatchObject({ status: 'playing', index: 1 });
  });

  it('tells the pages the appliance is back once a play asked while away plays there, not a minute later', async () => {
    const lists: Array<Array<{ id: string; reachable: boolean }>> = [];
    const broadcast = outputs.broadcast.bind(outputs);
    const spy = jest.spyOn(outputs, 'broadcast').mockImplementation((event, payload) => {
      if (event === 'outputs') lists.push(outputs.list());
      broadcast(event, payload);
    });
    try {
      onkyo.down = true;
      const away = await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7 });
      expect(away.status).toBe(503);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(lists.at(-1)!.find(one => one.id === ONKYO)!.reachable).toBe(false);

      // Back: the poll gives it the play. The last list the pages were told says it answers.
      onkyo.down = false;
      await outputs.session(ONKYO)!.tick();
      await outputs.session(ONKYO)!.idle();
      for (let waited = 0; waited < 2000 && !lists.at(-1)!.find(one => one.id === ONKYO)!.reachable; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
      expect(outputs.session(ONKYO)!.state().status).toBe('playing');
      expect(lists.at(-1)!.find(one => one.id === ONKYO)!.reachable).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('carries a play over from where the first one fell silent, its place read after the pause', async () => {
    await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7, index: 1, position: 30 }).expect(200);
    const salon = outputs.session(ONKYO)!;
    // The Onkyo's pause answered late: the place is read once it has fallen silent.
    const pause = salon.pauseForTransfer.bind(salon);
    jest.spyOn(salon, 'pauseForTransfer').mockImplementation(async () => {
      onkyo.advance(4);
      await salon.tick();
      await pause();
    });
    await request(app).post(`/api/outputs/${WIIM}/play`).send({ from: ONKYO }).expect(200);
    expect(outputs.session(WIIM)!.state()).toMatchObject({ index: 1 });
    expect(outputs.session(WIIM)!.state().position).toBeGreaterThanOrEqual(34);
  });

  it('says a play is kept only for a command that asks one, not for the volume or a seek', async () => {
    onkyo.down = true;
    const played = await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7 });
    expect(played.body).toMatchObject({ status: 'unreachable', kept: true });
    const seek = await request(app).post(`/api/outputs/${ONKYO}/seek`).send({ position: 30 });
    const volume = await request(app).put(`/api/outputs/${ONKYO}/volume`).send({ volume: 20 });
    for (const answer of [seek, volume]) {
      if (answer.status === 503) expect(answer.body).toEqual({ error: 'Salon does not answer: is it on?', status: 'unreachable' });
      else expect(answer.body.kept).toBeUndefined();
    }
    expect(volume.status).toBe(503);
  });

  it('writes the play down, and takes it up again after a restart', async () => {
    await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7, index: 2 }).expect(200);
    await outputs.session(ONKYO)!.idle();
    const [row] = await rows<{ id: string; state: string }>('SELECT id, state FROM output_sessions');
    expect(row.id).toBe(ONKYO);
    expect(JSON.parse(row.state)).toMatchObject({ index: 2, album: { id: 7 } });
    expect(row.state).not.toContain('navidrome');

    await outputs.init(optionsWith([onkyo.location, wiim.location]), overrides);
    const session = outputs.session(ONKYO)!;
    expect(session.state()).toMatchObject({ status: 'paused', index: 2 });
    await session.tick();
    expect(session.state().status).toBe('playing');
  });

  it('lists an appliance seen before as away when it does not answer at the start', async () => {
    await outputs.shutdown();
    await wiim.stop();
    await outputs.init(optionsWith([onkyo.location, wiim.location]), overrides);
    const listed = (await request(app).get('/api/outputs')).body;
    expect(listed.find((output: { id: string }) => output.id === WIIM)).toMatchObject({ name: 'Bureau', reachable: false });
  });

  it('M6: tells every page listening the same play: what the iPhone asks, the Mac sees', async () => {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const pages = await Promise.all([0, 1].map(async () => {
      const received: string[] = [];
      const response = await new Promise<http.IncomingMessage>(resolve => http.get(`http://127.0.0.1:${port}/api/outputs/events`, resolve));
      response.setEncoding('utf8');
      response.on('data', chunk => received.push(chunk));
      return { received, response };
    }));
    try {
      for (let waited = 0; waited < 3000 && pages.some(page => !page.received.length); waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
      await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7, index: 2 }).expect(200);
      for (let waited = 0; waited < 3000 && pages.some(page => !page.received.join('').includes('event: state')); waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
      for (const page of pages) {
        const state = /event: state\ndata: (.*)\n\n/.exec(page.received.join(''));
        expect(JSON.parse(state![1])).toMatchObject({ id: ONKYO, status: 'playing', index: 2 });
      }
    } finally {
      pages.forEach(page => page.response.destroy());
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('tells the pages listening what plays, as Server-Sent Events', async () => {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const received: string[] = [];
    const response = await new Promise<http.IncomingMessage>(resolve => http.get(`http://127.0.0.1:${port}/api/outputs/events`, resolve));
    response.setEncoding('utf8');
    response.on('data', chunk => received.push(chunk));
    // Listening before the play starts: its first state is not missed.
    for (let waited = 0; waited < 3000 && !received.length; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
    try {
      expect(response.headers['content-type']).toBe('text/event-stream');
      await request(app).post(`/api/outputs/${ONKYO}/play`).send({ albumId: 7 }).expect(200);
      // Written as the play starts, read when it comes: a loaded machine takes a while.
      for (let waited = 0; waited < 3000 && !received.join('').includes('event: state'); waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
      const text = received.join('');
      expect(text).toContain(': listening');
      expect(text).toMatch(/event: outputs\ndata: \[/);
      const state = /event: state\ndata: (.*)\n\n/.exec(text);
      expect(state).not.toBeNull();
      expect(JSON.parse(state![1])).toMatchObject({ id: ONKYO, status: 'playing', album: { id: 7 }, track: { title: 'Track 1' }, at: expect.any(Number) });
    } finally {
      response.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
