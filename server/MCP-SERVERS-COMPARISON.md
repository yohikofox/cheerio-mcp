# MCP Servers Comparison

Ce projet contient **quatre implémentations** du serveur MCP :

## 1. `server-mcp-http.ts` (Legacy - Over-engineered)

### ❌ Problèmes

Cette implémentation réimplémente **manuellement** tout le protocole MCP :

- JSON-RPC 2.0 géré à la main
- Transport HTTP+SSE implémenté from scratch
- Session management manuel
- Message queuing manuel
- Protocol versioning géré manuellement

### Architecture

```
Client → Express HTTP → JSON-RPC manuel → Tools
```

### Conformité

- ⚠️ Utilise le transport **HTTP+SSE déprécié** (< 2024-11-05)
- ❌ N'utilise PAS le SDK officiel @modelcontextprotocol/sdk
- ❌ Code complexe et difficile à maintenir
- ❌ Risque de bugs dans l'implémentation du protocole
- ❌ Authentication par API Keys (non-conforme MCP OAuth 2.1)

### Utilisation

```bash
npm run build
npm run start:mcp
```

## 2. `server-mcp-sdk.ts` (Transition - À ne plus utiliser)

### ⚠️ Statut

Cette implémentation était une première tentative d'utilisation du SDK officiel mais ne suivait pas les patterns recommandés.

**Remplacée par** : `server-mcp-stateless.ts` et `server-mcp-stateful.ts`

### Architecture

```
Client → Express HTTP → StreamableHTTPServerTransport (SDK) → Server (SDK) → Tools
```

### Conformité

- ✅ Transport **Streamable HTTP** (spec 2025-06-18)
- ✅ Utilise @modelcontextprotocol/sdk
- ⚠️ Pattern non-optimal (ni vraiment stateless ni vraiment stateful)
- ❌ Authentication par API Keys (non-conforme MCP OAuth 2.1)

## 3. `server-mcp-stateless.ts` (Recommandé - Production simple)

### ✅ Avantages

Implémentation **stateless** suivant le pattern officiel `simpleStatelessStreamableHttp.ts` :

- Nouveau serveur créé pour chaque requête
- Pas de gestion de sessions
- Auto-cleanup après chaque réponse
- Horizontalement scalable (load balancing simple)
- Idéal pour recherche/scraping indépendant
- OAuth 2.1 MCP-compliant (optionnel)

### Architecture

```
Client → Express → OAuth Middleware → Stateless Transport → New Server → Tools
                                     ↓
                              (auto-cleanup)
```

### Conformité

- ✅ Transport **Streamable HTTP** (spec 2025-06-18)
- ✅ Pattern stateless officiel (sessionIdGenerator: undefined)
- ✅ OAuth 2.1 avec Bearer tokens (RFC 8707)
- ✅ Code simple et maintenable
- ✅ Scalabilité horizontale

### Utilisation

```bash
# Sans OAuth (dev)
OAUTH_ENABLED=false npm run start:mcp-stateless

# Avec OAuth (production)
npm run start:oauth-server  # Port 3001
npm run start:mcp-stateless # Port 3000
```

## 4. `server-mcp-stateful.ts` (Avancé - Workflows/Agents)

### ✅ Avantages

Implémentation **stateful** suivant les patterns officiels `simpleStreamableHttp.ts` + `elicitationExample.ts` :

- Maintient sessions entre requêtes
- Support SSE pour notifications serveur
- Endpoints POST/GET/DELETE
- Idéal pour workflows multi-étapes
- Support elicitation (demandes d'input utilisateur)
- OAuth 2.1 MCP-compliant (optionnel)

### Architecture

```
Client → Express → OAuth Middleware → Session Manager → Stateful Transport → Server → Tools
                                            ↓
                                     (sessions Map)
                                     POST: RPC requests
                                     GET:  SSE streaming
                                     DELETE: Terminate
```

### Conformité

- ✅ Transport **Streamable HTTP** (spec 2025-06-18)
- ✅ Pattern stateful officiel avec sessions
- ✅ Support SSE pour bidirectional communication
- ✅ OAuth 2.1 avec Bearer tokens (RFC 8707)
- ✅ Session cleanup automatique
- ✅ Graceful shutdown (SIGINT/SIGTERM)

### Utilisation

```bash
# Sans OAuth (dev)
OAUTH_ENABLED=false npm run start:mcp-stateful

# Avec OAuth (production)
npm run start:oauth-server  # Port 3001
npm run start:mcp-stateful  # Port 3000
```

## Comparaison Technique

| Aspect | server-mcp-http.ts | server-mcp-sdk.ts | server-mcp-stateless.ts | server-mcp-stateful.ts |
|--------|-------------------|-------------------|------------------------|----------------------|
| **SDK officiel** | ❌ Non | ✅ Oui | ✅ Oui | ✅ Oui |
| **Transport** | HTTP+SSE (déprécié) | Streamable HTTP | Streamable HTTP | Streamable HTTP |
| **Pattern** | Manuel | Hybride | Stateless officiel | Stateful officiel |
| **Code** | ~1400 lignes | ~470 lignes | ~500 lignes | ~650 lignes |
| **Authentication** | API Keys | API Keys | OAuth 2.1 | OAuth 2.1 |
| **Sessions** | Manuel | Tentative | Aucune (stateless) | Oui (Map) |
| **Scalabilité** | Moyenne | Moyenne | ✅ Excellente | Moyenne |
| **Endpoints** | POST, GET, DELETE | POST, GET | POST uniquement | POST, GET, DELETE |
| **SSE Support** | Oui (manuel) | Oui | ❌ Non | ✅ Oui |
| **Elicitation** | ❌ Non | ❌ Non | ❌ Non | ✅ Oui |
| **Cleanup** | Manuel | Tentative | ✅ Auto | ✅ Auto + SIGINT |
| **Use Case** | Legacy | Transition | Production simple | Workflows/Agents |
| **Recommandation** | ⛔ Déprécié | ⚠️ Ne plus utiliser | ✅ Défaut | ✅ Si besoin sessions |

## Outils Disponibles

Les deux serveurs exposent les mêmes outils :

1. **search_web** - Recherche web multi-moteurs (Google, DuckDuckGo, Bing)
2. **scrape_page** - Extraction de données d'une page web
3. **scrape_multiple_pages** - Extraction parallèle de plusieurs pages
4. **take_screenshot** - Capture d'écran d'une page
5. **analyze_page_structure** - Analyse de la structure d'une page

## Recommandation

🎯 **Utilisez `server-mcp-sdk.ts`** pour :
- Conformité avec la spec MCP 2025-06-18
- Simplicité du code
- Maintenance facilitée
- Support officiel d'Anthropic

⚠️ **Gardez `server-mcp-http.ts`** uniquement pour :
- Référence historique
- Comprendre l'implémentation du protocole
- Migration progressive

## Migration

Si vous utilisez actuellement `server-mcp-http.ts`, voici comment migrer :

### 1. Mettre à jour le Dockerfile

```dockerfile
# Ancien
CMD ["node", "dist/server-mcp-http.js"]

# Nouveau
CMD ["node", "dist/server-mcp-sdk.js"]
```

### 2. Aucun changement côté client

Les deux serveurs exposent la même API MCP, donc **aucun changement** n'est nécessaire côté client !

### 3. Variables d'environnement

Les mêmes variables d'environnement fonctionnent :

- `PORT` - Port du serveur (défaut: 3000)
- `MCP_API_KEYS` - Clés API pour l'authentification
- `PLAYWRIGHT_HEADLESS` - Mode headless pour Playwright

## Endpoints HTTP

### server-mcp-http.ts (Legacy)

```
GET  /mcp              - Établir SSE stream
POST /mcp              - Envoyer messages JSON-RPC
GET  /health           - Health check
DELETE /mcp/session    - Terminer session
```

### server-mcp-sdk.ts (Recommandé)

```
POST /mcp              - Endpoint principal (+ GET pour SSE optionnel)
GET  /health           - Health check
```

## Exemple d'utilisation

### Côté client (identique pour les deux serveurs)

```typescript
// Établir la connexion
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  })
});
```

## Différences d'implémentation

### Gestion des sessions

**server-mcp-http.ts** :
```typescript
// Implémentation manuelle
const sessions = new Map<string, Session>();
function createSession(protocolVersion: string): Session {
  const sessionId = randomBytes(16).toString("hex");
  // ... gestion manuelle
}
```

**server-mcp-sdk.ts** :
```typescript
// Le SDK gère tout
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: generateSessionId,
  onsessioninitialized: async (sessionId) => { /* ... */ }
});
```

### Gestion des outils

**server-mcp-http.ts** :
```typescript
// Switch case manuel
case "tools/call": {
  const { name, arguments: args } = req.body.params;
  switch (name) {
    case "search_web": /* ... */ break;
  }
}
```

**server-mcp-sdk.ts** :
```typescript
// Handler SDK
server.setRequestHandler(
  { method: "tools/call" },
  async (request) => {
    const { name, arguments: args } = request.params;
    // ... même logique métier
  }
);
```

## Performance

Les deux serveurs ont des performances similaires car ils utilisent les mêmes fonctions métier (Playwright, etc.).

La différence est uniquement dans la **gestion du protocole MCP**.

## Conclusion

**Recommandation finale** : Migrez vers `server-mcp-sdk.ts` dès que possible pour bénéficier :

1. ✅ Du support officiel
2. ✅ Des mises à jour du protocole
3. ✅ D'un code plus simple
4. ✅ De moins de bugs
5. ✅ D'une meilleure maintenabilité
