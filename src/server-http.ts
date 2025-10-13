import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import {
  searchGoogle,
  searchDuckDuckGo,
  searchBing,
} from "./searchEngines.js";
import { scrapePage, scrapeMultiplePages } from "./scraper.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "web-search-mcp" });
});

// MCP endpoint
app.post("/mcp", async (req, res) => {
  const transport = new SSEServerTransport("/message", res);
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

  // Register tools
  server.setRequestHandler("tools/list", async () => ({
    tools: [
      {
        name: "search_web",
        description:
          "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
            engines: {
              type: "array",
              items: { type: "string", enum: ["google", "duckduckgo", "bing"] },
              description: "List of search engines to use",
              default: ["google", "duckduckgo", "bing"],
            },
            maxResults: {
              type: "number",
              description: "Maximum results per engine (1-10)",
              default: 10,
              minimum: 1,
              maximum: 10,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "scrape_page",
        description: "Extract content from a web page",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to scrape" },
          },
          required: ["url"],
        },
      },
      {
        name: "scrape_multiple_pages",
        description: "Extract content from multiple web pages in parallel",
        inputSchema: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
              description: "Array of URLs to scrape",
            },
          },
          required: ["urls"],
        },
      },
      {
        name: "search_and_scrape",
        description: "Search and automatically scrape top results",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            engine: {
              type: "string",
              enum: ["google", "duckduckgo", "bing"],
              default: "google",
            },
            maxResults: {
              type: "number",
              default: 5,
              minimum: 1,
              maximum: 10,
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_web": {
          const { query, engines = ["duckduckgo"], maxResults = 10 } = args;
          const results = [];

          for (const engine of engines) {
            let result;
            switch (engine.toLowerCase()) {
              case "google":
                result = await searchGoogle(query, maxResults);
                break;
              case "duckduckgo":
                result = await searchDuckDuckGo(query, maxResults);
                break;
              case "bing":
                result = await searchBing(query, maxResults);
                break;
            }
            if (result) results.push(result);
          }

          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "scrape_page": {
          const { url } = args;
          const result = await scrapePage(url);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "scrape_multiple_pages": {
          const { urls } = args;
          const results = await scrapeMultiplePages(urls);
          return {
            content: [
              { type: "text", text: JSON.stringify(results, null, 2) },
            ],
          };
        }

        case "search_and_scrape": {
          const { query, engine = "duckduckgo", maxResults = 5 } = args;
          let searchResults;

          switch (engine.toLowerCase()) {
            case "google":
              searchResults = await searchGoogle(query, maxResults);
              break;
            case "duckduckgo":
              searchResults = await searchDuckDuckGo(query, maxResults);
              break;
            case "bing":
              searchResults = await searchBing(query, maxResults);
              break;
          }

          const urls = searchResults.results.map((r) => r.url);
          const scrapedPages = await scrapeMultiplePages(urls);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { searchResults, scrapedPages },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  await transport.start();
  await server.connect(transport);
});

app.listen(PORT, () => {
  console.log(`MCP HTTP Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
