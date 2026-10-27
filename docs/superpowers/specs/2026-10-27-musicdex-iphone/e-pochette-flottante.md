# Piste E — ce qui joue, par-dessus la fiche (iPhone)

Prototype : `e-pochette-flottante.html` (cadre iPhone 393×852 ; à droite, la variante, ce qui joue — un autre album, cet album, un autre en pause, rien — et la zone du geste d'accueil).
S'ajoute à la décision du 27.10.2026 (README) : aperçu B pour le parcours, fiche A derrière.

## Le principe

La fiche (l'aperçu B ou la fiche A) prend **toute la page** : la pastille du lecteur (64 px et ses marges) ne se pose plus sous elle et ne réserve plus `--player-h`. Ce qui joue reste visible sous une forme réduite à une **porte** : un disque cerclé de sa progression, dont un toucher ouvre le lecteur plein écran. Dans le lecteur, la poignée ramène à la fiche restée dessous, et ⋯ › Open <album> met dans la fiche l'album qui joue.

## Quatre variantes

1. **Bulle flottante.** Un disque de 60 px (la pochette ronde, l'anneau or, un égaliseur dans son coin). Elle se pose par défaut **en bas à droite, 12 px au-dessus du pied**, jamais sur ▶ Play, Listen Next, ⋯ ni sur ✕. On la tire d'un doigt vers l'un des quatre coins (sous la tête, au-dessus du pied), ou contre un bord pour la ranger en languette. Le corps de la fiche gagne 84 px en bas.
2. **Titre prêté.** Un disque de 26 px qui tourne, cerclé, dans la tête entre l'étagère et ✕. Rien ne flotte. Les ‹ › d'album précédent/suivant quittent la tête sur l'iPhone.
3. **Bande fine.** 28 px sous le pied : pochette 20 px, titre qui défile, ⏯, filet or. Touchée ou glissée vers le haut, elle ouvre le lecteur.
4. **Disque au pied** (ma proposition). Le disque de la bulle (32 px dans un anneau de 40), posé à gauche du pied, avant ▶ Play, séparé par un filet. Aucune hauteur prise, rien ne couvre la liste, rien à tirer.

## Allers-retours

- **Fiche → lecteur** : 1 toucher sur la porte (ou un glissé vers le haut, en 3 et 4). Quand l'album de la fiche est celui qui joue, sa **pochette** (avec l'égaliseur) et sa piste en or ouvrent aussi le lecteur.
- **Lecteur → fiche** : la poignée ou un glissé vers le bas (la fiche est restée dessous). ⋯ › **Open <album>** remplace la fiche par l'album qui joue. Si c'est déjà le même, l'entrée se lit **Back to <album>**.
- **Même album** : en 1, 3 et 4 la porte **disparaît**. Le pied dit déjà ❚❚ Pause, et la pochette et la piste en or disent ce qui joue. En 2, le disque reste, car il ne double rien du pied.
- **Rien ne joue** : aucune porte, la fiche est seule. Un Stop depuis le lecteur fait disparaître la porte aussitôt.

## « Je veux écouter cet album », en touchers

- Depuis la grille : pochette → aperçu → ▶ (**2 touchers**), ou le ▶ de la vignette (**1**). Aucune variante ne change ce compte.
- Pendant qu'un autre album joue : fiche → porte → lecteur de l'album en cours (1 toucher), puis poignée → la fiche (1 geste).
- Aujourd'hui, la pastille couvrait ou poussait le pied. Sur le nouveau pied à trois boutons, ▶ Play n'est plus jamais caché.

## Ce que devient chaque élément de la fiche

Rien ne change par rapport à la fiche A : pochette 112 px fixe, méta coupée, étoiles sur leur ligne réservée, puces (Guide, Notes, Wikipedia, Also on, Links, Edition & codes), pistes aussitôt. Le pied garde ▶ Play (or), Listen Next et ⋯ (Mixtapes, Bought, Edit, Delete). Seuls changent :
- la **pochette** de la fiche, qui ouvre le lecteur quand son album joue, au lieu de s'agrandir ;
- le **pied**, qui gagne le disque à gauche en variante 4 (Listen Next perd son mot à 375 px) ;
- la **tête**, qui perd ‹ › en variante 2.

## Comparaison et recommandation

| | 1 Bulle | 2 Titre | 3 Bande | 4 Pied |
|---|---|---|---|---|
| Couvre la fiche | oui (60 px sur la liste) | non | non | non |
| Hauteur prise | 0 | 0 | +28 px | 0 |
| Sous le pouce | oui | non | oui | oui |
| Geste d'accueil iOS | loin | loin | **frôlé** | loin |
| À apprendre | tirer, ranger | rien | glisser | rien |

**Je recommande la variante 4**, le disque au pied, avec l'anneau et l'égaliseur de la bulle. Elle sert le vœu (toute la page, ce qui joue visible, un toucher vers le lecteur) sans rien couvrir ni rien apprendre. La bulle (1) est la vraie « pochette flottante » : elle se voit de loin, mais elle couvre les durées ou les numéros des pistes, et un pouce qui fait défiler la touche. La bande (3) est la pastille en plus mince, posée sur la zone du geste d'accueil. Le titre (2) est trop loin du pouce et trop près de ✕.

## Risques d'implémentation

- **PlayerBar.tsx** : il doit savoir qu'une fiche plein écran est ouverte. Il cache alors la pastille et remet `--player-h` à 0, sinon `.modal` (App.css) garde sa hauteur réduite. Il faut un signal partagé, par exemple un drapeau `cardOpen` dans le store du lecteur, posé par la fiche à son montage.
- **PhonePlayer.tsx** : `full` est un état local, et la pastille seule l'ouvre. Il faut le remonter (store ou `openFull()` exposé) pour qu'une porte rendue ailleurs ouvre le plein écran. La pastille se découpe : un `NowPlayingDisc` (pochette, anneau, égaliseur) réutilisé par la porte. Le reste du plein écran ne change pas, `leave(onOpen)` ferme déjà avant d'ouvrir la fiche.
- **MusicDetailCard.tsx** : un emplacement à gauche du pied pour le disque, et la pochette qui ouvre le lecteur quand son album joue. Il faut aussi le passage à 375 px sans que rien ne dépasse.
- **Ordre des couches** : le plein écran (10500) est déjà au-dessus de la fiche (10100). Une bulle (variante 1) devrait vivre entre les deux, dans le portail de la fiche, sinon elle passe sous son voile.
- **Rien à changer** dans MusicThumbnail, MusicSearch ni la grille.
- **Tests** : les tests de PlayerBar qui attendent la pastille changent quand une fiche est ouverte.

## Questions ouvertes

- Une fiche **centrée** (livres, films) ou le lecteur dans une autre page : la pastille revient-elle telle quelle ? (C'est mon hypothèse : seule la fiche musique plein écran cache la pastille.)
- ⋯ › Open <album> **remplace** la fiche dessous : faut-il garder la précédente pour un retour (pile de deux) ?
- La pochette de la fiche qui ouvre le lecteur quand son album joue : est-ce assez découvrable, ou faut-il garder le disque au pied même pour le même album ?
- Variante 4 : le disque à **gauche** (lu avant Play) ou à **droite** après ⋯ (plus loin du pouce gauche) ?
- La bulle (1) mérite-t-elle d'être gardée comme réglage pour qui la préfère, au prix du code du glissé ?
