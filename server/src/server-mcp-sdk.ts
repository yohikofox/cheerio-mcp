/**
 * Web Search MCP Server - SDK Implementation
 *
 * This is a proper MCP server using the official @modelcontextprotocol/sdk
 * Unlike server-mcp-http.ts which manually implements the protocol,
 * this version uses the SDK's built-in transport layer.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomBytes } from "crypto";
import { z } from "zod";
import express, { Request, Response } from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import {
  searchGoogleWithPlaywright as searchGoogle,
  searchDuckDuckGoWithPlaywright as searchDuckDuckGo,
  searchBingWithPlaywright as searchBing,
} from "./searchEngines-playwright.js";
import {
  scrapeMultiplePagesWithPlaywright,
  scrapePageWithPlaywright,
  takeScreenshotWithPlaywright,
  estimateTokenCount,
} from "./scraper-playwright.js";
import {
  aggregateScrapedData,
  formatAggregatedDataAsYAML,
} from "./aggregator.js";
import { analyzePageStructure } from "./page-analyzer.js";
import {
  listDomainConfigs,
  loadDomainConfig,
  deleteDomainConfig,
  updateDomainConfig,
} from "./domain-config-manager.js";
import { downloadImage, imageToBase64 } from "./image-utils.js";
import { authMiddleware } from "./middleware/auth.js";
import { corsMiddleware } from "./middleware/cors.js";

const PORT = process.env.PORT || 3000;

// Create Express app
const app = express();
app.use(express.json());
app.use(corsMiddleware);
app.use(authMiddleware);

// Create MCP Server instance
const server = new Server(
  {
    name: "web-search-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Session storage for StreamableHTTP transport
const sessions = new Map<string, any>();

// Generate cryptographically secure session ID
function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

// ============================================================================
// Tool Definitions using SDK
// ============================================================================

// search_web tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search_web",
          description:
            "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed domains (e.g., fnac.com, cdiscount.com).",
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
                description:
                  "Optional: Exclude results from these domains",
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

// Handle tool calls
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

              // Filter results
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

          const screenshot = await takeScreenshotWithPlaywright(url, { fullPage });

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

// ============================================================================
// HTTP Endpoint Handler for StreamableHTTP Transport
// ============================================================================

// MCP endpoint - handles both GET and POST
app.all("/mcp", async (req: Request, res: Response) => {
  // Create transport for this request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: generateSessionId,
    onsessioninitialized: async (sessionId) => {
      console.log(`Session initialized: ${sessionId}`);
      sessions.set(sessionId, { createdAt: Date.now() });
    },
    onsessionclosed: async (sessionId) => {
      console.log(`Session closed: ${sessionId}`);
      sessions.delete(sessionId);
    },
  });

  // Handle the HTTP request with the transport
  await transport.handleRequest(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    server
  );
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  sessions.forEach((session, sessionId) => {
    if (session.clients && session.clients.size === 0) {
      // Could add timestamp-based cleanup here
    }
  });
}, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`✓ MCP Server (SDK) running on port ${PORT}`);
  console.log(`✓ Protocol: MCP 2025-06-18 (Streamable HTTP)`);
  console.log(`✓ Using official @modelcontextprotocol/sdk`);
  console.log(`\nEndpoints:`);
  console.log(`  POST/GET /mcp - MCP endpoint`);
  console.log(`  GET /health - Health check`);
});
