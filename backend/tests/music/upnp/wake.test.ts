import net from 'net';
import type { AddressInfo } from 'net';
import { OutputTakenError, OutputUnreachableError, type OutputState } from '../../../src/services/upnp/session';
import { Iscp, inputName, messagesOf, packet, type PowerControl, type PowerStatus } from '../../../src/services/upnp/iscp';
import { RendererRegistry } from '../../../src/services/upnp/renderers';
import { albumOf, rig, tracksOf, urlOf, type Rig } from './helpers';

/**
 * A play on a receiver in standby (the Salon, 02.11.2026): turned on to NET
 * by eISCP, waited for, every step told to the pages; given up, back to
 * standby; on the TV, left alone until Resume. And ⏸ refused while the
 * Onkyo starts our track (701), asked again rather than forgotten.
 */

/** The receiver's eISCP, as a session sees it: what it was asked, noted. */
class FakePower implements PowerControl {
  power: PowerStatus['power'] = 'standby';
  input = '2B';
  calls: string[] = [];
  /** Does not answer on eISCP: played to by UPnP alone, as before. */
  silent = false;
  /** What turning it on does to its UPnP side. */
  onTurnOn: () => void = () => undefined;

  async status(): Promise<PowerStatus | null> {
    this.calls.push('status');
    return this.silent ? null : { power: this.power, input: this.power === 'on' ? this.input : null };
  }

  async turnOn(): Promise<void> {
    this.calls.push('turnOn');
    this.power = 'on';
    this.input = '2B';
    this.onTurnOn();
  }

  async selectNet(): Promise<void> {
    this.calls.push('selectNet');
    this.input = '2B';
  }

  async standby(): Promise<void> {
    this.calls.push('standby');
    this.power = 'standby';
  }
}

let r: Rig;
let power: FakePower;
afterEach(async () => { await r?.close(); });

const stateOf = (rig: Rig): OutputState => rig.session.state();
const wakingOf = (rig: Rig) => stateOf(rig).waking;
/** The `waking` the pages were told, in order. */
const stepsTold = (rig: Rig): Array<string | null> => rig.events
  .filter(([event]) => event === 'state')
  .map(([, payload]) => (payload as OutputState).waking?.step ?? null);

describe('a receiver in standby, turned on for a play', () => {
  beforeEach(async () => {
    power = new FakePower();
    r = await rig('onkyo', { deps: { power: () => power } });
  });

  it('is turned on to NET before the track is given, the pages told each step, then plays', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    expect(power.calls).toEqual(['status', 'turnOn']);
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', waking: null });
    expect(stepsTold(r)).toEqual(expect.arrayContaining(['on', 'starting']));
    expect(stepsTold(r).indexOf('on')).toBeLessThan(stepsTold(r).indexOf('starting'));
  });

  it('waits up to five minutes for its network, asked every 2 s, shown waking and not away', async () => {
    power.onTurnOn = () => { r.fake.down = true; };
    await expect(r.session.playAlbum(albumOf(7), tracksOf(7), 0)).rejects.toBeInstanceOf(OutputUnreachableError);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', wanted: true, waking: { step: 'network', poweredOn: true, unsteady: false } });
    expect(r.session.pollDelay()).toBe(2000);
    // Three minutes on, past the two a plain play waits: still waited for.
    r.fake.advance(3 * 60);
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ wanted: true, waking: { step: 'network' } });
    r.fake.down = false;
    await r.session.tick();
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', waking: null });
  });

  it('says its network comes and goes when it answered, then did not again', async () => {
    power.onTurnOn = () => { r.fake.down = true; };
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0).catch(() => undefined);
    r.fake.down = false;
    r.fake.refuse.set('SetAVTransportURI', 501);
    await r.session.tick().catch(() => undefined);
    r.fake.refuse.delete('SetAVTransportURI');
    r.fake.down = true;
    await r.session.tick();
    expect(wakingOf(r)).toMatchObject({ unsteady: true });
  });

  it('is shown waking again, not away, when its network drops in the minutes after it was turned on', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(20);
    r.fake.down = true;
    await r.playFor(3);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', waking: { step: 'network', poweredOn: true, unsteady: true } });
    r.fake.down = false;
    await r.playFor(1);
    expect(stateOf(r)).toMatchObject({ status: 'playing', waking: null });
    // Settled after two minutes: a drop then is the plain one.
    await r.playFor(150, 10);
    r.fake.down = true;
    await r.playFor(3);
    expect(stateOf(r)).toMatchObject({ status: 'unreachable', waking: { poweredOn: false } });
  });

  it('gives the track again where it was when its network drops and stops it, minutes after it was turned on', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(20);
    // Its network restarts: our track kept, stopped (the Onkyo, 26.10 and 02.11.2026). It answered all along.
    r.fake.state = 'STOPPED';
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).toEqual(['SetAVTransportURI', 'Play', 'Seek', 'SetNextAVTransportURI']);
    expect(r.fake.of('Seek')[0].args.Target).toBe('0:00:20');
    expect(stateOf(r)).toMatchObject({ status: 'playing', index: 0 });
  });

  it('gives it again too when its network drops and comes back with nothing of ours', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(10);
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.session.tick();
    expect(r.fake.uri).toBe(urlOf('a7t1'));
    expect(stateOf(r).status).toBe('playing');
  });

  it('gives up after five minutes, saying so, and plays nothing when it answers later', async () => {
    power.onTurnOn = () => { r.fake.down = true; };
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0).catch(() => undefined);
    r.fake.advance(5 * 60 + 1);
    await r.session.tick();
    expect(stateOf(r)).toMatchObject({ wanted: false, waking: null, error: expect.stringContaining('did not answer') });
    r.fake.down = false;
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).not.toContain('SetAVTransportURI');
  });

  it('goes back to standby when ⏸ gives the play up before it sounded', async () => {
    power.onTurnOn = () => { r.fake.down = true; };
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0).catch(() => undefined);
    // The bar's ring is ⏯ with no word: ⏸ while on its way.
    await r.session.toggle();
    expect(power.calls).toContain('standby');
    expect(stateOf(r)).toMatchObject({ wanted: false, waking: null });
    r.fake.down = false;
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).not.toContain('SetAVTransportURI');
  });

  it('goes back to standby when the play is listened to elsewhere before it sounded', async () => {
    power.onTurnOn = () => { r.fake.down = true; };
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0).catch(() => undefined);
    await r.session.pauseForTransfer();
    expect(power.calls).toContain('standby');
    expect(r.session.handOver()).toMatchObject({ album: { id: 7 }, index: 0 });
  });

  it('stays on when the play is paused after it sounded', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(5);
    await r.session.toggle(false);
    expect(power.calls).not.toContain('standby');
    expect(stateOf(r).status).toBe('paused');
  });

  it('is played to by UPnP alone when it does not answer on eISCP', async () => {
    power.silent = true;
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    expect(power.calls).toEqual(['status']);
    expect(stateOf(r).status).toBe('playing');
  });
});

describe('a receiver on another input', () => {
  beforeEach(async () => {
    power = new FakePower();
    power.power = 'on';
    power.input = '12';
    r = await rig('onkyo', { deps: { power: () => power } });
  });

  it('is left alone: taken, its input said, nothing given; Resume puts it on NET and plays', async () => {
    r.fake.calls = [];
    const play = r.session.playAlbum(albumOf(7), tracksOf(7), 2);
    await expect(play).rejects.toBeInstanceOf(OutputTakenError);
    await expect(play).rejects.toThrow('is on TV');
    expect(r.fake.commands()).toEqual([]);
    expect(stateOf(r)).toMatchObject({ status: 'taken', input: 'TV', album: { id: 7 }, index: 2, waking: null });

    await r.session.resume();
    expect(power.calls).toContain('selectNet');
    expect(r.fake.uri).toBe(urlOf('a7t3'));
    expect(stateOf(r)).toMatchObject({ status: 'playing', input: null });
  });
});

describe('a stop read after calls unanswered, on an appliance not turned on by DexVault', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('is its network dropping: the track given again where it was', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(30);
    r.fake.down = true;
    await r.session.tick();
    r.fake.down = false;
    r.fake.state = 'STOPPED';
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).toContain('SetAVTransportURI');
    expect(stateOf(r).status).toBe('playing');
  });

  it('is a hand on its remote when every call was answered: paused there', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(30);
    r.fake.state = 'STOPPED';
    r.fake.calls = [];
    await r.session.tick();
    expect(r.fake.commands()).toEqual([]);
    expect(stateOf(r).status).toBe('paused');
  });
});

describe('a play on its way on an appliance with no eISCP (the WiiM)', () => {
  beforeEach(async () => { r = await rig('wiim'); });

  it('is shown starting, then waiting for its network, two minutes as before', async () => {
    r.fake.down = true;
    await expect(r.session.playAlbum(albumOf(7), tracksOf(7), 0)).rejects.toBeInstanceOf(OutputUnreachableError);
    expect(stepsTold(r)).toContain('starting');
    expect(stateOf(r)).toMatchObject({ waking: { step: 'network', poweredOn: false } });
    expect(r.session.pollDelay()).toBe(5000);
    r.fake.advance(3 * 60);
    expect(stateOf(r).wanted).toBe(false);
  });

  it('shows nothing on its way while it plays, nor for a track changed as it plays', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    r.events.length = 0;
    await r.session.next();
    expect(stepsTold(r).every(step => step == null)).toBe(true);
  });
});

describe('⏸ refused while the Onkyo is between two tracks (701)', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('is asked again until it is taken', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(5);
    let refusals = 2;
    const original = r.fake.refuse;
    r.fake.refuse = new Proxy(original, {
      get(target, key) {
        if (key === 'get') return (action: string) => (action === 'Pause' && refusals-- > 0 ? 701 : target.get(action));
        if (key === 'has') return (action: string) => (action === 'Pause' && refusals > 0) || target.has(action);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await r.session.toggle(false);
    expect(r.fake.state).toBe('PAUSED_PLAYBACK');
    expect(stateOf(r).status).toBe('paused');
  });

  it('still refused after three seconds, is asked again at the next poll rather than forgotten', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
    await r.playFor(5);
    r.fake.refuse.set('Pause', 701);
    await r.session.toggle(false);
    expect(r.fake.state).toBe('PLAYING');
    expect(r.session.pollDelay()).toBe(5000);
    r.fake.refuse.delete('Pause');
    await r.session.tick();
    expect(r.fake.state).toBe('PAUSED_PLAYBACK');
    expect(stateOf(r).status).toBe('paused');
  });
});

describe('the list of appliances', () => {
  it('reads an appliance once at a time: the minute’s read and a session’s together make one', async () => {
    let reads = 0;
    let release: () => void = () => undefined;
    const registry = new RendererRegistry({
      locations: ['http://192.168.86.55:8888/upnp_descriptor_0'],
      load: () => {
        reads++;
        return reads === 1 ? new Promise((_, reject) => { release = () => reject(new Error('no')); }) : Promise.reject(new Error('no'));
      },
    });
    const entry = registry.entries[0];
    const both = Promise.all([registry.refresh(entry), registry.refresh(entry)]);
    release();
    await both;
    expect(reads).toBe(1);
    await registry.refresh(entry).catch(() => undefined);
    expect(reads).toBe(2);
  });
});

describe('eISCP', () => {
  /** A receiver on a local port: answers PWRQSTN, SLIQSTN, PWR01/00 and SLIxx as the TX-RZ70 did, among its chatter. */
  const receiver = async (state: { power: string; input: string }) => {
    const heard: string[] = [];
    const server = net.createServer(socket => {
      // Commands read whole: two sent together may come in pieces.
      let pending = Buffer.alloc(0);
      // DexVault hangs up once it has heard enough, as the receiver may still be talking.
      socket.on('error', () => undefined);
      socket.on('data', (data: Buffer) => {
        pending = Buffer.concat([pending, data]);
        const commands = messagesOf(pending);
        let at = 0;
        for (let n = 0; n < commands.length; n++) at += pending.readUInt32BE(at + 4) + pending.readUInt32BE(at + 8);
        pending = pending.subarray(at);
        for (const command of commands) {
          heard.push(command);
          // Its chatter first, as it plays: the time, the display.
          socket.write(packet('NTM00:07:32/00:14:48'));
          if (command === 'PWRQSTN') socket.write(packet(`PWR${state.power}`));
          if (command === 'SLIQSTN') socket.write(packet(state.power === '01' ? `SLI${state.input}` : 'SLIN/A'));
          if (command.startsWith('PWR0')) { state.power = command.slice(3); socket.write(packet(`PWR${state.power}`)); }
          if (command.startsWith('SLI') && command !== 'SLIQSTN') { state.input = command.slice(3); socket.write(packet(`SLI${state.input}`)); }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { heard, port: (server.address() as AddressInfo).port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
  };

  it('tells standby, turns the receiver on to NET, and back to standby', async () => {
    const state = { power: '00', input: '12' };
    const fake = await receiver(state);
    try {
      const iscp = new Iscp('127.0.0.1', fake.port);
      expect(await iscp.status()).toEqual({ power: 'standby', input: null });
      await iscp.turnOn();
      expect(await iscp.status()).toEqual({ power: 'on', input: '2B' });
      expect(fake.heard).toEqual(expect.arrayContaining(['PWR01', 'SLI2B']));
      await iscp.standby();
      expect(state.power).toBe('00');
    } finally {
      await fake.close();
    }
  });

  it('answers null when nothing listens', async () => {
    const closed = await receiver({ power: '00', input: '2B' });
    await closed.close();
    expect(await new Iscp('127.0.0.1', closed.port).status()).toBeNull();
  });

  it('names the inputs as the front panel does', () => {
    expect(inputName('12')).toBe('TV');
    expect(inputName('2b')).toBe('NET');
    expect(inputName('99')).toBe('input 99');
    expect(inputName(null)).toBeNull();
  });
});
