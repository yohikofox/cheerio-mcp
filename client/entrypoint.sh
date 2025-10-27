#!/bin/sh
set -e

# Generate runtime config from environment variables
cat > /usr/share/nginx/html/config.js << EOF
window.ENV = {
  MCP_SERVER_URL: "${MCP_SERVER_URL:-http://localhost:3000}"
};
EOF

echo "Generated config.js with MCP_SERVER_URL=${MCP_SERVER_URL:-http://localhost:3000}"

# Start nginx
exec nginx -g "daemon off;"
