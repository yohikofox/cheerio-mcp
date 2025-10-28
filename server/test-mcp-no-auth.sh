#!/bin/bash

# Test MCP Server SANS OAuth (mode désactivé)
# Usage: OAUTH_ENABLED=false npm run start:mcp-stateless
# Puis: ./test-mcp-no-auth.sh

set -e

MCP_SERVER="http://localhost:3000"

echo "🧪 Test MCP Server (sans OAuth)"
echo "================================"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Vérifier que le serveur est accessible
echo "📡 Vérification du serveur MCP..."
if ! curl -s "$MCP_SERVER/health" > /dev/null 2>&1; then
    echo -e "${RED}❌ MCP Server non accessible sur $MCP_SERVER${NC}"
    echo ""
    echo "Démarrez-le avec:"
    echo "  OAUTH_ENABLED=false npm run start:mcp-stateless"
    exit 1
fi
echo -e "${GREEN}✓${NC} MCP Server accessible"
echo ""

# Test 1: Initialize
echo "1️⃣  Initialize..."
INIT_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
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
    exit 1
fi
echo ""

# Test 2: List tools
echo "2️⃣  List tools..."
TOOLS_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }')

TOOLS_COUNT=$(echo "$TOOLS_RESPONSE" | jq '.result.tools | length')
echo -e "${GREEN}✓${NC} $TOOLS_COUNT outils disponibles:"
echo "$TOOLS_RESPONSE" | jq -r '.result.tools[] | "   - \(.name): \(.description)"'
echo ""

# Test 3: Search web
echo "3️⃣  Test search_web..."
SEARCH_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_web",
      "arguments": {
        "query": "MCP protocol",
        "engines": ["duckduckgo"],
        "maxResults": 3
      }
    }
  }')

if echo "$SEARCH_RESPONSE" | jq -e '.result' > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Recherche OK"
    echo "   Résultats:"
    echo "$SEARCH_RESPONSE" | jq -r '.result.content[0].text | fromjson | .[] | "   - \(.title)"'
else
    echo -e "${YELLOW}⚠${NC}  Recherche échouée (peut nécessiter Playwright)"
    echo "$SEARCH_RESPONSE" | jq '.error'
fi
echo ""

# Test 4: Scrape page
echo "4️⃣  Test scrape_page..."
SCRAPE_RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "scrape_page",
      "arguments": {
        "url": "https://example.com",
        "format": "json",
        "flatten": false
      }
    }
  }')

if echo "$SCRAPE_RESPONSE" | jq -e '.result' > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Scraping OK"
    echo "   Data extraite:"
    echo "$SCRAPE_RESPONSE" | jq -r '.result.content[0].text | fromjson | .data[:2] | .[] | "   - \(.value)"'
else
    echo -e "${YELLOW}⚠${NC}  Scraping échoué (peut nécessiter Playwright)"
    echo "$SCRAPE_RESPONSE" | jq '.error'
fi
echo ""

# Résumé
echo "================================"
echo -e "${GREEN}✅ Tests terminés!${NC}"
echo ""
echo "💡 Exemples de commandes curl:"
echo ""
echo "# Lister les outils"
echo "curl -X POST $MCP_SERVER/mcp \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}' | jq"
echo ""
echo "# Rechercher sur le web"
echo "curl -X POST $MCP_SERVER/mcp \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"search_web\",\"arguments\":{\"query\":\"test\",\"engines\":[\"duckduckgo\"],\"maxResults\":5}}}' | jq"
echo ""
