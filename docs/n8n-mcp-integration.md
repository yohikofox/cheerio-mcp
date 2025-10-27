# Intégration n8n avec le Serveur MCP Cheerio

Ce document décrit comment intégrer n8n avec votre serveur MCP Cheerio pour permettre aux AI Agents n8n d'utiliser vos outils de scraping et d'analyse de pages web.

## Table des Matières

- [Introduction](#introduction)
- [Architecture](#architecture)
- [Compatibilité](#compatibilité)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [Exemples Pratiques](#exemples-pratiques)
- [Configuration Réseau](#configuration-réseau)
- [Troubleshooting](#troubleshooting)
- [Références](#références)

---

## Introduction

### Qu'est-ce que MCP ?

Le **Model Context Protocol (MCP)** est un protocole ouvert introduit par Anthropic fin 2024 qui permet une intégration transparente entre les applications LLM et les sources de données/outils externes.

### n8n et MCP

n8n supporte nativement le protocole MCP via un **nœud communautaire officiel** qui permet :
- ✅ Connexion à des serveurs MCP externes
- ✅ Auto-découverte des tools disponibles
- ✅ Intégration avec les AI Agents n8n
- ✅ Support de multiples protocoles de transport (HTTP, SSE, stdio)

### Votre Serveur MCP Cheerio

Votre serveur MCP expose des outils de scraping web :
- `scrape_page` : Extraction de données depuis des pages web
- `analyze_page_structure` : Analyse de la structure d'une page
- Autres tools définis dans votre configuration

**Bonne nouvelle : Votre serveur est 100% compatible avec n8n !**

---

## Architecture

### Vue d'Ensemble

```
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│   n8n Workflow      │         │   MCP Client Node   │         │  Cheerio MCP Server │
│                     │         │                     │         │                     │
│  ┌───────────────┐  │         │  - Auto-discovery   │         │  - scrape_page      │
│  │  AI Agent     │──┼────────▶│  - Tool invocation  │────────▶│  - analyze_page     │
│  │  (ChatGPT,    │  │  HTTP   │  - Result parsing   │   SSE   │  - domain_config    │
│  │   Claude...)  │  │         │                     │         │                     │
│  └───────────────┘  │         └─────────────────────┘         └─────────────────────┘
│                     │                                          │  Port: 3000         │
│  ┌───────────────┐  │                                          │  VNC: 5900, 6080    │
│  │ Other Nodes   │  │                                          └─────────────────────┘
│  │ (Email, DB,   │  │
│  │  Slack...)    │  │
│  └───────────────┘  │
└─────────────────────┘
```

### Flux de Données

1. **AI Agent reçoit un prompt** de l'utilisateur
2. **AI Agent identifie** qu'il a besoin d'utiliser un tool MCP
3. **MCP Client Node** établit une connexion avec le serveur MCP
4. **Le serveur MCP** exécute le tool demandé (ex: scraping)
5. **Les résultats** sont retournés au AI Agent
6. **AI Agent formatte** et présente les résultats

---

## Compatibilité

### Protocoles de Transport Supportés

| Protocole | Statut | Description | Compatible avec Cheerio MCP |
|-----------|--------|-------------|---------------------------|
| **HTTP Streamable** | ✅ Recommandé | Protocole moderne, efficace et flexible | ✅ Oui |
| **SSE** (Server-Sent Events) | ✅ Legacy | Protocole streaming unidirectionnel | ✅ Oui |
| **stdio** | ✅ Supporté | Communication via stdin/stdout (local) | ⚠️ Non applicable (serveur HTTP) |

**Votre serveur MCP utilise HTTP avec SSE, ce qui est parfaitement supporté par n8n.**

### Versions Compatibles

- **n8n** : Version 1.x ou supérieure
- **MCP Protocol** : Version 1.x (implémentée par votre serveur)
- **Node MCP** : `@nerding-io/n8n-nodes-mcp` ou `n8n-nodes-mcp`

---

## Prérequis

### 1. Serveur MCP Cheerio

- ✅ Serveur déployé et accessible
- ✅ Port 3000 exposé
- ✅ Endpoint `/health` fonctionnel
- ✅ Tools MCP définis

### 2. Instance n8n

Vous pouvez utiliser :
- n8n Cloud (hébergé)
- n8n self-hosted (Docker)
- n8n self-hosted (Kubernetes)
- n8n Desktop

### 3. Configuration Réseau

- Connectivité réseau entre n8n et le serveur MCP
- Si sur Kubernetes : même cluster ou Ingress configuré
- Si externe : URL publique du serveur MCP

---

## Installation

### Étape 1 : Installer le Nœud MCP Community

#### Option A : Via l'Interface n8n

1. Aller dans **Settings** → **Community Nodes**
2. Cliquer sur **Install**
3. Entrer le nom du package : `n8n-nodes-mcp`
4. Cliquer sur **Install**
5. Redémarrer n8n si nécessaire

#### Option B : Via npm (Self-hosted)

```bash
# Si n8n est installé globalement
npm install -g n8n-nodes-mcp

# Si n8n est dans un dossier spécifique
cd /path/to/n8n
npm install n8n-nodes-mcp
```

#### Option C : Via Docker

Ajouter au Dockerfile ou utiliser une variable d'environnement :

```dockerfile
# Dans le Dockerfile
RUN npm install -g n8n-nodes-mcp
```

Ou avec une variable d'environnement :

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e N8N_COMMUNITY_NODE_PACKAGES=n8n-nodes-mcp \
  n8nio/n8n
```

### Étape 2 : Activer les Community Nodes comme Tools

**Cette étape est OBLIGATOIRE** pour que les AI Agents puissent utiliser le MCP Client.

#### n8n Standalone

```bash
export N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
n8n start
```

#### n8n Docker

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

#### n8n Docker Compose

```yaml
version: '3'

services:
  n8n:
    image: n8nio/n8n
    environment:
      - N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
      - N8N_COMMUNITY_NODE_PACKAGES=n8n-nodes-mcp
    ports:
      - "5678:5678"
    volumes:
      - ~/.n8n:/home/node/.n8n
```

#### n8n Kubernetes (Helm)

Ajouter à vos values :

```yaml
env:
  N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE: "true"
  N8N_COMMUNITY_NODE_PACKAGES: "n8n-nodes-mcp"
```

#### n8n Desktop

Créer un fichier `.env` dans le dossier n8n :

```
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

---

## Configuration

### Créer une Credential MCP

1. Dans n8n, aller dans **Credentials** → **New**
2. Chercher **"MCP"**
3. Vous verrez 3 types de credentials :

#### Type 1 : HTTP Streamable (Recommandé)

```
Name: Cheerio MCP Server
Type: MCP Client (HTTP Streamable)
URL: http://cheerio-mcp-server:3000
```

**Utilisez cette option pour votre serveur.**

#### Type 2 : SSE (Legacy)

```
Name: Cheerio MCP Server (SSE)
Type: MCP Client (SSE)
URL: http://cheerio-mcp-server:3000
```

**Alternative fonctionnelle.**

#### Type 3 : stdio

Non applicable pour votre cas (serveur HTTP).

### Configuration pour Différents Environnements

#### 1. n8n et MCP sur le même cluster Kubernetes

```
URL: http://cheerio-mcp-server.cheerio-mcp.svc.cluster.local:3000
```

Format : `http://<service-name>.<namespace>.svc.cluster.local:<port>`

#### 2. n8n externe, MCP avec Ingress

```
URL: https://mcp-api.example.local
```

Assurez-vous que :
- Ingress est configuré pour le serveur MCP
- Certificat TLS valide (si HTTPS)
- CORS activé si nécessaire

#### 3. n8n local, MCP local (développement)

```
URL: http://localhost:3000
```

### Variables d'Environnement pour MCP Servers

Si votre serveur MCP nécessite des API keys ou configuration :

```yaml
# Dans Docker Compose ou Kubernetes
environment:
  - MCP_CUSTOM_API_KEY=your-api-key
  - MCP_SETTING_1=value1
```

**Toutes les variables préfixées par `MCP_` sont automatiquement passées au serveur MCP.**

---

## Utilisation

### Créer un Workflow avec AI Agent

#### Étape 1 : Ajouter un Nœud AI Agent

1. Créer un nouveau workflow
2. Ajouter le nœud **"AI Agent"**
3. Choisir votre modèle LLM :
   - OpenAI Chat Model
   - Anthropic Claude
   - Google PaLM
   - Etc.

#### Étape 2 : Ajouter le MCP Client comme Tool

1. Dans le nœud AI Agent, section **Tools**
2. Cliquer sur **Add Tool**
3. Sélectionner **"MCP Client Tool"**
4. Configurer :
   - **Credential** : Sélectionner votre credential MCP
   - **Auto-discover tools** : ✅ Activé

Le nœud va automatiquement découvrir tous les tools disponibles sur votre serveur MCP !

#### Étape 3 : Configurer le Prompt

Dans le AI Agent, configurer le système prompt :

```
You are a helpful assistant that can scrape and analyze web pages.

Available tools:
- scrape_page: Extract data from web pages
- analyze_page_structure: Analyze the structure of a page
- Other MCP tools will be auto-discovered

When asked to get information from a website, use the appropriate tool.
```

#### Étape 4 : Tester

Envoyer un message au AI Agent :

```
Please scrape the product information from https://example.com/product/12345
```

Le AI Agent va :
1. Identifier qu'il doit utiliser `scrape_page`
2. Appeler votre serveur MCP via le MCP Client
3. Recevoir les données extraites
4. Formater et présenter les résultats

---

## Exemples Pratiques

### Exemple 1 : Scraping Simple

**Workflow :**

```
Webhook → AI Agent (avec MCP Client) → Set → Respond to Webhook
```

**Prompt utilisateur :**

```
Extract the title, price, and description from this product page:
https://www.cdiscount.com/pdt2/f/o/o/1/foo123.html
```

**Résultat :**

L'AI Agent utilise automatiquement `scrape_page` et retourne :

```json
{
  "title": "Produit Example",
  "price": "€29.99",
  "description": "Description du produit...",
  "brand": "Marque",
  "availability": "En stock"
}
```

### Exemple 2 : Analyse de Structure

**Prompt :**

```
Analyze the structure of this page and tell me what data can be extracted:
https://www.example.com/category/electronics
```

**Résultat :**

```
This page contains:
- 24 product listings
- Each with: title, price, image, rating
- Pagination with 5 pages
- Filters for: brand, price range, rating

Extractable data includes:
- Product information (structured data: JSON-LD)
- User reviews and ratings
- Category hierarchy
```

### Exemple 3 : Workflow Avancé avec Conditionnels

```
┌─────────────┐
│   Webhook   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AI Agent   │ ← MCP Client Tool
│  (Analyze)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│     IF      │ ← If page has products
└──┬────────┬─┘
   │        │
   ▼        ▼
┌──────┐ ┌──────────┐
│Email │ │  Store   │
│Alert │ │  in DB   │
└──────┘ └──────────┘
```

### Exemple 4 : Intégration avec d'autres Nœuds

**Scénario :** Scraper des produits et les envoyer à Slack

```
Schedule Trigger (daily)
    ↓
AI Agent + MCP Client (scrape products)
    ↓
Code (format data)
    ↓
Slack (send notification)
```

**Configuration AI Agent :**

```
Task: Scrape the top 10 products from our competitor's website
at https://competitor.com/bestsellers and list their names and prices
```

---

## Configuration Réseau

### Scénario 1 : n8n et MCP sur le même Cluster Kubernetes

**Architecture :**

```
┌─────────────────────────────────────────────┐
│         Kubernetes Cluster                  │
│                                             │
│  ┌──────────────┐      ┌─────────────────┐ │
│  │  n8n Pod     │─────▶│  MCP Server Pod │ │
│  │  (n8n-ns)    │ HTTP │  (cheerio-mcp)  │ │
│  └──────────────┘      └─────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

**Configuration MCP Credential :**

```
URL: http://cheerio-mcp-server.cheerio-mcp.svc.cluster.local:3000
```

**Vérification :**

```bash
# Depuis un pod n8n, tester la connectivité
kubectl exec -it <n8n-pod> -n n8n-namespace -- curl http://cheerio-mcp-server.cheerio-mcp:3000/health
```

### Scénario 2 : n8n Externe, MCP avec Ingress

**Architecture :**

```
┌──────────┐         ┌─────────────┐         ┌───────────────┐
│  n8n     │─────────▶│   Ingress   │─────────▶│  MCP Server   │
│ (Cloud)  │  HTTPS  │  (nginx)    │   HTTP  │  (K8s)        │
└──────────┘         └─────────────┘         └───────────────┘
```

**Configuration Ingress (déjà fait) :**

```yaml
ingress:
  enabled: true
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

**Configuration MCP Credential :**

```
URL: https://mcp-api.example.local
```

### Scénario 3 : Développement Local

**Architecture :**

```
┌────────────┐         ┌─────────────────┐
│  n8n       │─────────▶│  MCP Server     │
│ (localhost)│   HTTP  │  (Docker)       │
│  :5678     │         │  :3000          │
└────────────┘         └─────────────────┘
```

**Démarrer le serveur MCP :**

```bash
cd server
docker-compose up
```

**Configuration MCP Credential :**

```
URL: http://localhost:3000
```

### Configuration CORS (si nécessaire)

Si vous avez des erreurs CORS, ajoutez dans votre serveur MCP :

```typescript
// Dans server-mcp-http.ts
app.use(cors({
  origin: ['http://localhost:5678', 'https://app.n8n.cloud'],
  credentials: true
}));
```

---

## Troubleshooting

### Problème 1 : "MCP Client Tool not found"

**Cause :** Le nœud MCP n'est pas installé ou pas activé.

**Solution :**

1. Vérifier l'installation :
   ```bash
   npm list n8n-nodes-mcp
   ```

2. Vérifier la variable d'environnement :
   ```bash
   echo $N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE
   # Doit afficher: true
   ```

3. Redémarrer n8n

### Problème 2 : "Cannot connect to MCP server"

**Cause :** Problème de connectivité réseau.

**Solutions :**

1. **Vérifier que le serveur MCP est accessible :**
   ```bash
   curl http://cheerio-mcp-server:3000/health
   ```

2. **Vérifier les logs du serveur MCP :**
   ```bash
   kubectl logs -f <mcp-pod-name> -n cheerio-mcp
   ```

3. **Vérifier l'URL dans la credential :**
   - Kubernetes : utiliser le FQDN complet
   - Externe : vérifier Ingress et DNS
   - Local : utiliser `localhost` ou `127.0.0.1`

4. **Tester avec curl depuis le pod n8n :**
   ```bash
   kubectl exec -it <n8n-pod> -- curl http://cheerio-mcp-server.cheerio-mcp:3000/health
   ```

### Problème 3 : "Tools not discovered"

**Cause :** Le serveur MCP ne répond pas correctement à la requête de découverte.

**Solutions :**

1. **Vérifier que le serveur implémente bien `tools/list` :**
   ```bash
   curl -X POST http://cheerio-mcp-server:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "tools/list",
       "params": {},
       "id": 1
     }'
   ```

2. **Vérifier les logs du serveur MCP** lors de l'appel

3. **Tester avec un autre client MCP** pour isoler le problème

### Problème 4 : "AI Agent not using MCP tools"

**Cause :** Le prompt n'est pas clair ou le AI Agent ne comprend pas quand utiliser les tools.

**Solutions :**

1. **Améliorer le système prompt :**
   ```
   You MUST use the available MCP tools when asked to:
   - Scrape websites
   - Extract data from URLs
   - Analyze page structure

   Available tools:
   - scrape_page: Use this to extract data from any URL
   - analyze_page_structure: Use this to understand page layout
   ```

2. **Être plus explicite dans la requête utilisateur :**
   ```
   Use the scrape_page tool to get data from https://example.com
   ```

### Problème 5 : "Timeout errors"

**Cause :** Le scraping prend trop de temps.

**Solutions :**

1. **Augmenter le timeout dans n8n :**
   - Settings → Workflow Settings → Execution Timeout

2. **Optimiser le scraping côté serveur MCP :**
   - Réduire les attentes (wait times)
   - Désactiver le chargement des images si non nécessaire
   - Utiliser le mode headless

### Problème 6 : "MCP Client not available in AI Agent Tools"

**Cause :** `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` n'est pas activé.

**Solution :**

```bash
# Vérifier
docker exec <n8n-container> env | grep N8N_COMMUNITY

# Si absent, ajouter
docker run ... -e N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

### Logs et Debugging

#### Logs n8n

```bash
# Docker
docker logs -f n8n

# Kubernetes
kubectl logs -f <n8n-pod> -n n8n-namespace
```

#### Logs MCP Server

```bash
# Docker
docker-compose logs -f mcp-server

# Kubernetes
kubectl logs -f <mcp-server-pod> -n cheerio-mcp
```

#### Mode Debug n8n

Dans n8n, activer le mode debug :

```bash
export N8N_LOG_LEVEL=debug
n8n start
```

---

## Configuration Avancée

### Utiliser Plusieurs Serveurs MCP

Vous pouvez configurer plusieurs credentials MCP pour différents serveurs :

```yaml
# n8n peut se connecter à plusieurs serveurs MCP
- Cheerio MCP (scraping)
- Weather MCP (météo)
- Brave Search MCP (recherche)
```

Dans le AI Agent, ajoutez plusieurs MCP Client Tools, un par serveur.

### Passer des Variables d'Environnement

Pour configurer dynamiquement vos MCP servers :

```yaml
# Docker Compose
environment:
  - MCP_BRAVE_API_KEY=${BRAVE_API_KEY}
  - MCP_CUSTOM_SETTING=${CUSTOM_SETTING}
```

Ces variables sont automatiquement disponibles dans vos serveurs MCP.

### Sécurité

#### 1. Authentification

Si vous voulez sécuriser votre serveur MCP :

```typescript
// Ajouter un middleware d'authentification
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.MCP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

Dans n8n, vous pourriez alors configurer des headers personnalisés.

#### 2. Rate Limiting

Protégez votre serveur MCP contre les abus :

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // max 100 requêtes par fenêtre
});

app.use('/mcp', limiter);
```

---

## Bonnes Pratiques

### 1. Organisation des Workflows

```
workflows/
├── mcp-scraping/
│   ├── product-scraper.json
│   ├── competitor-analysis.json
│   └── price-monitoring.json
└── mcp-analysis/
    ├── page-structure.json
    └── seo-audit.json
```

### 2. Nommage des Credentials

Utilisez des noms descriptifs :
- ✅ `Cheerio MCP Production`
- ✅ `Cheerio MCP Staging`
- ❌ `MCP Server 1`

### 3. Gestion des Erreurs

Dans vos workflows, ajoutez toujours des nœuds d'erreur :

```
AI Agent (MCP)
    ↓
   [IF Error]
    ↓           ↓
[Log Error]  [Retry]
    ↓
[Send Alert]
```

### 4. Monitoring

Surveillez :
- Temps de réponse du serveur MCP
- Taux d'erreur
- Nombre de requêtes
- Utilisation mémoire/CPU

### 5. Tests

Créez des workflows de test :

```
Manual Trigger
    ↓
AI Agent (Test MCP connection)
    ↓
Assert (Validate response)
    ↓
Send Result
```

---

## Ressources

### Documentation Officielle

- **n8n MCP Client Tool** : https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/
- **Model Context Protocol** : https://modelcontextprotocol.io/
- **n8n AI Agents** : https://docs.n8n.io/

### GitHub

- **n8n-nodes-mcp** : https://github.com/nerding-io/n8n-nodes-mcp
- **n8n** : https://github.com/n8n-io/n8n
- **MCP Specification** : https://github.com/modelcontextprotocol/specification

### Guides Communautaires

- **Getting Started with MCP on n8n** : https://n8ntips.com/getting-started-with-model-context-protocol-mcp-on-n8n-2/
- **Integrating n8n with MCP** : https://medium.com/@tam.tamanna18/integrating-n8n-workflow-automation-with-model-context-protocol-mcp-servers-0e7ef54729c1
- **n8n MCP Guide** : https://www.leanware.co/insights/n8n-mcp-guide

### Exemples de Workflows

Plusieurs workflows d'exemple sont disponibles dans la communauté n8n.

---

## Conclusion

L'intégration entre n8n et votre serveur MCP Cheerio est **native et complète**. Aucun développement supplémentaire n'est nécessaire.

### Points Clés

✅ **Compatibilité totale** : n8n supporte nativement le protocole MCP
✅ **Installation simple** : Un seul nœud communautaire à installer
✅ **Auto-découverte** : Les tools MCP sont automatiquement détectés
✅ **AI Agents** : Intégration complète avec les AI Agents n8n
✅ **Protocoles** : Support HTTP, SSE, et stdio

### Prochaines Étapes

1. Installer le nœud `n8n-nodes-mcp`
2. Activer `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`
3. Créer une credential MCP pointant vers votre serveur
4. Créer votre premier workflow avec AI Agent
5. Tester et déployer en production

**Votre infrastructure MCP est prête pour n8n ! 🚀**

---

## Support

Pour toute question ou problème :
1. Consulter les logs du serveur MCP et de n8n
2. Vérifier la connectivité réseau
3. Consulter la documentation officielle
4. Ouvrir une issue sur le repository GitHub

**Bon scraping ! 🎯**
