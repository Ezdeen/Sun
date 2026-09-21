-- ═══════════════════════════════════════════════════════════════════════════
-- منصة إدارة النفايات الصلبة وإعادة التدوير — Full database script
-- Supabase / PostgreSQL 16+ compatible
--
-- USAGE (Supabase):
--   1. Open your project → SQL Editor → New query
--   2. Paste this ENTIRE file and Run
--   3. Create the first manager (production): use the backend CLI —
--      pnpm --filter @waste/backend cli create-admin <email> <password>
--      (For DEV databases only: uncomment the demo section at the bottom.)
--
-- Contents:
--   Part 1: schema "app" — enums + tables + indexes + FKs        (migration 0000)
--   Part 2: sequences, partial UNIQUE (1 active invoice/shipment),
--           append-only triggers, RLS deny-all                    (migration 0001)
--   Part 3: reference seed data (waste types, addons, areas, settings)
--   Part 4: DEMO users — DEVELOPMENT ONLY, gated by app.seed_environment
--
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- RLS is ENABLED with NO policies: client SDKs (anon/authenticated) get
-- NOTHING; your backend connects with the service/privileged connection.
-- Regenerate after migration changes: node scripts/generate-supabase-sql.mjs
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- PART 1: Schema (from migration 0000_init — DO NOT edit here; edit the
-- migration and regenerate this file)
-- ─────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS "app";

DO $$ BEGIN
  CREATE TYPE "app"."aggregate_type" AS ENUM('request', 'shipment', 'bag');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."auth_event_type" AS ENUM('login_success', 'login_failed', 'login_locked', 'refresh_rotated', 'refresh_reuse_detected', 'logout', 'logout_all', 'invitation_created', 'invitation_accepted', 'password_changed', 'account_status_changed', 'override_executed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."bag_status" AS ENUM('pending_collection', 'collected', 'attached', 'weighed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."beneficiary_type" AS ENUM('platform', 'collector', 'citizen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."chain_role" AS ENUM('citizen', 'collector', 'authority', 'sorter', 'finance', 'manager', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."invoice_status" AS ENUM('active', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."ledger_entry_type" AS ENUM('invoice_issued', 'invoice_voided', 'allocation_platform', 'allocation_collector', 'allocation_citizen', 'unallocated_to_platform', 'unallocated_held', 'payout_approved', 'payout_paid', 'payout_voided');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."payout_status" AS ENUM('calculated', 'approved', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."request_status" AS ENUM('received', 'sent_to_collector', 'on_the_way', 'arrived', 'collected', 'sorted', 'sold');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."role" AS ENUM('citizen', 'collector', 'authority', 'sorter', 'finance', 'manager');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."shipment_status" AS ENUM('open', 'sold', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "app"."user_status" AS ENUM('pending', 'active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "app"."auth_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"event_type" "app"."auth_event_type" NOT NULL,
	"ip" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."authorities" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"jurisdiction_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."citizens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"address_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."collection_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_number" bigint NOT NULL,
	"citizen_user_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"status" "app"."request_status" DEFAULT 'received' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"collector_user_id" uuid,
	"scheduled_day" text,
	"scheduled_hour" text,
	"combined_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"qr_payload" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"sorted_at" timestamp with time zone,
	"sold_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "app"."collectors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"vehicle_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."idempotency_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "app"."role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" "app"."invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"service_area_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_number" bigint NOT NULL,
	"entry_type" "app"."ledger_entry_type" NOT NULL,
	"invoice_id" uuid,
	"payout_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "app"."payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"beneficiary_type" "app"."beneficiary_type" NOT NULL,
	"beneficiary_user_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"weight_basis_kg" numeric(10, 3),
	"status" "app"."payout_status" DEFAULT 'calculated' NOT NULL,
	"reason" text,
	"void_reason" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "app"."platform_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."price_addon_waste_types" (
	"addon_code" text NOT NULL,
	"waste_type_code" text NOT NULL,
	CONSTRAINT "price_addon_waste_types_addon_code_waste_type_code_pk" PRIMARY KEY("addon_code","waste_type_code")
);

CREATE TABLE IF NOT EXISTS "app"."price_addons" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"bonus_percent" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_from" uuid,
	"replaced_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."request_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"waste_type_code" text NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"weight_kg" numeric(10, 3),
	"selected_addons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_price_snapshot" numeric(14, 2) NOT NULL,
	"estimated_price" numeric(14, 2) NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."sales_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_number" bigint NOT NULL,
	"shipment_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"splits_snapshot" jsonb NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"status" "app"."invoice_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"reversal_of" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."service_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"zone" text NOT NULL,
	"households" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."shipment_bags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bag_code" text NOT NULL,
	"qr_payload" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"citizen_user_id" uuid NOT NULL,
	"waste_type_code" text NOT NULL,
	"status" "app"."bag_status" DEFAULT 'pending_collection' NOT NULL,
	"shipment_id" uuid,
	"final_weight_kg" numeric(10, 3),
	"weighed_at" timestamp with time zone,
	"weighed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_number" bigint NOT NULL,
	"status" "app"."shipment_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"buyer_name" text,
	"notes" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."staff_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."tracking_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" "app"."aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status_code" text NOT NULL,
	"actor_role" "app"."chain_role",
	"actor_ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "app"."role" NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"status" "app"."user_status" DEFAULT 'pending' NOT NULL,
	"identity_hash" text,
	"identity_last4" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app"."waste_types" (
	"code" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"unit" text NOT NULL,
	"price_per_unit" numeric(14, 2) NOT NULL,
	"capacity_weight_kg" numeric(10, 3),
	"reference_price_per_ton" numeric(14, 2),
	"min_weight_kg" numeric(10, 3),
	"is_bulk_only" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"image_ref" text,
	"active" boolean DEFAULT true NOT NULL
);

DO $$ BEGIN
  ALTER TABLE app."auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."authorities" ADD CONSTRAINT "authorities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."authorities" ADD CONSTRAINT "authorities_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."citizens" ADD CONSTRAINT "citizens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."citizens" ADD CONSTRAINT "citizens_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."collection_requests" ADD CONSTRAINT "collection_requests_citizen_user_id_users_id_fk" FOREIGN KEY ("citizen_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."collection_requests" ADD CONSTRAINT "collection_requests_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."collection_requests" ADD CONSTRAINT "collection_requests_collector_user_id_users_id_fk" FOREIGN KEY ("collector_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."collectors" ADD CONSTRAINT "collectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."collectors" ADD CONSTRAINT "collectors_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."payouts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."payouts" ADD CONSTRAINT "payouts_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."payouts" ADD CONSTRAINT "payouts_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."payouts" ADD CONSTRAINT "payouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."price_addon_waste_types" ADD CONSTRAINT "price_addon_waste_types_addon_code_price_addons_code_fk" FOREIGN KEY ("addon_code") REFERENCES "app"."price_addons"("code") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."price_addon_waste_types" ADD CONSTRAINT "price_addon_waste_types_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."request_items" ADD CONSTRAINT "request_items_request_id_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."collection_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."request_items" ADD CONSTRAINT "request_items_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."sales_invoices" ADD CONSTRAINT "sales_invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."shipments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_request_id_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."collection_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_request_item_id_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "app"."request_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_citizen_user_id_users_id_fk" FOREIGN KEY ("citizen_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_weighed_by_users_id_fk" FOREIGN KEY ("weighed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "auth_events_user_idx" ON "app"."auth_events" USING btree ("user_id","occurred_at");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_requests_number_key" ON "app"."collection_requests" USING btree ("request_number");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_requests_combined_hash_key" ON "app"."collection_requests" USING btree ("combined_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_requests_request_hash_key" ON "app"."collection_requests" USING btree ("request_hash");
CREATE INDEX IF NOT EXISTS "collection_requests_status_idx" ON "app"."collection_requests" USING btree ("status");
CREATE INDEX IF NOT EXISTS "collection_requests_citizen_idx" ON "app"."collection_requests" USING btree ("citizen_user_id","created_at");
CREATE INDEX IF NOT EXISTS "collection_requests_collector_idx" ON "app"."collection_requests" USING btree ("collector_user_id","status");
CREATE INDEX IF NOT EXISTS "collection_requests_area_idx" ON "app"."collection_requests" USING btree ("service_area_id","status");
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_idx" ON "app"."idempotency_keys" USING btree ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_key" ON "app"."invitations" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "invitations_status_idx" ON "app"."invitations" USING btree ("status","expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entries_number_key" ON "app"."ledger_entries" USING btree ("entry_number");
CREATE INDEX IF NOT EXISTS "ledger_entries_invoice_idx" ON "app"."ledger_entries" USING btree ("invoice_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_type_idx" ON "app"."ledger_entries" USING btree ("entry_type","created_at");
CREATE INDEX IF NOT EXISTS "outbox_unprocessed_idx" ON "app"."outbox" USING btree ("processed_at");
CREATE INDEX IF NOT EXISTS "payouts_invoice_idx" ON "app"."payouts" USING btree ("invoice_id");
CREATE INDEX IF NOT EXISTS "payouts_beneficiary_idx" ON "app"."payouts" USING btree ("beneficiary_user_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key" ON "app"."platform_settings" USING btree ("key");
CREATE INDEX IF NOT EXISTS "price_addons_active_idx" ON "app"."price_addons" USING btree ("active");
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_hash_key" ON "app"."refresh_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "app"."refresh_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "request_items_request_idx" ON "app"."request_items" USING btree ("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_invoices_number_key" ON "app"."sales_invoices" USING btree ("invoice_number");
CREATE INDEX IF NOT EXISTS "sales_invoices_shipment_idx" ON "app"."sales_invoices" USING btree ("shipment_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "service_areas_code_key" ON "app"."service_areas" USING btree ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_bags_code_key" ON "app"."shipment_bags" USING btree ("bag_code");
CREATE INDEX IF NOT EXISTS "shipment_bags_request_idx" ON "app"."shipment_bags" USING btree ("request_id");
CREATE INDEX IF NOT EXISTS "shipment_bags_shipment_idx" ON "app"."shipment_bags" USING btree ("shipment_id","status");
CREATE INDEX IF NOT EXISTS "shipment_bags_status_idx" ON "app"."shipment_bags" USING btree ("status");
CREATE INDEX IF NOT EXISTS "shipment_bags_citizen_idx" ON "app"."shipment_bags" USING btree ("citizen_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_number_key" ON "app"."shipments" USING btree ("shipment_number");
CREATE INDEX IF NOT EXISTS "shipments_status_idx" ON "app"."shipments" USING btree ("status","opened_at");
CREATE UNIQUE INDEX IF NOT EXISTS "tracking_events_aggregate_seq_key" ON "app"."tracking_events" USING btree ("aggregate_type","aggregate_id","seq");
CREATE INDEX IF NOT EXISTS "tracking_events_aggregate_idx" ON "app"."tracking_events" USING btree ("aggregate_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "app"."users" USING btree ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "app"."users" USING btree ("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "users_identity_hash_key" ON "app"."users" USING btree ("identity_hash");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "app"."users" USING btree ("role","status");
CREATE INDEX IF NOT EXISTS "waste_types_category_idx" ON "app"."waste_types" USING btree ("category","active");

-- ─────────────────────────────────────────────────────────────────────────
-- PART 2: Guards (from migration 0001_guards)
-- ─────────────────────────────────────────────────────────────────────────
-- 0001_guards: sequences, partial unique index, append-only triggers, RLS.
-- Hand-written, reviewable, safe guards. Apply AFTER 0000_init.

-- ── Human-readable numbers via SEQUENCES (never count(*)+1) ──────────────
CREATE SEQUENCE IF NOT EXISTS app.request_number_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS app.shipment_number_seq START 100;
CREATE SEQUENCE IF NOT EXISTS app.invoice_number_seq START 100;
CREATE SEQUENCE IF NOT EXISTS app.ledger_entry_number_seq START 100;

-- ── One ACTIVE invoice per shipment, enforced by the DATABASE ────────────
-- (duplicate invoicing is impossible even under concurrency)
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_active_shipment_key
  ON app.sales_invoices (shipment_id)
  WHERE status = 'active';

-- ── Sanity CHECKs ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE app."sales_invoices" ADD CONSTRAINT "sales_invoices_amount_positive" CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."payouts" ADD CONSTRAINT "payouts_amount_nonnegative" CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."request_items" ADD CONSTRAINT "request_items_quantity_positive" CHECK (quantity > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE app."shipment_bags" ADD CONSTRAINT "shipment_bags_weight_nonnegative" CHECK (final_weight_kg IS NULL OR final_weight_kg >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── APPEND-ONLY: tracking_events and ledger_entries reject UPDATE/DELETE ─
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tracking_events_no_update ON app.tracking_events;
CREATE TRIGGER tracking_events_no_update
  BEFORE UPDATE OR DELETE ON app.tracking_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

DROP TRIGGER IF EXISTS ledger_entries_no_update ON app.ledger_entries;
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE OR DELETE ON app.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- ── RLS deny-all (§9.1): backend-only DB access ──────────────────────────
-- No policies are created: Supabase client roles (anon/authenticated) get
-- NOTHING. The application connects with a privileged connection that
-- bypasses RLS. Enable on every app table.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'app'
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- gen_random_uuid() needs pgcrypto on older PG; PG13+ has it built-in.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3: Reference seed data (mirrors backend/src/modules/seeds/data/*.json)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO app.service_areas (id, code, name_ar, name_en, zone, households, active) VALUES
  ('cd4e5058-ab0d-5012-a1ee-71099bf31165'::uuid, 'AL-ZEITOUN', 'الزيتون', 'Al-Zeitoun', 'north', 3200, true),
  ('82e0381d-1778-5118-a4ed-0f788e831120'::uuid, 'AL-BUSTAN', 'البستان', 'Al-Bustan', 'north', 2100, true),
  ('cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1'::uuid, 'AL-WADI', 'الوادي', 'Al-Wadi', 'center', 4700, true),
  ('278488a2-e316-57d0-a7bc-fae45819790e'::uuid, 'AL-RAML', 'الرمل', 'Al-Raml', 'center', 1800, true),
  ('9a3f6222-dcab-5b03-aa42-ad48db2697fc'::uuid, 'AL-SAROU', 'السرو', 'Al-Sarou', 'south', 2600, true),
  ('72bba3bd-45f7-538d-a71a-4fb108a80712'::uuid, 'AL-HAMRA', 'الحمرا', 'Al-Hamra', 'south', 1500, true)
ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  zone = EXCLUDED.zone, households = EXCLUDED.households;

INSERT INTO app.waste_types (code, category, name_ar, name_en, unit, price_per_unit,
  capacity_weight_kg, reference_price_per_ton, min_weight_kg, is_bulk_only, display_order, active) VALUES
  ('PET_1L', 'plastic', 'قوارير بلاستيك 1 لتر', 'PET bottles 1L', 'bottle', 0.35, 0.03, 2000, NULL, false, 10, true),
  ('PET_15L', 'plastic', 'قوارير بلاستيك 1.5 لتر', 'PET bottles 1.5L', 'bottle', 0.45, 0.035, NULL, NULL, false, 11, true),
  ('PET_2L', 'plastic', 'قوارير بلاستيك 2 لتر', 'PET bottles 2L', 'bottle', 0.55, 0.04, NULL, NULL, false, 12, true),
  ('PET_3L_PLUS', 'plastic', 'قوارير بلاستيك 3 لتر وأكثر', 'PET bottles 3L+', 'bottle', 0.80, 0.07, NULL, NULL, false, 13, true),
  ('HDPE', 'plastic', 'بلاستيك HDPE (عبوات منظفات وشامبو وأنابيب)', 'HDPE containers and pipes', 'kg', 2.00, NULL, NULL, NULL, false, 20, true),
  ('LDPE', 'plastic', 'أكياس نايلون LDPE', 'LDPE nylon bags', 'kg', 2.00, NULL, NULL, NULL, false, 21, true),
  ('BOTTLE_CAP', 'plastic', 'غطاء القارورة (منفصلاً)', 'Bottle caps (separate)', 'kg', 2.00, NULL, NULL, NULL, false, 22, true),
  ('OFFICE_PAPER', 'paper', 'ورق مكتبي', 'Office paper', 'kg', 0.60, NULL, 600, 5, false, 30, true),
  ('CARDBOARD', 'paper', 'كرتون', 'Cardboard', 'kg', 0.60, NULL, 600, 5, false, 31, true),
  ('PROHIBITED_PAPER', 'paper', 'ورق ملوّث/شمعي/محارم/حراري — بكيس منفصل', 'Prohibited paper (bulk only)', 'kg', 0, NULL, NULL, NULL, true, 39, true),
  ('COOKING_OIL', 'oil', 'زيت القلي المستعمل', 'Used cooking oil', 'liter', 1.50, NULL, NULL, NULL, false, 40, true)
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  price_per_unit = EXCLUDED.price_per_unit, display_order = EXCLUDED.display_order;

INSERT INTO app.price_addons (code, name_ar, name_en, bonus_percent, active) VALUES
  ('WASHED', 'مغسول', 'Washed', 10, true),
  ('CAP_REMOVED', 'بدون غطاء', 'Cap removed', 8, true),
  ('LABEL_REMOVED', 'أُزيل الملصق', 'Label removed', 7, true),
  ('LDPE_WASHED', 'مغسولة وجافة', 'Washed and dry', 8, true),
  ('DRY_SEPARATED', 'جاف ومفصول', 'Dry and separated', 6, true),
  ('PAPER_CLEAN', 'نظيف وخالٍ من الأطعمة', 'Clean, food-free', 4, true)
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  bonus_percent = EXCLUDED.bonus_percent;

INSERT INTO app.price_addon_waste_types (addon_code, waste_type_code) VALUES
  ('WASHED', 'PET_1L'), ('WASHED', 'PET_15L'), ('WASHED', 'PET_2L'), ('WASHED', 'PET_3L_PLUS'), ('WASHED', 'HDPE'),
  ('CAP_REMOVED', 'PET_1L'), ('CAP_REMOVED', 'PET_15L'), ('CAP_REMOVED', 'PET_2L'), ('CAP_REMOVED', 'PET_3L_PLUS'),
  ('LABEL_REMOVED', 'PET_1L'), ('LABEL_REMOVED', 'PET_15L'), ('LABEL_REMOVED', 'PET_2L'), ('LABEL_REMOVED', 'PET_3L_PLUS'), ('LABEL_REMOVED', 'HDPE'),
  ('LDPE_WASHED', 'LDPE'),
  ('DRY_SEPARATED', 'CARDBOARD'), ('DRY_SEPARATED', 'OFFICE_PAPER'),
  ('PAPER_CLEAN', 'OFFICE_PAPER')
ON CONFLICT DO NOTHING;

INSERT INTO app.platform_settings (id, key, value, version) VALUES
  ('093e03f7-845c-529e-aee2-d8ba45543666', 'pricing',
   '{"bonusCapPercent":25,"paperMinWeightKg":5,"paperUnderweightFactor":0.5,"underUnitFactor":0.5}'::jsonb, 1),
  ('4b1445dc-742a-537f-ac82-32d57fa9195f', 'distribution_splits',
   '{"platform":30,"collectors":40,"citizens":30}'::jsonb, 1),
  ('dd8990f0-b48e-51ed-ab65-eb6821d5da0b', 'distribution_policy',
   '{"unallocated":"to_platform"}'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 4: DEMO USERS — DEVELOPMENT / TEST ONLY (Appendix C)
-- Password for ALL demo accounts: Demo@12345!
-- Gated by app.seed_environment: uncomment BOTH the set_config line AND
-- remove the block comment /* ... */ around the transaction, then run.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT set_config('app.seed_environment', 'development', false);

/*
BEGIN;
DO $$
BEGIN
  IF current_setting('app.seed_environment', true) IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'Development-only seed. Set app.seed_environment=development first.';
  END IF;
END $$;

WITH demo_users AS (
  SELECT * FROM (VALUES
    ('10000000-0000-4000-8000-000000000001'::uuid, 'manager',   'مدير تجريبي',   'demo.manager@example.test'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'finance',   'مالية تجريبية', 'demo.finance@example.test'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'sorter',    'فرز تجريبي',    'demo.sorter@example.test'),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'authority', 'هيئة تجريبية',  'demo.authority@example.test'),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'collector', 'جامع تجريبي',   'demo.collector@example.test'),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'citizen',   'مواطن تجريبي',  'demo.citizen@example.test')
  ) AS t(id, role, display_name, email)
)
INSERT INTO app.users (id, role, display_name, email, status, created_at, updated_at)
SELECT id, role, display_name, email, 'active', NOW(), NOW()
FROM demo_users
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role, display_name = EXCLUDED.display_name,
    email = EXCLUDED.email, status = 'active', updated_at = NOW();

INSERT INTO app.credentials (user_id, password_hash, password_changed_at, failed_attempts, locked_until, created_at, updated_at)
SELECT id,
  '$argon2id$v=19$m=65536,t=3,p=2$bBprj/gB/j24HF0+3UiRJQ$/b704WrId/6ZNXLyd+5s0voVVjDAC8powvnLbj+F7hM',
  NOW(), 0, NULL, NOW(), NOW()
FROM (VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid),
  ('10000000-0000-4000-8000-000000000002'::uuid),
  ('10000000-0000-4000-8000-000000000003'::uuid),
  ('10000000-0000-4000-8000-000000000004'::uuid),
  ('10000000-0000-4000-8000-000000000005'::uuid),
  ('10000000-0000-4000-8000-000000000006'::uuid)
) AS ids(id)
ON CONFLICT (user_id) DO UPDATE
SET password_hash = EXCLUDED.password_hash, failed_attempts = 0,
    locked_until = NULL, password_changed_at = NOW(), updated_at = NOW();

-- Role profiles (Al-Wadi default area)
INSERT INTO app.citizens    (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000006', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.collectors  (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000005', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.authorities (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000004', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.staff_profiles (user_id, title) VALUES
  ('10000000-0000-4000-8000-000000000001', 'مدير تجريبي'),
  ('10000000-0000-4000-8000-000000000002', 'مالية تجريبية'),
  ('10000000-0000-4000-8000-000000000003', 'فرز تجريبي')
ON CONFLICT DO NOTHING;

COMMIT;
*/
-- ▲▲ END OF DEV-ONLY DEMO SECTION ▲▲

-- ── Verify installation ────────────────────────────────────────────────────
-- SELECT count(*) FROM app.waste_types;       -- 11
-- SELECT count(*) FROM app.price_addons;      -- 6
-- SELECT count(*) FROM app.service_areas;     -- 6
-- SELECT count(*) FROM app.platform_settings; -- 3
-- SELECT count(*) FROM pg_tables WHERE schemaname='app' AND rowsecurity; -- 24 (RLS on)
