#!/usr/bin/env node
// Rassemble tout ce qu'il faut pour écrire la fiche d'écoute d'un album :
// la fiche du disque (DexVault), l'article Wikipédia de l'album (en/fr, déjà
// lu par le backend) et l'article Wikipédia de chaque titre quand il en a un.
// Usage : node sources.mjs <albumId> [--base https://dexvault.lab.crog.org]
// Écrit /tmp/fiche-ecoute/<albumId>/{album.json,sources.md} et affiche sources.md.

import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const albumId = Number(args[0]);
if (!Number.isInteger(albumId)) { console.error('Usage: node sources.mjs <albumId> [--base URL]'); process.exit(1); }
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'https://dexvault.lab.crog.org';
const UA = 'DexVault fiche-ecoute (renault.john@gmail.com)';

// Wikipédia répond 429 quand on l'interroge trop vite : on attend et on recommence. Un album à la fois, jamais plusieurs en parallèle.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = async (url, attempt = 0) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 429 && attempt < 5) { await sleep(2000 * (attempt + 1)); return json(url, attempt + 1); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const clock = s => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '?';

const album = await json(`${base}/api/music/albums/${albumId}`);
const story = await json(`${base}/api/music/albums/${albumId}/story`);
const tracks = (album.discs || []).flatMap((disc, d) => disc.tracks.map(t => ({ ...t, disc: d + 1 })));
const multi = (album.discs || []).length > 1;

// --- Fiche du disque -------------------------------------------------------
const performers = [...new Set(tracks.flatMap(t => (t.performers || []).map(p => `${p.name} (${p.role})`)))];
const disc = [
  `Titre : ${album.title}`,
  `Artistes : ${(album.artist || []).join(', ')}`,
  `Genres : ${(album.genres || []).join(', ')}`,
  `Label : ${(album.labels || []).join(', ')} ${album.catalogNumber || ''} — parution de CE CD : ${album.releaseYear || '?'} (pays ${album.country || '?'})`,
  `Première parution de l'album : ${album.releaseGroupFirstReleaseDate || '?'}`,
  `Durée totale : ${Math.round((tracks.reduce((s, t) => s + (t.durationSec || 0), 0) || album.totalDuration || 0) / 60)} min (somme des plages)`,
  `Notes d'édition : ${album.editionNotes || '—'}`,
  `Annotation MusicBrainz : ${album.annotation || '—'}`,
  `Producteur : ${album.producer || '—'} ; ingénieur : ${album.engineer || '—'} ; lieu : ${album.recordingLocation || '—'}`,
  `Interprètes (crédits par plage) : ${performers.join(' ; ') || '—'}`,
  'Plages :',
  ...tracks.map((t, i) => `  ${multi ? `CD${t.disc} ` : ''}plage ${multi ? t.position ?? t.no : i + 1} (${clock(t.durationSec)}) : ${t.title}`
    + ((t.performers || []).length ? ` — ${t.performers.map(p => `${p.name} (${p.role})`).join(', ')}` : '')),
].join('\n');

// --- Wikipédia ---------------------------------------------------------------
const wikiText = async (lang, title) => {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const data = await json(u);
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing || !page.extract) return null;
  // Une page d'homonymie n'est pas un article.
  if (/\(disambiguation\)|\(homonymie\)/i.test(page.title) || /\b(may (also )?refer to|peut (aussi )?(désigner|faire référence à))\b/i.test(page.extract.slice(0, 400))) return null;
  return { title: page.title, text: page.extract };
};
const wikiSearch = async (lang, query) => {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(query)}`;
  const data = await json(u);
  return (data.query?.search || []).map(s => s.title);
};
// Les sections qui listent plutôt que racontent.
const SKIP = /^(track listing|personnel|credits|charts|certifications|references|external links|see also|notes|bibliography|further reading|release history|weekly charts|year-end charts|sales|liste des (titres|pistes)|crédits|classements|notes et références|références|liens externes|voir aussi|musiciens|discographie|bibliographie|annexes|cover versions|covers)/i;
const trimArticle = text => {
  const out = []; let skip = false;
  for (const line of text.split('\n')) {
    const h = line.match(/^(=+)\s*(.+?)\s*\1$/);
    if (h) { skip = h[1].length <= 2 && SKIP.test(h[2]); if (!skip) out.push(`## ${h[2]}`); continue; }
    if (!skip && line.trim()) out.push(line);
  }
  return out.join('\n');
};

const parts = [];
// L'album lui-même (ou ses œuvres, pour un disque classique)
if (story.found && story.url) {
  for (const link of story.links || []) {
    const a = await wikiText(link.lang, link.title);
    if (a) parts.push(`[Wikipédia ${link.lang} : ${a.title}]\n${trimArticle(a.text)}`);
  }
} else if (story.found) {
  for (const work of story.works || []) {
    for (const link of (work.links?.length ? work.links : [{ lang: work.lang, title: work.title }])) {
      const a = await wikiText(link.lang, link.title);
      if (a) parts.push(`[Wikipédia ${link.lang} : ${a.title} — sur « ${work.workTitle} », plages ${(work.positions || []).join(', ')}]\n${trimArticle(a.text)}`);
    }
  }
}
// Chaque titre : un article en anglais, et sa traduction française s'il y en a une.
const artist = (album.artist || [])[0] || '';
const norm = s => s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
// Le titre de l'article est celui de la chanson, seul ou suivi d'une précision entre parenthèses : « Il pleut » n'est pas « Il pleut sur Bruxelles ».
const isAbout = (a, clean) => a && (norm(a.title) === norm(clean) || norm(a.title).startsWith(norm(clean) + ' (')) && a.text.includes(artist) && a.title !== (story.title || '');
const songArticles = [];
for (const [i, t] of tracks.entries()) {
  const clean = t.title.replace(/\s*\(.*?\)\s*$/, '').replace(/[’‘`´]/g, "'");
  const candidates = [`${clean} (${artist} song)`, `${clean} (song)`, ...(await wikiSearch('en', `"${clean}" ${artist} song`))];
  let found = null;
  for (const c of candidates) {
    const a = await wikiText('en', c);
    // Un article de chanson porte le titre de la chanson, parle de l'artiste et n'est pas l'article de l'album.
    if (isAbout(a, clean) && /song|single|track|chanson/i.test(a.text.slice(0, 600))) { found = a; break; }
  }
  if (!found) continue;
  songArticles.push(found.title);
  parts.push(`[Wikipédia en : ${found.title} — plage ${i + 1} « ${t.title} »]\n${trimArticle(found.text)}`);
  const fr = await wikiSearch('fr', `${clean} ${artist} chanson`);
  for (const c of fr.slice(0, 1)) { const a = await wikiText('fr', c); if (isAbout(a, clean)) parts.push(`[Wikipédia fr : ${a.title} — plage ${i + 1}]\n${trimArticle(a.text)}`); }
}

const out = `# FICHE DU DISQUE (album ${albumId})\n${disc}\n\n# SOURCES\n${parts.join('\n\n')}\n`;
const dir = `/tmp/fiche-ecoute/${albumId}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/album.json`, JSON.stringify(album, null, 1));
writeFileSync(`${dir}/sources.md`, out);
console.error(`→ ${dir}/sources.md (${out.length} caractères ; article album : ${story.found ? 'oui' : 'NON'} ; titres avec article : ${songArticles.length}/${tracks.length})`);
console.log(out);
