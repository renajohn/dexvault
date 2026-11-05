import axios from 'axios';
import crypto from 'crypto';

/**
 * Navidrome, read through its Subsonic API (OpenSubsonic adds the release
 * MBID on albums and the bit depth on songs). DexVault reaches it over the
 * shared docker network: through Traefik, its mkcert certificate is not one
 * Node can verify.
 */
const DEFAULT_URL = 'http://navidrome:4533';
/** Where a browser reaches Navidrome, through Traefik: the links DexVault hands out. */
const DEFAULT_PUBLIC_URL = 'https://music.lab.crog.org';
const publicUrl = (): string => (process.env.NAVIDROME_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
const PAGE_SIZE = 500;
const TIMEOUT_MS = 20000;

export interface NavidromeAlbum {
  id: string;
  name: string;
  artist: string;
  musicBrainzId: string | null;
  songCount: number;
  /** The stars NAVIDROME_USER gave the album, 0 for none. */
  userRating: number;
  /** Whether NAVIDROME_USER hearted it, in Amperfy or Navidrome. */
  starred?: boolean;
  /** The year the tags give, when they give one. */
  year?: number;
}

export interface NavidromeSong {
  albumId: string;
  /** What the listening history is kept by. */
  id?: string;
  suffix: string;
  bitDepth: number | null;
  /** In kbps: what tells an MP3 at 320 from one at 128. */
  bitRate?: number | null;
  samplingRate?: number | null;
  /** How often NAVIDROME_USER has played it, ever, and when last. */
  playCount?: number;
  played?: string | null;
  userRating?: number;
  starred?: boolean;
  /** Where the song sits on the album, and how long it lasts: what tells a copy of a CD apart. */
  discNumber?: number;
  track?: number;
  durationSec?: number | null;
  /** Its title and artist as tagged: what a mixtape's search reads. */
  title?: string;
  artist?: string;
}

type SubsonicResponse<T> = { 'subsonic-response': T & { status: 'ok' | 'failed'; error?: { code: number; message: string } } };

const config = () => ({
  url: (process.env.NAVIDROME_URL || DEFAULT_URL).replace(/\/+$/, ''),
  user: process.env.NAVIDROME_USER || '',
  password: process.env.NAVIDROME_PASSWORD || '',
});

const isConfigured = (): boolean => {
  const { user, password } = config();
  return Boolean(user && password);
};

/** Token authentication: the password itself never travels, only md5(password + salt). */
const authParams = (): Record<string, string> => {
  const { user, password } = config();
  if (!user || !password) throw new Error('Navidrome is not configured: set NAVIDROME_USER and NAVIDROME_PASSWORD');
  const salt = crypto.randomBytes(8).toString('hex');
  const token = crypto.createHash('md5').update(password + salt).digest('hex');
  return { u: user, t: token, s: salt, v: '1.16.1', c: 'dexvault', f: 'json' };
};

const request = async <T>(endpoint: string, params: Record<string, string | number | string[]> = {}): Promise<T> => {
  const { url } = config();
  const auth = authParams();

  let data: SubsonicResponse<T>;
  try {
    const response = await axios.get<SubsonicResponse<T>>(`${url}/rest/${endpoint}`, {
      params: { ...params, ...auth },
      // A list goes as the same name repeated, songId=1&songId=2, as Subsonic reads it.
      paramsSerializer: { indexes: null },
      timeout: TIMEOUT_MS,
    });
    data = response.data;
  } catch (error) {
    // Never surface the raw axios error: its config carries the token.
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    throw new Error(`Navidrome request failed${status ? ` (HTTP ${status})` : ''}`);
  }

  const body = data['subsonic-response'];
  if (body.status !== 'ok') throw new Error(`Navidrome refused ${endpoint}: ${body.error?.message || 'unknown error'}`);
  return body;
};

/** A playlist of Navidrome, as getPlaylists lists them. */
export interface NavidromePlaylist {
  id: string;
  name: string;
  owner: string;
  comment: string | null;
  songCount: number;
  /** When its songs or name last changed, as Navidrome tells it. */
  changed: string | null;
  /** A smart playlist, or another account's: its songs cannot be changed. */
  readonly: boolean;
}

/** One song of a playlist, in the playlist's order. */
export interface NavidromePlaylistEntry {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  discNumber: number;
  track: number;
  durationSec: number | null;
}

/** One file of a rip, as the track panel shows it. */
export interface NavidromeTrackFile {
  id: string | null;
  /** The track alone in Navidrome's song list: its web player has no page of a song's own. */
  url: string | null;
  discNumber: number;
  track: number;
  title: string;
  /** The track's own artist tag, null when the file has none. */
  artist?: string | null;
  /** The MusicBrainz recording Picard tagged the file with. */
  musicbrainzRecordingId?: string | null;
  isrc?: string | null;
  durationSec: number | null;
  suffix: string;
  bitRate: number | null;
  bitDepth: number | null;
  samplingRate: number | null;
  channelCount: number | null;
  size: number | null;
  path: string | null;
  playCount?: number;
  played?: string | null;
  userRating?: number;
  starred?: boolean;
}

/** A song a player says it plays, as getNowPlaying lists them. */
export interface NavidromeNowPlaying {
  songId: string;
  title: string;
  artist: string;
  album: string;
  albumId: string | null;
  discNumber: number;
  track: number;
  durationSec: number | null;
  user: string;
  player: string | null;
  /** Since the player said the song started. */
  minutesAgo: number;
}

type RawNowPlaying = {
  id: string; title?: string; artist?: string; album?: string; albumId?: string; discNumber?: number; track?: number;
  duration?: number; username?: string; playerName?: string; minutesAgo?: number;
};

type RawAlbum = { id: string; name: string; artist?: string; year?: number; musicBrainzId?: string; songCount?: number; userRating?: number; starred?: string };
type RawAlbumSong = {
  id?: string; title?: string; artist?: string; track?: number; discNumber?: number; duration?: number; suffix?: string; bitRate?: number;
  musicBrainzId?: string; isrc?: string[]; bitDepth?: number; samplingRate?: number; channelCount?: number; size?: number; path?: string;
  playCount?: number; played?: string; userRating?: number; starred?: string;
};
type RawSong = {
  id?: string; albumId?: string; title?: string; artist?: string; suffix?: string; bitDepth?: number; bitRate?: number; samplingRate?: number;
  discNumber?: number; track?: number; duration?: number; playCount?: number; played?: string; userRating?: number; starred?: string;
};

const toAlbum = (raw: RawAlbum): NavidromeAlbum => ({
  id: raw.id,
  name: raw.name,
  artist: raw.artist || '',
  musicBrainzId: raw.musicBrainzId || null,
  songCount: raw.songCount || 0,
  userRating: raw.userRating || 0,
  starred: Boolean(raw.starred),
  ...(raw.year ? { year: raw.year } : {}),
});

/** A session on Navidrome's own API, for what Subsonic does not tell: where a file really lies. */
let nativeToken: string | null = null;

const nativeLogin = async (): Promise<string> => {
  const { url, user, password } = config();
  try {
    const response = await axios.post<{ token: string }>(`${url}/auth/login`, { username: user, password }, { timeout: TIMEOUT_MS });
    return response.data.token;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    throw new Error(`Navidrome login failed${status ? ` (HTTP ${status})` : ''}`);
  }
};

type RawNativeSong = { path?: string; discNumber?: number; trackNumber?: number };

const navidromeService = {
  isConfigured,

  /** The album's page in Navidrome's web player. */
  albumUrl: (albumId: string): string => `${publicUrl()}/app/#/album/${encodeURIComponent(albumId)}/show`,

  /** A playlist in Navidrome's web player. */
  playlistUrl: (playlistId: string): string => `${publicUrl()}/app/#/playlist/${encodeURIComponent(playlistId)}/show`,

  /** A song in Navidrome's web player: its song list filtered down to that title on that album. */
  songUrl: (albumId: string, title: string): string =>
    `${publicUrl()}/app/#/song?filter=${encodeURIComponent(JSON.stringify({ album_id: albumId, title }))}`,

  /**
   * A song's file as it lies on disk, for DexVault's own player: the bytes
   * are handed on as they come, and a Range asked for (a seek) is passed to
   * Navidrome, so jumping into a long movement does not fetch it all.
   */
  stream: async (id: string, range?: string): Promise<{ status: number; headers: Record<string, string>; data: NodeJS.ReadableStream }> => {
    const { url } = config();
    const response = await axios.get(`${url}/rest/stream`, {
      params: { id, format: 'raw', ...authParams() },
      headers: range ? { Range: range } : {},
      responseType: 'stream',
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    }).catch(error => {
      // Never surface the raw axios error: its config carries the token.
      throw new Error(`Navidrome stream failed${axios.isAxiosError(error) && error.code ? ` (${error.code})` : ''}`);
    });
    // The timeout is for Navidrome to answer, not for the song: a browser with
    // enough in hand stops reading for a while, and the socket idle that long
    // would be cut halfway through the track.
    (response.request as { setTimeout?: (ms: number) => void } | undefined)?.setTimeout?.(0);
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers[name];
      if (value != null) headers[name] = String(value);
    }
    return { status: response.status, headers, data: response.data };
  },

  /**
   * Tells Navidrome what DexVault's player plays: `false` as a song starts,
   * so it shows as now playing; `true` once it has been listened to, so its
   * play counts as the others do.
   */
  scrobble: async (id: string, submission: boolean): Promise<void> => {
    await request('scrobble', { id, submission: String(submission), time: Date.now() });
  },

  /**
   * What every account and player is playing, as the players told Navidrome
   * (a scrobble with submission false): DexVault's own player, an appliance
   * it drives, Amperfy, Navidrome's web player. Navidrome cannot tell paused
   * from playing: an entry stays until the player says another song starts.
   */
  getNowPlaying: async (): Promise<NavidromeNowPlaying[]> => {
    const body = await request<{ nowPlaying?: { entry?: RawNowPlaying[] } }>('getNowPlaying');
    return (body.nowPlaying?.entry || []).map(entry => ({
      songId: entry.id,
      title: entry.title || '',
      artist: entry.artist || '',
      album: entry.album || '',
      albumId: entry.albumId || null,
      discNumber: entry.discNumber || 1,
      track: entry.track || 0,
      durationSec: entry.duration ?? null,
      user: entry.username || '',
      player: entry.playerName || null,
      minutesAgo: entry.minutesAgo ?? 0,
    }));
  },

  /** Gives an album, a song or an artist 1 to 5 stars, or takes them away with 0. */
  setRating: async (id: string, rating: number): Promise<void> => {
    await request('setRating', { id, rating });
  },

  /** The Navidrome albums of the songs NAVIDROME_USER hearted. */
  getStarredSongAlbums: async (): Promise<Set<string>> => {
    const body = await request<{ starred2?: { song?: Array<{ albumId?: string }> } }>('getStarred2');
    return new Set((body.starred2?.song || []).flatMap(song => (song.albumId ? [song.albumId] : [])));
  },

  /** Hearts a song, or takes the heart away: the favourite Amperfy and Navidrome show. */
  setStarred: async (id: string, starred: boolean): Promise<void> => {
    await request(starred ? 'star' : 'unstar', { id });
  },

  /**
   * Where each file of an album lies, relative to the library or absolute in
   * Navidrome's container. Subsonic may report a path made up from the tags
   * instead, unless the player asks for the real one; Navidrome's own API
   * always gives the real one.
   */
  getSongPaths: async (albumId: string): Promise<Array<{ discNumber: number; track: number; path: string }>> => {
    const { url } = config();
    if (!isConfigured()) throw new Error('Navidrome is not configured: set NAVIDROME_USER and NAVIDROME_PASSWORD');
    for (let attempt = 0; attempt < 2; attempt++) {
      nativeToken = nativeToken || await nativeLogin();
      try {
        const response = await axios.get<RawNativeSong[]>(`${url}/api/song`, {
          params: { album_id: albumId, _start: 0, _end: 1000 },
          headers: { 'X-ND-Authorization': `Bearer ${nativeToken}` },
          timeout: TIMEOUT_MS,
        });
        return (response.data || []).filter(song => song.path).map(song => ({
          discNumber: song.discNumber || 1, track: song.trackNumber || 0, path: song.path!,
        }));
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        // An expired session: log in again once.
        if (status === 401 && attempt === 0) { nativeToken = null; continue; }
        throw new Error(`Navidrome song paths request failed${status ? ` (HTTP ${status})` : ''}`);
      }
    }
    return [];
  },

  /** Every album, page by page. */
  getAlbums: async (): Promise<NavidromeAlbum[]> => {
    const albums: NavidromeAlbum[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const body = await request<{ albumList2?: { album?: RawAlbum[] } }>('getAlbumList2', { type: 'alphabeticalByName', size: PAGE_SIZE, offset });
      const page = body.albumList2?.album || [];
      albums.push(...page.map(toAlbum));
      if (page.length < PAGE_SIZE) return albums;
    }
  },

  /**
   * An album's cover as Navidrome shows it: cover.jpg or front.jpg beside the
   * files, else the image embedded in them. Navidrome does not serve the back.
   */
  getCoverArt: async (albumId: string): Promise<{ data: Buffer; contentType: string }> => {
    const { url } = config();
    let response;
    try {
      response = await axios.get<ArrayBuffer>(`${url}/rest/getCoverArt`, {
        params: { id: albumId, ...authParams() },
        responseType: 'arraybuffer',
        timeout: TIMEOUT_MS,
      });
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      throw new Error(`Navidrome cover request failed${status ? ` (HTTP ${status})` : ''}`);
    }
    const contentType = String(response.headers['content-type'] || '');
    // A refusal comes back as a Subsonic error document, not as an image.
    if (!contentType.startsWith('image/')) throw new Error('Navidrome has no cover for this album');
    return { data: Buffer.from(response.data), contentType };
  },

  /** The playlists NAVIDROME_USER sees: its own and those others made public. */
  getPlaylists: async (): Promise<NavidromePlaylist[]> => {
    const body = await request<{ playlists?: { playlist?: Array<{ id: string; name: string; owner?: string; comment?: string; songCount?: number; changed?: string; readonly?: boolean }> } }>('getPlaylists');
    return (body.playlists?.playlist || []).map(playlist => ({
      id: playlist.id, name: playlist.name, owner: playlist.owner || '', comment: playlist.comment ?? null, songCount: playlist.songCount || 0,
      changed: playlist.changed ?? null, readonly: Boolean(playlist.readonly),
    }));
  },

  /** One playlist with its songs, in their order; null when Navidrome has no such playlist. */
  getPlaylist: async (playlistId: string): Promise<{ playlist: NavidromePlaylist; entries: NavidromePlaylistEntry[] } | null> => {
    type RawPlaylist = { id: string; name: string; owner?: string; comment?: string; songCount?: number; changed?: string; readonly?: boolean;
      entry?: Array<{ id?: string; title?: string; artist?: string; album?: string; albumId?: string; discNumber?: number; track?: number; duration?: number }> };
    let body: { playlist?: RawPlaylist };
    try {
      body = await request<{ playlist?: RawPlaylist }>('getPlaylist', { id: playlistId });
    } catch (error) {
      if (/not found/i.test((error as Error).message)) return null;
      throw error;
    }
    const raw = body.playlist;
    if (!raw) return null;
    return {
      playlist: {
        id: raw.id, name: raw.name, owner: raw.owner || '', comment: raw.comment ?? null, songCount: raw.songCount || 0,
        changed: raw.changed ?? null, readonly: Boolean(raw.readonly),
      },
      entries: (raw.entry || []).filter(entry => entry.id).map(entry => ({
        id: entry.id!, title: entry.title || '', artist: entry.artist || '', album: entry.album || '', albumId: entry.albumId || '',
        discNumber: entry.discNumber || 1, track: entry.track || 0, durationSec: entry.duration ?? null,
      })),
    };
  },

  /** Gives a playlist another name. */
  renamePlaylist: async (playlistId: string, name: string): Promise<void> => {
    await request('updatePlaylist', { playlistId, name });
  },

  deletePlaylist: async (playlistId: string): Promise<void> => {
    await request('deletePlaylist', { id: playlistId });
  },

  /**
   * Writes a playlist of NAVIDROME_USER's with these songs, in this order:
   * a new one by its name, or the one given, whose songs it replaces.
   */
  savePlaylist: async (playlist: { id?: string; name: string; songIds: string[] }): Promise<string | null> => {
    const body = await request<{ playlist?: { id: string } }>('createPlaylist', {
      ...(playlist.id ? { playlistId: playlist.id } : { name: playlist.name }),
      songId: playlist.songIds,
    });
    return body.playlist?.id ?? playlist.id ?? null;
  },

  /** The comment Navidrome and Amperfy show under a playlist's name. */
  setPlaylistComment: async (playlistId: string, comment: string): Promise<void> => {
    await request('updatePlaylist', { playlistId, comment });
  },

  /** The files of one album, with what a rip is judged by: format, bit depth, sampling rate. */
  getAlbumSongs: async (albumId: string): Promise<NavidromeTrackFile[]> => {
    const body = await request<{ album?: { song?: RawAlbumSong[] } }>('getAlbum', { id: albumId });
    return (body.album?.song || []).map(song => ({
      id: song.id || null,
      url: song.title ? navidromeService.songUrl(albumId, song.title) : null,
      discNumber: song.discNumber || 1,
      track: song.track || 0,
      title: song.title || '',
      artist: song.artist || null,
      musicbrainzRecordingId: song.musicBrainzId || null,
      // One tag can hold every ISRC of the recording, joined by semicolons.
      isrc: song.isrc?.flatMap(codes => codes.split(';')).map(code => code.trim()).find(Boolean) ?? null,
      durationSec: song.duration ?? null,
      suffix: (song.suffix || '').toLowerCase(),
      bitRate: song.bitRate || null,
      bitDepth: song.bitDepth || null,
      samplingRate: song.samplingRate || null,
      channelCount: song.channelCount || null,
      size: song.size || null,
      path: song.path || null,
      playCount: song.playCount || 0,
      played: song.played || null,
      userRating: song.userRating || 0,
      starred: Boolean(song.starred),
    }));
  },

  /**
   * Every song with its format and how NAVIDROME_USER listened to it: an
   * empty search3 query lists the whole library in Navidrome.
   */
  getSongs: async (): Promise<NavidromeSong[]> => {
    const songs: NavidromeSong[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const body = await request<{ searchResult3?: { song?: RawSong[] } }>('search3', {
        query: '', songCount: PAGE_SIZE, songOffset: offset, albumCount: 0, artistCount: 0,
      });
      const page = body.searchResult3?.song || [];
      songs.push(...page.filter(song => song.albumId).map(song => ({
        albumId: song.albumId!, id: song.id, suffix: (song.suffix || '').toLowerCase(), bitDepth: song.bitDepth || null,
        bitRate: song.bitRate || null, samplingRate: song.samplingRate || null,
        discNumber: song.discNumber || 1, track: song.track || 0, durationSec: song.duration ?? null,
        playCount: song.playCount || 0, played: song.played || null, userRating: song.userRating || 0, starred: Boolean(song.starred),
        title: song.title || '', artist: song.artist || '',
      })));
      if (page.length < PAGE_SIZE) return songs;
    }
  },
};

export default navidromeService;
