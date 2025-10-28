/**
 * OAuth 2.1 Middleware for MCP Servers
 *
 * Validates Bearer tokens according to MCP authorization spec:
 * https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
 *
 * Features:
 * - Bearer token extraction and validation
 * - Resource indicator validation (RFC 8707)
 * - WWW-Authenticate header responses per MCP spec
 * - Optional token introspection endpoint support
 */

import { Request, Response, NextFunction } from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Extend Express Request to include OAuth client info
 */
declare global {
  namespace Express {
    interface Request {
      oauth?: AuthInfo;
    }
  }
}

/**
 * Generic OAuth provider interface.
 * Compatible with DemoInMemoryAuthProvider.
 */
export interface OAuthProvider {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

export interface OAuthMiddlewareOptions {
  /**
   * OAuth provider for token validation.
   * Can be DemoInMemoryAuthProvider or KeycloakOAuthProvider.
   */
  authProvider: OAuthProvider;

  /**
   * Expected resource indicator (RFC 8707).
   * If provided, tokens must be issued for this resource.
   */
  resource?: string;

  /**
   * URL to authorization server metadata.
   * Used in WWW-Authenticate header for 401 responses.
   *
   * Examples:
   * - Demo: http://localhost:3001/.well-known/oauth-authorization-server
   * - Keycloak: http://keycloak:8080/realms/mcp-realm/.well-known/openid-configuration
   */
  authServerMetadataUrl?: string;

  /**
   * Routes that bypass OAuth validation (e.g., /health)
   */
  excludedPaths?: string[];
}

// ============================================================================
// OAuth Middleware
// ============================================================================

/**
 * Express middleware for OAuth 2.1 Bearer token validation.
 *
 * Usage:
 * ```typescript
 * const authProvider = new DemoInMemoryAuthProvider(...);
 * app.use(oauthMiddleware({
 *   authProvider,
 *   resource: "https://mcp.example.local",
 *   authServerMetadataUrl: "https://auth.example.local/.well-known/oauth-authorization-server"
 * }));
 * ```
 *
 * @param options Middleware configuration
 * @returns Express middleware function
 */
export function oauthMiddleware(
  options: OAuthMiddlewareOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    authProvider,
    resource,
    authServerMetadataUrl = "http://localhost:3001/.well-known/oauth-authorization-server",
    excludedPaths = ["/health"],
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip OAuth for excluded paths
    if (excludedPaths.some((path) => req.path === path)) {
      next();
      return;
    }

    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      sendUnauthorizedResponse(res, authServerMetadataUrl, resource);
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      sendUnauthorizedResponse(
        res,
        authServerMetadataUrl,
        resource,
        "invalid_token",
        "Authorization header must be 'Bearer <token>'"
      );
      return;
    }

    const token = parts[1];

    try {
      // Validate token with OAuth provider
      const tokenInfo = await authProvider.verifyAccessToken(token);

      // Validate resource indicator if required
      if (resource && tokenInfo.resource) {
        const expectedResource = new URL(resource);
        const actualResource = tokenInfo.resource;

        if (actualResource.toString() !== expectedResource.toString()) {
          sendUnauthorizedResponse(
            res,
            authServerMetadataUrl,
            resource,
            "invalid_token",
            "Token not valid for this resource"
          );
          return;
        }
      }

      // Attach OAuth info to request for use in handlers
      req.oauth = tokenInfo;

      next();
    } catch (error: any) {
      console.error("OAuth validation error:", error);
      sendUnauthorizedResponse(
        res,
        authServerMetadataUrl,
        resource,
        "invalid_token",
        error.message
      );
    }
  };
}

/**
 * Send 401 Unauthorized response with WWW-Authenticate header per MCP spec.
 *
 * The WWW-Authenticate header includes:
 * - Bearer realm
 * - as_uri: Link to authorization server metadata
 * - resource: Expected resource indicator (RFC 8707)
 * - error and error_description if applicable
 *
 * Example header:
 * WWW-Authenticate: Bearer realm="MCP Server",
 *   as_uri="https://auth.example.local/.well-known/oauth-authorization-server",
 *   resource="https://mcp.example.local",
 *   error="invalid_token",
 *   error_description="Token expired"
 */
function sendUnauthorizedResponse(
  res: Response,
  authServerMetadataUrl: string,
  resource?: string,
  error?: string,
  errorDescription?: string
): void {
  // Build WWW-Authenticate header
  let wwwAuthenticate = `Bearer realm="MCP Server", as_uri="${authServerMetadataUrl}"`;

  if (resource) {
    wwwAuthenticate += `, resource="${resource}"`;
  }

  if (error) {
    wwwAuthenticate += `, error="${error}"`;
  }

  if (errorDescription) {
    wwwAuthenticate += `, error_description="${errorDescription}"`;
  }

  res.setHeader("WWW-Authenticate", wwwAuthenticate);
  res.status(401).json({
    error: error || "unauthorized",
    error_description:
      errorDescription || "Valid Bearer token required for access",
  });
}

// ============================================================================
// Optional: Token Introspection Middleware
// ============================================================================

/**
 * Middleware that validates tokens via external introspection endpoint.
 * Alternative to direct authProvider validation.
 *
 * Useful when:
 * - Authorization server is separate from resource server
 * - You want centralized token validation
 *
 * @param introspectionUrl URL to token introspection endpoint
 * @param resource Expected resource indicator
 */
export function oauthIntrospectionMiddleware(
  introspectionUrl: string,
  resource?: string
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const token = authHeader.substring(7);

    try {
      // Call introspection endpoint
      const response = await fetch(introspectionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `token=${encodeURIComponent(token)}`,
      });

      const introspection = await response.json();

      if (!introspection.active) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Token is not active",
        });
        return;
      }

      // Validate resource indicator if required
      if (resource && introspection.resource !== resource) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Token not valid for this resource",
        });
        return;
      }

      // Attach OAuth info to request
      req.oauth = {
        token,
        clientId: introspection.clientId || introspection.client_id || "unknown",
        scopes: introspection.scope ? introspection.scope.split(" ") : [],
        expiresAt: introspection.exp || 0,
        resource: introspection.resource ? new URL(introspection.resource) : undefined,
      };

      next();
    } catch (error: any) {
      console.error("Token introspection error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: "Failed to validate token",
      });
      return;
    }
  };
}
