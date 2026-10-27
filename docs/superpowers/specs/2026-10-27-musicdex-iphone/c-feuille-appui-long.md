# Piste C — Feuille demi-hauteur et appui long

Prototype : `c-feuille-appui-long.html` (cadre iPhone 393×852, quatre scénarios cliquables, gestes réels : toucher, tirer, tenir, clic droit pour l'appui long).

## Le principe

Sur l'iPhone, toucher une pochette n'ouvre plus la fiche plein écran mais une **feuille à mi-hauteur** par-dessus la grille encore visible : la pochette en petit, l'artiste et le titre, un murmure (Lossless · CD · 12 tracks · 47 min · 1997), **▶ Play en or**, Next, ⋯, et tout de suite la liste des pistes, qui défile dans la feuille. Tirée vers le haut (ou « More ˄ »), la feuille **devient la fiche** : même en-tête avec la pochette dans une boîte de 104 px à hauteur fixe, puis une rangée de pastilles (★ étoiles, Guide, Notes, Links, Edition…) qui ouvrent chacune leur contenu à la place des pistes ; tirée vers le bas, elle se referme. Un **appui long** sur une pochette fait surgir, sans quitter la grille, un aperçu de la pochette et le Menu de DexVault : Play, Play next, Listen Next (Streamed / From the CD), Mixtapes ›, Open the album.

## « Je veux écouter cet album » en gestes comptés

| Depuis la grille | Aujourd'hui | Piste C |
|---|---|---|
| L'album, depuis le début | 1 (▶ de la vignette) | 1 (inchangé) |
| L'album, en voyant ses pistes avant | 2 (pochette → Play) | 2 (pochette → Play), les pistes sous les yeux |
| Une piste précise | 2 + un long défilement sous le guide | 2 (pochette → la piste) |
| L'album dans Listen Next, en CD | appui long sur le casque | appui long sur la pochette + 1 toucher |
| Mettre l'album en file, sans ouvrir | impossible | appui long + 1 toucher (Play next) |

Le son arrive au deuxième toucher dans tous les cas ; ce que la piste C gagne, c'est que le deuxième toucher peut viser une piste, et que la grille reste là derrière pour enchaîner sur un autre album.

## Ce que devient chaque élément de la fiche actuelle

- **Pochette** : 72 px dans la feuille, 104 px dans la fiche, dans une boîte à hauteur fixe ; l'image seule y grandit, le texte à côté est coupé en fin de ligne, jamais renvoyé dessous. La méta ne peut plus la déplacer.
- **Artiste · titre · format/pistes/durée/année/pays/label** : à côté de la pochette, trois lignes au plus (titre sur deux lignes), le murmure coupé à droite. La ligne du rip (Lossless · FLAC) passe en tête du murmure, en gras muet.
- **Étoiles** : une pastille dans la rangée sous l'en-tête (fiche seulement) ; un toucher ouvre le `StarRating` dans une petite feuille, la note communauté à côté. Jamais dans la boîte de la pochette.
- **Genres, « Also on », partitions** : dans la fiche seulement, sous les pastilles ou dans le repli Edition…, à trancher (voir questions).
- **Guide d'écoute** : une **pastille « Guide »** (absente si l'album n'en a pas) qui ouvre le texte à la place des pistes, avec « ‹ Tracks » pour revenir ; même composant `GuideText` que la vue Guide du lecteur.
- **Notes d'écoute** : pastille « Notes · 2 », même mécanique ; « Write a listening note… » en bas du texte.
- **Liens** (MusicBrainz, Discogs, Wikipedia) : pastille « Links · 3 » qui ouvre un Menu.
- **Edition, codes and more** : reste un repli, atteint par sa pastille.
- **Encart Buy** : une ligne sous l'en-tête de la fiche, inchangée.
- **Pistes** : juste sous les boutons, dès la feuille ; par disque, crédits en petit sous le titre ; la piste en cours en or avec ses barres.
- **Les six boutons du pied** : il n'y a plus de pied fixe. **Play** (or, la seule action or) et **Next** (casque ou disque, or quand l'album y est) restent sous l'en-tête ; **▾ de Play** (sortie Salon, Amperfy), **▾ de Next** (Streamed / From the CD, disques), **Mixtapes**, **Bought**, **Edit**, **Delete** vont sous **⋯**, Delete en rouge tout en bas. Le choix du médium de Listen Next se fait surtout par l'appui long depuis la grille.

## Cohabitation avec l'appui long déjà là sur le casque de la vignette

Le casque gardait un appui long (450 ms) qui met l'album dans la liste CD. Avec un appui long sur toute la pochette, deux gestes longs voisins sur 150 px de vignette, ça se confond : **on abandonne l'appui long du casque**. Le casque garde son toucher (Streamed par défaut, ou retirer), et « From the CD » se trouve dans le menu d'appui long de la pochette, avec un ✓ or sur la liste où l'album est. Le ▶ garde son toucher simple ; un appui long qui commence sur ▶ ou sur le casque ouvre aussi le menu (le geste long appartient à la pochette entière), pour ne pas avoir de zones mortes.

## Avantages

- Les pistes sont visibles au premier toucher, la grille reste en vue : on sait d'où l'on vient et on referme d'un geste vers le bas, comme Plans ou Musique.
- La pochette ne bouge plus ; le guide devient un bouton ; les boutons rares disparaissent sous ⋯.
- L'appui long ramène à une seule place lisible ce que faisaient le ▾ de Next, l'appui long du casque et le menu Mixtapes.
- La fiche n'est plus un autre écran : c'est la même feuille, tirée.

## Inconvénients

- Deux gestes nouveaux sur la même pochette ; le toucher et l'appui long doivent se sentir différents (anneau qui grandit, retour haptique, pochette qui se tasse à 95 %).
- La feuille montre cinq à six pistes : un coffret ou un Winterreise de 24 lieder demande de tirer ou de faire défiler dedans.
- Un Menu natif iOS s'ouvre sur l'appui long d'une image (enregistrer, copier) : il faut `-webkit-touch-callout: none` et `user-select: none` sur les pochettes, et avaler `contextmenu`.
- Tirer la feuille et faire défiler les pistes dedans se disputent le même doigt : la poignée et l'en-tête tirent, la liste défile, et la liste au sommet (scrollTop 0) tirée vers le bas doit fermer. C'est la partie la plus délicate à régler.

## Risques d'implémentation

- **MusicDetailCard** : c'est le gros morceau. Sur iPhone elle devient une feuille (nouveau `variant="sheet"` de `Dialog`, ou un composant frère), avec deux états et un en-tête à hauteur fixe ; le pied disparaît et ses boutons migrent dans ⋯ ; Guide, Notes et liens passent en vues. Sur ordinateur rien ne change, d'où deux rendus dans un composant déjà long (1 400 lignes) : un découpage s'impose.
- **PhonePlayer** : le lecteur plein écran et la feuille se ressemblent (poignée, pochette qui rapetisse, vues Lyrics/Guide/Tracks) ; partager le geste de tirer et la vue Guide. La pastille passe sous la feuille ouverte : la feuille porte son propre Play/Pause.
- **MusicThumbnail** : l'appui long sur la pochette (timer, anneau, distinction d'un défilement commencé : > 10 px annule), retrait de l'appui long du casque ; le `Menu` doit pouvoir s'ouvrir sans déclencheur ancré, avec un aperçu au-dessus (un `Menu` « détaché » ou un petit composant `CoverMenu`).
- **MusicSearch / MusicDexPage** : le toucher de la vignette ouvre la feuille au lieu de la fiche ; les ‹ › entre albums et l'ouverture par URL (`/musicdex/albums/:id`) doivent ouvrir la feuille tirée en fiche.
- « Play next » suppose une file de pistes après la piste en cours, que le lecteur n'a pas encore ; sinon, retirer l'entrée.

## Questions ouvertes

- La feuille s'ouvre-t-elle à mi-hauteur aussi pour un album **non rippé** (rien à jouer : Play devient « Listen · Apple Music », les pistes sont celles de MusicBrainz) ?
- Genres, « Also on » et partitions : sous les pastilles dans la fiche, ou dans Edition… ? Dans la fiche ils sont utiles pour naviguer (toucher un genre filtre la grille).
- Les étoiles : une pastille qui ouvre, ou le `StarRating` à même la rangée (plus direct, mais cinq touches de 16 px au doigt) ?
- Faut-il un **Play** sur chaque disque dans la feuille (« Disc 2 ▶ »), comme la fiche le propose aujourd'hui dans le ▾ de Next ?
- L'appui long sur une pochette de **Listen Next** (en tête de page) : le même menu, avec « Take out of Listen Next » en plus ?
- Sur ordinateur, garde-t-on la fiche telle quelle, ou la rangée de pastilles (Guide, Notes) y remplace-t-elle aussi le mur de texte ?
