/**
 * Web Search MCP Server - Stateless n8n-compatible Implementation
 *
 * This server uses the new McpServer API with registerTool() and is optimized
 * for n8n integration with enableJsonResponse: true
 *
 * Features:
 * - Stateless operation (no sessions)
 * - JSON responses instead of SSE (better n8n compatibility)
 * - All 5 tools: search_web, scrape_page, scrape_multiple_pages, take_screenshot, analyze_page_structure
 */

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "web-search-mcp",
  version: "1.0.0"
});

// ============================================================================
// Tool 1: search_web
// ============================================================================

server.registerTool(
  "search_web",
  {
    title: "Web Search",
    description: "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed/excluded domains.",
    inputSchema: {
      query: z.string(),
      maxResults: z.number().default(10),
      excludedDomains: z.string().default("fnac.com,darty.com,idealo.fr,.cz"),
    },
  },
  async ({ query, maxResults, excludedDomains }) => {
    try {
      const results = (await searchDuckDuckGo(query, maxResults)).results;

      // Convert comma-separated string to array
      const excludedDomainsArray = excludedDomains
        ? excludedDomains.split(',').map((d: string) => d.trim()).filter((d: string) => d.length > 0)
        : [];

      // Apply exclusions
      const filteredResults = excludedDomainsArray.length > 0
        ? results.filter((r: any) => !excludedDomainsArray.some((domain: string) => r.url.includes(domain)))
        : results;

      return {
        content: [{ type: "text", text: JSON.stringify(filteredResults, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Tool 2: scrape_page
// ============================================================================

server.registerTool(
  "scrape_page",
  {
    title: "Scrape Page",
    description: "Extract structured data from a web page using Playwright - Returns YAML/JSON format",
    inputSchema: {
      url: z.string(),
      format: z.string().default("yaml"),
      flatten: z.boolean().default(true),
    },
  },
  async ({ url, format, flatten }) => {
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
      content: [{ type: "text", text: outputText }],
    };
  }
);

// ============================================================================
// Tool 3: scrape_multiple_pages
// ============================================================================

server.registerTool(
  "scrape_multiple_pages",
  {
    title: "Scrape Multiple Pages",
    description: "Extract structured data from multiple web pages in parallel using Playwright",
    inputSchema: {
      urls: z.array(z.string()),
      format: z.string().default("yaml"),
      flatten: z.boolean().default(true),
    },
  },
  async ({ urls, format, flatten }) => {
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
      content: [{ type: "text", text: outputText }],
    };
  }
);

// ============================================================================
// Tool 4: take_screenshot
// ============================================================================

server.registerTool(
  "take_screenshot",
  {
    title: "Take Screenshot",
    description: "Take a screenshot of a web page using Playwright and return it as base64",
    inputSchema: {
      url: z.string(),
      fullPage: z.boolean().default(false),
    },
  },
  async ({ url, fullPage }) => {
    const result = await takeScreenshotWithPlaywright(url, { fullPage });
    const base64Screenshot = result.screenshot.toString('base64');

    return {
      content: [
        {
          type: "image",
          data: base64Screenshot,
          mimeType: "image/png",
        },
      ],
    };
  }
);

// ============================================================================
// Tool 5: analyze_page_structure
// ============================================================================

server.registerTool(
  "analyze_page_structure",
  {
    title: "Analyze Page Structure",
    description: "Analyze the structure and common patterns of a web page",
    inputSchema: {
      url: z.string(),
    },
  },
  async ({ url }) => {
    const analysis = await analyzePageStructure(url);

    return {
      content: [{ type: "text", text: JSON.stringify(analysis, null, 2) }],
    };
  }
);

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "web-search-mcp",
    mode: "stateless",
  });
});

// ============================================================================
// MCP Endpoint - Stateless with JSON Response
// ============================================================================

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,       // JSON instead of SSE (n8n compatible)
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`✓ MCP Server running on http://localhost:${PORT}/mcp`);
  console.log("✓ Mode: Stateless (n8n-compatible)");
  console.log("✓ Response format: JSON");
  console.log("");
  console.log("Tools available:");
  console.log("  1. search_web - Multi-engine web search");
  console.log("  2. scrape_page - Extract data from web page");
  console.log("  3. scrape_multiple_pages - Parallel page scraping");
  console.log("  4. take_screenshot - Capture page screenshots");
  console.log("  5. analyze_page_structure - Analyze page structure");
});
