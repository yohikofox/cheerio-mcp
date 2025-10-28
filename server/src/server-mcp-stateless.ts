/**
 * Web Search MCP Server - Stateless Implementation
 *
 * This is a stateless MCP server using the official @modelcontextprotocol/sdk
 * following the recommended pattern from simpleStatelessStreamableHttp.ts
 *
 * Features:
 * - Stateless operation (new server instance per request)
 * - OAuth 2.1 authentication (MCP-compliant)
 * - Streamable HTTP transport (2025-06-18 spec)
 * - Web search, scraping, screenshots
 *
 * Usage:
 * ```bash
 * npm run start:mcp-stateless
 * ```
 *
 * Architecture:
 * - Each HTTP request creates a new MCP server and transport
 * - No session state maintained between requests
 * - Auto-cleanup after response completes
 * - Ideal for simple, independent operations
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
 * Called for each request in stateless mode.
 */
function getServer(): Server {
  const server = new Server(
    {
      name: "web-search-mcp-stateless",
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
// MCP Endpoint - Stateless Pattern
// ============================================================================

/**
 * POST /mcp - Stateless MCP endpoint
 *
 * Pattern from simpleStatelessStreamableHttp.ts:
 * 1. Create new transport with sessionIdGenerator: undefined
 * 2. Create new server via getServer()
 * 3. Connect transport and server
 * 4. Handle request via transport
 * 5. Cleanup on response close
 */
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    // Create new stateless transport (sessionIdGenerator: undefined)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Create new server instance
    const server = getServer();

    // Connect transport and server
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);

    // Cleanup when response closes
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error: any) {
    console.error("MCP request error:", error);
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

// GET and DELETE not supported in stateless mode
app.get("/mcp", (req: Request, res: Response) => {
  res.status(405).json({
    error: "method_not_allowed",
    message: "Stateless server only supports POST requests",
  });
});

app.delete("/mcp", (req: Request, res: Response) => {
  res.status(405).json({
    error: "method_not_allowed",
    message: "Stateless server does not support session termination",
  });
});

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "mcp-stateless",
    oauth: OAUTH_ENABLED,
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`✓ MCP Server (Stateless) running on port ${PORT}`);
  console.log(`✓ Protocol: MCP 2025-06-18 (Streamable HTTP)`);
  console.log(`✓ Using official @modelcontextprotocol/sdk`);
  console.log(`✓ Mode: Stateless (new server per request)`);
  console.log(`✓ OAuth 2.1: ${OAUTH_ENABLED ? "Enabled" : "Disabled"}`);
  if (OAUTH_ENABLED) {
    console.log(`✓ OAuth Server: ${OAUTH_SERVER_URL}`);
    console.log(`✓ Resource Indicator: ${RESOURCE_INDICATOR}`);
  }
  console.log("");
  console.log("Endpoints:");
  console.log(`  POST http://localhost:${PORT}/mcp - MCP endpoint`);
  console.log(`  GET  http://localhost:${PORT}/health - Health check`);
  console.log("");
  console.log("Tools:");
  console.log("  - search_web: Multi-engine web search");
  console.log("  - scrape_page: Extract data from web page");
  console.log("  - scrape_multiple_pages: Parallel page scraping");
  console.log("  - take_screenshot: Capture page screenshots");
  console.log("  - analyze_page_structure: Analyze page structure");
});
