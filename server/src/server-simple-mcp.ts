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
  version: "1.0.0",
});

// ============================================================================
// Tool 1: search_web
// ============================================================================

server.registerTool(
  "search_web",
  {
    title: "Web Search",
    description:
      "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed/excluded domains.",
    inputSchema: {
      query: z.string().describe("Search query"),
      maxResults: z.coerce
        .number()
        .default(10)
        .describe("Maximum number of results to return"),
      allowedDomains: z
        .string()
        .default("cdiscount.com")
        .describe(
          "Comma-separated list of ALLOWED domains (whitelist). If set, ONLY these domains are returned (e.g., 'apple.com,samsung.com')"
        ),
      excludedDomains: z
        .string()
        .default("fnac.com,darty.com,idealo,.cz,boulanger.com")
        .describe(
          "Comma-separated list of EXCLUDED domains (blacklist). Only used if allowedDomains is empty (e.g., 'fnac.com,darty.com')"
        ),
    },
  },
  async ({ query, maxResults, allowedDomains, excludedDomains }) => {
    try {
      const results = (await searchDuckDuckGo(query, maxResults)).results;

      let filteredResults = results;

      // Filter by allowedDomains (whitelist) if provided
      if (allowedDomains && allowedDomains.trim() !== "") {
        const allowedDomainsArray = allowedDomains
          .split(",")
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0);

        if (allowedDomainsArray.length > 0) {
          filteredResults = results.filter((r: any) =>
            allowedDomainsArray.some((domain: string) => r.url.includes(domain))
          );
        }
      } else {
        // Filter excluded domains (blacklist) - always include default domains + user provided
        const defaultExcluded = "fnac.com,darty.com,idealo,.cz,boulanger.com";
        const userExcluded = excludedDomains && excludedDomains.trim() !== "" ? excludedDomains : "";

        // Merge and deduplicate
        const allExcluded = userExcluded ? `${defaultExcluded},${userExcluded}` : defaultExcluded;
        const excludedDomainsArray = [...new Set(
          allExcluded
            .split(",")
            .map((d: string) => d.trim())
            .filter((d: string) => d.length > 0)
        )];

        if (excludedDomainsArray.length > 0) {
          filteredResults = results.filter(
            (r: any) =>
              !excludedDomainsArray.some((domain: string) =>
                r.url.includes(domain)
              )
          );
        }
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(filteredResults, null, 2) },
        ],
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
    description:
      "Extract structured data from a web page using Playwright - Returns YAML/JSON format",
    inputSchema: {
      url: z.string().describe("URL of the page to scrape"),
      format: z
        .string()
        .default("yaml")
        .describe("Output format: 'yaml' or 'json'"),
      flatten: z.coerce
        .boolean()
        .default(true)
        .describe("Flatten the data structure"),
    },
  },
  async ({ url, format, flatten }) => {
    const result = await scrapePageWithPlaywright(url);
    let outputText: string;

    if (flatten) {
      const aggregated = aggregateScrapedData([result]);
      outputText =
        format === "yaml"
          ? formatAggregatedDataAsYAML(
              aggregated.aggregatedData,
              aggregated.stats
            )
          : JSON.stringify(aggregated.aggregatedData, null, 2);
    } else {
      outputText =
        format === "yaml"
          ? result.yaml || JSON.stringify(result.data, null, 2)
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
    description:
      "Extract structured data from multiple web pages in parallel using Playwright",
    inputSchema: {
      urls: z
        .string()
        .describe(
          "Comma-separated list of URLs to scrape (e.g., 'https://example.com,https://example.org')"
        ),
      format: z
        .string()
        .default("yaml")
        .describe("Output format: 'yaml' or 'json'"),
      flatten: z.coerce
        .boolean()
        .default(true)
        .describe("Flatten the data structure"),
    },
  },
  async ({ urls, format, flatten }) => {
    // Convert comma-separated string to array
    const urlsArray = urls
      .split(",")
      .map((u: string) => u.trim())
      .filter((u: string) => u.length > 0);
    const results = await scrapeMultiplePagesWithPlaywright(urlsArray);
    let outputText: string;

    if (flatten) {
      const aggregated = aggregateScrapedData(results);
      outputText =
        format === "yaml"
          ? formatAggregatedDataAsYAML(
              aggregated.aggregatedData,
              aggregated.stats
            )
          : JSON.stringify(aggregated.aggregatedData, null, 2);
    } else {
      const scrapedData = results.map((r) => r.data).filter(Boolean);
      outputText =
        format === "yaml"
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
    description:
      "Take a screenshot of a web page using Playwright and return it as base64",
    inputSchema: {
      url: z.string().describe("URL of the page to screenshot"),
      fullPage: z.coerce
        .boolean()
        .default(false)
        .describe(
          "Capture full scrollable page (true) or just viewport (false)"
        ),
    },
  },
  async ({ url, fullPage }) => {
    const result = await takeScreenshotWithPlaywright(url, { fullPage });
    const base64Screenshot = result.screenshot.toString("base64");

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
// Tool 6: search_and_scrape
// ============================================================================

server.registerTool(
  "search_and_scrape",
  {
    title: "Search and Scrape",
    description:
      "Search the web and automatically scrape the top results - One-step solution for product data extraction",
    inputSchema: {
      query: z.string().describe("Search query (e.g., product name)"),
      maxResults: z.coerce
        .number()
        .default(5)
        .describe("Maximum number of search results"),
      pagesToScrape: z.coerce
        .number()
        .default(3)
        .describe("Number of top results to scrape (max 5)"),
      allowedDomains: z
        .string()
        .default("cdiscount.com")
        .describe(
          "Comma-separated list of ALLOWED domains (whitelist). If set, ONLY these domains are scraped (e.g., 'apple.com,samsung.com')"
        ),
      excludedDomains: z
        .string()
        .default("fnac.com,darty.com,idealo,.cz")
        .describe(
          "Comma-separated list of EXCLUDED domains (blacklist). Only used if allowedDomains is empty"
        ),
      format: z
        .string()
        .default("json")
        .describe("Output format: 'yaml' or 'json'"),
    },
  },
  async ({
    query,
    maxResults,
    pagesToScrape,
    allowedDomains,
    excludedDomains,
    format,
  }) => {
    try {
      // Apply defaults if values are invalid
      const safeMaxResults = maxResults && maxResults > 0 ? maxResults : 5;
      const safePagesToScrape =
        pagesToScrape && pagesToScrape > 0 ? Math.min(pagesToScrape, 5) : 3;

      // Step 1: Search
      const searchResults = (await searchDuckDuckGo(query, safeMaxResults))
        .results;

      let filteredResults = searchResults;

      // Filter by allowedDomains (whitelist) if provided
      if (allowedDomains && allowedDomains.trim() !== "") {
        const allowedDomainsArray = allowedDomains
          .split(",")
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0);

        if (allowedDomainsArray.length > 0) {
          filteredResults = searchResults.filter((r: any) =>
            allowedDomainsArray.some((domain: string) => r.url.includes(domain))
          );
        }
      } else {
        // Filter excluded domains (blacklist) - always include default domains + user provided
        const defaultExcluded = "fnac.com,darty.com,idealo,.cz,boulanger.com";
        const userExcluded = excludedDomains && excludedDomains.trim() !== "" ? excludedDomains : "";

        // Merge and deduplicate
        const allExcluded = userExcluded ? `${defaultExcluded},${userExcluded}` : defaultExcluded;
        const excludedDomainsArray = [...new Set(
          allExcluded
            .split(",")
            .map((d: string) => d.trim())
            .filter((d: string) => d.length > 0)
        )];

        if (excludedDomainsArray.length > 0) {
          filteredResults = searchResults.filter(
            (r: any) =>
              !excludedDomainsArray.some((domain: string) =>
                r.url.includes(domain)
              )
          );
        }
      }

      // Limit pages to scrape
      const urlsToScrape = filteredResults
        .slice(0, safePagesToScrape)
        .map((r: any) => r.url);

      // Step 2: Scrape all URLs
      const scrapedData = await scrapeMultiplePagesWithPlaywright(urlsToScrape);

      // Step 3: Aggregate results
      const aggregated = aggregateScrapedData(scrapedData);

      // Step 4: Format output
      const output = {
        query,
        searchResultsCount: filteredResults.length,
        scrapedPagesCount: scrapedData.length,
        searchResults: filteredResults.map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        scrapedData: aggregated.aggregatedData,
        stats: aggregated.stats,
      };

      const outputText =
        format === "yaml"
          ? formatAggregatedDataAsYAML(
              aggregated.aggregatedData,
              aggregated.stats
            )
          : JSON.stringify(output, null, 2);

      return {
        content: [{ type: "text", text: outputText }],
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
      enableJsonResponse: true, // JSON instead of SSE (n8n compatible)
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
        id: null,
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
  console.log(
    "  6. search_and_scrape - Search + auto-scrape top results (ONE-STEP)"
  );
});
