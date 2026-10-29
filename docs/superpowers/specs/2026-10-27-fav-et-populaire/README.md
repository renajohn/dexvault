# ♥ et pistes populaires sur l'iPhone (exploration du 27.10.2026)

Constat : sur le Mac, la fiche montre le point gris des pistes populaires et le ♥ (or s'il
est favori, en contour sous le pointeur). Sur l'iPhone il n'y a pas de pointeur : le contour
ne se voit que sur la piste ouverte de la fiche, et la liste des pistes du lecteur plein
écran ne montre ni l'un ni l'autre.

Prototype : `prototype.html` (cadre iPhone, deux écrans et trois variantes à droite).

## Commun aux trois variantes

- **Populaire** : le point gris de 4 px du Mac, à gauche du numéro, dans la liste du lecteur
  comme dans la fiche ; jamais or. Il reste à gauche des barres sur la piste qui joue.
- **Favori** : un ♥ or de 12 px contre la durée ; rien quand la piste n'est pas favorite.
- Le ♥ du haut du lecteur (piste qui joue) ne change pas, il partage l'état (`favourites.ts`).

## Poser le ♥

| Variante | Geste | Pour | Contre |
|---|---|---|---|
| A | Glisser la ligne vers la gauche | La plus discrète | Invisible ; en concurrence avec le défilement et le glisser qui ferme le lecteur |
| B | Contour pâle toujours là, un toucher | Se découvre seul | Une colonne de plus, onze contours visibles, touchers manqués |
| C | Appui long → menu (♥, mixtape, Play from here) | Discret et extensible | Caché ; retenir le menu de Safari |

Dans la fiche, toutes gardent le toucher qui ouvre la piste ; A et C y ajoutent un bouton
« ♥ Favourite » dans la rangée ouverte, double visible du geste.

## Recommandation

Les marques partout, **C** pour poser le ♥, et le bouton « ♥ Favourite » dans la rangée
ouverte de la fiche.

## Pour coder

- Les pistes du lecteur viennent de Navidrome : `starred` est déjà dans `PlayerTrack`
  (`playAlbum.ts`), il suffit de le semer (`seedFavourite`) et de lire `useFavourite`.
- `popular` vient des pistes de l'album dans DexVault : à joindre par disque et numéro dans
  `playAlbum.ts` (Listen Next mêle plusieurs albums, chacun a ses populaires).

## Décision et réalisation (27.10.2026)

Retenu : les marques partout, l'appui long (C) pour poser le ♥, la rangée ouverte de la
fiche comme double visible.

- **Lecteur, vue Tracks** (`PhonePlayer.tsx`, `TrackLine`) : point gris des populaires, ♥ or
  des favoris ; un toucher joue la piste ; un appui de 480 ms ouvre un `Menu` : Add to / Remove
  from the favourites, Play from here, les mixtapes. Les pistes portent `popular` (DexVault,
  par disque et numéro) et `starred` (Navidrome), côté page (`playAlbum.ts`) comme côté
  serveur pour les appareils (`playable.ts`, `outputController.ts`).
- **Fiche sur téléphone** (`MusicDetailCard.tsx`, `TrackHold`) : le même menu à l'appui
  long ; le ♥ suit aussi le rip quand la bibliothèque numérique ne connaît pas l'album (il
  manquait alors sur l'iPhone) ; le contour ne prend plus de place sur une piste fermée et
  reste sur la piste ouverte, qui sert de double visible. Le bouton « ♥ Favourite » à libellé
  du prototype n'a pas été ajouté : il aurait doublé le ♥ déjà présent dans la rangée ouverte.
- **Fermer le menu** : toucher n'importe où ailleurs. Ce toucher ne fait que fermer, comme
  les menus contextuels d'iOS : il ne joue pas la piste touchée.
- `Menu` a un mode contrôlé (`open`) pour s'ouvrir sans clic sur son déclencheur ;
  `utils/useLongPress.ts` fait l'appui long (annulé par un mouvement de plus de 10 px,
  le clic qui suit est avalé, iOS ne sélectionne pas les mots).
- Les chansons d'une mixtape n'ont pas de point : leur popularité est celle de leur album, non jointe.

## Le lecteur glisse au lieu de l'appui long (29.10.2026)

Dans la vue Tracks du lecteur, l'appui long était trop caché : la ligne glisse maintenant
comme celles de la wish list (`SwipeRow`, en `li`, sans fond propre : ce qu'elle découvre
n'apparaît que là où elle s'est écartée). À droite, le ♥ (Favourite / Not favourite), fait
au lâcher passé le seuil ; à gauche, de même, Mixtape : lâché passé le seuil, le `Menu` des
mixtapes s'ouvre aussitôt, sans bouton intermédiaire. Le menu se ferme au toucher ailleurs
(`Menu` écoute aussi `pointerdown` : Safari n'envoie pas de `mousedown` sur ce qui ne fait rien),
et au toucher de sa propre ligne, sans la jouer. Pas d'infobulle sur sa première entrée : le
`TooltipHost` ignore un focus donné après un toucher, que Safari dit pourtant `:focus-visible`.
Play from here disparaît (c'est le toucher). Toucher la piste en cours ne fait rien. Une
fois, la première ligne s'entrouvre pour dire qu'elle glisse. La fiche (`TrackHold`) garde
l'appui long pour l'instant.
