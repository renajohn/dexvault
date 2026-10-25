# Recette UPnP sur l'Onkyo et le WiiM — liste à cocher

Date : 25.10.2026 · Branche : `renajohn/DNLA` · Conception : `2026-10-25-upnp-design.md` (§5, phase 4)

Tests automatiques passés avant la recette : backend (jest) avec deux faux appareils rejouant
l'Onkyo et le WiiM tels qu'enregistrés, et un bout en bout HTTP → SOAP ; frontend (vitest).
**Aucun SOAP n'a encore été envoyé aux vrais appareils** : c'est l'objet de cette recette.
Accord de la maison avant de commencer, volume bas d'abord.

## 0. Mise en place (p-cloud)

- [ ] Réservations DHCP sur le routeur : Onkyo `192.168.86.47`, WiiM `192.168.86.20`,
      p-cloud `192.168.86.50`.
- [ ] Variables de la pile **dexvault** dans Portainer :

  | Variable | Valeur | Remarque |
  |---|---|---|
  | `UPNP_MEDIA_BASE_URL` | `http://dexvault.lab.crog.org:3002` | **Seule variable obligatoire.** Vide = UPnP éteint, rien ne change |
  | `UPNP_RENDERERS` | *(laisser vide)* | Défaut du compose : `http://192.168.86.47:8888/upnp_descriptor_0,http://192.168.86.20:49152/description.xml` |
  | `UPNP_MAX_VOLUME` | `70` (défaut) ou moins | Plafond par défaut ; chaque appareil a ensuite le sien (Output settings…) |
  | `REMOTE_ENABLED` | `true` (défaut) | La télécommande reste, en repli, jusqu'à la fin de la recette |

- [ ] Port **3002** publié (`ports: "3002:3002"`, déjà dans `docker-compose.yml`), en HTTP clair,
      **sans** Traefik ; ne pas l'ouvrir sur Internet au routeur.
- [ ] Redéployer la pile, puis vérifier :
  - `docker logs dexvault-dexvault-1 2>&1 | grep UPnP` → `media listener on port 3002`,
    `Salon (TX-RZ70) at …`, `Bureau (WiiM Mini Receiver) at …` ;
  - depuis le Mac : `curl -i http://dexvault.lab.crog.org:3002/upnp/x` → **404** (rien d'autre
    n'est servi) ; `curl -i http://dexvault.lab.crog.org:3002/api/outputs` → **404** ;
  - `https://dexvault.lab.crog.org/api/outputs` → les deux appareils, `reachable: true`.
- [ ] Dans la barre, le bouton haut-parleur liste « This computer », « Salon », « Bureau ».

Retour arrière à tout moment : vider `UPNP_MEDIA_BASE_URL` et redéployer.

## 1. Onkyo TX-RZ70 (Salon)

1. [ ] **Volume** : avant tout Play, régler le volume du récepteur ≤ 30. Dans DexVault, choisir
       Salon, bouger la glissière : noter la correspondance volume UPnP ↔ affichage du récepteur
       (le récepteur affichait 57 au sondage). Fixer le plafond dans « Output settings… ».
       Vérifier que la glissière et `+` ne dépassent pas le plafond.
2. [ ] **CD 44,1/16** : le récepteur affiche FLAC 44,1 kHz. **Pas de blanc** entre deux pistes
       enchaînées (*Abbey Road* face B, un live).
3. [ ] **Hi-res** : un FLAC 96/24 puis un 192/24 → le récepteur affiche la bonne fréquence
       (bit-perfect, aucun transcodage).
4. [ ] **Transport** : ⏯ pause et reprise ; ⏮ dans les 3 premières secondes (piste d'avant) et
       après (début de la piste) ; ⏭ ; saut dans la piste (glisser l'aiguille) ; une piste
       choisie dans la fenêtre des pistes. L'aiguille avance sans à-coups entre deux états.
5. [ ] **Listen Next** : fin d'album → l'album suivant part seul ; Repeat respecté ; l'album
       quitte la liste au scrobble (visible sur une autre page ouverte).
6. [ ] **Navidrome** : « en cours » au début de chaque piste, puis la lecture comptée **une
       seule fois**, pour le bon utilisateur (`NAVIDROME_USER`).
7. [ ] **Pris ailleurs** : passer l'Onkyo sur une autre entrée → la barre dit « Salon is playing
       something else », ⏯ devient Resume, qui reprend **au même endroit**. Éteindre l'Onkyo →
       « away » (gris) ; le rallumer → il revient (Resume).
8. [ ] **Veille réseau** : récepteur en veille, Play depuis DexVault : s'allume-t-il et
       passe-t-il sur NET ? (Noter ; pas d'eISCP prévu.)
9. [ ] **Deux pages** : Mac et iPhone ouverts ensemble, une commande sur l'un se voit sur
       l'autre en moins de 2 s ; iPhone verrouillé pendant un changement d'album de Listen Next.
10. [ ] **Redémarrage** : redémarrer le conteneur DexVault pendant une lecture → la barre
        reprend le suivi (même piste, même position), sans coupure côté récepteur.
11. [ ] **HTTPS direct** (test ponctuel, facultatif) : l'Onkyo accepte-t-il une URL
        `https://music.lab.crog.org/…` ? Décide si l'écoute 3002 reste nécessaire.
12. [ ] **Transfert** : pendant une lecture sur le Mac, choisir Salon → la lecture continue sur
        l'Onkyo au même endroit, le navigateur se tait ; puis Salon → This computer.

## 2. WiiM Mini (Bureau)

Points 2 à 7 et 9 ci-dessus, plus :

- [ ] **Volume** : le WiiM est à 100 au repos. Le plafond borne ce que DexVault **envoie**, il ne
      baisse pas l'appareil d'office : régler le volume avant le premier Play.
- [ ] **Enchaînement** : sans blanc entre deux pistes (il annonce `SetNextAVTransportURI`).
- [ ] **Position** : l'aiguille et le saut fonctionnent sans `AbsTime` (le WiiM répond
      `NOT_IMPLEMENTED`) ; DexVault n'utilise que `REL_TIME`.
- [ ] **Format du saut** : DexVault envoie `0:01:35`, le WiiM écrit ses heures sur deux chiffres
      (`00:01:35`). Vérifier que le saut tombe juste.
- [ ] **Port** : redémarrer le WiiM ; s'il change de port (49152–49160), DexVault le retrouve.
- [ ] **Transfert** Salon → Bureau pendant une lecture : Bureau reprend au même endroit, Salon
      en pause.

## 3. À noter pendant la recette

- [ ] Un mixtape avec des MP3 achetés : le type est annoncé FLAC par défaut ; l'appareil le
      lit-il quand même ?
- [ ] Un format refusé (erreur 714/716) : un toast le dit et la piste suivante part.
- [ ] Décisions à prendre ensuite : plafond définitif par appareil ; retrait de la télécommande
      (`REMOTE_ENABLED=false`, puis code du §4) si la recette est concluante.
