import type http from 'http';
import type { Response } from 'express';
import { getDatabase } from '../../database';
import { RendererRegistry, type RendererEntry } from './renderers';
import type { Renderer } from './device';
import { OutputSession, type OutputState, type SavedSession, type SessionDeps } from './session';
import { Poller } from './poller';
import { mediaTokens, startMediaServer } from './media';
import type { UpnpOptions } from './options';
import type { TurnDeps } from './turn';
import { loadPlayable } from '../playable';
import { scrobble } from '../scrobble';
import logger from '../../logger';

/**
 * The appliances DexVault plays on, and what plays on each: one session per
 * appliance, its state sent to every page listening (Server-Sent Events), and
 * kept in output_sessions to outlive a restart. Without UPNP_MEDIA_BASE_URL
 * none of it runs: no port, no appliance, an empty list.
 */

export interface OutputListed {
  id: string;
  /** As the owner named it (Salon), else as the appliance does. */
  name: string;
  deviceName: string;
  model: string;
  manufacturer: string;
  reachable: boolean;
  gapless: boolean;
  volume: number | null;
  muted: boolean;
  maxVolume: number;
  session: OutputState | null;
}

interface Settings {
  id: string;
  name: string | null;
  maxVolume: number | null;
  location: string | null;
  deviceName: string | null;
  model: string | null;
}

/** For the tests: what stands in for the appliances and Navidrome. */
export interface OutputsOverrides {
  loadRenderer?: (location: string) => Promise<Renderer>;
  load?: SessionDeps['load'];
  scrobble?: SessionDeps['scrobble'];
  turnDeps?: TurnDeps;
  search?: () => Promise<string[]>;
  wait?: SessionDeps['wait'];
  now?: () => number;
  /** No media listener opened: a test serves the files itself. */
  listen?: boolean;
  /** No polling on timers: the test polls. */
  poll?: boolean;
}

/** A page's connection is kept open by a word now and then, as the remote's is. */
const KEEP_ALIVE_MS = 20_000;
const MAX_LISTENERS = 50;

const run = (sql: string, params: unknown[] = []) => new Promise<void>((resolve, reject) =>
  getDatabase().run(sql, params, (err: Error | null) => (err ? reject(err) : resolve())));
const all = <T>(sql: string, params: unknown[] = []) => new Promise<T[]>((resolve, reject) =>
  getDatabase().all(sql, params, (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows || []))));

class Outputs {
  private options: UpnpOptions | null = null;
  private overrides: OutputsOverrides = {};
  private registry: RendererRegistry | null = null;
  private sessions = new Map<string, { session: OutputSession; poller: Poller }>();
  private settings = new Map<string, Settings>();
  private saved = new Map<string, SavedSession>();
  private listeners = new Set<Response>();
  /** Whether each appliance answers, as the pages were last told: a session that goes away or comes back tells them again. */
  private told = new Map<string, boolean>();
  private server: http.Server | null = null;
  /** Writes to the base under way: a shutdown waits for them, so that the next start reads them. */
  private writes = new Set<Promise<unknown>>();

  get enabled(): boolean { return Boolean(this.options?.mediaBaseUrl); }

  /** The media listener, when it listens: its port, for the tests. */
  get mediaServer(): http.Server | null { return this.server; }

  /** Reads the appliances, opens the media listener, and takes up the plays a restart left. */
  async init(options: UpnpOptions, overrides: OutputsOverrides = {}): Promise<void> {
    await this.shutdown();
    this.options = options;
    this.overrides = overrides;
    if (!options.mediaBaseUrl) return;
    await this.readSettings();
    await this.readSaved();
    if (overrides.listen !== false) {
      this.server = await startMediaServer(options.mediaPort);
      logger.info(`UPnP: media listener on port ${options.mediaPort}, reached as ${options.mediaBaseUrl}`);
    }
    this.registry = new RendererRegistry({
      locations: options.renderers,
      discovery: options.discovery,
      load: overrides.loadRenderer,
      search: overrides.search,
      now: overrides.now,
      isBusy: id => this.sessions.get(id)?.session.status === 'playing',
      onChange: entry => this.noted(entry),
    });
    // An appliance seen before and configured still is listed, away, even when it does not answer now.
    for (const settings of this.settings.values()) {
      if (settings.location && options.renderers.includes(settings.location) && !this.sessions.has(settings.id)) this.makeSession(settings.id);
    }
    await this.registry.refreshAll();
    // Their volume read before the list is first given.
    await Promise.allSettled([...this.sessions.values()].map(({ session }) => session.idle()));
    if (overrides.poll !== false) this.registry.start();
  }

  /** A write to the base, kept until it is done. */
  private write(sql: string, params: unknown[]): Promise<void> {
    const done = run(sql, params).finally(() => this.writes.delete(done));
    this.writes.add(done);
    return done;
  }

  async shutdown(): Promise<void> {
    this.registry?.stop();
    this.registry = null;
    for (const { session, poller } of this.sessions.values()) {
      poller.stop();
      session.dispose();
    }
    this.sessions.clear();
    this.told.clear();
    await Promise.allSettled([...this.writes]);
    for (const listener of this.listeners) listener.end();
    this.listeners.clear();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = null;
    this.options = null;
  }

  private async readSettings(): Promise<void> {
    const rows = await all<{ id: string; name: string | null; max_volume: number | null; location: string | null; device_name: string | null; model: string | null }>(
      'SELECT id, name, max_volume, location, device_name, model FROM output_settings');
    this.settings = new Map(rows.map(row => [row.id, {
      id: row.id, name: row.name, maxVolume: row.max_volume, location: row.location, deviceName: row.device_name, model: row.model,
    }]));
  }

  private async readSaved(): Promise<void> {
    const rows = await all<{ id: string; state: string }>('SELECT id, state FROM output_sessions');
    this.saved = new Map();
    for (const row of rows) {
      try {
        const saved = JSON.parse(row.state) as SavedSession;
        if (saved?.token && Array.isArray(saved.tracks)) this.saved.set(row.id, saved);
      } catch { /* a row that cannot be read: that play is forgotten */ }
    }
  }

  /** An appliance read: its session made the first time, what it is named by kept. */
  private noted(entry: RendererEntry): void {
    const renderer = entry.renderer;
    if (renderer) {
      const { udn, name, model } = renderer.description;
      const known = this.settings.get(udn);
      if (!known || known.location !== entry.location || known.deviceName !== name || known.model !== model) {
        const settings = { id: udn, name: known?.name ?? null, maxVolume: known?.maxVolume ?? null, location: entry.location, deviceName: name, model };
        this.settings.set(udn, settings);
        this.write(`INSERT INTO output_settings (id, name, max_volume, location, device_name, model) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET location = excluded.location, device_name = excluded.device_name, model = excluded.model`,
        [udn, settings.name, settings.maxVolume, entry.location, name, model]).catch(error => logger.warn(`UPnP settings: ${(error as Error).message}`));
      }
      if (!this.sessions.has(udn)) this.makeSession(udn);
      else if (entry.reachable) {
        const { session } = this.sessions.get(udn)!;
        if (session.status !== 'playing') session.readVolume().catch(() => undefined);
      }
    }
    this.broadcast('outputs', null);
  }

  private makeSession(id: string): OutputSession {
    const options = this.options!;
    const deps: SessionDeps = {
      renderer: () => this.entryOf(id)?.renderer ?? null,
      reload: async () => {
        const entry = this.entryOf(id);
        if (entry) await this.registry!.refresh(entry);
      },
      reachable: () => Boolean(this.entryOf(id)?.reachable),
      mediaBase: options.mediaBaseUrl,
      name: () => this.nameOf(id),
      maxVolume: () => this.maxVolumeOf(id),
      load: (albumId, how) => this.load(albumId, how),
      scrobble: this.overrides.scrobble ?? scrobble,
      turnDeps: this.overrides.turnDeps,
      issueToken: mediaTokens.issue,
      save: saved => (saved
        ? this.write(`INSERT INTO output_sessions (id, state, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, [id, JSON.stringify(saved), Math.floor(Date.now() / 1000)])
        : this.write('DELETE FROM output_sessions WHERE id = ?', [id])),
      emit: (event, payload) => {
        this.broadcast(event, payload);
        if (event !== 'state') return;
        this.sessions.get(id)?.poller.wake();
        // Back from away (or gone) by a poll or a command: the list the pages hold says so at once, not at the next minute's read.
        if (this.told.has(id) && this.told.get(id) !== this.reachableOf(id)) this.broadcast('outputs', null);
      },
      now: this.overrides.now,
      wait: this.overrides.wait,
    };
    const saved = this.saved.get(id) ?? null;
    if (saved) mediaTokens.adopt(saved.token);
    const session = new OutputSession(id, deps, saved);
    const poller = new Poller(session);
    this.sessions.set(id, { session, poller });
    session.readVolume().catch(() => undefined);
    if (this.overrides.poll !== false) poller.wake();
    return session;
  }

  /** The appliance's entry: by its UDN once read, else by where it was last seen. */
  private entryOf(id: string): RendererEntry | null {
    const location = this.settings.get(id)?.location;
    return this.registry?.byId(id)
      ?? this.registry?.entries.find(entry => !entry.renderer && (entry.configured === location || entry.location === location))
      ?? null;
  }

  /** An album of DexVault as it plays: what the sessions load too. */
  load(albumId: number, how: { listenNext?: boolean; disc?: number } = {}): ReturnType<SessionDeps['load']> {
    const options = { listenNext: how.listenNext ?? false, disc: how.disc ?? 0 };
    return this.overrides.load ? this.overrides.load(albumId, options) : loadPlayable(albumId, options);
  }

  nameOf(id: string): string {
    const settings = this.settings.get(id);
    return settings?.name || this.registry?.byId(id)?.renderer?.description.name || settings?.deviceName || 'Speaker';
  }

  maxVolumeOf(id: string): number {
    return this.settings.get(id)?.maxVolume ?? this.options?.maxVolume ?? 70;
  }

  session(id: string): OutputSession | null {
    return this.sessions.get(id)?.session ?? null;
  }

  /** The appliances, those seen before and away now included. */
  list(): OutputListed[] {
    if (!this.enabled) return [];
    // In the order configured, not in the order they answered; those found by a search after them.
    const configured = this.options?.renderers ?? [];
    const placeOf = (id: string): number => {
      const entry = this.entryOf(id);
      const at = configured.findIndex(location => location === entry?.configured || location === this.settings.get(id)?.location);
      return at < 0 ? configured.length : at;
    };
    const ids = [...this.sessions.keys()].sort((a, b) => placeOf(a) - placeOf(b));
    return ids.map(id => {
      const entry = this.entryOf(id);
      const session = this.sessions.get(id)?.session ?? null;
      const settings = this.settings.get(id);
      const description = entry?.renderer?.description;
      return {
        id,
        name: this.nameOf(id),
        deviceName: description?.name ?? settings?.deviceName ?? '',
        model: description?.model ?? settings?.model ?? '',
        manufacturer: description?.manufacturer ?? '',
        reachable: this.reachableOf(id),
        gapless: Boolean(entry?.renderer?.gapless),
        volume: session?.volume ?? null,
        muted: session?.muted ?? false,
        maxVolume: this.maxVolumeOf(id),
        session: session ? session.state() : null,
      };
    });
  }

  /** Whether it answers: its description read, and its session not away. */
  private reachableOf(id: string): boolean {
    return Boolean(this.entryOf(id)?.reachable) && this.sessions.get(id)?.session.status !== 'unreachable';
  }

  /** The name shown and the volume's ceiling, as the owner sets them; null when no such appliance. */
  async setSettings(id: string, change: { name?: string | null; maxVolume?: number | null }): Promise<OutputListed | null> {
    if (!this.sessions.has(id)) return null;
    const known = this.settings.get(id) ?? { id, name: null, maxVolume: null, location: null, deviceName: null, model: null };
    const settings = {
      ...known,
      ...(change.name !== undefined ? { name: change.name ? change.name.trim().slice(0, 40) || null : null } : {}),
      ...(change.maxVolume !== undefined ? { maxVolume: change.maxVolume == null ? null : Math.round(Math.max(0, Math.min(100, change.maxVolume))) } : {}),
    };
    this.settings.set(id, settings);
    await run(`INSERT INTO output_settings (id, name, max_volume, location, device_name, model) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, max_volume = excluded.max_volume`,
    [id, settings.name, settings.maxVolume, settings.location, settings.deviceName, settings.model]);
    this.broadcast('outputs', null);
    this.broadcast('state', this.sessions.get(id)!.session.state());
    return this.list().find(output => output.id === id) ?? null;
  }

  /** Every page listening told: `state` (a session), `left` (an album leaving Listen Next), `outputs` (the list changed). */
  broadcast(event: 'state' | 'left' | 'outputs', payload: unknown): void {
    const data = event === 'outputs' ? this.list() : payload;
    if (event === 'outputs') for (const output of data as OutputListed[]) this.told.set(output.id, output.reachable);
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const listener of this.listeners) listener.write(message);
  }

  /** A page listening, as Server-Sent Events, until its connection closes; null when too many listen. */
  listen(response: Response): (() => void) | null {
    if (this.listeners.size >= MAX_LISTENERS) return null;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.write(': listening\n\n');
    // What plays now, at once: the page needs not wait for the next change.
    const listed = this.list();
    for (const output of listed) this.told.set(output.id, output.reachable);
    response.write(`event: outputs\ndata: ${JSON.stringify(listed)}\n\n`);
    this.listeners.add(response);
    const alive = setInterval(() => response.write('event: alive\ndata: 1\n\n'), KEEP_ALIVE_MS);
    alive.unref?.();
    return () => {
      clearInterval(alive);
      this.listeners.delete(response);
    };
  }
}

const outputs = new Outputs();

export default outputs;
