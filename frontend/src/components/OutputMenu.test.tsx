import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OutputMenu, { throttled } from './OutputMenu';
import outputs, { resetOutputs, type Output, type OutputState } from '../services/outputs';
import { player, resetPlayer } from '../services/player';

const session = (changes: Partial<OutputState> = {}): OutputState => ({
  id: 'uuid:salon', name: 'Salon', album: { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null }, track: null,
  index: 0, count: 1, tracks: [{ songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 }],
  status: 'paused', position: 10, duration: 186, at: Date.now(), volume: 30, muted: false, queue: null, upcoming: [], error: null,
  ...changes,
});

const listed = (changes: Partial<Output> = {}): Output => ({
  id: 'uuid:salon', name: 'Salon', deviceName: 'Salon', model: 'TX-RZ70', manufacturer: 'ONKYO', reachable: true, gapless: true,
  volume: 30, muted: false, maxVolume: 70, session: null, ...changes,
});

const house = (): Output[] => [
  listed(),
  listed({ id: 'uuid:bureau', name: 'Bureau', deviceName: 'Bureau', model: 'WiiM Mini Receiver', reachable: false, volume: null }),
];

let fetched: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(async () => {
  fetched = [];
  // A computer, with a pointer.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('hover'), addEventListener() {}, removeEventListener() {} }));
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    fetched.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
    if (url === '/api/outputs') return Promise.resolve(new Response(JSON.stringify(house())));
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return Promise.resolve(new Response(JSON.stringify(session({ volume: body.volume ?? 30, muted: body.muted ?? false }))));
  }));
  resetOutputs();
  resetPlayer();
  await outputs.list();
});

afterEach(async () => {
  // What the commands answered, taken before the page goes.
  await act(async () => { await Promise.resolve(); });
  act(() => { resetOutputs(); resetPlayer(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = () => fireEvent.click(screen.getByRole('button', { name: /^Output/ }));

describe('OutputMenu', () => {
  it('lists this computer and the appliances, the one playing on with the ✓, one away greyed', () => {
    render(<OutputMenu />);
    open();
    const here = screen.getByRole('menuitemradio', { name: /This computer/ });
    expect(here).toHaveAttribute('aria-checked', 'true');
    const salon = screen.getByRole('menuitemradio', { name: /Salon/ });
    expect(salon).toHaveAttribute('aria-checked', 'false');
    expect(salon).toHaveTextContent('TX-RZ70');
    const bureau = screen.getByRole('menuitemradio', { name: /Bureau/ });
    expect(bureau).toBeDisabled();
    expect(bureau).toHaveTextContent('away');
    // No volume for this computer: the Mac's own.
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull();
  });

  it('chooses how this browser plays the files, an appliance always lossless with no such choice', () => {
    render(<OutputMenu />);
    open();
    expect(screen.getByRole('menuitemradio', { name: /^Auto/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /AAC 256/ }));
    expect(player.getState().quality).toBe('light');

    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Salon/ }));
    open();
    expect(screen.queryByRole('menuitemradio', { name: /AAC 256/ })).toBeNull();
    expect(screen.queryByRole('menuitemradio', { name: /Lossless/ })).toBeNull();
  });

  it('plays on an appliance once chosen: the ✓ there, its volume under it', () => {
    render(<OutputMenu />);
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Salon/ }));
    expect(player.getState().output).toEqual({ kind: 'renderer', id: 'uuid:salon', name: 'Salon' });
    expect(screen.getByRole('button', { name: 'Output: Salon' })).toHaveAttribute('aria-pressed', 'true');
    open();
    expect(screen.getByRole('menuitemradio', { name: /Salon/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('max', '70');
    expect(screen.getByRole('menuitem', { name: 'Output settings…' })).toBeInTheDocument();
  });

  it('says an appliance playing something else is in use', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify([listed({ session: session({ status: 'taken' }) })])))));
    await outputs.list();
    render(<OutputMenu />);
    open();
    expect(screen.getByRole('menuitemradio', { name: /Salon/ })).toHaveTextContent('in use');
  });

  it('never sends a volume above the ceiling, nor a burst of them while the slider is dragged', () => {
    player.setOutput({ kind: 'renderer', id: 'uuid:salon', name: 'Salon' });
    render(<OutputMenu />);
    open();
    const slider = screen.getByRole('slider', { name: 'Volume' });
    for (let volume = 31; volume <= 60; volume++) fireEvent.change(slider, { target: { value: String(volume) } });
    const sent = () => fetched.filter(call => call.url.endsWith('/volume'));
    // The first at once, the rest held while it moves.
    expect(sent()).toHaveLength(1);
    fireEvent.pointerUp(slider);
    expect(sent()).toHaveLength(2);
    expect(sent().at(-1)!.body).toEqual({ volume: 60 });

    // As far as it goes: the ceiling, and + no further.
    fireEvent.change(slider, { target: { value: '95' } });
    fireEvent.pointerUp(slider);
    expect(sent().every(call => (call.body as { volume?: number }).volume! <= 70)).toBe(true);
    expect(screen.getByRole('button', { name: 'Volume up' })).toBeDisabled();
  });

  it('steps the volume by one with − and +, and mutes', async () => {
    player.setOutput({ kind: 'renderer', id: 'uuid:salon', name: 'Salon' });
    render(<OutputMenu />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Volume down' }));
    expect(fetched.at(-1)).toMatchObject({ method: 'PUT', body: { volume: 29 } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(fetched.at(-1)).toMatchObject({ method: 'PUT', body: { muted: true } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sound on' })).toBeInTheDocument());
  });

  it('is not there when the house has no appliance', async () => {
    act(() => resetOutputs());
    const { container } = render(<OutputMenu />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('throttled', () => {
  it('sends the first at once, the last always, the rest dropped', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const volume = throttled<number>(send, 400);
    volume.push(1);
    volume.push(2);
    volume.push(3);
    expect(send.mock.calls).toEqual([[1]]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(send.mock.calls).toEqual([[1], [3]]);
    volume.push(4);
    volume.flush();
    expect(send.mock.calls).toEqual([[1], [3], [4]]);
    volume.flush();
    expect(send).toHaveBeenCalledTimes(3);
  });
});
