import express from "express";
import {
  searchGoogle,
  searchDuckDuckGo,
  searchBing,
} from "./searchEngines.js";
import { scrapePage, scrapeMultiplePages } from "./scraper.js";
import { scrapeMultiplePagesWithPlaywright } from "./scraper-playwright.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// MCP Server Info
const SERVER_INFO = {
  name: "web-search-mcp",
  version: "1.0.0",
};

// Health check endpoint (non-MCP, pour Kubernetes)
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: SERVER_INFO.name, version: SERVER_INFO.version });
});

// MCP JSON-RPC 2.0 endpoint
app.post("/mcp", async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  // Validate JSON-RPC 2.0 format
  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: "Invalid Request: jsonrpc must be '2.0'",
      },
    });
  }

  if (!method) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: "Invalid Request: method is required",
      },
    });
  }

  try {
    let result;

    switch (method) {
      case "initialize": {
        // MCP initialization handshake
        result = {
          protocolVersion: "2025-06-18",
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: {
              listChanged: true,
            },
          },
        };
        break;
      }

      case "tools/list": {
        // List all available tools
        result = {
          tools: [
            {
              name: "search_web",
              description: "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results",
              inputSchema: {
                type: "object",
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
                },
                required: ["query"],
              },
            },
            {
              name: "scrape_page",
              description: "Extract content from a web page including title, text, headings, links, images, and metadata",
              inputSchema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description: "The URL of the page to scrape",
                  },
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
              description: "Perform a web search and automatically scrape the content of top results",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query",
                  },
                  engine: {
                    type: "string",
                    enum: ["google", "duckduckgo", "bing"],
                    description: "Search engine to use",
                    default: "duckduckgo",
                  },
                  maxResults: {
                    type: "number",
                    description: "Maximum number of results to scrape (1-10)",
                    default: 5,
                    minimum: 1,
                    maximum: 10,
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "search_and_scrape_dynamic",
              description: "Search and scrape with Playwright (JavaScript-heavy sites) - Returns YAML format with product data",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query",
                  },
                  engine: {
                    type: "string",
                    enum: ["google", "duckduckgo", "bing"],
                    description: "Search engine to use",
                    default: "duckduckgo",
                  },
                  maxResults: {
                    type: "number",
                    description: "Maximum number of results to scrape (1-10)",
                    default: 3,
                    minimum: 1,
                    maximum: 10,
                  },
                  format: {
                    type: "string",
                    enum: ["yaml", "json"],
                    description: "Output format",
                    default: "yaml",
                  },
                },
                required: ["query"],
              },
            },
          ],
        };
        break;
      }

      case "tools/call": {
        // Execute a tool
        const { name, arguments: args } = params || {};

        if (!name) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid params: 'name' is required",
            },
          });
        }

        let toolResult;

        switch (name) {
          case "search_web": {
            const { query, engines = ["duckduckgo"], maxResults = 10 } = args || {};

            if (!query) {
              return res.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32602,
                  message: "Invalid params: 'query' is required",
                },
              });
            }

            const results = [];
            for (const engine of engines) {
              let searchResult;
              switch (engine.toLowerCase()) {
                case "google":
                  searchResult = await searchGoogle(query, maxResults);
                  break;
                case "duckduckgo":
                  searchResult = await searchDuckDuckGo(query, maxResults);
                  break;
                case "bing":
                  searchResult = await searchBing(query, maxResults);
                  break;
                default:
                  continue;
              }
              if (searchResult) results.push(searchResult);
            }

            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(results, null, 2),
                },
              ],
            };
            break;
          }

          case "scrape_page": {
            const { url } = args || {};

            if (!url) {
              return res.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32602,
                  message: "Invalid params: 'url' is required",
                },
              });
            }

            const pageData = await scrapePage(url);
            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(pageData, null, 2),
                },
              ],
            };
            break;
          }

          case "scrape_multiple_pages": {
            const { urls } = args || {};

            if (!urls || !Array.isArray(urls)) {
              return res.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32602,
                  message: "Invalid params: 'urls' must be an array",
                },
              });
            }

            const pagesData = await scrapeMultiplePages(urls);
            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(pagesData, null, 2),
                },
              ],
            };
            break;
          }

          case "search_and_scrape": {
            const { query, engine = "duckduckgo", maxResults = 5 } = args || {};

            if (!query) {
              return res.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32602,
                  message: "Invalid params: 'query' is required",
                },
              });
            }

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
              default:
                return res.json({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32602,
                    message: `Invalid engine: ${engine}`,
                  },
                });
            }

            const urls = searchResults.results.map((r) => r.url);
            const scrapedPages = await scrapeMultiplePages(urls);

            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ searchResults, scrapedPages }, null, 2),
                },
              ],
            };
            break;
          }

          case "search_and_scrape_dynamic": {
            const { query, engine = "duckduckgo", maxResults = 3, format = "yaml" } = args || {};

            if (!query) {
              return res.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32602,
                  message: "Invalid params: 'query' is required",
                },
              });
            }

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
              default:
                return res.json({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32602,
                    message: `Invalid engine: ${engine}`,
                  },
                });
            }

            const urls = searchResults.results.map((r) => r.url);
            const scrapedPages = await scrapeMultiplePagesWithPlaywright(urls, { format: format as 'yaml' | 'json' });

            // Return YAML string if format is yaml, otherwise return JSON
            if (format === 'yaml') {
              const yamlOutput = scrapedPages.map(c => `---\nurl: ${c.url}\ntitle: ${c.title}\n${c.yaml || ''}`).join('\n\n');
              toolResult = {
                content: [
                  {
                    type: "text",
                    text: yamlOutput,
                  },
                ],
              };
            } else {
              toolResult = {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ searchResults, scrapedPages }, null, 2),
                  },
                ],
              };
            }
            break;
          }

          default:
            return res.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Method not found: ${name}`,
              },
            });
        }

        result = toolResult;
        break;
      }

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
    }

    // Success response
    res.json({
      jsonrpc: "2.0",
      id,
      result,
    });
  } catch (error) {
    console.error(`Error handling MCP request:`, error);
    res.json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32603,
        message: "Internal error",
        data: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// Root endpoint with API info
app.get("/", (req, res) => {
  res.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "Model Context Protocol",
    protocolVersion: "2025-06-18",
    description: "MCP server for web search and content extraction using Cheerio",
    endpoints: {
      health: "GET /health - Kubernetes health check",
      mcp: "POST /mcp - MCP JSON-RPC 2.0 endpoint",
    },
    documentation: "https://modelcontextprotocol.io/docs",
    tools: [
      "search_web - Search the web with multiple engines",
      "scrape_page - Extract content from a single page",
      "scrape_multiple_pages - Extract content from multiple pages",
      "search_and_scrape - Search and scrape top results",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`✓ MCP Server running on port ${PORT}`);
  console.log(`✓ Protocol: MCP 2025-06-18 (JSON-RPC 2.0)`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`✓ Server info: ${SERVER_INFO.name} v${SERVER_INFO.version}`);
});
