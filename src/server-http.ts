import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  searchGoogle,
  searchDuckDuckGo,
  searchBing,
} from "./searchEngines.js";
import { scrapeMultiplePagesWithPlaywright, scrapePageWithPlaywright, takeScreenshotWithPlaywright } from "./scraper-playwright.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// Utility function to filter search results by allowed domains
function filterResultsByDomain(results: any[], allowedDomains?: string[]): any[] {
  if (!allowedDomains || allowedDomains.length === 0) {
    return results;
  }

  return results.map(result => {
    if (result && result.results) {
      const filteredResults = result.results.filter((item: any) => {
        try {
          const url = new URL(item.url);
          const hostname = url.hostname.replace('www.', '');

          // Check if hostname matches any of the allowed domains
          return allowedDomains.some(domain => {
            const cleanDomain = domain.replace('www.', '').toLowerCase();
            return hostname.toLowerCase().includes(cleanDomain) || hostname.toLowerCase().endsWith(cleanDomain);
          });
        } catch (e) {
          return false;
        }
      });

      return {
        ...result,
        results: filteredResults,
        filteredBy: allowedDomains,
        originalCount: result.results.length,
        filteredCount: filteredResults.length
      };
    }
    return result;
  });
}

// MCP Server Info
const SERVER_INFO = {
  name: "web-search-mcp",
  version: "1.0.0",
};

// Health check endpoint (non-MCP, pour Kubernetes)
app.get("/health", (_req, res) => {
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
              description: "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed domains (e.g., fnac.com, cdiscount.com).",
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
                  allowedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description: "Optional: Filter results to only include these domains (e.g., ['fnac.com', 'cdiscount.com']). If not specified, returns all results.",
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "scrape_page",
              description: "Extract structured data from a web page using Playwright (JavaScript-heavy sites) - Returns YAML/JSON format",
              inputSchema: {
                type: "object",
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
              description: "Extract structured data from multiple web pages in parallel using Playwright (JavaScript-heavy sites) - Returns YAML/JSON format",
              inputSchema: {
                type: "object",
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
              name: "search_and_scrape",
              description: "Perform a web search and automatically scrape the content of top results using Playwright (JavaScript-heavy sites). Can filter results by allowed domains. Returns YAML/JSON format.",
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
                  format: {
                    type: "string",
                    enum: ["yaml", "json"],
                    description: "Output format",
                    default: "yaml",
                  },
                  allowedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description: "Optional: Filter results to only include these domains (e.g., ['fnac.com', 'cdiscount.com']).",
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "scrape_dynamic",
              description: "Extract structured data from a single page using Playwright (JavaScript-heavy sites) - Returns YAML/JSON format",
              inputSchema: {
                type: "object",
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
              name: "take_screenshot",
              description: "Take a screenshot of a webpage using Playwright - Returns base64 encoded image",
              inputSchema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description: "The URL of the page to screenshot",
                  },
                  width: {
                    type: "number",
                    description: "Viewport width in pixels",
                    default: 1920,
                    minimum: 320,
                    maximum: 3840,
                  },
                  height: {
                    type: "number",
                    description: "Viewport height in pixels",
                    default: 1080,
                    minimum: 240,
                    maximum: 2160,
                  },
                  fullPage: {
                    type: "boolean",
                    description: "Capture full page (scroll to bottom)",
                    default: false,
                  },
                  format: {
                    type: "string",
                    enum: ["png", "jpeg"],
                    description: "Image format",
                    default: "png",
                  },
                  quality: {
                    type: "number",
                    description: "JPEG quality (0-100, only for JPEG format)",
                    default: 90,
                    minimum: 0,
                    maximum: 100,
                  },
                },
                required: ["url"],
              },
            },
            {
              name: "search_and_scrape_dynamic",
              description: "Search and scrape with Playwright (JavaScript-heavy sites) - Returns YAML format with product data. Can filter results by allowed domains.",
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
                  allowedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description: "Optional: Filter results to only include these domains (e.g., ['fnac.com', 'cdiscount.com']).",
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
            const { query, engines = ["duckduckgo"], maxResults = 10, allowedDomains } = args || {};

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
                  searchResult = await searchGoogle(query, maxResults, allowedDomains);
                  break;
                case "duckduckgo":
                  searchResult = await searchDuckDuckGo(query, maxResults, allowedDomains);
                  break;
                case "bing":
                  searchResult = await searchBing(query, maxResults, allowedDomains);
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
            const { url, format = "yaml", flatten = true } = args || {};

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

            const pageData = await scrapePageWithPlaywright(url, { format: format as 'yaml' | 'json', flatten });

            // Return YAML string if format is yaml, otherwise return JSON
            if (format === 'yaml') {
              const yamlOutput = `---\nurl: ${pageData.url}\ntitle: ${pageData.title}\n${pageData.yaml || ''}`;
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
                    text: JSON.stringify(pageData, null, 2),
                  },
                ],
              };
            }
            break;
          }

          case "scrape_multiple_pages": {
            const { urls, format = "yaml", flatten = true } = args || {};

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

            const scrapedPages = await scrapeMultiplePagesWithPlaywright(urls, { format: format as 'yaml' | 'json', flatten });

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
                    text: JSON.stringify(scrapedPages, null, 2),
                  },
                ],
              };
            }
            break;
          }

          case "scrape_dynamic": {
            const { url, format = "yaml", flatten = true } = args || {};

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

            const pageData = await scrapePageWithPlaywright(url, { format: format as 'yaml' | 'json', flatten });
            
            // Return YAML string if format is yaml, otherwise return JSON
            if (format === 'yaml') {
              const yamlOutput = `---\nurl: ${pageData.url}\ntitle: ${pageData.title}\n${pageData.yaml || ''}`;
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
                    text: JSON.stringify(pageData, null, 2),
                  },
                ],
              };
            }
            break;
          }

          case "take_screenshot": {
            const { url, width = 1920, height = 1080, fullPage = false, format = "png", quality = 90 } = args || {};

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

            const screenshotData = await takeScreenshotWithPlaywright(url, {
              width,
              height,
              fullPage,
              format: format as 'png' | 'jpeg',
              quality: format === 'jpeg' ? quality : undefined
            });

            // Convert buffer to base64
            const base64Image = screenshotData.screenshot.toString('base64');
            
            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    url: screenshotData.url,
                    title: screenshotData.title,
                    image: {
                      format: screenshotData.format,
                      base64: base64Image,
                      size: screenshotData.screenshot.length
                    },
                    dimensions: screenshotData.dimensions,
                    timestamp: screenshotData.timestamp
                  }, null, 2),
                },
              ],
            };
            break;
          }

          case "search_and_scrape": {
            const { query, engine = "duckduckgo", maxResults = 5, format = "yaml", allowedDomains } = args || {};

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

            // Apply domain filtering if allowedDomains is provided
            const filtered = filterResultsByDomain([searchResults], allowedDomains)[0];
            const urls = filtered.results.map((r: any) => r.url);
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
                    text: JSON.stringify({ searchResults: filtered, scrapedPages }, null, 2),
                  },
                ],
              };
            }
            break;
          }

          case "search_and_scrape_dynamic": {
            const { query, engine = "duckduckgo", maxResults = 3, format = "yaml", allowedDomains } = args || {};

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

            // Apply domain filtering if allowedDomains is provided
            const filtered = filterResultsByDomain([searchResults], allowedDomains)[0];
            const urls = filtered.results.map((r: any) => r.url);
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
                    text: JSON.stringify({ searchResults: filtered, scrapedPages }, null, 2),
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
app.get("/", (_req, res) => {
  res.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "Model Context Protocol",
    protocolVersion: "2025-06-18",
    description: "MCP server for web search and content extraction using Playwright",
    endpoints: {
      health: "GET /health - Kubernetes health check",
      mcp: "POST /mcp - MCP JSON-RPC 2.0 endpoint",
    },
    documentation: "https://modelcontextprotocol.io/docs",
    tools: [
      "search_web - Search the web with multiple engines",
      "scrape_page - Extract structured data from a page with Playwright (YAML/JSON)",
      "scrape_multiple_pages - Extract data from multiple pages with Playwright (YAML/JSON)",
      "search_and_scrape - Search and scrape top results with Playwright (YAML/JSON)",
      "scrape_dynamic - Extract structured data with Playwright (YAML/JSON)",
      "take_screenshot - Take a screenshot with Playwright",
      "search_and_scrape_dynamic - Search and scrape with Playwright (YAML/JSON)",
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
