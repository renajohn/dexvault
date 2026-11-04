import axios from 'axios';
import Album from '../models/album';
import AlbumGuide, { AlbumGuideFormatted, GuideSource } from '../models/albumGuide';
import albumStoryService, { AlbumStoryResult } from './albumStoryService';
import musicService from './musicService';
import { getConfig, requestFailure } from './coverScanService';
import { inTurn } from '../utils/localLlmQueue';
import trackFicheService from './trackFicheService';
import logger from '../logger';

/**
 * Albums catalogued before guides existed get theirs from Claude; the local
 * LLM writes them for the classical albums added since, and on demand.
 */
const GUIDES_SINCE = '2026-10-08';
const AUTO_WRITE_EVERY_MS = 30 * 60 * 1000;
/** A failed album is left alone this long before the auto-writer tries it again. */
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;
/** Wikipedia text handed to the model, all articles together: the prompt stays well inside its context. */
const SOURCE_BUDGET = 24000;
const MIN_PER_ARTICLE = 4000;
const LLM_TIMEOUT_SEC = 300;

const CLASSICAL_GENRES = ['classical', 'baroque', 'romantic', 'opera', 'chamber', 'choral', 'renaissance', 'impressionis', 'orchestral'];

type Message = { role: 'system' | 'user'; content: string };
type Claim = { claim: string; verdict: 'supported' | 'contradicted' | 'unsupported'; evidence: string };
type Track = { no: number; title: string; durationSec: number | null; performers?: Array<{ name: string; role: string }> };

const chat = async (messages: Message[], maxTokens: number, temperature: number, json = false): Promise<string> => {
  const { baseUrl, model } = getConfig();
  try {
    const response = await axios.post(`${baseUrl}/v1/chat/completions`, {
      model, messages, max_tokens: maxTokens, temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }, { timeout: LLM_TIMEOUT_SEC * 1000 });
    const text: string | undefined = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('The local LLM answered with nothing');
    return text;
  } catch (error) {
    throw requestFailure(error);
  }
};

const minutes = (seconds: number): string => `${Math.round(seconds / 60)} min`;
const clock = (seconds: number | null): string =>
  seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '?';
const range = (positions: number[]): string =>
  positions.length === 1 ? `plage ${positions[0]}` : `plages ${positions[0]} à ${positions[positions.length - 1]}`;

/** What the model may say about the disc itself: its tracks, players and label. */
const describeDisc = (album: Awaited<ReturnType<typeof musicService.getAlbumById>>, tracks: Track[]): string => {
  const performers = [...new Set(tracks.flatMap(track => (track.performers || []).map(p => `${p.name} (${p.role})`)))];
  return [
    `Titre : ${album.title}`,
    `Artistes : ${(album.artist || []).join(', ')}`,
    `Interprètes : ${performers.join(', ') || 'voir artistes'}`,
    `Label : ${(album.labels || []).join(', ')} ${album.catalogNumber || ''} — parution de CE CD : ${album.releaseYear || '?'}`
      + ` (ce n'est PAS l'année d'enregistrement, inconnue sauf si les notes d'édition ou les sources la donnent)`,
    `Notes d'édition : ${album.editionNotes || '—'}`,
    'Plages :',
    ...tracks.map((track, i) => `  plage ${i + 1} (${clock(track.durationSec)}) : ${track.title}`),
  ].join('\n');
};

/** The headings the guide must use, worked out here: the model adds up durations badly. */
const headingsOf = (story: AlbumStoryResult, title: string, tracks: Track[]): string[] => {
  const total = (positions: number[]) => positions.reduce((sum, p) => sum + (tracks[p - 1]?.durationSec || 0), 0);
  const works = story.url ? [] : story.works.filter(work => work.positions?.length);
  if (works.length === 0) {
    const all = tracks.map((_, i) => i + 1);
    return [`### ${title}, ${minutes(total(all))} — ${range(all)}`];
  }
  return works
    .sort((a, b) => a.positions![0] - b.positions![0])
    .map(work => `### ${work.workTitle} (<année de composition>), ${minutes(total(work.positions!))} — ${range(work.positions!)}`);
};

/** Every language's article about the album, or about each of its works. */
const gatherSources = async (story: AlbumStoryResult): Promise<string> => {
  const subjects = story.url
    ? [{ name: story.title || '', links: story.links }]
    : story.works.map(work => ({ name: work.workTitle, links: work.links?.length ? work.links : [{ lang: work.lang, title: work.title, url: work.url }] }));
  const articles = subjects.flatMap(subject => subject.links.map(link => ({ subject: subject.name, link })));
  const perArticle = Math.max(MIN_PER_ARTICLE, Math.floor(SOURCE_BUDGET / Math.max(1, articles.length)));

  const parts: string[] = [];
  for (const { subject, link } of articles) {
    const article = await albumStoryService.readArticle(link);
    if (!article) continue;
    const text = [article.intro, ...article.sections.map(s => `## ${s.heading}\n${s.text}`)].join('\n');
    parts.push(`[Wikipédia ${link.lang} : ${link.title} — sur « ${subject} »]\n${text.slice(0, perArticle)}`);
  }
  return parts.join('\n\n');
};

const SYSTEM = [
  'Tu rédiges en français des fiches « Avant d’écouter » pour un mélomane amateur qui écoute un CD avec attention, le disque en main.',
  'Règle absolue : tout nom, date, instrument, lieu ou anecdote doit figurer dans les SOURCES ou dans la FICHE DU DISQUE. Sinon, ne l’écris pas.',
  'Écris pour l’oreille, pas pour le pupitre : jamais de numéro de mesure ni d’analyse harmonique savante ; décris ce qu’on entend (un instrument seul, un rythme, un contraste, un silence).',
  'Pas de formules creuses (« lecture magistrale », « chef-d’œuvre intemporel »). Phrases courtes et vivantes.',
].join(' ');

const draftPrompt = (disc: string, sources: string, headings: string[], example: AlbumGuideFormatted | null): string => [
  'FICHE DU DISQUE', disc, '',
  'SOURCES (Wikipédia, en français et en anglais)', sources, '',
  ...(example ? [
    'EXEMPLE DE TON ET DE LONGUEUR (fiche d’un AUTRE disque : n’en reprends aucun fait)', example.text.slice(0, 3000), '',
  ] : []),
  'Écris la fiche en Markdown. Pour chaque section, reprends tel quel le titre ci-dessous (remplace seulement <année de composition>) :',
  headings.join('\n'),
  'Sous chaque titre :',
  '**Contexte** : 3 à 4 phrases : qui, quand, pour qui, pourquoi ; ce que l’œuvre ou le disque a changé.',
  '**Forme** : comment c’est construit, ce qui guide l’oreille, en 2 à 3 phrases.',
  '**À guetter** : 2 ou 3 puces « - **Plage N** : … », chacune avec un numéro de plage du disque et un détail sonore précis tiré des sources.',
  'Termine par « ### Votre version » : une phrase factuelle sur les interprètes de CE disque, puis une seule question d’écoute simple et concrète.',
].join('\n');

const verifyPrompt = (disc: string, sources: string, draft: string): string => [
  'SOURCES', sources, '', 'FICHE DU DISQUE', disc, '', 'BROUILLON', draft, '',
  'Relève chaque affirmation factuelle du brouillon (nom, date, instrument, tonalité, lieu, chiffre, attribution, numéro de plage).',
  'Pour chacune, cherche-la dans les SOURCES ou la FICHE DU DISQUE et réponds en JSON :',
  '{"claims":[{"claim":"...","verdict":"supported|contradicted|unsupported","evidence":"citation courte de la source ou correction"}]}',
].join('\n');

const fixPrompt = (draft: string, problems: Claim[]): string => [
  'BROUILLON', draft, '', 'PROBLÈMES RELEVÉS', JSON.stringify(problems, null, 1), '',
  'Réécris le brouillon. Pour CHAQUE problème ci-dessus, sans exception :',
  '- « contradicted » : remplace par la version correcte donnée dans evidence ;',
  '- « unsupported » : supprime le passage (ou la partie de phrase) qui contient cette affirmation.',
  'Ne change rien d’autre, garde les titres ### tels quels. Rends uniquement la fiche en Markdown.',
].join('\n');

/** Models like to wrap their answer in a code fence. */
const unfence = (text: string): string => text.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1').trim();

const parseClaims = (json: string): Claim[] => {
  try {
    const claims = JSON.parse(json)?.claims;
    return Array.isArray(claims) ? claims : [];
  } catch {
    // A verification cut short is no verdict: the draft stands rather than nothing at all.
    logger.warn('Album guide: the fact check did not come back as JSON, keeping the draft');
    return [];
  }
};

/** The local LLM writes, checks every fact against the sources, then fixes what it got wrong. */
const writeWithLocalLlm = async (albumId: number): Promise<{ text: string; model: string }> => {
  const album = await musicService.getAlbumById(albumId);
  const tracks: Track[] = (album.discs || []).flatMap(disc => disc.tracks);
  if (tracks.length === 0) throw new Error('This album has no tracks to guide through');

  let story = await albumStoryService.getStory(albumId);
  // Stories kept before the works knew their tracks are read again.
  if (!story.url && story.works.some(work => !work.positions)) story = await albumStoryService.getStory(albumId, { refresh: true });
  if (!story.found) throw new Error('Wikipedia has nothing on this album or its works to write a guide from');

  const sources = await gatherSources(story);
  const disc = describeDisc(album, tracks);
  const example = await AlbumGuide.latestByClaude(albumId);

  const draft = unfence(await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: draftPrompt(disc, sources, headingsOf(story, album.title, tracks), example) },
  ], 2500, 0.3));

  const claims = parseClaims(await chat([
    { role: 'system', content: 'Tu es un vérificateur de faits méticuleux. Tu compares mot à mot avec la source.' },
    { role: 'user', content: verifyPrompt(disc, sources, draft) },
  ], 6000, 0, true));
  const problems = claims.filter(claim => claim.verdict !== 'supported');

  const text = problems.length === 0 ? draft : unfence(await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: fixPrompt(draft, problems) },
  ], 2500, 0.2));

  logger.info(`Album guide for album ${albumId}: ${claims.length} facts checked, ${problems.length} fixed`);
  return { text, model: getConfig().model };
};

const isClassical = (genres: string[] | null | undefined): boolean =>
  (genres || []).some(genre => CLASSICAL_GENRES.some(keyword => genre.toLowerCase().includes(keyword)));

const failedAt = new Map<number, number>();

const albumGuideService = {
  get: (albumId: number): Promise<AlbumGuideFormatted | null> => AlbumGuide.get(albumId),

  save: (albumId: number, text: string, source: GuideSource): Promise<AlbumGuideFormatted> =>
    AlbumGuide.save(albumId, text.trim(), source),

  remove: (albumId: number): Promise<void> => AlbumGuide.remove(albumId),

  /** Asks the local LLM for a guide, replacing the one there may be. */
  generate: (albumId: number): Promise<AlbumGuideFormatted> =>
    inTurn(async () => {
      const { text, model } = await writeWithLocalLlm(albumId);
      return AlbumGuide.save(albumId, text, 'local_llm', model);
    }),

  /** Writes the missing guides of the classical albums added since guides exist, one album per pass. */
  writeMissing: async (): Promise<number | null> => {
    const have = await AlbumGuide.albumIds();
    const candidates = (await Album.findAll()).filter(album =>
      album.titleStatus !== 'wish'
      && !have.has(album.id)
      && (album.createdAt || '') >= GUIDES_SINCE
      && isClassical(album.genres)
      && Date.now() - (failedAt.get(album.id) ?? 0) > RETRY_FAILED_AFTER_MS);

    for (const album of candidates) {
      try {
        await albumGuideService.generate(album.id);
        return album.id;
      } catch (error) {
        failedAt.set(album.id, Date.now());
        logger.warn(`Album guide not written for album ${album.id}: ${(error as Error).message}`);
      }
    }
    return null;
  },

  startAutoWrite: (): void => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        // Keep going while there is something to write, one album at a time.
        while (await albumGuideService.writeMissing().catch(() => null) !== null) { /* next album */ }
        // Then the radio's fiches of the songs with none, albums added or ripped since among them.
        await trackFicheService.writeMissing().catch((error: Error) => logger.warn(`Radio fiches: ${error.message}`));
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 10 * 60 * 1000).unref();
    setInterval(tick, AUTO_WRITE_EVERY_MS).unref();
  },
};

export default albumGuideService;
