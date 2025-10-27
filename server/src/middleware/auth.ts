import { Request, Response, NextFunction } from 'express';

/**
 * Public endpoints that don't require authentication
 */
const PUBLIC_ENDPOINTS = ['/health', '/'];

/**
 * Authentication middleware using API Key header
 *
 * Supports multiple API keys via MCP_API_KEYS environment variable (comma-separated)
 * Example: MCP_API_KEYS=key1,key2,key3
 *
 * Expected header: X-API-Key: your-secret-key
 *
 * Public endpoints (no auth required): /health, /
 * Protected endpoints: /mcp (all methods)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip authentication for public endpoints
  if (PUBLIC_ENDPOINTS.includes(req.path)) {
    return next();
  }

  // Get API keys from environment
  const apiKeysEnv = process.env.MCP_API_KEYS || '';
  const validKeys = apiKeysEnv.split(',').map(k => k.trim()).filter(k => k.length > 0);

  // If no API keys configured, allow all requests (backward compatible)
  if (validKeys.length === 0) {
    console.warn('[Auth] Warning: No API keys configured (MCP_API_KEYS not set). All requests allowed.');
    return next();
  }

  // Check for API key in request headers
  const providedKey = req.headers['x-api-key'] as string | undefined;

  if (!providedKey) {
    console.warn(`[Auth] Unauthorized: Missing API key - ${req.method} ${req.path} from ${req.ip}`);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API key. Please provide X-API-Key header.',
      code: 'MISSING_API_KEY'
    });
    return;
  }

  // Validate API key
  if (!validKeys.includes(providedKey)) {
    console.warn(`[Auth] Unauthorized: Invalid API key - ${req.method} ${req.path} from ${req.ip}`);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
    return;
  }

  // Valid API key
  console.log(`[Auth] Authorized: ${req.method} ${req.path} from ${req.ip}`);
  next();
}

/**
 * Generate a secure API key
 * Usage: import { generateApiKey } from './middleware/auth.js';
 *        console.log(generateApiKey());
 *
 * Or via CLI: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function generateApiKey(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}
