#!/bin/sh
set -e

# Generate runtime config from environment variables
cat > /app/dist/config.js << EOF
window.ENV = {
  MCP_SERVER_URL: "${MCP_SERVER_URL:-http://localhost:3000}"
};
EOF

echo "Generated config.js with MCP_SERVER_URL=${MCP_SERVER_URL:-http://localhost:3000}"

# Start serve on port 8080
exec serve -s /app/dist -l 8080
