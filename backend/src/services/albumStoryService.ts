import axios from 'axios';
import Album from '../models/album';
import AlbumStory, { AlbumStoryRow, ArticleLink, NotFoundReason, StorySection, WorkStory } from '../models/albumStory';
import musicbrainzService from './musicbrainzService';
import musicbrainzLinkService from './musicbrainzLinkService';
import logger from '../logger';

export interface AlbumStoryResult {
  albumId: number;
  found: boolean;
  reason: NotFoundReason | null;
  lang: string | null;
  title: string | null;
  url: string | null;
  intro: string | null;
  sections: StorySection[];
  /** Only when the album has no article of its own. */
  works: WorkStory[];
  /** Every language the album has an article in, the one told above among them. */
  links: ArticleLink[];
  fetchedAt: string;
}

interface Article {
  lang: string;
  title: string;
}

/** The languages read and linked, in the order their links are shown. */
const PREFERRED_WIKIS = ['frwiki', 'enwiki'];

/** A story found stays until refreshed by hand; a miss is retried after a month, articles get written. */
const RETRY_MISS_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sections that list or reference rather than tell: credits, track listings,
 * charts. A subsection inherits the decision of its section, so the band
 * members listed under "Personnel" go with it.
 */
const SKIPPED_SECTIONS = new Set([
  // English
  'track listing', 'tracklisting', 'personnel', 'credits', 'musicians', 'technical', 'artwork',
  'charts', 'weekly charts', 'year-end charts', 'certifications', 'certifications and sales', 'sales',
  'release history', 'sample credits', 'accolades', 'references', 'notes', 'citations', 'sources',
  'external links', 'see also', 'bibliography', 'further reading', 'footnotes', 'notes and references',
  // Works: casts, numbers and recordings are lists too
  'roles', 'musical numbers', 'instrumentation', 'scoring', 'recordings', 'discography',
  'selected recordings', 'available editions and recordings',
  // French
  'liste des titres', 'liste des pistes', 'titres', 'musiciens', 'crédits', 'classements',
  'classements hebdomadaires', 'notes et références', 'références', 'liens externes', 'voir aussi',
  'rôles', 'distribution', 'discographie', 'bibliographie', 'enregistrements',
]);

const userAgent = (): string => musicbrainzService.userAgent;

const articleUrl = ({ lang, title }: Article): string =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** "https://en.wikipedia.org/wiki/Invisible_Touch" → { lang: 'en', title: 'Invisible Touch' } */
const parseArticleUrl = (url: string): Article | null => {
  const match = url.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!match) return null;
  return { lang: match[1], title: decodeURIComponent(match[2]).replace(/_/g, ' ') };
};

/** Splits a plain-text extract on its "== Heading ==" lines and keeps the narrative sections. */
const parseExtract = (extract: string): { intro: string; sections: StorySection[] } => {
  const clean = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim();
  const parts: StorySection[] = [];
  let intro = '';
  let current: StorySection | null = null;

  for (const line of extract.split('\n')) {
    const heading = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
    if (heading) {
      current = { heading: heading[2], level: heading[1].length, text: '' };
      parts.push(current);
    } else if (current) {
      current.text += line + '\n';
    } else {
      intro += line + '\n';
    }
  }

  let skipBelow: number | null = null;
  const kept = parts.filter(section => {
    if (skipBelow !== null && section.level > skipBelow) return false;
    skipBelow = null;
    if (SKIPPED_SECTIONS.has(section.heading.toLowerCase())) {
      skipBelow = section.level;
      return false;
    }
    section.text = clean(section.text);
    return true;
  });

  // An empty heading is only worth keeping as the parent of a kept subsection.
  const sections = kept.filter((section, i) => section.text !== '' || (kept[i + 1]?.level ?? 0) > section.level);
  return { intro: clean(intro), sections };
};

/** The articles of a Wikidata item in the languages read, in their order. */
const articlesOfWikidata = async (wikidataId: string): Promise<Article[]> => {
  const response = await axios.get('https://www.wikidata.org/w/api.php', {
    params: { action: 'wbgetentities', ids: wikidataId, props: 'sitelinks', sitefilter: PREFERRED_WIKIS.join('|'), format: 'json' },
    headers: { 'User-Agent': userAgent() },
    timeout: 10000,
  });
  const sitelinks: Record<string, { title: string }> = response.data?.entities?.[wikidataId]?.sitelinks ?? {};
  return PREFERRED_WIKIS
    .filter(name => sitelinks[name])
    .map(name => ({ lang: name.replace(/wiki$/, ''), title: sitelinks[name].title }));
};

const findArticles = async (releaseGroupId: string): Promise<{ articles: Article[]; wikidataId: string | null }> => {
  const links = await musicbrainzService.getReleaseGroupWikiLinks(releaseGroupId);

  if (links.wikidata) {
    const articles = await articlesOfWikidata(links.wikidata);
    if (articles.length) return { articles, wikidataId: links.wikidata };
  }

  // Older entries link the articles directly, in whatever language they were written.
  const direct = links.wikipedia.map(parseArticleUrl).filter((article): article is Article => article !== null);
  return { articles: direct, wikidataId: links.wikidata };
};

const fetchExtract = async ({ lang, title }: Article): Promise<{ title: string; extract: string } | null> => {
  const response = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
    params: { action: 'query', prop: 'extracts', explaintext: 1, redirects: 1, titles: title, format: 'json' },
    headers: { 'User-Agent': userAgent() },
    timeout: 15000,
  });
  const pages: Record<string, { title: string; extract?: string; missing?: string }> = response.data?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.extract ? { title: page.title, extract: page.extract } : null;
};

interface Told {
  lang: string;
  title: string;
  url: string;
  intro: string;
  sections: StorySection[];
  links: ArticleLink[];
}

/** What an article tells, once lists and references are set aside. */
const narrativeLength = ({ intro, sections }: { intro: string; sections: StorySection[] }): number =>
  intro.length + sections.reduce((sum, section) => sum + section.text.length, 0);

/**
 * Reads every language's article and tells the fullest: a French record is
 * often better covered in French. All of them stay linked. Ties go to the
 * first language, French.
 */
const readFullest = async (articles: Article[]): Promise<Told | null> => {
  let fullest: (Told & { length: number }) | null = null;
  const links: ArticleLink[] = [];

  for (const article of articles) {
    const page = await fetchExtract(article);
    if (!page) continue;
    const found = { lang: article.lang, title: page.title };
    const link = { ...found, url: articleUrl(found) };
    links.push(link);
    const { intro, sections } = parseExtract(page.extract);
    const length = narrativeLength({ intro, sections });
    if (!fullest || length > fullest.length) fullest = { ...link, intro, sections, links: [], length };
  }

  if (!fullest) return null;
  const { length: _length, ...told } = fullest;
  return { ...told, links };
};

/** At most this many works get a story: a recital of twenty arias is not twenty stories. */
const MAX_WORKS = 4;
/** Work lookups cost a second each; past this many distinct works the album is a song collection. */
const MAX_WORKS_TO_CLIMB = 10;
/** Parts nest: an aria in an act in an opera, a movement in a suite in a set. */
const MAX_DEPTH = 4;

type TopWork = { id: string; title: string; wikidata: string | null; tracks: number; positions: number[] };

/**
 * The works an album performs, climbed up to the whole work ("Madama
 * Butterfly", not its arias), with the number of tracks each one covers.
 * Each work is looked up once however many tracks lead to it.
 *
 * MusicBrainz also files parts under what reuses them: the Romance of Chopin's
 * first concerto is a part of "The Truman Show" soundtrack too, and "Carmina
 * Burana" a part of the "Trionfi" triptych. So a track follows the parent most
 * of the album shares, and the climb stops at the first work with an article.
 */
const findTopWorks = async (releaseId: string): Promise<TopWork[]> => {
  const trackWorks = await musicbrainzService.getReleaseTrackWorks(releaseId);

  // Start from the parents the release lookup already gave, to save a level:
  // of a part's parents, the one most tracks of the album lead to.
  const parentCounts = new Map<string, number>();
  trackWorks.flat().forEach(work => work.parentIds.forEach(id => parentCounts.set(id, (parentCounts.get(id) ?? 0) + 1)));
  const mainParent = (parentIds: string[]): string =>
    parentIds.reduce((best, id) => ((parentCounts.get(id) ?? 0) > (parentCounts.get(best) ?? 0) ? id : best));
  const startsByTrack = trackWorks.map(works => new Set(works.map(work => work.parentIds.length ? mainParent(work.parentIds) : work.id)));
  const tracksByStart = new Map<string, Set<number>>();
  startsByTrack.forEach((starts, track) => starts.forEach(id => {
    if (!tracksByStart.has(id)) tracksByStart.set(id, new Set());
    tracksByStart.get(id)!.add(track);
  }));
  const anyParts = trackWorks.some(works => works.some(work => work.parentIds.length > 0));
  if (tracksByStart.size === 0 || (!anyParts && tracksByStart.size > MAX_WORKS_TO_CLIMB)) return [];

  const climbed = new Map<string, Promise<{ id: string; title: string; wikidata: string | null }>>();
  const climb = (id: string, depth = 0): Promise<{ id: string; title: string; wikidata: string | null }> => {
    if (!climbed.has(id)) {
      climbed.set(id, musicbrainzService.getWork(id).then(work =>
        work.parentIds.length && !work.wikidata && depth < MAX_DEPTH ? climb(work.parentIds[0], depth + 1) : work));
    }
    return climbed.get(id)!;
  };

  const starts = [...tracksByStart.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, MAX_WORKS_TO_CLIMB);
  const tops = new Map<string, { work: { id: string; title: string; wikidata: string | null }; tracks: Set<number> }>();
  for (const [startId, tracks] of starts) {
    // One after the other: MusicBrainz allows a request a second, and climbs share their steps.
    const work = await climb(startId);
    const top = tops.get(work.id) ?? { work, tracks: new Set<number>() };
    tracks.forEach(track => top.tracks.add(track));
    tops.set(work.id, top);
  }

  return [...tops.values()]
    .map(({ work, tracks }) => ({
      id: work.id, title: work.title, wikidata: work.wikidata, tracks: tracks.size,
      positions: [...tracks].sort((a, b) => a - b).map(track => track + 1),
    }))
    .sort((a, b) => b.tracks - a.tracks);
};

const findWorkStories = async (releaseId: string): Promise<WorkStory[]> => {
  const stories: WorkStory[] = [];
  for (const work of await findTopWorks(releaseId)) {
    if (stories.length === MAX_WORKS) break;
    if (!work.wikidata) continue;
    const told = await readFullest(await articlesOfWikidata(work.wikidata));
    if (!told) continue;
    stories.push({ workTitle: work.title, tracks: work.tracks, positions: work.positions, ...told });
  }
  return stories;
};

/**
 * The release group comes with the album, or is looked up from its MusicBrainz
 * release, or else found from Discogs, the barcode or the title. Kept either way.
 */
const resolveReleaseGroupId = async (albumId: number): Promise<string | null> => {
  const album = await Album.findById(albumId);
  if (!album) return null;
  if (album.musicbrainzReleaseGroupId) return album.musicbrainzReleaseGroupId;

  if (album.musicbrainzReleaseId) {
    const release = await musicbrainzService.getReleaseDetails(album.musicbrainzReleaseId);
    const releaseGroupId = release['release-group']?.id ?? null;
    if (releaseGroupId) {
      await Album.setReleaseGroupId(albumId, releaseGroupId);
      return releaseGroupId;
    }
  }
  return (await musicbrainzLinkService.linkAlbum(albumId))?.releaseGroupId ?? null;
};

const toResult = (albumId: number, row: AlbumStoryRow): AlbumStoryResult => ({
  albumId,
  found: row.found === 1,
  reason: row.reason as NotFoundReason | null,
  lang: row.lang,
  title: row.title,
  url: row.url,
  intro: row.intro,
  sections: row.sections ? JSON.parse(row.sections) : [],
  works: row.works ? JSON.parse(row.works) : [],
  // Stories kept before both languages were read link the one they told.
  links: row.links ? JSON.parse(row.links) : row.url && row.lang && row.title ? [{ lang: row.lang, title: row.title, url: row.url }] : [],
  fetchedAt: row.fetched_at,
});

const fetchAndSave = async (albumId: number): Promise<void> => {
  const fetchedAt = new Date().toISOString();
  const empty = { lang: null, title: null, url: null, wikidataId: null, intro: null, sections: [], works: [], links: [], fetchedAt };
  const miss = (reason: NotFoundReason) => AlbumStory.save(albumId, { ...empty, found: false, reason });

  const releaseGroupId = await resolveReleaseGroupId(albumId);
  if (!releaseGroupId) return miss('no_musicbrainz');

  const { articles, wikidataId } = await findArticles(releaseGroupId);
  const told = await readFullest(articles);
  if (told) return AlbumStory.save(albumId, { ...empty, found: true, reason: null, wikidataId, ...told });

  // No article about the album: classical records rarely have one, but the works they play do.
  const album = await Album.findById(albumId);
  const releaseId = album?.musicbrainzReleaseId || await musicbrainzService.getFirstReleaseOfGroup(releaseGroupId);
  const works = releaseId ? await findWorkStories(releaseId) : [];
  if (works.length === 0) return miss('no_article');
  await AlbumStory.save(albumId, { ...empty, found: true, reason: null, works });
};

const searchTitles = async (lang: string, query: string): Promise<string[]> => {
  const response = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
    params: { action: 'query', list: 'search', srsearch: query, srlimit: 3, format: 'json' },
    headers: { 'User-Agent': userAgent() },
    timeout: 15000,
  });
  return (response.data?.query?.search ?? []).map((hit: { title: string }) => hit.title);
};

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The article of one song: titled after the song, alone or with its precision
 * in brackets (« Il pleut » is not « Il pleut sur Bruxelles »), naming the
 * artist, about a song, and neither the album's article nor a disambiguation page.
 */
const findSong = async (lang: string, candidates: string[], song: string, artist: string, albumTitle: string): Promise<Article | null> => {
  for (const candidate of candidates) {
    const page = await fetchExtract({ lang, title: candidate }).catch(() => null);
    if (!page) continue;
    const title = normalize(page.title);
    if (title !== normalize(song) && !title.startsWith(`${normalize(song)} (`)) continue;
    if (normalize(page.title) === normalize(albumTitle) || !page.extract.includes(artist)) continue;
    if (/\(disambiguation\)|\(homonymie\)/i.test(page.title)) continue;
    if (/\b(may (also )?refer to|peut (aussi )?(désigner|faire référence à))\b/i.test(page.extract.slice(0, 400))) continue;
    if (!/song|single|track|chanson/i.test(page.extract.slice(0, 600))) continue;
    return { lang, title: page.title };
  }
  return null;
};

/**
 * A miss is retried once old, or as soon as the album has been linked to
 * MusicBrainz since. A story kept before both languages were read is read again.
 */
const isStale = async (row: AlbumStoryRow): Promise<boolean> => {
  if (row.found === 1) return row.links === null;
  if (Date.now() - new Date(row.fetched_at).getTime() > RETRY_MISS_AFTER_MS) return true;
  return row.reason === 'no_musicbrainz' && Boolean((await Album.findById(row.album_id))?.musicbrainzReleaseGroupId);
};

const albumStoryService = {
  parseExtract,
  parseArticleUrl,

  /** The narrative of one language's article, lists and references set aside, or null when it is gone. */
  readArticle: async (link: { lang: string; title: string }): Promise<{ intro: string; sections: StorySection[] } | null> => {
    const page = await fetchExtract(link);
    return page ? parseExtract(page.extract) : null;
  },

  /** A song's articles, in English then in French, the same as the listening guide skill finds. */
  findSongArticles: async (trackTitle: string, artist: string, albumTitle: string): Promise<ArticleLink[]> => {
    const song = trackTitle.replace(/\s*\(.*?\)\s*$/, '').replace(/[’‘`´]/g, "'");
    const english = await findSong('en', [
      `${song} (${artist} song)`, `${song} (song)`, ...await searchTitles('en', `"${song}" ${artist} song`).catch(() => []),
    ], song, artist, albumTitle);
    if (!english) return [];
    const french = await findSong('fr', (await searchTitles('fr', `${song} ${artist} chanson`).catch(() => [])).slice(0, 1), song, artist, albumTitle);
    return [english, ...(french ? [french] : [])].map(article => ({ ...article, url: articleUrl(article) }));
  },

  /** Answers from the cache, fetching first when the album was never looked up or the miss is old. */
  getStory: async (albumId: number, { refresh = false } = {}): Promise<AlbumStoryResult> => {
    const cached = await AlbumStory.get(albumId);
    if (cached && !refresh && !(await isStale(cached))) return toResult(albumId, cached);

    try {
      await fetchAndSave(albumId);
    } catch (error) {
      // A service that does not answer is not a missing article: keep what we had and let it surface.
      logger.warn(`Album story not fetched for album ${albumId}: ${(error as Error).message}`);
      if (cached && !refresh) return toResult(albumId, cached);
      throw error;
    }
    return toResult(albumId, (await AlbumStory.get(albumId))!);
  },
};

export default albumStoryService;
