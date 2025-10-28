# Troubleshooting n8n + MCP Server

## Problème: "Could not connect to your MCP server"

### Environnement
- n8n: Container Docker (cheerio-mcp-n8n-1)
- MCP Server: Container Docker (cheerio-mcp-mcp-server-1)
- Réseau: mcp-network (bridge)

### Tests effectués

#### ✅ Test 1: Serveur MCP simple en local (hors Docker)
**Serveur**: `/test/server.ts` lancé avec `npx tsx server.ts`
**Port**: 3000 sur l'hôte

**Curl test 1** (sans Accept header):
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
**Résultat**:
```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}
```

**Curl test 2** (avec Accept header):
```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
**Résultat**: ✅ SUCCESS
```json
{"result":{"tools":[{"name":"hello","title":"Hello tool",...}]},"jsonrpc":"2.0","id":"1"}
```

#### ❌ Test 2: n8n avec localhost
**Configuration n8n MCP Client node**:
- Endpoint: `http://localhost:3000/mcp`
- Server Transport: HTTP Streamable
- Authentication: None
- Tools: All

**Résultat**: ❌ "Could not connect to your MCP server"

#### ✅ Test 3: n8n avec host.docker.internal
**Configuration n8n MCP Client node**:
- Endpoint: `http://host.docker.internal:3000/mcp`
- Server Transport: HTTP Streamable
- Authentication: None
- Tools: All

**Résultat**: ✅ SUCCESS - n8n a pu se connecter et lister les tools

---

## Observations factuelles

1. **Le serveur MCP fonctionne** - curl local réussit avec les bons headers
2. **`localhost` depuis n8n ne fonctionne pas** - erreur de connexion
3. **`host.docker.internal` depuis n8n fonctionne** - connexion réussie
4. **Le header `Accept: application/json, text/event-stream` est obligatoire**
5. **Le serveur principal (cheerio-mcp-mcp-server-1) est sur le même réseau Docker** que n8n

---

## Tests non encore effectués

- [ ] n8n → `http://mcp-server:3000/mcp` (via réseau Docker)
- [ ] n8n → serveur principal avec `host.docker.internal:3000`
- [ ] Vérifier si le node MCP Client envoie bien le header Accept

---

## Logs serveur MCP principal

```
[Auth] Warning: No API keys configured (MCP_API_KEYS not set). All requests allowed.
```

Ce message indique que l'authentification est **désactivée** et que toutes les requêtes sont autorisées.

Le serveur reçoit bien des requêtes (multiples warnings observés dans les logs).

---

## Questions en suspens

1. Pourquoi `localhost` ne fonctionne pas depuis n8n?
2. `host.docker.internal` vs `mcp-server` - quelle différence?
3. Le node MCP Client envoie-t-il automatiquement le header Accept?
4. Pourquoi le serveur dockerisé ne fonctionne pas avec n8n?
