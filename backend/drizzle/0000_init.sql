CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TYPE "app"."aggregate_type" AS ENUM('request', 'shipment', 'bag');--> statement-breakpoint
CREATE TYPE "app"."auth_event_type" AS ENUM('login_success', 'login_failed', 'login_locked', 'refresh_rotated', 'refresh_reuse_detected', 'logout', 'logout_all', 'invitation_created', 'invitation_accepted', 'password_changed', 'account_status_changed', 'override_executed');--> statement-breakpoint
CREATE TYPE "app"."bag_status" AS ENUM('pending_collection', 'collected', 'attached', 'weighed');--> statement-breakpoint
CREATE TYPE "app"."beneficiary_type" AS ENUM('platform', 'collector', 'citizen');--> statement-breakpoint
CREATE TYPE "app"."chain_role" AS ENUM('citizen', 'collector', 'authority', 'sorter', 'finance', 'manager', 'system');--> statement-breakpoint
CREATE TYPE "app"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "app"."invoice_status" AS ENUM('active', 'void');--> statement-breakpoint
CREATE TYPE "app"."ledger_entry_type" AS ENUM('invoice_issued', 'invoice_voided', 'allocation_platform', 'allocation_collector', 'allocation_citizen', 'unallocated_to_platform', 'unallocated_held', 'payout_approved', 'payout_paid', 'payout_voided');--> statement-breakpoint
CREATE TYPE "app"."payout_status" AS ENUM('calculated', 'approved', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "app"."request_status" AS ENUM('received', 'sent_to_collector', 'on_the_way', 'arrived', 'collected', 'sorted', 'sold');--> statement-breakpoint
CREATE TYPE "app"."role" AS ENUM('citizen', 'collector', 'authority', 'sorter', 'finance', 'manager');--> statement-breakpoint
CREATE TYPE "app"."shipment_status" AS ENUM('open', 'sold', 'void');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "app"."auth_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"event_type" "app"."auth_event_type" NOT NULL,
	"ip" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."authorities" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"jurisdiction_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."citizens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"address_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."collection_requests" (
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
--> statement-breakpoint
CREATE TABLE "app"."collectors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_area_id" uuid NOT NULL,
	"vehicle_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."invitations" (
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
--> statement-breakpoint
CREATE TABLE "app"."ledger_entries" (
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
--> statement-breakpoint
CREATE TABLE "app"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."payouts" (
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
--> statement-breakpoint
CREATE TABLE "app"."platform_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."price_addon_waste_types" (
	"addon_code" text NOT NULL,
	"waste_type_code" text NOT NULL,
	CONSTRAINT "price_addon_waste_types_addon_code_waste_type_code_pk" PRIMARY KEY("addon_code","waste_type_code")
);
--> statement-breakpoint
CREATE TABLE "app"."price_addons" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"bonus_percent" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."refresh_tokens" (
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
--> statement-breakpoint
CREATE TABLE "app"."request_items" (
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
--> statement-breakpoint
CREATE TABLE "app"."sales_invoices" (
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
--> statement-breakpoint
CREATE TABLE "app"."service_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"zone" text NOT NULL,
	"households" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shipment_bags" (
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
--> statement-breakpoint
CREATE TABLE "app"."shipments" (
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
--> statement-breakpoint
CREATE TABLE "app"."staff_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tracking_events" (
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
--> statement-breakpoint
CREATE TABLE "app"."users" (
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
--> statement-breakpoint
CREATE TABLE "app"."waste_types" (
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
--> statement-breakpoint
ALTER TABLE "app"."auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."authorities" ADD CONSTRAINT "authorities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."authorities" ADD CONSTRAINT "authorities_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."citizens" ADD CONSTRAINT "citizens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."citizens" ADD CONSTRAINT "citizens_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_requests" ADD CONSTRAINT "collection_requests_citizen_user_id_users_id_fk" FOREIGN KEY ("citizen_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_requests" ADD CONSTRAINT "collection_requests_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_requests" ADD CONSTRAINT "collection_requests_collector_user_id_users_id_fk" FOREIGN KEY ("collector_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collectors" ADD CONSTRAINT "collectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collectors" ADD CONSTRAINT "collectors_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "app"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_addon_waste_types" ADD CONSTRAINT "price_addon_waste_types_addon_code_price_addons_code_fk" FOREIGN KEY ("addon_code") REFERENCES "app"."price_addons"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_addon_waste_types" ADD CONSTRAINT "price_addon_waste_types_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_items" ADD CONSTRAINT "request_items_request_id_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_items" ADD CONSTRAINT "request_items_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoices" ADD CONSTRAINT "sales_invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_request_id_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_request_item_id_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "app"."request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_citizen_user_id_users_id_fk" FOREIGN KEY ("citizen_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_waste_type_code_waste_types_code_fk" FOREIGN KEY ("waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_weighed_by_users_id_fk" FOREIGN KEY ("weighed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "app"."auth_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_requests_number_key" ON "app"."collection_requests" USING btree ("request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_requests_combined_hash_key" ON "app"."collection_requests" USING btree ("combined_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_requests_request_hash_key" ON "app"."collection_requests" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "collection_requests_status_idx" ON "app"."collection_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collection_requests_citizen_idx" ON "app"."collection_requests" USING btree ("citizen_user_id","created_at");--> statement-breakpoint
CREATE INDEX "collection_requests_collector_idx" ON "app"."collection_requests" USING btree ("collector_user_id","status");--> statement-breakpoint
CREATE INDEX "collection_requests_area_idx" ON "app"."collection_requests" USING btree ("service_area_id","status");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "app"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "app"."invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_status_idx" ON "app"."invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_number_key" ON "app"."ledger_entries" USING btree ("entry_number");--> statement-breakpoint
CREATE INDEX "ledger_entries_invoice_idx" ON "app"."ledger_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_type_idx" ON "app"."ledger_entries" USING btree ("entry_type","created_at");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "app"."outbox" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "payouts_invoice_idx" ON "app"."payouts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payouts_beneficiary_idx" ON "app"."payouts" USING btree ("beneficiary_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_settings_key_key" ON "app"."platform_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "price_addons_active_idx" ON "app"."price_addons" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_key" ON "app"."refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "app"."refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "request_items_request_idx" ON "app"."request_items" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_number_key" ON "app"."sales_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "sales_invoices_shipment_idx" ON "app"."sales_invoices" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_code_key" ON "app"."service_areas" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_bags_code_key" ON "app"."shipment_bags" USING btree ("bag_code");--> statement-breakpoint
CREATE INDEX "shipment_bags_request_idx" ON "app"."shipment_bags" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "shipment_bags_shipment_idx" ON "app"."shipment_bags" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE INDEX "shipment_bags_status_idx" ON "app"."shipment_bags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_bags_citizen_idx" ON "app"."shipment_bags" USING btree ("citizen_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_number_key" ON "app"."shipments" USING btree ("shipment_number");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "app"."shipments" USING btree ("status","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_events_aggregate_seq_key" ON "app"."tracking_events" USING btree ("aggregate_type","aggregate_id","seq");--> statement-breakpoint
CREATE INDEX "tracking_events_aggregate_idx" ON "app"."tracking_events" USING btree ("aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "app"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "app"."users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_identity_hash_key" ON "app"."users" USING btree ("identity_hash");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "app"."users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "waste_types_category_idx" ON "app"."waste_types" USING btree ("category","active");