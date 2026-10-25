import dgram from 'dgram';
import { loadRenderer, type Renderer } from './device';
import logger from '../../logger';

/**
 * The appliances configured, by the URL of their description: they answer
 * no search from inside Docker's bridge, so each is named in the
 * configuration (with a DHCP reservation on the router). Each is read again
 * every minute when nothing plays on it, to tell whether it is there.
 */

export interface RendererEntry {
  /** Where its description was last read. */
  location: string;
  /** Where the configuration (or a search) said it is. */
  configured: string;
  renderer: Renderer | null;
  reachable: boolean;
  checkedAt: number;
}

/** libupnp, the WiiM's, takes another port in this range when it restarts. */
const NEIGHBOUR_PORTS = { from: 49152, to: 49160 };
const REFRESH_EVERY_MS = 60_000;
const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

/** The same description on the ports a WiiM may have moved to. */
export const neighboursOf = (location: string): string[] => {
  const url = new URL(location);
  const port = Number(url.port);
  if (!(port >= NEIGHBOUR_PORTS.from && port <= NEIGHBOUR_PORTS.to)) return [];
  const others: string[] = [];
  for (let other = NEIGHBOUR_PORTS.from; other <= NEIGHBOUR_PORTS.to; other++) {
    if (other === port) continue;
    url.port = String(other);
    others.push(url.toString());
  }
  return others;
};

/** The LOCATION of an answer to an M-SEARCH. */
export const locationOf = (answer: string): string | null => /^location:\s*(\S+)/im.exec(answer)?.[1] ?? null;

/**
 * The MediaRenderers that answer a search on the local network within
 * `timeoutMs`: on the Mac in dev; from a Docker bridge, none answer.
 */
export const ssdpSearch = (timeoutMs = 3000): Promise<string[]> => new Promise(resolve => {
  const found = new Set<string>();
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const done = () => {
    try { socket.close(); } catch { /* closed already */ }
    resolve([...found]);
  };
  socket.on('message', message => {
    const location = locationOf(message.toString());
    if (location) found.add(location);
  });
  socket.on('error', done);
  const search = Buffer.from([
    'M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', 'MX: 2',
    'ST: urn:schemas-upnp-org:device:MediaRenderer:1', '', '',
  ].join('\r\n'));
  socket.bind(0, () => socket.send(search, SSDP_PORT, SSDP_ADDRESS));
  setTimeout(done, timeoutMs).unref?.();
});

export interface RegistryOptions {
  locations: string[];
  discovery?: 'off' | 'ssdp';
  load?: (location: string) => Promise<Renderer>;
  search?: () => Promise<string[]>;
  /** Not read again while it plays: the poller tells already. */
  isBusy?: (id: string) => boolean;
  /** An appliance found, lost, or back. */
  onChange?: (entry: RendererEntry) => void;
  now?: () => number;
}

export class RendererRegistry {
  entries: RendererEntry[];
  private options: RegistryOptions;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RegistryOptions) {
    this.options = options;
    this.entries = [...new Set(options.locations)].map(location => ({
      location, configured: location, renderer: null, reachable: false, checkedAt: 0,
    }));
  }

  private now(): number { return this.options.now ? this.options.now() : Date.now(); }

  /**
   * Its description read again: where it was, else where it was configured;
   * and when the appliance is there but its port is closed (a WiiM that
   * restarted), on the ports next to it.
   */
  async refresh(entry: RendererEntry): Promise<RendererEntry> {
    const load = this.options.load ?? loadRenderer;
    const was = entry.reachable;
    entry.checkedAt = this.now();
    const places = [...new Set([entry.location, entry.configured])];
    let refused = false;
    for (let at = 0; at < places.length; at++) {
      const location = places[at];
      try {
        entry.renderer = await load(location);
        entry.location = location;
        entry.reachable = true;
        if (!was) logger.info(`UPnP: ${entry.renderer.description.name} (${entry.renderer.description.model}) at ${location}`);
        this.options.onChange?.(entry);
        return entry;
      } catch (error) {
        if ((error as { code?: string }).code === 'ECONNREFUSED' && !refused) {
          refused = true;
          places.push(...neighboursOf(entry.configured).filter(other => !places.includes(other)));
        }
      }
    }
    entry.reachable = false;
    if (was) logger.warn(`UPnP: ${entry.renderer?.description.name || entry.configured} does not answer`);
    this.options.onChange?.(entry);
    return entry;
  }

  async refreshAll(): Promise<void> {
    if (this.options.discovery === 'ssdp') {
      const found = await (this.options.search ?? ssdpSearch)().catch(() => []);
      for (const location of found) {
        if (!this.entries.some(entry => entry.location === location || entry.configured === location)) {
          this.entries.push({ location, configured: location, renderer: null, reachable: false, checkedAt: 0 });
        }
      }
    }
    await Promise.all(this.entries
      .filter(entry => !(entry.renderer && this.options.isBusy?.(entry.renderer.id)))
      .map(entry => this.refresh(entry)));
    // One appliance found twice (configured, and by a search): kept once.
    const seen = new Set<string>();
    this.entries = this.entries.filter(entry => {
      const id = entry.renderer?.id;
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  byId(id: string): RendererEntry | null {
    return this.entries.find(entry => entry.renderer?.id === id) ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.refreshAll().catch(() => undefined); }, REFRESH_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
