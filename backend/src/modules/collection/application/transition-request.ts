/**
 * Transition use case — THE guarded state machine execution.
 * Every guard from §6.2 is enforced HERE (never in routes, never in React):
 *   - exact next-step transitions (no jumps, no going back)
 *   - role permissions + manager override with mandatory reason (audited)
 *   - collector assignment exclusivity
 *   - citizen barcode match at collection (not bypassable by override)
 *   - all-bags-weighed before sorting
 *   - optimistic versioning (409 concurrent_update)
 *   - tracking event appended in the SAME transaction
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import { DomainError } from "../../../shared/errors.js";
import { users as usersTable } from "../../../shared/db/schema.js";
import { createHash } from "node:crypto";
import {
  evaluateTransition,
  guardsFor,
  type RequestStatus,
  type Role
} from "../domain/lifecycle.js";
import {
  lockRequest,
  advanceRequestStatus,
  markBagsCollected,
  getRequestBags
} from "../infrastructure/requests-repo.js";
import { appendEvent } from "../../traceability/infrastructure/chain-repo.js";
import { recordAuthEvent } from "../../identity/infrastructure/sessions-repo.js";
import { uuidv7 } from "../../../shared/ids.js";

export interface TransitionInput {
  requestId: string;
  target: RequestStatus;
  actor: { userId: string; role: Role };
  expectedVersion: number;
  /** Barcode scan value (qr_payload | combined_hash | request_hash). */
  barcode?: string | null;
  /** Required when a manager assigns a collector on on_the_way. */
  collectorUserId?: string | null;
  scheduledDay?: string | null;
  scheduledHour?: string | null;
  /** Manager override reason — mandatory audit trail. */
  reason?: string | null;
}

const ACTOR_PREFIXES: Record<Role | "system", string> = {
  citizen: "CIT",
  collector: "COL",
  authority: "AUT",
  sorter: "SRT",
  finance: "FIN",
  manager: "MGR",
  system: "SYS"
};

function actorRefFor(user: { role: Role; id: string; identityHash: string | null }): string {
  if (user.identityHash) return user.identityHash;
  const sha = createHash("sha256").update(user.id, "utf8").digest("hex");
  return `${ACTOR_PREFIXES[user.role]}-${sha.slice(0, 48)}`;
}

const TIMESTAMP_FIELDS: Partial<Record<RequestStatus, "dispatchedAt" | "startedAt" | "arrivedAt" | "collectedAt" | "sortedAt" | "soldAt">> = {
  sent_to_collector: "dispatchedAt",
  on_the_way: "startedAt",
  arrived: "arrivedAt",
  collected: "collectedAt",
  sorted: "sortedAt",
  sold: "soldAt"
};

export async function transitionRequest(deps: { db: Db; clock: Clock }, input: TransitionInput) {
  const { db, clock } = deps;
  const now = clock.now();

  return db.transaction(async (tx) => {
    // 1) Row lock — serializes all transitions of this request.
    const raw = await lockRequest(tx, input.requestId);
    if (!raw) throw new DomainError("not_found", "request not found", 404);
    const request = raw;

    // 2) Optimistic version check.
    if (request.version !== input.expectedVersion) {
      throw new DomainError(
        "concurrent_update",
        `version mismatch: expected ${input.expectedVersion}, current ${request.version}`,
        409,
        { currentVersion: request.version }
      );
    }

    // 3) Actor identity for the chain.
    const actorRows = await tx
      .select({ role: usersTable.role, identityHash: usersTable.identityHash })
      .from(usersTable)
      .where(eq(usersTable.id, input.actor.userId))
      .limit(1);
    const actorRow = actorRows[0];
    if (!actorRow) throw new DomainError("not_found", "actor not found", 404);

    // 4) State machine decision.
    const decision = evaluateTransition({
      current: request.status,
      target: input.target,
      role: input.actor.role,
      overrideReason: input.reason ?? null
    });
    if (!decision.ok) {
      const code =
        decision.code === "invalid_transition" || decision.code === "system_only_transition"
          ? "invalid_transition"
          : decision.code;
      throw new DomainError(code, `transition ${request.status}→${input.target} rejected (${decision.code})`, 409, {
        currentStatus: request.status,
        requestedTarget: input.target
      });
    }

    const spec = guardsFor(request.status);

    // 5) Collector assignment guard.
    let collectorUserId = request.collectorUserId ?? null;
    let scheduledDay = request.scheduledDay ?? null;
    let scheduledHour = request.scheduledHour ?? null;
    if (spec.assignsCollector) {
      if (input.actor.role === "collector") {
        if (request.collectorUserId && request.collectorUserId !== input.actor.userId) {
          throw new DomainError("request_already_assigned", "request already assigned to another collector", 409);
        }
        collectorUserId = input.actor.userId;
      } else if (input.actor.role === "manager") {
        if (!input.collectorUserId) {
          throw new DomainError(
            "validation_error",
            "manager must specify collectorUserId for this transition",
            400
          );
        }
        if (request.collectorUserId && request.collectorUserId !== input.collectorUserId) {
          throw new DomainError("request_already_assigned", "request already assigned to another collector", 409);
        }
        collectorUserId = input.collectorUserId;
      }
      if (input.scheduledDay !== undefined) scheduledDay = input.scheduledDay ?? null;
      if (input.scheduledHour !== undefined) scheduledHour = input.scheduledHour ?? null;
    }

    // 6) Barcode match guard (override does NOT bypass this — §6.2).
    if (spec.requiresBarcode) {
      const code = input.barcode?.trim() ?? "";
      const matches =
        code !== "" &&
        (code === request.qrPayload || code === request.combinedHash || code === request.requestHash);
      if (!matches) {
        throw new DomainError("barcode_mismatch", "citizen barcode does not match this request", 409, {
          hint: "scan the QR on the citizen's bag label"
        });
      }
    }

    // 7) All-bags-weighed guard before sorting.
    if (spec.requiresWeighedBags) {
      const bags = await getRequestBags(tx, request.id);
      if (bags.length === 0) {
        throw new DomainError("weights_missing", "request has no bags", 409);
      }
      const unweighed = bags.filter((b) => b.status !== "weighed");
      if (unweighed.length > 0) {
        throw new DomainError(
          "weights_missing",
          `${unweighed.length} bag(s) not weighed/attached yet`,
          409,
          { unweighedBags: unweighed.map((b) => b.bagCode) }
        );
      }
    }

    // 8) Execute transition + tracking event in the SAME transaction.
    const updated = await advanceRequestStatus(tx, {
      id: request.id,
      status: decision.next,
      expectedVersion: request.version,
      collectorUserId,
      scheduledDay,
      scheduledHour,
      timestampField: TIMESTAMP_FIELDS[decision.next]
    });

    if (decision.next === "collected") {
      await markBagsCollected(tx, request.id);
    }

    await appendEvent(tx, {
      aggregateType: "request",
      aggregateId: request.id,
      statusCode: decision.next,
      actorRole: input.actor.role,
      actorRef: actorRefFor({ role: actorRow.role, id: input.actor.userId, identityHash: actorRow.identityHash }),
      payload: {
        from: request.status,
        request_number: request.requestNumber,
        ...(input.reason ? { override_reason: input.reason } : {}),
        ...(decision.next === "on_the_way" && scheduledDay ? { scheduled_day: scheduledDay } : {})
      },
      occurredAt: now
    });

    // 9) Manager override audit event.
    if (decision.isOverride && input.reason) {
      await recordAuthEvent(tx, {
        id: uuidv7(),
        userId: input.actor.userId,
        eventType: "override_executed",
        details: {
          requestId: request.id,
          transition: `${request.status}→${decision.next}`,
          reason: input.reason
        }
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      version: updated.version,
      collectorUserId: updated.collectorUserId,
      scheduledDay: updated.scheduledDay,
      scheduledHour: updated.scheduledHour,
      updatedAt: updated.updatedAt
    };
  });
}
