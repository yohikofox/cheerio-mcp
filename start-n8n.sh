#!/bin/bash

# Script pour démarrer n8n avec MCP Server
# Usage: ./start-n8n.sh [start|stop|restart|logs|status]

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ACTION=${1:-start}

case "$ACTION" in
  start)
    echo -e "${GREEN}🚀 Démarrage de n8n...${NC}"
    docker-compose up -d n8n

    echo ""
    echo -e "${GREEN}✅ n8n démarré avec succès!${NC}"
    echo ""
    echo "📋 Informations:"
    echo "   - Interface Web: http://localhost:5678"
    echo "   - Username: admin"
    echo "   - Password: changeme"
    echo ""
    echo "🔗 MCP Server URL (depuis n8n):"
    echo "   http://mcp-server:3000"
    echo ""
    echo "💡 Commandes utiles:"
    echo "   ./start-n8n.sh logs    # Voir les logs"
    echo "   ./start-n8n.sh stop    # Arrêter n8n"
    echo "   ./start-n8n.sh restart # Redémarrer n8n"
    echo ""
    ;;

  stop)
    echo -e "${YELLOW}🛑 Arrêt de n8n...${NC}"
    docker-compose stop n8n
    echo -e "${GREEN}✅ n8n arrêté${NC}"
    ;;

  restart)
    echo -e "${YELLOW}🔄 Redémarrage de n8n...${NC}"
    docker-compose restart n8n
    echo -e "${GREEN}✅ n8n redémarré${NC}"
    ;;

  logs)
    echo -e "${GREEN}📋 Logs n8n (Ctrl+C pour quitter):${NC}"
    docker-compose logs -f n8n
    ;;

  status)
    echo -e "${GREEN}📊 Status des services:${NC}"
    docker-compose ps
    ;;

  clean)
    echo -e "${RED}⚠️  Attention: Cette commande va supprimer TOUTES les données n8n (workflows, credentials)!${NC}"
    read -p "Êtes-vous sûr? (yes/no): " confirm
    if [ "$confirm" == "yes" ]; then
      echo -e "${YELLOW}🗑️  Suppression des données n8n...${NC}"
      docker-compose down n8n
      docker volume rm cheerio-mcp_n8n-data 2>/dev/null || true
      echo -e "${GREEN}✅ Données supprimées${NC}"
    else
      echo "Annulé"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|logs|status|clean}"
    echo ""
    echo "  start   - Démarrer n8n"
    echo "  stop    - Arrêter n8n"
    echo "  restart - Redémarrer n8n"
    echo "  logs    - Voir les logs en temps réel"
    echo "  status  - Voir le status des containers"
    echo "  clean   - Supprimer toutes les données n8n (workflows, credentials)"
    exit 1
    ;;
esac
