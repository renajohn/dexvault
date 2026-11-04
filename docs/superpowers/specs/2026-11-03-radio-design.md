# Radio (lot 2 des mixtapes)

Décidé le 03.11.2026 (grill-me, à finir). Prototype : `2026-11-03-radio/prototype.html`, variante
**C · Cloud** retenue (servi avec `python3 -m http.server` depuis ce dossier). Suite de
`2026-11-03-mixtapes-section-design.md`.

Le lot 2 devait donner des mixtapes intelligentes (♥ / populaires × classique / autre). Il devient
**Radio** : on dit ce qu'on veut entendre, et DexVault joue sans fin dans ce que l'on a.

## Le mode Radio

- Le bandeau Listen Next a deux modes : `Listen Next | ✦ Radio` (Segmented, gardé). Listen Next ne
  bouge pas pendant une radio.
- **Le prompt** en grand, modifiable sur place, ↵ relance ; les derniers prompts en pastilles.
- **« Heard as »** : les critères tirés du prompt (énergie 0–6, slow, melancholic…), chacun ôtable
  d'un ✕, la bande recalculée.
- **La bande** : 10 titres d'avance, chacun avec son humeur et son style (`CoverTag`) et une jauge
  d'énergie ; ✕ retire un titre (« pas celui-là »), un autre entre. Pendant la lecture la bande
  avance, sans fin. La teinte du bandeau suit l'énergie moyenne, chaude ou bleutée.
- ▶, ↻ (retirer au sort), **Save as mixtape…** : nom, 10 / 20 / 30 / 45 titres (30 par défaut, une
  sortie de running), une mixtape ordinaire dans Navidrome qu'Amperfy joue entière.
- Pas de playlist qui se réécrit seule dans Navidrome : la radio vit dans le lecteur de DexVault.

## Le vivier : une union

- Les sources cochées s'additionnent : **Albums à N★ et plus** (seuil 3, 3½, 4, 4½, 5 ; 4 par
  défaut) ∪ **mes ♥** ∪ **les populaires** des albums. Rien de coché : tout ce qui se joue.
- × **Genre** : classique et autre / classique / pas classique ; case **œuvres entières**.
- Le classique d'une piste vient de la section Classique ou de sa fiche, jamais des étiquettes de
  l'album (MusicBrainz classe Abbey Road « classical »).
- Vivier épuisé : la bande le dit et propose de chercher dans tout ce qui se joue.

## Les fiches

- **Une par enregistrement** (ID MusicBrainz) : la même chanson sur deux albums partage la sienne.
- Énergie 0–10 ; tempo slow / mid / fast ; 2 ou 3 **humeurs** et 1 ou 2 **styles** en listes
  fermées ; langue.
  - humeurs : driving, energetic, aggressive, intense, anthemic, epic, upbeat, joyful, playful,
    uplifting, hopeful, groovy, gentle, calm, dreamy, romantic, tender, intimate, melancholic,
    nostalgic, dark, tense, dramatic, reflective, atmospheric, cinematic ;
  - styles : rock, alternative, hard-rock, progressive, pop, singer-songwriter, folk, chanson, soul,
    r&b, blues, jazz, funk, latin, hip-hop, electronic, dance, soundtrack, world, classical.
- Faites la nuit par le LLM local, derrière les guides d'écoute, une requête à la fois ; d'abord
  celles d'un vivier utilisé ; un album ajouté ou rippé mis en file. Pas refaites d'elles-mêmes.
- Dans la recherche depuis le 04.11.2026 : `mood:`, `style:`, `energy:`, `tempo:` (MusicDex : un album
  dont au moins un tiers des pistes qui ont une fiche répond, une au moins ; Add tracks… : les pistes
  par leur propre fiche ; backend/src/utils/ficheFilters.ts).

## Le choix

1. Le prompt traduit **une fois** en critères (LLM) ; 2. les candidats tirés des fiches (une
quarantaine, au plus 3 par artiste) ; 3. le LLM en choisit, en voyant les 20 derniers sortis ;
4. **le code** regroupe les mouvements d'une œuvre et les remet dans l'ordre (le LLM ne le fait
pas), et complète l'œuvre avec « œuvres entières ». Au plus 2 par artiste, jamais deux de suite.
- Un titre revient après la moitié du vivier ou 30 jours ; un titre sauté, deux fois plus tard.

## Essais (03.11.2026, Qwen3.6-35B-A3B local)

- Fiches : 25 chansons en 13 s ; 1 190 chansons des albums à 3★+ en 13 min ; ~1 h pour 6 412.
  Listes fermées tenues (0 mot hors liste). La même chanson sur trois albums : trois fiches
  voisines, d'où la fiche par enregistrement.
- Un remplissage : ~4 s. « rock alternatif énergique », « mélancolique, un jour de pluie »,
  « quelque chose d'upbeat » justes ; « du jazz pour cuisiner » : rien dans les albums à 4★+, ce
  qui est vrai.

## À trancher

- L'iPhone : le bandeau Radio, Save as mixtape.
- La recherche `mood:` / `style:` : dans ce lot ou après.
