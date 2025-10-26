import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
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

// import { scrapePageWithPlaywright } from "./scraper-playwright-test.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

// Session management
interface Session {
  id: string;
  protocolVersion: string;
  initialized: boolean;
  clients: Set<Response>; // SSE connections
  messageQueue: Array<{ id: string; data: any }>;
  lastEventId: number;
}

const sessions = new Map<string, Session>();

// Generate cryptographically secure session ID
function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

// Get or create session
function getSession(sessionId?: string): Session | null {
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

// Create new session
function createSession(protocolVersion: string): Session {
  const sessionId = generateSessionId();
  const session: Session = {
    id: sessionId,
    protocolVersion,
    initialized: false,
    clients: new Set(),
    messageQueue: [],
    lastEventId: 0,
  };
  sessions.set(sessionId, session);
  return session;
}

// Send SSE message to all clients in a session
function sendSSEMessage(
  session: Session,
  message: any,
  eventType: string = "message"
) {
  session.lastEventId++;
  const eventId = session.lastEventId.toString();
  const data = JSON.stringify(message);

  // Store message for resumability
  session.messageQueue.push({ id: eventId, data: message });

  // Keep only last 100 messages
  if (session.messageQueue.length > 100) {
    session.messageQueue.shift();
  }

  const sseData = `id: ${eventId}\nevent: ${eventType}\ndata: ${data}\n\n`;

  // Send to all connected clients
  session.clients.forEach((client) => {
    try {
      client.write(sseData);
    } catch (error) {
      console.error("Error writing to SSE client:", error);
      session.clients.delete(client);
    }
  });
}

// MCP Server Info
const SERVER_INFO = {
  name: "web-search-mcp",
  version: "1.0.0",
};

const SERVER_CAPABILITIES = {
  tools: {
    listChanged: true,
  },
  logging: {},
};

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: SERVER_INFO.name,
    version: SERVER_INFO.version,
    transport: "HTTP with SSE",
    protocol: "MCP",
  });
});

// Root endpoint
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Middleware to validate MCP headers
function validateMCPHeaders(
  req: Request,
  res: Response,
  requireSession: boolean = true
): {
  valid: boolean;
  session?: Session;
  protocolVersion?: string;
} {
  const protocolVersion = req.headers["mcp-protocol-version"] as string;
  const sessionId = req.headers["mcp-session-id"] as string;

  // Validate protocol version
  if (!protocolVersion) {
    // Default to 2025-03-26 for backward compatibility
    const version = DEFAULT_PROTOCOL_VERSION;

    if (requireSession) {
      const session = getSession(sessionId);
      if (!session) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Missing MCP-Protocol-Version header",
          },
        });
        return { valid: false };
      }
      return { valid: true, session, protocolVersion: version };
    }

    return { valid: true, protocolVersion: version };
  }

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: `Unsupported protocol version: ${protocolVersion}`,
      },
    });
    return { valid: false };
  }

  // Validate session (except for initialize)
  if (requireSession) {
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Missing Mcp-Session-Id header",
        },
      });
      return { valid: false };
    }

    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Session not found or expired",
        },
      });
      return { valid: false };
    }

    return { valid: true, session, protocolVersion };
  }

  return { valid: true, protocolVersion };
}

// GET /mcp - Establish SSE stream
app.get("/mcp", (req: Request, res: Response) => {
  // Accept session ID from header or create a new session
  let sessionId = req.headers["mcp-session-id"] as string;
  const lastEventId = req.headers["last-event-id"] as string;

  let session = sessionId ? getSession(sessionId) : null;

  // If no session exists, create a new one
  if (!session) {
    const protocolVersion =
      (req.headers["mcp-protocol-version"] as string) ||
      DEFAULT_PROTOCOL_VERSION;
    session = createSession(protocolVersion);
    sessionId = session.id;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

  // Add client to session
  session.clients.add(res);

  // Send initial comment to establish connection
  res.write(": connected\n\n");

  // Send endpoint event with session information (for browser compatibility)
  const endpointData = {
    sessionId: session.id,
    endpoint: "/mcp",
    protocolVersion: session.protocolVersion,
  };
  res.write(`event: endpoint\ndata: ${JSON.stringify(endpointData)}\n\n`);

  // Handle resumability - resend messages after lastEventId
  if (lastEventId) {
    const lastId = parseInt(lastEventId, 10);
    const messagesToResend = session.messageQueue.filter(
      (msg) => parseInt(msg.id, 10) > lastId
    );

    messagesToResend.forEach((msg) => {
      const sseData = `id: ${msg.id}\nevent: message\ndata: ${JSON.stringify(
        msg.data
      )}\n\n`;
      res.write(sseData);
    });
  }

  // Handle client disconnect
  req.on("close", () => {
    session.clients.delete(res);
  });
});

// POST /mcp - Send messages to server
app.post("/mcp", async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body;

  // Validate JSON-RPC 2.0
  if (jsonrpc !== "2.0") {
    res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: "Invalid Request: jsonrpc must be '2.0'",
      },
    });
    return;
  }

  if (!method) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: "Invalid Request: method is required",
      },
    });
    return;
  }

  // Handle initialize - session should already exist from SSE connection
  if (method === "initialize") {
    const validation = validateMCPHeaders(req, res, true);
    if (!validation.valid) return;

    const session = validation.session!;
    session.initialized = true;

    const result = {
      protocolVersion: session.protocolVersion,
      serverInfo: SERVER_INFO,
      capabilities: SERVER_CAPABILITIES,
      instructions:
        "Use the available tools to search the web and scrape content from websites.",
    };

    // Send response via SSE (202 Accepted)
    const response = {
      jsonrpc: "2.0",
      id,
      result,
    };

    sendSSEMessage(session, response);
    res.status(202).send();
    return;
  }

  // All other methods require session
  const validation = validateMCPHeaders(req, res, true);
  if (!validation.valid) return;

  const session = validation.session!;

  if (!session.initialized) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: "Session not initialized. Call initialize first.",
      },
    });
    return;
  }

  try {
    let result;

    switch (method) {
      case "tools/list": {
        result = {
          tools: [
            {
              name: "search_web",
              description:
                "Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results. Can filter results by allowed domains (e.g., fnac.com, cdiscount.com).",
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
                    description:
                      "Optional: Filter results to only include these domains",
                  },
                  excludedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description:
                      "Optional: Exclude results from these domains (e.g., ['fnac.com', 'amazon.fr'])",
                    default: ["fnac.com", "darty.com", "idealo.fr", ".cz"],
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "scrape_page",
              description:
                "Extract structured data from a web page using Playwright (JavaScript-heavy sites) - Returns YAML/JSON format",
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
              description:
                "Extract structured data from multiple web pages in parallel using Playwright",
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
              name: "take_screenshot",
              description:
                "Take a screenshot of a webpage using Playwright - Returns base64 encoded image",
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
                  },
                  height: {
                    type: "number",
                    description: "Viewport height in pixels",
                    default: 1080,
                  },
                  fullPage: {
                    type: "boolean",
                    description: "Capture full page (scroll to bottom)",
                    default: false,
                  },
                },
                required: ["url"],
              },
            },
            {
              name: "analyze_page_structure",
              description:
                "Analyze the structure of a product/article page to identify optimal selectors for data extraction. Returns structured data formats, suggested CSS selectors, and extraction recommendations.",
              inputSchema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description: "The URL of the page to analyze",
                  },
                  interactionSelectors: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional: CSS selectors of elements to click on during analysis (e.g., accordion triggers to reveal hidden content). These will be saved in the domain config for future use.",
                  },
                },
                required: ["url"],
              },
            },
            {
              name: "search_and_scrape",
              description:
                "Search the web and scrape all result pages, then aggregate the data to remove duplicates. Returns a unified dataset from multiple sources.",
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
                    description: "Maximum results per engine to scrape (1-10)",
                    default: 5,
                    minimum: 1,
                    maximum: 10,
                  },
                  allowedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description:
                      "Optional: Filter results to only include these domains (leave empty to allow all domains except excluded ones)",
                  },
                  excludedDomains: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    description:
                      "Optional: Exclude results from these domains (e.g., ['fnac.com', 'amazon.fr'])",
                    default: ["fnac.com", "darty.com", "idealo.fr", ".cz"],
                  },
                  minFrequency: {
                    type: "number",
                    description:
                      "Only include data found in at least N sources (default: 1)",
                    default: 1,
                    minimum: 1,
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
            {
              name: "list_domain_configs",
              description:
                "List all saved domain configurations (learned page structures)",
              inputSchema: {
                type: "object",
                properties: {},
              },
            },
            {
              name: "get_domain_config",
              description:
                "Get the saved configuration for a specific domain",
              inputSchema: {
                type: "object",
                properties: {
                  domain: {
                    type: "string",
                    description: "Domain name (e.g., 'orange.fr' or 'boutique.orange.fr')",
                  },
                },
                required: ["domain"],
              },
            },
            {
              name: "update_domain_config",
              description:
                "Update an existing domain configuration with edited schema/selectors. Supports two modes: 1) Partial updates with 'updates' object, 2) Full config replacement with 'configJson' string (ideal for textarea editing workflow).",
              inputSchema: {
                type: "object",
                properties: {
                  domain: {
                    type: "string",
                    description: "Domain name (e.g., 'cdiscount.com' or 'boutique.orange.fr')",
                  },
                  updates: {
                    type: "object",
                    description: "Partial configuration to update (any DomainConfig fields). Ignored if configJson is provided.",
                    properties: {
                      productInfo: {
                        type: "object",
                        description: "Product information selectors (title, price, images, etc.)",
                      },
                      structuredData: {
                        type: "array",
                        description: "Structured data information (JSON-LD, Microdata, OpenGraph)",
                      },
                      extractionStrategy: {
                        type: "string",
                        enum: ["structured", "selectors", "hybrid"],
                        description: "Strategy to use for extraction",
                      },
                      recommendations: {
                        type: "array",
                        items: { type: "string" },
                        description: "Updated recommendations for extraction",
                      },
                      interactionSelectors: {
                        type: "array",
                        items: { type: "string" },
                        description: "CSS selectors for interactions (accordions, etc.)",
                      },
                      accordionContent: {
                        type: "array",
                        description: "Accordion content configuration",
                      },
                    },
                  },
                  configJson: {
                    type: "string",
                    description: "Complete configuration as JSON string (from textarea editing). When provided, replaces the entire config. Use with get_domain_config to retrieve, edit, and save back.",
                  },
                  mergeMode: {
                    type: "string",
                    enum: ["merge", "replace"],
                    description: "How to apply updates: 'merge' (default) combines with existing, 'replace' overwrites all except domain/learnedAt/sampleUrl. Only used when 'updates' is provided.",
                    default: "merge",
                  },
                },
                required: ["domain"],
              },
            },
          ],
        };
        break;
      }

      case "tools/call": {
        const { name, arguments: args } = params || {};

        if (!name) {
          throw new Error("Invalid params: 'name' is required");
        }

        let toolResult;

        switch (name) {
          case "search_web": {
            const {
              query,
              engines = ["duckduckgo"],
              maxResults = 10,
              allowedDomains,
              excludedDomains,
            } = args || {};

            if (!query) {
              throw new Error("Invalid params: 'query' is required");
            }

            const results = [];
            for (const engine of engines) {
              let searchResult;
              switch (engine.toLowerCase()) {
                case "google":
                  searchResult = await searchGoogle(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
                  break;
                case "duckduckgo":
                  searchResult = await searchDuckDuckGo(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
                  break;
                case "bing":
                  searchResult = await searchBing(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
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
              throw new Error("Invalid params: 'url' is required");
            }

            const pageData = await scrapePageWithPlaywright(url, {
              format: format as "yaml" | "json",
              flatten,
            });

            if (format === "yaml") {
              const yamlOutput = `---\nurl: ${pageData.url}\ntitle: ${
                pageData.title
              }\n${pageData.yaml || ""}`;
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
              throw new Error("Invalid params: 'urls' must be an array");
            }

            const scrapedPages = await scrapeMultiplePagesWithPlaywright(urls, {
              format: format as "yaml" | "json",
              flatten,
            });

            if (format === "yaml") {
              const yamlOutput = scrapedPages
                .map(
                  (c) =>
                    `---\nurl: ${c.url}\ntitle: ${c.title}\n${c.yaml || ""}`
                )
                .join("\n\n");
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

          case "take_screenshot": {
            const {
              url,
              width = 1920,
              height = 1080,
              fullPage = false,
            } = args || {};

            if (!url) {
              throw new Error("Invalid params: 'url' is required");
            }

            const screenshotData = await takeScreenshotWithPlaywright(url, {
              width,
              height,
              fullPage,
              format: "png",
            });

            const base64Image = screenshotData.screenshot.toString("base64");

            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      url: screenshotData.url,
                      title: screenshotData.title,
                      image: {
                        format: screenshotData.format,
                        base64: base64Image,
                        size: screenshotData.screenshot.length,
                      },
                      dimensions: screenshotData.dimensions,
                      timestamp: screenshotData.timestamp,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
            break;
          }

          case "analyze_page_structure": {
            const { url, interactionSelectors } = args || {};

            if (!url) {
              throw new Error("Invalid params: 'url' is required");
            }

            const analysis = await analyzePageStructure(url, interactionSelectors);

            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(analysis, null, 2),
                },
              ],
            };
            break;
          }

          case "search_and_scrape": {
            const {
              query,
              engines = ["duckduckgo"],
              maxResults = 5,
              allowedDomains,
              excludedDomains,
              minFrequency = 1,
              format = "yaml",
            } = args || {};

            if (!query) {
              throw new Error("Invalid params: 'query' is required");
            }

            // Step 1: Search across all engines
            const searchResults = [];
            for (const engine of engines) {
              let searchResult;
              switch (engine.toLowerCase()) {
                case "google":
                  searchResult = await searchGoogle(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
                  break;
                case "duckduckgo":
                  searchResult = await searchDuckDuckGo(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
                  break;
                case "bing":
                  searchResult = await searchBing(
                    query,
                    maxResults,
                    allowedDomains,
                    excludedDomains
                  );
                  break;
                default:
                  continue;
              }
              if (searchResult && searchResult.results.length > 0) {
                searchResults.push(searchResult);
              }
            }

            // Step 2: Collect all unique URLs from search results
            const urlsToScrape = new Set<string>();
            for (const result of searchResults) {
              for (const item of result.results) {
                urlsToScrape.add(item.url);
              }
            }

            const urls = Array.from(urlsToScrape);

            // Step 3: Scrape all URLs in parallel
            const scrapedPages = await scrapeMultiplePagesWithPlaywright(urls, {
              format: "json",
              flatten: true,
            });

            // Step 4: Aggregate scraped data
            const { aggregatedData, stats } = aggregateScrapedData(
              scrapedPages,
              {
                minFrequency,
                deduplicateSimilar: true,
              }
            );

            // Step 5: Format output
            if (format === "yaml") {
              const yamlOutput = formatAggregatedDataAsYAML(
                aggregatedData,
                stats
              );

              // Calculate token estimation for the output
              const estimatedTokens = estimateTokenCount(yamlOutput);

              // Add header with token estimation
              const header = `# Search and Scrape Results
# Query: ${query}
# Engines: ${engines.join(', ')}
# URLs scraped: ${urls.length}
# Aggregated items: ${aggregatedData.length}
# Estimated tokens: ~${estimatedTokens.toLocaleString()}
# ================================================

`;

              toolResult = {
                content: [
                  {
                    type: "text",
                    text: header + yamlOutput,
                  },
                ],
              };
            } else {
              const jsonOutput = JSON.stringify(
                {
                  query,
                  engines,
                  searchResults: searchResults.map((r) => ({
                    engine: r.engine,
                    resultCount: r.results.length,
                  })),
                  scrapedPages: urls.length,
                  aggregatedData,
                  stats,
                },
                null,
                2
              );

              // Calculate token estimation for the output
              const estimatedTokens = estimateTokenCount(jsonOutput);

              toolResult = {
                content: [
                  {
                    type: "text",
                    text: `Estimated tokens: ~${estimatedTokens.toLocaleString()}\n\n${jsonOutput}`,
                  },
                ],
              };
            }
            break;
          }

          case "list_domain_configs": {
            const domains = await listDomainConfigs();

            toolResult = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      count: domains.length,
                      domains: domains.sort(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
            break;
          }

          case "get_domain_config": {
            const { domain } = args || {};

            if (!domain) {
              throw new Error("Invalid params: 'domain' is required");
            }

            const config = await loadDomainConfig(domain);

            if (!config) {
              toolResult = {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        error: `No configuration found for domain: ${domain}`,
                        suggestion: "Use 'analyze_page_structure' tool to learn this domain first",
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            } else {
              toolResult = {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(config, null, 2),
                  },
                ],
              };
            }
            break;
          }

          case "update_domain_config": {
            const { domain, updates, configJson, mergeMode = "merge" } = args || {};

            if (!domain) {
              throw new Error("Invalid params: 'domain' is required");
            }

            try {
              let updatedConfig;

              // Mode 1: Full config replacement from JSON string (textarea mode)
              if (configJson) {
                try {
                  const parsedConfig = JSON.parse(configJson);

                  // Validate required fields
                  if (!parsedConfig.productInfo || !parsedConfig.structuredData || !parsedConfig.extractionStrategy) {
                    throw new Error("Invalid config JSON: missing required fields (productInfo, structuredData, extractionStrategy)");
                  }

                  // Use replace mode with parsed config
                  updatedConfig = await updateDomainConfig(
                    domain,
                    parsedConfig,
                    'replace'
                  );

                  toolResult = {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify(
                          {
                            success: true,
                            message: "Domain configuration replaced successfully from JSON string",
                            mode: "configJson (full replacement)",
                            domain: updatedConfig.domain,
                            lastUsed: updatedConfig.lastUsed,
                            config: updatedConfig,
                          },
                          null,
                          2
                        ),
                      },
                    ],
                  };
                } catch (parseError) {
                  throw new Error(`Failed to parse configJson: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                }
              }
              // Mode 2: Partial updates (original behavior)
              else if (updates) {
                updatedConfig = await updateDomainConfig(
                  domain,
                  updates,
                  mergeMode as 'merge' | 'replace'
                );

                toolResult = {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        {
                          success: true,
                          message: `Domain configuration updated successfully (mode: ${mergeMode})`,
                          mode: mergeMode,
                          domain: updatedConfig.domain,
                          lastUsed: updatedConfig.lastUsed,
                          config: updatedConfig,
                        },
                        null,
                        2
                      ),
                    },
                  ],
                };
              }
              // Neither configJson nor updates provided
              else {
                throw new Error("Invalid params: either 'configJson' or 'updates' is required");
              }
            } catch (error) {
              toolResult = {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                        suggestion: "Make sure the domain exists. Use 'get_domain_config' to check, or 'analyze_page_structure' to create it first.",
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
            break;
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        result = toolResult;
        break;
      }

      default:
        throw new Error(`Method not found: ${method}`);
    }

    // Send response via SSE
    const response = {
      jsonrpc: "2.0",
      id,
      result,
    };

    sendSSEMessage(session, response);

    // Return 202 Accepted
    res.status(202).send();
  } catch (error) {
    console.error(`Error handling MCP request:`, error);

    const errorResponse = {
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32603,
        message: "Internal error",
        data: error instanceof Error ? error.message : String(error),
      },
    };

    sendSSEMessage(session, errorResponse);
    res.status(202).send();
  }
});

// DELETE /mcp - Terminate session
app.delete("/mcp", (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!sessionId) {
    res.status(400).send("Missing Mcp-Session-Id header");
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).send("Session not found");
    return;
  }

  // Close all SSE connections
  session.clients.forEach((client) => {
    try {
      client.end();
    } catch (error) {
      console.error("Error closing SSE client:", error);
    }
  });

  // Remove session
  sessions.delete(sessionId);

  res.status(200).send("Session terminated");
});

// Cleanup expired sessions (run every 5 minutes)
setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, sessionId) => {
    // Remove sessions with no clients for more than 10 minutes
    if (session.clients.size === 0) {
      // TODO: Add timestamp to track when session was last used
      // For now, we keep all sessions
    }
  });
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✓ MCP HTTP Server with SSE running on port ${PORT}`);
  console.log(`✓ Protocol: MCP 2025-06-18 (JSON-RPC 2.0 over HTTP with SSE)`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`✓ Server info: ${SERVER_INFO.name} v${SERVER_INFO.version}`);
  console.log(
    `✓ Supported protocol versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`
  );
});
