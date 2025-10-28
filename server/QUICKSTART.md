# Guide de démarrage rapide

## Option 1: Test rapide SANS OAuth (le plus simple)

### 1. Compiler le projet
```bash
npm run build
```

### 2. Démarrer le serveur MCP sans OAuth
```bash
OAUTH_ENABLED=false npm run start:mcp-stateless
```

### 3. Tester avec le script automatisé
```bash
./test-mcp-no-auth.sh
```

### 4. Ou tester manuellement avec curl
```bash
# Lister les outils disponibles
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq

# Rechercher sur le web
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "search_web",
      "arguments": {
        "query": "Model Context Protocol",
        "engines": ["duckduckgo"],
        "maxResults": 5
      }
    }
  }' | jq
```

---

## Option 2: Test AVEC OAuth 2.1 (complet)

### 1. Compiler le projet
```bash
npm run build
```

### 2. Démarrer le serveur OAuth (Terminal 1)
```bash
npm run start:oauth-server
```

Vous verrez:
```
✓ OAuth Authorization Server started
✓ Auth Server URL: http://localhost:3001
✓ MCP Server URL: http://localhost:3000
```

### 3. Démarrer le serveur MCP (Terminal 2)
```bash
npm run start:mcp-stateless
```

Vous verrez:
```
🔐 OAuth enabled: true
🚀 MCP Server (Stateless) listening on port 3000
```

### 4. Tester le flow OAuth complet (Terminal 3)
```bash
./test-oauth-flow.sh
```

Ce script va:
1. Générer les codes PKCE
2. Vous demander d'ouvrir une URL dans le navigateur
3. Récupérer le code d'autorisation
4. Échanger le code contre un token
5. Tester le serveur MCP avec le token

### 5. Utiliser le token obtenu

Le script sauvegarde le token dans `.oauth-token`. Pour l'utiliser:

```bash
# Charger le token
ACCESS_TOKEN=$(cat .oauth-token)

# Faire des requêtes au serveur MCP
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq
```

---

## Option 3: Serveur Stateful (avec sessions)

Le serveur stateful maintient les sessions entre requêtes et supporte SSE.

### 1. Démarrer le serveur stateful
```bash
npm run start:mcp-stateful
```

### 2. Initialiser une session
```bash
RESPONSE=$(curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }')

# Extraire le session ID
SESSION_ID=$(echo $RESPONSE | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"
```

### 3. Utiliser la session
```bash
# Requêtes suivantes avec le même session ID
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | jq
```

### 4. Stream SSE (notifications serveur)
```bash
# Connexion SSE pour recevoir les notifications
curl -N -H "MCP-Session-Id: $SESSION_ID" \
  http://localhost:3000/mcp
```

### 5. Terminer la session
```bash
curl -X DELETE http://localhost:3000/mcp \
  -H "MCP-Session-Id: $SESSION_ID"
```

---

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `search_web` | Recherche multi-moteurs (Google, DuckDuckGo, Bing) |
| `scrape_page` | Extraction de données d'une page web |
| `scrape_multiple_pages` | Extraction de données de plusieurs pages |
| `take_screenshot` | Capture d'écran d'une page web |

---

## Variables d'environnement

### OAuth Server
```bash
export OAUTH_PORT=3001                    # Port du serveur OAuth
export OAUTH_BASE_URL=http://localhost:3001
export MCP_BASE_URL=http://localhost:3000
export STRICT_RESOURCE_VALIDATION=true    # Validation stricte des resources
```

### MCP Server
```bash
export PORT=3000                          # Port du serveur MCP
export OAUTH_ENABLED=true                 # Activer/désactiver OAuth
export OAUTH_SERVER_URL=http://localhost:3001
export RESOURCE_INDICATOR=http://localhost:3000
```

---

## Comparaison des serveurs

| Feature | Stateless | Stateful |
|---------|-----------|----------|
| Session management | ❌ Non | ✅ Oui |
| SSE support | ❌ Non | ✅ Oui |
| Scalabilité | ✅ Excellent | ⚠️ Modérée |
| OAuth 2.1 | ✅ Oui | ✅ Oui |
| Use case | Production simple | Workflows/Agents |

---

## Troubleshooting

### Erreur: "Module not found"
```bash
# Recompiler le projet
npm run build
```

### Erreur: "Port already in use"
```bash
# Trouver et tuer le processus
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

### OAuth: "Token is not active"
Le token a expiré (durée: 1h). Relancer le flow OAuth:
```bash
./test-oauth-flow.sh
```

### Playwright: "Browser not installed"
```bash
npx playwright install chromium
```

---

## Documentation complète

- [TESTING-OAUTH.md](./TESTING-OAUTH.md) - Guide complet OAuth 2.1
- [OAUTH-SETUP.md](./OAUTH-SETUP.md) - Configuration OAuth détaillée
- [MCP-SERVERS-COMPARISON.md](./MCP-SERVERS-COMPARISON.md) - Comparaison des serveurs

---

## Prochaines étapes

1. ✅ Tester le serveur sans OAuth
2. ✅ Tester le flow OAuth complet
3. ✅ Tester les différents outils (search, scrape, screenshot)
4. 🔜 Intégrer Keycloak (provider production)
5. 🔜 Déployer en production

---

## Support

Pour toute question ou problème:
1. Consulter [TESTING-OAUTH.md](./TESTING-OAUTH.md)
2. Vérifier les logs des serveurs
3. Vérifier que les ports 3000 et 3001 sont disponibles
