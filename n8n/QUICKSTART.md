# n8n + MCP Server - Guide de Démarrage Rapide

## 🚀 Démarrage en 2 étapes

### 1. Démarrer n8n
```bash
cd /Users/yoannlorho/ws/cheerio-mcp
docker-compose up -d n8n
```

### 2. Accéder à l'interface
Ouvrir: http://localhost:5678

**Login:**
- Username: `admin`
- Password: `changeme`

---

## 🔧 Configuration du Node MCP Client dans n8n

### Paramètres requis

**Endpoint:**
```
http://mcp-server:3000/mcp
```

**Server Transport:**
```
HTTP Streamable
```

**Authentication:**
```
None
```

**Tools to Include:**
```
All
```

**Options > Timeout:**
```
60000
```

---

## 🎯 Exemple Simple: Recherche Web

### Créer un workflow

1. **Ajouter un node "Manual Trigger"**
   - C'est le point de départ

2. **Ajouter un node "MCP Client"**
   - Configurer comme ci-dessus
   - Dans "Tool": Sélectionner `search_web`
   - Dans "Arguments" (JSON):
   ```json
   {
     "query": "Model Context Protocol",
     "engines": ["duckduckgo"],
     "maxResults": 5
   }
   ```

3. **Tester**
   - Click sur "Execute Workflow"
   - Les résultats apparaissent dans l'output

---

## 🛠 Outils MCP Disponibles

| Tool | Description | Arguments |
|------|-------------|-----------|
| `search_web` | Recherche multi-moteurs | query, engines, maxResults |
| `scrape_page` | Extraction données | url, format, flatten |
| `scrape_multiple_pages` | Scraping parallèle | urls, format, flatten |
| `take_screenshot` | Capture écran | url, fullPage |
| `analyze_page_structure` | Analyse structure | url |

---

## 🎯 Use Cases Courants

### 1. Monitoring de Prix
```
Cron Trigger (1h)
→ MCP Client (scrape_page)
→ Compare Prix
→ Slack Alert si baisse
```

### 2. Veille Concurrentielle
```
Cron Trigger (jour)
→ MCP Client (search_web)
→ Extract Data
→ Google Sheets
```

### 3. Screenshots Automatiques
```
Webhook Trigger
→ MCP Client (take_screenshot)
→ Upload S3
→ Send Email
```

---

## ❓ Problèmes Fréquents

### n8n ne démarre pas
```bash
docker-compose logs -f n8n
docker-compose restart n8n
```

### Impossible de joindre MCP Server
```bash
# Test depuis n8n container
docker exec -it cheerio-mcp-n8n-1 wget -O- http://mcp-server:3000/health
```

### Erreur "Connection timeout"
→ Augmenter le timeout dans Options > Timeout (90000 = 90 secondes)

### Erreur "Tool not found"
→ Vérifier que le nom du tool est exact (sensible à la casse)

---

## 🔗 Ressources

- [n8n Documentation](https://docs.n8n.io/)
- [MCP Server API](../server/README.md)
- [Workflows Examples](./workflows/examples/)

---

## 💡 Tips

1. **Sauvegarder régulièrement** tes workflows (Export → JSON)
2. **Utiliser variables d'env** pour les credentials
3. **Tester d'abord avec Manual Trigger** avant Cron
4. **Activer error workflow** pour monitoring
5. **Le node MCP Client gère automatiquement** le protocole MCP, les sessions, et SSE
