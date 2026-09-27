ALTER TABLE "app"."shipment_bags" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ALTER COLUMN "status" SET DEFAULT 'pending_collection'::text;--> statement-breakpoint
DROP TYPE "app"."bag_status";--> statement-breakpoint
CREATE TYPE "app"."bag_status" AS ENUM('pending_collection', 'collected', 'arrived', 'weighed', 'attached');--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ALTER COLUMN "status" SET DEFAULT 'pending_collection'::"app"."bag_status";--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ALTER COLUMN "status" SET DATA TYPE "app"."bag_status" USING "status"::"app"."bag_status";--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD COLUMN "arrived_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD COLUMN "observed_waste_type_code" text;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD COLUMN "waste_type_mismatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD COLUMN "mismatch_note" text;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_arrived_by_users_id_fk" FOREIGN KEY ("arrived_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_bags" ADD CONSTRAINT "shipment_bags_observed_waste_type_code_waste_types_code_fk" FOREIGN KEY ("observed_waste_type_code") REFERENCES "app"."waste_types"("code") ON DELETE no action ON UPDATE no action;