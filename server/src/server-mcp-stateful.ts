/**
 * Web Search MCP Server - Stateful Implementation
 *
 * This is a stateful MCP server using the official @modelcontextprotocol/sdk
 * following the recommended pattern from simpleStreamableHttp.ts and elicitationExample.ts
 *
 * Features:
 * - Stateful operation (maintains sessions between requests)
 * - OAuth 2.1 authentication (MCP-compliant)
 * - Streamable HTTP transport (2025-06-18 spec)
 * - SSE support for bidirectional communication
 * - Session management with cleanup
 * - Web search, scraping, screenshots
 *
 * Usage:
 * ```bash
 * npm run start:mcp-stateful
 * ```
 *
 * Architecture:
 * - POST /mcp: Send MCP requests (initialization + regular requests)
 * - GET /mcp: Establish SSE stream for receiving server notifications
 * - DELETE /mcp: Terminate session
 * - Sessions persist across multiple requests
 * - Ideal for workflows, agents, or elicitation scenarios
 */

import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import {
  searchGoogleWithPlaywright as searchGoogle,
  searchDuckDuckGoWithPlaywright as searchDuckDuckGo,
  searchBingWithPlaywright as searchBing,
} from "./searchEngines-playwright.js";
import {
  scrapeMultiplePagesWithPlaywright,
  scrapePageWithPlaywright,
  takeScreenshotWithPlaywright,
} from "./scraper-playwright.js";
import {
  aggregateScrapedData,
  formatAggregatedDataAsYAML,
} from "./aggregator.js";
import { analyzePageStructure } from "./page-analyzer.js";
import { corsMiddleware } from "./middleware/cors.js";
import {
  DemoInMemoryAuthProvider,
  DemoInMemoryClientsStore,
} from "./oauth/oauth-provider.js";
import { oauthMiddleware } from "./oauth/oauth-middleware.js";

const PORT = process.env.PORT || 3000;
const OAUTH_ENABLED = process.env.OAUTH_ENABLED !== "false";
const OAUTH_SERVER_URL =
  process.env.OAUTH_SERVER_URL || "http://localhost:3001";
const RESOURCE_INDICATOR =
  process.env.RESOURCE_INDICATOR || `http://localhost:${PORT}`;

// ============================================================================
// Server Factory Function
// ============================================================================

/**
 * Creates a new MCP Server instance with all tool handlers.
 * In stateful mode, this is called once per session initialization.
 */
function getServer(): Server {
  const server = new Server(
    {
      name: "web-search-mcp-stateful",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ============================================================================
  // Tool: search_web
  // ============================================================================

  server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_web",
            description:
              "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed domains.",
            inputSchema: {
              type: "object" as const,
              properties: {
                query: {
                  type: "string",
                  description: "The search query",
                },
                engines: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["google", "duckduckgo", "bing"],
                  },
                  description: "List of search engines to use",
                  default: ["duckduckgo"],
                },
                maxResults: {
                  type: "number",
                  description: "Maximum results per engine (1-10)",
                  default: 10,
                  minimum: 1,
                  maximum: 10,
                },
                allowedDomains: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                  description:
                    "Optional: Filter results to only include these domains",
                },
                excludedDomains: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                  description: "Optional: Exclude results from these domains",
                  default: ["fnac.com", "darty.com", "idealo.fr", ".cz"],
                },
              },
              required: ["query"],
            },
          },
          {
            name: "scrape_page",
            description:
              "Extract structured data from a web page using Playwright - Returns YAML/JSON format",
            inputSchema: {
              type: "object" as const,
              properties: {
                url: {
                  type: "string",
                  description: "The URL of the page to scrape",
                },
                format: {
                  type: "string",
                  enum: ["yaml", "json"],
                  description: "Output format",
                  default: "yaml",
                },
                flatten: {
                  type: "boolean",
                  description: "Flatten the data structure",
                  default: true,
                },
              },
              required: ["url"],
            },
          },
          {
            name: "scrape_multiple_pages",
            description:
              "Extract structured data from multiple web pages in parallel using Playwright",
            inputSchema: {
              type: "object" as const,
              properties: {
                urls: {
                  type: "array",
                  items: { type: "string" },
                  description: "Array of URLs to scrape",
                },
                format: {
                  type: "string",
                  enum: ["yaml", "json"],
                  description: "Output format",
                  default: "yaml",
                },
                flatten: {
                  type: "boolean",
                  description: "Flatten the data structure",
                  default: true,
                },
              },
              required: ["urls"],
            },
          },
          {
            name: "take_screenshot",
            description:
              "Take a screenshot of a web page using Playwright and return it as base64",
            inputSchema: {
              type: "object" as const,
              properties: {
                url: {
                  type: "string",
                  description: "The URL of the page to screenshot",
                },
                fullPage: {
                  type: "boolean",
                  description: "Capture the full scrollable page",
                  default: false,
                },
              },
              required: ["url"],
            },
          },
          {
            name: "analyze_page_structure",
            description:
              "Analyze the structure and common patterns of a web page",
            inputSchema: {
              type: "object" as const,
              properties: {
                url: {
                  type: "string",
                  description: "The URL to analyze",
                },
              },
              required: ["url"],
            },
          },
        ],
      };
    }
  );

  // ============================================================================
  // Tool Handler: tools/call
  // ============================================================================

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_web": {
            const {
              query,
              engines = ["duckduckgo"],
              maxResults = 10,
              allowedDomains,
              excludedDomains = ["fnac.com", "darty.com", "idealo.fr", ".cz"],
            } = args as {
              query: string;
              engines?: string[];
              maxResults?: number;
              allowedDomains?: string[];
              excludedDomains?: string[];
            };

            const allResults = [];

            for (const engine of engines) {
              let results: any[] = [];

              try {
                switch (engine) {
                  case "google":
                    results = (await searchGoogle(query, maxResults)).results;
                    break;
                  case "duckduckgo":
                    results = (await searchDuckDuckGo(query, maxResults)).results;
                    break;
                  case "bing":
                    results = (await searchBing(query, maxResults)).results;
                    break;
                }

                if (allowedDomains && allowedDomains.length > 0) {
                  results = results.filter((r) =>
                    allowedDomains.some((domain) => r.url.includes(domain))
                  );
                }

                if (excludedDomains && excludedDomains.length > 0) {
                  results = results.filter(
                    (r) =>
                      !excludedDomains.some((domain) => r.url.includes(domain))
                  );
                }

                allResults.push(...results);
              } catch (error: any) {
                console.error(`Error with ${engine}:`, error.message);
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(allResults, null, 2),
                },
              ],
            };
          }

          case "scrape_page": {
            const { url, format = "yaml", flatten = true } = args as {
              url: string;
              format?: string;
              flatten?: boolean;
            };

            const result = await scrapePageWithPlaywright(url);
            let outputText: string;

            if (flatten) {
              const aggregated = aggregateScrapedData([result]);
              outputText = format === "yaml"
                ? formatAggregatedDataAsYAML(aggregated.aggregatedData, aggregated.stats)
                : JSON.stringify(aggregated.aggregatedData, null, 2);
            } else {
              outputText = format === "yaml"
                ? (result.yaml || JSON.stringify(result.data, null, 2))
                : JSON.stringify(result.data, null, 2);
            }

            return {
              content: [
                {
                  type: "text",
                  text: outputText,
                },
              ],
            };
          }

          case "scrape_multiple_pages": {
            const { urls, format = "yaml", flatten = true } = args as {
              urls: string[];
              format?: string;
              flatten?: boolean;
            };

            const results = await scrapeMultiplePagesWithPlaywright(urls);
            let outputText: string;

            if (flatten) {
              const aggregated = aggregateScrapedData(results);
              outputText = format === "yaml"
                ? formatAggregatedDataAsYAML(aggregated.aggregatedData, aggregated.stats)
                : JSON.stringify(aggregated.aggregatedData, null, 2);
            } else {
              const scrapedData = results.map((r) => r.data).filter(Boolean);
              outputText = format === "yaml"
                ? JSON.stringify(scrapedData, null, 2)
                : JSON.stringify(scrapedData, null, 2);
            }

            return {
              content: [
                {
                  type: "text",
                  text: outputText,
                },
              ],
            };
          }

          case "take_screenshot": {
            const { url, fullPage = false } = args as {
              url: string;
              fullPage?: boolean;
            };

            const screenshot = await takeScreenshotWithPlaywright(
              url,
              { fullPage }
            );

            return {
              content: [
                {
                  type: "image",
                  data: screenshot,
                  mimeType: "image/png",
                },
              ],
            };
          }

          case "analyze_page_structure": {
            const { url } = args as { url: string };
            const analysis = await analyzePageStructure(url);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(analysis, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());
app.use(corsMiddleware);

// OAuth middleware (optional, can be disabled)
if (OAUTH_ENABLED) {
  const authProvider = new DemoInMemoryAuthProvider();

  app.use(
    oauthMiddleware({
      authProvider,
      resource: RESOURCE_INDICATOR,
      authServerMetadataUrl: `${OAUTH_SERVER_URL}/.well-known/oauth-authorization-server`,
      excludedPaths: ["/health"],
    })
  );
}

// ============================================================================
// Session Management
// ============================================================================

interface SessionData {
  transport: StreamableHTTPServerTransport;
  server: Server;
  createdAt: number;
}

const sessions: Map<string, SessionData> = new Map();

/**
 * Cleanup old sessions (idle for more than 1 hour)
 */
function cleanupIdleSessions() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > oneHour) {
      console.log(`Cleaning up idle session: ${sessionId}`);
      session.transport.close();
      session.server.close();
      sessions.delete(sessionId);
    }
  }
}

// Cleanup every 15 minutes
setInterval(cleanupIdleSessions, 15 * 60 * 1000);

// ============================================================================
// MCP Endpoints - Stateful Pattern
// ============================================================================

/**
 * POST /mcp - Handle MCP requests
 *
 * Pattern from simpleStreamableHttp.ts and elicitationExample.ts:
 * 1. Check for existing session via Mcp-Session-Id header
 * 2. If no session and initialize request: create new session
 * 3. If existing session: reuse transport
 * 4. Handle request via transport
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
  }

  try {
    let sessionData: SessionData;

    // Check if session exists
    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      sessionData = sessions.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session initialization
      const newSessionId = randomUUID();
      console.log(`Initializing new session: ${newSessionId}`);

      // Create transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sid) => {
          console.log(`Session initialized: ${sid}`);
        },
      });

      // Create server
      const server = getServer();

      // Setup cleanup on transport close
      transport.onclose = () => {
        console.log(`Transport closed for session ${newSessionId}`);
        if (sessions.has(newSessionId)) {
          sessions.delete(newSessionId);
        }
      };

      // Connect transport and server
      await server.connect(transport);

      // Store session
      sessionData = {
        transport,
        server,
        createdAt: Date.now(),
      };
      sessions.set(newSessionId, sessionData);

      // Handle initialization request
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Invalid: no session ID and not initialization request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle request with existing session
    await sessionData.transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

/**
 * GET /mcp - Establish SSE stream for server notifications
 *
 * Requires valid session ID in Mcp-Session-Id header
 */
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`Establishing SSE stream for session ${sessionId}`);

  const sessionData = sessions.get(sessionId)!;
  await sessionData.transport.handleRequest(req, res);
});

/**
 * DELETE /mcp - Terminate session
 *
 * Requires valid session ID in Mcp-Session-Id header
 */
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const sessionData = sessions.get(sessionId)!;
    await sessionData.transport.handleRequest(req, res);
  } catch (error: any) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "mcp-stateful",
    oauth: OAUTH_ENABLED,
    activeSessions: sessions.size,
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`✓ MCP Server (Stateful) running on port ${PORT}`);
  console.log(`✓ Protocol: MCP 2025-06-18 (Streamable HTTP)`);
  console.log(`✓ Using official @modelcontextprotocol/sdk`);
  console.log(`✓ Mode: Stateful (maintains sessions)`);
  console.log(`✓ OAuth 2.1: ${OAUTH_ENABLED ? "Enabled" : "Disabled"}`);
  if (OAUTH_ENABLED) {
    console.log(`✓ OAuth Server: ${OAUTH_SERVER_URL}`);
    console.log(`✓ Resource Indicator: ${RESOURCE_INDICATOR}`);
  }
  console.log("");
  console.log("Endpoints:");
  console.log(`  POST   http://localhost:${PORT}/mcp - MCP requests`);
  console.log(`  GET    http://localhost:${PORT}/mcp - SSE stream`);
  console.log(`  DELETE http://localhost:${PORT}/mcp - Terminate session`);
  console.log(`  GET    http://localhost:${PORT}/health - Health check`);
  console.log("");
  console.log("Tools:");
  console.log("  - search_web: Multi-engine web search");
  console.log("  - scrape_page: Extract data from web page");
  console.log("  - scrape_multiple_pages: Parallel page scraping");
  console.log("  - take_screenshot: Capture page screenshots");
  console.log("  - analyze_page_structure: Analyze page structure");
  console.log("");
  console.log(`Active sessions: ${sessions.size}`);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");

  // Close all active sessions
  for (const [sessionId, sessionData] of sessions.entries()) {
    try {
      console.log(`Closing session ${sessionId}`);
      await sessionData.transport.close();
      await sessionData.server.close();
    } catch (error: any) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  sessions.clear();
  console.log("Server shutdown complete");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down server...");

  for (const [sessionId, sessionData] of sessions.entries()) {
    try {
      await sessionData.transport.close();
      await sessionData.server.close();
    } catch (error: any) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  sessions.clear();
  process.exit(0);
});
