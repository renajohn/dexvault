import axios, { AxiosResponse } from 'axios';

interface CoverArtThumbnails {
  '1200'?: string;
  '500'?: string;
  large?: string;
  [key: string]: string | undefined;
}

interface CoverArtImage {
  front: boolean;
  back: boolean;
  image: string;
  thumbnails: CoverArtThumbnails;
}

interface CoverArtResult {
  front?: {
    url: string;
    thumbnails?: CoverArtThumbnails;
  };
  back?: {
    url: string;
    thumbnails?: CoverArtThumbnails;
  };
}

interface MBReleaseSearchResponse {
  releases: MBRawRelease[];
}

interface MBCoverArtResponse {
  images: CoverArtImage[];
}

/** Raw MusicBrainz release shape (loosely typed -- external API) */
export interface MBRawRecording {
  id: string;
  title: string;
  score?: number;
  length?: number;
  isrcs?: string[];
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
  releases?: Array<{ id: string; title?: string; 'release-group'?: { id?: string } }>;
}

interface MBRawRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  barcode?: string;
  status?: string;
  packaging?: string;
  disambiguation?: string;
  annotation?: string;
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string; 'sort-name'?: string; type?: string } }>;
  'label-info'?: Array<{ 'catalog-number'?: string; label?: { name?: string } }>;
  'catalog-number'?: string;
  media?: Array<{
    format?: string;
    tracks?: Array<{
      id: string;
      number: string;
      title: string;
      length?: number;
      isrc?: string;
      recording?: {
        id: string;
        title: string;
        isrcs?: string[];
        relations?: MBRelation[];
      };
    }>;
  }>;
  'release-group'?: {
    id?: string;
    title?: string;
    'primary-type'?: string;
    'secondary-types'?: string[];
    'first-release-date'?: string;
    genres?: Array<{ name: string }>;
    tags?: Array<{ name: string }>;
    rating?: { value?: number };
  };
  genres?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  'release-events'?: Array<{
    date?: string;
    area?: { name?: string; 'iso-3166-1-codes'?: string[] };
  }>;
  'text-representation'?: { language?: string };
  relations?: MBRelation[];
  coverArt?: CoverArtResult | null;
}

interface MBRelation {
  type: string;
  direction?: 'forward' | 'backward';
  artist?: { name: string };
  place?: { name: string };
  url?: { resource: string };
  work?: MBRawWork;
  'ordering-key'?: number;
}

interface MBRawWork {
  id: string;
  title: string;
  relations?: MBRelation[];
}

/** A work, and the works it is a part of ("Atto I" of "Madama Butterfly"). */
export interface MBWorkRef {
  id: string;
  title: string;
  parentIds: string[];
  /** The same parents, with their titles. */
  parents?: Array<{ id: string; title: string }>;
}

const workRef = (work: MBRawWork): MBWorkRef => {
  // "parts" read backward: this work is a part of the related one.
  const parents = (work.relations || [])
    .filter(relation => relation.type === 'parts' && relation.direction === 'backward' && relation.work)
    .map(relation => ({ id: relation.work!.id, title: relation.work!.title }));
  return { id: work.id, title: work.title, parentIds: parents.map(parent => parent.id), parents };
};

/** A work with its parts, in their order: the movements of a sonata, the préludes of a book. */
export interface MBWorkWithParts extends MBWorkRef {
  parts: Array<{ id: string; title: string }>;
}

/** A work as a search finds it, with who composed it. */
export interface MBWorkHit {
  id: string;
  title: string;
  score: number;
  composers: string[];
  disambiguation: string | null;
}

interface FormattedTrack {
  trackNumber: string;
  title: string;
  durationSec: number | null;
  isrc: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzTrackId: string | null;
}

interface FormattedDisc {
  number: number;
  tracks: FormattedTrack[];
}

interface ReleaseEvent {
  date: string | undefined;
  country: string | undefined;
  countryCode: string | undefined;
}

export interface FormattedRelease {
  musicbrainzReleaseId: string;
  musicbrainzReleaseGroupId: string | null;
  title: string;
  artist: string[];
  releaseYear: number | null;
  releaseGroupFirstReleaseDate: number | null;
  releaseGroupType: string | null;
  releaseGroupSecondaryTypes: string[];
  country: string | undefined;
  barcode: string | undefined;
  catalogNumber: string | undefined;
  labels: string[];
  genres: string[];
  tags: string[];
  rating: number | null;
  releaseEvents: ReleaseEvent[];
  totalDuration: number | null;
  format: string;
  packaging: string;
  status: string;
  discs: FormattedDisc[];
  discCount: number;
  editionNotes: string | null;
  coverArt: { front: string | null; back: string | null };
  producer: string[];
  engineer: string[];
  recordingLocation: string | null;
  language: string | null;
  urls: Record<string, string>;
  isrcCodes: string[];
  annotation: string | null;
}

/**
 * MusicBrainz answers 503 ("the web server is currently busy") under load, and
 * 429 when a client exceeds one request per second. Both are transient, so a
 * single attempt turns a busy minute into a failed scan for the user.
 */
const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * MusicBrainz allows one request per second per client and answers 429 beyond
 * that, so every call goes through a single queue that keeps them spaced out.
 * A little over a second, to stay clear of the boundary.
 */
const MIN_REQUEST_INTERVAL_MS = 1100;
let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const paced = <T>(request: () => Promise<T>): Promise<T> => {
  const run = async (): Promise<T> => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return request();
  };

  const result = requestChain.then(run, run);
  // Keep the queue alive regardless of how this call turns out.
  requestChain = result.then(() => undefined, () => undefined);
  return result;
};

const isTransient = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true; // network blip or timeout
  return TRANSIENT_STATUSES.includes(error.response.status);
};

const withRetry = async <T>(label: string, request: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await paced(request);
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === MAX_ATTEMPTS) break;

      const retryAfter = Number(
        axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined
      );
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RETRY_BASE_MS * Math.pow(2, attempt - 1);

      console.warn(`${label}: transient failure, retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(delay);
    }
  }

  if (isTransient(lastError)) {
    throw new Error('MusicBrainz is busy or unavailable right now. Please try again in a moment.');
  }
  throw lastError;
};

const musicbrainzService = {
  baseUrl: 'https://musicbrainz.org/ws/2',
  userAgent: 'FilmDex/1.0 (https://github.com/renajohn/filmdex)',
  coverArtBaseUrl: 'https://coverartarchive.org',

  searchRelease: async function(query: string, limit: number = 10): Promise<MBRawRelease[]> {
    try {
      const response: AxiosResponse<MBReleaseSearchResponse> = await withRetry(
        'MusicBrainz search',
        () => axios.get(`${this.baseUrl}/release`, {
          params: {
            query: query,
            limit: limit,
            fmt: 'json'
          },
          headers: {
            'User-Agent': this.userAgent
          },
          timeout: 10000
        })
      );

      const releases = response.data.releases || [];
      return releases;
    } catch (error: unknown) {
      const err = error as { message: string; code?: string };
      console.error('MusicBrainz search error:', err.message);
      if (err.code === 'ECONNABORTED') {
        throw new Error('MusicBrainz request timed out. Please try again.');
      }
      throw new Error(`Failed to search MusicBrainz: ${err.message}`);
    }
  },

  /** Recordings matching a Lucene query, each with its length and the releases it is on. */
  searchRecording: async function(query: string, limit: number = 10): Promise<MBRawRecording[]> {
    const response: AxiosResponse<{ recordings?: MBRawRecording[] }> = await withRetry(
      'MusicBrainz recording search',
      () => axios.get(`${this.baseUrl}/recording`, {
        params: { query, limit, fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return response.data.recordings || [];
  },

  getReleaseDetails: async function(releaseId: string): Promise<MBRawRelease> {
    try {
      const response: AxiosResponse<MBRawRelease> = await withRetry(
        'MusicBrainz release lookup',
        () => axios.get(`${this.baseUrl}/release/${releaseId}`, {
          params: {
            inc: 'artists+recordings+release-groups+labels+media+tags+genres+artist-rels+url-rels+work-rels+recording-rels+isrcs+annotation+ratings',
            fmt: 'json'
          },
          headers: {
            'User-Agent': this.userAgent
          },
          timeout: 10000
        })
      );

      return response.data;
    } catch (error: unknown) {
      const err = error as { message: string; code?: string; response?: { status: number; data: unknown } };
      console.error('MusicBrainz release details error:', err.message);
      if (err.response) {
        console.error('Response status:', err.response.status);
        console.error('Response data:', err.response.data);
      }
      if (err.code === 'ECONNABORTED') {
        throw new Error('MusicBrainz request timed out. Please try again.');
      }
      throw new Error(`Failed to get release details: ${err.message}`);
    }
  },

  getReleaseByBarcode: async function(barcode: string): Promise<MBRawRelease[]> {
    try {
      const response: AxiosResponse<MBReleaseSearchResponse> = await axios.get(`${this.baseUrl}/release`, {
        params: {
          query: `barcode:${barcode}`,
          inc: 'artists+labels+release-groups+tags+genres',
          fmt: 'json'
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      const releases = response.data.releases || [];

      // Fetch cover art for each release
      const releasesWithCovers: MBRawRelease[] = await Promise.all(
        releases.map(async (release: MBRawRelease): Promise<MBRawRelease> => {
          try {
            const coverArt = await this.getCoverArt(release.id);
            return { ...release, coverArt: coverArt };
          } catch (error: unknown) {
            const err = error as { message: string };
            console.warn(`Failed to fetch cover art for release ${release.id}:`, err.message);
            return { ...release, coverArt: null };
          }
        })
      );

      return releasesWithCovers;
    } catch (error: unknown) {
      const err = error as { message: string; code?: string };
      console.error('MusicBrainz barcode search error:', err.message);
      if (err.code === 'ECONNABORTED') {
        throw new Error('MusicBrainz request timed out. Please try again.');
      }
      throw new Error(`Failed to search by barcode: ${err.message}`);
    }
  },

  getReleaseByCatalogNumber: async function(catalogNumber: string): Promise<MBRawRelease[]> {
    try {
      // Remove spaces from catalog number for better search results
      const cleanCatalogNumber = catalogNumber.replace(/\s+/g, '');

      const response: AxiosResponse<MBReleaseSearchResponse> = await axios.get(`${this.baseUrl}/release`, {
        params: {
          query: `catno:${cleanCatalogNumber}`,
          inc: 'artists+recordings+release-groups+labels+media+tags+genres',
          fmt: 'json'
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      const releases = response.data.releases || [];

      // Fetch cover art for each release
      const releasesWithCovers: MBRawRelease[] = await Promise.all(
        releases.map(async (release: MBRawRelease): Promise<MBRawRelease> => {
          try {
            const coverArt = await this.getCoverArt(release.id);
            return { ...release, coverArt: coverArt };
          } catch (error: unknown) {
            const err = error as { message: string };
            console.warn(`Failed to fetch cover art for release ${release.id}:`, err.message);
            return { ...release, coverArt: null };
          }
        })
      );

      return releasesWithCovers;
    } catch (error: unknown) {
      const err = error as { message: string; code?: string };
      console.error('MusicBrainz catalog number search error:', err.message);
      if (err.code === 'ECONNABORTED') {
        throw new Error('MusicBrainz request timed out. Please try again.');
      }
      throw new Error(`Failed to search by catalog number: ${err.message}`);
    }
  },

  getCoverArt: async function(releaseId: string): Promise<CoverArtResult | null> {
    return this.fetchCoverArt(`release/${releaseId}`);
  },

  /**
   * Cover art of a release group: Cover Art Archive answers with the images of
   * the release it picked to represent the group. Many individual editions have
   * no image of their own while the group does.
   */
  getReleaseGroupCoverArt: async function(releaseGroupId: string, timeout = 10000): Promise<CoverArtResult | null> {
    return this.fetchCoverArt(`release-group/${releaseGroupId}`, timeout);
  },

  /**
   * Wikidata and Wikipedia links of a release group. MusicBrainz attaches them
   * to the album as a work of art, not to the individual editions, so a release
   * lookup never carries them.
   */
  /**
   * What MusicBrainz links to a Discogs page: a Discogs release maps to
   * MusicBrainz releases, a Discogs master to release groups. Empty when the
   * page is linked to nothing, which MusicBrainz answers with a 404.
   */
  findByDiscogsUrl: async function(discogsUrl: string): Promise<{ releaseIds: string[]; releaseGroupIds: string[] }> {
    try {
      const response: AxiosResponse<{ relations?: Array<{ release?: { id: string }; release_group?: { id: string } }> }> = await withRetry(
        'MusicBrainz URL lookup',
        () => axios.get(`${this.baseUrl}/url`, {
          params: { resource: discogsUrl, inc: 'release-rels+release-group-rels', fmt: 'json' },
          headers: { 'User-Agent': this.userAgent },
          timeout: 10000
        })
      );
      const relations = response.data.relations || [];
      return {
        releaseIds: relations.flatMap(relation => relation.release ? [relation.release.id] : []),
        releaseGroupIds: relations.flatMap(relation => relation.release_group ? [relation.release_group.id] : []),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { releaseIds: [], releaseGroupIds: [] };
      }
      throw error;
    }
  },

  /** A release of the group, for when the album only knows its release group. */
  getFirstReleaseOfGroup: async function(releaseGroupId: string): Promise<string | null> {
    const response: AxiosResponse<{ releases?: Array<{ id: string }> }> = await withRetry(
      'MusicBrainz release group releases',
      () => axios.get(`${this.baseUrl}/release-group/${releaseGroupId}`, {
        params: { inc: 'releases', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return response.data.releases?.[0]?.id ?? null;
  },

  /**
   * The editions of a release group, with what Cover Art Archive holds for
   * each (front, back), its country, date, catalog number and format: what a
   * cover chosen for an album is told apart by.
   */
  getReleasesOfGroup: async function(releaseGroupId: string): Promise<Array<{
    id: string; country: string | null; date: string | null; catalogNumber: string | null; format: string | null; front: boolean; back: boolean;
  }>> {
    type Browsed = {
      id: string; country?: string; date?: string;
      'cover-art-archive'?: { front?: boolean; back?: boolean };
      'label-info'?: Array<{ 'catalog-number'?: string }>;
      media?: Array<{ format?: string }>;
    };
    const response: AxiosResponse<{ releases?: Browsed[] }> = await withRetry(
      'MusicBrainz release group editions',
      () => axios.get(`${this.baseUrl}/release`, {
        params: { 'release-group': releaseGroupId, inc: 'labels+media', limit: 100, fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return (response.data.releases || []).map(release => ({
      id: release.id,
      country: release.country || null,
      date: release.date || null,
      catalogNumber: release['label-info']?.find(info => info['catalog-number'])?.['catalog-number'] || null,
      format: release.media?.[0]?.format || null,
      front: release['cover-art-archive']?.front === true,
      back: release['cover-art-archive']?.back === true,
    }));
  },

  /**
   * The release groups (albums, as works) of that title by that artist, best
   * first: what a search on a store's catalogue (iTunes, Deezer) is matched to.
   */
  searchReleaseGroups: async function(artist: string, title: string, limit = 5): Promise<Array<{
    id: string; title: string; artist: string; firstReleaseDate: string | null; primaryType: string | null; score: number;
  }>> {
    const quote = (value: string) => `"${value.replace(/["\\]/g, ' ')}"`;
    type Found = { id: string; title: string; score?: number; 'first-release-date'?: string; 'primary-type'?: string; 'artist-credit'?: Array<{ name: string }> };
    const response: AxiosResponse<{ 'release-groups'?: Found[] }> = await withRetry(
      'MusicBrainz release group search',
      () => axios.get(`${this.baseUrl}/release-group`, {
        params: { query: `releasegroup:${quote(title)} AND artist:${quote(artist)}`, limit, fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return (response.data['release-groups'] || []).map(group => ({
      id: group.id,
      title: group.title,
      artist: (group['artist-credit'] || []).map(credit => credit.name).join(', '),
      firstReleaseDate: group['first-release-date'] || null,
      primaryType: group['primary-type'] || null,
      score: group.score ?? 0,
    }));
  },

  /**
   * Every edition of a release group as one tells a CD apart in the hand: its
   * labels, catalog numbers, barcode, country, date, packaging (Digipak, Jewel
   * Case), the comment MusicBrainz gives it (2003 remaster, club edition), its
   * status and its media.
   */
  getEditionsOfGroup: async function(releaseGroupId: string): Promise<Array<{
    id: string; title: string; date: string | null; country: string | null; barcode: string | null;
    labels: string[]; catalogNumbers: string[]; packaging: string | null; disambiguation: string | null;
    status: string | null; formats: string[]; discs: number; front: boolean;
  }>> {
    type Browsed = {
      id: string; title: string; date?: string; country?: string; barcode?: string; packaging?: string;
      disambiguation?: string; status?: string;
      'cover-art-archive'?: { front?: boolean };
      'label-info'?: Array<{ 'catalog-number'?: string; label?: { name?: string } }>;
      media?: Array<{ format?: string }>;
    };
    const response: AxiosResponse<{ releases?: Browsed[] }> = await withRetry(
      'MusicBrainz release group editions',
      () => axios.get(`${this.baseUrl}/release`, {
        params: { 'release-group': releaseGroupId, inc: 'labels+media', limit: 100, fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
    return (response.data.releases || []).map(release => ({
      id: release.id,
      title: release.title,
      date: release.date || null,
      country: release.country || null,
      barcode: release.barcode || null,
      labels: unique((release['label-info'] || []).map(info => info.label?.name)),
      catalogNumbers: unique((release['label-info'] || []).map(info => info['catalog-number'])),
      packaging: release.packaging && release.packaging !== 'None' ? release.packaging : null,
      disambiguation: release.disambiguation || null,
      status: release.status || null,
      formats: unique((release.media || []).map(medium => medium.format)),
      discs: (release.media || []).length,
      front: release['cover-art-archive']?.front === true,
    }));
  },

  /**
   * The works each track performs, with the works they are part of when
   * MusicBrainz says so: an aria is part of an act, a movement of a suite.
   */
  getReleaseTrackWorks: async function(releaseId: string): Promise<MBWorkRef[][]> {
    const response: AxiosResponse<MBRawRelease> = await withRetry(
      'MusicBrainz release works lookup',
      () => axios.get(`${this.baseUrl}/release/${releaseId}`, {
        params: { inc: 'recordings+recording-level-rels+work-rels+work-level-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 15000
      })
    );
    return (response.data.media || []).flatMap(medium => (medium.tracks || []).map(track =>
      (track.recording?.relations || [])
        .filter(relation => relation.type === 'performance' && relation.work)
        .map(relation => workRef(relation.work!))
    ));
  },

  /**
   * A release with everything needed to credit each track: its artists, the
   * work it performs and that work's composer, and who plays on the recording.
   */
  getReleaseWithCredits: async function(releaseId: string): Promise<unknown> {
    const response: AxiosResponse<unknown> = await withRetry(
      'MusicBrainz release credits lookup',
      () => axios.get(`${this.baseUrl}/release/${releaseId}`, {
        params: {
          inc: 'artist-credits+recordings+isrcs+genres+annotation+artist-rels+url-rels+place-rels+recording-level-rels+work-rels+work-level-rels+release-groups+ratings',
          fmt: 'json'
        },
        headers: { 'User-Agent': this.userAgent },
        timeout: 20000
      })
    );
    return response.data;
  },

  /** The artists a release is credited to, with the names they are filed under: "Michael, George", "Beatles, The". */
  getReleaseArtistCredits: async function(releaseId: string): Promise<Array<{ name: string; sortName: string | null; type: string | null }>> {
    const response: AxiosResponse<{ 'artist-credit'?: Array<{ name?: string; artist?: { name?: string; 'sort-name'?: string; type?: string } }> }> =
      await withRetry(
        'MusicBrainz artist credits lookup',
        () => axios.get(`${this.baseUrl}/release/${releaseId}`, {
          params: { inc: 'artist-credits', fmt: 'json' },
          headers: { 'User-Agent': this.userAgent },
          timeout: 10000
        })
      );
    return (response.data['artist-credit'] || []).map(credit => ({
      name: credit.name || credit.artist?.name || '',
      sortName: credit.artist?.['sort-name'] || null,
      type: credit.artist?.type || null,
    }));
  },

  /** The works each recording of an edition performs, by recording, with the works they are part of. */
  getReleaseRecordingWorks: async function(releaseId: string): Promise<Map<string, MBWorkRef[]>> {
    const response: AxiosResponse<MBRawRelease> = await withRetry(
      'MusicBrainz release works lookup',
      () => axios.get(`${this.baseUrl}/release/${releaseId}`, {
        params: { inc: 'recordings+recording-level-rels+work-rels+work-level-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 15000
      })
    );
    const works = new Map<string, MBWorkRef[]>();
    for (const medium of response.data.media || []) {
      for (const track of medium.tracks || []) {
        if (!track.recording?.id) continue;
        works.set(track.recording.id, (track.recording.relations || [])
          .filter(relation => relation.type === 'performance' && relation.work)
          .map(relation => workRef(relation.work!)));
      }
    }
    return works;
  },

  /** The works one recording performs: a recording found by search, on no edition of the album. */
  getRecordingWorks: async function(recordingId: string): Promise<MBWorkRef[]> {
    const response: AxiosResponse<{ relations?: MBRelation[] }> = await withRetry(
      'MusicBrainz recording works lookup',
      () => axios.get(`${this.baseUrl}/recording/${recordingId}`, {
        params: { inc: 'work-rels+work-level-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return (response.data.relations || [])
      .filter(relation => relation.type === 'performance' && relation.work)
      .map(relation => workRef(relation.work!));
  },

  /** A work with its parts in their order, and the works it is part of. */
  getWorkWithParts: async function(workId: string): Promise<MBWorkWithParts> {
    const response: AxiosResponse<MBRawWork> = await withRetry(
      'MusicBrainz work lookup',
      () => axios.get(`${this.baseUrl}/work/${workId}`, {
        params: { inc: 'work-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    const parts = (response.data.relations || [])
      .filter(relation => relation.type === 'parts' && relation.direction === 'forward' && relation.work)
      .map((relation, index) => ({ id: relation.work!.id, title: relation.work!.title, order: relation['ordering-key'] ?? 1000 + index }))
      .sort((a, b) => a.order - b.order)
      .map(({ id, title }) => ({ id, title }));
    return { ...workRef(response.data), parts };
  },

  /** Works by a search: "BWV 816" AND artist:bach, a title, a number. */
  searchWorks: async function(query: string, limit: number = 10): Promise<MBWorkHit[]> {
    const response: AxiosResponse<{ works?: Array<MBRawWork & { score?: number; disambiguation?: string }> }> = await withRetry(
      'MusicBrainz work search',
      () => axios.get(`${this.baseUrl}/work`, {
        params: { query, limit, fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    return (response.data.works || []).map(work => ({
      id: work.id,
      title: work.title,
      score: work.score ?? 0,
      composers: [...new Set((work.relations || []).filter(relation => relation.type === 'composer' && relation.artist?.name).map(relation => relation.artist!.name))],
      disambiguation: work.disambiguation || null,
    }));
  },

  /** A work with the works it is part of and its Wikidata id. */
  getWork: async function(workId: string): Promise<MBWorkRef & { wikidata: string | null }> {
    const response: AxiosResponse<MBRawWork> = await withRetry(
      'MusicBrainz work lookup',
      () => axios.get(`${this.baseUrl}/work/${workId}`, {
        params: { inc: 'work-rels+url-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    const wikidata = (response.data.relations || [])
      .find(relation => relation.type === 'wikidata' && relation.url?.resource)
      ?.url!.resource.match(/Q\d+$/)?.[0] ?? null;
    return { ...workRef(response.data), wikidata };
  },

  /** The community's rating of a release group, 0 to 5, and how many voted; null when nobody did. */
  getReleaseGroupRating: async function(releaseGroupId: string): Promise<{ value: number | null; votes: number }> {
    const response: AxiosResponse<{ rating?: { value?: number | null; 'votes-count'?: number } }> = await withRetry(
      'MusicBrainz release group rating',
      () => axios.get(`${this.baseUrl}/release-group/${releaseGroupId}`, {
        params: { inc: 'ratings', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );
    const rating = response.data.rating;
    return { value: typeof rating?.value === 'number' ? rating.value : null, votes: rating?.['votes-count'] ?? 0 };
  },

  getReleaseGroupWikiLinks: async function(releaseGroupId: string): Promise<{ wikidata: string | null; wikipedia: string[] }> {
    const response: AxiosResponse<{ relations?: Array<{ type: string; url?: { resource: string } }> }> = await withRetry(
      'MusicBrainz release group lookup',
      () => axios.get(`${this.baseUrl}/release-group/${releaseGroupId}`, {
        params: { inc: 'url-rels', fmt: 'json' },
        headers: { 'User-Agent': this.userAgent },
        timeout: 10000
      })
    );

    const relations = response.data.relations || [];
    const resources = (type: string) => relations
      .filter(relation => relation.type === type && relation.url?.resource)
      .map(relation => relation.url!.resource);
    const wikidata = resources('wikidata')[0]?.match(/Q\d+$/)?.[0] ?? null;
    return { wikidata, wikipedia: resources('wikipedia') };
  },

  fetchCoverArt: async function(resourcePath: string, timeout = 10000): Promise<CoverArtResult | null> {
    try {
      const response: AxiosResponse<MBCoverArtResponse | string> = await axios.get(`${this.coverArtBaseUrl}/${resourcePath}`, {
        headers: {
          'User-Agent': this.userAgent
        },
        timeout,
        maxRedirects: 5,
        validateStatus: function (status: number): boolean {
          return status >= 200 && status < 300;
        }
      });

      // Handle redirect responses that point to archive.org
      if (typeof response.data === 'string' && response.data.includes('archive.org')) {
        console.log(`Cover Art Archive redirected to archive.org for ${resourcePath}`);
        const archiveMatch = response.data.match(/https?:\/\/archive\.org\/download\/[^"'\s]+/);
        if (archiveMatch) {
          const archiveUrl = archiveMatch[0];
          console.log(`Extracted archive.org URL: ${archiveUrl}`);
          return {
            front: {
              url: archiveUrl
            }
          };
        }
        return null;
      }

      const data = response.data as MBCoverArtResponse;
      const images = data.images || [];

      // Find front and back cover images
      const frontCover = images.find((img: CoverArtImage) => img.front === true);
      const backCover = images.find((img: CoverArtImage) => img.back === true);

      const result: CoverArtResult = {};

      if (frontCover) {
        result.front = {
          url: frontCover.thumbnails['1200'] || frontCover.thumbnails['500'] || frontCover.thumbnails['large'] || frontCover.image,
          thumbnails: frontCover.thumbnails
        };
      }

      if (backCover) {
        result.back = {
          url: backCover.thumbnails['1200'] || backCover.thumbnails['500'] || backCover.thumbnails['large'] || backCover.image,
          thumbnails: backCover.thumbnails
        };
      }

      // Return null if no covers found, otherwise return the result object
      return Object.keys(result).length > 0 ? result : null;
    } catch (error: unknown) {
      const err = error as { message: string };
      console.error('Cover Art Archive error:', err.message);
      // Don't throw error for cover art - it's optional
      return null;
    }
  },

  formatReleaseData: (release: MBRawRelease): FormattedRelease => {
    const artists = release['artist-credit']?.map(credit => credit.name || credit.artist?.name).filter(Boolean) as string[] || [];

    // Extract tracks from all media (discs)
    const discs: FormattedDisc[] = [];
    if (release.media && release.media.length > 0) {
      release.media.forEach((media, discIndex) => {
        const tracks: FormattedTrack[] = media.tracks?.map(track => ({
          trackNumber: track.number,
          title: track.title,
          durationSec: track.length ? Math.floor(track.length / 1000) : null,
          isrc: track.isrc || null,
          musicbrainzRecordingId: track.recording?.id || null,
          musicbrainzTrackId: track.id || null
        })) || [];

        discs.push({
          number: discIndex + 1,
          tracks: tracks
        });
      });
    }

    // Extract labels
    const labels = release['label-info']?.map(labelInfo => labelInfo.label?.name).filter(Boolean) as string[] || [];

    // Extract genres from multiple sources for better coverage
    const releaseGroupGenres = release['release-group']?.genres?.map(genre => genre.name) || [];
    const releaseGenres = release.genres?.map(genre => genre.name) || [];
    const genres = [...new Set([...releaseGroupGenres, ...releaseGenres])];

    // Extract tags for additional metadata
    const releaseGroupTags = release['release-group']?.tags?.map(tag => tag.name) || [];
    const releaseTags = release.tags?.map(tag => tag.name) || [];
    const tags = [...new Set([...releaseGroupTags, ...releaseTags])].slice(0, 20);

    // Extract release group rating
    const rating = release['release-group']?.rating?.value ?
      Math.round(release['release-group'].rating!.value! * 20) / 20 : null;

    // Extract country and catalog number
    const country = release.country;
    const catalogNumber = release['label-info']?.[0]?.['catalog-number'] || release['catalog-number'];

    // Extract release events
    const releaseEvents: ReleaseEvent[] = release['release-events']?.map(event => ({
      date: event.date,
      country: event.area?.name,
      countryCode: event.area?.['iso-3166-1-codes']?.[0]
    })) || [];

    // Extract total duration
    const totalDuration = release.media?.reduce((total, media) => {
      return total + (media.tracks?.reduce((discTotal, track) => {
        return discTotal + (track.length || 0);
      }, 0) || 0);
    }, 0) || null;

    // Extract format and packaging info
    const format = release.media?.[0]?.format || 'Unknown';
    const packaging = release.packaging || 'None';
    const status = release.status || 'Unknown';

    // Extract release group first release date
    const releaseGroupFirstReleaseDate = release['release-group']?.['first-release-date']
      ? new Date(release['release-group']['first-release-date']).getFullYear()
      : null;

    // Extract release group type
    const releaseGroupType = release['release-group']?.['primary-type'] || null;
    const releaseGroupSecondaryTypes = release['release-group']?.['secondary-types'] || [];

    // Extract relationship data (credits, URLs, etc.)
    const producer: string[] = [];
    const engineer: string[] = [];
    let recordingLocation: string | null = null;
    const urls: Record<string, string> = {};

    // Extract credits from artist relationships
    if (release.relations) {
      release.relations.forEach(relation => {
        if (relation.type === 'producer' && relation.artist) {
          producer.push(relation.artist.name);
        } else if (relation.type === 'engineer' && relation.artist) {
          engineer.push(relation.artist.name);
        } else if (relation.type === 'recorded at' && relation.place) {
          recordingLocation = relation.place.name;
        }
      });
    }

    // Extract URLs from URL relationships
    if (release.relations) {
      release.relations.forEach(relation => {
        if (relation.type && relation.url) {
          const urlType = relation.type;
          if (urlType === 'discogs' || urlType === 'wikipedia' || urlType === 'wikidata' ||
              urlType === 'official homepage' || urlType === 'purchase for download' ||
              urlType === 'allmusic' || urlType === 'streaming music') {
            urls[urlType] = relation.url.resource;
          }
        }
      });
    }

    // Extract recording relationships from media tracks
    if (release.media) {
      release.media.forEach(media => {
        media.tracks?.forEach(track => {
          if (track.recording?.relations) {
            track.recording.relations.forEach(relation => {
              if (relation.type === 'producer' && relation.artist && !producer.includes(relation.artist.name)) {
                producer.push(relation.artist.name);
              } else if (relation.type === 'engineer' && relation.artist && !engineer.includes(relation.artist.name)) {
                engineer.push(relation.artist.name);
              } else if (relation.type === 'recorded at' && relation.place && !recordingLocation) {
                recordingLocation = relation.place.name;
              }
            });
          }
        });
      });
    }

    // Extract ISRC codes from tracks
    const isrcCodes: string[] = [];
    if (release.media) {
      release.media.forEach(media => {
        media.tracks?.forEach(track => {
          if (track.recording?.isrcs) {
            track.recording.isrcs.forEach(isrc => {
              if (!isrcCodes.includes(isrc)) {
                isrcCodes.push(isrc);
              }
            });
          }
        });
      });
    }

    // Extract language
    const language = release['text-representation']?.language || null;

    // Extract annotation
    const annotation = release.annotation || null;

    const result: FormattedRelease = {
      musicbrainzReleaseId: release.id,
      musicbrainzReleaseGroupId: release['release-group']?.id || null,
      title: release.title,
      artist: artists,
      releaseYear: release.date ? new Date(release.date).getFullYear() : null,
      releaseGroupFirstReleaseDate: releaseGroupFirstReleaseDate,
      releaseGroupType: releaseGroupType,
      releaseGroupSecondaryTypes: releaseGroupSecondaryTypes,
      country: country,
      barcode: release.barcode,
      catalogNumber: catalogNumber,
      labels: labels,
      genres: genres,
      tags: tags,
      rating: rating,
      releaseEvents: releaseEvents,
      totalDuration: totalDuration ? Math.floor(totalDuration / 1000) : null,
      format: format,
      packaging: packaging,
      status: status,
      discs: discs,
      discCount: release.media?.length || 1,
      editionNotes: release.disambiguation || null,
      coverArt: {
        front: release.coverArt?.front?.url || null,
        back: release.coverArt?.back?.url || null
      },
      producer: producer,
      engineer: engineer,
      recordingLocation: recordingLocation,
      language: language,
      urls: urls,
      isrcCodes: isrcCodes,
      annotation: annotation
    };

    return result;
  },
};

export default musicbrainzService;
