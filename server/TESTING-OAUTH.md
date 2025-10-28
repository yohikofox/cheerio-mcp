# Guide de test OAuth 2.1 + MCP Server

Ce guide explique comment tester le système OAuth 2.1 avec les serveurs MCP.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   OAuth Client  │ ───> │  OAuth Server   │      │   MCP Server    │
│  (Browser/App)  │      │   Port 3001     │      │   Port 3000     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                │                          │
                                │ 1. Get token             │
                                └──────────────────────────┘
                                                           │
                                2. Use token ──────────────┘
```

## Étape 1: Démarrer les serveurs

### Terminal 1: Démarrer le serveur OAuth (Authorization Server)

```bash
npm run build
npm run start:oauth-server
```

Vous devriez voir:
```
🔐 Starting MCP OAuth 2.1 Authorization Server...
⚠️  DEMO IMPLEMENTATION - NOT FOR PRODUCTION
✓ OAuth Authorization Server started
✓ Auth Server URL: http://localhost:3001
✓ MCP Server URL: http://localhost:3000
```

### Terminal 2: Démarrer le serveur MCP (Stateless)

```bash
npm run start:mcp-stateless
```

Vous devriez voir:
```
🔐 OAuth enabled: true
🔐 OAuth server: http://localhost:3001
🔐 Resource indicator: http://localhost:3000
🚀 MCP Server (Stateless) listening on port 3000
```

## Étape 2: Enregistrer un client OAuth

Le serveur OAuth demo enregistre automatiquement les clients à la volée. Nous allons utiliser le flow OAuth 2.1 avec PKCE.

### 2.1 Vérifier les métadonnées OAuth

```bash
curl http://localhost:3001/.well-known/oauth-authorization-server | jq
```

Vous devriez voir:
```json
{
  "issuer": "http://localhost:3001",
  "authorization_endpoint": "http://localhost:3001/oauth/authorize",
  "token_endpoint": "http://localhost:3001/oauth/token",
  "introspection_endpoint": "http://localhost:3001/introspect"
}
```

## Étape 3: Obtenir un token OAuth (Flow simplifié pour test)

Pour tester rapidement, nous allons simuler le flow OAuth complet.

### 3.1 Créer les codes PKCE (Code Challenge)

```bash
# Générer code_verifier (random string)
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
echo "Code Verifier: $CODE_VERIFIER"

# Générer code_challenge (SHA256 du verifier)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d "=+/" | cut -c1-43)
echo "Code Challenge: $CODE_CHALLENGE"
```

### 3.2 Enregistrer un client

Le serveur demo permet l'enregistrement dynamique. Pour simplifier, nous allons utiliser directement le flow d'autorisation.

### 3.3 Flow OAuth complet (Simulation)

**Option A: Via navigateur (Recommandé pour comprendre le flow)**

1. Ouvrir dans le navigateur:
```
http://localhost:3001/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:8080/callback&response_type=code&code_challenge=VOTRE_CODE_CHALLENGE&code_challenge_method=S256&scope=mcp:tools&resource=http://localhost:3000
```

2. Le serveur redirige vers `http://localhost:8080/callback?code=XXXXX`

3. Extraire le code et échanger contre un token:
```bash
curl -X POST http://localhost:3001/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=XXXXX" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "client_id=test-client" \
  -d "code_verifier=$CODE_VERIFIER"
```

**Option B: Script automatisé de test**

Créons un script pour automatiser tout ça:

```bash
#!/bin/bash

# 1. Générer PKCE
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d "=+/" | cut -c1-43)

echo "📝 Code Verifier: $CODE_VERIFIER"
echo "📝 Code Challenge: $CODE_CHALLENGE"
echo ""

# 2. Obtenir authorization code (nécessite interaction navigateur)
echo "🌐 Ouvrez cette URL dans votre navigateur:"
echo "http://localhost:3001/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:8080/callback&response_type=code&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&scope=mcp:tools&resource=http://localhost:3000"
echo ""
echo "💡 Copiez le 'code' depuis l'URL de redirection"
read -p "📥 Entrez le code: " AUTH_CODE

# 3. Échanger code contre token
echo ""
echo "🔄 Échange du code contre un token..."
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:3001/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "client_id=test-client" \
  -d "code_verifier=$CODE_VERIFIER")

echo "📦 Response: $TOKEN_RESPONSE"
ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.access_token')
echo ""
echo "✅ Access Token: $ACCESS_TOKEN"
```

## Étape 4: Tester le serveur MCP avec le token

### 4.1 Vérifier que OAuth bloque sans token

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }'
```

Vous devriez recevoir une erreur 401:
```json
{
  "error": "unauthorized",
  "error_description": "Valid Bearer token required for access"
}
```

### 4.2 Tester avec le token OAuth

```bash
# Remplacer YOUR_TOKEN par le token obtenu à l'étape 3
ACCESS_TOKEN="YOUR_TOKEN"

# 1. Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }' | jq
```

### 4.3 Lister les outils disponibles

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | jq
```

### 4.4 Appeler un outil (recherche web)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_web",
      "arguments": {
        "query": "MCP protocol",
        "engines": ["duckduckgo"],
        "maxResults": 5
      }
    }
  }' | jq
```

## Étape 5: Introspection de token (pour les Resource Servers)

Le serveur OAuth expose un endpoint d'introspection pour valider les tokens:

```bash
curl -X POST http://localhost:3001/introspect \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ACCESS_TOKEN\"}" | jq
```

Résultat attendu:
```json
{
  "active": true,
  "client_id": "test-client",
  "scope": "mcp:tools",
  "exp": 1234567890,
  "aud": "http://localhost:3000"
}
```

## Étape 6: Tester sans OAuth (mode désactivé)

Pour tester sans OAuth:

```bash
# Arrêter les serveurs
# Modifier server-mcp-stateless.ts ou utiliser variable d'env
OAUTH_ENABLED=false npm run start:mcp-stateless
```

Puis tester directement sans token:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq
```

## Variables d'environnement pour configuration

```bash
# OAuth Server
export OAUTH_PORT=3001
export OAUTH_BASE_URL=http://localhost:3001
export MCP_BASE_URL=http://localhost:3000
export STRICT_RESOURCE_VALIDATION=true

# MCP Server
export PORT=3000
export OAUTH_ENABLED=true
export OAUTH_SERVER_URL=http://localhost:3001
export RESOURCE_INDICATOR=http://localhost:3000
```

## Tester le serveur Stateful (avec sessions)

Le serveur stateful maintient les sessions entre les requêtes:

```bash
npm run start:mcp-stateful
```

Différences avec stateless:
- Utilise `MCP-Session-Id` header pour maintenir la session
- Supporte SSE via `GET /mcp` pour les notifications serveur
- Endpoint `DELETE /mcp` pour terminer la session

```bash
# Initialize et obtenir session ID
RESPONSE=$(curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
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

SESSION_ID=$(echo $RESPONSE | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# Réutiliser la session
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | jq
```

## Troubleshooting

### Token invalide ou expiré
```
Error: Token is not active (expired or revoked)
```
→ Générer un nouveau token via le flow OAuth

### Resource mismatch
```
Error: Token not valid for this resource
```
→ Vérifier que le paramètre `resource` dans l'autorisation correspond à `RESOURCE_INDICATOR`

### CORS errors
→ Le serveur MCP a CORS activé par défaut pour localhost

### OAuth server non accessible
```
Error: Failed to validate token
```
→ Vérifier que le serveur OAuth est bien démarré sur port 3001
