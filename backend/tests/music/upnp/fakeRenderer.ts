import http from 'http';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
import { flatXml, secondsOf } from '../../../src/services/upnp/soap';

/**
 * A fake appliance, on a local port: the Onkyo's, the WiiM's or the
 * Panasonic's description and SCPD as recorded, and SOAP answered from a
 * small machine (NO_MEDIA_PRESENT → PLAYING → PAUSED_PLAYBACK → STOPPED)
 * whose position moves on a clock of its own. It can follow on to the next
 * track (SetNextAVTransportURI) or not, be taken by another input, and go
 * silent. Nothing ever reaches the real appliances.
 */

export type Kind = 'onkyo' | 'wiim' | 'panasonic';

const FIXTURES = path.join(__dirname, 'fixtures');

/** Where each one serves its description, as recorded. */
const DESCRIPTIONS: Record<Kind, { path: string; file: string; recordedBase: string }> = {
  onkyo: { path: '/upnp_descriptor_0', file: 'onkyo/description.xml', recordedBase: 'http://192.168.86.47:8888' },
  wiim: { path: '/description.xml', file: 'wiim/description.xml', recordedBase: 'http://192.168.86.20:49152' },
  panasonic: { path: '/FFFFFFFFFFFF/Server0/ddd', file: 'panasonic/ddd.xml', recordedBase: 'http://192.168.86.22:60606' },
};
const SCPDS: Record<string, string> = {
  '/xml/AVTransport2.xml': 'onkyo/AVTransport2.xml',
  '/upnp/rendertransportSCPD.xml': 'wiim/rendertransportSCPD.xml',
  '/Server0/AVT_SCPD': 'panasonic/AVT_SCPD.xml',
};

/** What the appliances answered at rest, recorded on 25.10.2026 (annex A.6 of the design). */
const AT_REST = new Set(['GetTransportInfo', 'GetPositionInfo', 'GetVolume', 'GetMute']);

const read = (file: string): string => fs.readFileSync(path.join(FIXTURES, file), 'utf8');

export interface Call {
  action: string;
  args: Record<string, string>;
}

export class FakeRenderer {
  kind: Kind;
  base = '';
  calls: Call[] = [];
  state = 'NO_MEDIA_PRESENT';
  uri = '';
  nextUri = '';
  position = 0;
  volume: number;
  muted = false;
  /** No answer at all: the connection dropped, as an appliance switched off. */
  down = false;
  /** The next this many commands go unanswered, as a slow Onkyo between two tracks; the rest answered. */
  dropNext = 0;
  /** Addresses it refuses as a format it cannot play (714). */
  unplayable = new Set<string>();
  /** Actions refused with a UPnP error code. */
  refuse = new Map<string, number>();
  /** What each address lasts, in seconds; 200 when not said. */
  durations = new Map<string, number>();
  /** Takes a moment before playing: PLAYING only at the next question. */
  slowStart = false;
  /** Given a track, between two for this many questions: Play refused (701), TRANSITIONING (the Onkyo, a CD changed). */
  settling = 0;
  private settlingLeft = 0;
  /** The clock, in ms, the sessions read too. */
  clock = 1_000_000;
  /** How long each SOAP answer takes, in real ms: two calls at once can then be caught. */
  latencyMs = 0;
  /** The most SOAP calls it was handling at once: the Onkyo wants one at a time. */
  maxInFlight = 0;
  private inFlight = 0;
  private server: http.Server | null = null;
  private pendingPlay = false;

  constructor(kind: Kind) {
    this.kind = kind;
    this.volume = kind === 'wiim' ? 100 : 57;
  }

  get location(): string { return `${this.base}${DESCRIPTIONS[this.kind].path}`; }

  /** The calls of one action, in order. */
  of(action: string): Call[] { return this.calls.filter(call => call.action === action); }

  /** The actions that change something, in order: what a test reads the session's moves from. */
  commands(): string[] {
    return this.calls.map(call => call.action).filter(action => !/^Get/.test(action));
  }

  durationOf(uri: string): number { return this.durations.get(uri) ?? 200; }

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', () => resolve()));
    this.base = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections?.();
    await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** Time passes: the track plays on; at its end, the next one given, or a stop. */
  advance(seconds: number): void {
    this.clock += seconds * 1000;
    if (this.state !== 'PLAYING') return;
    let left = seconds;
    while (left > 0 && this.state === 'PLAYING') {
      const remaining = this.durationOf(this.uri) - this.position;
      if (left < remaining) {
        this.position += left;
        return;
      }
      left -= remaining;
      if (this.nextUri) {
        this.uri = this.nextUri;
        this.nextUri = '';
        this.position = 0;
      } else {
        this.state = 'STOPPED';
        this.position = 0;
        return;
      }
    }
  }

  /** Another input chosen, AirPlay, the WiiM's own app: it plays someone else's. */
  takeOver(uri = 'http://192.168.86.30:7000/airplay/stream'): void {
    this.uri = uri;
    this.nextUri = '';
    this.position = 0;
    this.state = 'PLAYING';
  }

  private time(seconds: number): string {
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
    const s = String(whole % 60).padStart(2, '0');
    // The WiiM writes its hours with two digits, the Onkyo with one.
    return `${this.kind === 'wiim' ? String(h).padStart(2, '0') : h}:${m}:${s}`;
  }

  private answer(action: string, args: Record<string, string>): Record<string, string | number> {
    switch (action) {
      case 'SetAVTransportURI':
        if (this.unplayable.has(args.CurrentURI)) throw Object.assign(new Error('Illegal MIME-type'), { code: 714 });
        this.uri = args.CurrentURI;
        this.nextUri = '';
        this.position = 0;
        this.state = 'STOPPED';
        this.settlingLeft = this.settling;
        return {};
      case 'SetNextAVTransportURI':
        this.nextUri = args.NextURI;
        return {};
      case 'Play':
        if (!this.uri) throw Object.assign(new Error('Transition not available'), { code: 701 });
        if (this.settlingLeft > 0) {
          this.settlingLeft--;
          throw Object.assign(new Error('Transition not available'), { code: 701 });
        }
        if (this.slowStart && this.state !== 'PAUSED_PLAYBACK') {
          this.state = 'TRANSITIONING';
          this.pendingPlay = true;
        } else this.state = 'PLAYING';
        return {};
      case 'Pause':
        this.state = 'PAUSED_PLAYBACK';
        return {};
      case 'Stop':
        this.state = this.uri ? 'STOPPED' : 'NO_MEDIA_PRESENT';
        this.position = 0;
        return {};
      case 'Seek':
        this.position = secondsOf(args.Target);
        return {};
      case 'GetTransportInfo':
        if (this.settlingLeft > 0) {
          this.settlingLeft--;
          return { CurrentTransportState: 'TRANSITIONING', CurrentTransportStatus: 'OK', CurrentSpeed: 1 };
        }
        if (this.pendingPlay) {
          // Asked once while it fetches the file: playing the next time.
          this.pendingPlay = false;
          return { CurrentTransportState: 'TRANSITIONING', CurrentTransportStatus: 'OK', CurrentSpeed: 1 };
        }
        if (this.state === 'TRANSITIONING') this.state = 'PLAYING';
        return { CurrentTransportState: this.state, CurrentTransportStatus: 'OK', CurrentSpeed: 1 };
      case 'GetPositionInfo':
        return {
          Track: this.uri ? 1 : 0, TrackDuration: this.time(this.uri ? this.durationOf(this.uri) : 0), TrackMetaData: '',
          TrackURI: this.uri, RelTime: this.time(this.position), AbsTime: this.kind === 'wiim' ? 'NOT_IMPLEMENTED' : this.time(this.position),
          RelCount: 0, AbsCount: 0,
        };
      case 'GetVolume':
        return { CurrentVolume: this.volume };
      case 'SetVolume':
        this.volume = Number(args.DesiredVolume);
        return {};
      case 'GetMute':
        return { CurrentMute: this.muted ? 1 : 0 };
      case 'SetMute':
        this.muted = args.DesiredMute === '1' || args.DesiredMute === 'true';
        return {};
      case 'GetProtocolInfo':
        return flatXml(read(`${this.kind === 'panasonic' ? 'onkyo' : this.kind}/GetProtocolInfo.xml`));
      default:
        throw Object.assign(new Error('Invalid Action'), { code: 401 });
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.down || (req.method === 'POST' && this.dropNext > 0 && this.dropNext--)) {
      req.socket.destroy();
      return;
    }
    const url = req.url || '/';
    const recorded = DESCRIPTIONS[this.kind];
    if (req.method === 'GET') {
      const file = url === recorded.path ? recorded.file : SCPDS[url];
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(read(file).split(recorded.recordedBase).join(this.base));
      return;
    }
    let body = '';
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    res.on('close', () => { this.inFlight--; });
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => setTimeout(() => {
      const soapAction = String(req.headers.soapaction || '').replace(/"/g, '');
      const [serviceType, action] = soapAction.split('#');
      const args = flatXml(body);
      delete args[action];
      this.calls.push({ action, args });
      // At rest, the answers recorded from the appliance itself, word for word (the Onkyo's
      // last duration with no track, the WiiM's NOT_IMPLEMENTED); the Panasonic's were not recorded.
      const recorded = `${this.kind}/${action}.xml`;
      if (!this.uri && this.state === 'NO_MEDIA_PRESENT' && this.kind !== 'panasonic' && AT_REST.has(action) && !this.refuse.has(action)
        && (action !== 'GetVolume' || this.volume === (this.kind === 'wiim' ? 100 : 57)) && (action !== 'GetMute' || !this.muted)) {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
        res.end(read(recorded));
        return;
      }
      try {
        const refused = this.refuse.get(action);
        if (refused) throw Object.assign(new Error('Refused'), { code: refused });
        const values = this.answer(action, args);
        const inner = Object.entries(values).map(([name, value]) => `<${name}>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${name}>`).join('');
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
        res.end(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="${serviceType}">${inner}</u:${action}Response></s:Body></s:Envelope>`);
      } catch (error) {
        const code = (error as { code?: number }).code ?? 501;
        res.writeHead(500, { 'Content-Type': 'text/xml; charset="utf-8"' });
        res.end('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>'
          + '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0">'
          + `<errorCode>${code}</errorCode><errorDescription>${(error as Error).message}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`);
      }
    }, this.latencyMs));
  }
}
