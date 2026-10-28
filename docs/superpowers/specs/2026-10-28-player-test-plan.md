# Plan de test du lecteur (navigateur, Salon, Bureau)

Date : 28.10.2026 · Revue : sous-agent Fable (défauts + plan), corrections et tests ajoutés le même jour.

Couches : **BS** session backend (`backend/tests/music/upnp/session.test.ts`, appareil simulé `fakeRenderer.ts`), **BO** sorties et API backend (`outputs.test.ts`, `e2e.test.ts`, `hardening.test.ts`…), **FP** service du lecteur (`frontend/src/services/player*.test.ts`, `outputs.test.ts`), **FC** composants (`PlayerBar.test.tsx`, `OutputMenu.test.tsx`, `PhonePlayer*.test.tsx`…), **MD** à la main sur les vrais appareils.

Statut : ✅ couvert avant la revue · 🆕 test écrit le 28.10.2026 · ✋ manuel (recette) · ⏳ manquant.

## 1. Lecture dans le navigateur

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| L1 | ▶ une piste → flux sur l'élément actif, la suivante préchargée sur le second | FP | ✅ player.test « plays an album from a track… », « primes the element… » |
| L2 | ⏯ met en pause, ⏯ reprend au même endroit sans recharger la piste | FP | 🆕 player.test « L2: pauses with ⏯… » |
| L3 | ✕ → silence, place gardée, Resume reprend là | FP | ✅ « stops on ✕… » |
| L4 | Saut dans la piste sur Mac → direct, sans rechargement, la barre suit | FP | 🆕 « L4: seeks within a track on a Mac… » |
| L5 | ⏮ début de piste / piste d'avant dans les premières secondes | FP | ✅ |
| L6 | Fin de piste → enchaînement sans trou, Mac tenu éveillé | FP | ✅ |
| L7–L10 | Fin d'album, Listen Next, album retiré, règles du tour | FP | ✅ (14 tests listenNextQueue) |
| L11–L12 | Scrobbles (en cours, compté à la moitié, une fois), sursis Keep here | FP/FC | ✅ |
| L13–L15 | Coupure réseau, reprise à la même place, essais épuisés, préchargement coupé | FP | ✅ |
| L16 | Qualité Auto / Lossless / AAC 256 | FP | ✅ (7 tests) |
| L17 | Rechargement de la page → barre en pause au même endroit | FP | ✅ |
| L18–L21 | iOS : saut avant les données, place lâchée redemandée (≤ 4 fois), second élément refusé écran verrouillé, pas de Web Audio | FP | ✅ / 🆕 « …a place it let go of at the metadata is asked again… » |
| L22 | iOS : son seulement dans le geste | MD | ✋ |
| L23 | iOS : écran verrouillé, centre de contrôle | MD | ✋ |
| L24–L25 | Plein écran iPhone au repos, paroles, cœurs | FC | ✅ |

## 2. Un appareil (Salon, Bureau)

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| A1–A9 | Lecture, enchaînement, fin d'album, ⏸ ▶ saut ⏮, place reprise, Play refusé (701), plafond de volume, appareil sans SetNext, arrêt par sa télécommande | BS/BO | ✅ |
| A10 | Pris par une autre source, plus de média, une lecture vide, un autre DexVault | BS | ✅ |
| A11–A12 | Absent après 3 appels, retour dans les minutes, réveil de l'Onkyo tenant notre piste, retour après 5 min → attend ▶ | BS | ✅ |
| A13 | Lecture voulue pendant l'absence : donnée au retour, 2 min au plus, délai compté depuis la demande | BS | ✅ |
| A13b | Fin des 2 min pendant l'absence → la page ne la montre plus en attente | BS | 🆕 « tells the pages once a play asked while off is no longer to be given… » |
| A14–A16 | Soupapes : ⏸ / ✕ / autre sortie oublient la lecture gardée, coupent nos pistes perdues, réessaient 5 min, suivi 10 min | BS | ✅ (soupapes du 28.10) |
| A17–A18 | Redémarrage de DexVault, appareil éteint et rallumé | BO | ✅ |
| A19–A22 | Listen Next sur l'appareil, 409 / 503, écoute médias, lecture des descriptions | BO | ✅ |
| A26 | Un seul appel sans réponse en donnant une piste → réessayé, pas « away » | BS | 🆕 « is not shown away for one call unanswered… » |
| A27 | Fichier illisible (714) → piste suivante, message ; dernière piste illisible → pause et message | BS | 🆕 « skips a file it cannot play… », « pauses, saying so… » |
| A28 | Piste suivante refusée (SetNext), saut refusé → joue quand même, enchaîne avec un trou | BS | 🆕 « plays on with a gap… » |
| A23–A24 | Vrai Onkyo (réveil, 30 s muet), vrai WiiM | MD | ✋ recette |

## 3. Transferts (source × état)

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| X1 | Navigateur qui joue → Salon libre : même place là-bas | FP/BO | ✅ |
| X2–X3 | Navigateur en pause → Salon (libre, ou avec son propre album en pause) : l'album en main reste | FP | ✅ |
| X4 | Navigateur qui joue → Salon qui joue autre chose : notre album le remplace | FP | 🆕 « X4… » |
| X5 | → Salon absent : lecture gardée, grisé jusqu'à ce qu'il joue | FP/BO | ✅ / 🆕 |
| X6 | → Salon pris : dit « in use », ▶ le reprend | FP | ✅ |
| X7–X8 | Bureau en pause → iPhone / → Salon : l'album vient en main | FP | ✅ |
| X9–X10 | Salon qui joue → Bureau / → iPhone | BO/FP | ✅ |
| X9b | Salon → Bureau : la place est lue après la pause, pas avant | BO | 🆕 « carries a play over from where the first one fell silent… » |
| X11 | Salon arrêté (✕) → iPhone : rien n'est emporté | FP | 🆕 « X11… » |
| X12 | Salon pris par un autre → iPhone : rien n'est emporté, rien envoyé | FP | 🆕 « X12… » |
| X13 | Salon absent avec lecture voulue → Bureau : le serveur l'emporte, le Salon l'oublie | FP + BS | 🆕 « X13… » + ✅ « forgets it once the play goes to another output » |
| X14 | Salon absent, en pause → iPhone : l'album vient en main | FP | 🆕 « X14… » |
| X15 | Album en pause en main → Bureau qui joue : on voit ce qui sonne | FP | 🆕 « X15… » |
| X16 | Album en main, Salon se met à jouer → l'album en main est lâché, ne revient pas à la pause, ▶ ne l'écrase pas | FP | 🆕 « lets go of the album in hand once Salon plays… », « …when ▶ carried it to Salon waking up… » |
| X17 | Transfert vers Salon refusé → l'album reste ici, en pause, ▶ réessaie | FP | 🆕 « keeps the album here, paused, when Salon refuses… » |
| X18–X20 | Appareil disparu, suivi d'un appareil, Listen Next sur Salon | FP | ✅ |

## 4. Ce que montre l'écran

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| U1, U3, U4 | Barre sur Salon qui joue, pris, absent | FC | ✅ |
| U2 | Salon en pause : ⏯ = Play, envoie la reprise | FC | 🆕 « plays Salon on from its pause with ⏯ » |
| U5 | Barre sur Salon qui attend son réveil : grisée, ⏸ l'oublie ; dégrisée dès qu'il joue (le bug du 28.10) | FC | 🆕 « shows a play waiting for Salon to wake… » |
| U6–U7 | Menu des sorties, volume sous le plafond, rafales | FC | ✅ |
| U8 | Volume grisé quand absent, rendu dès qu'il joue | FC | 🆕 « greys the volume of an appliance away… » |
| U9 | Messages : lecture gardée en gris, absent en orange, pris en gris, le reste en rouge ; « kept » seulement pour une commande qui joue | FP + BO | 🆕 « says what went wrong… in the right tone », « says a play is kept only for a command that asks one… » |
| U10–U12 | Libellés du menu, aiguille, retour en arrière d'une commande refusée | FP | ✅ |
| U13 | iPhone plein écran sur Salon : grisé au réveil, dégrisé quand il joue | FC | 🆕 « U13… » |
| U14 | Télécommande iPhone → Mac | FC | ✅ |
| U15 | Barre au repos sur iPhone, bouton Play grisé quand l'appareil est absent | FC | ⏳ |

## 5. Plusieurs pages, SSE

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| M1–M5 | Événements à chaque étape, reconnexion, liste redite, état avant liste | BO/FP | ✅ |
| M5b | L'appareil revient : la liste envoyée aux pages le dit tout de suite (le bug du 28.10, côté serveur) | BO | 🆕 « tells the pages the appliance is back… » |
| M6 | Deux pages : ce que l'iPhone demande, le Mac le voit | BO | 🆕 « M6… » |
| M7 | Serveur indisponible à l'ouverture de l'app → liste redemandée, écoute ouverte | FP | 🆕 « reads the list again later when the server did not answer… » |
| M8 | Deux navigateurs qui jouent, la télécommande parle au dernier | FC | ✅ |

## 6. Concurrence

| id | Scénario → attendu | Couche | Statut |
|---|---|---|---|
| C1–C5, C7–C8 | Clics rapides, ⏭ après un clic, ✕ après un clic, un appel SOAP à la fois, volume en rafale | BS/FP/FC | ✅ |
| C6 | Un sondage en cours pendant ⏭ ne fait pas revenir en arrière | BS | 🆕 « C6… » |
| C9 | ⏸ et ▶ envoyés ensemble par deux pages : l'un après l'autre, le dernier gagne | BS | 🆕 « C9… » |

## Bilan

- Avant la revue : 79 scénarios couverts, 20 manquants (plan de Fable).
- Après : **4 restent manuels** (geste iOS, écran verrouillé, vrais Onkyo et WiiM : recette sur place) et **1 manque** (U15, mineur). Tout le reste a un test automatique.
- Chaque défaut trouvé par Fable a son test, vérifié en échec sans le correctif puis vert avec lui.
