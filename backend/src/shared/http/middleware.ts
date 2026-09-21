/**
 * Authentication / authorization pre-handlers (the ONLY auth enforcement
 * point in the API — every protected route goes through these).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { DomainError, unauthorized } from "../errors.js";
import { permissionsForRole, roleHas, type Permission, type Role } from "../../modules/identity/domain/permissions.js";
import type { TokenService } from "../../modules/identity/application/token-service.js";

export interface AuthUser {
  id: string;
  role: Role;
  sessionId: string;
  permissions: readonly Permission[];
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

export interface AuthGuards {
  /** Verifies Bearer access token; throws 401 otherwise. */
  requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  /** Verifies token AND a specific permission; throws 401/403. */
  requirePermission(permission: Permission): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Verifies token AND an exact role (dashboard endpoints); 403 otherwise. */
  requireRole(role: Role): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Optional auth — used by public-but-personalizable endpoints. */
  optionalAuth(req: FastifyRequest): Promise<AuthUser | null>;
}

export function createAuthGuards(tokens: TokenService): AuthGuards {
  async function extractUser(req: FastifyRequest): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice(7).trim();
    if (!token) return null;
    try {
      const claims = await tokens.verifyAccessToken(token);
      return {
        id: claims.sub,
        role: claims.role,
        sessionId: claims.sid,
        permissions: permissionsForRole(claims.role)
      };
    } catch {
      throw unauthorized("invalid or expired access token");
    }
  }

  return {
    async requireAuth(req) {
      const user = await extractUser(req);
      if (!user) throw unauthorized();
      req.authUser = user;
    },
    requirePermission(permission: Permission) {
      return async (req: FastifyRequest) => {
        const user = await extractUser(req);
        if (!user) throw unauthorized();
        if (!roleHas(user.role, permission)) {
          throw new DomainError("forbidden", `missing permission ${permission}`, 403, {
            requiredPermission: permission
          });
        }
        req.authUser = user;
      };
    },
    requireRole(role: Role) {
      return async (req: FastifyRequest) => {
        const user = await extractUser(req);
        if (!user) throw unauthorized();
        if (user.role !== role) {
          throw new DomainError("forbidden", `this endpoint is for role ${role}`, 403);
        }
        req.authUser = user;
      };
    },
    async optionalAuth(req) {
      const user = await extractUser(req);
      req.authUser = user;
      return user;
    }
  };
}
