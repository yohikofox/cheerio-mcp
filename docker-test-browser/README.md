# Docker Browser Test avec noVNC

Ce dossier contient un environnement Docker pour tester Playwright en mode `headless=false` avec une interface graphique visible via noVNC.

## Architecture

- **Xvfb** : Serveur X virtuel (écran :99)
- **Fluxbox** : Window manager léger
- **x11vnc** : Partage l'écran Xvfb via VNC (port 5900)
- **noVNC** : Interface web VNC (port 6080)
- **Playwright** : Lance Chrome en mode visible sur l'écran virtuel

## Utilisation

### 1. Démarrer le container

```bash
cd docker-test-browser
docker-compose up --build
```

### 2. Accéder à l'interface graphique

Ouvre dans ton navigateur (Chrome, Safari, Firefox) :

```
http://localhost:6080
```

Tu verras l'écran virtuel du container avec Chrome qui s'exécute !

### 3. Observer le test

Le script `test-browser.ts` va :
1. Ouvrir Chrome en mode visible
2. Naviguer vers la page de détection headless
3. Naviguer vers Cdiscount
4. Rester ouvert pour inspection

### 4. Arrêter

```bash
docker-compose down
```

## Modifier le test

Édite le fichier `test-browser.ts` pour tester d'autres URLs ou comportements.

Le fichier est monté en volume, donc les changements sont pris en compte immédiatement.

## Ports exposés

- **6080** : noVNC (interface web) - **Utilise celui-ci !**
- **5900** : VNC natif (si tu veux utiliser un client VNC)

## Debugging

Si tu ne vois rien dans noVNC :
1. Vérifie que le container tourne : `docker-compose ps`
2. Vérifie les logs : `docker-compose logs -f`
3. Vérifie que l'URL est bien `http://localhost:6080`

## Avantages

- Voir le navigateur en temps réel
- Observer les captchas, animations, redirections
- Débugger les sites qui bloquent les bots (Fnac, etc.)
- Pas besoin d'installer VNC sur ton Mac
