# Lecture UPnP/DLNA sur l'Onkyo (et le WiiM) — conception

Date : 25.10.2026 · Branche : `renajohn/DNLA` · Phase 1/4 (plan, aucun code produit)

## 0. En bref

- **Le salon** : Onkyo **TX-RZ70**, « Salon », `192.168.86.47`, description
  `http://192.168.86.47:8888/upnp_descriptor_0`, MediaRenderer:2 (AVTransport:2,
  RenderingControl:2, ConnectionManager:2). Il accepte `audio/flac` et `audio/x-flac`
  (et DSD, WAV, AIFF…), annonce **`SetNextAVTransportURI`** (enchaînement sans blanc),
  `GetPositionInfo` (RelTime **et** AbsTime), `Seek` en `REL_TIME`/`ABS_TIME`/`TRACK_NR`,
  et `GetVolume`/`SetVolume` 0–100 (volume actuel lu : 57).
- **Le WiiM** : **WiiM Mini**, « Bureau », `192.168.86.20`, description
  `http://192.168.86.20:49152/description.xml`, MediaRenderer:1 (Linkplay).
  `audio/flac`, `SetNextAVTransportURI`, `GetPositionInfo` (RelTime seul, AbsTime
  `NOT_IMPLEMENTED`), `Seek` en `REL_TIME`/`TRACK_NR` seulement, volume 0–100 (lu : 100).
  **Verdict : oui, le WiiM marcherait aussi**, par le même chemin standard ; il est dans
  le bureau, pas au salon.
- **Hi-res** : `GetProtocolInfo` ne dit rien des fréquences ni des profondeurs pour le
  FLAC (`http-get:*:audio/flac:*`, joker). D'après les fiches des fabricants, le TX-RZ70
  lit le FLAC jusqu'à 192 kHz/24 bits et le WiiM Mini jusqu'à 192 kHz/24 bits ; **à
  vérifier à l'oreille et à l'affichage en phase 4** (le récepteur affiche le format reçu).
- **URL des fichiers** : `music.lab.crog.org` se résout bien sur le LAN en
  `192.168.86.50` (p-cloud), mais en **HTTP elle renvoie un 301 vers HTTPS** (redirection
  globale de l'entrée `web` de Traefik), et le port 4533 de Navidrome n'est pas publié.
  On ne sait pas si l'Onkyo suit un 301 ni s'il parle TLS. **Stratégie retenue** : une
  petite écoute HTTP en clair de DexVault, sur un port publié à part (`3002`), qui ne sert
  que `/upnp/stream/…` (relais de `/rest/stream?format=raw` de Navidrome, octets inchangés,
  Range transmis) et `/upnp/cover/…`, protégée par un jeton de session. Les identifiants
  Navidrome ne sortent jamais vers les appareils.
- **Docker** : on garde le réseau `web` en pont. Pas de `network_mode: host` (il casserait
  Traefik et la résolution de `navidrome:4533`). Les SOAP sortants vers les appareils
  marchent depuis le conteneur (vérifié : description de l'Onkyo et du WiiM lue depuis
  `dexvault-dexvault-1`). La découverte SSDP ne marche pas depuis le pont (multidiffusion)
  et **le M-SEARCH unicast n'obtient aucune réponse** de l'Onkyo ni du WiiM (vérifié depuis
  le Mac et depuis le conteneur) : les appareils sont donc **configurés** par l'URL de leur
  description, avec réservations DHCP, et la découverte SSDP sert seulement en dev sur le
  Mac et à un petit script d'aide.

## 1. Sondage du réseau (lecture seule)

Fait le 25.10.2026 vers 18 h 18 depuis le Mac (`192.168.86.51`), puis depuis le conteneur
de prod. Aucune commande changeant l'état (pas de `SetAVTransportURI`, `Play`, `SetVolume`).
Appels faits : M-SEARCH, descriptions, SCPD, `GetProtocolInfo`, `GetTransportInfo`,
`GetMediaInfo`, `GetPositionInfo`, `GetCurrentTransportActions`, `GetDeviceCapabilities`,
`GetTransportSettings`, `GetVolume`, `GetMute`. Les réponses brutes sont en annexe A.

### Appareils trouvés (ST `urn:schemas-upnp-org:device:MediaRenderer:1`)

| | Onkyo | WiiM | Panasonic |
|---|---|---|---|
| Nom | Salon | Bureau | DP-UB820/824 |
| Modèle | TX-RZ70 (« Digital Media Client ») | WiiM Mini Receiver | Blu-ray Disc Player |
| Firmware | non indiqué (serveur `GUPnP/0.20.13`, Linux 4.9.123) | `modelNumber` « V01-Jun 8 2026 » | — |
| IP | 192.168.86.47 | 192.168.86.20 | 192.168.86.22 |
| Description | `:8888/upnp_descriptor_0` | `:49152/description.xml` | `:60606/FFFFFFFFFFFF/Server0/ddd` |
| Type | MediaRenderer:**2**, DMR-1.50 | MediaRenderer:1, DMR-1.50 | MediaRenderer:1 |
| AVTransport | `/Control/oap/AVTransport` (v2) | `/upnp/control/rendertransport1` (v1) | `/Server0/AVT_control` |
| RenderingControl | `/Control/oap/RenderingControl` (v2) | `/upnp/control/rendercontrol1` (v1) | `/Server0/RCS_control` |
| ConnectionManager | `/Control/oap/SinkConnectionManager` (v2) | `/upnp/control/renderconnmgr1` (v1) | `/Server0/CMS_control` |
| Autres services | — | `PlayQueue` (Linkplay), `QPlay` (Tencent) | — |

Le Panasonic (lecteur Blu-ray) répond aussi ; il n'est pas une cible et n'est pas configuré.

### Capacités utiles

| | Onkyo TX-RZ70 | WiiM Mini |
|---|---|---|
| FLAC | `audio/flac:*`, `audio/x-flac:*` | `audio/flac:*` |
| Autres sans perte | WAV, AIFF, LPCM 44,1/48 kHz, DSD (`x-dsd`, `x-dsf`, `x-dff`) | WAV/LPCM, APE |
| Hi-res annoncé | joker (`*`) : fiche 192/24 | joker (`*`) : fiche 192/24 |
| `SetNextAVTransportURI` | **oui** | **oui** |
| `GetPositionInfo` | RelTime, AbsTime, TrackDuration | RelTime, TrackDuration ; AbsTime `NOT_IMPLEMENTED` |
| Modes de `Seek` | ABS_TIME, REL_TIME, TRACK_NR, ABS_COUNT, REL_COUNT, X_DLNA_REL_BYTE | REL_TIME, TRACK_NR |
| Modes de lecture | NORMAL, REPEAT_TRACK, REPEAT_ONE, REPEAT_ALL | NORMAL, REPEAT_ONE, REPEAT_ALL, SHUFFLE |
| Volume | 0–100, pas 1 ; `GetMute`/`SetMute` | 0–100, pas 1 ; `GetMute`/`SetMute` |
| Événements (GENA) | `LastChange` évènementiel (AVT, RC) | `LastChange` évènementiel |
| État au repos | `NO_MEDIA_PRESENT`, actions vides | `NO_MEDIA_PRESENT`, `Play,Stop,Seek,X_DLNA_SeekTime,Pause` |

Pour la suite on n'utilise que `REL_TIME` pour `Seek` (commun aux deux) et `RelTime` pour
la position.

### Navidrome vu du LAN

- `music.lab.crog.org` → `192.168.86.50` par le DNS du routeur (`192.168.86.1`) ;
  `dexvault.lab.crog.org` aussi.
- `http://music.lab.crog.org/` → **301** vers `https://…` (Traefik :
  `--entrypoints.web.http.redirections.entrypoint.to=websecure`, global).
- `https://music.lab.crog.org` : certificat Let's Encrypt `*.lab.crog.org` valide
  jusqu'au 20.12.2026, HTTP/2.
- Ports ouverts sur p-cloud : 80, 443, 8080… ; **4533 et 3001 fermés** (Navidrome et DexVault
  ne sont joignables que par Traefik). Port **3002 libre**.
- Depuis le conteneur DexVault : `http://navidrome:4533/ping` répond 200, la description de
  l'Onkyo et celle du WiiM se lisent. M-SEARCH unicast vers `192.168.86.47:1900` : aucune
  réponse (ni depuis le Mac, ni pour le WiiM).

## 2. Architecture backend

DexVault devient le point de contrôle UPnP : il tient la file, parle SOAP aux appareils,
suit leur position, scrobble, et enchaîne Listen Next même quand aucun navigateur n'est
ouvert (iPhone verrouillé).

### 2.1 Modules

`backend/src/services/upnp/` :

- **`soap.ts`** — client SOAP écrit à la main (axios, déjà là) : enveloppe, en-tête
  `SOAPACTION`, `Content-Type: text/xml; charset="utf-8"`, délai 4 s, lecture des
  réponses par une petite fonction `flatXml()` (les réponses UPnP sont plates : une
  balise par argument) et décodage des entités ; `UPnPError` avec `errorCode` lu dans
  `<s:Fault>`. **Pas de bibliothèque** : `node-ssdp`, `upnp-device-client` ou
  `fast-xml-parser` apporteraient plus qu'on n'en utilise ; une centaine de lignes
  suffisent et se testent hors ligne. Si l'analyse des descriptions devient fragile,
  `fast-xml-parser` (sans dépendance) est le seul ajout envisagé.
- **`device.ts`** — lit une description (`friendlyName`, `manufacturer`, `modelName`,
  `UDN`, URL de contrôle des trois services, versions 1 ou 2, URL de base pour les
  chemins relatifs), puis le SCPD d'AVTransport pour savoir si `SetNextAVTransportURI`
  existe, et `GetProtocolInfo` pour vérifier `audio/flac`. Résultat mis en cache ;
  relu au premier échec.
- **`didl.ts`** — DIDL-Lite d'une piste : `dc:title`, `upnp:artist`, `dc:creator`,
  `upnp:album`, `upnp:originalTrackNumber`, `upnp:albumArtURI` (JPEG servi par l'écoute
  médias), `upnp:class object.item.audioItem.musicTrack`, `<res protocolInfo=
  "http-get:*:audio/flac:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000"
  duration="0:04:06.000" size=…>`. Le type MIME vient du `suffix`/`contentType` de
  Navidrome (FLAC le plus souvent ; MP3 ou AAC pour un achat numérique).
- **`renderers.ts`** — registre : la liste configurée (§2.4), chaque appareil avec son
  état joignable/non joignable, relu toutes les 60 s quand il n'est pas en lecture. Si la
  description ne répond plus, essai des ports voisins (`49152–49160` pour un WiiM, dont
  libupnp change le port au redémarrage) sur la même IP. En dev (Mac), `UPNP_DISCOVERY=ssdp`
  ajoute les appareils trouvés par M-SEARCH.
- **`session.ts`** — une **session par appareil** : la file (`PlayerAlbum` + `PlayerTrack[]`
  comme côté client, index, options Listen Next), l'état (`playing`, `paused`, `stopped`,
  `taken` = un autre usage a pris l'appareil, `unreachable`), position et durée lues, la
  dernière lecture comptée. Méthodes : `playAlbum`, `toggle`, `next`, `previous`,
  `playTrack`, `seek`, `setVolume`, `setMute`, `stop`. Les commandes d'une session passent
  une à une (file de promesses) : l'Onkyo n'aime pas deux SOAP en même temps.
- **`poller.ts`** — `GetTransportInfo` + `GetPositionInfo` chaque seconde pendant la
  lecture, toutes les 5 s en pause, `GetVolume` toutes les 5 s ; rien quand la session
  est arrêtée. On ne s'abonne pas aux événements GENA dans un premier temps : ils
  demandent que l'appareil rappelle DexVault (port publié, renouvellement des
  abonnements) pour un gain faible à une seconde près. Possible plus tard sur l'écoute
  médias (`/upnp/events/:udn`).
- **`media.ts`** — l'écoute HTTP en clair (`http.createServer` sur `UPNP_MEDIA_PORT`) :
  - `GET|HEAD /upnp/stream/:token/:songId.:ext` → `navidromeService.stream(songId, range)`
    tel quel (status, `content-type`, `content-length`, `content-range`,
    `accept-ranges`) ; `format=raw`, donc **aucun transcodage**. Ajoute
    `transferMode.dlna.org: Streaming` et `contentFeatures.dlna.org` quand on les demande.
  - `GET /upnp/cover/:token/:file` → la pochette de DexVault réduite à 600 px en JPEG
    (`sharp`, déjà là ; certains appareils refusent le WebP et les grosses images).
  - `token` : 32 octets aléatoires par session, valables tant qu'elle vit, plus 10 min.
    Tout le reste : 404. Pas d'accès à l'API par ce port.
- **`turn.ts`** — Listen Next côté serveur : le portage de `albumsAfter`/`withCurrent` et du
  jeu « déjà joué » de `frontend/src/services/listenNextQueue.ts`, et du « retiré à la
  main pendant la lecture » (`leaveAfterTrack`). Le serveur doit pouvoir enchaîner seul.
- **`playable.ts`** (dans `backend/src/services/`) — le portage de `loadPlayable` /
  `playerTracksOf` / mixtapes de `frontend/src/utils/playAlbum.ts` : un album (ou un disque)
  de DexVault → `PlayerAlbum` + pistes jouables, à partir de `musicCollectionService` et
  des pistes Navidrome (`getNavidromeTracks`). Le client peut aussi envoyer la liste déjà
  faite (une partition, une sélection de pistes de `ScoreCard`).
- **`scrobble.ts`** — sortir de `playerController.scrobble` la logique commune
  (`navidromeService.scrobble` + `listenNextPlayService.noteScrobble`) pour que la session
  l'appelle : « en cours » (`submission=false`) au début d'une piste, « comptée »
  (`submission=true`) à la moitié ou à 4 min, une seule fois par piste, avec le compte
  `NAVIDROME_USER` comme le lecteur du navigateur. Les « départs » de Listen Next qui en
  sortent sont diffusés aux clients (§2.3).

### 2.2 Déroulement d'une lecture

1. `playAlbum(album, tracks, index)` : `Stop` si l'appareil joue autre chose de nous,
   `SetAVTransportURI(url, didl)`, `Play`, puis `SetNextAVTransportURI(piste suivante)` dès
   que `GetTransportInfo` dit `PLAYING`.
2. Le poller voit `TrackURI` changer pour l'URL « suivante » : la session avance d'un
   index, scrobble « en cours », pose la suivante par `SetNextAVTransportURI`. C'est
   l'enchaînement sans blanc des deux appareils.
3. Sans `SetNext` (autre appareil), ou si l'appareil s'arrête (`STOPPED` à moins de 3 s de
   la fin connue) : `SetAVTransportURI` + `Play` de la suivante. Un blanc d'une seconde.
4. Fin de l'album : dernière piste finie → `turn.ts` choisit l'album suivant de Listen Next
   (ou l'album reste chargé sur sa première piste, en pause, comme le lecteur du
   navigateur).
5. `next`/`previous`/`playTrack` : `SetAVTransportURI` sur la piste voulue (pas
   `Next`/`Previous` d'AVTransport : la file est chez nous). `previous` après 3 s revient au
   début (`Seek REL_TIME 0:00:00`).
6. `seek(s)` : `Seek(REL_TIME, h:mm:ss)`.
7. `toggle` : `Pause` / `Play`.
8. Volume : `SetVolume` borné par `maxVolume` de l'appareil (§2.4) ; `SetMute`.

**Reprise quand l'appareil est pris par autre chose** : si `TrackURI` n'est plus une de nos
URL (on a changé d'entrée sur l'Onkyo, AirPlay, Spotify Connect, l'app WiiM), ou si l'état
devient `NO_MEDIA_PRESENT`, la session passe en `taken` : plus de commande envoyée, plus de
scrobble, la position gardée. L'interface propose « Resume on Salon », qui relance la piste
au même endroit (`SetAVTransportURI` + `Seek` + `Play`). Jamais de reprise automatique.

**Appareil éteint ou hors réseau** : 3 échecs SOAP de suite (délai 4 s) → `unreachable`,
le poller espace ses essais (5 s, 15 s, 60 s), la position est gardée, l'interface le dit.
Revenu, il repasse en `taken` (il n'a plus notre piste) : même « Resume ».

**Redémarrage de DexVault** : les sessions sont écrites en base à chaque changement de piste
et toutes les 10 s (§2.5) ; au démarrage, une session relue regarde `GetPositionInfo` : si
l'appareil joue encore notre URL, elle reprend le suivi (le jeton est relu aussi) ;
sinon elle reste en pause là où elle était.

### 2.3 API et état en direct

Préfixe `/api/outputs` (le mot « output » est celui de l'interface) :

| Méthode | Chemin | Effet |
|---|---|---|
| GET | `/api/outputs` | Les appareils : `id` (UDN), `name`, `model`, `reachable`, `gapless`, `volume`, `muted`, `maxVolume`, et l'état de leur session |
| GET | `/api/outputs/events` | SSE : `state` (une session a changé), `left` (un départ de Listen Next), `alive` toutes les 20 s, comme `remoteService.listen` |
| POST | `/api/outputs/:id/play` | `{ albumId, disc?, index?, shuffle?, listenNext? }` ou `{ album, tracks, index }` |
| POST | `/api/outputs/:id/listen-next` | Lance Listen Next là |
| POST | `/api/outputs/:id/toggle` · `/next` · `/previous` · `/stop` · `/resume` | Transport |
| POST | `/api/outputs/:id/track` | `{ index }` |
| POST | `/api/outputs/:id/seek` | `{ position }` (s) |
| PUT | `/api/outputs/:id/volume` | `{ volume?, muted? }` |
| PUT | `/api/outputs/:id/settings` | `{ name?, maxVolume? }` (nom affiché, plafond) |

Réponses : 204 ou l'état ; 404 appareil inconnu ; 503 `unreachable` avec un message court ;
409 `taken` pour une commande autre que `play`/`resume`.

Chaque `state` porte : `album`, `track` (titre, disque, numéro, artiste et pochette d'un
mixtape), `index`, `count`, `tracks` (pour la fenêtre des pistes), `status`, `position`,
`duration`, `at` (heure serveur de la lecture de la position, le client avance l'aiguille
entre deux états), `volume`, `muted`, `queue` (`listenNext` ou null), `error`.
Les états partent au plus une fois par seconde par session, et à chaque changement
de piste ou de statut. Le client garde le même schéma de reconnexion que
`frontend/src/services/remote.ts` (`listen`, 45 s sans signe → on rouvre).

### 2.4 Configuration

Hiérarchie habituelle `deployment.*.json` → `data/options.json` → variables d'environnement :

| Clé (options.json) | Variable | Défaut | Rôle |
|---|---|---|---|
| `upnp_renderers` | `UPNP_RENDERERS` | vide | URL des descriptions, séparées par des virgules : `http://192.168.86.47:8888/upnp_descriptor_0,http://192.168.86.20:49152/description.xml` |
| `upnp_media_port` | `UPNP_MEDIA_PORT` | `3002` | Port de l'écoute médias dans le conteneur |
| `upnp_media_base_url` | `UPNP_MEDIA_BASE_URL` | vide → désactivé | Ce que l'appareil appelle : `http://dexvault.lab.crog.org:3002` (résolu par le DNS du LAN en 192.168.86.50) ; en dev `http://192.168.86.51:3002` |
| `upnp_discovery` | `UPNP_DISCOVERY` | `off` | `ssdp` en dev sur le Mac |
| `upnp_max_volume` | `UPNP_MAX_VOLUME` | `70` | Plafond par défaut, réglable par appareil (§6) |

Sans `UPNP_MEDIA_BASE_URL`, rien ne change : pas d'écoute, `/api/outputs` vide, l'interface
n'offre que « This computer ».

`docker-compose.yml` : ajouter `ports: ["3002:3002"]` et les variables ci-dessus. Ce port
contourne Traefik à dessein (Traefik redirige tout le HTTP vers HTTPS) : pas de labels pour
lui, il ne sert que des fichiers à jeton sur le LAN. Le routeur ne le publie pas sur
Internet. Réservations DHCP à poser sur le routeur pour l'Onkyo (.47), le WiiM (.20) et
p-cloud (.50, aujourd'hui `dynamic`).

### 2.5 Base de données

Migration `030_outputs` (dans `runAutoMigrations`) :
- `output_settings (id TEXT PRIMARY KEY, name TEXT, max_volume INTEGER)` — le nom choisi
  (« Salon ») et le plafond par appareil ;
- `output_sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER)` — la
  session en JSON (album, pistes, index, position, file, jeton), pour survivre à un
  redémarrage.

## 3. Interface

Tout avec les composants partagés (`Menu`, `Button`, `IconButton`, `Notice`, `toast`,
`Spinner`, `Dialog`), en anglais dans l'interface, d'après `docs/design-guidelines.md`.

### 3.1 Une seule barre, une « sortie »

Le magasin `usePlayer` reste l'unique source de la barre, des cartes (« playingHere »,
Resume) et de Listen Next. On lui ajoute une **sortie** :
`output: { kind: 'local' } | { kind: 'renderer'; id; name }`, gardée dans le navigateur
(`dv.player.output`).

- `local` : comme aujourd'hui, `<audio>` du navigateur (« This computer » sur le Mac,
  « This iPhone » sur le téléphone).
- `renderer` : `player.playAlbum/toggle/next/previous/seek/playTrack/stop` deviennent des
  appels à `/api/outputs/:id/…`, et l'état vient du SSE. Les `<audio>` se taisent. La
  barre ne change pas de forme : pochette, titre, ⏮ ⏯ ⏭, aiguille, temps restant, pistes,
  paroles, ♥ (toujours Navidrome).

Ainsi **la barre du lecteur et la barre de la télécommande ne font plus qu'une** : sur
l'iPhone, choisir « Salon » montre la barre ordinaire, qui commande l'Onkyo, exactement
comme sur le Mac. `RemoteBar` n'a plus de raison d'être.

Plusieurs appareils peuvent jouer à la fois (le Salon et le Bureau) ; la barre suit la
sortie choisie sur cet appareil. Si une autre sortie joue et que celle-ci ne joue rien,
la barre montre celle qui joue (comme `targetOf` aujourd'hui).

### 3.2 Le choix de la sortie

Dans la barre, à droite des outils (avant ✕), un `IconButton` (icône haut-parleur
`BsSpeaker`, `label="Output"`, `active` quand ce n'est pas l'appareil lui-même) ouvre un
`Menu drop="up" align="end"` :

```
OUTPUT
  ✓ This computer
    Salon            Onkyo TX-RZ70 · playing
    Bureau           WiiM Mini
    Salon            away              (grisé, désactivé)
────────────
  [volume]
```

- `Menu.Choice` par sortie, `selected` en or pour la sortie en cours, `hint` : modèle, ou
  « playing », « away » (non joignable), « in use » (`taken`).
- Changer de sortie pendant une lecture **transfère** la lecture : même album, même piste,
  même position (pause côté ancien, `play` + `seek` côté nouveau). C'est ce qu'on attend de
  « jouer ça sur le salon ».
- Hors lecture, le même menu se trouve au bas de la fenêtre d'un album (§3.3) ; sur
  l'iPhone sans barre, une petite barre « Nothing playing · Salon ▾ · Listen Next » comme
  celle de `RemoteBar` quand rien ne joue, seulement dans MusicDex.

### 3.3 Play ▾ d'un album

Dans `MusicDetailCard`, le bouton or garde son libellé (Play / Pause / Resume) et joue sur
la **sortie en cours** ; son ▾ (`ui-button--split`) remplace « Play on <ordinateur> » par :

- `Menu.Section` « Play on », puis un `Menu.Item` par autre sortie (« Salon », « Bureau »,
  « This computer ») : joue là et en fait la sortie en cours ;
- « Play from the start », « Open in Navidrome » comme aujourd'hui.

Sur l'iPhone, le bouton or « Listen » (Amperfy) devient « Play » dès qu'une sortie UPnP est
configurée, « Open in Amperfy » passe dans le ▾. Mêmes entrées dans le ▾ du ▶ de Listen Next.

### 3.4 Volume

Seulement pour une sortie UPnP (le volume du Mac reste celui du Mac). Dans le menu de
sortie, sous un `Menu.Separator` : une glissière 0 → `maxVolume` avec `−`/`+`
(`IconButton size="sm"`), la valeur en chiffres, et un `IconButton` muet. Les touches
± envoient un pas de 1 ; la glissière n'envoie qu'au relâchement (pas de rafale de SOAP).
Le plafond se règle dans « Output settings… » (`Dialog` : nom, plafond), entrée du menu.

### 3.5 Messages

- Sortie non joignable : `toast("Salon does not answer: is it on?", { tone: 'warning' })`
  à la commande ; la barre montre « Salon, away » en gris.
- Sortie prise ailleurs : dans la barre, à la place du temps, « Salon is playing something
  else » et le bouton ⏯ devient « Resume » (`Button size="sm"`).
- Format refusé (`714`, `716` UPnP) : `toast(…, { tone: 'danger' })` et la piste suivante.

## 4. Remplacer la télécommande

**Retiré** (phase 3, une fois la phase 4 validée sur l'Onkyo) :
- `backend/src/services/remoteService.ts`, `backend/src/controllers/remoteController.ts`,
  les routes `/api/remote/*` de `backend/index.ts`, `backend/tests/music/remote.test.ts` ;
- `frontend/src/services/remote.ts`, `components/RemoteBar.tsx` (+ `.css`, `.test.tsx`),
  `components/RemoteReporter.tsx`, leur montage dans `App.tsx`, `useRemotePlayers` et
  « Play on <ordinateur> » dans `MusicDetailCard.tsx`.

**Gardé** : le lecteur `<audio>` (« This computer »), `isComputer()` (déplacé dans
`utils/isComputer`, déjà là), le style de la barre (`PlayerBar.css`), le SSE et sa
reconnexion (repris dans `services/outputs.ts`).

**Base** : la table `remote_players` (migration 026) n'est plus lue ; elle est **laissée en
place** (une sauvegarde restaurée l'apporte encore). Une migration `031_drop_remote_players`
viendra plus tard, après quelques semaines sans retour en arrière.

**Repli si l'UPnP déçoit** : la télécommande reste dans le code jusqu'à la fin de la phase 4,
derrière `REMOTE_ENABLED` (vrai par défaut tant que l'UPnP n'est pas validé) ; les deux
coexistent sans se gêner (préfixes d'API différents). Si l'Onkyo se montre capricieux
(décrochages, pas d'enchaînement), on garde la télécommande et l'UPnP pour le seul WiiM, ou on
coupe l'UPnP en vidant `UPNP_RENDERERS`.

## 5. Les trois phases suivantes

### Phase 2 — backend

Fichiers :
- nouveaux : `backend/src/services/upnp/{soap,device,didl,renderers,session,poller,media,turn}.ts`,
  `backend/src/services/playable.ts`, `backend/src/services/scrobble.ts`,
  `backend/src/controllers/outputController.ts` ;
- modifiés : `backend/index.ts` (routes, démarrage de l'écoute médias et du registre),
  `backend/src/config.ts` (clés §2.4), `backend/src/database.ts` (migration 030),
  `backend/src/controllers/playerController.ts` (utilise `scrobble.ts`),
  `docker-compose.yml` (port 3002, variables, commentaire), `deployment.dev.json` ;
- tests : `backend/tests/music/upnp/` avec un **faux appareil** (`fakeRenderer.ts` : un
  serveur HTTP local qui sert les descriptions et SCPD enregistrés du sondage, répond aux
  SOAP avec les réponses enregistrées en annexe, tient un petit automate
  `NO_MEDIA_PRESENT → PLAYING → PAUSED_PLAYBACK → STOPPED`, avance la position sur une
  horloge factice, simule `SetNext`, l'absence de `SetNext`, une entrée changée, une panne),
  et des fichiers `fixtures/onkyo/*.xml`, `fixtures/wiim/*.xml`.

Critères d'acceptation :
1. `cd backend && npm test` passe, hors ligne, sans Navidrome ni appareil réel.
2. Les descriptions enregistrées de l'Onkyo et du WiiM donnent les bonnes URL de contrôle,
   versions de service et `gapless: true` ; celle du Panasonic aussi (sans `SetNext` si
   absent).
3. Une lecture d'un album de 3 pistes sur le faux appareil : `SetAVTransportURI` puis `Play`
   puis `SetNextAVTransportURI(2)` ; le passage de piste fait avancer l'index et poser
   `SetNext(3)` ; « en cours » scrobblé au début de chaque piste, « compté » à la moitié ou
   à 240 s, une seule fois.
4. Sans `SetNext`, la piste suivante part à l'arrêt de la précédente.
5. Fin d'album dans Listen Next : l'album suivant part selon les mêmes règles que
   `listenNextQueue` (mêmes cas de test que `frontend/src/services/listenNextQueue` portés
   tels quels) ; Repeat respecté ; départ diffusé en SSE `left`.
6. `TrackURI` étranger → `taken`, aucune commande ni scrobble ensuite ; `resume` relance au
   même endroit. Trois délais dépassés → `unreachable`.
7. L'écoute médias : Range transmis, en-têtes de Navidrome repris, jeton faux → 404, autre
   chemin → 404, aucune trace des identifiants Navidrome dans les URL ni le DIDL.
8. `SetVolume` jamais au-delà de `maxVolume`.
9. Sans `UPNP_MEDIA_BASE_URL`, aucun port ouvert et `/api/outputs` répond `[]`.

### Phase 3 — interface

Fichiers :
- nouveaux : `frontend/src/services/outputs.ts` (liste, SSE, commandes),
  `frontend/src/components/OutputMenu.tsx` (+ `.css`, placement seul),
  `frontend/src/components/OutputSettings.tsx` (`Dialog` nom + plafond) ;
- modifiés : `frontend/src/services/player.ts` (la sortie, l'aiguillage local/appareil,
  l'état reçu), `components/PlayerBar.tsx` (bouton de sortie, états away/in use),
  `components/PlayerTracks.tsx` (pistes depuis l'état serveur), `components/MusicDetailCard.tsx`
  (▾ « Play on »), `components/ListenNextPlay.tsx` et `services/listenNextQueue.ts`
  (Listen Next lancé sur l'appareil par `/listen-next`), `utils/playAlbum.ts`, `App.tsx` ;
- retirés après validation : voir §4.

Critères d'acceptation :
1. Sur le Mac comme sur l'iPhone, le menu de sortie liste « This computer »/« This iPhone »,
   « Salon », « Bureau », avec ✓ or sur la sortie en cours, et « away » pour un appareil
   éteint.
2. Choisir « Salon » pendant une lecture locale la poursuit sur l'Onkyo au même endroit et
   coupe le navigateur.
3. La barre montre l'appareil comme le lecteur local (titre, aiguille qui avance entre deux
   états, pistes, ♥), sur le Mac et l'iPhone en même temps ; une commande sur l'un se voit
   sur l'autre en moins de 2 s.
4. Le volume ne dépasse pas le plafond ; pas de rafale de requêtes en glissant.
5. Aucun composant hors des partagés (vérifié à la relecture : pas de `btn`, `Dropdown`,
   `Alert`, `Form.Control`).
6. `cd frontend && npx vitest --run` passe.

### Phase 4 — tests

- **Backend (jest)** : les cas de la phase 2, plus une session complète rejouée avec les
  réponses réelles enregistrées en phase 4 sur l'Onkyo et le WiiM (fichiers ajoutés aux
  fixtures).
- **Frontend (vitest)** : `outputs.test.ts` (reconnexion SSE, aiguille entre deux états),
  `OutputMenu.test.tsx` (choix, away, in use, volume borné), `PlayerBar.test.tsx` en sortie
  appareil, `MusicDetailCard` (▾ « Play on »), `player.test.ts` (transfert de sortie).
- **Recette manuelle sur l'Onkyo** (avec l'accord de la maison, volume bas d'abord) :
  1. Volume de départ ≤ 30 : noter la correspondance entre le volume UPnP et l'affichage du
     récepteur, choisir le plafond.
  2. Un album CD 44,1/16 : le récepteur affiche FLAC 44,1 kHz ; pas de blanc entre deux
     pistes d'un album enchaîné (un live, *Abbey Road* face B).
  3. Un FLAC 96/24 et un 192/24 : le récepteur affiche la bonne fréquence (bit-perfect).
  4. Pause, reprise, ⏮ dans les 3 s et après, ⏭, saut dans la piste, pistes de la fenêtre.
  5. Listen Next : fin d'album → album suivant ; Repeat ; départ de la liste au scrobble.
  6. Navidrome montre « en cours » puis compte la lecture pour le bon utilisateur.
  7. Passer l'Onkyo sur une autre entrée → « Salon is playing something else », Resume
     revient au même endroit ; l'éteindre → « away » ; le rallumer.
  8. Le récepteur en veille réseau : un Play l'allume-t-il et bascule-t-il sur NET ?
  9. Mac et iPhone en même temps ; iPhone verrouillé pendant un changement d'album.
  10. Redémarrer le conteneur DexVault pendant une lecture.
  11. URL HTTPS directe de Navidrome (test ponctuel) : l'Onkyo l'accepte-t-il ? (décide si
      l'écoute médias reste nécessaire.)
- **Recette sur le WiiM** : les points 2 à 7, 9 ; noter s'il enchaîne sans blanc et s'il
  garde l'AbsTime absent sans gêne.

## 6. Questions ouvertes pour l'utilisateur

1. **Port 3002 publié en clair sur le LAN** (fichiers à jeton seulement, hors Traefik) :
   d'accord ? Sinon : ajouter à Traefik une entrée `:8580` sans redirection, dans la pile
   Traefik.
2. **Réservations DHCP** sur le routeur pour .47 (Onkyo), .20 (WiiM), .50 (p-cloud) : à
   poser ?
3. **Plafond de volume** de l'Onkyo : 70/100 par défaut convient-il ? À quoi correspond 57
   sur l'affichage ?
4. Changer de sortie pendant une lecture : **transférer** (proposé) ou démarrer de zéro ?
5. Le WiiM du bureau : l'offrir comme sortie dès le départ, ou seulement l'Onkyo ?
6. Sur l'iPhone, « Play » vers la sortie choisie remplace-t-il le bouton « Listen » vers
   Amperfy (proposé), ou Amperfy reste-t-il le premier choix ?
7. La télécommande Mac (iPhone → navigateur du Mac) a-t-elle un usage qui survivrait à
   l'UPnP (écouter au casque sur le Mac depuis le canapé) ? Sinon, suppression après la
   phase 4.
8. Le TX-RZ70 en veille réseau : faut-il l'allumer et passer sur NET depuis DexVault (ce
   que fait éventuellement le Play UPnP seul, ou l'API eISCP d'Onkyo sur le port 60128) ?

## Annexe A — réponses brutes

### A.1 SSDP M-SEARCH (`ST: urn:schemas-upnp-org:device:MediaRenderer:1`, MX 3)

```
== 192.168.86.20:56885
LOCATION: http://192.168.86.20:49152/description.xml
BOOTID.UPNP.ORG: 1b20e220-1dd2-11b2-8947-fd34230ac1d8
SERVER: Linux
USN: uuid:FF970016-C1C1-E478-77CC-8CC5FF970016::urn:schemas-upnp-org:device:MediaRenderer:1

== 192.168.86.22:1900
LOCATION: http://192.168.86.22:60606/FFFFFFFFFFFF/Server0/ddd
SERVER: Linux/4.0 UPnP/1.0 Panasonic-UPnP-MW/1.0
USN: uuid:4D454930-0100-1000-8000-FFFFFFFFFFFF::urn:schemas-upnp-org:device:MediaRenderer:1

== 192.168.86.47:1900
Location: http://192.168.86.47:8888/upnp_descriptor_0
Server: Linux/4.9.123 UPnP/1.0 GUPnP/0.20.13
USN: uuid:4a11a401-6c01-a4BB-4a70-6c724a11a401::urn:schemas-upnp-org:device:MediaRenderer:1
```

M-SEARCH unicast vers `192.168.86.47:1900` et `192.168.86.20:1900` : aucune réponse en 3 s
(depuis le Mac et depuis le conteneur).

### A.2 Description de l'Onkyo (extrait)

```xml
<deviceType>urn:schemas-upnp-org:device:MediaRenderer:2</deviceType>
<friendlyName>Salon</friendlyName><manufacturer>ONKYO</manufacturer>
<modelName>TX-RZ70</modelName><modelNumber>Digital Media Client</modelNumber>
<UDN>uuid:4a11a401-6c01-a4BB-4a70-6c724a11a401</UDN>
<service>ConnectionManager:2  control /Control/oap/SinkConnectionManager  SCPD /xml/ConnectionManager.xml</service>
<service>AVTransport:2        control /Control/oap/AVTransport            SCPD /xml/AVTransport2.xml</service>
<service>RenderingControl:2   control /Control/oap/RenderingControl       SCPD /xml/RenderingControl2.xml</service>
<dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC><diracns:X_port>60229</diracns:X_port>
```

Actions AVTransport : SetAVTransportURI, **SetNextAVTransportURI**, GetMediaInfo,
GetMediaInfo_Ext, GetTransportInfo, GetCurrentTransportActions, GetPositionInfo,
GetDeviceCapabilities, GetTransportSettings, Stop, Play, Pause, Seek, Next, Previous,
X_DLNA_GetBytePositionInfo, SetPlayMode. RenderingControl : ListPresets, SelectPreset,
GetMute, SetMute, GetVolume, SetVolume (Volume ui2 0–100 pas 1). SeekMode : ABS_TIME,
REL_TIME, TRACK_NR, ABS_COUNT, REL_COUNT, X_DLNA_REL_BYTE. PlayMode : NORMAL, REPEAT_TRACK,
REPEAT_ONE, REPEAT_ALL. TransportPlaySpeed : 1.

### A.3 Description du WiiM (extrait)

```xml
<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
<friendlyName>Bureau</friendlyName><manufacturer>Linkplay Technology Inc.</manufacturer>
<modelName>WiiM Mini Receiver</modelName><modelNumber>V01-Jun  8 2026</modelNumber>
<UDN>uuid:FF970016-C1C1-E478-77CC-8CC5FF970016</UDN><ssidName>WiiM Mini-DA62</ssidName>
AVTransport:1        /upnp/control/rendertransport1
ConnectionManager:1  /upnp/control/renderconnmgr1
RenderingControl:1   /upnp/control/rendercontrol1
PlayQueue:1 (wiimu)  /upnp/control/PlayQueue1
QPlay:1 (tencent)    /upnp/control/QPlay1
```

Actions AVTransport : GetCurrentTransportActions, GetDeviceCapabilities, GetMediaInfo,
GetPositionInfo, GetTransportInfo, GetTransportSettings, Next, Pause, Play, Previous, Seek,
SetAVTransportURI, Stop, **SetNextAVTransportURI**, GetPlayType, GetInfoEx, SetPlayMode,
SeekForward, SeekBackward. RenderingControl : GetMute, GetVolume, SetMute, SetVolume
(0–100 pas 1), GetChannel, SetChannel, GetEqualizer, SetEqualizer, MultiRoomJoinGroup… 
SeekMode : REL_TIME, TRACK_NR. PlayMode : NORMAL, REPEAT_ONE, REPEAT_ALL, SHUFFLE.

### A.4 Panasonic DP-UB820 (non retenu)

`MediaRenderer:1`, Panasonic Blu-ray Disc Player, RenderingControl/ConnectionManager/
AVTransport sous `http://192.168.86.22:60606/Server0/…`.

### A.5 GetProtocolInfo — Sink

Onkyo :
```
http-get:*:text/xml:DLNA.ORG_PN=DIDL_S
http-get:*:audio/vnd.dlna.adts:DLNA.ORG_PN=AAC_ADTS_320 | HEAACv2_L2_320
http-get:*:audio/x-ms-wma:DLNA.ORG_PN=WMAFULL | WMABASE
http-get:*:audio/3gpp, audio/mp4 : AAC_ISO_320 | HEAACv2_L2_320
http-get:*:audio/L16 (et l16);channels=1|2;rate=44100|48000:DLNA.ORG_PN=LPCM (et :*)
http-get:*:audio/mpeg:DLNA.ORG_PN=MP3
http-get:*:audio/x-flac:*      http-get:*:audio/flac:*
http-get:*:audio/x-wav:*  audio/wav:*  audio/wave:*  audio/aiff:*  audio/x-aiff:*
http-get:*:audio/x-dsd:*  audio/x-dsf:*  audio/x-dff:*
http-get:*:audio/m4a:*  audio/x-m4a:*  audio/mp4:*  audio/aac:*  audio/mpeg:*
http-get:*:audio/3gpp:*  audio/x-ms-wma:*  audio/vnd.dlna.adts:*  text/xml:*
```

WiiM :
```
http-get:*:audio/wav:DLNA.ORG_PN=LPCM          http-get:*:audio/x-wav:DLNA.ORG_PN=LPCM
http-get:*:audio/mpeg:DLNA.ORG_PN=MP3 | MP3X | MP2_MPS
http-get:*:audio/x-ms-wma:DLNA.ORG_PN=WMABASE | WMAFULL | WMAPRO
http-get:*:audio/mp3:*  audio/wma:*  audio/mpeg:*
http-get:*:audio/vnd.dlna.adts:DLNA.ORG_PN=AAC_ADTS | AAC_ADTS_320
http-get:*:audio/m4a:DLNA.ORG_PN=AAC_ISO      http-get:*:audio/aac:DLNA.ORG_PN=AAC_ISO
http-get:*:audio/ac3:DLNA.ORG_PN=AC3
http-get:*:audio/ogg:*  audio/ape:*  audio/x-ape:*  audio/flac:*
```

### A.6 État au repos (lecture seule)

| Appel | Onkyo | WiiM |
|---|---|---|
| GetTransportInfo | `NO_MEDIA_PRESENT`, `OK`, vitesse 1 | `NO_MEDIA_PRESENT`, `OK`, vitesse 1 |
| GetMediaInfo | NrTracks 0, MediaDuration `0:04:06`, URI vides, PlayMedium `NONE` | NrTracks 0, `00:00:00`, URI vides, `TrackSource` vide |
| GetPositionInfo | Track 0, TrackDuration `0:04:06`, RelTime/AbsTime `0:00:00`, Counts 0 | Track 0, `00:00:00`, RelTime `00:00:00`, AbsTime `NOT_IMPLEMENTED`, Counts 2147483647 |
| GetCurrentTransportActions | (vide) | `Play,Stop,Seek,X_DLNA_SeekTime,Pause` |
| GetDeviceCapabilities | PlayMedia `NONE,NETWORK` | `NONE,STATION-NETWORK,SONGLIST-NETWORK,SONGLIST-LOCAL,SONGLIST-LOCAL_TF,THIRD-DLNA,AIRPLAY,UNKNOWN` |
| GetTransportSettings | `NORMAL` | `NORMAL` |
| GetVolume (Master) | 57 | 100 |
| GetMute | 0 | 0 |

L'Onkyo garde la durée de la dernière piste jouée (`0:04:06`) avec des URI vides :
la session ne doit pas prendre une durée non nulle pour un signe qu'il joue.

### A.7 Réseau

```
dscacheutil music.lab.crog.org → 192.168.86.50   (DNS 192.168.86.1)
dig dexvault.lab.crog.org      → 192.168.86.50
curl http://music.lab.crog.org/          → 301 https://music.lab.crog.org/
curl http://dexvault.lab.crog.org/health → 301 https://dexvault.lab.crog.org/health
https://music.lab.crog.org : CN=lab.crog.org, SAN *.lab.crog.org, Let's Encrypt YR2, expire 20.12.2026
p-cloud enp98s0 192.168.86.50/24 (dynamic) ; ports en écoute : 22 53 80 443 631 1883 3000 8002 8042 8052 8060 8080 8123 8200 8484 8554 9443 11434 18554 18555 55123
Traefik : --entrypoints.web.http.redirections.entrypoint.to=websecure (global)
Conteneurs : dexvault-dexvault-1 (3001/tcp, réseau web), navidrome-navidrome-1 (4533/tcp, réseau web)
Depuis dexvault-dexvault-1 : http://navidrome:4533/ping → 200 ; descriptions Onkyo et WiiM lues
```

## Notes d'implémentation (phase 2, 25.10.2026)

Ce qui s'écarte du plan ou le précise, à lire avant la phase 3.

**Fichiers en plus de la liste du §5** : `backend/src/services/upnp/options.ts` (lecture des clés
§2.4, fonction pure testée), `backend/src/services/upnp/outputs.ts` (le service central : registre,
une session par appareil, SSE, réglages, écriture en base). `config.ts` expose
`getUpnpOptions()`, que le mock de `tests/setup.js` imite.

**Base (migration `030_outputs`)** : `output_settings` porte en plus `location`, `device_name` et
`model`, pour lister un appareil déjà vu (« away ») quand il ne répond pas au démarrage.

**Décisions du coordinateur appliquées** : écoute médias sur 3002 en HTTP clair, à jeton, qui ne
sert que `/upnp/stream` et `/upnp/cover` ; plafond par défaut 70 ; l'Onkyo et le WiiM tous deux
proposés ; la télécommande reste, derrière `REMOTE_ENABLED` (vrai par défaut) ; pas d'eISCP.

**`docker-compose.yml`** : `UPNP_MEDIA_BASE_URL` a un défaut **vide** (UPnP éteint) ; il faut le poser
dans les variables de la pile Portainer (`http://dexvault.lab.crog.org:3002`) au moment d'essayer
sur l'Onkyo. `UPNP_RENDERERS` a pour défaut les deux descriptions (.47 et .20). Le port 3002 est publié.

**Cover** : `/upnp/cover/:token/:albumId.jpg` (l'id de l'album, pas un nom de fichier : rien à
remonter dans les chemins) ; la pochette de DexVault réduite à 600 px en JPEG.

**Jeton** : un par session, gardé tant que DexVault tourne et écrit avec la session (repris au
redémarrage) ; `retire()` laisse 10 min de grâce.

**API telle qu'implémentée** (en plus du §2.3) :
- `POST /api/outputs/:id/play` accepte aussi `{ from: <id> }` : la lecture d'un autre appareil
  reprise au même endroit, Listen Next compris, l'autre mis en pause (le transfert décidé) ; et
  `position` (s) avec `{ albumId }` ou `{ album, tracks }` ; `listenNext: true` avec `{ album, tracks }`
  reprend le tour après cet album, avec `{ albumId }` saute dans le tour en cours (ou le lance là).
- `POST /api/outputs/:id/listen-next` : `{ key? }` (« 12:0 ») ou `{ albumId?, disc?, index? }`.
- `POST /api/outputs/:id/toggle` : `{ playing? }` force lecture ou pause.
- Réponses des commandes : l'état de la session (200), pas 204 ; 409 et 503 portent
  `{ error, status: 'taken' | 'unreachable' }`.
- `stop` est permis sur un appareil `taken` (sans SOAP : on lâche seulement) ; le volume suit la
  règle 409 du §2.3.
- SSE : en plus de `state`, `left` et `alive`, un évènement `outputs` (la liste entière, envoyé à
  l'ouverture et à chaque changement de joignabilité ou de réglages). `left` porte
  `{ output, ...départ }`. `state` porte aussi `id`, `name` et `upcoming` (les entrées de Listen
  Next encore à venir, pour le temps restant).

**Comportements** :
- Le passage de piste est vu par `TrackURI` qui devient l'URL « suivante ». Un arrêt (`STOPPED` ou
  `NO_MEDIA_PRESENT`) à moins de 3 s de la fin connue est une fin de piste ; ailleurs, un arrêt par la
  télécommande de l'appareil devient une pause.
- `714`/`716` sur `SetAVTransportURI` : la piste est sautée, `error` dit laquelle.
- Retiré à la main de Listen Next pendant la lecture : la liste est relue au moment de poser la
  suivante et au passage de piste (aucune page ne prévient le serveur).
- Après un redémarrage, une session en pause dont l'appareil ne joue rien de nous n'est interrogée
  qu'une fois ; ensuite plus rien jusqu'à une commande.
- Le plafond borne seulement ce que DexVault envoie ; un appareil déjà au-dessus (le WiiM à 100)
  n'est pas baissé d'office. À trancher en phase 4.
- Le type MIME d'une piste de mixtape est inconnu (Navidrome ne le donne pas dans la playlist) :
  FLAC par défaut ; un mixtape avec des MP3 achetés est à vérifier en phase 4.

**Fixtures** : descriptions et SCPD réenregistrés par GET (lecture seule) le 25.10.2026 ; les
réponses SOAP au repos sont celles de l'annexe A, dans une enveloppe réécrite. Aucun SOAP envoyé
aux appareils réels.

## Notes d'implémentation (phase 3, 25.10.2026)

**Le magasin du lecteur** (`services/player.ts`) garde son état local (les `<audio>`) tel quel et
expose une **vue** : l'état local quand la sortie est ce navigateur, sinon l'état de la session de
l'appareil, mis à la même forme (`album`, `tracks`, `index`, `playing`, `position` avancée chaque
seconde depuis `at`, `barShown`, `resume` pour une session `stopped`). `usePlayer` et `getState()`
lisent la vue : les cartes, Listen Next, la barre et la fenêtre des pistes n'ont presque pas changé.
Trois champs en plus : `output`, `outputStatus` (`taken` | `unreachable`), `upcoming` (celui du serveur).

**Aiguillage** : `playAlbum`, `toggle`, `next`, `previous`, `playTrack`, `seek`, `stop`, `resume`
deviennent des commandes `/api/outputs/:id/…` quand la vue est un appareil ; `playAlbumById` envoie
`{ albumId, disc, index, shuffle }` (le serveur charge l'album) ; `listenNextQueue.start` et `jumpTo`
passent par `/listen-next { key, index }`. ⏯ sur un appareil `taken` ou `stopped` envoie `/resume`.

**Choix de la sortie** (`dv.player.output`, dans le navigateur) : `player.setOutput(sortie,
{ transfer })`. Avec transfert (le menu de la barre), une lecture en cours suit : local → appareil
par `{ album, tracks, index, position, listenNext }` ; appareil → appareil par `{ from }` ;
appareil → ici, le navigateur joue d'abord (le clic l'y autorise), puis l'appareil est mis en pause,
et Listen Next reprend son tour côté page (`registerQueue`). Sans transfert (« Play on » d'un ▾), la
sortie quittée se tait seulement. Un appareil qui n'est plus dans la liste ramène à ce navigateur.

**Suivre** : quand ce navigateur est la sortie et ne joue pas, la barre montre l'appareil qui joue
(comme `targetOf`), jusqu'à ce qu'il s'arrête ou que ce navigateur joue. Depuis le 25.10.2026 (demande de
l'utilisateur : « le Play d'un album doit aller sur la destination sélectionnée »), elle suit aussi un
appareil **en pause** quand le lecteur de ce navigateur est vide (le dernier interrogé) : le Play d'une
fiche y va, ▶ le reprend. Un appareil quitté par un choix n'est pas suivi de nouveau tant que son état
ne change pas (il rejoue, un autre album).

**SSE** (`services/outputs.ts`) : même reconnexion que `remote.ts` (refus → 1 s, 2 s… 30 s ; 45 s de
silence → on rouvre), plus une réouverture immédiate au retour de la page au premier plan (l'iPhone
coupe la connexion en veille). L'aiguille avance depuis `at` corrigé de l'écart d'horloge, estimé par
le plus petit écart vu entre `at` et l'arrivée d'un état (20 derniers). Un état identique garde
l'identité de `album` et `tracks`, pour que les effets de la barre (♥) ne repartent pas chaque seconde.
`left` est relayé comme `LISTEN_NEXT_LEFT_EVENT`. Sans appareil (`[]`), pas de connexion du tout.

**Interface** : `OutputMenu` (bouton haut-parleur de la barre, `Menu` up/end : « This computer » ou
« This iPhone », les appareils avec ✓ or, `away` grisé, `in use`, le modèle et « playing » ; volume
borné à `maxVolume`, envoyé au plus toutes les 400 ms pendant le glissé puis au relâchement ;
« Output settings… »), `OutputSettings` (`Dialog` : nom, plafond 0–100). Une glissière partagée,
`shared/range.css` (`ui-range`), importée dans `App.tsx` après `check.css`. Barre « Nothing playing ·
Salon ▾ · Listen Next » sur un téléphone dont la sortie est un appareil qui ne joue rien, dans MusicDex
seulement.

**La barre sur iPhone** (demande de l'utilisateur, 25.10.2026 : tout ne tenait pas) : sous 768 px elle
ne garde que la pochette, le titre et sa ligne, ⏯, ⏭ et un **⋯** (`Menu` : ♥, Tracks, les sorties et
le volume, Output settings…, Stop). Le ♥, les pistes, le haut-parleur et ✕ y sont cachés ; le nom de
l'appareil passe sous le titre (« 🔈 Salon · album »). Le titre garde ~170 px au lieu de ~70.

**Fiche d'un album** : le bouton or joue sur la sortie en cours (« Play · Salon ») ; son ▾ a une
section « Play on » (les autres sorties joignables), puis « Play from the start », « Open in Navidrome »
(« Open in Amperfy » sur l'iPhone). Sur l'iPhone sans appareil choisi, « Listen » (Amperfy) reste le
bouton or et le ▾ offre les appareils. Listen Next : un ▾ à côté du ▶ (« Play on », et « Open in
Amperfy » sur un iPhone qui joue sur un appareil). Les entrées « Play on <ordinateur> » de la
télécommande restent (§4 : retrait après la recette).

**Télécommande** : `RemoteBar` se retire dès qu'un appareil répond (la barre du lecteur le commande) ;
`RemoteReporter` dit « rien » quand le Mac joue sur un appareil.

**Pas fait / à voir en phase 4** : la fenêtre des pistes d'un Listen Next joué sur un appareil ne
montre pas les albums « Played » de la session (le serveur ne les expose pas) ; le volume affiché est
borné au plafond même si l'appareil est au-dessus (le WiiM à 100) ; pas de `mediaSession` (écran
verrouillé) pour un appareil.

**Recette visuelle** (faux appareils de `backend/tests/music/upnp/fakeRenderer.ts` sur 127.0.0.1,
découverte coupée, backend sans Navidrome, copie de la base) : barre qui suit Salon, menu, volume
borné, transfert Salon → Bureau → ce navigateur au même endroit, réglages (nom, plafond 50), états
`away` ; à 881 px et à 390 px (iPhone 14 émulé) dans le navigateur d'Orca.
