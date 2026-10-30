---
name: fiche-ecoute
description: Écrit la fiche d'écoute (« Avant d'écouter ») d'un CD de MusicDex, en français, à partir de Wikipédia, et l'enregistre dans DexVault. À utiliser quand l'utilisateur demande une fiche d'écoute, un guide d'écoute, ou de faire les fiches des CD qui n'en ont pas.
---

# Fiche d'écoute d'un CD

But : apprendre quelque chose à l'utilisateur sur ce qu'il écoute, le disque en
main. La fiche dit d'où vient l'album, comment il sonne, puis **ce qu'il y a
d'intéressant sur chaque titre**, plage par plage. C'est Claude qui l'écrit
(source `claude`), pas le LLM local : sa qualité tient à la lecture attentive
des sources et à l'honnêteté sur ce qu'elles ne disent pas.

Le backend a son propre rédacteur (`backend/src/services/albumGuideService.ts`,
LLM local, albums classiques ajoutés depuis le 08.10.2026). Cette fiche-ci s'en
distingue : pas de section « Votre version », et une entrée par plage.

## Étapes

1. **Lister ce qui manque.** Les albums possédés sont dans
   `GET https://dexvault.lab.crog.org/api/music/albums/status/owned` ; la fiche
   d'un album dans `GET /api/music/albums/<id>/guide` (`null` s'il n'en a pas).
   Toujours la prod, jamais `data/db.sqlite` (voir la mémoire `prod-data-source`).
   Faire les ids en boucle, c'est rapide (204 albums en quelques secondes).
2. **Rassembler les sources** : `node .claude/skills/fiche-ecoute/sources.mjs <id>` (un album à la fois : Wikipédia répond 429 en parallèle)
   écrit `/tmp/fiche-ecoute/<id>/sources.md` : la fiche du disque (plages,
   durées, crédits par plage, label, année de CE CD), l'article Wikipédia de
   l'album en français et en anglais (ou celui de chaque œuvre pour un disque
   classique), et l'article de chaque titre qui en a un. Le script dit combien
   de titres ont un article. Lire **tout** le fichier, pas seulement le début :
   les détails qui font la fiche (une couche-culotte sous les cordes, une bande
   rejouée 10 % trop lentement) sont dans les sections Recording des articles
   de chansons.
3. **Écrire la fiche** dans `/tmp/fiche-ecoute/<id>/guide.md` (format ci-dessous).
4. **Vérifier** chaque fait contre les sources avant d'enregistrer : relire la
   fiche phrase par phrase et retrouver chaque nom, date, instrument, chiffre
   et numéro de plage dans `sources.md`. Ce qu'on ne retrouve pas, on l'enlève.
   Vérifier aussi que les numéros de plage sont ceux de CE CD (la fiche du
   disque), pas ceux du vinyle ou d'une réédition : l'ordre diffère souvent.
5. **Enregistrer** : `node .claude/skills/fiche-ecoute/save.mjs <id> /tmp/fiche-ecoute/<id>/guide.md`
   (PUT `/api/music/albums/<id>/guide`, source `claude` ; refuse une fiche qui
   contient « Votre version »). Relire par GET pour confirmer.
6. Pour plusieurs albums, faire les étapes 2 à 5 album par album, et dire à la
   fin lesquels sont faits et lesquels ont trop peu de sources.

## Format

Le frontend (`AlbumGuide.tsx`) ne rend que : `###` titre, paragraphes,
`- ` puces, `**gras**`, `*italique*`. Rien d'autre (pas de tableau, pas de
lien, pas de `#` d'un autre niveau que `###`).

```
### <Titre> (<année de première parution>), <N> min — plages 1 à <n>
**Contexte** : 4 à 6 phrases. Qui, quand, où, avec qui, pourquoi ; ce que l'album
a changé pour l'artiste ou pour les autres. Une anecdote de studio si les
sources en donnent une.

**Le son** : 3 à 5 phrases. Ce qu'on entend : instruments, rythmes, voix,
production, comment les plages s'enchaînent et pourquoi elles sont dans cet
ordre. Une citation courte de l'artiste si elle éclaire.

**Plage par plage** :
- **Plage 1** : *Titre*. Deux à cinq phrases : d'où vient la chanson, qui joue
  quoi, ce qui s'est passé en studio, un détail sonore précis à guetter.
- **Plage 2** : *Titre*. …
- …une puce par plage dont on sait quelque chose ;
- **Les autres plages** : *Titre* (n), *Titre* (n), … pour celles dont on ne sait rien.
```

Un double CD, ou un disque classique de plusieurs œuvres : un `###` par
disque ou par œuvre, avec ses plages.

## Règles d'écriture

- **Rien hors des sources.** Tout nom, date, instrument, lieu, chiffre,
  citation, anecdote vient de `sources.md`. Pas de connaissance générale,
  même sûre : si la source ne le dit pas, la fiche ne le dit pas. Quand une
  plage n'a pas d'article et que l'article de l'album n'en dit rien, sa puce
  dit le peu qu'on sait (qui joue, d'après les crédits) en une phrase, sans
  broder.
- **Pour l'oreille.** Décrire ce qu'on entend (un charleston qui imite la
  pluie, une basse étouffée, une voix doublée une octave plus bas, une syllabe
  tenue dix secondes), jamais de numéro de mesure ni d'analyse harmonique.
- **Apprendre quelque chose.** Préférer le fait qui surprend (qui a failli
  chanter, ce qui a été enregistré par erreur, d'où vient un son) au
  classement dans les charts. Les chiffres de ventes et de classement : une
  phrase au plus, dans le Contexte.
- **Phrases courtes et vivantes**, en français ; les titres de chansons et
  d'albums en *italique*, les citations entre « guillemets » (traduites).
  Pas de formules creuses (« chef-d'œuvre intemporel », « lecture magistrale »).
- **La fiche ne parle pas de ses sources** : jamais « les sources disent peu » ni « rien sur cette plage ». Quand on sait peu, on écrit moins ; une plage sans rien d'utile n'a pas de puce de remplissage (durée, place dans le disque, paraphrase du titre) : elles vont ensemble dans une dernière puce « **Les autres plages** : *Titre* (n), … ».
- **Pas de « Votre version »** : ni section sur l'édition du CD, ni question
  d'écoute à la fin. La fiche finit sur la dernière plage.
- Longueur : 5 000 à 9 000 caractères pour un album de dix plages bien
  documenté ; moins quand les sources sont minces, jamais rallongé pour faire
  du volume.

## Exemple de ton

La fiche de *So* de Peter Gabriel (album 416 en prod) : sa puce sur
*Don't Give Up* dit la boîte à rythmes Linn aux toms lents, Thatcher et la
photo *Migrant Mother*, Dolly Parton qui refuse et Kate Bush qui accepte, la
couche-culotte de Tony Levin sous ses cordes, et qui chante quoi. Chaque fait
est dans l'article anglais de l'album ou de la chanson.
