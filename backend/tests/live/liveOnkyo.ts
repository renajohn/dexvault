import net from 'net';
import type http from 'http';
import { FakeRenderer } from '../music/upnp/fakeRenderer';
import { messagesOf, packet, ISCP_PORT } from '../../src/services/upnp/iscp';

/**
 * The Onkyo as it behaved on 02.11.2026, live and in real time, for the
 * live bench (salon-wake.live.ts): its UPnP side (the recorded description
 * and SOAP of FakeRenderer) and its eISCP side on 127.0.0.1:60128.
 *
 * In standby it answers UPnP, as the real one did. Turned on (PWR01), it
 * follows a script of network phases: `up` answers, `hang` takes the
 * connection and never answers (the timeouts seen in the logs), `flaky`
 * answers one request in two. Its time moves on by itself while it plays.
 */

export type NetworkMode = 'up' | 'hang' | 'flaky';
export interface Phase { mode: NetworkMode; ms: number }

export interface Noted { at: number; what: string }

export class LiveOnkyo {
  readonly upnp: FakeRenderer;
  power: 'on' | 'standby' = 'standby';
  input = '2B';
  mode: NetworkMode = 'up';
  /** What it was asked, eISCP and SOAP, with when. */
  log: Noted[] = [];
  /** A drop of its network stops what it plays, as the Onkyo's did; the WiiM's not known. */
  dropStops = true;
  /** ⏸ refused (701) until then, as while it starts a track. */
  refusePauseUntil = 0;
  /** Description reads and SOAP calls under way at once, at most. */
  maxReads = 0;
  maxSoap = 0;
  private reads = 0;
  private soap = 0;
  private flip = false;
  private script: Phase[] = [];
  private scriptTimer: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private iscp: net.Server | null = null;
  private hung = new Set<http.ServerResponse>();
  private t0 = Date.now();

  constructor(kind: 'onkyo' | 'wiim' = 'onkyo') {
    this.upnp = new FakeRenderer(kind);
  }

  /** Seconds since the bench began, for the log. */
  now(): number { return (Date.now() - this.t0) / 1000; }

  note(what: string): void { this.log.push({ at: Date.now(), what }); }

  async start({ iscp = true }: { iscp?: boolean } = {}): Promise<this> {
    await this.upnp.start();
    const fake = this.upnp as unknown as { handle: (req: http.IncomingMessage, res: http.ServerResponse) => void };
    const original = fake.handle.bind(this.upnp);
    fake.handle = (req, res) => this.handle(req, res, original);
    // Its time, in real time: a quarter of a second at a time.
    this.ticker = setInterval(() => this.upnp.advance(0.25), 250);
    if (iscp) {
      this.iscp = net.createServer(socket => this.talk(socket));
      await new Promise<void>((resolve, reject) => {
        this.iscp!.once('error', reject);
        this.iscp!.listen(ISCP_PORT, '127.0.0.1', () => resolve());
      });
    }
    return this;
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    if (this.scriptTimer) clearTimeout(this.scriptTimer);
    for (const res of this.hung) res.destroy();
    await this.upnp.stop();
    if (this.iscp) await new Promise<void>(resolve => this.iscp!.close(() => resolve()));
  }

  /** As at the start of a scenario: in standby, on NET, nothing of ours, the network up. */
  reset(power: 'on' | 'standby' = 'standby', input = '2B'): void {
    if (this.scriptTimer) clearTimeout(this.scriptTimer);
    for (const res of this.hung) res.destroy();
    this.hung.clear();
    this.power = power;
    this.input = input;
    this.mode = 'up';
    this.script = [];
    this.refusePauseUntil = 0;
    Object.assign(this.upnp, { state: 'NO_MEDIA_PRESENT', uri: '', nextUri: '', position: 0, calls: [] });
    this.log = [];
    this.maxReads = 0;
    this.maxSoap = 0;
  }

  /** What its network does once it is turned on, phase after phase; `up` after the last. */
  onWake(script: Phase[]): void {
    this.script = script;
  }

  private runScript(phases: Phase[]): void {
    if (this.scriptTimer) clearTimeout(this.scriptTimer);
    const [phase, ...rest] = phases;
    if (!phase) {
      this.setMode('up');
      return;
    }
    this.setMode(phase.mode);
    this.scriptTimer = setTimeout(() => this.runScript(rest), phase.ms);
  }

  setMode(mode: NetworkMode): void {
    if (this.mode !== mode) this.note(`network ${mode}`);
    // Its network restarting stops what it plays, our track kept, stopped (seen on 26.10.2026).
    if (mode !== 'up' && this.mode === 'up' && this.dropStops && this.upnp.state === 'PLAYING') {
      this.upnp.state = 'STOPPED';
      this.note('playback stopped by the drop');
    }
    this.mode = mode;
    if (mode !== 'hang') {
      // Back: what hung is dropped, as the Onkyo's stack restarting.
      for (const res of this.hung) res.destroy();
      this.hung.clear();
    }
  }

  /** The SOAP actions it was asked since `from` (ms), Get* left out unless `all`. */
  soapSince(from: number, all = false): string[] {
    return this.log.filter(entry => entry.at >= from && entry.what.startsWith('SOAP ') && (all || !/^SOAP Get/.test(entry.what)))
      .map(entry => entry.what.slice(5));
  }

  iscpSince(from: number): string[] {
    return this.log.filter(entry => entry.at >= from && entry.what.startsWith('ISCP ')).map(entry => entry.what.slice(5));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, original: (req: http.IncomingMessage, res: http.ServerResponse) => void): void {
    const soap = req.method === 'POST';
    const action = String(req.headers.soapaction || '').replace(/"/g, '').split('#')[1] || req.url || '';
    const answers = this.mode === 'up' || (this.mode === 'flaky' && (this.flip = !this.flip));
    if (!answers) {
      // Taken and never answered: the client's own timeout ends it.
      this.note(`${soap ? 'SOAP' : 'GET'} ${action} (no answer)`);
      this.hung.add(res);
      res.on('close', () => this.hung.delete(res));
      return;
    }
    if (soap) {
      this.note(`SOAP ${action}`);
      if (action === 'Pause' && Date.now() < this.refusePauseUntil) {
        this.upnp.refuse.set('Pause', 701);
        res.on('close', () => this.upnp.refuse.delete('Pause'));
      }
    }
    const counter = soap ? 'soap' : 'reads';
    this[counter]++;
    if (soap) this.maxSoap = Math.max(this.maxSoap, this.soap);
    else this.maxReads = Math.max(this.maxReads, this.reads);
    res.on('close', () => { this[counter]--; });
    original(req, res);
  }

  /** eISCP: what the TX-RZ70 answered, its chatter included. */
  private talk(socket: net.Socket): void {
    let pending = Buffer.alloc(0);
    socket.on('error', () => undefined);
    socket.on('data', (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      const commands = messagesOf(pending);
      let at = 0;
      for (let n = 0; n < commands.length; n++) at += pending.readUInt32BE(at + 4) + pending.readUInt32BE(at + 8);
      pending = pending.subarray(at);
      for (const command of commands) {
        this.note(`ISCP ${command}`);
        // Its chatter first, as it plays.
        if (this.power === 'on') socket.write(packet('NLSC-P'));
        if (command === 'PWRQSTN') socket.write(packet(`PWR${this.power === 'on' ? '01' : '00'}`));
        else if (command === 'SLIQSTN') socket.write(packet(this.power === 'on' ? `SLI${this.input}` : 'SLIN/A'));
        else if (command === 'PWR01') {
          const was = this.power;
          this.power = 'on';
          socket.write(packet('PWR01'));
          if (was === 'standby') this.runScript(this.script);
        } else if (command === 'PWR00') {
          this.power = 'standby';
          // In standby it plays nothing.
          if (this.upnp.state === 'PLAYING') this.upnp.state = 'STOPPED';
          socket.write(packet('PWR00'));
        } else if (command.startsWith('SLI')) {
          if (this.power === 'on') {
            this.input = command.slice(3).toUpperCase();
            socket.write(packet(`SLI${this.input}`));
          }
        }
      }
    });
  }
}
