export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// Runtime config from window.ENV (injected by Docker entrypoint)
declare global {
  interface Window {
    ENV?: {
      MCP_SERVER_URL?: string;
    };
  }
}

/**
 * Custom MCP client for browser using native EventSource and fetch
 */
export class MCPWebClient {
  private eventSource: EventSource | null = null;
  private sessionId: string | null = null;
  private protocolVersion: string = '2025-06-18';
  private endpoint: string = '/mcp';
  private requestId: number = 1;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || null;
  }

  async connect(endpoint?: string): Promise<void> {
    // Use provided endpoint, or runtime config, or default to /mcp
    this.endpoint = endpoint || (window.ENV?.MCP_SERVER_URL ? `${window.ENV.MCP_SERVER_URL}/mcp` : '/mcp');

    console.log('[MCP Client] Connecting to:', this.endpoint);

    // First, establish SSE connection and get session ID
    await new Promise<void>((resolve, reject) => {
      // Create EventSource connection with API key if provided
      let sseUrl = this.endpoint;
      if (this.apiKey) {
        sseUrl = `${this.endpoint}?api_key=${encodeURIComponent(this.apiKey)}`;
        console.log('[MCP Client] Using API key authentication');
      }

      this.eventSource = new EventSource(sseUrl);

      // Handle connection opened
      this.eventSource.onopen = () => {
        console.log('[MCP Client] SSE connection opened');
      };

      // Handle endpoint event (contains session info)
      this.eventSource.addEventListener('endpoint', (event) => {
        console.log('[MCP Client] Received endpoint event:', event.data);
        const data = JSON.parse(event.data);
        this.sessionId = data.sessionId;
        this.protocolVersion = data.protocolVersion || this.protocolVersion;
        console.log('[MCP Client] Session ID received:', this.sessionId);
        resolve();
      });

      // Handle message events (JSON-RPC responses)
      this.eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleResponse(data);
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      });

      // Handle errors
      this.eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        if (this.eventSource?.readyState === EventSource.CLOSED) {
          reject(new Error('SSE connection closed'));
        }
      };

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.sessionId) {
          reject(new Error('Timeout waiting for session'));
        }
      }, 10000);
    });

    // Now initialize the MCP session
    console.log('[MCP Client] Initializing MCP session...');
    await this.sendRequest('initialize', {
      protocolVersion: this.protocolVersion,
      clientInfo: {
        name: 'mcp-web-client',
        version: '1.0.0'
      },
      capabilities: {}
    });
    console.log('[MCP Client] MCP session initialized');
  }

  private handleResponse(data: any): void {
    if (data.id && this.pendingRequests.has(data.id)) {
      const { resolve, reject } = this.pendingRequests.get(data.id)!;
      this.pendingRequests.delete(data.id);

      if (data.error) {
        reject(new Error(data.error.message || 'Request failed'));
      } else {
        resolve(data.result);
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.sessionId) {
      console.error('[MCP Client] No session ID available');
      throw new Error('Not connected - no session ID');
    }

    const id = this.requestId++;

    console.log(`[MCP Client] Sending request #${id}:`, method, params);

    // Create promise for response
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 60 seconds (scraping can be slow)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          console.error(`[MCP Client] Request #${id} timeout`);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });

    // Send POST request
    console.log(`[MCP Client] POST ${this.endpoint} with session:`, this.sessionId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': this.protocolVersion,
      'Mcp-Session-Id': this.sessionId,
    };

    // Add API key header if configured
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params || {},
      }),
    });

    console.log(`[MCP Client] Response status:`, response.status);

    if (!response.ok && response.status !== 202) {
      const errorText = await response.text();
      console.error(`[MCP Client] HTTP error:`, response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Wait for SSE response
    console.log(`[MCP Client] Waiting for SSE response for request #${id}`);
    return promise;
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list');
    return result.tools as MCPTool[];
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    return await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
  }

  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getProtocolVersion(): string {
    return this.protocolVersion;
  }
}
