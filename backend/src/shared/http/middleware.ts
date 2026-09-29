/**
 * Authentication / authorization pre-handlers (the ONLY auth enforcement
 * point in the API — every protected route goes through these).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { DomainError, unauthorized } from "../errors.js";
import { permissionsForRole, roleHas, type Permission, type Role } from "../../modules/identity/domain/permissions.js";
import type { TokenService } from "../../modules/identity/application/token-service.js";
import type { SessionValidator } from "../../modules/identity/application/session-validator.js";

export interface AuthUser {
  id: string;
  role: Role;
  sessionId: string;
  displayName: string;
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

export function createAuthGuards(tokens: TokenService, sessions: SessionValidator): AuthGuards {
  async function extractUser(req: FastifyRequest): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice(7).trim();
    if (!token) return null;
    let claims;
    try {
      claims = await tokens.verifyAccessToken(token);
    } catch {
      throw unauthorized("invalid or expired access token");
    }
    // A valid signature is not enough: confirm the session/user are still live.
    const live = await sessions.validate({ sub: claims.sub, sid: claims.sid, role: claims.role });
    if (!live) throw unauthorized("session is no longer valid");
    return {
      id: claims.sub,
      role: claims.role,
      sessionId: claims.sid,
      displayName: live.displayName,
      permissions: permissionsForRole(claims.role)
    };
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
