# Web Search MCP Helm Chart

Chart Helm pour déployer le serveur MCP Web Search avec Cheerio sur Kubernetes.

## Prérequis

- Kubernetes 1.19+
- Helm 3.0+
- Nginx Ingress Controller (si ingress activé)
- Cert-manager (pour TLS automatique)

## Installation

### Installation rapide

```bash
# Ajouter le chart localement
cd deploy

# Installer avec les valeurs par défaut
helm install web-search-mcp ./web_search_mcp

# Ou avec un namespace spécifique
helm install web-search-mcp ./web_search_mcp --namespace mcp-services --create-namespace
```

### Installation avec valeurs personnalisées

Créer un fichier `my-values.yaml` :

```yaml
image:
  repository: your-registry.example.local/cheerio-mcp
  tag: "1.0.0"

ingress:
  enabled: true
  hosts:
    - host: mcp.your-domain.example
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-tls
      hosts:
        - mcp.your-domain.example

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 200m
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 15
```

Installer avec vos valeurs :

```bash
helm install web-search-mcp ./web_search_mcp -f my-values.yaml
```

## Configuration

### Paramètres principaux

| Paramètre | Description | Défaut |
|-----------|-------------|--------|
| `replicaCount` | Nombre de replicas (si autoscaling désactivé) | `2` |
| `image.repository` | Repository de l'image Docker | `registry.example.local/cheerio-mcp` |
| `image.tag` | Tag de l'image | `latest` |
| `image.pullPolicy` | Pull policy | `IfNotPresent` |
| `service.type` | Type de service K8s | `ClusterIP` |
| `service.port` | Port du service | `80` |
| `ingress.enabled` | Activer l'ingress | `true` |
| `ingress.className` | Classe de l'ingress | `nginx` |
| `resources.limits.cpu` | Limite CPU | `500m` |
| `resources.limits.memory` | Limite mémoire | `512Mi` |
| `autoscaling.enabled` | Activer HPA | `true` |
| `autoscaling.minReplicas` | Replicas minimum | `2` |
| `autoscaling.maxReplicas` | Replicas maximum | `10` |

### Variables d'environnement

Définir des variables d'environnement :

```yaml
env:
  PORT: "3000"
  NODE_ENV: "production"
  LOG_LEVEL: "debug"
  CUSTOM_VAR: "value"
```

### ConfigMap

Pour des configurations plus complexes :

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

## Mise à jour

```bash
# Mettre à jour avec de nouvelles valeurs
helm upgrade web-search-mcp ./web_search_mcp -f my-values.yaml

# Mettre à jour uniquement l'image
helm upgrade web-search-mcp ./web_search_mcp --set image.tag=v1.1.0

# Forcer le redéploiement
helm upgrade web-search-mcp ./web_search_mcp --recreate-pods
```

## Rollback

```bash
# Voir l'historique des releases
helm history web-search-mcp

# Rollback à la version précédente
helm rollback web-search-mcp

# Rollback à une version spécifique
helm rollback web-search-mcp 3
```

## Désinstallation

```bash
# Désinstaller la release
helm uninstall web-search-mcp

# Désinstaller avec suppression du namespace
helm uninstall web-search-mcp --namespace mcp-services
kubectl delete namespace mcp-services
```

## Tests

### Valider le chart

```bash
# Valider la syntaxe
helm lint ./web_search_mcp

# Afficher les manifests générés (dry-run)
helm install web-search-mcp ./web_search_mcp --dry-run --debug

# Template avec vos valeurs
helm template web-search-mcp ./web_search_mcp -f my-values.yaml
```

### Tester le déploiement

```bash
# Installer en mode test
helm install web-search-mcp ./web_search_mcp --dry-run

# Vérifier le statut
helm status web-search-mcp

# Voir les ressources créées
kubectl get all -l app.kubernetes.io/instance=web-search-mcp
```

### Test fonctionnel

```bash
# Port-forward pour tester localement
kubectl port-forward svc/web-search-mcp 8080:80

# Tester le health check
curl http://localhost:8080/health

# Tester l'API MCP
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list", "params": {}}'
```

## Exemples de déploiements

### Production avec TLS

```yaml
# values-production.yaml
replicaCount: 3

image:
  repository: registry.example.local/cheerio-mcp
  tag: "v1.0.0"
  pullPolicy: Always

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/rate-limit: "100"
  hosts:
    - host: mcp-prod.example.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mcp-prod-tls
      hosts:
        - mcp-prod.example.local

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 60

nodeSelector:
  node-role: worker
```

### Développement

```yaml
# values-dev.yaml
replicaCount: 1

image:
  tag: "dev"
  pullPolicy: Always

ingress:
  enabled: true
  hosts:
    - host: mcp-dev.example.local
      paths:
        - path: /
          pathType: Prefix
  tls: []

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi

autoscaling:
  enabled: false

env:
  LOG_LEVEL: "debug"
  NODE_ENV: "development"
```

## Monitoring

### Prometheus ServiceMonitor

Ajouter dans `values.yaml` :

```yaml
serviceMonitor:
  enabled: true
  interval: 30s
  path: /metrics
```

### Grafana Dashboard

Des dashboards Grafana sont disponibles pour visualiser :
- Requêtes par seconde
- Latence des réponses
- Utilisation CPU/Mémoire
- Taux d'erreurs

## Troubleshooting

### Les pods ne démarrent pas

```bash
# Vérifier les événements
kubectl describe pod -l app.kubernetes.io/name=web-search-mcp

# Voir les logs
kubectl logs -l app.kubernetes.io/name=web-search-mcp --tail=100

# Vérifier les images
kubectl get pods -l app.kubernetes.io/name=web-search-mcp -o jsonpath='{.items[0].spec.containers[0].image}'
```

### Problème de connexion

```bash
# Tester depuis un pod de test
kubectl run test --rm -it --image=curlimages/curl -- sh
curl http://web-search-mcp/health

# Vérifier le service
kubectl get svc web-search-mcp
kubectl describe svc web-search-mcp
```

### HPA ne scale pas

```bash
# Vérifier le HPA
kubectl get hpa
kubectl describe hpa web-search-mcp

# Vérifier metrics-server
kubectl top pods
kubectl top nodes
```

## Support

Pour toute question ou problème :
1. Vérifier les logs : `kubectl logs -l app.kubernetes.io/name=web-search-mcp`
2. Consulter la documentation Kubernetes
3. Ouvrir une issue sur le repository

## License

MIT
