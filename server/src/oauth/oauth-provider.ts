/**
 * MCP OAuth 2.1 Provider Implementation
 *
 * ⚠️ DEMO IMPLEMENTATION - NOT FOR PRODUCTION
 *
 * Based on the official example:
 * https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/demoInMemoryOAuthProvider.ts
 *
 * Missing for production:
 * - Persistent token storage (currently in-memory)
 * - Rate limiting
 * - Token refresh implementation
 * - Proper client secret hashing
 * - Session management
 * - CSRF protection
 */

import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createOAuthMetadata, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// ============================================================================
// In-Memory Clients Store
// ============================================================================

/**
 * Demo in-memory storage for OAuth registered clients.
 * In production, use a database.
 */
export class DemoInMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata: OAuthClientInformationFull) {
    this.clients.set(clientMetadata.client_id, clientMetadata);
    return clientMetadata;
  }
}

// ============================================================================
// OAuth Authorization Provider
// ============================================================================

/**
 * Demo OAuth 2.1 provider implementing MCP authorization spec.
 */
export class DemoInMemoryAuthProvider implements OAuthServerProvider {
  clientsStore = new DemoInMemoryClientsStore();

  private codes = new Map<
    string,
    {
      params: AuthorizationParams;
      client: OAuthClientInformationFull;
    }
  >();

  private tokens = new Map<string, AuthInfo>();

  constructor(private validateResource?: (resource?: URL) => boolean) {}

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const code = randomUUID();

    const searchParams = new URLSearchParams({
      code,
    });
    if (params.state !== undefined) {
      searchParams.set("state", params.state);
    }

    this.codes.set(code, {
      client,
      params,
    });

    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const targetUrl = new URL(params.redirectUri);
    targetUrl.search = searchParams.toString();
    res.redirect(targetUrl.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }

    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }

    if (codeData.client.client_id !== client.client_id) {
      throw new Error(
        `Authorization code was not issued to this client, ${codeData.client.client_id} != ${client.client_id}`
      );
    }

    if (
      this.validateResource &&
      !this.validateResource(codeData.params.resource)
    ) {
      throw new Error(`Invalid resource: ${codeData.params.resource}`);
    }

    this.codes.delete(authorizationCode);
    const token = randomUUID();

    const tokenData = {
      token,
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      expiresAt: Date.now() + 3600000,
      resource: codeData.params.resource,
      type: "access",
    };

    this.tokens.set(token, tokenData);

    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      scope: (codeData.params.scopes || []).join(" "),
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
    _scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    throw new Error("Not implemented for example demo");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = this.tokens.get(token);
    if (
      !tokenData ||
      !tokenData.expiresAt ||
      tokenData.expiresAt < Date.now()
    ) {
      throw new Error("Invalid or expired token");
    }

    return {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(tokenData.expiresAt / 1000),
      resource: tokenData.resource,
    };
  }
}

// ============================================================================
// Authorization Server Setup
// ============================================================================

export interface SetupAuthServerOptions {
  /**
   * Base URL of the authorization server
   */
  authServerUrl: URL;

  /**
   * Base URL of the MCP server (resource server)
   */
  mcpServerUrl: URL;

  /**
   * Enable strict resource validation
   * When true, tokens must match the expected resource URL
   */
  strictResource: boolean;
}

/**
 * Setup OAuth authorization server with MCP routes.
 *
 * Based on the official example from:
 * https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/demoInMemoryOAuthProvider.ts
 *
 * @param options Configuration options
 * @returns OAuth metadata
 */
export const setupAuthServer = ({
  authServerUrl,
  mcpServerUrl,
  strictResource,
}: SetupAuthServerOptions): OAuthMetadata => {
  const validateResource = strictResource
    ? (resource?: URL) => {
        if (!resource) return false;
        const expectedResource = resourceUrlFromServerUrl(mcpServerUrl);
        return resource.toString() === expectedResource.toString();
      }
    : undefined;

  const provider = new DemoInMemoryAuthProvider(validateResource);
  const authApp = express();
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: true }));

  authApp.use(
    mcpAuthRouter({
      provider,
      issuerUrl: authServerUrl,
      scopesSupported: ["mcp:tools"],
    })
  );

  authApp.post("/introspect", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }

      const tokenInfo = await provider.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: tokenInfo.clientId,
        scope: tokenInfo.scopes.join(" "),
        exp: tokenInfo.expiresAt,
        aud: tokenInfo.resource,
      });
      return;
    } catch (error) {
      res.status(401).json({
        active: false,
        error: "Unauthorized",
        error_description: `Invalid token: ${error}`,
      });
    }
  });

  const auth_port = authServerUrl.port;
  authApp.listen(auth_port, (error?: Error) => {
    if (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
    console.log(`OAuth Authorization Server listening on port ${auth_port}`);
  });

  const oauthMetadata: OAuthMetadata = createOAuthMetadata({
    provider,
    issuerUrl: authServerUrl,
    scopesSupported: ["mcp:tools"],
  });

  oauthMetadata.introspection_endpoint = new URL(
    "/introspect",
    authServerUrl
  ).href;

  return oauthMetadata;
};
