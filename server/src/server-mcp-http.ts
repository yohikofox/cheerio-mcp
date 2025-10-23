import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { searchGoogle, searchDuckDuckGo, searchBing } from "./searchEngines.js";
import {
  scrapeMultiplePagesWithPlaywright,
  scrapePageWithPlaywright,
  takeScreenshotWithPlaywright,
} from "./scraper-playwright.js";

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
                    allowedDomains
                  );
                  break;
                case "duckduckgo":
                  searchResult = await searchDuckDuckGo(
                    query,
                    maxResults,
                    allowedDomains
                  );
                  break;
                case "bing":
                  searchResult = await searchBing(
                    query,
                    maxResults,
                    allowedDomains
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
