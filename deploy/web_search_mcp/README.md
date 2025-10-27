# Cheerio MCP Helm Chart

Chart Helm pour déployer les composants de Cheerio MCP sur Kubernetes :
- **Server** : Serveur MCP avec scraping Playwright et accès VNC
- **Client** : Interface Web pour interagir avec le serveur MCP

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  Client (Web)   │────────▶│  Server (API)   │
│  Nginx:80       │         │  Node:3000      │
│                 │         │  VNC:5900       │
│                 │         │  noVNC:6080     │
└─────────────────┘         └─────────────────┘
```

## Prérequis

- Kubernetes 1.19+
- Helm 3.0+
- Nginx Ingress Controller (si ingress activé)
- Cert-manager (pour TLS automatique)

## Installation Rapide

### Déployer le Server

```bash
helm install cheerio-mcp-server ./deploy/web_search_mcp \
  -f ./deploy/values-server.yaml \
  --namespace cheerio-mcp \
  --create-namespace
```

### Déployer le Client

```bash
helm install cheerio-mcp-client ./deploy/web_search_mcp \
  -f ./deploy/values-client.yaml \
  --namespace cheerio-mcp \
  --create-namespace
```

## Configuration

### Paramètres Principaux

| Paramètre | Description | Défaut Server | Défaut Client |
|-----------|-------------|---------------|---------------|
| `appType` | Type d'application (`server` ou `client`) | `server` | `client` |
| `image.repository` | Repository de l'image Docker | `registry.example.local/cheerio-mcp-server` | `registry.example.local/cheerio-mcp-client` |
| `image.tag` | Tag de l'image | `latest` | `latest` |
| `service.targetPort` | Port du conteneur | `3000` | `80` |
| `vnc.enabled` | Activer les ports VNC (server seulement) | `true` | `false` |
| `ingress.enabled` | Activer l'ingress | `false` | `false` |

### Configuration Spécifique au Server

Le composant server inclut :
- API MCP sur le port 3000
- Serveur VNC sur le port 5900 (pour déboguer le navigateur)
- Interface web noVNC sur le port 6080

Variables d'environnement pour le server :
- `PORT` : Port de l'API (défaut : 3000)
- `NODE_ENV` : Environnement Node (défaut : production)
- `DISPLAY` : Display X11 (défaut : :99)
- `PLAYWRIGHT_HEADLESS` : Exécuter Playwright en mode headless (défaut : false)

### Configuration Spécifique au Client

Le composant client :
- Interface Web statique servie par nginx sur le port 80
- Optimisé pour le scaling horizontal
- Aucune variable d'environnement spéciale requise

## Utilisation Avancée

### Valeurs Personnalisées

Vous pouvez surcharger n'importe quelle valeur avec `--set` ou un fichier de valeurs personnalisé :

```bash
helm install cheerio-mcp-server ./deploy/web_search_mcp \
  --set appType=server \
  --set image.tag=v1.2.3 \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=api.example.local
```

### Mise à Jour du Déploiement

```bash
# Mettre à jour le server
helm upgrade cheerio-mcp-server ./deploy/web_search_mcp \
  -f ./deploy/values-server.yaml

# Mettre à jour le client
helm upgrade cheerio-mcp-client ./deploy/web_search_mcp \
  -f ./deploy/values-client.yaml
```

### Désinstallation

```bash
helm uninstall cheerio-mcp-server -n cheerio-mcp
helm uninstall cheerio-mcp-client -n cheerio-mcp
```

## Configuration Ingress

### Ingress Server Exemple

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: mcp-api.example.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-api-tls
      hosts:
        - mcp-api.example.local
```

### Ingress Client Exemple

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: mcp.example.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-client-tls
      hosts:
        - mcp.example.local
```

## Besoins en Ressources

### Server
- **Minimum** : 200m CPU, 512Mi mémoire
- **Recommandé** : 1 CPU, 1Gi mémoire

### Client
- **Minimum** : 50m CPU, 64Mi mémoire
- **Recommandé** : 200m CPU, 128Mi mémoire

## Autoscaling

Le client supporte l'autoscaling horizontal :

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 5
  targetCPUUtilizationPercentage: 70
```

Le server fonctionne généralement en instance unique ou avec scaling manuel.

## Health Checks

### Server
- **Liveness** : `GET /health` (port 3000)
- **Readiness** : `GET /health` (port 3000)

### Client
- **Liveness** : `GET /` (port 80)
- **Readiness** : `GET /` (port 80)

## Variables d'Environnement

### Server

```yaml
env:
  PORT: "3000"
  NODE_ENV: "production"
  LOG_LEVEL: "info"

server:
  playwright:
    headless: "false"
```

### Client

Le client nginx n'a pas besoin de variables d'environnement spéciales.

## ConfigMap et Secrets

### ConfigMap

Pour des configurations supplémentaires :

```yaml
config:
  MAX_CONCURRENT_REQUESTS: "50"
  CACHE_TTL: "3600"
  API_TIMEOUT: "30000"
```

### Secrets

Pour des données sensibles :

```yaml
secrets:
  API_KEY: "your-secret-api-key"
  DATABASE_PASSWORD: "super-secret"
```

## Tests

### Valider le Chart

```bash
# Valider la syntaxe
helm lint ./deploy/web_search_mcp

# Afficher les manifests générés (dry-run)
helm install cheerio-mcp-server ./deploy/web_search_mcp \
  -f ./deploy/values-server.yaml \
  --dry-run --debug

# Template avec vos valeurs
helm template cheerio-mcp-server ./deploy/web_search_mcp \
  -f ./deploy/values-server.yaml
```

### Tester le Déploiement

```bash
# Vérifier le statut
helm status cheerio-mcp-server -n cheerio-mcp

# Voir les ressources créées
kubectl get all -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp

# Logs
kubectl logs -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp
```

### Test Fonctionnel du Server

```bash
# Port-forward pour tester localement
kubectl port-forward svc/cheerio-mcp-server 3000:80 -n cheerio-mcp

# Tester le health check
curl http://localhost:3000/health

# Tester l'API MCP
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list", "params": {}}'
```

### Accéder à VNC (Server Seulement)

```bash
# Forward le port noVNC
kubectl port-forward -n cheerio-mcp svc/cheerio-mcp-server 6080:6080

# Puis ouvrir http://localhost:6080 dans votre navigateur
```

### Test Fonctionnel du Client

```bash
# Port-forward
kubectl port-forward svc/cheerio-mcp-client 8080:80 -n cheerio-mcp

# Ouvrir http://localhost:8080 dans votre navigateur
```

## Exemples de Déploiements

### Production avec TLS - Server

```yaml
# values-production-server.yaml
appType: server

image:
  repository: registry.example.local/cheerio-mcp-server
  tag: "v1.0.0"
  pullPolicy: Always

service:
  targetPort: 3000

vnc:
  enabled: true

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: mcp-api.example.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-api-tls
      hosts:
        - mcp-api.example.local

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 512Mi

env:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
```

### Production avec TLS - Client

```yaml
# values-production-client.yaml
appType: client

replicaCount: 3

image:
  repository: registry.example.local/cheerio-mcp-client
  tag: "v1.0.0"
  pullPolicy: Always

service:
  targetPort: 80

vnc:
  enabled: false

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: mcp.example.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-client-tls
      hosts:
        - mcp.example.local

resources:
  limits:
    cpu: 200m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
```

## Intégration CI/CD

Ce chart est conçu pour fonctionner avec le workflow GitHub Actions dans `.github/workflows/ci.yaml`.

Le workflow :
1. Build les deux images Docker
2. Les push vers le registry
3. Déploie les deux applications avec ce chart

## Troubleshooting

### Les Pods ne Démarrent Pas

```bash
# Vérifier les événements
kubectl describe pod -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp

# Voir les logs
kubectl logs -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp --tail=100

# Vérifier les images
kubectl get pods -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp \
  -o jsonpath='{.items[0].spec.containers[0].image}'
```

### Problème de Connexion

```bash
# Tester depuis un pod de test
kubectl run test --rm -it --image=curlimages/curl -n cheerio-mcp -- sh
curl http://cheerio-mcp-server/health

# Vérifier le service
kubectl get svc -n cheerio-mcp
kubectl describe svc cheerio-mcp-server -n cheerio-mcp
```

### HPA ne Scale Pas

```bash
# Vérifier le HPA
kubectl get hpa -n cheerio-mcp
kubectl describe hpa cheerio-mcp-client -n cheerio-mcp

# Vérifier metrics-server
kubectl top pods -n cheerio-mcp
kubectl top nodes
```

### Debug Ingress

```bash
kubectl get ingress -n cheerio-mcp
kubectl describe ingress cheerio-mcp-server -n cheerio-mcp
kubectl describe ingress cheerio-mcp-client -n cheerio-mcp
```

## Rollback

```bash
# Voir l'historique des releases
helm history cheerio-mcp-server -n cheerio-mcp

# Rollback à la version précédente
helm rollback cheerio-mcp-server -n cheerio-mcp

# Rollback à une version spécifique
helm rollback cheerio-mcp-server 3 -n cheerio-mcp
```

## Support

Pour toute question ou problème :
1. Vérifier les logs : `kubectl logs -l app.kubernetes.io/instance=cheerio-mcp-server -n cheerio-mcp`
2. Consulter la documentation principale du projet
3. Ouvrir une issue sur le repository

## License

MIT
