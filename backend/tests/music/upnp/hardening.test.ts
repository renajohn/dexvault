import { Poller } from '../../../src/services/upnp/poller';
import type { OutputSession } from '../../../src/services/upnp/session';
import { albumOf, rig, tracksOf, type Rig } from './helpers';

/** What phase 4 found wrong in the sessions and their poller, each kept from coming back. */

let r: Rig;
afterEach(async () => { await r?.close(); });

describe('one SOAP call at a time', () => {
  beforeEach(async () => { r = await rig('onkyo'); });

  it('reads the volume in turn with the commands, never alongside one', async () => {
    r.fake.latencyMs = 30;
    // The registry reads the volume of an appliance it finds again while a page sends a command.
    await Promise.all([r.session.playAlbum(albumOf(7), tracksOf(7), 0), r.session.readVolume(), r.session.readVolume()]);
    await r.session.idle();
    expect(r.fake.maxInFlight).toBe(1);
    expect(r.session.state().volume).toBe(57);
  });
});

describe('the volume read', () => {
  beforeEach(async () => { r = await rig('wiim'); });

  it('is told to the pages when it changed, as the volume a command sets is', async () => {
    await r.session.readVolume();
    expect(r.events.filter(([event]) => event === 'state')).toEqual([['state', expect.objectContaining({ volume: 100, muted: false })]]);
    // The same again: nothing to tell.
    await r.session.readVolume();
    expect(r.events.filter(([event]) => event === 'state')).toHaveLength(1);
  });
});

describe('a session stopped by hand', () => {
  beforeEach(async () => { r = await rig('wiim'); });

  it('stays stopped when the appliance is switched off and on again, not “playing something else”', async () => {
    await r.session.playAlbum(albumOf(7), tracksOf(7), 1);
    await r.playFor(20);
    await r.session.stop();
    r.fake.down = true;
    // The registry reads its volume every minute while nothing plays.
    for (let i = 0; i < 4; i++) await r.session.readVolume().catch(() => undefined);
    expect(r.session.state()).toMatchObject({ status: 'stopped', index: 1 });
    expect(r.session.pollDelay()).toBeNull();
    r.fake.down = false;
    r.fake.uri = '';
    r.fake.state = 'NO_MEDIA_PRESENT';
    await r.session.readVolume();
    expect(r.session.state()).toMatchObject({ status: 'stopped', index: 1 });
  });
});

describe('the poller', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('asks nothing more once stopped, even when stopped during a question', async () => {
    jest.useFakeTimers();
    let answer: () => void = () => undefined;
    const ticks: number[] = [];
    const session = {
      pollDelay: () => 1000,
      tick: () => new Promise<void>(resolve => { ticks.push(Date.now()); answer = resolve; }),
    } as unknown as OutputSession;
    const poller = new Poller(session);
    poller.wake();
    jest.advanceTimersByTime(1000);
    expect(ticks).toHaveLength(1);
    // Shut down while the appliance is being asked.
    poller.stop();
    answer();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    expect(ticks).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
