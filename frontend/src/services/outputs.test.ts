import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import outputs, { connectOutputs, knownOutputs, OutputError, outputHint, positionAt, resetOutputs, takeState, type Output, type OutputState } from './outputs';

const state = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album: { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null }, track: null,
  index: 0, count: 2, tracks: [{ songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }],
  status: 'playing', position: 10, duration: 186, at: 1_000_000, volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});

const salon = (changes: Partial<Output> = {}): Output => ({
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null, ...changes,
});

/** An EventSource the test opens, speaks through and breaks. */
class FakeSource {
  static made: FakeSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: { data: string }) => void>();
  constructor(public url: string) { FakeSource.made.push(this); }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, listener); }
  close() { this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(type: string, data: unknown) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
  fail() { this.readyState = 2; this.onerror?.(); }
}

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  FakeSource.made = [];
  vi.stubGlobal('EventSource', FakeSource);
  resetOutputs();
});

afterEach(() => {
  resetOutputs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('positionAt', () => {
  it('moves the hand on from where the server read it while it plays, never past the end', () => {
    const playing = state({ position: 10, at: 1_000_000, duration: 186 });
    expect(positionAt(playing, 1_000_000, 0)).toBe(10);
    expect(positionAt(playing, 1_004_500, 0)).toBeCloseTo(14.5);
    // The server's clock 2 s behind this one: the 2 s are not counted twice.
    expect(positionAt(playing, 1_004_500, 2_000)).toBeCloseTo(12.5);
    expect(positionAt(playing, 2_000_000, 0)).toBe(186);
  });

  it('stands still while paused, taken or away', () => {
    for (const status of ['paused', 'stopped', 'taken', 'unreachable'] as const) {
      expect(positionAt(state({ status, position: 42 }), 1_100_000, 0)).toBe(42);
    }
  });
});

describe('outputs', () => {
  it('reads the list and listens to it; nothing when UPnP is off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([]))));
    await connectOutputs();
    expect(FakeSource.made).toHaveLength(0);
    expect(knownOutputs()).toEqual([]);

    resetOutputs();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon()]))));
    await connectOutputs();
    expect(FakeSource.made).toHaveLength(1);
    expect(FakeSource.made[0].url).toBe('/api/outputs/events');
    expect(knownOutputs().map(output => output.name)).toEqual(['Salon']);
  });

  it('reads the list again later when the server did not answer as the app opened, then listens', async () => {
    vi.useFakeTimers();
    let up = false;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(up ? answer([salon()]) : answer({ error: 'Bad gateway' }, 502))));
    await connectOutputs();
    expect(FakeSource.made).toHaveLength(0);
    up = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSource.made).toHaveLength(1);
    expect(knownOutputs().map(output => output.name)).toEqual(['Salon']);
  });

  it('takes the list, the states and the departures as they come', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon()]))));
    await connectOutputs();
    const source = FakeSource.made[0];
    source.open();
    source.emit('outputs', [salon({ name: 'Living room' }), salon({ id: 'uuid:bureau', name: 'Bureau', reachable: false })]);
    expect(knownOutputs().map(output => [output.name, output.reachable])).toEqual([['Living room', true], ['Bureau', false]]);

    source.emit('state', state({ name: 'Living room', volume: 25 }));
    expect(knownOutputs()[0].session?.status).toBe('playing');
    expect(knownOutputs()[0].volume).toBe(25);

    // The same play told again keeps its album and tracks as they were: the bar's effects do not run again.
    const tracks = knownOutputs()[0].session!.tracks;
    source.emit('state', state({ name: 'Living room', position: 20 }));
    expect(knownOutputs()[0].session!.tracks).toBe(tracks);
    expect(knownOutputs()[0].session!.position).toBe(20);
  });

  it('opens a connection refused again, later each time, and one silent for 45 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon()]))));
    await connectOutputs();
    FakeSource.made[0].fail();
    vi.advanceTimersByTime(999);
    expect(FakeSource.made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.made).toHaveLength(2);
    FakeSource.made[1].fail();
    vi.advanceTimersByTime(2000);
    expect(FakeSource.made).toHaveLength(3);

    // Open, and the server's word every 20 s keeps it.
    const open = FakeSource.made[2];
    open.open();
    vi.advanceTimersByTime(20_000);
    open.emit('alive', 1);
    vi.advanceTimersByTime(30_000);
    expect(FakeSource.made).toHaveLength(3);
    // Then nothing for 45 s: a proxy holds it with nothing behind.
    vi.advanceTimersByTime(20_000);
    expect(FakeSource.made).toHaveLength(4);
    expect(open.readyState).toBe(2);
  });

  it('sends the commands and shows what they did at once', async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => Promise.resolve(
      url === '/api/outputs' ? answer([salon({ session: state({ status: 'paused' }) })]) : answer(state({ status: 'playing', index: 1 })),
    ));
    vi.stubGlobal('fetch', fetch);
    await outputs.list();
    await outputs.next('uuid:salon');
    expect(fetch).toHaveBeenLastCalledWith('/api/outputs/uuid%3Asalon/next', expect.objectContaining({ method: 'POST' }));
    expect(knownOutputs()[0].session?.index).toBe(1);

    await outputs.play('uuid:salon', { from: 'uuid:bureau' });
    expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toEqual({ from: 'uuid:bureau' });
    await outputs.volume('uuid:salon', { volume: 40 });
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('PUT');
  });

  it('says why a command was refused: away, taken', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer({ error: 'Salon does not answer: is it on?', status: 'unreachable' }, 503))));
    const refused = await outputs.toggle('uuid:salon').catch(error => error);
    expect(refused).toBeInstanceOf(OutputError);
    expect(refused).toMatchObject({ message: 'Salon does not answer: is it on?', status: 'unreachable', code: 503 });

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer({ error: 'Salon is playing something else', status: 'taken' }, 409))));
    expect(await outputs.next('uuid:salon').catch(error => error)).toMatchObject({ status: 'taken', code: 409 });
  });

  it('opens the connection again at once when the page comes back in sight after it dropped', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon()]))));
    await connectOutputs();
    const first = FakeSource.made[0];
    first.open();
    // An iPhone asleep: the connection gone, the next try still far off.
    first.fail();
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeSource.made).toHaveLength(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeSource.made).toHaveLength(2);
    // The try that was waiting is not made as well.
    vi.advanceTimersByTime(5_000);
    expect(FakeSource.made).toHaveLength(2);

    // Back in sight with a connection open and heard: kept as it is.
    FakeSource.made[1].open();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeSource.made).toHaveLength(2);
  });

  it('takes the list told again on a new connection, what changed meanwhile included', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon({ session: state() })]))));
    await connectOutputs();
    FakeSource.made[0].fail();
    vi.advanceTimersByTime(1000);
    const again = FakeSource.made[1];
    again.open();
    again.emit('outputs', [salon({ session: state({ status: 'paused', position: 77 }) })]);
    expect(knownOutputs()[0].session).toMatchObject({ status: 'paused', position: 77 });
  });

  it('moves the hand on between two states, from the later one once it comes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer([salon()]))));
    await outputs.list();
    const now = 5_000_000;
    // The server's clock 300 ms behind, the time a state takes included.
    takeState(state({ position: 10, at: now - 300 }), now);
    expect(positionAt(knownOutputs()[0].session!, now + 2_000)).toBeCloseTo(12);
    // The next poll: the place it read is the one the hand goes on from.
    takeState(state({ position: 13, at: now + 2_700 }), now + 3_000);
    expect(positionAt(knownOutputs()[0].session!, now + 3_000)).toBeCloseTo(13);
    expect(positionAt(knownOutputs()[0].session!, now + 4_500)).toBeCloseTo(14.5);
    // Paused there: the hand stands where the server read it.
    takeState(state({ status: 'paused', position: 15, at: now + 4_700 }), now + 5_000);
    expect(positionAt(knownOutputs()[0].session!, now + 9_000)).toBe(15);
  });

  it('takes back what a toggle showed at once when the command fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      url === '/api/outputs' ? answer([salon({ session: state({ status: 'playing' }) })]) : answer({ error: 'The appliance refused it' }, 502),
    )));
    await outputs.list();
    const refused = outputs.toggle('uuid:salon', false).catch(error => error);
    // Shown paused at once…
    expect(knownOutputs()[0].session?.status).toBe('paused');
    expect(await refused).toBeInstanceOf(OutputError);
    // …and playing again once refused, as it still is.
    expect(knownOutputs()[0].session?.status).toBe('playing');
  });

  it('keeps a state the server told while the toggle was on its way, refused or not', async () => {
    let answerToggle: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/outputs'
      ? Promise.resolve(answer([salon({ session: state({ status: 'playing' }) })]))
      : new Promise<Response>(resolve => { answerToggle = resolve; }))));
    await outputs.list();
    const refused = outputs.toggle('uuid:salon', false).catch(error => error);
    takeState(state({ status: 'paused', position: 50 }));
    answerToggle(answer({ error: 'Too late' }, 502));
    await refused;
    expect(knownOutputs()[0].session).toMatchObject({ status: 'paused', position: 50 });
  });

  it('takes back a volume shown at once when the appliance refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      url === '/api/outputs' ? answer([salon({ volume: 30 })]) : answer({ error: 'Salon does not answer: is it on?', status: 'unreachable' }, 503),
    )));
    await outputs.list();
    const refused = outputs.volume('uuid:salon', { volume: 45 }).catch(error => error);
    expect(knownOutputs()[0].volume).toBe(45);
    expect(await refused).toMatchObject({ status: 'unreachable' });
    expect(knownOutputs()[0].volume).toBe(30);
  });

  it('a state for an output not listed is let go', () => {
    takeState(state({ id: 'uuid:nowhere' }));
    expect(knownOutputs()).toEqual([]);
  });

  it('names what an output is doing in a menu', () => {
    expect(outputHint(salon())).toBe('TX-RZ70');
    expect(outputHint(salon({ session: state() }))).toBe('TX-RZ70 · playing');
    expect(outputHint(salon({ session: state({ status: 'taken' }) }))).toBe('in use');
    expect(outputHint(salon({ reachable: false }))).toBe('away');
  });
});
