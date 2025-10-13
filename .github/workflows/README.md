# GitHub Actions CI/CD

Ce projet utilise GitHub Actions pour automatiser le build, test et déploiement du serveur MCP Web Search.

## Workflow : `ci-cd.yaml`

### Déclencheurs

- **Push** sur les branches `main` et `develop`
- **Déclenchement manuel** via GitHub UI (workflow_dispatch)

### Jobs

#### 1. `notify` - Notification de démarrage
- Envoie une notification Discord au début du workflow

#### 2. `test` - Tests et compilation
- Installation de Node.js 20
- Installation des dépendances (`npm ci`)
- Compilation TypeScript (`npm run build`)
- Lint du code (optionnel)
- Exécution des tests (optionnel)

#### 3. `build` - Construction de l'image Docker
- Versioning automatique avec `git-version`
- Configuration de QEMU et Buildx pour multi-arch
- Login au registry Docker privé
- Build et push de l'image avec 3 tags :
  - `<sha>` : Hash du commit
  - `<version>` : Version calculée par git-version
  - `latest` : Tag latest

#### 4. `deploy` - Déploiement Kubernetes
- Checkout du code
- Création du fichier de valeurs Helm depuis les variables GitHub
- Déploiement via Helm dans le cluster Kubernetes
- Mise à jour de l'image avec le SHA du commit

#### 5. Notifications
- `notify-build-end` : Build réussi
- `notify-build-failure` : Build échoué
- `notify-build-cancelled` : Build annulé
- `notify-deploy-end` : Déploiement réussi
- `notify-deploy-failure` : Déploiement échoué
- `notify-deploy-cancelled` : Déploiement annulé

## Configuration requise

### Secrets GitHub

Allez dans `Settings > Secrets and variables > Actions` et ajoutez :

| Secret | Description | Exemple |
|--------|-------------|---------|
| `DISCORD_WEBHOOK` | URL du webhook Discord | `https://discord.com/api/webhooks/...` |
| `REGISTRY_SERVER` | Serveur du registry Docker | `registry.example.local` |
| `REGISTRY_USERNAME` | Username du registry | `robot$mcp-deployer` |
| `REGISTRY_PASSWORD` | Password du registry | `eyJhbGciOi...` |
| `KUBE_CONFIG` | Kubeconfig encodé en base64 | `apiVersion: v1...` |

### Variables GitHub

Allez dans `Settings > Secrets and variables > Actions > Variables` :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `NAMESPACE` | Namespace Kubernetes | `mcp-services` |
| `HELM_VALUES` | Valeurs Helm YAML | Voir ci-dessous |

#### Exemple de `HELM_VALUES`

```yaml
replicaCount: 2

image:
  pullPolicy: IfNotPresent

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
    - secretName: mcp-tls
      hosts:
        - mcp.example.local

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
```

### Environments

Créez deux environnements dans `Settings > Environments` :

1. **develop** - Pour la branche develop
2. **main** - Pour la branche main (production)

Pour chaque environnement, configurez :
- Les secrets/variables spécifiques
- Les protection rules (optionnel)
- Les required reviewers (pour main)

## Encodage du KUBE_CONFIG

Pour encoder votre kubeconfig :

```bash
# Linux/Mac
cat ~/.kube/config | base64 -w 0

# Ou copier directement dans le clipboard
cat ~/.kube/config | base64 -w 0 | pbcopy  # Mac
cat ~/.kube/config | base64 -w 0 | xclip   # Linux
```

Collez le résultat dans le secret `KUBE_CONFIG`.

## Webhook Discord

### Créer un webhook

1. Allez dans les paramètres du serveur Discord
2. `Intégrations > Webhooks > Nouveau Webhook`
3. Nommez-le "GitHub CI/CD"
4. Choisissez le canal de destination
5. Copiez l'URL du webhook
6. Ajoutez-la comme secret `DISCORD_WEBHOOK`

### Format des notifications

Les notifications incluent :
- Nom du repository
- Type d'événement (push, workflow_dispatch)
- Message du commit
- Auteur

Exemple :
```
START - owner/cheerio-mcp : [push] Add search functionality - by @username
BUILD END - owner/cheerio-mcp : [push] Add search functionality - by @username
DEPLOY END - owner/cheerio-mcp : [push] Add search functionality - by @username
```

## Utilisation

### Déploiement automatique

```bash
# Push sur develop (déploie en dev)
git checkout develop
git add .
git commit -m "feat: add new search engine"
git push origin develop

# Merge vers main (déploie en prod)
git checkout main
git merge develop
git push origin main
```

### Déploiement manuel

1. Allez dans l'onglet `Actions` de votre repository
2. Sélectionnez le workflow `CI/CD Web Search MCP`
3. Cliquez sur `Run workflow`
4. Choisissez la branche
5. Cliquez sur `Run workflow`

## Versioning

Le versioning est automatique grâce à `codacy/git-version` :

- **develop** : `0.1.0-dev.42` (avec nombre de commits)
- **main** : `1.0.0` (tags Git)

Pour créer une release :

```bash
git checkout main
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0
```

## Monitoring

### Voir les logs

```bash
# Via GitHub UI
# Actions > Sélectionner le workflow > Sélectionner le job > Voir les logs

# Via kubectl
kubectl logs -l app.kubernetes.io/name=web-search-mcp -n mcp-services -f
```

### Vérifier le déploiement

```bash
# Status du deployment
kubectl get deployment web-search-mcp -n mcp-services

# Pods
kubectl get pods -l app.kubernetes.io/name=web-search-mcp -n mcp-services

# Ingress
kubectl get ingress web-search-mcp -n mcp-services
```

## Rollback

### Via Helm

```bash
# Voir l'historique
helm history web-search-mcp -n mcp-services

# Rollback
helm rollback web-search-mcp -n mcp-services
```

### Via kubectl

```bash
# Rollback deployment
kubectl rollout undo deployment/web-search-mcp -n mcp-services

# Rollback à une version spécifique
kubectl rollout undo deployment/web-search-mcp --to-revision=2 -n mcp-services
```

## Troubleshooting

### Le build échoue

1. Vérifiez les logs dans GitHub Actions
2. Testez localement :
   ```bash
   npm ci
   npm run build
   docker build -t test .
   ```

### Le push Docker échoue

- Vérifiez les credentials du registry
- Vérifiez que le registry est accessible
- Testez le login manuellement :
  ```bash
  docker login registry.example.local -u <username> -p <password>
  ```

### Le déploiement échoue

- Vérifiez le KUBE_CONFIG
- Vérifiez que le namespace existe
- Vérifiez les logs Helm :
  ```bash
  helm list -n mcp-services
  kubectl describe deployment web-search-mcp -n mcp-services
  ```

### Les notifications Discord ne fonctionnent pas

- Vérifiez l'URL du webhook
- Vérifiez que le webhook est actif dans Discord
- Testez avec curl :
  ```bash
  curl -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d '{"content":"Test message"}'
  ```

## Sécurité

- ✅ Secrets GitHub chiffrés
- ✅ Pas de credentials en clair dans le code
- ✅ KUBE_CONFIG encodé en base64
- ✅ Registry privé avec authentification
- ✅ Environnements séparés (dev/prod)

## Best Practices

1. **Branches** :
   - `develop` pour le développement
   - `main` pour la production
   - Feature branches : `feature/nom-feature`

2. **Commits** :
   - Suivre Conventional Commits
   - `feat:`, `fix:`, `docs:`, `chore:`, etc.

3. **Tags** :
   - Utiliser SemVer : `v1.0.0`, `v1.1.0`, `v2.0.0`

4. **Reviews** :
   - Activer les required reviewers pour `main`
   - Merger via Pull Requests

5. **Monitoring** :
   - Surveiller les notifications Discord
   - Vérifier les déploiements régulièrement
