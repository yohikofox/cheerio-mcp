# Deployment Guide - Web Search MCP

Guide de déploiement du serveur et client MCP sur Kubernetes avec Helm.

## Architecture

- **Serveur** : API MCP avec Playwright (port 3000) + VNC (ports 5900, 6080)
- **Client** : Interface web statique servie par nginx (port 80)
- **Communication** : Le client se connecte au serveur via le DNS interne Kubernetes

## Prérequis

```bash
# Créer le namespace
kubectl create namespace cheerio-mcp

# Créer le secret pour les API keys (production)
kubectl create secret generic mcp-api-keys \
  --from-literal=MCP_API_KEYS="key1,key2,key3" \
  -n cheerio-mcp
```

## Déploiement du Serveur

### Option 1 : Helm direct

```bash
helm install cheerio-mcp-server ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  --set appType=server \
  --set image.repository=registry.example.local/cheerio-mcp-server \
  --set image.tag=latest \
  --set server.enabled=true \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=mcp-api.example.local \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

### Option 2 : Values file

Créer `values-server.yaml` :

```yaml
appType: server

image:
  repository: registry.example.local/cheerio-mcp-server
  tag: "v1.0.0"
  pullPolicy: Always

service:
  targetPort: 3000

server:
  enabled: true
  playwright:
    headless: "false"

vnc:
  enabled: true

ingress:
  enabled: true
  hosts:
    - host: mcp-api.example.local
      paths:
        - path: /
          pathType: Prefix

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 200m
    memory: 512Mi
```

```bash
helm install cheerio-mcp-server ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  -f values-server.yaml
```

## Déploiement du Client

### Configuration automatique avec DNS Kubernetes

Le client peut se configurer automatiquement pour pointer vers le serveur en utilisant le DNS interne de Kubernetes.

### Option 1 : Helm direct

```bash
helm install cheerio-mcp-client ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  --set appType=client \
  --set image.repository=registry.example.local/cheerio-mcp-client \
  --set image.tag=latest \
  --set service.targetPort=80 \
  --set client.enabled=true \
  --set client.server.serviceName=cheerio-mcp-server \
  --set client.server.port=3000 \
  --set client.server.protocol=http \
  --set vnc.enabled=false \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=mcp.example.local \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

### Option 2 : Values file

Créer `values-client.yaml` :

```yaml
appType: client

image:
  repository: registry.example.local/cheerio-mcp-client
  tag: "v1.0.0"
  pullPolicy: Always

service:
  targetPort: 80

client:
  enabled: true
  server:
    # Nom du service du serveur (automatiquement résolu par Kubernetes DNS)
    serviceName: "cheerio-mcp-server"
    # Même namespace, donc on ne spécifie pas
    namespace: ""
    port: 3000
    protocol: "http"
    # Cela génère automatiquement : http://cheerio-mcp-server:3000

vnc:
  enabled: false

ingress:
  enabled: true
  hosts:
    - host: mcp.example.local
      paths:
        - path: /
          pathType: Prefix

resources:
  limits:
    cpu: 200m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi

# Health checks pour nginx
livenessProbe:
  httpGet:
    path: /
    port: http
  initialDelaySeconds: 5
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /
    port: http
  initialDelaySeconds: 3
  periodSeconds: 10

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 5
```

```bash
helm install cheerio-mcp-client ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  -f values-client.yaml
```

## DNS Kubernetes - Comment ça marche

### Serveur et Client dans le même namespace

```yaml
# Le client configure automatiquement :
MCP_SERVER_URL: http://cheerio-mcp-server:3000
```

Kubernetes résout automatiquement `cheerio-mcp-server` vers l'IP du service dans le même namespace.

### Serveur et Client dans des namespaces différents

```yaml
client:
  server:
    serviceName: "cheerio-mcp-server"
    namespace: "mcp-backend"  # Namespace du serveur
    port: 3000
    protocol: "http"
```

Génère :
```
MCP_SERVER_URL: http://cheerio-mcp-server.mcp-backend.svc.cluster.local:3000
```

## Vérification du déploiement

```bash
# Vérifier les pods
kubectl get pods -n cheerio-mcp

# Vérifier les services
kubectl get svc -n cheerio-mcp

# Vérifier les ingress
kubectl get ingress -n cheerio-mcp

# Logs du serveur
kubectl logs -f deployment/cheerio-mcp-server -n cheerio-mcp

# Logs du client
kubectl logs -f deployment/cheerio-mcp-client -n cheerio-mcp

# Vérifier la variable d'environnement du client
kubectl exec -it deployment/cheerio-mcp-client -n cheerio-mcp -- env | grep MCP_SERVER_URL
```

## Mise à jour

```bash
# Mise à jour du serveur
helm upgrade cheerio-mcp-server ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  -f values-server.yaml

# Mise à jour du client
helm upgrade cheerio-mcp-client ./deploy/web_search_mcp \
  --namespace cheerio-mcp \
  -f values-client.yaml
```

## Désinstallation

```bash
# Supprimer le client
helm uninstall cheerio-mcp-client -n cheerio-mcp

# Supprimer le serveur
helm uninstall cheerio-mcp-server -n cheerio-mcp

# Supprimer le namespace (optionnel)
kubectl delete namespace cheerio-mcp
```

## Troubleshooting

### Le client ne peut pas se connecter au serveur

```bash
# Vérifier la résolution DNS depuis le pod client
kubectl exec -it deployment/cheerio-mcp-client -n cheerio-mcp -- nslookup cheerio-mcp-server

# Vérifier la connectivité
kubectl exec -it deployment/cheerio-mcp-client -n cheerio-mcp -- wget -O- http://cheerio-mcp-server:3000/health

# Vérifier les logs du serveur
kubectl logs -f deployment/cheerio-mcp-server -n cheerio-mcp
```

### Problèmes de permissions

Si vous voyez des erreurs de permissions (comme avant la correction) :

```bash
# Vérifier que l'image a bien été rebuildée avec les nouvelles permissions
kubectl describe pod <pod-name> -n cheerio-mcp

# Forcer le pull de la nouvelle image
kubectl rollout restart deployment/cheerio-mcp-server -n cheerio-mcp
kubectl rollout restart deployment/cheerio-mcp-client -n cheerio-mcp
```

## Exemple complet avec Terraform

```hcl
resource "helm_release" "mcp_server" {
  name       = "cheerio-mcp-server"
  chart      = "./deploy/web_search_mcp"
  namespace  = "cheerio-mcp"

  values = [yamlencode({
    appType = "server"
    image = {
      repository = "registry.example.local/cheerio-mcp-server"
      tag        = var.server_version
    }
    server = {
      enabled = true
    }
    ingress = {
      enabled = true
      hosts = [{
        host  = "mcp-api.example.local"
        paths = [{ path = "/", pathType = "Prefix" }]
      }]
    }
  })]
}

resource "helm_release" "mcp_client" {
  name       = "cheerio-mcp-client"
  chart      = "./deploy/web_search_mcp"
  namespace  = "cheerio-mcp"

  # Le client dépend du serveur
  depends_on = [helm_release.mcp_server]

  values = [yamlencode({
    appType = "client"
    image = {
      repository = "registry.example.local/cheerio-mcp-client"
      tag        = var.client_version
    }
    client = {
      enabled = true
      server = {
        serviceName = "cheerio-mcp-server"
        port        = 3000
        protocol    = "http"
      }
    }
    vnc = {
      enabled = false
    }
    ingress = {
      enabled = true
      hosts = [{
        host  = "mcp.example.local"
        paths = [{ path = "/", pathType = "Prefix" }]
      }]
    }
  })]
}
```
