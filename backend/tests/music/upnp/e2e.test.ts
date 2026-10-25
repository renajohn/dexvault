import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import app from '../../../index';
import { getDatabase } from '../../../src/database';
import navidromeService from '../../../src/services/navidromeService';
import outputs from '../../../src/services/upnp/outputs';
import { upnpOptionsOf } from '../../../src/services/upnp/options';
import type { Playable } from '../../../src/services/playable';
import { FakeRenderer } from './fakeRenderer';
import { albumOf, tracksOf } from './helpers';

/**
 * End to end, as in the house but with fake appliances: DexVault listening
 * on a port, its media listener on another, the Onkyo and the WiiM played as
 * recorded. A page's commands go by HTTP to /api/outputs; what is checked is
 * the SOAP each appliance received, in order, and that the address it was
 * given plays (by the media listener, a Range passed on to Navidrome).
 */

const ONKYO = 'uuid:4a11a401-6c01-a4BB-4a70-6c724a11a401';
const WIIM = 'uuid:FF970016-C1C1-E478-77CC-8CC5FF970016';

const run = (sql: string) => new Promise<void>((resolve, reject) => getDatabase().run(sql, (err: Error | null) => (err ? reject(err) : resolve())));

const freePort = (): Promise<number> => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => resolve(port));
  });
});

const albums = new Map<number, Playable>([[7, { album: albumOf(7), tracks: tracksOf(7) }]]);
const scrobbles: Array<[string, boolean]> = [];

describe('DexVault playing on the appliances, end to end', () => {
  let server: http.Server;
  let api: string;
  let onkyo: FakeRenderer;
  let wiim: FakeRenderer;
  let mediaPort: number;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${api}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  beforeAll(async () => {
    await run('DELETE FROM output_settings');
    await run('DELETE FROM output_sessions');
    onkyo = await new FakeRenderer('onkyo').start();
    wiim = await new FakeRenderer('wiim').start();
    wiim.slowStart = true;
    mediaPort = await freePort();
    await outputs.init({
      ...upnpOptionsOf({}, {}, {}), renderers: [onkyo.location, wiim.location],
      mediaBaseUrl: `http://127.0.0.1:${mediaPort}`, mediaPort, maxVolume: 60,
    }, {
      // No Navidrome: the albums and the scrobbles stand in; the appliances asked by the test, on the fake clock.
      poll: false, wait: async () => undefined,
      turnDeps: { listIds: async () => [], markPlayed: async () => null, repeat: async () => false },
      load: async albumId => albums.get(albumId) ?? { album: albumOf(albumId), tracks: [] },
      scrobble: async (songId, submission) => { scrobbles.push([songId, submission]); return { left: null }; },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await outputs.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await onkyo.stop();
    await wiim.stop();
    jest.restoreAllMocks();
  });

  it('lists both appliances', async () => {
    const { status, body } = await call('GET', '/api/outputs');
    expect(status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({ id: ONKYO, name: 'Salon', reachable: true, gapless: true, volume: 57, maxVolume: 60 }),
      expect.objectContaining({ id: WIIM, name: 'Bureau', reachable: true, gapless: true, volume: 100, maxVolume: 60 }),
    ]);
  });

  it('plays an album on the Onkyo, every command of the bar sent as SOAP, then carries it over to the WiiM', async () => {
    const events: string[] = [];
    const listening = await new Promise<http.IncomingMessage>(resolve => http.get(`${api}/api/outputs/events`, resolve));
    listening.setEncoding('utf8');
    listening.on('data', chunk => events.push(chunk));

    try {
      onkyo.calls = [];
      let res = await call('POST', `/api/outputs/${ONKYO}/play`, { albumId: 7 });
      expect(res.body).toMatchObject({ status: 'playing', index: 0, album: { id: 7 } });

      onkyo.advance(30);
      await outputs.session(ONKYO)!.tick();
      res = await call('POST', `/api/outputs/${ONKYO}/toggle`);
      expect(res.body).toMatchObject({ status: 'paused', position: 30 });
      res = await call('POST', `/api/outputs/${ONKYO}/toggle`);
      expect(res.body.status).toBe('playing');
      res = await call('POST', `/api/outputs/${ONKYO}/next`);
      expect(res.body).toMatchObject({ index: 1, track: { title: 'Track 2' } });
      res = await call('POST', `/api/outputs/${ONKYO}/seek`, { position: 95 });
      expect(res.body.position).toBe(95);
      res = await call('PUT', `/api/outputs/${ONKYO}/volume`, { volume: 95 });
      expect(res.body.volume).toBe(60);

      expect(onkyo.commands()).toEqual([
        'SetAVTransportURI', 'Play', 'SetNextAVTransportURI', // ▶ album 7
        'Pause', 'Play', // ⏯ ⏯
        'SetAVTransportURI', 'Play', 'SetNextAVTransportURI', // ⏭
        'Seek', // into the track
        'SetVolume', // under the ceiling
      ]);
      expect(onkyo.of('Seek')[0].args).toMatchObject({ Unit: 'REL_TIME', Target: '0:01:35' });
      expect(onkyo.of('SetVolume')[0].args.DesiredVolume).toBe('60');
      expect(onkyo.volume).toBe(60);

      // The address the Onkyo was given plays, by the media listener, a seek's Range passed on to Navidrome.
      const stream = jest.spyOn(navidromeService, 'stream').mockImplementation(async () => ({
        status: 206, headers: { 'content-type': 'audio/flac', 'content-range': 'bytes 10-13/400', 'content-length': '4' }, data: Readable.from([Buffer.from('fLaC')]),
      }));
      const uri = onkyo.uri;
      expect(uri).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${mediaPort}/upnp/stream/[0-9a-f]{64}/a7t2\\.flac$`));
      const media = await fetch(uri, { headers: { Range: 'bytes=10-13' } });
      expect(media.status).toBe(206);
      expect(Buffer.from(await media.arrayBuffer()).toString()).toBe('fLaC');
      expect(stream).toHaveBeenCalledWith('a7t2', 'bytes=10-13');
      // Neither the address nor the DIDL says anything of Navidrome.
      const didl = onkyo.of('SetAVTransportURI').at(-1)!.args.CurrentURIMetaData;
      expect(`${uri}${didl}`).not.toMatch(/navidrome|rest\/|[?&](u|p|t|s)=/i);
      // Not by the API's port, nor with another token.
      expect((await fetch(uri.replace(/[0-9a-f]{64}/, 'f'.repeat(64)))).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${mediaPort}/api/outputs`)).status).toBe(404);

      // To the WiiM, at the same place; the Onkyo paused.
      onkyo.advance(5);
      wiim.calls = [];
      onkyo.calls = [];
      res = await call('POST', `/api/outputs/${WIIM}/play`, { from: ONKYO });
      expect(res.body).toMatchObject({ id: WIIM, status: 'playing', index: 1, album: { id: 7 } });
      expect(onkyo.commands()).toEqual(['Pause']);
      expect(wiim.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
      expect(Number(wiim.position)).toBeGreaterThanOrEqual(95);
      expect(wiim.uri).toMatch(/\/a7t2\.flac$/);
      expect((await call('GET', '/api/outputs')).body).toEqual([
        expect.objectContaining({ id: ONKYO, session: expect.objectContaining({ status: 'paused' }) }),
        expect.objectContaining({ id: WIIM, session: expect.objectContaining({ status: 'playing', index: 1 }) }),
      ]);

      // The pages were told each step, as it happened.
      for (let waited = 0; waited < 3000 && !events.join('').includes(`"id":"${WIIM}"`); waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
      const states = [...events.join('').matchAll(/event: state\ndata: (.*)\n\n/g)].map(match => JSON.parse(match[1]) as { id: string; status: string; index: number });
      expect(states.filter(state => state.id === ONKYO).map(state => state.status)).toEqual(expect.arrayContaining(['playing', 'paused']));
      expect(states.at(-1)).toMatchObject({ id: WIIM, status: 'playing', index: 1 });
      // A scrobble for each start, under the session's own songs.
      expect(scrobbles.filter(([, submission]) => !submission).map(([id]) => id)).toEqual(['a7t1', 'a7t2', 'a7t2']);
    } finally {
      listening.destroy();
    }
  }, 20_000);
});
