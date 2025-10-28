# OAuth 2.1 Setup Guide

Ce guide explique comment configurer l'authentification OAuth 2.1 pour les serveurs MCP, conformément à la spec officielle :
https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Option 1 : Demo Provider (Développement)](#option-1--demo-provider-développement)
- [Option 2 : Keycloak Provider (Production)](#option-2--keycloak-provider-production)
- [Configuration du MCP Server](#configuration-du-mcp-server)
- [Flow OAuth 2.1](#flow-oauth-21)
- [Troubleshooting](#troubleshooting)

## Vue d'ensemble

Le projet supporte deux types de OAuth providers :

| Provider | Usage | Avantages | Inconvénients |
|----------|-------|-----------|---------------|
| **DemoInMemoryAuthProvider** | Développement, tests | Simple, rapide | Pas de persistence, pas de scalabilité |
| **KeycloakOAuthProvider** | Production | Robuste, scalable, features complètes | Nécessite serveur Keycloak |

## Option 1 : Demo Provider (Développement)

### Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  MCP Client     │────────>│  OAuth Server   │<────────│  MCP Server     │
│  (Browser/App)  │         │  (Port 3001)    │         │  (Port 3000)    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                    │
                                    ▼
                          DemoInMemoryAuthProvider
                          (In-memory tokens/codes)
```

### 1. Démarrage

```bash
# Terminal 1 : Authorization Server
npm run start:oauth-server

# Terminal 2 : MCP Server (Stateless ou Stateful)
npm run start:mcp-stateless
# OU
npm run start:mcp-stateful
```

### 2. Client pré-enregistré

Le Demo Provider crée automatiquement un client de test :

```json
{
  "clientId": "demo-client",
  "clientSecret": "demo-secret",
  "redirectUris": ["http://localhost:8080/oauth/callback"]
}
```

### 3. Flow OAuth complet

#### Étape 1 : Demande d'authorization

Le client redirige l'utilisateur vers :

```
GET http://localhost:3001/oauth/authorize?
  response_type=code&
  client_id=demo-client&
  redirect_uri=http://localhost:8080/oauth/callback&
  code_challenge=XXXX&
  code_challenge_method=S256&
  resource=http://localhost:3000
```

**Paramètres :**
- `code_challenge` : SHA-256 hash du code_verifier (PKCE)
- `resource` : Resource indicator (RFC 8707) - URL du MCP server

#### Étape 2 : User consent (simulé en dev)

En production réelle, l'utilisateur verrait une page de login/consent ici.
Le Demo Provider skip cette étape et redirige directement.

#### Étape 3 : Redirect avec authorization code

```
HTTP/1.1 302 Found
Location: http://localhost:8080/oauth/callback?code=XXXX
```

#### Étape 4 : Exchange code for token

Le client envoie :

```bash
POST http://localhost:3001/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=XXXX&
client_id=demo-client&
redirect_uri=http://localhost:8080/oauth/callback&
code_verifier=YYYY
```

**Response :**

```json
{
  "access_token": "ZZZZ",
  "token_type": "Bearer",
  "expires_in": 3600,
  "resource": "http://localhost:3000"
}
```

#### Étape 5 : Utiliser le token

```bash
POST http://localhost:3000/mcp
Authorization: Bearer ZZZZ
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### 4. Variables d'environnement (Demo)

```bash
# OAuth Server (Port 3001)
OAUTH_PORT=3001
OAUTH_BASE_URL=http://localhost:3001
STRICT_RESOURCE_VALIDATION=true

# MCP Server (Port 3000)
PORT=3000
OAUTH_ENABLED=true
OAUTH_SERVER_URL=http://localhost:3001
RESOURCE_INDICATOR=http://localhost:3000
```

### 5. Endpoints disponibles

**Authorization Server (Port 3001) :**

```
GET  /.well-known/oauth-authorization-server
     - OAuth server metadata

GET  /oauth/authorize
     - Authorization endpoint

POST /oauth/token
     - Token issuance endpoint

POST /introspect
     - Token introspection (for resource servers)

GET  /debug/clients
     - List registered clients (DEBUG ONLY)

GET  /health
     - Health check
```

## Option 2 : Keycloak Provider (Production)

### Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  MCP Client     │────────>│  Keycloak       │         │  MCP Server     │
│  (Browser/App)  │         │  (Port 8080)    │         │  (Port 3000)    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                    ▲                            │
                                    │                            ▼
                                    │                   KeycloakOAuthProvider
                                    └────────────────────────────┘
                                    (Token introspection)
```

### 1. Configuration Keycloak

#### Créer un Realm

```bash
# Via Keycloak Admin Console
1. Login: http://keycloak:8080/admin
2. Create Realm: "mcp-realm"
```

#### Créer le Client pour MCP Server

```json
{
  "clientId": "mcp-server",
  "name": "MCP Resource Server",
  "protocol": "openid-connect",
  "publicClient": false,
  "serviceAccountsEnabled": true,
  "authorizationServicesEnabled": true,
  "standardFlowEnabled": false,
  "directAccessGrantsEnabled": false
}
```

**Important:** Ce client est utilisé par le MCP server pour faire l'introspection de tokens.

#### Créer un Client pour les applications clientes

```json
{
  "clientId": "mcp-client-app",
  "name": "MCP Client Application",
  "protocol": "openid-connect",
  "publicClient": false,
  "standardFlowEnabled": true,
  "redirectUris": [
    "http://localhost:8080/oauth/callback",
    "https://example.com/oauth/callback"
  ]
}
```

**Générer un secret pour ce client.**

#### Configurer les scopes

Créer un scope "mcp:access" :

```bash
# Dans Keycloak Admin Console
1. Realm → Client Scopes → Create
2. Name: mcp:access
3. Protocol: openid-connect
4. Type: Default
```

Ajouter ce scope aux clients.

### 2. Variables d'environnement (Keycloak)

```bash
# Keycloak Configuration
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=mcp-realm
KEYCLOAK_CLIENT_ID=mcp-server
KEYCLOAK_CLIENT_SECRET=your-secret-here
KEYCLOAK_STRICT_RESOURCE_VALIDATION=true

# MCP Server
PORT=3000
OAUTH_ENABLED=true
OAUTH_PROVIDER=keycloak  # Important !
RESOURCE_INDICATOR=https://mcp.example.com
```

### 3. Code d'utilisation (Keycloak)

**server-mcp-stateless.ts ou server-mcp-stateful.ts :**

```typescript
import {
  DemoInMemoryAuthProvider,
  DemoInMemoryClientsStore,
} from "./oauth/oauth-provider.js";
import {
  KeycloakOAuthProvider,
  createKeycloakProviderFromEnv,
} from "./oauth/oauth-keycloak-provider.js";
import { oauthMiddleware } from "./oauth/oauth-middleware.js";

const OAUTH_PROVIDER = process.env.OAUTH_PROVIDER || "demo";

let authProvider;
let authServerMetadataUrl;

if (OAUTH_PROVIDER === "keycloak") {
  // Keycloak Provider
  authProvider = createKeycloakProviderFromEnv();

  const keycloakUrl = process.env.KEYCLOAK_URL!;
  const realm = process.env.KEYCLOAK_REALM!;
  authServerMetadataUrl = `${keycloakUrl}/realms/${realm}/.well-known/openid-configuration`;
} else {
  // Demo Provider
  const clientsStore = new DemoInMemoryClientsStore();
  authProvider = new DemoInMemoryAuthProvider(clientsStore);
  authServerMetadataUrl = `${OAUTH_SERVER_URL}/.well-known/oauth-authorization-server`;
}

app.use(
  oauthMiddleware({
    authProvider,
    resource: RESOURCE_INDICATOR,
    authServerMetadataUrl,
    excludedPaths: ["/health"],
  })
);
```

### 4. Flow OAuth avec Keycloak

Le flow est identique au Demo Provider, mais :

1. **Authorization URL** : `http://keycloak:8080/realms/mcp-realm/protocol/openid-connect/auth`
2. **Token URL** : `http://keycloak:8080/realms/mcp-realm/protocol/openid-connect/token`
3. **Introspection** : Le MCP server appelle Keycloak pour valider chaque token

**Avantages :**
- ✅ Tokens persistés en base
- ✅ Refresh tokens
- ✅ User management
- ✅ Multi-factor authentication
- ✅ Fine-grained permissions (scopes, roles)
- ✅ Session management
- ✅ Audit logs

## Configuration du MCP Server

### Stateless Server

```bash
# Sans OAuth (dev rapide)
OAUTH_ENABLED=false npm run start:mcp-stateless

# Avec Demo Provider
OAUTH_ENABLED=true \
OAUTH_PROVIDER=demo \
OAUTH_SERVER_URL=http://localhost:3001 \
RESOURCE_INDICATOR=http://localhost:3000 \
npm run start:mcp-stateless

# Avec Keycloak
OAUTH_ENABLED=true \
OAUTH_PROVIDER=keycloak \
KEYCLOAK_URL=http://keycloak:8080 \
KEYCLOAK_REALM=mcp-realm \
KEYCLOAK_CLIENT_ID=mcp-server \
KEYCLOAK_CLIENT_SECRET=secret \
RESOURCE_INDICATOR=https://mcp.example.com \
npm run start:mcp-stateless
```

### Stateful Server

```bash
# Sans OAuth
OAUTH_ENABLED=false npm run start:mcp-stateful

# Avec Demo Provider
OAUTH_ENABLED=true \
OAUTH_PROVIDER=demo \
OAUTH_SERVER_URL=http://localhost:3001 \
RESOURCE_INDICATOR=http://localhost:3000 \
npm run start:mcp-stateful

# Avec Keycloak
OAUTH_ENABLED=true \
OAUTH_PROVIDER=keycloak \
KEYCLOAK_URL=http://keycloak:8080 \
KEYCLOAK_REALM=mcp-realm \
KEYCLOAK_CLIENT_ID=mcp-server \
KEYCLOAK_CLIENT_SECRET=secret \
RESOURCE_INDICATOR=https://mcp.example.com \
npm run start:mcp-stateful
```

## Flow OAuth 2.1

### 1. Client demande accès (401 Response)

```bash
POST http://localhost:3000/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Response :**

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="MCP Server",
  as_uri="http://localhost:3001/.well-known/oauth-authorization-server",
  resource="http://localhost:3000"

{
  "error": "unauthorized",
  "error_description": "Valid Bearer token required for access"
}
```

### 2. Client récupère metadata

```bash
GET http://localhost:3001/.well-known/oauth-authorization-server
```

**Response :**

```json
{
  "issuer": "http://localhost:3001",
  "authorization_endpoint": "http://localhost:3001/oauth/authorize",
  "token_endpoint": "http://localhost:3001/oauth/token",
  "token_introspection_endpoint": "http://localhost:3001/introspect",
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code"]
}
```

### 3. Client initie le flow

Voir sections Demo ou Keycloak ci-dessus pour le flow complet.

### 4. Client utilise le token

```bash
POST http://localhost:3000/mcp
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Success :**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [...]
  }
}
```

## Troubleshooting

### Token invalide

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="MCP Server",
  as_uri="...",
  resource="...",
  error="invalid_token",
  error_description="Token is invalid or expired"
```

**Solutions :**
- Vérifier que le token n'est pas expiré (< 1 heure)
- Vérifier que le resource indicator correspond
- Demander un nouveau token

### Resource mismatch

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="MCP Server",
  ...,
  error="invalid_token",
  error_description="Token not valid for this resource"
```

**Solution :**
- Le token a été émis pour un autre resource indicator
- Demander un nouveau token avec le bon `resource` parameter

### Keycloak unreachable

```json
{
  "error": "server_error",
  "error_description": "Failed to validate token"
}
```

**Vérifications :**
```bash
# Health check Keycloak
curl http://keycloak:8080/realms/mcp-realm/.well-known/openid-configuration

# Vérifier les variables d'environnement
echo $KEYCLOAK_URL
echo $KEYCLOAK_REALM
echo $KEYCLOAK_CLIENT_ID
```

### Debug mode

Activer les logs détaillés :

```bash
LOG_LEVEL=debug npm run start:mcp-stateless
```

Les logs montreront :
- Token validation attempts
- Keycloak introspection calls
- Resource indicator checks
- Session management (stateful mode)

## Sécurité en Production

### ⚠️ Ne JAMAIS en production

1. Utiliser `DemoInMemoryAuthProvider`
2. Exposer `/debug/clients` endpoint
3. Hardcoder des secrets dans le code
4. Utiliser HTTP (non-HTTPS) pour OAuth endpoints
5. Désactiver `strictResourceValidation`

### ✅ Recommandations production

1. Utiliser Keycloak (ou autre IdP robuste)
2. HTTPS obligatoire pour tous les endpoints OAuth
3. Resource indicators (RFC 8707) activés
4. Short-lived tokens (< 1 heure)
5. Refresh tokens pour renouvellement
6. Rate limiting sur les endpoints OAuth
7. Audit logs activés
8. Secrets dans variables d'environnement/vault
9. Network policies (Keycloak ↔ MCP Server only)
10. Token introspection cachée (TTL court)

## Références

- MCP Authorization Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- OAuth 2.1: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1
- RFC 7636 (PKCE): https://datatracker.ietf.org/doc/html/rfc7636
- RFC 8707 (Resource Indicators): https://datatracker.ietf.org/doc/html/rfc8707
- Keycloak Docs: https://www.keycloak.org/documentation
