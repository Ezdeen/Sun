/**
 * Domain error hierarchy. Every error carries a stable machine code
 * that maps to an RFC 7807 problem-details response with an Arabic
 * user-facing message (see shared/http/problem-details.ts).
 */
export type DomainErrorCode =
  // auth
  | "unauthorized"
  | "invalid_credentials"
  | "account_locked"
  | "account_disabled"
  | "refresh_reuse_detected"
  | "invitation_invalid"
  | "invitation_expired"
  | "weak_password"
  | "self_registration_disabled"
  | "privileged_role_requires_invitation"
  // authorization
  | "forbidden"
  | "role_not_allowed"
  | "override_reason_required"
  // state machine
  | "invalid_transition"
  | "concurrent_update"
  | "request_already_assigned"
  | "barcode_mismatch"
  | "bag_state_invalid"
  | "weights_missing"
  // finance
  | "duplicate_invoice"
  | "splits_must_sum_100"
  | "amount_must_be_positive"
  | "idempotency_conflict"
  | "invoice_not_voidable"
  | "payout_transition_invalid"
  // catalog / pricing
  | "unknown_waste_type"
  | "unknown_addon"
  | "addon_not_applicable"
  | "duplicate_catalog_code"
  // generic
  | "not_found"
  | "validation_error"
  | "conflict"
  | "rate_limited"
  | "chain_broken"
  | "internal_error";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const unauthorized = (msg = "Authentication required") =>
  new DomainError("unauthorized", msg, 401);
export const forbidden = (msg = "You are not allowed to perform this action") =>
  new DomainError("forbidden", msg, 403);
export const notFound = (what = "Resource") =>
  new DomainError("not_found", `${what} not found`, 404);
export const conflict = (code: DomainErrorCode, msg: string, details?: Record<string, unknown>) =>
  new DomainError(code, msg, 409, details);
export const badRequest = (code: DomainErrorCode, msg: string, details?: Record<string, unknown>) =>
  new DomainError(code, msg, 400, details);
