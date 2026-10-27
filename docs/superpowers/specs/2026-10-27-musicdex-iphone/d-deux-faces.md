# Piste D — deux faces : Listen et Collection

Prototype : `d-deux-faces.html` (cadre iPhone 393×852, quatre scénarios à droite).

## Le principe

Sur l'iPhone, MusicDex garde une seule grille mais deux façons de la regarder, choisies par un `Segmented` (kind=tabs, tone=gold) placé sous le nom de la section. En face **Listen**, toucher une pochette joue l'album dans DexVault, la vignette ne porte qu'un ▶ au centre (révélé au toucher) et un petit (i) dans son coin, Listen Next vient en tête en grandes pochettes (deux par rangée), puis les derniers joués en rangée horizontale, puis tous les albums. En face **Collection**, c'est la grille d'aujourd'hui : titres, artistes, étiquettes (Lossy, Not ripped), bouton Next sur chaque pochette, chips Shelves / Buy / Wish list, et toucher une pochette ouvre la fiche complète avec son pied à six boutons.

## Le parcours « je veux écouter cet album »

| Chemin | Touchers depuis la grille jusqu'au son |
|---|---|
| Aujourd'hui, pochette → fiche → Play | 2 (ou 1 par le ▶ de 34 px dans le coin) |
| Face Listen, la pochette elle-même | **1**, et toute la pochette est la cible |
| Face Collection (inchangée) | 2 |

La fiche depuis la face Listen : (i) sur la vignette, 1 toucher ; ou pastille → ⋯ → Open the album, 3 touchers.
Passer d'une face à l'autre coûte 1 toucher sur le Segmented, la lecture continue ; la face choisie est mémorisée (localStorage), Listen par défaut sur téléphone.

## Ce que devient chaque élément de la fiche actuelle

- **Pochette, méta (artiste, format · pistes · durée · année · pays · label), étoiles, note communauté, genres, Also on, liens, repli Edition** : inchangés, la face Collection n'y touche pas. Cette piste ne règle donc **pas** le problème (2) de la pochette repoussée par la méta ni le mur de texte (1) et (3) : elle les contourne en rendant la fiche rarement nécessaire pour écouter. Les pistes A/B/C, qui refont la fiche, restent à combiner avec celle-ci.
- **Guide d'écoute et notes** : en face Listen, on les lit dans le lecteur (bouton Guide du plein écran, déjà là) ; la fiche les garde tels quels.
- **Pistes** : en face Listen, la vue Pistes du plein écran du lecteur, qui existe déjà ; la fiche les garde.
- **Les six boutons du pied (Play ▾, Next ▾, Mixtapes, Bought, Edit, Delete)** : ils ne vivent qu'en face Collection, où ils ont leur sens (gérer). En face Listen, Play est la pochette, Next reste accessible par le ⋯ du lecteur (Listen Next's tracks…) et par la fiche ; Mixtapes, Bought, Edit, Delete ne s'y montrent jamais.
- **Recherche à pastilles** : une seule ligne, la même dans les deux faces, entre le Segmented et les chips ; seul le placeholder change (« Play… an album, an artist, a mixtape » / « Search albums, artists, genres… »). Un résultat touché en face Listen joue, en face Collection ouvre.
- **Filtres Listen Next Digital | CD** : en face Listen, deux chips exclusifs en tête de la ligne de chips (or pour Digital, argent `--dv-silver` pour CD, comme sur l'ordinateur), qui changent le rayon « Listen Next » ; en face Collection, le rayon Listen Next garde son lien « Digital · CD » comme aujourd'hui.
- **Lecture en cours** : la pastille du PhonePlayer reste au pied dans les deux faces. En face Listen s'y ajoute un bandeau « Now playing · Salon » en tête de la grille (teinte or, pochette 44 px, titre, ❚❚ ⏭), qui ouvre le plein écran ; la pochette en lecture est cernée d'or dans la grille avec un petit égaliseur. Le bandeau n'existe pas en face Collection : la pastille suffit, et la pochette cernée d'or dit laquelle joue.

## Avantages

- Un toucher pour écouter, sur toute la pochette, sans passer par la fiche.
- La face Listen est ce que l'iPhone fait de MusicDex : un lecteur, la collection derrière, rien à gérer par erreur (pas de Delete sous le pouce).
- La face Collection ne change rien : livrable par étapes, la face Listen d'abord, sans toucher à MusicDetailCard.
- Listen Next, les derniers joués et les mixtapes trouvent une place naturelle en tête de la face Listen.

## Inconvénients, et le verdict demandé

- **Un état de plus à retenir** : « sur quelle face suis-je ? ». Le même geste sur la même pochette joue ici et ouvre là. C'est le vrai coût : une pochette touchée par habitude de l'ordinateur lance un album au Salon.
- Deux rendus de vignette, deux jeux de chips, un réglage « face par défaut » : trois choses de plus à maintenir et à tester.
- Le Segmented prend 40 px en tête d'un écran déjà plein (brand, recherche, chips, bandeau).

Franchement : **la dualité ne vaut pas sa complexité** par rapport au simple « la pochette joue, le ⋯ (ou le (i)) ouvre la fiche ». Ce dernier donne le même toucher unique, sans état, sans Segmented, sur une seule grille ; la fiche reste à un geste. Ce que la face Listen apporte en plus se réduit à deux choses : l'allègement visuel (pas de titres ni d'étiquettes, des pochettes plus grandes) et les rayons « Listen Next » / « Played lately » en tête. Les deux s'obtiennent sans dualité : des rayons en tête de la grille unique, et un titre sous la pochette plus discret. Je garderais de cette piste le bandeau Now playing en tête, le (i) sur la vignette et les rayons Listen Next / Played lately, et je laisserais le Segmented. Si on la retient malgré tout, le Segmented doit être un `Chip` de filtre (« Listen ») plutôt qu'un onglet, pour qu'il se lise comme un mode temporaire et non comme une seconde section.

## Risques d'implémentation

- **MusicThumbnail** : deux rendus (face Listen sans `words`, sans `CoverTagStack`, sans bouton Next, un (i) `CoverButton` en plus) ; l'`onClick` de la pochette doit devenir `onPlay` ou `onOpen` selon la face, en respectant `onUnripped` (un album non rippé touché en face Listen ouvre la fiche, ou propose Amperfy).
- **MusicDexPage / CollectionGrid** : les rayons (Listen Next en grille large, Played lately en rangée horizontale) demandent un regroupement nouveau, et l'ordre par « dernier joué » un champ que playlistHistory a peut-être déjà.
- **PhonePlayer** : le bandeau Now playing en tête de page est un second rendu du même état (titre, où ça joue, ❚❚ ⏭) ; à partager avec la pastille, sinon deux sources de vérité.
- **MusicSearch / pastilles de recherche** : un résultat touché doit jouer ou ouvrir selon la face ; les pastilles elles-mêmes ne changent pas.
- **ListenNextLists** : les chips Digital | CD reproduisent une bascule qui existe déjà pour l'ordinateur ; ne pas la dupliquer, la rendre compacte.
- **MusicDetailCard** : rien, et c'est le point faible de la piste : les problèmes (1) à (4) de la fiche restent entiers.

## Questions ouvertes

- Face par défaut : Listen sur téléphone, mémorisée, ou toujours Listen au lancement ?
- Un album non rippé touché en face Listen : ouvrir la fiche, proposer Amperfy, ou un toast « Not ripped » ?
- Le bandeau Now playing doit-il remplacer la pastille en face Listen (un seul lecteur à l'écran) ou s'y ajouter ?
- Listen Next en face Listen : les disques d'un coffret restent-ils une entrée chacun, comme validé le 19.10.2026 ?
- Le (i) sur la vignette : toujours visible, ou révélé au toucher avec le ▶ ?
