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
ALTER TABLE app.sales_invoices
  ADD CONSTRAINT sales_invoices_amount_positive CHECK (amount > 0);
ALTER TABLE app.payouts
  ADD CONSTRAINT payouts_amount_nonnegative CHECK (amount >= 0);
ALTER TABLE app.request_items
  ADD CONSTRAINT request_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE app.shipment_bags
  ADD CONSTRAINT shipment_bags_weight_nonnegative CHECK (final_weight_kg IS NULL OR final_weight_kg >= 0);

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
