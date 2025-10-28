// server.ts
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

const server = new McpServer({ name: "hello-world", version: "0.1.0" });

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

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => console.log("MCP on http://localhost:3000/mcp"));
