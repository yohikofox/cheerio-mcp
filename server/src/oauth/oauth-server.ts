/**
 * Standalone OAuth 2.1 Authorization Server for MCP
 *
 * This is a standalone authorization server that can run separately
 * from your MCP resource servers.
 *
 * Architecture:
 * - Port 3001: OAuth authorization server (this file)
 * - Port 3000: MCP resource server (server-mcp-stateless.ts or server-mcp-stateful.ts)
 *
 * Usage:
 * ```bash
 * npm run start:oauth-server
 * ```
 *
 * Environment Variables:
 * - OAUTH_PORT: Port for authorization server (default: 3001)
 * - OAUTH_BASE_URL: Base URL for this server (default: http://localhost:3001)
 * - STRICT_RESOURCE_VALIDATION: Enable strict resource validation (default: true)
 */

import { setupAuthServer } from "./oauth-provider.js";

const OAUTH_PORT = process.env.OAUTH_PORT
  ? parseInt(process.env.OAUTH_PORT, 10)
  : 3001;
const MCP_PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 3000;
const OAUTH_BASE_URL =
  process.env.OAUTH_BASE_URL || `http://localhost:${OAUTH_PORT}`;
const MCP_BASE_URL =
  process.env.MCP_BASE_URL || `http://localhost:${MCP_PORT}`;
const STRICT_RESOURCE_VALIDATION =
  process.env.STRICT_RESOURCE_VALIDATION !== "false";

async function main() {
  console.log("🔐 Starting MCP OAuth 2.1 Authorization Server...");
  console.log("");
  console.log("⚠️  DEMO IMPLEMENTATION - NOT FOR PRODUCTION");
  console.log("    Missing: persistent storage, rate limiting, etc.");
  console.log("");

  // Create and start authorization server
  // Note: setupAuthServer starts the Express server internally
  const oauthMetadata = setupAuthServer({
    authServerUrl: new URL(OAUTH_BASE_URL),
    mcpServerUrl: new URL(MCP_BASE_URL),
    strictResource: STRICT_RESOURCE_VALIDATION,
  });

  console.log(`✓ OAuth Authorization Server started`);
  console.log(`✓ Auth Server URL: ${OAUTH_BASE_URL}`);
  console.log(`✓ MCP Server URL: ${MCP_BASE_URL}`);
  console.log(`✓ Strict Resource Validation: ${STRICT_RESOURCE_VALIDATION}`);
  console.log("");
  console.log("Endpoints:");
  console.log(`  GET  ${OAUTH_BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`       - Authorization server metadata`);
  console.log("");
  console.log(`  GET  ${OAUTH_BASE_URL}/oauth/authorize`);
  console.log(`       - Authorization endpoint (OAuth 2.1)`);
  console.log("");
  console.log(`  POST ${OAUTH_BASE_URL}/oauth/token`);
  console.log(`       - Token issuance endpoint`);
  console.log("");
  console.log(`  POST ${OAUTH_BASE_URL}/introspect`);
  console.log(`       - Token introspection (for resource servers)`);
  console.log("");
  console.log("OAuth Flow:");
  console.log("  1. Client redirects user to /oauth/authorize");
  console.log("  2. User authorizes (in production: login page)");
  console.log("  3. Server redirects back with authorization code");
  console.log("  4. Client exchanges code for token at /oauth/token");
  console.log("  5. Client uses token in Authorization: Bearer header");

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down OAuth server...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Shutting down OAuth server...");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("❌ Failed to start OAuth server:", error);
  process.exit(1);
});
