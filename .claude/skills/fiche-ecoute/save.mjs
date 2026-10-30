#!/usr/bin/env node
// Enregistre une fiche d'écoute dans DexVault, source « claude ».
// Usage : node save.mjs <albumId> <fichier.md> [--base https://dexvault.lab.crog.org]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const [albumId, file] = args;
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'https://dexvault.lab.crog.org';
if (!albumId || !file) { console.error('Usage: node save.mjs <albumId> <fichier.md> [--base URL]'); process.exit(1); }
const text = readFileSync(file, 'utf8').trim();
if (/^#{1,6}\s+(votre version|your version)/im.test(text)) { console.error('La fiche contient encore une section « Votre version »'); process.exit(1); }
const r = await fetch(`${base}/api/music/albums/${albumId}/guide`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: 'claude' }),
});
if (!r.ok) { console.error(`${r.status} ${await r.text()}`); process.exit(1); }
const g = await r.json();
console.log(`Fiche enregistrée pour l'album ${g.albumId} (${g.text.length} caractères, ${g.source}, ${g.updatedAt})`);
