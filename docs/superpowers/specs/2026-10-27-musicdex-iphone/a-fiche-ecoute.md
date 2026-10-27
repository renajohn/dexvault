# Piste A — la fiche, écoute d'abord

Prototype : `a-fiche-ecoute.html` (cadre iPhone 393×852, quatre scénarios, un album d'un disque et un coffret de trois).

## Le principe

La fiche album reste la porte d'entrée : un toucher sur une pochette de la grille l'ouvre, comme aujourd'hui. Sur l'iPhone elle est réordonnée pour écouter : un en-tête à hauteur fixe (pochette 112 px à gauche, à droite un bloc de la même hauteur qui range l'artiste, le murmure, le rip, les genres et les étoiles, coupé plutôt que débordant), puis aussitôt les pistes, par disque. Tout ce qui est à lire (guide, notes, Wikipedia, « Also on », partitions, liens, édition et codes) devient une rangée de puces scrollable qui ouvrent une feuille ; au pied il ne reste que ▶ Play en or et Listen Next, le reste sous ⋯.

## « Je veux écouter cet album », en touchers depuis la grille

- **L'album entier : 2 touchers.** La pochette (la fiche s'ouvre, les pistes déjà visibles) → ▶ Play. Aujourd'hui c'est pareil en nombre, mais Play est serré entre cinq boutons et la liste des pistes est sous le mur de texte. Le ▶ sur la pochette dans la grille reste là : 1 toucher pour qui ne veut rien voir.
- **Une piste précise : 2 touchers.** La pochette → la piste. Aujourd'hui : la pochette, faire défiler jusqu'aux pistes (souvent plusieurs écrans de guide), le ▶ de la piste : 2 touchers et un défilement long.
- **Le disque 2 d'un coffret : 2 touchers et un défilement court**, la première piste du disque est à un écran.
- **Mettre dans Listen Next : 2 touchers** (la pochette → Listen Next), et l'appui long sur Listen Next ouvre le choix Digital | CD / par disque, comme sur la grille.

## Ce que devient chaque élément de la fiche actuelle

| Aujourd'hui | Piste A |
|---|---|
| Pochette 104 px + dos | Pochette 112 px à taille fixe, le dos en vignette dans son coin ; un toucher l'agrandit comme aujourd'hui. |
| Artiste, « format · N tracks · durée · année · pays · label » | Dans le bloc de droite, une ligne chacun, coupée en fin de ligne (…), jamais à la ligne. |
| Ligne du rip, genres | Idem, deux lignes du bloc. « Also on » et les partitions quittent le bloc. |
| Étoiles + note communauté | Au bas du bloc, sur une ligne réservée de 22 px, étoiles données ou non : les noter ne déplace rien. |
| « Also on … », partitions | Puces « Also on 2 », « Scores 1 » : une feuille avec une ligne par album (pochette, format, pistes partagées), qui ouvre sa fiche. |
| Liens (MusicBrainz, Discogs…) | Puce « Links » : une feuille, une ligne par lien. |
| Repli « Edition, codes and more » | Puce « Edition & codes » : la même `dl` dans une feuille. |
| Encart Buy / wish list | Sans CD : une ligne « No CD · on your wish list » dans le bloc et « I bought the CD » dans ⋯ ; le raisonnement « Worth buying » dans une feuille « Buy » quand il existe. |
| Guide d'écoute (AlbumGuide, en place) | Puce « Guide » : la feuille, aux deux tiers de l'écran, le verre des menus. Absente quand l'album n'a pas de guide. |
| Notes d'écoute (AlbumNotes) | Puce « Notes 2 » (atténuée à 0) : la feuille liste les notes avec leurs étoiles, son pied propose « Write a listening note… ». |
| « Write a listening note… · Read on Wikipedia… » | Écrire : dans ⋯ et dans la feuille des notes. Wikipedia : la puce. |
| Pistes (par disque, crédits, piste touchée → paroles/crédits) | Juste sous les puces. Une piste touchée **joue** (barres or à la place du numéro, pastille du lecteur au-dessus du pied) et déplie sous elle Lyrics · Credits · ♥ et ses écoutes. |
| ▶ Play ▾ | ▶ Play en or, seul, qui devient ❚❚ Pause / Resume. Le ▾ (sortie, Amperfy, « from the start ») part dans ⋯. |
| Next ▾ | Listen Next, en or quand l'album y est ; l'appui long pour le ▾. Par disque, le casque du disque dans son en-tête. |
| Mixtapes ▾ | ⋯ > « Add to a mixtape… ». |
| Bought, Edit, Delete | ⋯, Delete en rouge et son `confirm()`. |

## Avantages

- Les pistes sont au premier écran, pour tout album : plus de mur de texte, plus de défilement pour trouver la piste 3.
- La pochette ne bouge plus : la hauteur de l'en-tête ne dépend ni des étoiles ni de la longueur de la méta.
- Un pied à deux boutons, lisibles, avec des mots ; une seule action or.
- Le guide, les notes et Wikipedia sont à un toucher, sans occuper la page ; une puce absente dit qu'il n'y a rien.
- Rien de nouveau à apprendre : même porte d'entrée, mêmes pistes, mêmes menus ; l'ordinateur ne change pas.

## Inconvénients

- Le bloc de droite coupe : un label long ou trois genres se terminent en « … » ; il faut accepter de lire la suite dans « Edition & codes ».
- Une rangée de sept puces dépasse la largeur : les dernières (Links, Edition) ne se voient qu'en faisant défiler, sans indice visuel fort.
- Toucher une piste pour la jouer rend le toucher accidentel pendant le défilement plus coûteux qu'aujourd'hui (où il ne fait que déplier).
- Le ▾ de Play (sortie Salon, Amperfy) est un cran plus loin, dans ⋯ ; qui écoute sur l'Onkyo tous les soirs le sentira.

## Risques d'implémentation

- **MusicDetailCard** est le gros morceau : l'en-tête, les puces et le pied deviennent une variante téléphone (le même composant avec un rendu par `@media` ne suffit pas, l'ordre du DOM change). Il faut soit un second corps rendu sous 768 px, soit sortir les sections (guide, notes, story, overlaps, liens, facts) en composants réutilisés par la feuille et par la fiche d'ordinateur.
- **Une feuille** (sheet) n'existe pas dans les composants partagés : `Dialog` a `center` et `panel`. Il faut un `variant="sheet"` (ou un `Menu` ne convient pas à un texte long), avec la poignée, le voile, le glissement vers le bas, sous un `.modal` dont le z-index a déjà posé problème (voir le commit des paroles).
- **PhonePlayer** : la pastille doit se poser au-dessus du pied de la fiche sans le couvrir (padding du corps quand elle est là), et la piste touchée dans la fiche doit devenir « ce qui joue » par le même chemin que `playFrom`. Lyrics depuis la piste touchée ouvre le plein écran en vue paroles : un appel au lecteur à ajouter.
- **MusicThumbnail / AlbumPlayButton** ne changent pas. **MusicSearch** non plus. **AlbumGuide, AlbumNotes, AlbumStory** doivent accepter d'être rendus dans une feuille (sans leur titre en petites capitales, avec leur propre défilement).
- Les tests de MusicDetailCard (nombreux) sont écrits pour un seul rendu ; une variante téléphone double les cas à couvrir ou demande un `matchMedia` simulé.

## Questions ouvertes

- Une piste touchée doit-elle **jouer** (le prototype) ou **se déplier** comme aujourd'hui, avec un ▶ à part ? Jouer est le plus court ; déplier est le plus sûr.
- Où va la **sortie** (Salon, cet iPhone) : dans ⋯ comme ici, ou faut-il garder un ▾ collé à Play, au prix d'un troisième bouton ?
- Les puces vont-elles **sous l'en-tête** (ici) ou **au pied**, au-dessus de Play ? Sous l'en-tête elles partent au défilement ; au pied elles restent sous le pouce mais chargent la zone où le doigt cherche Play.
- Faut-il garder une **sticky** de l'en-tête de disque (« Disc 2 · 12 tracks ») quand on défile un coffret ?
- Les étoiles à 17 px dans le bloc : assez grandes pour le doigt, ou faut-il les noter depuis une feuille ?
- Hauteur de la feuille : deux tiers fixes, ou plein écran pour un guide long ?
