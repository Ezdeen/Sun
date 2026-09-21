/**
 * Token service — short-lived access JWT (jose, HS256, kid header) issued
 * in memory-only form to the SPA; opaque refresh tokens are handled by the
 * refresh use case (HttpOnly cookie), NOT here.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Role } from "../domain/permissions.js";

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: Role;
  sid: string;
}

export interface TokenService {
  issueAccessToken(input: { userId: string; role: Role; sessionId: string }): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
}

export function createTokenService(opts: {
  secret: string;
  keyId: string;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}): TokenService {
  const key = new TextEncoder().encode(opts.secret);

  return {
    async issueAccessToken({ userId, role, sessionId }) {
      return new SignJWT({ role, sid: sessionId })
        .setProtectedHeader({ alg: "HS256", kid: opts.keyId })
        .setSubject(userId)
        .setIssuedAt()
        .setIssuer(opts.issuer)
        .setAudience(opts.audience)
        .setExpirationTime(`${opts.ttlSeconds}s`)
        .sign(key);
    },

    async verifyAccessToken(token) {
      const { payload } = await jwtVerify(token, key, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ["HS256"]
      });
      const claims = payload as AccessTokenClaims;
      if (!claims.sub || !claims.role || !claims.sid) {
        throw new Error("invalid token claims");
      }
      return claims;
    }
  };
}
