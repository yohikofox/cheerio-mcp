# Docker Deployment Guide

Ce guide explique comment déployer le MCP Server et Client avec Docker Compose.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  Client (Web)   │────────▶│  Server (API)   │
│  Nginx:8080     │         │  Node:3000      │
│                 │         │  VNC:5900       │
│                 │         │  noVNC:6080     │
└─────────────────┘         └─────────────────┘
```

## Démarrage rapide

### Option 1 : Tout ensemble (recommandé)

Depuis la racine du projet :

```bash
# Sans authentification
docker-compose up -d

# Avec authentification
MCP_API_KEYS=votre-clé-ici docker-compose up -d
```

Accès :
- **Web Client** : http://localhost:8080
- **MCP API** : http://localhost:3000
- **VNC Debug** : http://localhost:6080

### Option 2 : Client seul

Si vous avez déjà un serveur MCP qui tourne ailleurs :

```bash
cd client
docker-compose up -d
```

Accès :
- **Web Client** : http://localhost:8080

### Option 3 : Serveur seul

```bash
cd server
docker-compose up -d
```

Accès :
- **MCP API** : http://localhost:3000
- **VNC Debug** : http://localhost:6080

## Configuration

### Authentification API

1. **Générer une clé sécurisée** :

```bash
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **Configurer les clés** :

Créer un fichier `.env` à la racine :

```bash
cp .env.example .env
```

Éditer `.env` :

```env
MCP_API_KEYS=votre-clé-générée
```

3. **Démarrer avec authentification** :

```bash
docker-compose up -d
```

### Multiples clés API

Pour gérer plusieurs clés (rotation, différents clients) :

```env
MCP_API_KEYS=clé-1,clé-2,clé-3
```

## Commandes utiles

### Voir les logs

```bash
# Tous les services
docker-compose logs -f

# Serveur uniquement
docker-compose logs -f mcp-server

# Client uniquement
docker-compose logs -f mcp-client
```

### Rebuild après modifications

```bash
# Rebuild tout (avec legacy builder pour éviter les blocages BuildKit)
DOCKER_BUILDKIT=0 docker-compose up -d --build

# Rebuild un service spécifique
DOCKER_BUILDKIT=0 docker-compose up -d --build mcp-server
DOCKER_BUILDKIT=0 docker-compose up -d --build mcp-client

# Ou build séparément puis up
DOCKER_BUILDKIT=0 docker-compose build --no-cache
docker-compose up -d
```

> **Note**: Le flag `DOCKER_BUILDKIT=0` désactive BuildKit pour éviter que le processus de build reste bloqué (bug connu avec les attestations).

### Arrêter les services

```bash
# Arrêter (garder les volumes)
docker-compose stop

# Arrêter et supprimer les conteneurs
docker-compose down

# Tout supprimer (conteneurs + volumes)
docker-compose down -v
```

### Debugging

```bash
# Shell dans le conteneur serveur
docker-compose exec mcp-server sh

# Shell dans le conteneur client
docker-compose exec mcp-client sh

# Voir l'état des services
docker-compose ps

# Vérifier la santé des services
docker-compose ps --format json | jq '.[].Health'
```

## Accès VNC

Le serveur MCP expose un navigateur Playwright accessible via VNC pour debugging :

1. **Via noVNC (navigateur)** : http://localhost:6080
2. **Via client VNC** : vnc://localhost:5900

Cela permet de voir en temps réel ce que Playwright fait lors du scraping.

## Volumes

### Serveur

- `./server/data` → `/app/domain-configs` : Configurations de domaine apprises

### Client

Aucun volume persistant (application statique).

## Ports exposés

### Serveur (docker-compose à la racine)
- `3000` : API MCP HTTP
- `5900` : VNC
- `6080` : noVNC web

### Client (docker-compose à la racine)
- `8080` : Interface web

### Client standalone (client/docker-compose.yml)
- `8080` : Interface web

### Serveur standalone (server/docker-compose.yml)
- `3000` : API MCP
- `5900` : VNC
- `6080` : noVNC

## Variables d'environnement

### Serveur

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `MCP_API_KEYS` | Clés API (séparées par virgules) | aucune | Non |
| `NODE_ENV` | Environnement Node.js | `production` | Non |
| `PLAYWRIGHT_HEADLESS` | Mode headless de Playwright | `false` | Non |
| `DISPLAY` | Display X11 pour VNC | `:99` | Oui |

### Client

Aucune variable d'environnement requise.

## Production

### Recommandations

1. **Toujours activer l'authentification** :
   ```env
   MCP_API_KEYS=clé-forte-générée-aléatoirement
   ```

2. **Utiliser un reverse proxy** (nginx, Traefik) avec TLS

3. **Limiter l'accès VNC** (ports 5900/6080) en interne uniquement

4. **Configurer les resources** :
   ```yaml
   services:
     mcp-server:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 2G
   ```

5. **Monitoring** : Utiliser les healthchecks intégrés

### Exemple avec Traefik

```yaml
services:
  mcp-client:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mcp-client.rule=Host(`mcp.example.local`)"
      - "traefik.http.routers.mcp-client.tls=true"
```

## Troubleshooting

### Le client ne se connecte pas au serveur

Vérifier que les services sont sur le même réseau Docker :

```bash
docker network inspect cheerio-mcp_mcp-network
```

### Erreur d'authentification

1. Vérifier que la clé API est correctement configurée
2. Vérifier les logs : `docker-compose logs mcp-server | grep Auth`

### Playwright ne démarre pas

```bash
# Vérifier les logs VNC
docker-compose logs mcp-server | grep VNC

# Vérifier le display
docker-compose exec mcp-server env | grep DISPLAY
```

### Images volumineuses

```bash
# Nettoyer les anciennes images
docker image prune -a

# Voir la taille des images
docker images | grep mcp
```

## Support

Pour plus d'informations :
- **Documentation serveur** : `server/README.md`
- **Documentation client** : `client/README.md`
- **Guide déploiement Kubernetes** : `deploy/web_search_mcp/README.md`
