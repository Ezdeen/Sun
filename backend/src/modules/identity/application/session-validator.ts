/**
 * Session validator — closes the gap between a stateless JWT and reality.
 * A signed access token proves only "we issued this once". Before trusting it
 * we confirm, against the database, that:
 *   1. the session (refresh chain) it belongs to is not revoked,
 *   2. the user still exists and is `active`,
 *   3. the user's role still equals the role claimed in the token.
 * Cost: one indexed round-trip per authenticated request.
 */
import type { Db } from "../../../shared/db/client.js";
import { findSessionState } from "../infrastructure/sessions-repo.js";
import type { Role } from "../domain/permissions.js";

export interface ValidSession {
  displayName: string;
}

export interface SessionValidator {
  /** Returns the live session, or null when the token must be rejected. */
  validate(claims: { sub: string; sid: string; role: Role }): Promise<ValidSession | null>;
}

export function createSessionValidator(db: Db): SessionValidator {
  return {
    async validate({ sub, sid, role }) {
      const state = await findSessionState(db, sub, sid);
      if (!state) return null; // unknown user/session (e.g. account deleted)
      if (state.headRevoked) return null; // logout / logout-all / password change / reuse
      if (state.userStatus !== "active") return null; // disabled / pending
      if (state.userRole !== role) return null; // role changed since issuance
      return { displayName: state.displayName };
    }
  };
}
