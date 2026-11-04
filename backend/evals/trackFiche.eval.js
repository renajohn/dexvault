/**
 * Track fiches evalset: how well the local LLM describes the radio's songs
 * with the very prompt the radio writes them with (style, energy, language),
 * against songs of the collection labelled by hand.
 *
 * fiches.yml: 162 songs, 2 per artist for 70 artists and 14 classical ones.
 * hard.yml: 32 songs the radio drew wrongly on 04.11.2026 (Pink Floyd as
 * alternative, Souchon as rock…).
 *
 * A fiche is right when it carries one of `styles`; clean when it carries
 * nothing beyond `styles` and `also`. Measured on 04.11.2026 (Qwen3.6-35B-A3B):
 * the old prompt 90 % and 44 % clean, alternative wrong 13 times in 13 on the
 * hard cases; with the album's genres and the styles' guide 89-90 % and
 * 88-91 %, alternative wrong once at most.
 *
 * It needs the LLM server (LLM_BASE_URL, or the default). Run it with
 * `npm run eval`; `npm test` never does.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { describe: describeSongs } = require('../src/services/trackFicheService');
const { checkHealth } = require('../src/services/coverScanService').default;

const EVALSET_DIR = path.join(__dirname, '../../evalsets/track fiches');
const BATCH = 25;

const load = name => yaml.load(fs.readFileSync(path.join(EVALSET_DIR, `${name}.yml`), 'utf8')).songs;

/** The fiches of a set, written as the radio writes them: by 25, an album's songs together. */
const written = async songs => {
  const out = new Array(songs.length).fill(null);
  for (let from = 0; from < songs.length; from += BATCH) {
    const batch = songs.slice(from, from + BATCH).map((song, at) => ({
      key: String(from + at), artist: song.artist, title: song.title, album: song.album, year: song.year, genres: song.genres,
    }));
    const fiches = await describeSongs(batch).catch(() => []);
    for (const { key, fiche } of fiches) out[Number(key)] = fiche;
  }
  return out;
};

const score = (songs, fiches) => {
  const tally = { songs: 0, right: 0, clean: 0, energy: 0, lang: 0, wrongStyles: {}, misses: [] };
  songs.forEach((song, at) => {
    const fiche = fiches[at];
    if (!fiche) return;
    const { styles, also, energy, lang } = song.expected;
    const allowed = new Set([...styles, ...also]);
    const right = fiche.styles.some(style => styles.includes(style));
    const clean = right && fiche.styles.every(style => allowed.has(style));
    tally.songs += 1;
    tally.right += right;
    tally.clean += clean;
    tally.energy += Math.abs(fiche.energy - energy) <= 2;
    tally.lang += lang.includes(fiche.lang);
    fiche.styles.filter(style => !allowed.has(style)).forEach(style => { tally.wrongStyles[style] = (tally.wrongStyles[style] || 0) + 1; });
    if (!clean || Math.abs(fiche.energy - energy) > 2) {
      tally.misses.push(`${song.artist} — ${song.title}: ${fiche.styles.join('/')} ${fiche.energy} (${styles.join('/')} ${energy})`);
    }
  });
  return tally;
};

const share = (n, of) => Math.round(100 * n / of);

const report = (name, tally) => console.log([
  `${name}: ${tally.songs} songs; right ${share(tally.right, tally.songs)} %, clean ${share(tally.clean, tally.songs)} %, `
  + `energy within 2 ${share(tally.energy, tally.songs)} %, language ${share(tally.lang, tally.songs)} %`,
  `wrong styles: ${JSON.stringify(tally.wrongStyles)}`,
  ...tally.misses.map(miss => `  ${miss}`),
].join('\n'));

beforeAll(async () => {
  const health = await checkHealth();
  if (!health.available) throw new Error(`LLM server not available: ${health.error}`);
});

describe('track fiches', () => {
  test('describe the collection\'s songs', async () => {
    const songs = load('fiches');
    const tally = score(songs, await written(songs));
    report('fiches', tally);
    expect(tally.songs).toBeGreaterThanOrEqual(songs.length * 0.95);
    expect(share(tally.clean, tally.songs)).toBeGreaterThanOrEqual(85);
    expect(share(tally.energy, tally.songs)).toBeGreaterThanOrEqual(85);
    expect(share(tally.lang, tally.songs)).toBeGreaterThanOrEqual(95);
  }, 15 * 60 * 1000);

  test('get the hard cases right, alternative above all', async () => {
    const songs = load('hard');
    const tally = score(songs, await written(songs));
    report('hard', tally);
    expect(share(tally.clean, tally.songs)).toBeGreaterThanOrEqual(80);
    expect(tally.wrongStyles.alternative || 0).toBeLessThanOrEqual(2);
  }, 10 * 60 * 1000);
});
