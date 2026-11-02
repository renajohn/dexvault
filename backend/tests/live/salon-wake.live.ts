/**
 * The live bench for a play on the Salon: DexVault's own server, started as
 * in production (its own data, no Navidrome account), playing on a fake
 * Onkyo (LiveOnkyo: UPnP and eISCP, standby, its network dropping and coming
 * and going as on 02.11.2026) and a fake WiiM, in real time. Each scenario
 * drives the API as the pages do and checks what the server tells them
 * (Server-Sent Events) and what the appliances were asked.
 *
 *   cd backend && npx tsx tests/live/salon-wake.live.ts            all scenarios
 *   npx tsx tests/live/salon-wake.live.ts tv cancel                 some of them
 *   npx tsx tests/live/salon-wake.live.ts --hold                    then leave it running (API on :3111)
 *
 * Not part of npm test: it takes minutes, and port 60128.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LiveOnkyo } from './liveOnkyo';

const API_PORT = Number(process.env.LIVE_API_PORT || 3111);
const MEDIA_PORT = Number(process.env.LIVE_MEDIA_PORT || 3112);
const API = `http://127.0.0.1:${API_PORT}/api`;
const BACKEND = path.resolve(__dirname, '../..');

const album = { id: 115, title: 'Symphonien Nr. 1 & 3 "Eroica"', artist: 'Karajan', cover: null };
const tracks = [
  { songId: 'eroica1', title: 'Symphonie No. 1: I. Adagio molto - Allegro con brio', disc: 1, no: 1, durationSec: 573, suffix: 'flac' },
  { songId: 'eroica2', title: 'Symphonie No. 1: II. Andante cantabile con moto', disc: 1, no: 2, durationSec: 480, suffix: 'flac' },
];

interface Told { at: number; event: string; data: any }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const call = async (method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${API}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const waitFor = async (label: string, test: () => boolean | Promise<boolean>, ms: number): Promise<number> => {
  const from = Date.now();
  while (Date.now() - from < ms) {
    if (await test()) return Date.now() - from;
    await sleep(100);
  }
  throw new Error(`${label}: not within ${ms / 1000} s`);
};

class Bench {
  onkyo = new LiveOnkyo('onkyo');
  wiim = new LiveOnkyo('wiim');
  told: Told[] = [];
  server: ChildProcess | null = null;
  sse: http.ClientRequest | null = null;
  salon = '';
  bureau = '';
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'dexvault-live-'));
  log = path.join(this.data, 'backend.log');

  async start(): Promise<void> {
    await this.onkyo.start();
    await this.wiim.start({ iscp: false });
    fs.writeFileSync(path.join(this.data, 'deployment.json'), JSON.stringify({ data_path: this.data, platform: 'localhost', deployment: 'dev' }));
    const out = fs.openSync(this.log, 'w');
    this.server = spawn('npx', ['tsx', 'index.ts', `--deployment=${path.join(this.data, 'deployment.json')}`], {
      cwd: BACKEND,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        PORT: String(API_PORT),
        UPNP_RENDERERS: `${this.onkyo.upnp.location},${this.wiim.upnp.location}`,
        UPNP_MEDIA_BASE_URL: `http://127.0.0.1:${MEDIA_PORT}`,
        UPNP_MEDIA_PORT: String(MEDIA_PORT),
        UPNP_DISCOVERY: 'off',
        // No Navidrome account touched: nothing synced, scrobbles fail quietly.
        NAVIDROME_URL: 'http://127.0.0.1:9', NAVIDROME_USER: '', NAVIDROME_PASSWORD: '',
        DROPBOX_APP_KEY: '', DROPBOX_APP_SECRET: '', DROPBOX_REFRESH_TOKEN: '',
        NODE_ENV: 'development',
      },
    });
    await waitFor('the server listening with both appliances', async () => {
      const list = await call('GET', '/outputs').catch(() => null);
      if (!Array.isArray(list?.body) || list!.body.length < 2) return false;
      this.salon = list!.body.find((one: any) => /onkyo/i.test(one.manufacturer))?.id ?? '';
      this.bureau = list!.body.find((one: any) => /linkplay/i.test(one.manufacturer))?.id ?? '';
      return Boolean(this.salon && this.bureau);
    }, 90_000);
    await call('PUT', `/outputs/${encodeURIComponent(this.salon)}/settings`, { name: 'Salon' });
    await call('PUT', `/outputs/${encodeURIComponent(this.bureau)}/settings`, { name: 'Bureau' });
    this.listen();
  }

  private listen(): void {
    this.sse = http.get(`${API}/outputs/events`, res => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) this.told.push({ at: Date.now(), event, data: JSON.parse(data) });
        }
      });
    });
  }

  /** The states told of the Salon since `from`. */
  states(from: number, id = this.salon): any[] {
    return this.told.filter(one => one.at >= from && one.event === 'state' && one.data.id === id).map(one => one.data);
  }

  last(id = this.salon): any { return this.states(0, id).at(-1) ?? null; }

  /** A state the pages would show as "Salon, away": unreachable, and not on its way. */
  awayShown(from: number): any[] {
    return this.states(from).filter(state => state.status === 'unreachable' && !state.waking);
  }

  async stop(): Promise<void> {
    this.sse?.destroy();
    if (this.server) {
      this.server.kill('SIGTERM');
      await new Promise(resolve => this.server!.once('exit', resolve));
    }
    await this.onkyo.stop();
    await this.wiim.stop();
  }

  /** Both appliances as at the start: nothing of ours, the Salon in standby on NET unless said otherwise. */
  async reset(power: 'on' | 'standby' = 'standby', input = '2B'): Promise<void> {
    for (const id of [this.salon, this.bureau]) await call('POST', `/outputs/${encodeURIComponent(id)}/stop`).catch(() => undefined);
    await sleep(800);
    this.onkyo.reset(power, input);
    this.wiim.reset('on');
    await sleep(300);
  }

  play(id = this.salon) {
    return call('POST', `/outputs/${encodeURIComponent(id)}/play`, { album, tracks, index: 0, position: 0 });
  }

  /** Whether it plays our first track, and goes on doing so. */
  playsOurs(fake = this.onkyo): boolean {
    return fake.upnp.state === 'PLAYING' && fake.upnp.uri.includes('/upnp/stream/') && /eroica[12]/.test(fake.upnp.uri);
  }
}

type Check = (bench: Bench) => Promise<string[]>;

const expect = (notes: string[], ok: boolean, what: string) => { notes.push(`${ok ? '✓' : '✗'} ${what}`); };

/** Played steadily: our track sounding, and the position moving, for `ms`. */
const steady = async (bench: Bench, ms: number, fake = bench.onkyo): Promise<boolean> => {
  const from = fake.upnp.position;
  for (let waited = 0; waited < ms; waited += 250) {
    if (!bench.playsOurs(fake)) return false;
    await sleep(250);
  }
  return fake.upnp.position > from;
};

const scenarios: Record<string, { what: string; run: Check }> = {
  clean: {
    what: 'Salon in standby, woken cleanly: on, NET, a short blackout as it settles, then plays',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'up', ms: 1500 }, { mode: 'hang', ms: 8000 }]);
      const from = Date.now();
      const asked = bench.play();
      const waited = await waitFor('Salon playing', () => bench.playsOurs(), 40_000);
      const iscp = bench.onkyo.iscpSince(from);
      const firstUri = bench.onkyo.log.find(entry => entry.at >= from && entry.what === 'SOAP SetAVTransportURI')?.at ?? Infinity;
      const netAt = bench.onkyo.log.find(entry => entry.at >= from && entry.what === 'ISCP SLI2B')?.at ?? -Infinity;
      expect(notes, iscp.includes('PWR01') && iscp.includes('SLI2B'), `turned on, to NET (eISCP: ${iscp.join(' ')})`);
      expect(notes, netAt < firstUri, 'on NET before the first track is given');
      expect(notes, bench.states(from).some(state => state.waking?.step === 'on' && state.waking.poweredOn), 'the pages told "Turning Salon on…"');
      notes.push(`  first sound after ${(waited / 1000).toFixed(1)} s`);
      await asked;
      // Through the blackout: still ours, or ours again.
      await sleep(10_000);
      await waitFor('Salon playing after its blackout', () => bench.playsOurs(), 30_000).catch(() => undefined);
      expect(notes, await steady(bench, 5000), 'plays on steadily after its blackout');
      expect(notes, bench.awayShown(from).length === 0, `never shown away (${bench.awayShown(from).length} states)`);
      expect(notes, bench.last()?.status === 'playing' && bench.last()?.waking == null, 'told playing at the end, nothing on its way');
      return notes;
    },
  },

  today: {
    what: 'The 02.11.2026 wake, compressed: answers a second, drops, then a network that comes and goes',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'up', ms: 1000 }, { mode: 'hang', ms: 6000 }, { mode: 'flaky', ms: 20_000 }]);
      const from = Date.now();
      bench.play().catch(() => undefined);
      await sleep(27_500);
      const waited = await waitFor('Salon playing once its network holds', () => bench.playsOurs(), 40_000);
      notes.push(`  sounding ${(waited / 1000).toFixed(1)} s after its network held (${((Date.now() - from) / 1000).toFixed(0)} s after Play)`);
      expect(notes, await steady(bench, 6000), 'plays on steadily');
      expect(notes, bench.awayShown(from).length === 0, `never shown away (${bench.awayShown(from).length} states)`);
      expect(notes, bench.states(from).some(state => state.waking?.unsteady), 'the pages told its network comes and goes');
      const steps = [...new Set(bench.states(from).map(state => state.waking?.step ?? state.status))];
      notes.push(`  told, in order: ${steps.join(' → ')}`);
      const tracksGiven = bench.onkyo.soapSince(from).filter(action => action === 'SetAVTransportURI').length;
      notes.push(`  tracks given: ${tracksGiven}`);
      expect(notes, bench.onkyo.maxSoap <= 1, `one SOAP call at a time (at most ${bench.onkyo.maxSoap})`);
      expect(notes, bench.onkyo.maxReads <= 1, `one description read at a time (at most ${bench.onkyo.maxReads})`);
      return notes;
    },
  },

  cancel: {
    what: 'Waiting for its network, ⏸ (the ring): given up, back to standby, nothing played when it answers',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'hang', ms: 16_000 }]);
      const from = Date.now();
      bench.play().catch(() => undefined);
      await waitFor('told waiting for its network', () => bench.states(from).some(state => state.waking?.step === 'network'), 20_000)
        .then(ms => notes.push(`  "waking up" told after ${(ms / 1000).toFixed(1)} s`));
      const cancelAt = Date.now();
      const answer = await call('POST', `/outputs/${encodeURIComponent(bench.salon)}/toggle`, { playing: false });
      notes.push(`  ⏸ answered ${answer.status} after ${((Date.now() - cancelAt) / 1000).toFixed(1)} s`);
      await waitFor('back to standby', () => bench.onkyo.power === 'standby', 8000)
        .then(ms => expect(notes, true, `back to standby (${(ms / 1000).toFixed(1)} s)`), () => expect(notes, false, 'back to standby'));
      await waitFor('no longer on its way', () => bench.last()?.waking == null && !bench.last()?.wanted, 8000)
        .then(() => expect(notes, true, 'the pages told it is given up'), () => expect(notes, false, 'the pages told it is given up'));
      await sleep(Math.max(0, from + 20_000 - Date.now()));
      const after = bench.onkyo.soapSince(cancelAt);
      expect(notes, !after.includes('SetAVTransportURI') && !after.includes('Play'), `nothing given once its network is back (${after.join(' ') || 'no command'})`);
      return notes;
    },
  },

  'cancel-early': {
    what: '⏸ a second after Play, the track still being given to a Salon that hangs',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'hang', ms: 12_000 }]);
      const from = Date.now();
      bench.play().catch(() => undefined);
      await sleep(1200);
      const cancelAt = Date.now();
      await call('POST', `/outputs/${encodeURIComponent(bench.salon)}/toggle`, { playing: false });
      await waitFor('back to standby', () => bench.onkyo.power === 'standby', 10_000)
        .then(ms => expect(notes, true, `back to standby ${(ms / 1000).toFixed(1)} s after ⏸`), () => expect(notes, false, 'back to standby'));
      await sleep(Math.max(0, from + 16_000 - Date.now()));
      const after = bench.onkyo.soapSince(cancelAt + 500);
      expect(notes, !after.includes('Play'), `never played (${after.join(' ') || 'no command'})`);
      expect(notes, bench.last()?.waking == null && !bench.last()?.wanted, 'told given up');
      return notes;
    },
  },

  tv: {
    what: 'Salon on the TV: left alone, said so; Switch to NET plays',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('on', '12');
      const from = Date.now();
      const answer = await bench.play();
      expect(notes, answer.status === 409 && /is on TV/.test(answer.body?.error), `refused: ${answer.status} "${answer.body?.error}"`);
      expect(notes, bench.onkyo.soapSince(from).length === 0, `nothing sent by UPnP (${bench.onkyo.soapSince(from).join(' ') || 'nothing'})`);
      expect(notes, !bench.onkyo.iscpSince(from).some(command => command.startsWith('SLI2B')), 'its input left alone');
      await waitFor('told taken', () => bench.last()?.status === 'taken', 3000).catch(() => undefined);
      expect(notes, bench.last()?.status === 'taken' && bench.last()?.input === 'TV', `told taken by ${bench.last()?.input}`);
      const resumed = Date.now();
      await call('POST', `/outputs/${encodeURIComponent(bench.salon)}/resume`);
      await waitFor('playing after Switch to NET', () => bench.playsOurs(), 10_000)
        .then(ms => expect(notes, bench.onkyo.input === '2B', `on NET and playing ${(ms / 1000).toFixed(1)} s after Switch to NET`), () => expect(notes, false, 'playing after Switch to NET'));
      expect(notes, bench.onkyo.iscpSince(resumed).includes('SLI2B'), 'NET chosen by eISCP');
      return notes;
    },
  },

  pause701: {
    what: '⏸ refused (701) for 2.5 s as the Onkyo starts the track: paused all the same',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('on');
      await bench.play();
      await waitFor('playing', () => bench.playsOurs(), 10_000);
      await sleep(2000);
      bench.onkyo.refusePauseUntil = Date.now() + 2500;
      const from = Date.now();
      await call('POST', `/outputs/${encodeURIComponent(bench.salon)}/toggle`, { playing: false });
      notes.push(`  ⏸ answered after ${((Date.now() - from) / 1000).toFixed(1)} s`);
      await waitFor('paused', () => bench.onkyo.upnp.state === 'PAUSED_PLAYBACK', 12_000)
        .then(ms => expect(notes, true, `paused ${(ms / 1000).toFixed(1)} s after ⏸, though refused first`), () => expect(notes, false, 'paused though refused first'));
      const pauses = bench.onkyo.soapSince(from).filter(action => action === 'Pause').length;
      notes.push(`  Pause asked ${pauses} times`);
      await sleep(1500);
      expect(notes, bench.last()?.status === 'paused', `told ${bench.last()?.status}`);
      return notes;
    },
  },

  elsewhere: {
    what: 'Waiting for the Salon, Listen elsewhere: Bureau plays at once, the Salon back to standby',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'hang', ms: 15_000 }]);
      const from = Date.now();
      bench.play().catch(() => undefined);
      await sleep(3000);
      const bail = Date.now();
      const answer = await call('POST', `/outputs/${encodeURIComponent(bench.bureau)}/play`, { from: bench.salon });
      notes.push(`  carried in ${((Date.now() - bail) / 1000).toFixed(1)} s (${answer.status})`);
      await waitFor('Bureau playing', () => bench.playsOurs(bench.wiim), 10_000)
        .then(() => expect(notes, true, 'Bureau plays the album'), () => expect(notes, false, 'Bureau plays the album'));
      await waitFor('Salon back to standby', () => bench.onkyo.power === 'standby', 8000)
        .then(() => expect(notes, true, 'Salon back to standby'), () => expect(notes, false, 'Salon back to standby'));
      await sleep(Math.max(0, from + 19_000 - Date.now()));
      const after = bench.onkyo.soapSince(bail + 500);
      expect(notes, !after.includes('Play'), `nothing played on the Salon after (${after.join(' ') || 'no command'})`);
      expect(notes, await steady(bench, 3000, bench.wiim), 'Bureau plays on');
      return notes;
    },
  },

  drop: {
    what: 'Playing a minute after it was turned on, its network drops for 15 s: shown waking, not away; plays on',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'up', ms: 12_000 }, { mode: 'hang', ms: 15_000 }]);
      const from = Date.now();
      await bench.play();
      await waitFor('playing', () => bench.playsOurs(), 10_000);
      await sleep(30_000);
      await waitFor('playing again', () => bench.playsOurs(), 20_000).catch(() => undefined);
      expect(notes, await steady(bench, 5000), 'plays on after the drop');
      expect(notes, bench.awayShown(from).length === 0, `never shown away (${bench.awayShown(from).length} states)`);
      expect(notes, bench.states(from).some(state => state.waking?.poweredOn && state.waking.unsteady), 'told its network comes and goes meanwhile');
      return notes;
    },
  },

  'plain-wiim': {
    what: 'The Bureau (no eISCP) off for 10 s as Play is pressed: told waiting, plays when it answers',
    run: async bench => {
      const notes: string[] = [];
      await bench.reset('standby');
      bench.wiim.setMode('hang');
      setTimeout(() => bench.wiim.setMode('up'), 10_000);
      const from = Date.now();
      bench.play(bench.bureau).catch(() => undefined);
      await waitFor('Bureau playing', () => bench.playsOurs(bench.wiim), 30_000)
        .then(ms => expect(notes, true, `plays ${(ms / 1000).toFixed(1)} s after Play`), () => expect(notes, false, 'Bureau plays'));
      const states = bench.states(from, bench.bureau);
      expect(notes, states.some(state => state.waking && !state.waking.poweredOn), 'told waiting for it');
      expect(notes, states.filter(state => state.status === 'unreachable' && !state.waking).length === 0, 'never shown away');
      return notes;
    },
  },
};

const main = async () => {
  const args = process.argv.slice(2);
  const hold = args.includes('--hold');
  const chosen = args.filter(arg => !arg.startsWith('--'));
  const names = chosen.length > 0 ? chosen : hold && args.includes('--only-hold') ? [] : Object.keys(scenarios);
  const bench = new Bench();
  let failed = 0;
  try {
    console.log(`Starting DexVault (data in ${bench.data}) with a fake Onkyo and a fake WiiM…`);
    await bench.start();
    console.log(`Up: API ${API}, Salon ${bench.salon}, Bureau ${bench.bureau}\n`);
    for (const name of names) {
      const scenario = scenarios[name];
      if (!scenario) throw new Error(`No scenario ${name}: ${Object.keys(scenarios).join(', ')}`);
      const began = Date.now();
      let notes: string[];
      try {
        notes = await scenario.run(bench);
      } catch (error) {
        notes = [`✗ ${(error as Error).message}`];
      }
      const bad = notes.filter(note => note.startsWith('✗')).length;
      failed += bad;
      console.log(`${bad ? '✗' : '✓'} ${name}: ${scenario.what} (${((Date.now() - began) / 1000).toFixed(0)} s)`);
      for (const note of notes) console.log(`    ${note}`);
      if (bad) {
        console.log('    the Onkyo was asked:');
        for (const entry of bench.onkyo.log.filter(one => one.at >= began)) console.log(`      +${((entry.at - began) / 1000).toFixed(1)} s ${entry.what}`);
      }
    }
    console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'}. Server log: ${bench.log}`);
    if (hold) {
      await bench.reset('standby');
      bench.onkyo.onWake([{ mode: 'up', ms: 1000 }, { mode: 'hang', ms: 6000 }, { mode: 'flaky', ms: 20_000 }]);
      console.log(`Holding: the API on ${API}, the Salon in standby, today's wake on PWR01. Ctrl-C to stop.`);
      await new Promise(resolve => process.once('SIGINT', resolve));
    }
  } finally {
    await bench.stop();
  }
  process.exit(failed ? 1 : 0);
};

main().catch(error => {
  console.error(error);
  process.exit(2);
});
