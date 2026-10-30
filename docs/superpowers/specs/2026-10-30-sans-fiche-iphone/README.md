# Plus de fiche Musique sur l'iPhone (enquête du 30.10.2026)

But : sur l'iPhone, **retirer complètement la boîte de dialogue de l'album** (`MusicDetailCard`).
Le lecteur plein écran (`PhonePlayer`), que la pochette ouvre déjà depuis le 27.10, devient la
seule vue d'un album. Le (i) de son pied n'ouvre plus la fiche mais une **vue Infos dans le
même écran**, avec tout ce qui est utile et rien de ce que l'écran dit déjà. On doit aussi
pouvoir mettre **un disque** d'un coffret dans Listen Next ou dans une mixtape, ce qui n'est
possible aujourd'hui que dans la fiche. Livres et films suivront le même patron, plus tard.

Prototype : `prototype.html` (cadre iPhone 393×852, scénarios à droite). L'ordinateur ne change pas.

## 1. Ce que la vue iPhone ne sait pas faire aujourd'hui

Comparaison de `PhonePlayer` (au repos et en lecture, avec le ⋯ de `useAlbumAtRest`) et de la
mise en page iPhone de `MusicDetailCard` (`phoneBody`, `phoneFoot`, feuilles des puces).

### À lire

| Ce que la fiche montre | Le lecteur aujourd'hui | Proposition |
|---|---|---|
| Pays, label, première parution (« first 1970 ») | La ligne au repos dit format · disques · pistes · durée · année, rien de plus | Vue Infos, section **Édition** |
| Code d'étagère (A-3) / marques Digital (No CD, wished) | Absent | Infos, en tête de **Fichiers et CD** : c'est la seule chose qu'on cherche *debout devant l'étagère* |
| État du rip : Lossless/Lossy · 11 of 11 tracks · FLAC ; plays in 90 days ; « rip the CD again » | Seulement le format de la piste qui joue (« Lossless ») sous le curseur | Infos, **Fichiers et CD** |
| Genres (toucher = filtre la grille) | Absent | Infos, puces ; un toucher ferme le lecteur et filtre |
| Note communauté (MusicBrainz + Discogs, votes, ↻) | Absent (les étoiles du propriétaire y sont, au-dessus des pistes) | Infos, à côté des étoiles ; les étoiles **ne sont pas répétées** sur la vue des pistes quand Infos est ouvert… voir §3 |
| Guide d'écoute | **Déjà là** (bouton du pied) | Rien ; Infos n'a pas de rangée Guide, le pied suffit |
| Notes d'écoute (lire, écrire) | Absent | Infos, rangée **Notes (n)** qui se déplie en place, avec le champ « Write a note… » |
| Wikipedia (`AlbumStory`) | Absent | Infos, rangée **On Wikipedia** dépliable |
| « Also on » (autres albums qui ont des pistes en commun) | Absent | Infos, rangée **Also on (n)** dépliable ; un album touché s'ouvre dans le lecteur (`showAlbum`), pas dans une fiche |
| Partitions (« On the shelf of scores ») | Absent | Infos, rangée **Scores (n)** → page Scores |
| Liens : MusicBrainz, Discogs, Apple Music… | Absent | Infos, rangée **Links** ; Picard n'existe pas sur iPhone |
| Edition & codes : producteur, ingénieur, lieu, langue, qualité, état/achat/prix, ajouté le, n° catalogue, code-barres, ISRC, id MusicBrainz, annotation | Absent | Infos : **Crédits**, **Owned**, **Codes** (les ISRC repliés : premier … dernier (n)) |
| Dos de la pochette, zoom pochette | Absent | Infos, le dos en vignette sous Édition ; pas de zoom (la pochette est déjà en 300 px dans la vue `cover`) |
| Crédits par piste (compositeurs, interprètes, œuvre), ISRC, id d'enregistrement ; recherche par interprète | Absent : une ligne de piste = n°, titre, ♥, durée | **Hors périmètre** de cette enquête : la liste des pistes reste celle du lecteur. Voir question ouverte 4 |
| Groupes d'œuvres (classique : l'œuvre en titre, les mouvements dessous) | Absent (titres bruts) | Idem, question ouverte 4 |
| Étoiles, nombre d'écoutes (×12) par piste | ♥ et point « populaire » seulement | Idem |
| Paroles d'une piste qui ne joue pas | Celles de la piste qui joue seulement | Idem |

### À faire

| Action de la fiche | Le lecteur aujourd'hui | Proposition |
|---|---|---|
| Listen Next pour l'album : Streamed / From the CD / Take out | **Au repos seulement** (`rest.menu`) ; en lecture, ⋯ n'a rien pour l'album | ⋯ porte les mêmes entrées **en lecture aussi** |
| Listen Next **par disque** (coffret), « All discs », « In Listen Next · Disc 1 & 2 · from the CD » | Absent, et les pistes ne sont même pas séparées par disque | La liste des pistes gagne des **têtes de disque** (« Disc 1 · 2 tracks · 47 min ») avec un casque (or quand le disque y est, argent pour CD) et un ⋯ : Streamed / From the CD / Take out, puis le disque dans les mixtapes |
| Album entier dans une mixtape | Au repos seulement | ⋯ en lecture aussi |
| Un disque dans une mixtape | Absent | Le ⋯ de la tête de disque |
| Une piste dans une mixtape, ♥ | **Déjà là** (glisser) | Rien |
| Play from the start ; Resume à la position gardée (`resume`) | ▶ au repos joue du début ; rien pour reprendre | ⋯ : « Play from the start » quand l'album joue ; au repos, ▶ reprend si une reprise est gardée, la ligne le dit (« Resume · Spanish Key 3:12 ») |
| Jouer sur une autre sortie avant de lancer ; jouer sur un ordinateur (`remote`) | La sortie se choisit dans « Plays on » (déjà là) ; **Play on ‹Mac›** absent | ⋯ : « Play on ‹Mac› » quand un ordinateur écoute |
| Ouvrir dans Amperfy | Déjà là | Rien |
| Écrire une note d'écoute | Absent | Infos, rangée Notes |
| Wish list : Add / Take off ; « Not interested » ; Ricardo ; « I bought the CD » (`BoughtCdDialog`) | Absent | Infos, bloc **To buy** en tête quand il y a quelque chose à décider (album sans CD), comme le `buyBox` de la fiche |
| Find the back cover… (`CoverFinder`) | Absent | Infos, sous la vignette du dos : « Find the back… » ; `CoverFinder` reste un dialogue (c'est un choix d'images) |
| Edit (`MusicForm`) | Absent | Infos, au pied : **Edit…** ; le formulaire reste un dialogue |
| Delete | Absent | Infos, au pied, en rouge, avec `confirm()` |
| ‹ › album précédent / suivant (`steps`) | Absent | Abandonné sur iPhone : on revient à la grille |
| Recherche par artiste (toucher le nom) | Absent | Infos : le nom d'artiste touché filtre la grille, comme un genre |
| Disque de ce qui joue au pied (`NowPlayingDisc`) | Déjà là (`door`) | Rien |

### Les portes qui ouvrent encore la fiche sur iPhone

1. `MusicSearch.handleCdClick` : un **CD sans rip** (`fileQuality === 'none'`) ouvre la fiche.
   → Le lecteur au repos s'ouvre quand même : ▶ gris, la ligne dit « On CD only », Listen Next
   propose « From the CD » seul ; Infos et le guide marchent. Rien à jouer, mais tout à voir.
2. `PhonePlayer` (i) → `onOpen` → `navigate('/musicdex?album=')` → fiche.
   → (i) bascule la vue `info` du lecteur. `?album=` depuis une autre page ouvre le lecteur sur
   l'album (`showAlbum`) et sa vue Infos.
3. `useAlbumAtRest.onNoRip` → fiche. → Plus d'appel : voir 1.
4. « Also on » de la fiche → `onOpenAlbum` → fiche. → `showAlbum(other)` dans le lecteur.
5. `WishListPage` → `MusicDetailCard` pour un album souhaité. → Même lecteur, au repos, avec le
   bloc To buy en tête des Infos. (Un album souhaité sans fichiers ni CD : ▶ gris, « Not in
   the library », Apple Music dans ⋯ comme aujourd'hui.)
6. Le menu de recherche (`useOpenItem`) → `handleCdClick` → couvert par 1.
7. Une **mixtape** ouvre `MixtapeDialog`, pas `MusicDetailCard` : hors périmètre, elle reste
   un dialogue pour l'instant (sa composition est un autre sujet).

### Ce qui reste un dialogue, à dessein

`MusicForm` (Edit), `CoverFinder`, `NewMixtapeDialog`, `BoughtCdDialog`, `confirm()`,
`PlayerTracks` (toutes les pistes de Listen Next). Ce sont des formulaires ou des choix,
pas la fiche : ils s'ouvrent par-dessus le lecteur (z-index 12000, `over-player-backdrop`)
et y reviennent.

## 2. La vue Infos : tout ce qui est utile, rien deux fois

Une **cinquième vue** du `PhonePlayer`, `info`, à côté de `cover`, `lyrics`, `guide`,
`tracks`. Comme elles, elle garde la tête réduite (vignette 60 px, titre, artiste, ⋯) et prend
la zone de la liste, qui défile ; le curseur, ⏮ ⏯ ⏭, le volume et le pied restent. Le (i) du
pied est **allumé** quand elle est ouverte, et la ferme (retour à la vue d'où l'on venait).

Ce que l'écran dit déjà, et qu'Infos **ne redit pas** :
- la pochette, le titre, l'artiste (dans la tête) ;
- format · disques · pistes · durée · année (la ligne au repos ; en lecture, le curseur prend
  sa place : Infos redonne alors **l'année seule** dans Édition, c'est la seule perte) ;
- les étoiles (sous l'artiste dans la vue des pistes, cadran au doigt) : Infos montre à leur
  place la **note de la communauté** seule, sur la ligne où les étoiles seraient, pour qu'on
  compare d'un regard en basculant ;
- le guide d'écoute (bouton du pied) ;
- la sortie (« Plays on Salon ») ;
- les pistes, leurs ♥, leurs mixtapes (vue des pistes).

Sections, dans l'ordre, chacune absente quand elle serait vide (voir le prototype) :

1. **To buy** (album sans CD seulement) : « Worth buying — 9 plays in 90 days » ou « On your
   wish list » ; Wished (or quand c'est fait) · Ricardo · I bought the CD · Not interested.
2. **Fichiers et CD** : le code d'étagère **en gros** (A-3), puis « Lossless · 6 of 6 tracks ·
   FLAC · 9 plays in 90 days », ou « Not ripped yet », ou « No CD · wished ». En orange :
   « Lossy · rip the CD again ».
3. **Édition** : « 1999 · US · Columbia/Legacy · first 1970 » ; n° catalogue, code-barres en
   `code` ; la note d'édition ; la **vignette du dos** à droite (ou « Find the back… »).
4. **Genres** : des puces ; un toucher ferme le lecteur et filtre la grille (`onSearch`).
5. **Communauté** : « ★ 4.3 / 5 · 61 votes » et ↻ ; ou « Too few votes (2) ».
6. Rangées dépliables (un chevron, le compte en gris ; dépliées en place, pas en feuille) :
   - **Notes (1)** : les notes d'écoute, puis le champ « Write a note… » (`AlbumNotes`
     en mode `writing`) ;
   - **On Wikipedia** : `AlbumStory` ;
   - **Also on (2)** : vignette, titre, « CD · 20 tracks · all 6 of this album's » ;
     un toucher ouvre l'album dans le lecteur ;
   - **Scores (1)** : titre court, publisher → `/scores?score=` ;
   - **Credits** : Producer, Engineer, Recorded at, Language, Quality ;
   - **Owned** : Near Mint · bought 12.03.2021 · CHF 18 ; les notes d'achat ; « added
     14.05.2024 · updated 02.10.2026 » ;
   - **Codes** : ISRC (premier … dernier (6, one per track), tous au toucher), MusicBrainz
     (id en `code`), l'annotation.
7. **Links** : MusicBrainz ↗ · Discogs ↗ · Apple Music ↗, en une ligne de liens.
8. **Au pied**, à part : **Edit…** (verre) et **Delete** (rouge, `confirm()`). Un album
   digital (Navidrome seul) n'a ni l'un ni l'autre, comme aujourd'hui.

Règle de rangée : une rangée qui a un compte le montre à droite ; une rangée vide
n'existe pas (pas de « Notes (0) » : à sa place, une seule ligne « Write a listening note… »
en bas des rangées). Les rangées dépliées se referment à la sortie de la vue.

## 3. Un disque dans Listen Next ou dans une mixtape

Dans la vue des pistes, un coffret affiche ses disques sous des **têtes de disque**, qui
**glissent comme les lignes de piste** (décision du 30.10.2026, après le prototype : les deux
boutons du prototype rompaient la grammaire de la liste, où une piste se glisse à droite pour
ses mixtapes et à gauche pour son ♥) :

```
Disc 1 · 2 tracks · 47 min                            🎧
 1  Pharaoh's Dance                            20:05
 2  Bitches Brew                            ♥  26:58
Disc 2 · 4 tracks · 47 min                            💿
```

- **Touchée** : son menu, « Disc 2 in Listen Next » Streamed / From the CD (✓ or sur la
  liste choisie, « Default » en indice), « Take out of Listen Next », puis « Disc 2 in
  mixtapes » (`MixtapeEntries`) et « New mixtape… ». (Un glissé à droite ouvrait d'abord le
  menu ; remplacé par le toucher le 30.10, un glissé de moins à apprendre.)
- **Glissée à gauche, lâchée** (« Listen Next », ou « Take out ») : le disque entre dans
  Listen Next (streamé ; de la liste CD pour un CD sans rip), ou en sort ; quand l'album
  entier y est, ce disque seul reste (le comportement de la fiche :
  `handleListenNextToggle(disc.number, …)`). Les mots d'un glissé tiennent en 88 px, et la
  tête a la hauteur d'une piste (46 px) pour que l'icône au-dessus du mot ne soit pas coupée.
- **L'état se lit** sans toucher : un petit casque or en fin de ligne quand le disque est dans
  la liste streamée, un disque argent quand il est dans la liste CD, comme le petit ♥ d'une
  piste. Pas de bouton sur la ligne.
- La première tête de disque s'ouvre un peu, une fois, pour dire qu'elle glisse (sa propre
  clé, `dexvault-player-disc-swipe-hint`).
- Le **⋯ de l'album** (en tête de la vue) porte la section « Listen Next » pour l'album
  entier (Streamed / From the CD / All discs / Take out, les disques tenus en indice) et
  « Album in mixtapes », **au repos comme en lecture**. En lecture s'ajouteront « Play from
  the start », « Play on ‹Mac› » (commit b).
- Un album d'**un seul disque** n'a pas de tête : rien ne change pour lui.

Code (commit a, 30.10.2026) : `PhoneTrack.disc`, la liste groupée par disque,
`DiscHeadLine` sur un `SwipeRow` sans `deed` (il ne glisse qu'à gauche) ; `useAlbumActions(albumId, standing, tracks)` dans
`useAlbumAtRest.tsx`, servi au repos et en lecture par `PlayerBar` (en lecture, l'état de
l'album, `titleStatus`/`fileQuality`, est lu par `getAlbumById`), relu sur
`LISTEN_NEXT_CHANGED_EVENT`.

## 4. Et les livres, les films

Même patron : la **pochette ouvre une vue plein écran** du disque, et le (i) une vue Infos
dans le même écran. Un livre n'a pas de lecteur : sa vue plein écran est directement la
vue Infos avec en haut ce qui remplace le ▶ (le journal de lecture, le prêt, les étoiles).
Un film de même (vu / à voir, les avertissements araignées-serpents, où le voir). À dessiner
quand la musique sera livrée ; ce qu'on fera ici qui leur servira : le composant de **tête
réduite + sections dépliables + pied Edit/Delete**, à extraire une fois qu'il marche pour
les albums (`RecordInfo`, dans `shared/`), et la règle « rien deux fois ».

## 5. Questions ouvertes

1. **Les étoiles dans Infos** : la communauté seule (règle « rien deux fois », la vue des
   pistes les a), ou les deux côte à côte comme la fiche, au prix d'une répétition ? Le
   prototype montre la communauté seule.
2. **Notes d'écoute** : dépliées en place dans Infos (prototype), ou une entrée ⋯ « Write a
   listening note… » en plus pendant l'écoute ?
3. **Also on** : ouvrir l'autre album **remplace** l'album du lecteur (comme `showAlbum`) ; on
   ne revient pas au premier. Acceptable ? (Sinon une pile de deux, comme `left`.)
4. **Crédits et paroles par piste** dans la vue des pistes : le vrai manque du classique
   (œuvres, mouvements, interprètes). Une ligne touchée longtemps ouvre déjà un menu ; on
   pourrait y ajouter « Details » qui déplie la ligne (`TrackDetails`). Sujet à part.
5. **`?album=` depuis une autre page** : ouvre le lecteur sur l'album (au repos ou en
   lecture) et sa vue Infos, ou sa vue des pistes ?
6. **Wish list page** : garde-t-elle sa propre fiche le temps que la musique soit faite, ou
   passe-t-elle au lecteur en même temps ?

## 6. Plan d'implémentation (après validation)

1. `PhonePlayer` : vue `info` (`AlbumInfo`, nouveau composant, sections dépliables), le (i)
   la bascule ; `PhoneTrack.disc`, têtes de disque, casque et ⋯ par disque.
2. `useAlbumAtRest` → `useAlbumActions` : Listen Next (album, disques), mixtapes (album,
   disques), reprise, Play on ‹Mac› ; servi au repos **et** en lecture par `PlayerBar`.
3. `MusicSearch.handleCdClick` : sur iPhone, **toujours** `showAlbum`, CD sans rip compris ;
   `useAlbumAtRest.onNoRip` supprimé ; `?album=` → `showAlbum` + vue Infos.
4. Edit, Delete, Find the back, Bought, Wish depuis Infos : les callbacks que `MusicSearch`
   donnait à la fiche passent par `phoneDoor` (ou un `AlbumActions` en contexte).
5. `MusicDetailCard` n'est plus rendue sous 768 px ; sa mise en page iPhone (`phoneBody`,
   puces, feuilles, `phoneFoot`) et son CSS partent. Tests : `MusicDetailCard.test` perd ses
   cas phone, `PhonePlayer.test` en gagne.
6. `WishListPage` : même porte.

## Décision (30.10.2026)

1. Infos montre la **note de la communauté seule** sous l'artiste ; les étoiles restent sur les pistes.
2. Les notes d'écoute se **déplient en place** dans Infos ; rien dans ⋯.
3. « Also on » **remplace** l'album du lecteur, sans pile ; `left` reste le seul retour.
4. Crédits et paroles par piste : **livraison suivante**, par une entrée « Details » du menu de
   l'appui long qui déplie `TrackDetails` ; ici les titres bruts, sans groupes d'œuvres.
5. `?album=` ouvre le lecteur **sur ses pistes** ; un album sans CD (Buy, wish list) sur Infos.
6. La Wish List **bascule en même temps**, par la même porte `showAlbum`.
7. Le ▶ et le casque de la vignette ne changent pas.
8. **Deux commits** : (a) têtes de disque et ⋯ de l'album en lecture ; (b) la vue Infos et la
   fin de la fiche sous 768 px.

## Livré (30.10.2026, commit b)

- `AlbumInfo` (`frontend/src/components/AlbumInfo.tsx`) : la vue `info` du `PhonePlayer`, que le (i)
  bascule (allumé ; refermé, retour à la vue d'où l'on venait). Elle prend aussi la place de la
  bande (ligne ou curseur, ▶ ⏮ ⏯ ⏭, volume, « Plays on ») : le pied seul reste, l'iPhone n'a pas
  la place. Pas de boîte dans la boîte : le bloc To buy est une section comme les autres, les
  codes du texte monospace sans fond, « Find the back… » un lien discret sous l'édition. Communauté sous la tête ; To buy
  pour un album sans CD ; Files and CD avec le code d'étagère ; Edition avec le dos (ou « Find the
  back… », `CoverFinder` à 12000 par-dessus le lecteur) ; Genres (filtre la grille, le lecteur
  se replie) ; rangées dépliables Notes / Wikipedia / Also on (ouvre l'autre album dans le
  lecteur) / Scores / Credits / Owned / Codes ; Links ; Edit… et Delete au pied. Sans note, la
  rangée s'appelle « Write a listening note… ». Les écoutes sur 90 jours ne s'affichent que
  s'il y en a.
- Ce que la page peut faire à l'album passe par `phoneDoor.setAlbumManagement` : MusicDex dit
  Edit, Delete, Bought, Wish, Not interested, le dos, le filtre ; la Wish List dit Delete,
  Bought, le dos. Edit, Bought et Not interested replient le lecteur (leurs dialogues sont
  sous lui) ; Delete demande (`confirm()`, 12000) puis replie.
- Sur iPhone, **plus aucune porte vers `MusicDetailCard`** : `handleCdClick` et `?album=`
  ouvrent le lecteur (sur Infos pour un album sans CD), la Wish List aussi ; un CD sans rip
  ouvre le lecteur au repos, ▶ gris, « On CD only · 2 discs · … », ses pistes propres qui ne
  jouent pas. La fiche n'est plus rendue sous 768 px.
- **Reste à faire** : retirer de `MusicDetailCard` la mise en page iPhone devenue morte
  (`phoneBody`, puces, feuilles, `phoneFoot`, `useCoversPlayer`, son CSS) et ses tests phone ;
  les crédits et paroles par piste dans la liste du lecteur (question 4) ; une recette sur
  l'iPhone.
