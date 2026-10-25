import { escapeXml, timeOf } from './soap';

/**
 * What an appliance is told of a track it is given (DIDL-Lite): its title,
 * artist, album, number and cover, and the file's type, which tells it how
 * to read the bytes. Nothing of Navidrome's: the URLs are the media
 * listener's, by a session's token.
 */

const MIME_TYPES: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  alac: 'audio/mp4',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
};

/** A file's suffix, as Navidrome gives it, as a MIME type: FLAC when unknown, what most of the library is. */
export const mimeTypeOf = (suffix: string | null | undefined): string => MIME_TYPES[(suffix || '').toLowerCase()] || 'audio/flac';

/** Served as it lies, seekable by range: DLNA's flags for a file streamed, not a broadcast. */
export const DLNA_FEATURES = 'DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';

export const protocolInfoOf = (mimeType: string): string => `http-get:*:${mimeType}:${DLNA_FEATURES}`;

export interface DidlTrack {
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  durationSec: number | null;
  url: string;
  mimeType: string;
  coverUrl: string | null;
  size?: number | null;
}

/** DIDL-Lite's time: h:mm:ss.000. */
const durationOf = (seconds: number): string => `${timeOf(seconds)}.000`;

export const didlOf = (track: DidlTrack): string => {
  const attributes = [
    `protocolInfo="${escapeXml(protocolInfoOf(track.mimeType))}"`,
    track.durationSec ? `duration="${durationOf(track.durationSec)}"` : '',
    track.size ? `size="${Math.round(track.size)}"` : '',
  ].filter(Boolean).join(' ');
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">'
    + '<item id="dexvault" parentID="0" restricted="1">'
    + `<dc:title>${escapeXml(track.title)}</dc:title>`
    + (track.artist ? `<upnp:artist>${escapeXml(track.artist)}</upnp:artist><dc:creator>${escapeXml(track.artist)}</dc:creator>` : '')
    + (track.album ? `<upnp:album>${escapeXml(track.album)}</upnp:album>` : '')
    + (track.trackNumber ? `<upnp:originalTrackNumber>${track.trackNumber}</upnp:originalTrackNumber>` : '')
    + (track.coverUrl ? `<upnp:albumArtURI dlna:profileID="JPEG_TN">${escapeXml(track.coverUrl)}</upnp:albumArtURI>` : '')
    + '<upnp:class>object.item.audioItem.musicTrack</upnp:class>'
    + `<res ${attributes}>${escapeXml(track.url)}</res>`
    + '</item></DIDL-Lite>';
};
