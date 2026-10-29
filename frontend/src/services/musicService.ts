import { ALBUM_RATED_EVENT } from './ratedEvents';

/** Listen Next's two lists: streamed (digital), and CDs to put on the player. */
export type ListenNextMedium = 'digital' | 'cd';
/** What a draw for Listen Next takes: everything but classical (pop), classical alone, or both. */
export type ClassicalChoice = 'pop' | 'classical' | 'both';

/** A cover an album missing one can take, as the server found it. */
export interface CoverCandidate {
  url: string;
  thumbnail: string;
  /** "This edition", "Other edition", "Discogs", "Discogs master", "Deezer". */
  source: string;
  country: string | null;
  year: string | null;
  catalogNumber: string | null;
}

export interface AlbumStorySection {
  heading: string;
  level: number;
  text: string;
}

/** One language's article about the same subject. */
export interface AlbumStoryLink {
  lang: string;
  title: string;
  url: string;
}

export interface AlbumWorkStory {
  workTitle: string;
  tracks: number;
  lang: string;
  title: string;
  url: string;
  intro: string;
  sections: AlbumStorySection[];
  /** Every language the work has an article in, the one told above among them. */
  links?: AlbumStoryLink[];
}

/** Who wrote a listening guide. */
export type AlbumGuideSource = 'claude' | 'local_llm' | 'manual';

/** What to know before listening to a CD. */
export interface AlbumGuide {
  albumId: number;
  /** Markdown: "###" headings, "**bold**", "*italic*" and "-" bullets. */
  text: string;
  source: AlbumGuideSource;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlbumStory {
  albumId: number;
  found: boolean;
  reason: 'no_musicbrainz' | 'no_article' | null;
  lang: string | null;
  title: string | null;
  url: string | null;
  intro: string | null;
  sections: AlbumStorySection[];
  /** Only when the album has no article of its own. */
  works: AlbumWorkStory[];
  /** Every language the album has an article in, the one told above among them. */
  links?: AlbumStoryLink[];
  fetchedAt: string;
}

/** An edition DexVault took from a rip tagged by Picard, or why it left the album alone. */
export interface EditionAdoption {
  albumId: number | null;
  title: string;
  releaseId: string;
  action?: 'edition' | 'promoted' | 'added';
  previousReleaseId?: string | null;
  skipped?: 'no_release_group' | 'not_a_cd' | 'several_albums' | 'edition_taken' | 'failed';
}

/** One file of a CD's rip in Navidrome, matched to its track by disc and number. */
export interface RipTrackFile {
  id?: string | null;
  /** The track in Navidrome's web player. */
  url?: string | null;
  discNumber: number;
  track: number;
  title: string;
  durationSec: number | null;
  suffix: string;
  bitRate: number | null;
  bitDepth: number | null;
  samplingRate: number | null;
  channelCount: number | null;
  size: number | null;
  path: string | null;
  /** Hearted in Navidrome. */
  starred?: boolean;
}

/** An album of Listen Next played to its end, gone from the list. */
export interface ListenNextDeparture {
  id: number;
  albumId: number;
  collectionOrder: number | null;
  /** Unix seconds. */
  leftAt: number;
  /** The disc that left, 0 for the whole album. */
  disc: number;
  /** The entry now after its place in the list ("12:0", "12:2"), null at the end. */
  beforeKey: string | null;
  album: { id: number; title: string; artist?: string | string[]; cover?: string | null; [key: string]: unknown };
}

export interface AlbumLength {
  discs: number;
  tracks: number;
  durationSec: number;
  /** Tracks whose length is not known. */
  missing: number;
}

export interface ListenNextPlayState {
  repeat: boolean;
  playlistId: string | null;
  /** The playlist in Navidrome's web player. */
  playlistUrl: string | null;
  departures: ListenNextDeparture[];
  /** The albums of Listen Next the player can play. */
  ripped: number[];
  /** By entry key ("12:0", "12:2"): a disc's own length for a disc. */
  lengths: Record<string, AlbumLength>;
  /** The mixtapes that play shuffled from Listen Next. */
  shuffled: number[];
}

export type RatingSync = 'synced' | 'not_ripped' | 'not_configured' | 'failed';

/** One entry of a CD's listening journal. */
export interface AlbumNote {
  id: number;
  albumId: number;
  note: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

/** A track's words as DexVault keeps them, from LRCLIB. */
export interface TrackLyrics {
  status: 'found' | 'instrumental' | 'missing';
  plain: string | null;
  /** LRC, "[mm:ss.xx] line", when the source times its lines: the timing fixed by hand, when it was. */
  synced: string | null;
  /** LRCLIB's own timing, under the one fixed by hand. */
  lrclibSynced?: string | null;
  /** LRCLIB's timing, fixed by hand in DexVault, or saved into the lyrics (the .lrc beside the rip). */
  timing?: 'lrclib' | 'fixed' | 'saved';
  /** Another of LRCLIB's texts, chosen by hand. */
  chosen?: boolean;
  source: string | null;
  sourceId?: string | null;
  checkedAt: string;
}

/** One of LRCLIB's texts for a track, to choose another. */
export interface LyricsVersion {
  id: string;
  artist: string;
  album: string;
  durationSec: number | null;
  timed: boolean;
  lines: number;
  preview: string[];
  copies: number;
  current: boolean;
  /** How much later it sings than the text the track has now, both timed. */
  lag: number | null;
  /** How many of its lines the words in use have not: 0, the same words. */
  changed: number | null;
  /** The first of those lines. */
  differing: string[];
  /** The whole text, to try it on the song. */
  synced: string | null;
  plain: string | null;
}

/** A timing kept, and what became of the .lrc beside the rip: rewritten, left as someone else wrote it, or none to write. */
export interface TimingKept {
  lyrics: TrackLyrics;
  lrc: 'written' | 'kept' | 'none';
}

/** Whether a track has words, for its row: "pending" while DexVault looks them up. */
export interface TrackLyricsState {
  discNumber: number;
  trackNumber: number;
  status: TrackLyrics['status'] | 'pending';
}

/** Another album of the collection holding some of an album's tracks. */
export interface AlbumOverlap {
  id: number;
  title: string;
  artist: string[];
  cover: string | null;
  titleStatus: string;
  format: string | null;
  /** How many of the album's tracks it holds too, and how many tracks it has. */
  shared: number;
  trackCount: number;
  tracks: Array<{ disc: number; no: number; title: string }>;
}

export interface RipTracks {
  configured: boolean;
  found: boolean;
  album?: { id: string; name: string; url?: string };
  tracks: RipTrackFile[];
}

/**
 * How good an album's files are: every file lossless; compressed at 256 kbps
 * or more on average; compressed below that.
 */
export type DigitalQuality = 'lossless' | 'near' | 'lossy';

/** An album of Navidrome: its files, its CD if one is in the collection, and whether to buy it. */
export interface DigitalAlbum {
  navidromeId: string;
  name: string;
  artist: string;
  songCount: number;
  /** The album in Navidrome's web player. */
  url: string;
  formats: string[];
  quality: DigitalQuality;
  /** Average bitrate of the compressed files, in kbps. */
  bitRate: number | null;
  hiRes: boolean;
  cd: { id: number; title: string; artist: string[]; cover: string | null; format: string | null; match: 'musicbrainz' | 'title' | 'tracks' } | null;
  /** An old compressed copy of the same CD is still in Navidrome. */
  oldCopy: boolean;
  wishAlbumId: number | null;
  /** The album of DexVault standing for it: the CD, the wish, or the digital album. */
  albumId: number | null;
  rating: number;
  starred: boolean;
  favouriteTracks: number;
  listening: { favourites: number; needed: number; plays: number; lastPlayed: string | null; score: number };
  buy: { listened: boolean; rated: boolean; wished: boolean } | null;
  dismissed: boolean;
}

export interface DigitalLibrary {
  configured: boolean;
  error?: string;
  albums: DigitalAlbum[];
  physicalOnly: Array<{ id: number; title: string; artist: string[]; cover: string | null }>;
  oldCopies: Array<{ albumId: number; title: string; navidromeId: string; name: string; formats: string[] }>;
  /** What the DexVault plugin in Navidrome reports; absent or null until it first has. */
  plugin?: { accounts: string[]; lastReportAt: number | null; stale: boolean } | null;
}

/** A track of a Navidrome album with its plays of the last 90 days. */
export interface DigitalTrack {
  id: string | null;
  url: string | null;
  discNumber: number;
  track: number;
  title: string;
  durationSec: number | null;
  suffix: string;
  bitRate: number | null;
  bitDepth: number | null;
  samplingRate: number | null;
  /** Plays over the last 90 days, and all plays ever. */
  plays: number;
  totalPlays: number;
  lastPlayed: string | null;
  rating: number;
  starred: boolean;
}

/** A mixtape as MusicDex and the toggles of a CD's tracks know it: its album, its playlist, its songs' ids in order. */
export interface MixtapeSummary {
  album: { id: number; title: string; artist: string[]; cover?: string | null; titleStatus: string; [key: string]: unknown };
  playlistId: string;
  songIds: string[];
}

/** A song of a mixtape, with the CD or digital album of DexVault it comes from. */
export interface MixtapeSong {
  songId: string;
  title: string;
  artist: string;
  album: string;
  navidromeAlbumId: string;
  discNumber: number;
  track: number;
  durationSec: number | null;
  albumId: number | null;
  cover: string | null;
}

export interface MixtapeDetails {
  album: MixtapeSummary['album'];
  playlistId: string;
  /** The playlist in Navidrome's web player. */
  url: string;
  songs: MixtapeSong[];
  /** Played shuffled from Listen Next: its songs' places in the order drawn; null in its own. */
  listenNextOrder?: number[] | null;
}

/** A change to a mixtape's songs: added at the end without a second copy, every copy removed, one copy removed, moved, or all of them anew. */
export type MixtapeEdit =
  | { add: string[] }
  | { remove: string[] }
  | { removeAt: number }
  | { move: { from: number; to: number } }
  | { songs: string[] };

class MusicService {
  async getBaseUrl(): Promise<string> {
    return '/api';
  }

  /** Every album of Navidrome and how it stands; refresh rereads the library instead of the minute-old copy. */
  async getDigitalLibrary(refresh = false): Promise<DigitalLibrary> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/digital${refresh ? '?refresh=1' : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  /** Rereads Navidrome, which notes the plays since, and takes the editions Picard identified the ripped CDs as. */
  async syncDigitalLibrary(): Promise<{ editions: EditionAdoption[]; library: DigitalLibrary }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/digital/sync`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  /** Puts an album with no CD on the wish list, or takes it off. */
  setDigitalWished(navidromeId: string, wished: boolean): Promise<DigitalAlbum> {
    return this.send(`/music/digital/${encodeURIComponent(navidromeId)}/wish`, wished ? 'PUT' : 'DELETE');
  }

  /** "I bought the CD": a digital or wished album becomes a CD of the collection, the same album. */
  markAlbumBought(albumId: number | string, purchase: Record<string, unknown>): Promise<unknown> {
    return this.send(`/music/albums/${albumId}/bought`, 'POST', purchase);
  }

  /** The digital and wished albums a CD about to be added would be: the same edition, release group, or title and artist. */
  findAttachableAlbums(query: { releaseId?: string | null; barcode?: string | null; title?: string | null; artist?: string[] | string | null }): Promise<Array<{ id: number; title: string; artist: string[]; cover?: string | null; titleStatus?: string | null }>> {
    return this.send('/music/attachable-albums', 'POST', query);
  }

  /** "Not interested": the album leaves the Buy tab however much it is played, until undone. */
  setDigitalDismissed(navidromeId: string, dismissed: boolean): Promise<DigitalAlbum> {
    return this.send(`/music/digital/${encodeURIComponent(navidromeId)}/dismiss`, dismissed ? 'PUT' : 'DELETE');
  }

  /** An album's tracks with their plays of the last 90 days. */
  async getDigitalTracks(navidromeId: string): Promise<DigitalTrack[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/digital/${encodeURIComponent(navidromeId)}/tracks`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()).tracks;
  }

  /** The cover Navidrome shows for one of its albums. */
  navidromeCoverUrl(navidromeId: string): string {
    return `/api/music/navidrome-cover/${encodeURIComponent(navidromeId)}`;
  }

  async getAllAlbums(): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching albums:', error);
      throw error;
    }
  }

  async getAlbumsByStatus(status: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/status/${status}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching albums by status:', error);
      throw error;
    }
  }

  async updateAlbumStatus(id: number | string, status: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error updating album status:', error);
      throw error;
    }
  }

  // A wish already taken care of (ordered, a bid made, a gift to come)
  async setAlbumSpokenFor(id: number | string, spokenFor: boolean): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${id}/spoken-for`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spokenFor }),
    });
    if (!response.ok) {
      throw new Error(`Failed to mark the album as spoken for: ${response.status}`);
    }
    return await response.json();
  }

  async getAlbumById(id: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${id}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching album:', error);
      throw error;
    }
  }

  /** The CDs a query finds; with `withNoCd`, as MusicDex with Digital on, the digital albums and wishes too. */
  async searchAlbums(query: string, { withNoCd = false, mixtapes = false }: { withNoCd?: boolean; mixtapes?: boolean } = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/search?q=${encodeURIComponent(query)}${withNoCd ? '&digital=1' : ''}${mixtapes ? '&mixtapes=1' : ''}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching albums:', error);
      throw error;
    }
  }

  async addAlbum(albumData: Record<string, unknown>): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(albumData),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error adding album:', error);
      throw error;
    }
  }

  async updateAlbum(id: number | string, albumData: Record<string, unknown>): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(albumData),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error updating album:', error);
      throw error;
    }
  }

  async deleteAlbum(id: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error deleting album:', error);
      throw error;
    }
  }

  async getAppleMusicUrl(albumId: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${albumId}/apple-music`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json(); // { url, cached }
    } catch (error) {
      console.error('Error getting Apple Music URL:', error);
      throw error;
    }
  }

  /** The album's story from Wikipedia; cached by the backend, refreshed on demand. */
  async getAlbumStory(albumId: number | string, refresh = false): Promise<AlbumStory> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/story${refresh ? '/refresh' : ''}`, {
      method: refresh ? 'POST' : 'GET',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  // Try to open native Apple Music app on macOS when possible, fallback to web
  openAppleMusic(url: string): void {
    try {
      const ua = navigator.userAgent || '';
      const platform = navigator.platform || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(platform) && 'ontouchend' in document);
      const isMac = /Mac/.test(platform) && !isIOS;

      const normalizeToUniversal = (u: string): string => {
        try {
          const parsed = new URL(u);
          if (parsed.hostname.includes('itunes.apple.com')) {
            parsed.hostname = 'music.apple.com';
            return parsed.toString();
          }
          return u;
        } catch {
          return u;
        }
      };

      // Best single URL for both macOS and iPhone is the universal link on music.apple.com
      // It should deep-link to the Music app without opening the App Store when the app is installed.
      const universalUrl = normalizeToUniversal(url);

      // macOS: navigate in the same window to avoid blank tabs
      if (isMac) {
        window.location.href = universalUrl;
        return;
      }

      // iOS: try deep-link schemes in sequence to wake app and select album
      if (isIOS) {
        const hostless = universalUrl.replace(/^https?:\/\//i, '');
        const candidates = [
          `music://${hostless}`,
          universalUrl,
          `itms-apps://${hostless}`
        ];
        let idx = 0;
        const tryNext = (): void => {
          if (idx >= candidates.length) return;
          const target = candidates[idx++];
          try { window.location.assign(target); } catch (_) { /* ignore */ }
          setTimeout(tryNext, 600);
        };
        tryNext();
        return;
      }

      // Others: open universal link in new tab
      window.open(universalUrl, '_blank', 'noopener');

    } catch (_) {
      window.open(url, '_blank', 'noopener');
    }
  }

  /**
   * Identify an album from a photo of its sleeve.
   * `imageBase64` must be raw base64, without the data-url prefix.
   */
  async scanAlbumCover(imageBase64: string, mimeType: string = 'image/jpeg'): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/scan-cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mimeType })
    });

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch (_) { /* keep the status-based message */ }
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return await response.json();
  }

  /**
   * Read a sleeve from photographs and get a draft for the form.
   *
   * Either photograph may be omitted. Nothing is stored server-side: the answer
   * is a proposal, and the album exists only once the form is submitted.
   */
  async transcribeSleeve(
    photos: { front?: { base64: string; mimeType: string }; back?: { base64: string; mimeType: string } }
  ): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const body: Record<string, unknown> = {};
    if (photos.front) body.front = { image: photos.front.base64, mimeType: photos.front.mimeType };
    if (photos.back) body.back = { image: photos.back.base64, mimeType: photos.back.mimeType };

    const response = await fetch(`${baseUrl}/music/transcribe-sleeve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch (_) { /* keep the status */ }
      throw new Error(message);
    }

    return response.json();
  }

  /**
   * Add a release from whichever database it was found in.
   * Search results carry `source` and `releaseId`; pass them straight through.
   */
  async addAlbumFromSource(
    source: string,
    releaseId: string,
    additionalData: Record<string, unknown> = {}
  ): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(
      `${baseUrl}/music/releases/${encodeURIComponent(source)}/${encodeURIComponent(releaseId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(additionalData)
      }
    );

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      let code: string | undefined;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
        code = body?.code;
      } catch (_) { /* keep the status-based message */ }
      const error = new Error(message) as Error & { status?: number; code?: string };
      error.status = response.status;
      error.code = code;
      throw error;
    }

    return await response.json();
  }

  async searchMusicBrainz(query: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching MusicBrainz:', error);
      throw error;
    }
  }

  async getCoverArt(releaseId: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/coverart/${encodeURIComponent(releaseId)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting cover art:', error);
      return null;
    }
  }

  /** The covers to try for an album found by a search, best first: Cover Art Archive's for its group, then Deezer's. */
  async getSearchCovers(releaseGroupId: string | null, artist: string, title: string): Promise<string[]> {
    try {
      const baseUrl = await this.getBaseUrl();
      const params = new URLSearchParams({ artist, title });
      if (releaseGroupId) params.set('releaseGroupId', releaseGroupId);
      const response = await fetch(`${baseUrl}/music/search-covers?${params}`);
      if (!response.ok) return [];
      const { urls } = await response.json();
      return Array.isArray(urls) ? urls : [];
    } catch (error) {
      console.error('Error getting the covers of a search result:', error);
      return [];
    }
  }

  async searchByCatalogNumber(catalogNumber: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/search/catalog?catalogNumber=${encodeURIComponent(catalogNumber)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching by catalog number:', error);
      throw error;
    }
  }

  async searchByBarcode(barcode: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/search/barcode?barcode=${encodeURIComponent(barcode)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching by barcode:', error);
      throw error;
    }
  }

  async getMusicBrainzReleaseDetails(releaseId: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/release/${releaseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting MusicBrainz release details:', error);
      throw error;
    }
  }

  async addAlbumFromMusicBrainz(releaseId: string, additionalData: Record<string, unknown> = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/release/${releaseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(additionalData),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
        const errorMessage = (errorData.error as string) || `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }
      return await response.json();
    } catch (error) {
      console.error('Error adding album from MusicBrainz:', error);
      throw error;
    }
  }

  async addAlbumByBarcode(barcode: string, additionalData: Record<string, unknown> = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/barcode/${barcode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(additionalData),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error adding album by barcode:', error);
      throw error;
    }
  }

  /** What a keyword may go on with; with `withNoCd`, from the digital albums too. */
  async getAutocompleteSuggestions(filterType: string, filterValue: string, { withNoCd = false }: { withNoCd?: boolean } = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(
        `${baseUrl}/music/autocomplete?field=${encodeURIComponent(filterType)}&value=${encodeURIComponent(filterValue)}${withNoCd ? '&digital=1' : ''}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching autocomplete suggestions:', error);
      throw error;
    }
  }

  /** Store a cover image. Any straightening has already been applied to it. */
  async uploadCover(albumId: number | string, file: File): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const formData = new FormData();
      formData.append('cover', file);

      const response = await fetch(`${baseUrl}/music/albums/${albumId}/upload-cover`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading cover:', error);
      throw error;
    }
  }

  /** Takes the cover Navidrome shows for this CD, the one in the rip, as the album's front cover. */
  async importNavidromeCover(albumId: number | string): Promise<{ coverPath: string }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/import-navidrome-cover`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return body;
  }

  /** The files of this CD's rip in Navidrome; found is false while it is not ripped. */
  private async send<T>(path: string, method: string, body?: unknown): Promise<T> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
    return result as T;
  }

  /** The owner's stars, 0 to take them away; Navidrome gets them too when the CD is ripped. */
  async setAlbumRating(albumId: number | string, rating: number): Promise<{ userRating: number | null; navidrome: RatingSync }> {
    const result = await this.send<{ userRating: number | null; navidrome: RatingSync }>(`/music/albums/${albumId}/rating`, 'PUT', { rating });
    window.dispatchEvent(new Event(ALBUM_RATED_EVENT));
    return result;
  }

  /** How many albums of the collection hold each number of stars, halves apart. */
  async getRatingCounts(): Promise<Array<{ stars: number; count: number }>> {
    const { counts } = await this.send<{ counts: Array<{ stars: number; count: number }> }>('/music/ratings/counts', 'GET');
    return counts;
  }

  /** The covers the album can take for that side: its other editions', Discogs', Deezer's. */
  async getCoverCandidates(albumId: number | string, side: 'front' | 'back'): Promise<CoverCandidate[]> {
    const { candidates } = await this.send<{ candidates: CoverCandidate[] }>(`/music/albums/${albumId}/cover-candidates?side=${side}`, 'GET');
    return candidates;
  }

  /** Makes one of those covers that side of the album; answers with its path. */
  async useCoverCandidate(albumId: number | string, side: 'front' | 'back', url: string): Promise<string> {
    const { coverPath } = await this.send<{ coverPath: string }>(`/music/albums/${albumId}/cover-candidates`, 'POST', { side, url });
    return coverPath;
  }

  /** Rereads the album's edition on MusicBrainz: its community rating, missing fields, a longer track list. */
  refreshFromMusicBrainz(albumId: number | string): Promise<unknown> {
    return this.send(`/music/albums/${albumId}/refresh-musicbrainz`, 'POST');
  }

  /** Rereads MusicBrainz's and Discogs's community ratings; answers with the album. */
  refreshCommunityRating(albumId: number | string): Promise<unknown> {
    return this.send(`/music/albums/${albumId}/community-rating`, 'POST');
  }

  /** Takes the stars given in Navidrome or Amperfy since. */
  syncAlbumRating(albumId: number | string): Promise<{ userRating: number | null }> {
    return this.send(`/music/albums/${albumId}/rating/sync`, 'POST');
  }

  /** The CD's listening guide, or null when it has none yet. */
  getAlbumGuide(albumId: number | string): Promise<AlbumGuide | null> {
    return this.send(`/music/albums/${albumId}/guide`, 'GET');
  }

  /** Keeps a guide written or edited by hand. */
  saveAlbumGuide(albumId: number | string, text: string): Promise<AlbumGuide> {
    return this.send(`/music/albums/${albumId}/guide`, 'PUT', { text, source: 'manual' });
  }

  /** Has the local LLM write the guide, replacing the current one: about a minute. */
  generateAlbumGuide(albumId: number | string): Promise<AlbumGuide> {
    return this.send(`/music/albums/${albumId}/guide/generate`, 'POST');
  }

  getAlbumNotes(albumId: number | string): Promise<AlbumNote[]> {
    return this.send(`/music/albums/${albumId}/notes`, 'GET');
  }

  addAlbumNote(albumId: number | string, note: string, date: string): Promise<AlbumNote> {
    return this.send(`/music/albums/${albumId}/notes`, 'POST', { note, date });
  }

  updateAlbumNote(id: number, note: string, date: string): Promise<AlbumNote> {
    return this.send(`/music/notes/${id}`, 'PUT', { note, date });
  }

  deleteAlbumNote(id: number): Promise<{ deleted: boolean }> {
    return this.send(`/music/notes/${id}`, 'DELETE');
  }

  async getNavidromeTracks(albumId: number | string): Promise<RipTracks> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/navidrome-tracks`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return body;
  }

  /** The other albums of the collection holding some of this album's tracks, the most first. */
  async getAlbumOverlaps(albumId: number | string): Promise<AlbumOverlap[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/overlaps`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return body;
  }

  /** A track's words, looked up as it is asked when they never were; `again` looks them up anew. */
  async getLyrics(albumId: number | string, disc: number, track: number, again = false): Promise<TrackLyrics> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/discs/${disc}/tracks/${track}/lyrics`, { method: again ? 'POST' : 'GET' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return body;
  }

  /** A track's lines retimed by hand; `intoLyrics` writes them into the .lrc beside the rip too. */
  fixLyricsTiming(albumId: number | string, disc: number, track: number, synced: string, intoLyrics: boolean): Promise<TimingKept> {
    return this.send(`/music/albums/${albumId}/discs/${disc}/tracks/${track}/lyrics/timing`, 'PUT', { synced, intoLyrics });
  }

  /** LRCLIB's texts for a track, to choose another; the one it has first. */
  getLyricsVersions(albumId: number | string, disc: number, track: number): Promise<{ durationSec: number | null; versions: LyricsVersion[] }> {
    return this.send(`/music/albums/${albumId}/discs/${disc}/tracks/${track}/lyrics/versions`, 'GET');
  }

  /** Another of LRCLIB's texts, by its id, for a track. */
  chooseLyricsVersion(albumId: number | string, disc: number, track: number, sourceId: string): Promise<TimingKept> {
    return this.send(`/music/albums/${albumId}/discs/${disc}/tracks/${track}/lyrics/version`, 'PUT', { sourceId });
  }

  /** Back to LRCLIB's timing. */
  resetLyricsTiming(albumId: number | string, disc: number, track: number): Promise<TimingKept> {
    return this.send(`/music/albums/${albumId}/discs/${disc}/tracks/${track}/lyrics/timing`, 'DELETE');
  }

  /** Whether each track of an album has words; those never looked up are, in the background, and come back "pending". */
  async getAlbumLyrics(albumId: number | string): Promise<TrackLyricsState[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/albums/${albumId}/lyrics`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP error! status: ${response.status}`);
    }
    return body.tracks || [];
  }

  /** As uploadCover, for the back. */
  async uploadBackCover(albumId: number | string, file: File): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const formData = new FormData();
      // Backend middleware expects the field name 'cover' for both endpoints
      formData.append('cover', file);

      const response = await fetch(`${baseUrl}/music/albums/${albumId}/upload-back-cover`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading back cover:', error);
      throw error;
    }
  }

  /**
   * Get the full URL for an image path
   */
  getImageUrl(imagePath: string | null | undefined): string | null {
    if (!imagePath) return null;

    // Already a full URL
    if (imagePath.startsWith('http')) {
      return imagePath;
    }

    // Local paths are served as-is
    if (imagePath.startsWith('/api/images/') || imagePath.startsWith('/images/')) {
      return imagePath;
    }

    // Default: prepend /api/images/
    return `/api/images/${imagePath}`;
  }

  /**
   * Listen Next from an album's button: with no disc, the whole album in, or
   * whatever of it is there out; a disc, that disc in or out (in place of the
   * whole album if that is there); 'all', the whole album in place of the discs chosen.
   */
  /**
   * Listen Next from an album's button: in or out, a disc, or 'all'; `medium`
   * names the list, and an album in the other one moves to it rather than leaving.
   */
  async toggleListenNext(albumId: number | string, disc?: number | 'all', medium?: ListenNextMedium): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/music/albums/${albumId}/listen-next`, disc === undefined && medium === undefined ? { method: 'PUT' } : {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disc, medium }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error toggling listen next:', error);
      throw error;
    }
  }

  async getListenNextAlbums(): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/collections/listen-next/albums`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching listen next albums:', error);
      throw error;
    }
  }

  /**
   * Smart fill Listen Next with suggested albums based on collection distribution
   * and listening history
   */
  /** Adds an album to Listen Next, picked from any album (a CD or digital alone): classical, the rest, or both. */
  async smartFillListenNext(classical: ClassicalChoice = 'pop'): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/collections/listen-next/smart-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'any', classical }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error smart filling listen next:', error);
      throw error;
    }
  }

  /**
   * Get smart playlist statistics (artist distribution, suggestion history)
   */
  async getSmartPlaylistStats(): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/collections/listen-next/stats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching smart playlist stats:', error);
      throw error;
    }
  }

  /**
   * Shuffle a specific album in Listen Next - replace it with a new suggestion
   * Classical albums are replaced with other classical albums
   * Non-classical albums are replaced with other non-classical albums
   */
  /** Playing Listen Next: Repeat, the albums leaving it, every album's length, the playlist for Amperfy. */
  async getListenNextPlay(): Promise<ListenNextPlayState> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/play`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async setListenNextRepeat(repeat: boolean): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/repeat`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeat }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  }

  /** A mixtape of Listen Next played shuffled, in an order drawn once, or in its own. */
  async setListenNextShuffled(albumId: number, shuffled: boolean): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/albums/${albumId}/shuffled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shuffled }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  }

  /** The mixtapes, Navidrome's playlists read again when they changed. */
  async getMixtapes(): Promise<{ configured: boolean; mixtapes: MixtapeSummary[] }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/mixtapes`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async getMixtape(albumId: number): Promise<MixtapeDetails> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/mixtapes/${albumId}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  /** A new mixtape in Navidrome with these songs; its album. */
  async createMixtape(name: string, songIds: string[]): Promise<MixtapeSummary['album']> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/mixtapes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, songIds }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  /** A new name, or a change to the songs; the mixtape as Navidrome now has it. */
  async updateMixtape(albumId: number, change: MixtapeEdit | { name: string }): Promise<MixtapeDetails> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/mixtapes/${albumId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async deleteMixtape(albumId: number): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/music/mixtapes/${albumId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  }

  /** ⏭ on the last track of an album, or of its disc: it leaves Listen Next as one played to its end, unless Repeat is on. */
  async markListenNextPlayed(albumId: number, disc = 0): Promise<{ left: ListenNextDeparture | null }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/played/${albumId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disc }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  /** Keep here: the album that left Listen Next goes back at its place; the list as it now is. */
  async keepListenNextDeparture(departureId: number): Promise<{ albums: unknown[] }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/departures/${departureId}/keep`, { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  /** Listen Next in the order given, dragged on its banner; the list as the server now has it. */
  /** An entry of Listen Next dragged to a list, before the one named, else at its start or its end: the lists as they now are. */
  async moveListenNext(key: string, medium: ListenNextMedium, at: 'start' | 'end', before?: string | null): Promise<{ albums: unknown[] }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, medium, at, ...(before ? { before } : {}) }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async reorderListenNext(keys: string[]): Promise<{ albums: unknown[] }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/collections/listen-next/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async shuffleListenNextAlbum(albumId: number | string, classical?: ClassicalChoice): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/collections/listen-next/shuffle/${albumId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classical }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error shuffling listen next album:', error);
      throw error;
    }
  }
}

const musicServiceInstance = new MusicService();
export default musicServiceInstance;
