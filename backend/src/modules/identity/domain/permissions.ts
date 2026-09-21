/**
 * RBAC — explicit permissions, never role-name comparisons in logic.
 * The role × permission matrix is DATA (mirrors seeds/data/permissions.json,
 * Appendix A.5). Every (role × endpoint) intersection is tested.
 */
export const PERMISSIONS = [
  "catalog:read",
  "pricing:estimate",
  "request:create",
  "request:read",
  "request:transition",
  "schedule:read",
  "shipment:create",
  "shipment:read",
  "bag:weigh",
  "invoice:create",
  "ledger:read",
  "payout:read:own",
  "payout:transition",
  "settings:update",
  "catalog:manage",
  "account:manage",
  "traceability:verify"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Role = "citizen" | "collector" | "authority" | "sorter" | "finance" | "manager";

export const ROLES: readonly Role[] = [
  "citizen",
  "collector",
  "authority",
  "sorter",
  "finance",
  "manager"
];

/**
 * Source of truth matches seeds/data/permissions.json (Appendix A.5).
 * Deliberate change vs the old system (documented in ASSUMPTIONS #A-002):
 * finance can no longer create shipments or weigh bags — separation of duties.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  citizen: [
    "catalog:read",
    "pricing:estimate",
    "request:create",
    "request:read",
    "payout:read:own"
  ],
  collector: [
    "catalog:read",
    "pricing:estimate",
    "request:read",
    "request:transition",
    "schedule:read",
    "payout:read:own"
  ],
  authority: ["catalog:read", "pricing:estimate", "request:read", "request:transition"],
  sorter: [
    "catalog:read",
    "pricing:estimate",
    "request:read",
    "request:transition",
    "shipment:create",
    "shipment:read",
    "bag:weigh"
  ],
  finance: [
    "catalog:read",
    "pricing:estimate",
    "request:read",
    "shipment:read",
    "invoice:create",
    "ledger:read",
    "payout:transition"
  ],
  manager: [
    "catalog:read",
    "pricing:estimate",
    "request:create",
    "request:read",
    "request:transition",
    "schedule:read",
    "shipment:create",
    "shipment:read",
    "bag:weigh",
    "invoice:create",
    "ledger:read",
    "payout:transition",
    "settings:update",
    "catalog:manage",
    "account:manage",
    "traceability:verify"
  ]
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles that may only be created via manager invitation (§6.5). */
export const INVITE_ONLY_ROLES: readonly Role[] = [
  "collector",
  "authority",
  "sorter",
  "finance",
  "manager"
];
