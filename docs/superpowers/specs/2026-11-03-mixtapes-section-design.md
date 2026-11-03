# Mixtapes, lot 1 : la section Mixtapes

Validé le 03.11.2026 (grill-me). Prototype : `2026-11-03-mixtapes-section/prototype.html`.
Suite de `2026-10-18-mixtapes-design.md`, dont les choix restent (Navidrome fait foi, mosaïque de
Navidrome, menu en bascule sur un CD, jamais de doublon créé par DexVault).

Usages : surtout des **mixtapes de running** (longues, jouées sur l'iPhone, souvent en aléatoire,
qui grandissent par petites touches), parfois une **mixtape de concert** pour écouter les pièces d'un
programme avant d'y aller : là, l'unité est l'œuvre, pas la piste.

Constat : une seule mixtape en prod (« Running », 54 pistes) quinze jours après la livraison. Une
mixtape ne se compose que depuis la fiche de chaque CD, une piste à la fois, et n'a pas de place à
elle : elle se perd parmi les CD derrière un interrupteur.

Les mixtapes sont livrées en trois lots, chacun son grill-me :
1. **la section Mixtapes** (ce document) ;
2. les mixtapes intelligentes : Classique / Autre / les deux × ♥ / populaires / les deux ;
3. les pistes isolées dans Listen Next : Play Next (après ce qui joue) et Play Last (en fin de file),
   une piste sortant au scrobble ou par ✕ comme un album.

## Entrée

- Un `Segmented` **Albums | Mixtapes** au début de la tête de MusicDex ; la vue Mixtapes a son
  adresse, `/musicdex/mixtapes`, et MusicDex se rouvre sur la vue quittée.
- Les mixtapes **quittent la grille des albums** : l'interrupteur Mixtapes et les mots
  `mixtape:yes` / `mixtape:no` disparaissent (le filtre Medium les perd).
- **Listen Next est le même** dans les deux vues : une seule file, sa bande en tête, qui ne bouge
  pas au passage d'une vue à l'autre.
- Sur l'iPhone, le même Segmented en tête de page, à la place du compte, qui passe dans la vue.

## La vue

- Une **grille de pochettes** comme celle des albums : la mosaïque de Navidrome, le nom, puis
  « 54 tracks · 3 h 16 ».
- En tête de grille, une tuile **+ New mixtape** de la taille d'une pochette.
- Les gestes de la grille des albums : un clic ouvre la fiche, ▶ au survol, les écouteurs de Listen
  Next, ⋯.
- Tri : **dernière modification** (par défaut), nom, durée ; pas de regroupement.
- La recherche de la tête cherche dans les noms et le contenu (titres et artistes des pistes).

## Composer : Add tracks…

Un composant, le même sur l'ordinateur (en tête des pistes de la fiche) et sur l'iPhone (une feuille).

- Un champ **Add tracks…** (`TextField`, loupe), des suggestions à la frappe dans le verre des menus.
- Les mots cherchent dans le **titre, l'artiste et l'album**, parmi **ce qui se joue** : les CD
  rippés et les albums numériques ; ni la wish list ni les autres mixtapes.
- Une piste : vignette de son CD, titre, « artiste · album », durée, le point gris des populaires et
  le ♥ comme ailleurs.
- **Bascule, sans Undo** : un clic met le ✓ doré et ajoute la piste à la fin ; un second clic retire
  le ✓ et la piste. Il n'y a jamais de doublon.
- **La place est gardée le temps d'une saisie** : une piste retirée puis remise sans quitter le
  champ reprend sa place d'avant. Les mots changés ou le champ quitté, la mémoire s'oublie.
- **Les albums en tête des résultats** quand les mots trouvent un titre d'album (deux ou trois au
  plus), avec la bascule à trois états du menu des CD : ✓ tout y est, « 4 of 17 » une partie, rien.
  Un clic ajoute les manquantes à la fin, un clic sur ✓ retire tout.
- **Les œuvres** entre les albums et les pistes : Albums, puis Works, puis Tracks. Une œuvre (la
  `work` des pistes, comme le regroupement des mouvements de l'iPhone) est une ligne, « Symphony
  no. 9 · 4 movements · 41 min · Karajan », l'interprète la distinguant d'une autre version, avec
  la bascule à trois états : un clic ajoute tous ses mouvements dans l'ordre.
- **Un album ajouté se déplie** : ses pistes en retrait, chacune avec son ✓, pour décocher ce qu'on
  ne veut pas. Un chevron le déplie ou le replie sans rien ajouter. Déplié, la liste défile dans sa
  hauteur, la tête de l'album collée en haut tant que ses pistes défilent.
- Dans un album déplié, les mouvements sont rangés sous leur œuvre, chaque œuvre cochable d'un coup.
- Un album retiré puis remis pendant la saisie reprend sa place lui aussi.
- **Esc** vide le champ. **↵** bascule la ligne surlignée et garde la liste ouverte.

## Les œuvres dans la mixtape

- Les mouvements d'une même œuvre qui se suivent sont **groupés sous sa tête**, comme sur l'iPhone.
- **Réordonner** déplace l'œuvre entière (par sa tête) ; un mouvement se retire seul.
- **Shuffle tire des unités** : une œuvre est une unité, ses mouvements joués dans l'ordre ; une
  chanson seule en est une. De même pour l'ordre tiré une fois d'une mixtape dans Listen Next
  (`mixtapeShuffle`).

## Créer

- La tuile **+ New mixtape** crée une mixtape vide, « New mixtape », et ouvre sa fiche, le nom
  sélectionné en place (on tape, ↵), le champ Add tracks… dessous.
- Depuis une piste ou un CD, **New mixtape…** garde sa petite fenêtre de nom : on a déjà de quoi la
  remplir.
- Une mixtape **laissée vide** à la fermeture de sa fiche est supprimée sans question.

## Le ⋯ d'une mixtape

Le même dans la grille, dans la fiche et dans le lecteur de l'iPhone :
- **Rename** (sur place dans la fiche ; depuis la grille, ouvre la fiche le nom sélectionné) ;
- **Duplicate** : « Running (copy) », mêmes pistes, même ordre, sa fiche ouverte le nom sélectionné ;
- **Listen Next** (✓ quand elle y est) ;
- **Open in Navidrome** ;
- **Delete mixtape…** en rouge, `confirm` (« Delete Running? 54 tracks. It leaves Navidrome and
  Listen Next. »), sans Undo.

Shuffle reste dans la fiche, pas dans le ⋯.

Une mixtape de concert n'a **rien de particulier** : ni date, ni archive, ni sorte à part. Le tri par
dernière modification la fait descendre ; on la supprime par le ⋯ quand on veut.

## iPhone

- La même grille, deux colonnes, la tuile + en tête.
- **Toucher une mixtape ouvre le lecteur plein écran au repos** sur ses pistes, comme un album ;
  ▶ et Shuffle au milieu.
- Une piste glissée vers la gauche **sort de la mixtape** (à la place du ♥, qui reste à l'appui long).
- Le ⋯ du lecteur porte **Add tracks…** (la feuille de composition) puis le ⋯ commun.
- **Réordonner** : appui long puis glisser, une piste seule ou une œuvre entière.
- **+ New mixtape** ouvre la feuille Add tracks…, le nom en tête prêt à taper.

## Tranché au prototype (03.11.2026)

- **↵ garde la liste ouverte** (variante A) : il bascule la ligne surlignée, les mots restent.
- Un album déplié : la liste défile dans sa hauteur, sa tête collée en haut, comme au prototype.
- **Réordonner au doigt** par appui long, gardé : une piste seule ou une œuvre entière.
