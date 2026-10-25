import axios from 'axios';
import { decodeEntities, secondsOf, soapCall, timeOf, SOAP_TIMEOUT_MS } from './soap';

/**
 * An appliance that plays what it is given (a MediaRenderer): read from its
 * description, the three services DexVault speaks to, and what they can do.
 */

export interface ServiceInfo {
  type: string;
  /** 1 or 2: the Onkyo's are 2, the WiiM's 1. */
  version: number;
  controlUrl: string;
  scpdUrl: string | null;
}

export interface DeviceDescription {
  /** Where the description was read: what the configuration names it by. */
  location: string;
  udn: string;
  name: string;
  manufacturer: string;
  model: string;
  deviceType: string;
  avTransport: ServiceInfo;
  renderingControl: ServiceInfo | null;
  connectionManager: ServiceInfo | null;
}

export interface TransportInfo {
  /** PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING, NO_MEDIA_PRESENT. */
  state: string;
  status: string;
}

export interface PositionInfo {
  track: number;
  trackUri: string;
  /** Seconds into the track. */
  position: number;
  /** Seconds the track lasts, 0 when the appliance does not say. */
  duration: number;
}

const DESCRIPTION_TIMEOUT_MS = 4000;

/** The text of the first element of that name, prefix aside, in a piece of a description. */
const tag = (xml: string, name: string): string => {
  const match = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}\\s*>`).exec(xml);
  return match ? decodeEntities(match[1]).trim() : '';
};

const absolute = (url: string, base: string): string => new URL(url, base).toString();

/**
 * A description as the appliance gives it: its name, its make, and the
 * addresses of its services, relative ones read against URLBase or against
 * where the description was read. Null when it is no MediaRenderer with an
 * AVTransport.
 */
export const parseDescription = (xml: string, location: string): DeviceDescription | null => {
  const base = tag(xml, 'URLBase') || location;
  // The first device is the appliance itself; an embedded one would come after.
  const device = /<device[\s>][\s\S]*$/.exec(xml)?.[0] ?? xml;
  const services = [...device.matchAll(/<service[\s>]([\s\S]*?)<\/service>/g)].map(match => match[1]);
  const serviceOf = (kind: string): ServiceInfo | null => {
    const found = services.find(service => new RegExp(`:service:${kind}:\\d+$`).test(tag(service, 'serviceType')));
    if (!found) return null;
    const type = tag(found, 'serviceType');
    const control = tag(found, 'controlURL');
    if (!control) return null;
    const scpd = tag(found, 'SCPDURL');
    return {
      type, version: Number(/:(\d+)$/.exec(type)?.[1] || 1),
      controlUrl: absolute(control, base), scpdUrl: scpd ? absolute(scpd, base) : null,
    };
  };
  const avTransport = serviceOf('AVTransport');
  const udn = tag(device, 'UDN');
  if (!avTransport || !udn) return null;
  return {
    location, udn,
    name: tag(device, 'friendlyName') || tag(device, 'modelName') || udn,
    manufacturer: tag(device, 'manufacturer'),
    // The WiiM's model number is a firmware date: the model's name says more.
    model: tag(device, 'modelName').replace(/\s+/g, ' '),
    deviceType: tag(device, 'deviceType'),
    avTransport,
    renderingControl: serviceOf('RenderingControl'),
    connectionManager: serviceOf('ConnectionManager'),
  };
};

/** The actions a service's SCPD lists. */
export const actionsOf = (scpd: string): Set<string> => {
  const list = /<actionList[\s>]([\s\S]*?)<\/actionList>/.exec(scpd)?.[1] ?? '';
  return new Set([...list.matchAll(/<action[\s>]([\s\S]*?)<\/action>/g)].map(match => tag(match[1], 'name')).filter(Boolean));
};

/** The MIME types a Sink takes, from GetProtocolInfo: "http-get:*:audio/flac:*,…". */
export const mimeTypesOf = (sink: string): Set<string> =>
  new Set(sink.split(',').map(entry => entry.trim().split(':')[2]?.toLowerCase()).filter((mime): mime is string => Boolean(mime)));

/**
 * An appliance to play on: its services spoken to by name. Every call goes
 * out as it is made; the session sends them one at a time.
 */
export class Renderer {
  description: DeviceDescription;
  /** SetNextAVTransportURI is there: one track follows the other with no gap. */
  gapless: boolean;
  /** What its Sink says it takes; empty when it would not say. */
  mimeTypes: Set<string>;

  constructor(description: DeviceDescription, gapless: boolean, mimeTypes: Set<string> = new Set()) {
    this.description = description;
    this.gapless = gapless;
    this.mimeTypes = mimeTypes;
  }

  get id(): string { return this.description.udn; }

  private transport(action: string, args: Record<string, string | number> = {}) {
    const { controlUrl, type } = this.description.avTransport;
    return soapCall(controlUrl, type, action, { InstanceID: 0, ...args });
  }

  private rendering(action: string, args: Record<string, string | number> = {}) {
    const service = this.description.renderingControl;
    if (!service) throw new Error(`${this.description.name} has no volume to set`);
    return soapCall(service.controlUrl, service.type, action, { InstanceID: 0, Channel: 'Master', ...args });
  }

  async setUri(uri: string, metadata: string): Promise<void> {
    await this.transport('SetAVTransportURI', { CurrentURI: uri, CurrentURIMetaData: metadata });
  }

  async setNextUri(uri: string, metadata: string): Promise<void> {
    await this.transport('SetNextAVTransportURI', { NextURI: uri, NextURIMetaData: metadata });
  }

  async play(): Promise<void> { await this.transport('Play', { Speed: '1' }); }

  async pause(): Promise<void> { await this.transport('Pause'); }

  async stop(): Promise<void> { await this.transport('Stop'); }

  /** REL_TIME, the one mode both the Onkyo and the WiiM know. */
  async seek(seconds: number): Promise<void> {
    await this.transport('Seek', { Unit: 'REL_TIME', Target: timeOf(seconds) });
  }

  async transportInfo(): Promise<TransportInfo> {
    const answer = await this.transport('GetTransportInfo');
    return { state: answer.CurrentTransportState || '', status: answer.CurrentTransportStatus || '' };
  }

  async positionInfo(): Promise<PositionInfo> {
    const answer = await this.transport('GetPositionInfo');
    return {
      track: Number(answer.Track) || 0,
      trackUri: answer.TrackURI || '',
      position: secondsOf(answer.RelTime),
      duration: secondsOf(answer.TrackDuration),
    };
  }

  async getVolume(): Promise<number> {
    return Number((await this.rendering('GetVolume')).CurrentVolume) || 0;
  }

  async setVolume(volume: number): Promise<void> {
    await this.rendering('SetVolume', { DesiredVolume: Math.round(volume) });
  }

  async getMute(): Promise<boolean> {
    const value = (await this.rendering('GetMute')).CurrentMute;
    return value === '1' || value === 'true';
  }

  async setMute(muted: boolean): Promise<void> {
    await this.rendering('SetMute', { DesiredMute: muted ? 1 : 0 });
  }
}

const fetchText = async (url: string): Promise<string> => {
  const response = await axios.get<string>(url, { timeout: DESCRIPTION_TIMEOUT_MS, responseType: 'text', transformResponse: data => data });
  return String(response.data ?? '');
};

/**
 * The appliance at a description's address: read, then its AVTransport's
 * SCPD for SetNextAVTransportURI, and its Sink for what it takes (neither
 * keeps it from playing when it will not say). Throws when the description
 * cannot be read or is no MediaRenderer.
 */
export const loadRenderer = async (location: string): Promise<Renderer> => {
  const description = parseDescription(await fetchText(location), location);
  if (!description) throw new Error(`${location} is no MediaRenderer`);
  let gapless = false;
  if (description.avTransport.scpdUrl) {
    gapless = await fetchText(description.avTransport.scpdUrl)
      .then(scpd => actionsOf(scpd).has('SetNextAVTransportURI'))
      .catch(() => false);
  }
  let mimeTypes = new Set<string>();
  const manager = description.connectionManager;
  if (manager) {
    mimeTypes = await soapCall(manager.controlUrl, manager.type, 'GetProtocolInfo', {}, SOAP_TIMEOUT_MS)
      .then(answer => mimeTypesOf(answer.Sink || ''))
      .catch(() => new Set<string>());
  }
  return new Renderer(description, gapless, mimeTypes);
};
