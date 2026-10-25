import axios from 'axios';

/**
 * SOAP as UPnP speaks it, by hand: an envelope around one action and its
 * arguments, and an answer that is flat, one element per argument. A library
 * would bring far more than this needs.
 */

/** An appliance waits this long for an answer before it counts as not answering. */
export const SOAP_TIMEOUT_MS = 4000;

/** The appliance answered, and refused: errorCode as UPnP numbers them (714, 716: a format it cannot play). */
export class UPnPError extends Error {
  code: number | null;
  action: string;
  constructor(action: string, code: number | null, description: string) {
    super(`${action} refused${code != null ? ` (${code})` : ''}${description ? `: ${description}` : ''}`);
    this.name = 'UPnPError';
    this.code = code;
    this.action = action;
  }
}

/** The appliance did not answer at all: off, out of the network, or too slow. */
export class DeviceUnreachableError extends Error {
  constructor(action: string, why: string) {
    super(`${action}: no answer (${why})`);
    this.name = 'DeviceUnreachableError';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The elements of a document that hold text alone, by their name without
 * prefix, the first of each name kept: what a UPnP answer is. A DIDL-Lite
 * sent back inside an argument is escaped, so it stays one text.
 */
export const flatXml = (xml: string): Record<string, string> => {
  const values: Record<string, string> = {};
  const leaf = /<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?\1\s*>|<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?\/>/g;
  for (let match = leaf.exec(xml); match; match = leaf.exec(xml)) {
    const name = match[1] ?? match[3];
    if (!(name in values)) values[name] = match[1] ? decodeEntities(match[2]).trim() : '';
  }
  return values;
};

/** "0:04:06", "00:03:12.500", "1:02:03" as seconds; NOT_IMPLEMENTED or nothing as 0. */
export const secondsOf = (time: string | undefined): number => {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec((time || '').trim());
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

/** Seconds as UPnP writes a time: h:mm:ss. */
export const timeOf = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const envelope = (serviceType: string, action: string, args: Record<string, string | number>): string =>
  '<?xml version="1.0" encoding="utf-8"?>'
  + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
  + `<s:Body><u:${action} xmlns:u="${serviceType}">`
  + Object.entries(args).map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`).join('')
  + `</u:${action}></s:Body></s:Envelope>`;

/**
 * One action sent to a service of an appliance; its answer's arguments.
 * Throws UPnPError when it refuses, DeviceUnreachableError when it does not answer.
 */
export const soapCall = async (
  controlUrl: string, serviceType: string, action: string, args: Record<string, string | number> = {}, timeoutMs = SOAP_TIMEOUT_MS,
): Promise<Record<string, string>> => {
  let response;
  try {
    response = await axios.post<string>(controlUrl, envelope(serviceType, action, args), {
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${serviceType}#${action}"` },
      timeout: timeoutMs,
      responseType: 'text',
      transformResponse: data => data,
      validateStatus: () => true,
    });
  } catch (error) {
    throw new DeviceUnreachableError(action, axios.isAxiosError(error) ? error.code || error.message : (error as Error).message);
  }
  const body = String(response.data ?? '');
  if (response.status >= 200 && response.status < 300) return flatXml(body);
  if (/<(?:\w+:)?Fault[\s>]/.test(body)) {
    const fault = flatXml(body);
    throw new UPnPError(action, fault.errorCode ? Number(fault.errorCode) : null, fault.errorDescription || fault.faultstring || '');
  }
  throw new DeviceUnreachableError(action, `HTTP ${response.status}`);
};
