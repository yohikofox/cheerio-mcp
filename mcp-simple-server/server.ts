// server.ts
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

// 1) Crée ton serveur MCP
const server = new McpServer({ name: "hello-world", version: "0.1.0" });

// 2) Déclare un outil très simple
server.registerTool(
  "hello",
  {
    title: "Hello tool",
    description: "Retourne un bonjour personnalisé",
    inputSchema: { name: z.string().default("World") },
    outputSchema: { greeting: z.string() },
  },
  async ({ name }) => {
    const output = { greeting: `Hello, ${name}!` };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  }
);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "mcp-simple-server" });
});

// 3) Expose le point d'entrée HTTP Streamable
app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.log(`✓ MCP Hello World on http://localhost:${port}/mcp`);
  console.log(`✓ Health check: http://localhost:${port}/health`);
});
