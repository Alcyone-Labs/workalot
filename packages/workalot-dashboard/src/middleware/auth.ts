import type { Context } from "elysia";

export interface AuthContext extends Context {
  user?: {
    id: string;
    roles: string[];
  };
}

export type AuthMiddleware = (context: AuthContext) => Promise<void | object> | void | object;

export interface AuthConfig {
  /** JWT secret for token validation */
  jwtSecret: string;
  /** Token expiry in seconds (default: 3600) */
  expirySeconds?: number;
  /** Custom validation function */
  validateToken?: (token: string) => Promise<boolean> | boolean;
  /** Extract token from request */
  extractToken?: (context: AuthContext) => string | undefined;
}

/**
 * Creates a JWT-based auth middleware
 */
export function createJwtAuth(config: AuthConfig): AuthMiddleware {
  return async ({ headers, set }) => {
    const authHeader = headers?.authorization;
    if (!authHeader) {
      set.status = 401;
      return { error: "Authorization header required" };
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      set.status = 401;
      return { error: "Bearer token required" };
    }

    // Validate token
    const isValid = config.validateToken 
      ? await config.validateToken(token)
      : validateJwtToken(token, config.jwtSecret);

    if (!isValid) {
      set.status = 401;
      return { error: "Invalid or expired token" };
    }
  };
}

/**
 * Creates an API key auth middleware
 */
export function createApiKeyAuth(validKeys: string[]): AuthMiddleware {
  return async ({ headers, set }) => {
    const apiKey = headers?.['x-api-key'];
    if (!apiKey) {
      set.status = 401;
      return { error: "X-API-Key header required" };
    }

    if (!validKeys.includes(apiKey as string)) {
      set.status = 401;
      return { error: "Invalid API key" };
    }
  };
}

function validateJwtToken(token: string, secret: string): boolean {
  // Simple JWT validation - in production, use a proper JWT library
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    // Basic structure check - real implementation would verify signature
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}
