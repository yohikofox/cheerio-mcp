# n8n Integration avec MCP Server

Ce dossier contient la configuration et les workflows n8n pour automatiser les tâches avec le serveur MCP.

## 🚀 Démarrage rapide

### 1. Démarrer n8n avec Docker Compose

```bash
cd /Users/yoannlorho/ws/cheerio-mcp
docker-compose up -d n8n
```

### 2. Accéder à l'interface n8n

Ouvrez votre navigateur: http://localhost:5678

**Credentials par défaut:**
- Username: `admin`
- Password: `changeme`

⚠️ **Important**: Changez le mot de passe en production !

## 🔗 Connexion au serveur MCP

n8n tourne dans le même réseau Docker que le serveur MCP. Utilisez ces URLs:

### Depuis n8n (réseau Docker)
```
http://mcp-server:3000
```

### Depuis votre navigateur (localhost)
```
http://localhost:3000
```

## 📝 Exemple de Workflow: Recherche Web avec MCP

### Workflow 1: Recherche Web Automatique

1. **Trigger**: Webhook ou Cron
2. **HTTP Request** vers MCP:
   - Method: `POST`
   - URL: `http://mcp-server:3000/mcp`
   - Headers:
     ```json
     {
       "Content-Type": "application/json",
       "Accept": "application/json, text/event-stream",
       "X-API-Key": "yolo"
     }
     ```
   - Body:
     ```json
     {
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/call",
       "params": {
         "name": "search_web",
         "arguments": {
           "query": "{{ $json.query }}",
           "engines": ["duckduckgo"],
           "maxResults": 10
         }
       }
     }
     ```
3. **Parse SSE Response**: Extraire la data du format SSE
4. **Process Results**: Traiter les résultats

### Workflow 2: Scraping Automatique

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "scrape_page",
    "arguments": {
      "url": "https://example.com",
      "format": "json",
      "flatten": true
    }
  }
}
```

### Workflow 3: Screenshot Automatique

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "take_screenshot",
    "arguments": {
      "url": "https://example.com",
      "fullPage": false
    }
  }
}
```

## 🔐 Avec OAuth 2.1 (Production)

Si le serveur MCP utilise OAuth:

1. **Obtenir un token OAuth** (voir TESTING-OAUTH.md)
2. **Ajouter le header Authorization**:
   ```json
   {
     "Authorization": "Bearer YOUR_ACCESS_TOKEN"
   }
   ```

Exemple:
```json
{
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": "Bearer abc123..."
  }
}
```

## 📂 Structure des dossiers

```
n8n/
├── README.md           # Ce fichier
├── custom/             # Extensions personnalisées n8n
│   └── .gitkeep
└── workflows/          # Workflows exportés (à créer)
    └── examples/
```

## 💡 Use Cases

### 1. Monitoring de Prix
- Trigger: Cron (toutes les heures)
- Action: Scraper plusieurs sites e-commerce
- Output: Slack/Email si changement de prix

### 2. Veille Concurrentielle
- Trigger: Cron (quotidien)
- Action: Recherche web + scraping
- Output: Base de données / Notion / Airtable

### 3. Génération de Rapports
- Trigger: Webhook
- Action: Scraping multiple pages
- Output: PDF / Google Sheets

### 4. Social Media Monitoring
- Trigger: Cron
- Action: Recherche web pour mentions de marque
- Output: Dashboard / Alertes

## 🛠 Configuration Avancée

### Variables d'Environnement

Modifier dans `docker-compose.yml`:

```yaml
environment:
  - N8N_BASIC_AUTH_USER=votre_username
  - N8N_BASIC_AUTH_PASSWORD=votre_password_securise
  - GENERIC_TIMEZONE=Europe/Paris
  - WEBHOOK_URL=http://votre-domaine.com/
```

### Sauvegarder les Workflows

```bash
# Backup des workflows
docker cp cheerio-mcp-n8n-1:/home/node/.n8n ./n8n-backup

# Restaurer
docker cp ./n8n-backup/. cheerio-mcp-n8n-1:/home/node/.n8n
```

### Exporter un Workflow

1. Dans n8n UI: Workflow → Download
2. Sauvegarder dans `./n8n/workflows/`
3. Commiter dans Git

## 🔧 Troubleshooting

### n8n ne démarre pas
```bash
# Vérifier les logs
docker-compose logs -f n8n

# Redémarrer
docker-compose restart n8n
```

### Impossible de contacter MCP Server
```bash
# Vérifier que les deux services sont sur le même réseau
docker network inspect cheerio-mcp_mcp-network

# Tester depuis n8n container
docker exec -it cheerio-mcp-n8n-1 wget -O- http://mcp-server:3000/health
```

### Réinitialiser n8n
```bash
# Supprimer les données (ATTENTION: perte des workflows!)
docker-compose down -v
docker-compose up -d n8n
```

## 📚 Ressources

- [n8n Documentation](https://docs.n8n.io/)
- [MCP Server API](../server/README.md)
- [OAuth Setup](../server/OAUTH-SETUP.md)
- [MCP Protocol Spec](https://modelcontextprotocol.io/specification)

## 🎯 Exemples de Nodes n8n Utiles

### HTTP Request Node
Pour appeler le serveur MCP

### Code Node (JavaScript)
Pour parser les réponses SSE:
```javascript
// Parse SSE response
const sseData = items[0].json.data;
const lines = sseData.split('\n');
const dataLine = lines.find(line => line.startsWith('data: '));
const jsonData = JSON.parse(dataLine.substring(6));
return jsonData.result;
```

### Schedule Trigger
Pour automatiser les recherches/scraping périodiques

### Webhook Node
Pour déclencher des workflows via API externe

## 🔒 Sécurité

1. **Changer le mot de passe par défaut**
2. **Utiliser HTTPS en production** (via reverse proxy)
3. **Limiter l'accès réseau** (firewall)
4. **Sauvegarder régulièrement** les workflows
5. **Ne pas commiter les credentials** dans Git
