# Piste B — la pochette mène au lecteur

Prototype : `b-pochette-lecteur.html` (cadre iPhone 393×852, cinq scénarios à droite).

## Le principe

Sur l'iPhone, toucher une pochette de la grille n'ouvre plus la fiche album mais la **vue du lecteur sur cet album, à l'arrêt** : la pochette en grand, qui et quoi en une ligne, un ▶ or, et les pistes dessous. Toucher ▶ ou une piste lance le son **dans la même vue**, sans changement d'écran : le ▶ s'efface et laisse la position et ⏮ ⏯ ⏭ à sa place, la pochette ne bouge pas. Tout le reste de la fiche (méta, étoiles, guide, notes, Edit, Delete…) est à un toucher derrière (i) ou ⋯, qui ouvrent la fiche actuelle telle quelle.

## « Je veux écouter cet album », en touchers

| Parcours | Aujourd'hui | Piste B |
|---|---|---|
| Tout l'album, depuis la grille | 1 (▶ sur la pochette) | 1 (▶ sur la pochette, inchangé) |
| Tout l'album, en voyant ce que c'est avant | 2 (pochette → fiche, faire défiler jusqu'au pied, ▶) | **2** (pochette → aperçu, ▶) |
| Depuis une piste précise | 3 à 4 (fiche, défiler sous le guide, ▾ de Play ou la piste) | **2** (pochette → aperçu, la piste) |
| Lire le guide avant d'écouter | 1 + défilement dans un mur de texte | 2 (pochette, Guide au pied), puis ▶ sans quitter |

Le gain n'est pas le nombre de touchers, c'est l'absence de défilement et de changement de contexte : on part de la grille, on arrive dans le lecteur, et c'est tout.

## Ce que devient chaque élément de la fiche actuelle

- **Pochette** : 176 px dans l'aperçu et en lecture, 300 px dans la vue « grande pochette » (celle du PhonePlayer actuel), toujours centrée et **à hauteur fixe** : la ligne de méta sous elle est coupée à sa fin, elle ne pousse rien.
- **Artiste, titre, « CD · 11 tracks · 48 min · 2011 »** : sous la pochette, une ligne chacun ; pays et label partent dans la fiche.
- **Ligne du rip** : remplacée par ce qu'elle décide : ▶ or si l'album joue, ▶ gris et « On CD only — put it on, or rip it » sinon ; « Not ripped » en argent devant la ligne de méta.
- **Étoiles, note communauté, genres, liens, « Also on », partitions, repli Edition** : dans la fiche, derrière (i). Rien de tout cela ne se touche en écoutant.
- **Guide d'écoute** : un bouton du pied (comme dans le lecteur actuel), qui remplace la liste des pistes par le texte ; absent si l'album n'a pas de guide. Plus jamais un mur en place.
- **Notes d'écoute, « Write a listening note… »** : dans la fiche. (Question ouverte : une entrée ⋯ « Write a listening note… » pendant l'écoute ?)
- **Pistes** : la liste de l'aperçu, directement sous le ▶ ; une piste touchée joue depuis elle, la piste qui joue est en or avec les barres ; par disque pour un coffret. Les crédits et les paroles d'une piste restent au lecteur (bouton Paroles, actif seulement en lecture).
- **Les six boutons du pied** : ▶ Play → le gros ▶ (le ▾ « Play from the start / Play on Salon » devient le bouton Sortie, choisi *avant* de jouer) ; Next → le casque à gauche du ▶ (or quand l'album y est ; Digital | CD dans ⋯) ; Mixtapes, Bought, Edit, Delete → ⋯ (Mixtapes, Bought) et la fiche (Edit, Delete, avec sa confirmation rouge).

## Un autre album joue déjà

L'aperçu s'ouvre **par-dessus le son sans le couper** : la pastille de l'album en cours vit au pied de l'aperçu, au-dessus des outils, avec sa barre de progression et ❚❚. Toucher ▶ ou une piste remplace la lecture ; toucher la pastille ramène au lecteur de l'album en cours (vue grande pochette). Le casque permet au contraire de mettre l'album touché à la suite sans rien interrompre.

## Revenir, et passer de l'aperçu à la lecture

- **Retour à la grille** : la poignée tirée vers le bas (90 px, comme le plein écran actuel) ou touchée ; la pochette elle-même se tire aussi. Pas de ✕ : c'est la même feuille que le lecteur, le même geste.
- **Sans saut** : l'aperçu et la lecture sont *une* mise en page. Seule la bande de 104 px sous les mots change de contenu (▶ + « Plays on this iPhone » ↔ position + ⏮ ⏯ ⏭), en fondu ; la pochette, les mots, la liste et le pied restent où ils sont. Toucher la pochette en lecture agrandit à 300 px (la vue d'aujourd'hui) et la liste s'efface ; la retoucher revient.
- **CD non rippé** : l'aperçu s'ouvre quand même (on voit les pistes, le guide, on met dans Listen Next CD), le ▶ est gris, la ligne dit pourquoi. Pas de fiche imposée.

## Réutiliser les vues du PhonePlayer

L'aperçu est le PhonePlayer avec une cinquième vue, **`album`**, qui devient la vue par défaut à l'ouverture depuis une pochette : pochette moyenne + mots de l'album + bande + liste. Les vues `tracks`, `guide` et `lyrics` existantes gardent leur contenu mais s'affichent **dans la zone de la liste** plutôt qu'avec la vignette de 60 px en haut : `tracks` *est* la vue album ; `guide` et `lyrics` la remplacent en gardant pochette et bande. `cover` reste la vue 300 px d'aujourd'hui. Le pied actuel (Paroles, Guide, Pistes, Sortie) sert tel quel ; ⋯ gagne « Album card » et les entrées Listen Next / Mixtapes / Bought.

## Avantages, inconvénients

- (+) Le parcours d'écoute ne traverse plus la fiche ; le guide devient un bouton ; la pochette ne saute plus.
- (+) Une seule feuille pour voir, lancer et suivre : rien à apprendre de plus que le lecteur actuel.
- (+) La fiche n'est pas touchée : Edit, Delete, codes, partitions restent exactement là où ils sont.
- (−) Deux manières d'ouvrir un album selon l'appareil (fiche sur ordinateur, aperçu sur iPhone) : à assumer, ou à faire aussi sur ordinateur en panneau.
- (−) (i) et ⋯ › Album card font la même chose ; (i) pourrait suffire, ou disparaître.
- (−) Un album entièrement « CD » (collection sans Navidrome) ouvre un lecteur qui ne peut pas jouer : l'aperçu y est une fiche courte, est-ce assez ?
- (−) Le ▶ de la grille garde son sens (jouer tout de suite) ; il y a donc deux cibles sur une pochette de 117 px, comme aujourd'hui.

## Risques d'implémentation

- **PhonePlayer** : le plus touché. Aujourd'hui il n'existe que s'il y a une lecture (`title`, `position`, `controls`…) ; il faut qu'il puisse s'ouvrir **sans lecture** sur un album, puis que `playAlbum` prenne le relais sans remonter le composant (sinon le saut). Deux sources de vérité à réconcilier : l'album de la feuille et l'album qui joue.
- **MusicThumbnail / MusicDexPage** : `onClick` de la pochette n'ouvre plus `MusicDetailCard` sur iPhone mais la feuille ; `AlbumPlayButton` et le casque gardent leur rôle. Le même choix se pose dans la bande Listen Next, les résultats de **MusicSearch** et « Also on … ».
- **MusicDetailCard** : inchangée au départ, ouverte depuis (i)/⋯ ; mais son `Dialog` panel plein écran s'empile sur la feuille (z-index 10100 déjà `!important` pour la fiche, voir le commit des paroles) et son ← doit revenir à l'aperçu, pas à la grille. Ses `steps` ‹ › (album précédent/suivant) n'ont pas d'équivalent dans l'aperçu.
- **Données** : l'aperçu a besoin des pistes et du rip avant de jouer (aujourd'hui lus à l'ouverture de la fiche) ; un aller-retour Navidrome à chaque pochette touchée, à mettre en cache ou à précharger pour la première page de la grille.
- **Tests** : les tests de MusicDexPage qui attendent la fiche au clic sur une pochette changent de contrat sur mobile ; prévoir un garde `appleMobile`/largeur.

## Questions ouvertes

1. Sur ordinateur aussi, ou iPhone seulement ? (Un panneau « aperçu » à droite sur ordinateur serait cohérent, mais ce n'est pas la demande.)
2. Le ▶ de la grille : garder « joue tout de suite », ou ouvrir l'aperçu déjà en lecture (même feuille, un état de plus) ?
3. Les étoiles du propriétaire : dans la fiche seulement, ou un toucher long sur la pochette de l'aperçu ?
4. Pour un coffret de plusieurs disques, Listen Next par disque (décision du 19.10) : le casque de l'aperçu met tout l'album ; le choix par disque reste dans ⋯ ?
5. (i) ou ⋯ : lequel garder ?
