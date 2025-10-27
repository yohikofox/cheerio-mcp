# Docker Build Guide

Ce document explique comment builder l'image Docker du serveur MCP en mode développement ou production.

## Modes de build disponibles

Le Dockerfile supporte deux modes de build via l'argument `BUILD_ENV` :

### Mode Production (par défaut)

**Utilisation :** Déploiement Kubernetes, CI/CD

**Caractéristiques :**
- Logs redirigés vers `stdout/stderr`
- Compatible avec `kubectl logs`
- Compatible avec les systèmes de logging centralisés (Loki, Elasticsearch, etc.)
- Log level: `info`

**Build :**
```bash
# Méthode 1 : sans argument (production par défaut)
docker build -t cheerio-mcp-server:latest ./server

# Méthode 2 : argument explicite
docker build --build-arg BUILD_ENV=production -t cheerio-mcp-server:latest ./server
```

### Mode Development

**Utilisation :** Développement local, debugging

**Caractéristiques :**
- Logs écrits dans des fichiers individuels dans `/var/log/supervisor/`
- Facilite le debugging avec des logs persistants
- Log level: `debug`

**Build :**
```bash
docker build --build-arg BUILD_ENV=development -t cheerio-mcp-server:dev ./server
```

## Fichiers de logs en mode développement

En mode développement, les logs sont disponibles dans le conteneur :

```bash
# Accéder au conteneur
docker exec -it <container-id> bash

# Consulter les logs
tail -f /var/log/supervisor/supervisord.log    # Logs supervisord
tail -f /var/log/supervisor/mcp-server.log     # Logs serveur MCP
tail -f /var/log/supervisor/xvfb.log           # Logs serveur X
tail -f /var/log/supervisor/x11vnc.log         # Logs VNC
tail -f /var/log/supervisor/novnc.log          # Logs noVNC
tail -f /var/log/supervisor/fluxbox.log        # Logs gestionnaire de fenêtres
```

## Consulter les logs

### En mode production (Kubernetes)
```bash
# Logs complets du pod
kubectl logs -f <pod-name>

# Logs d'un conteneur spécifique
kubectl logs -f <pod-name> -c web-search-mcp

# Logs précédents (si le pod a redémarré)
kubectl logs --previous <pod-name>
```

### En mode développement (Docker local)
```bash
# Via docker logs (stdout/stderr)
docker logs -f <container-id>

# Ou directement dans les fichiers de log
docker exec -it <container-id> tail -f /var/log/supervisor/mcp-server.log
```

## Exemple pour CI/CD

```yaml
# GitHub Actions
- name: Build production image
  run: |
    docker build \
      --build-arg BUILD_ENV=production \
      -t registry.example.local/cheerio-mcp-server:${{ github.sha }} \
      ./server

# Ou pour une build de développement
- name: Build development image
  run: |
    docker build \
      --build-arg BUILD_ENV=development \
      -t cheerio-mcp-server:dev \
      ./server
```

## Volumes pour logs persistants (dev uniquement)

Si vous voulez conserver les logs en dehors du conteneur en mode développement :

```bash
docker run -d \
  --name mcp-server-dev \
  -v $(pwd)/logs:/var/log/supervisor \
  -p 3000:3000 \
  cheerio-mcp-server:dev
```

## Notes importantes

1. **Production** : Les logs vont vers stdout/stderr et sont gérés par Kubernetes
2. **Développement** : Les logs sont dans `/var/log/supervisor/` avec rotation automatique
3. Le mode par défaut est **production** pour éviter les erreurs de permissions en Kubernetes
4. Le répertoire `/var/log/supervisor` a les permissions `777` pour supporter l'exécution en tant qu'utilisateur non-root (runAsUser: 1001)
