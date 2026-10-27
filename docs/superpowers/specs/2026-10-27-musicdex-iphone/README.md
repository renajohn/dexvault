# MusicDex sur iPhone : écouter d'abord (exploration du 27.10.2026)

Constat : sur l'iPhone, MusicDex sert surtout à écouter. Toucher une pochette ouvre la
fiche album, et il faut traverser un mur de texte (méta, étoiles, guide d'écoute, notes)
avant d'atteindre les pistes ; le pied porte six boutons dont quatre servent rarement au
doigt. Quatre pistes ont été dessinées en parallèle, chacune avec un prototype HTML dans
un cadre iPhone (ouvrir le fichier dans un navigateur, scénarios à droite) et une note.

| Piste | Idée en une ligne | Prototype | Note |
|---|---|---|---|
| A | La fiche reste l'entrée, réordonnée : en-tête à hauteur fixe, pistes aussitôt, le reste en puces → feuille, pied Play + Next + ⋯ | `a-fiche-ecoute.html` | `a-fiche-ecoute.md` |
| B | La pochette ouvre la vue du lecteur à l'arrêt (gros ▶, pistes) ; (i)/⋯ ouvrent la fiche | `b-pochette-lecteur.html` | `b-pochette-lecteur.md` |
| C | Feuille demi-hauteur sur la grille, tirée en fiche ; appui long = menu contextuel | `c-feuille-appui-long.html` | `c-feuille-appui-long.md` |
| D | Deux faces Listen / Collection par un Segmented | `d-deux-faces.html` | `d-deux-faces.md` |

## Ce qui ressort des quatre

- **Le nombre de touchers ne bouge pas** (2 depuis la grille, 1 par le ▶ de la vignette,
  déjà là). Le gain réel est l'absence de défilement et de changement de contexte.
- **Trois décisions font consensus**, quelle que soit la piste retenue :
  1. une boîte de pochette à hauteur fixe, la méta coupée à droite, les étoiles sur une
     ligne réservée (elles ne déplacent plus rien) ;
  2. le guide d'écoute, les notes, Wikipedia, « Also on », liens et codes deviennent des
     boutons/puces qui ouvrent, jamais du texte en place sur l'iPhone ;
  3. le pied se réduit à ▶ Play (or) et Listen Next, le reste (Mixtapes, Bought, Edit,
     Delete, Amperfy, sortie) sous ⋯.
- **La piste D se disqualifie elle-même** : un état de plus à retenir, et elle ne règle
  rien des problèmes de la fiche. À garder d'elle : le (i) sur la vignette et l'idée d'un
  rayon « Played lately ».
- **B et C sont la même famille** : une feuille qui vient du bas, pistes tout de suite,
  fiche à un geste derrière. B la fait depuis le lecteur existant (PhonePlayer, vue
  `album` en plus), C depuis la fiche (MusicDetailCard devenue feuille à deux états).
- **A est la plus sûre** : même porte d'entrée, l'ordinateur ne change pas, mais elle
  garde un plein écran qui coupe de la grille.

## Recommandation

Partir de **B** pour le parcours (la pochette mène au lecteur à l'arrêt, ⋯ et (i) ouvrent
la fiche), et appliquer **les trois décisions de A** à la fiche elle-même, qui reste
nécessaire (Edit, codes, partitions, wish list) et peut être allégée ensuite. L'appui long
de C est un bonus à juger plus tard : il entre en conflit avec l'appui long du casque.

Points à trancher avant de coder (voir les notes) :
- PhonePlayer doit pouvoir s'ouvrir sans lecture, puis laisser `playAlbum` prendre le
  relais sans remonter ; un album touché pendant qu'un autre joue garde la pastille.
- ▶ de la vignette : joue tout de suite (comme aujourd'hui) ou ouvre l'aperçu en lecture.
- Album non rippé : aperçu avec ▶ gris et « On CD only », ou fiche.
- Une piste touchée dans la liste : joue (B, C) ou se déplie (aujourd'hui).
- Sur ordinateur, rien ne change dans un premier temps.

## Décision (27.10.2026)

**B pour le parcours, la fiche A derrière.** Sur l'iPhone, toucher une pochette ouvre
l'aperçu de l'album (la vue du lecteur à l'arrêt) ; (i) et ⋯ › Album card ouvrent la fiche,
redessinée comme la piste A. Contrainte ajoutée : **aucun bouton ne dépasse** de l'écran,
à 375 px comme à 393 px. La rangée de puces de A (« Also on » était coupée dans le
prototype) passe à la ligne au lieu de défiler ; le pied tient ses trois boutons en une
ligne. L'ordinateur ne change pas.

## Correction (27.10.2026, le soir)

L'aperçu codé à part (AlbumSheet) faisait **deux écrans de lecture** : refusé. L'idée de B
était d'utiliser **le lecteur plein écran lui-même**. Toucher une pochette ouvre donc
PhonePlayer sur l'album, au repos tant qu'il ne joue pas : sa ligne (CD · 12 tracks ·
45 min · 2012) à la place du curseur, ▶ seul, le guide et les pistes au pied, ⋯ › Open
<album> pour la fiche. Si un autre album joue, sa **mini-pochette** (le disque cerclé de la
variante E4) se tient en bas à gauche et ramène à lui. La fiche garde son disque au pied ;
sa pochette ouvre aussi le lecteur. Un CD sans rip ouvre sa fiche, comme avant.
