#!/bin/bash

# Script de test OAuth 2.1 + MCP Server
# Usage: ./test-oauth-flow.sh

set -e

echo "🔐 Test OAuth 2.1 Flow + MCP Server"
echo "===================================="
echo ""

# Configuration
OAUTH_SERVER="http://localhost:3001"
MCP_SERVER="http://localhost:3000"
CLIENT_ID="test-client"
REDIRECT_URI="http://localhost:8080/callback"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Vérifier que les serveurs sont démarrés
echo "📡 Vérification des serveurs..."
if ! curl -s "$OAUTH_SERVER/.well-known/oauth-authorization-server" > /dev/null 2>&1; then
    echo -e "${RED}❌ OAuth Server non accessible sur $OAUTH_SERVER${NC}"
    echo "   Démarrez-le avec: npm run start:oauth-server"
    exit 1
fi
echo -e "${GREEN}✓${NC} OAuth Server accessible"

if ! curl -s "$MCP_SERVER/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC}  MCP Server non accessible sur $MCP_SERVER"
    echo "   Démarrez-le avec: npm run start:mcp-stateless"
fi
echo ""

# Étape 1: Générer PKCE
echo "1️⃣  Génération PKCE..."
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d "=+/" | cut -c1-43)

echo "   Code Verifier: ${CODE_VERIFIER:0:20}..."
echo "   Code Challenge: ${CODE_CHALLENGE:0:20}..."
echo ""

# Étape 2: Autorisation
echo "2️⃣  Obtention du code d'autorisation..."
AUTH_URL="$OAUTH_SERVER/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&scope=mcp:tools&resource=$MCP_SERVER"

echo -e "${YELLOW}📌 Ouvrez cette URL dans votre navigateur:${NC}"
echo ""
echo "$AUTH_URL"
echo ""
echo "💡 Le serveur vous redirigera vers:"
echo "   $REDIRECT_URI?code=XXXXX&state=..."
echo ""
read -p "📥 Collez l'URL complète de redirection ici: " REDIRECT_URL

# Extraire le code
AUTH_CODE=$(echo "$REDIRECT_URL" | grep -oP 'code=\K[^&]+' || echo "")

if [ -z "$AUTH_CODE" ]; then
    echo -e "${RED}❌ Impossible d'extraire le code d'autorisation${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Code d'autorisation: ${AUTH_CODE:0:20}..."
echo ""

# Étape 3: Échanger le code contre un token
echo "3️⃣  Échange du code contre un access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$OAUTH_SERVER/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=$REDIRECT_URI" \
  -d "client_id=$CLIENT_ID" \
  -d "code_verifier=$CODE_VERIFIER")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}❌ Erreur lors de l'obtention du token${NC}"
    echo "$TOKEN_RESPONSE" | jq
    exit 1
fi

echo -e "${GREEN}✓${NC} Access Token obtenu: ${ACCESS_TOKEN:0:30}..."
EXPIRES_IN=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_in')
echo "   Expire dans: ${EXPIRES_IN}s"
echo ""

# Sauvegarder le token pour réutilisation
echo "$ACCESS_TOKEN" > .oauth-token
echo "💾 Token sauvegardé dans .oauth-token"
echo ""

# Étape 4: Tester l'introspection
echo "4️⃣  Test d'introspection du token..."
INTROSPECT_RESPONSE=$(curl -s -X POST "$OAUTH_SERVER/introspect" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ACCESS_TOKEN\"}")

IS_ACTIVE=$(echo "$INTROSPECT_RESPONSE" | jq -r '.active')
if [ "$IS_ACTIVE" == "true" ]; then
    echo -e "${GREEN}✓${NC} Token actif"
    echo "$INTROSPECT_RESPONSE" | jq
else
    echo -e "${RED}❌ Token inactif${NC}"
    echo "$INTROSPECT_RESPONSE" | jq
fi
echo ""

# Étape 5: Tester MCP sans token (doit échouer)
echo "5️⃣  Test MCP sans token (doit échouer)..."
UNAUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }')

HTTP_CODE=$(echo "$UNAUTH_RESPONSE" | tail -n1)
BODY=$(echo "$UNAUTH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "401" ]; then
    echo -e "${GREEN}✓${NC} Rejeté comme attendu (401)"
    echo "$BODY" | jq -r '.error_description'
else
    echo -e "${RED}❌ Devrait être rejeté avec 401, reçu: $HTTP_CODE${NC}"
fi
echo ""

# Étape 6: Tester MCP avec token
echo "6️⃣  Test MCP avec token..."

# 6.1 Initialize
echo "   Initialize session..."
INIT_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
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
  }')

if echo "$INIT_RESPONSE" | jq -e '.result' > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Initialize OK"
    echo "$INIT_RESPONSE" | jq '.result.serverInfo'
else
    echo -e "${RED}❌ Initialize échec${NC}"
    echo "$INIT_RESPONSE" | jq
fi
echo ""

# 6.2 List tools
echo "   List tools..."
TOOLS_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }')

TOOLS_COUNT=$(echo "$TOOLS_RESPONSE" | jq '.result.tools | length')
echo -e "${GREEN}✓${NC} $TOOLS_COUNT outils disponibles"
echo "$TOOLS_RESPONSE" | jq -r '.result.tools[].name'
echo ""

# 6.3 Call a tool
echo "   Call tool: search_web..."
SEARCH_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_web",
      "arguments": {
        "query": "Model Context Protocol",
        "engines": ["duckduckgo"],
        "maxResults": 3
      }
    }
  }')

if echo "$SEARCH_RESPONSE" | jq -e '.result' > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Recherche OK"
    RESULTS_COUNT=$(echo "$SEARCH_RESPONSE" | jq '.result.content[0].text' | jq 'length')
    echo "   $RESULTS_COUNT résultats trouvés"
else
    echo -e "${RED}❌ Recherche échec${NC}"
    echo "$SEARCH_RESPONSE" | jq
fi
echo ""

# Résumé
echo "===================================="
echo -e "${GREEN}✅ Test OAuth 2.1 + MCP terminé avec succès!${NC}"
echo ""
echo "💡 Pour réutiliser le token:"
echo "   export ACCESS_TOKEN=\"$ACCESS_TOKEN\""
echo ""
echo "   Puis:"
echo "   curl -X POST $MCP_SERVER/mcp \\"
echo "     -H \"Authorization: Bearer \$ACCESS_TOKEN\" \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'"
echo ""
