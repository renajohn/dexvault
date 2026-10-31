import axios from 'axios';
import logger from '../logger';

/**
 * The editions IMSLP holds of a work, read from its page: the scans of its
 * Scores tab alone (its arrangements and transcriptions are another tab),
 * each with its publisher, its year, its editor, its copyright, its files
 * (pages, size, downloads) and a thumbnail of its first page. IMSLP's
 * downloads pass a check made for people, so DexVault does not fetch the PDF:
 * it lists the editions, the browser downloads the one chosen on IMSLP, and
 * the file is then attached under the name its edition gives it.
 */

export interface ImslpEditionFile {
  /** IMSLP's index, #83536: its download is imslp.org/wiki/Special:ImagefromIndex/83536. */
  index: string;
  title: string;
  pages: number | null;
  /** "6.07MB" as IMSLP writes it. */
  size: string | null;
  downloads: number | null;
  download: string;
}

export interface ImslpEdition {
  /** The part of the page it is under: "Complete", "Clair de lune (No.3)". */
  section: string;
  /** "E. Fromont, 1905", or its reprint's when it is one: what one calls it. */
  name: string;
  editor: string | null;
  publisher: string | null;
  reprinted: string | null;
  copyright: string | null;
  notes: string | null;
  /** Its plate, "HN 381": a Henle edition's number, which says it is one's own. */
  plate: string | null;
  thumbnail: string | null;
  files: ImslpEditionFile[];
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', apos: "'" };
const decode = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);

/** Its words: lines kept where IMSLP breaks them, its tags, comments and editors' links gone. */
const words = (html: string) => decode(html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<span class="noanon">[\s\S]*?<\/span><\/div>/g, '</div>')
  .replace(/<br\s*\/?>|<\/(?:div|p)>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .split('\n').map(line => line.replace(/[\s ]+/g, ' ').trim()).filter(Boolean).join('\n');

/** "Paris: E. Fromont, 1905. Plate E. 1404 F." is "E. Fromont, 1905"; the line of a collection before it is left. */
export const shortPublisher = (info: string | null): string | null => {
  if (!info) return null;
  const lines = info.split('\n');
  for (const line of [...lines].reverse()) {
    const found = line.match(/^(?:[^:]{1,60}):\s*(.+?),\s*(n\.d\.(?:\s*\([^)]*\))?|\d{4}(?:[-–]\d{2,4})?)/);
    if (found) return `${found[1].trim()}, ${found[2].replace(/\s+/g, '')}`;
    const own = line.match(/^(.+?),\s*(\d{4})\.?$/);
    if (own) return `${own[1].trim()}, ${own[2]}`;
  }
  return lines[lines.length - 1].replace(/\.\s*$/, '').slice(0, 60);
};

/** "Plate E. 1404 F." is "E. 1404 F"; "Plate HN 381. URTEXT EDITION" is "HN 381", and "Plate E.P. 12420b.URTEXT EDITION" "E.P. 12420b". */
export const plateOf = (info: string | null): string | null => {
  const rest = info?.match(/Plate\s+([^\n]+)/)?.[1];
  if (!rest) return null;
  return rest.split(/\.\s*(?=[A-Za-z]{3,})|\s{2,}/)[0].replace(/\.\s*$/, '').trim() || null;
};

const number = (text: string | undefined) => (text ? Number(text.replace(/[^\d]/g, '')) || null : null);

/** The editions of the Scores tab of a work's page, as IMSLP's parse API gives it. */
export const editionsOf = (html: string): ImslpEdition[] => {
  const start = html.indexOf('id="tabScore1"');
  if (start < 0) return [];
  const next = html.indexOf('<div class="jq-ui-tabs', start + 10);
  const tab = html.slice(start, next < 0 ? undefined : next);
  const editions: ImslpEdition[] = [];
  let section = 'Complete';
  // The tab in order: its headings and its editions, each a <div class="we">.
  const parts = tab.split(/(?=<div class="we">)|(?=<h[45]>\s*<span class="mw-headline")/);
  for (const part of parts) {
    const heading = part.match(/^<h[45]>\s*<span class="mw-headline"[^>]*>([\s\S]*?)<\/span>/);
    if (heading) { section = words(heading[1]); continue; }
    if (!part.startsWith('<div class="we">')) continue;
    const files: ImslpEditionFile[] = [];
    for (const block of part.split(/(?=<div id="IMSLP\d+" class="we_file)/).slice(1)) {
      const index = block.match(/^<div id="IMSLP(\d+)"/)![1];
      const file = block.match(/title="File:([^"]+)"/)?.[1] || '';
      if (!/\.pdf$/i.test(decode(file))) continue;
      const title = block.match(/<span class="we_file_dlarrow">[\s\S]*?<\/span><\/span>([\s\S]*?)<\/span><\/a>/)?.[1];
      const info = block.match(/#\d+<\/a>\s*-\s*([\d.]+\s*[KMG]B)(?:,\s*(\d+)\s*pp\.)?/);
      files.push({
        index,
        title: title ? words(title) : 'Complete Score',
        pages: info?.[2] ? Number(info[2]) : null,
        size: info?.[1]?.replace(/\s+/g, '') ?? null,
        downloads: number(block.match(/Total number of downloads:\s*([\d,]+)/)?.[1]),
        download: `https://imslp.org/wiki/Special:ImagefromIndex/${index}`,
      });
    }
    if (!files.length) continue;
    const field = (name: RegExp) => {
      for (const [, th, td] of part.matchAll(/<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)) {
        if (name.test(words(th))) return words(td) || null;
      }
      return null;
    };
    const publisher = field(/^Pub/);
    const reprinted = field(/^Reprinted/);
    const thumbnail = part.match(/<div class="we_thumb">[\s\S]*?<img[^>]+src="([^"]+)"/)?.[1] ?? null;
    editions.push({
      section,
      name: shortPublisher(reprinted?.replace(/\s*\*$/, '') ?? null) || shortPublisher(publisher) || files[0].title,
      editor: field(/^Editor/),
      publisher,
      reprinted,
      copyright: field(/^Copyright/)?.replace(/\s*\[tag\/del\]/, '') ?? null,
      notes: field(/^Misc/),
      plate: plateOf(publisher) ?? plateOf(reprinted),
      thumbnail: thumbnail?.startsWith('//') ? `https:${thumbnail}` : thumbnail,
      files,
    });
  }
  return editions;
};

const cache = new Map<string, { at: number; editions: ImslpEdition[] }>();
const DAY = 24 * 3600 * 1000;

/** A work's editions, its page read once a day. */
const editions = async (page: string): Promise<ImslpEdition[]> => {
  const kept = cache.get(page);
  if (kept && Date.now() - kept.at < DAY) return kept.editions;
  try {
    const { data } = await axios.get('https://imslp.org/api.php', {
      params: { action: 'parse', page, format: 'json', prop: 'text', redirects: 1 },
      headers: { 'User-Agent': 'DexVault/1.0 (personal music library)' },
      timeout: 20000,
    });
    const found = editionsOf(String(data?.parse?.text?.['*'] || ''));
    cache.set(page, { at: Date.now(), editions: found });
    return found;
  } catch (error) {
    logger.warn(`[IMSLP] The editions of ${page}: ${(error as Error).message}`);
    throw new Error('IMSLP did not answer');
  }
};

export default { editions };
