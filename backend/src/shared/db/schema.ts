/**
 * Database schema (PostgreSQL, dedicated schema `app`).
 * Authority for the ORM types; SQL migrations under backend/drizzle are the
 * authority for the physical database (hand-reviewed, version controlled).
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");

// ── Enums ────────────────────────────────────────────────────────────────
export const roleEnum = app.enum("role", [
  "citizen",
  "collector",
  "authority",
  "sorter",
  "finance",
  "manager"
]);
export const userStatusEnum = app.enum("user_status", ["pending", "active", "disabled"]);
/** Roles allowed on chain events — user roles + the system actor. */
export const chainRoleEnum = app.enum("chain_role", [
  "citizen",
  "collector",
  "authority",
  "sorter",
  "finance",
  "manager",
  "system"
]);
export const requestStatusEnum = app.enum("request_status", [
  "received",
  "sent_to_collector",
  "on_the_way",
  "arrived",
  "collected",
  "sorted",
  "sold"
]);
export const bagStatusEnum = app.enum("bag_status", [
  "pending_collection",
  "collected",
  "attached",
  "weighed"
]);
export const shipmentStatusEnum = app.enum("shipment_status", ["open", "sold", "void"]);
export const invoiceStatusEnum = app.enum("invoice_status", ["active", "void"]);
export const payoutStatusEnum = app.enum("payout_status", [
  "calculated",
  "approved",
  "paid",
  "void"
]);
export const beneficiaryTypeEnum = app.enum("beneficiary_type", ["platform", "collector", "citizen"]);
export const aggregateTypeEnum = app.enum("aggregate_type", ["request", "shipment", "bag"]);
export const invitationStatusEnum = app.enum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked"
]);
export const ledgerEntryTypeEnum = app.enum("ledger_entry_type", [
  "invoice_issued",
  "invoice_voided",
  "allocation_platform",
  "allocation_collector",
  "allocation_citizen",
  "unallocated_to_platform",
  "unallocated_held",
  "payout_approved",
  "payout_paid",
  "payout_voided"
]);
export const authEventTypeEnum = app.enum("auth_event_type", [
  "login_success",
  "login_failed",
  "login_locked",
  "refresh_rotated",
  "refresh_reuse_detected",
  "logout",
  "logout_all",
  "invitation_created",
  "invitation_accepted",
  "password_changed",
  "account_status_changed",
  "override_executed"
]);

// ── Identity ─────────────────────────────────────────────────────────────
export const users = app.table(
  "users",
  {
    id: uuid("id").primaryKey(),
    role: roleEnum("role").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    status: userStatusEnum("status").notNull().default("pending"),
    /** HMAC-SHA256(pepper, id_number) — never the raw identity number. */
    identityHash: text("identity_hash"),
    identityLast4: text("identity_last4"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_phone_key").on(t.phone),
    uniqueIndex("users_identity_hash_key").on(t.identityHash),
    index("users_role_idx").on(t.role, t.status)
  ]
);

export const credentials = app.table("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const refreshTokens = app.table(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex of the raw token — raw token exists only in the cookie. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedFrom: uuid("rotated_from"),
    replacedBy: uuid("replaced_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_key").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId)
  ]
);

export const authEvents = app.table(
  "auth_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: authEventTypeEnum("event_type").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("auth_events_user_idx").on(t.userId, t.occurredAt)]
);

export const invitations = app.table(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    /** sha256 hex of the one-time invitation token. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    status: invitationStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    serviceAreaId: uuid("service_area_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    index("invitations_status_idx").on(t.status, t.expiresAt)
  ]
);

// ── Geography / role profiles ────────────────────────────────────────────
export const serviceAreas = app.table(
  "service_areas",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    zone: text("zone").notNull(),
    households: integer("households").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("service_areas_code_key").on(t.code)]
);

export const citizens = app.table("citizens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  serviceAreaId: uuid("service_area_id")
    .notNull()
    .references(() => serviceAreas.id),
  addressHint: text("address_hint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const collectors = app.table("collectors", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  serviceAreaId: uuid("service_area_id")
    .notNull()
    .references(() => serviceAreas.id),
  vehicleHint: text("vehicle_hint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const authorities = app.table("authorities", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  serviceAreaId: uuid("service_area_id")
    .notNull()
    .references(() => serviceAreas.id),
  jurisdictionNote: text("jurisdiction_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const staffProfiles = app.table("staff_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

// ── Catalog & pricing ────────────────────────────────────────────────────
export const wasteTypes = app.table(
  "waste_types",
  {
    code: text("code").primaryKey(),
    category: text("category").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    unit: text("unit").notNull(), // bottle | liter | kg
    pricePerUnit: numeric("price_per_unit", { precision: 14, scale: 2 }).notNull(),
    capacityWeightKg: numeric("capacity_weight_kg", { precision: 10, scale: 3 }),
    referencePricePerTon: numeric("reference_price_per_ton", { precision: 14, scale: 2 }),
    minWeightKg: numeric("min_weight_kg", { precision: 10, scale: 3 }),
    isBulkOnly: boolean("is_bulk_only").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    imageRef: text("image_ref"),
    active: boolean("active").notNull().default(true)
  },
  (t) => [index("waste_types_category_idx").on(t.category, t.active)]
);

export const priceAddons = app.table(
  "price_addons",
  {
    code: text("code").primaryKey(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    bonusPercent: numeric("bonus_percent", { precision: 5, scale: 2 }).notNull(),
    active: boolean("active").notNull().default(true)
  },
  (t) => [index("price_addons_active_idx").on(t.active)]
);

/** Which addon applies to which waste type (explicit, relational, editable). */
export const priceAddonWasteTypes = app.table(
  "price_addon_waste_types",
  {
    addonCode: text("addon_code")
      .notNull()
      .references(() => priceAddons.code, { onDelete: "cascade" }),
    wasteTypeCode: text("waste_type_code")
      .notNull()
      .references(() => wasteTypes.code, { onDelete: "cascade" })
  },
  (t) => [primaryKey({ columns: [t.addonCode, t.wasteTypeCode] })]
);

// ── Settings (versioned) ─────────────────────────────────────────────────
export const platformSettings = app.table(
  "platform_settings",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("platform_settings_key_key").on(t.key)]
);

// ── Collection requests ──────────────────────────────────────────────────
export const collectionRequests = app.table(
  "collection_requests",
  {
    id: uuid("id").primaryKey(),
    /** Human number from the app.request_number_seq sequence. */
    requestNumber: bigint("request_number", { mode: "number" }).notNull(),
    citizenUserId: uuid("citizen_user_id")
      .notNull()
      .references(() => users.id),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreas.id),
    status: requestStatusEnum("status").notNull().default("received"),
    /** Optimistic-locking version; conflict → 409 concurrent_update. */
    version: integer("version").notNull().default(1),
    collectorUserId: uuid("collector_user_id").references(() => users.id),
    scheduledDay: text("scheduled_day"),
    scheduledHour: text("scheduled_hour"),
    combinedHash: text("combined_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    qrPayload: text("qr_payload").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    sortedAt: timestamp("sorted_at", { withTimezone: true }),
    soldAt: timestamp("sold_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("collection_requests_number_key").on(t.requestNumber),
    uniqueIndex("collection_requests_combined_hash_key").on(t.combinedHash),
    uniqueIndex("collection_requests_request_hash_key").on(t.requestHash),
    index("collection_requests_status_idx").on(t.status),
    index("collection_requests_citizen_idx").on(t.citizenUserId, t.createdAt),
    index("collection_requests_collector_idx").on(t.collectorUserId, t.status),
    index("collection_requests_area_idx").on(t.serviceAreaId, t.status)
  ]
);

export const requestItems = app.table(
  "request_items",
  {
    id: uuid("id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => collectionRequests.id, { onDelete: "cascade" }),
    wasteTypeCode: text("waste_type_code")
      .notNull()
      .references(() => wasteTypes.code),
    quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
    weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
    /** Ordered addon codes applied at estimate time. */
    selectedAddons: jsonb("selected_addons").$type<string[]>().notNull().default([]),
    unitPriceSnapshot: numeric("unit_price_snapshot", { precision: 14, scale: 2 }).notNull(),
    estimatedPrice: numeric("estimated_price", { precision: 14, scale: 2 }).notNull(),
    warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
    displayOrder: integer("display_order").notNull().default(0)
  },
  (t) => [index("request_items_request_idx").on(t.requestId)]
);

// ── Bags ─────────────────────────────────────────────────────────────────
export const shipmentBags = app.table(
  "shipment_bags",
  {
    id: uuid("id").primaryKey(),
    bagCode: text("bag_code").notNull(),
    qrPayload: text("qr_payload").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => collectionRequests.id, { onDelete: "cascade" }),
    requestItemId: uuid("request_item_id")
      .notNull()
      .references(() => requestItems.id, { onDelete: "cascade" }),
    citizenUserId: uuid("citizen_user_id")
      .notNull()
      .references(() => users.id),
    wasteTypeCode: text("waste_type_code")
      .notNull()
      .references(() => wasteTypes.code),
    status: bagStatusEnum("status").notNull().default("pending_collection"),
    shipmentId: uuid("shipment_id"),
    finalWeightKg: numeric("final_weight_kg", { precision: 10, scale: 3 }),
    weighedAt: timestamp("weighed_at", { withTimezone: true }),
    weighedBy: uuid("weighed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("shipment_bags_code_key").on(t.bagCode),
    index("shipment_bags_request_idx").on(t.requestId),
    index("shipment_bags_shipment_idx").on(t.shipmentId, t.status),
    index("shipment_bags_status_idx").on(t.status),
    index("shipment_bags_citizen_idx").on(t.citizenUserId)
  ]
);

// ── Traceability (append-only hash chain) ────────────────────────────────
export const trackingEvents = app.table(
  "tracking_events",
  {
    id: uuid("id").primaryKey(),
    aggregateType: aggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    /** 1-based, per-aggregate, gap-free. */
    seq: integer("seq").notNull(),
    statusCode: text("status_code").notNull(),
    actorRole: chainRoleEnum("actor_role"),
    actorRef: text("actor_ref"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    prevHash: text("prev_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("tracking_events_aggregate_seq_key").on(t.aggregateType, t.aggregateId, t.seq),
    index("tracking_events_aggregate_idx").on(t.aggregateId)
  ]
);

// ── Shipments ────────────────────────────────────────────────────────────
export const shipments = app.table(
  "shipments",
  {
    id: uuid("id").primaryKey(),
    shipmentNumber: bigint("shipment_number", { mode: "number" }).notNull(),
    status: shipmentStatusEnum("status").notNull().default("open"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    buyerName: text("buyer_name"),
    notes: text("notes"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    version: integer("version").notNull().default(1)
  },
  (t) => [
    uniqueIndex("shipments_number_key").on(t.shipmentNumber),
    index("shipments_status_idx").on(t.status, t.openedAt)
  ]
);

// ── Finance ──────────────────────────────────────────────────────────────
export const salesInvoices = app.table(
  "sales_invoices",
  {
    id: uuid("id").primaryKey(),
    invoiceNumber: bigint("invoice_number", { mode: "number" }).notNull(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("ILS"),
    /** Frozen split percentages at invoicing time. */
    splitsSnapshot: jsonb("splits_snapshot").$type<Record<string, unknown>>().notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    status: invoiceStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    reversalOf: uuid("reversal_of"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("sales_invoices_number_key").on(t.invoiceNumber),
    index("sales_invoices_shipment_idx").on(t.shipmentId, t.status)
  ]
);

export const payouts = app.table(
  "payouts",
  {
    id: uuid("id").primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),
    beneficiaryType: beneficiaryTypeEnum("beneficiary_type").notNull(),
    beneficiaryUserId: uuid("beneficiary_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    weightBasisKg: numeric("weight_basis_kg", { precision: 10, scale: 3 }),
    status: payoutStatusEnum("status").notNull().default("calculated"),
    reason: text("reason"),
    voidReason: text("void_reason"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true })
  },
  (t) => [
    index("payouts_invoice_idx").on(t.invoiceId),
    index("payouts_beneficiary_idx").on(t.beneficiaryUserId, t.status)
  ]
);

export const ledgerEntries = app.table(
  "ledger_entries",
  {
    id: uuid("id").primaryKey(),
    entryNumber: bigint("entry_number", { mode: "number" }).notNull(),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    invoiceId: uuid("invoice_id").references(() => salesInvoices.id, { onDelete: "set null" }),
    payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("ledger_entries_number_key").on(t.entryNumber),
    index("ledger_entries_invoice_idx").on(t.invoiceId),
    index("ledger_entries_type_idx").on(t.entryType, t.createdAt)
  ]
);

// ── Infrastructure concerns ──────────────────────────────────────────────
export const idempotencyKeys = app.table(
  "idempotency_keys",
  {
    keyHash: text("key_hash").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (t) => [index("idempotency_keys_expires_idx").on(t.expiresAt)]
);

export const outbox = app.table(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true })
  },
  (t) => [index("outbox_unprocessed_idx").on(t.processedAt)]
);

// ── Shared row types (read models) ───────────────────────────────────────
export type UserRow = typeof users.$inferSelect;
export type WasteTypeRow = typeof wasteTypes.$inferSelect;
export type PriceAddonRow = typeof priceAddons.$inferSelect;
export type CollectionRequestRow = typeof collectionRequests.$inferSelect;
export type RequestItemRow = typeof requestItems.$inferSelect;
export type ShipmentBagRow = typeof shipmentBags.$inferSelect;
export type TrackingEventRow = typeof trackingEvents.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type SalesInvoiceRow = typeof salesInvoices.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type ServiceAreaRow = typeof serviceAreas.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
