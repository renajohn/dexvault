/**
 * The appliances DexVault plays on, and how they reach it. Read in the usual
 * order, each overriding the one before: deployment.*.json, data/options.json,
 * then the environment.
 */
export interface UpnpOptions {
  /** The appliances' description URLs: they do not answer a search from inside Docker. */
  renderers: string[];
  /** The media listener's port in the container. */
  mediaPort: number;
  /** What the appliances call: http://dexvault.lab.crog.org:3002. Empty: no UPnP at all. */
  mediaBaseUrl: string;
  /** 'ssdp' adds the appliances that answer a search: on the Mac, in dev. */
  discovery: 'off' | 'ssdp';
  /** The volume never set above this, unless an appliance has its own. */
  maxVolume: number;
  /** The remote for the browsers (/api/remote), kept until UPnP is trusted. */
  remoteEnabled: boolean;
}

type Source = Record<string, unknown> | null | undefined;

const pick = (key: string, envKey: string, sources: Source[], env: NodeJS.ProcessEnv): unknown => {
  if (env[envKey] != null && env[envKey] !== '') return env[envKey];
  for (const source of [...sources].reverse()) {
    if (source && source[key] != null && source[key] !== '') return source[key];
  }
  return undefined;
};

const listOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value.map(String) : String(value ?? '').split(','))
    .map(url => url.trim()).filter(url => /^https?:\/\//i.test(url));

const numberOf = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : fallback;
};

const flagOf = (value: unknown, fallback: boolean): boolean => {
  if (value == null) return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
};

/** The options from the deployment's file, options.json and the environment. */
export const upnpOptionsOf = (deployment: Source, data: Source, env: NodeJS.ProcessEnv = process.env): UpnpOptions => {
  const sources = [deployment, data];
  return {
    renderers: listOf(pick('upnp_renderers', 'UPNP_RENDERERS', sources, env)),
    mediaPort: numberOf(pick('upnp_media_port', 'UPNP_MEDIA_PORT', sources, env), 3002, 1, 65535),
    mediaBaseUrl: String(pick('upnp_media_base_url', 'UPNP_MEDIA_BASE_URL', sources, env) ?? '').trim().replace(/\/+$/, ''),
    discovery: String(pick('upnp_discovery', 'UPNP_DISCOVERY', sources, env) ?? 'off').trim().toLowerCase() === 'ssdp' ? 'ssdp' : 'off',
    maxVolume: numberOf(pick('upnp_max_volume', 'UPNP_MAX_VOLUME', sources, env), 70, 0, 100),
    remoteEnabled: flagOf(pick('remote_enabled', 'REMOTE_ENABLED', sources, env), true),
  };
};
