# Web Search MCP Server

Un serveur MCP (Model Context Protocol) pour effectuer des recherches web et extraire le contenu de pages.

## Fonctionnalités

### 🔍 Recherche Web Multi-Moteurs
- **Google** : Recherche sur Google avec extraction des résultats organiques
- **DuckDuckGo** : Recherche privée sans tracking
- **Bing** : Recherche Microsoft Bing

Tous les résultats excluent automatiquement les publicités (SEA) pour ne retourner que les résultats organiques.

### 📄 Extraction de Contenu (Web Scraping)
- Extraction du titre, description, et contenu textuel
- Récupération des titres hiérarchiques (H1, H2, H3)
- Extraction des liens et images
- Métadonnées (auteur, date de publication, mots-clés)
- Nettoyage automatique du contenu (suppression des scripts, styles, publicités)

### 🚀 Opérations Combinées
- Recherche + scraping automatique des 10 premiers résultats en une seule opération

## Installation

```bash
npm install
npm run build
```

## Configuration dans Claude Desktop

Ajoutez cette configuration dans votre fichier de configuration Claude Desktop :

**macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/ws/cheerio-mcp/dist/index.js"
      ]
    }
  }
}
```

Remplacez `/Users/YOUR_USERNAME/ws/cheerio-mcp` par le chemin absolu vers votre projet.

## Outils Disponibles

### 1. `search_web`
Effectue une recherche sur plusieurs moteurs en parallèle.

**Paramètres :**
- `query` (string, requis) : La requête de recherche
- `engines` (array, optionnel) : Moteurs à utiliser (`['google', 'duckduckgo', 'bing']`). Défaut : tous
- `maxResults` (number, optionnel) : Nombre max de résultats par moteur (1-10). Défaut : 10

**Exemple :**
```json
{
  "query": "typescript best practices",
  "engines": ["google", "duckduckgo"],
  "maxResults": 5
}
```

### 2. `scrape_page`
Extrait le contenu d'une page web.

**Paramètres :**
- `url` (string, requis) : L'URL de la page à scraper

**Exemple :**
```json
{
  "url": "https://example.local/article"
}
```

### 3. `scrape_multiple_pages`
Extrait le contenu de plusieurs pages en parallèle.

**Paramètres :**
- `urls` (array, requis) : Liste des URLs à scraper

**Exemple :**
```json
{
  "urls": [
    "https://example.local/article1",
    "https://example.local/article2"
  ]
}
```

### 4. `search_and_scrape`
Combine recherche et scraping : effectue une recherche puis extrait automatiquement le contenu des résultats.

**Paramètres :**
- `query` (string, requis) : La requête de recherche
- `engine` (string, optionnel) : Moteur à utiliser (`google|duckduckgo|bing`). Défaut : google
- `maxResults` (number, optionnel) : Nombre de résultats à scraper (1-10). Défaut : 5

**Exemple :**
```json
{
  "query": "react hooks tutorial",
  "engine": "google",
  "maxResults": 5
}
```

## Structure du Projet

```
cheerio-mcp/
├── src/
│   ├── index.ts           # Serveur MCP principal
│   ├── searchEngines.ts   # Moteurs de recherche (Google, DDG, Bing)
│   └── scraper.ts         # Extraction de contenu avec Cheerio
├── dist/                  # Fichiers compilés
├── package.json
├── tsconfig.json
└── README.md
```

## Développement

```bash
# Mode watch (recompilation automatique)
npm run watch

# Build manuel
npm run build
```

## Format des Résultats

### Résultat de Recherche
```json
{
  "engine": "Google",
  "query": "typescript",
  "results": [
    {
      "title": "TypeScript: JavaScript With Syntax For Types",
      "url": "https://www.typescriptlang.org/",
      "snippet": "TypeScript extends JavaScript by adding types...",
      "position": 1
    }
  ]
}
```

### Contenu de Page Scrapée
```json
{
  "url": "https://example.local/article",
  "title": "Article Title",
  "description": "Meta description...",
  "text": "Main text content...",
  "headings": {
    "h1": ["Main Title"],
    "h2": ["Section 1", "Section 2"],
    "h3": ["Subsection 1.1"]
  },
  "links": [
    {"text": "Link text", "url": "https://example.local/link"}
  ],
  "images": [
    {"src": "https://example.local/image.jpg", "alt": "Image description"}
  ],
  "metadata": {
    "author": "John Doe",
    "publishedDate": "2024-01-15",
    "keywords": ["typescript", "javascript"]
  }
}
```

## Limitations

- Les moteurs de recherche peuvent bloquer les requêtes trop fréquentes (rate limiting)
- Certains sites utilisent du JavaScript pour générer le contenu (Cheerio ne l'exécute pas)
- Les sélecteurs CSS peuvent changer si les sites modifient leur structure HTML

## Notes de Sécurité

- User-Agent configuré pour ressembler à un navigateur standard
- Pas de stockage de données personnelles
- Respect du robots.txt recommandé (à implémenter selon vos besoins)

## Licence

MIT



# TODO

* Ajouter un un outil pour afficher une image a partir d'un base64.



si rebrowser fonctionne, voir pour installer le chromium dans le dockerfile:

```sh
npx rebrowser-playwright install chromium
```                                                                                                                               


# A new Hope

> j'ai une question un peu idiote. Il n'est pas possible d'utiliser playwright en mode headless = false dans un container docker ? 

⏺ Pas idiote du tout ! Oui, c'est totalement possible avec quelques tricks. 🐳

  Le problème : Docker n'a pas d'écran par défaut, donc headless=false ne peut pas afficher de fenêtre.

  Solutions :

  1. Xvfb (X Virtual Frame Buffer) - Le plus simple
  FROM node:20

  # Installer Xvfb pour simuler un display
  RUN apt-get update && apt-get install -y xvfb

  # Lancer l'app avec Xvfb
  CMD xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm start

  2. VNC (pour voir le navigateur à distance) - Pour le debugging
  FROM node:20

  # Installer VNC + bureau virtuel
  RUN apt-get update && apt-get install -y \
      xvfb x11vnc fluxbox \
      chromium chromium-driver

  # Exposer le port VNC
  EXPOSE 5900

  CMD x11vnc -create -env FD_PROG=/usr/bin/fluxbox \
      -forever -usepw -shared

  Puis tu peux te connecter avec un client VNC (ex: RealVNC) à localhost:5900 et voir le navigateur en live !

  3. Image Docker toute prête
  services:
    scraper:
      image: browserless/chrome
      ports:
        - "3000:3000"

  Pourquoi faire ça ?
  - Même en headless=false, certains sites détectent moins le bot
  - Permet de débugger visuellement dans un environnement isolé
  - Utile pour des screenshots/vidéos de scraping

  Tu veux un exemple complet de Dockerfile avec Xvfb ?

> je n'ai pas compris comment on peut debug 

⏺ Excellent point ! Voici comment voir et débugger visuellement le navigateur qui tourne dans Docker :

  Flow de debugging avec VNC

  1. Docker lance le navigateur avec un écran virtuel (Xvfb)
  Docker Container
  ├── Xvfb (écran virtuel :99)
  │   └── Chrome en mode headless=false s'affiche sur cet écran
  ├── VNC Server (partage l'écran :99 sur le port 5900)
  └── Ton app Node.js qui lance Playwright

  2. Depuis ton Mac, tu te connectes au VNC
  # Depuis ton terminal Mac
  open vnc://localhost:5900

  3. Tu vois le navigateur Chrome en live ! 🎥
  - Tu vois la souris bouger
  - Les clics sur les boutons
  - Le scroll
  - Les captchas qui apparaissent
  - Tout comme si c'était sur ton écran

  Exemple concret

  Dockerfile :
  FROM node:20

  # Installer environnement graphique + VNC
  RUN apt-get update && apt-get install -y \
      xvfb \
      x11vnc \
      fluxbox \
      chromium \
      chromium-driver

  WORKDIR /app
  COPY package*.json ./
  RUN npm install

  COPY . .

  # Script de démarrage
  RUN echo '#!/bin/bash\n\
  Xvfb :99 -screen 0 1920x1080x24 &\n\
  export DISPLAY=:99\n\
  fluxbox &\n\
  x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb &\n\
  npm start\n\
  ' > /app/start.sh && chmod +x /app/start.sh

  EXPOSE 5900 3000

  CMD ["/app/start.sh"]

  docker-compose.yml :
  services:
    scraper:
      build: .
      ports:
        - "5900:5900"  # Port VNC
        - "3000:3000"  # Port MCP
      environment:
        - DISPLAY=:99

  Pour débugger :
  # 1. Lance Docker
  docker-compose up

  # 2. Connecte-toi avec VNC (sur Mac)
  open vnc://localhost:5900

  # 3. Tu vois Chrome s'ouvrir, naviguer, etc. EN DIRECT !

  Alternative plus simple : noVNC (VNC dans le navigateur)
  Tu peux même voir le navigateur Docker dans ton navigateur web avec noVNC !

  Tu veux que je te prépare un exemple complet avec noVNC ?