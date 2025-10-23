import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export class MCPWebClient {
  private client: Client;
  private transport: SSEClientTransport | null = null;
  private sessionId: string | null = null;
  private protocolVersion: string = '2025-06-18';

  constructor() {
    this.client = new Client(
      {
        name: 'mcp-web-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  }

  async connect(endpoint: string = '/mcp'): Promise<void> {
    // Create SSE transport
    this.transport = new SSEClientTransport(new URL(endpoint, window.location.origin));

    // Connect to the server
    await this.client.connect(this.transport);

    console.log('MCP Client connected successfully');
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.client.listTools();
    return response.tools as MCPTool[];
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const response = await this.client.callTool({
      name,
      arguments: args,
    });

    return response;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getProtocolVersion(): string {
    return this.protocolVersion;
  }
}
