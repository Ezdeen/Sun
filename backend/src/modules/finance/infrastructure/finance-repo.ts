/**
 * Finance repository — invoices, payouts, ledger (append-only), idempotency.
 */
import { and, eq, sql, desc } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import {
  salesInvoices,
  payouts as payoutsTable,
  ledgerEntries,
  idempotencyKeys,
  outbox,
  shipments,
  type SalesInvoiceRow,
  type PayoutRow
} from "../../../shared/db/schema.js";

export async function nextInvoiceNumber(tx: DbOrTx): Promise<number> {
  const res = await tx.execute(sql`SELECT nextval('app.invoice_number_seq') AS n`);
  return Number((res.rows[0] as { n: string }).n);
}

export async function nextLedgerEntryNumbers(tx: DbOrTx, count: number): Promise<number[]> {
  if (count <= 0) return [];
  const res = await tx.execute(
    sql`SELECT nextval('app.ledger_entry_number_seq') AS n FROM generate_series(1, ${count})`
  );
  return (res.rows as { n: string }[]).map((r) => Number(r.n));
}

export async function insertInvoice(
  tx: DbOrTx,
  input: typeof salesInvoices.$inferInsert
): Promise<SalesInvoiceRow> {
  const [row] = await tx.insert(salesInvoices).values(input).returning();
  return row!;
}

export async function insertPayouts(
  tx: DbOrTx,
  rows: (typeof payoutsTable.$inferInsert)[]
): Promise<PayoutRow[]> {
  if (rows.length === 0) return [];
  return tx.insert(payoutsTable).values(rows).returning();
}

export async function insertLedgerEntries(
  tx: DbOrTx,
  rows: (typeof ledgerEntries.$inferInsert)[]
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(ledgerEntries).values(rows);
}

export async function findIdempotencyKey(
  db: DbOrTx,
  keyHash: string
) {
  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.keyHash, keyHash))
    .limit(1);
  return rows[0];
}

export async function insertIdempotencyKey(
  tx: DbOrTx,
  input: {
    keyHash: string;
    userId: string;
    endpoint: string;
    requestHash: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
    expiresAt: Date;
  }
): Promise<void> {
  await tx.insert(idempotencyKeys).values({
    keyHash: input.keyHash,
    userId: input.userId,
    endpoint: input.endpoint,
    requestHash: input.requestHash,
    responseStatus: input.responseStatus,
    responseBody: input.responseBody,
    expiresAt: input.expiresAt
  });
}

export async function insertOutboxEvent(
  tx: DbOrTx,
  input: { aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown> }
): Promise<void> {
  await tx.insert(outbox).values({
    id: crypto.randomUUID(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload
  });
}

export async function getInvoice(db: DbOrTx, id: string): Promise<SalesInvoiceRow | undefined> {
  const rows = await db.select().from(salesInvoices).where(eq(salesInvoices.id, id)).limit(1);
  return rows[0];
}

export async function listInvoices(
  db: DbOrTx,
  page: { limit: number; offset: number },
  filter?: { status?: "active" | "void" }
) {
  const where = filter?.status ? eq(salesInvoices.status, filter.status) : undefined;
  const items = await db
    .select({
      invoice: salesInvoices,
      shipmentNumber: shipments.shipmentNumber
    })
    .from(salesInvoices)
    .leftJoin(shipments, eq(shipments.id, salesInvoices.shipmentId))
    .where(where)
    .orderBy(desc(salesInvoices.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(salesInvoices)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}

export async function payoutsOfInvoice(db: DbOrTx, invoiceId: string): Promise<PayoutRow[]> {
  return db.select().from(payoutsTable).where(eq(payoutsTable.invoiceId, invoiceId));
}

export async function lockPayout(tx: DbOrTx, id: string): Promise<PayoutRow | undefined> {
  const rows = await tx.select().from(payoutsTable).where(eq(payoutsTable.id, id)).for("update").limit(1);
  return rows[0];
}

export async function updatePayout(
  tx: DbOrTx,
  id: string,
  patch: Partial<typeof payoutsTable.$inferInsert>
): Promise<PayoutRow | undefined> {
  const [row] = await tx
    .update(payoutsTable)
    .set(patch)
    .where(eq(payoutsTable.id, id))
    .returning();
  return row;
}

export async function listPayouts(
  db: DbOrTx,
  page: { limit: number; offset: number },
  filter?: { status?: "calculated" | "approved" | "paid" | "void"; beneficiaryUserId?: string }
) {
  const conditions = [];
  if (filter?.status) conditions.push(eq(payoutsTable.status, filter.status));
  if (filter?.beneficiaryUserId) conditions.push(eq(payoutsTable.beneficiaryUserId, filter.beneficiaryUserId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const items = await db
    .select({ payout: payoutsTable, invoiceNumber: salesInvoices.invoiceNumber })
    .from(payoutsTable)
    .leftJoin(salesInvoices, eq(salesInvoices.id, payoutsTable.invoiceId))
    .where(where)
    .orderBy(desc(payoutsTable.calculatedAt))
    .limit(page.limit)
    .offset(page.offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payoutsTable)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}

export async function listLedger(
  db: DbOrTx,
  page: { limit: number; offset: number }
) {
  const items = await db
    .select()
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.entryNumber))
    .limit(page.limit)
    .offset(page.offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ledgerEntries);
  return { items, total: countRow?.count ?? 0 };
}

/** Bags with their collector (via request) for distribution weights. */
export async function distributionWeights(db: DbOrTx, shipmentId: string) {
  const res = await db.execute(sql`
    SELECT
      b.citizen_user_id AS citizen_user_id,
      r.collector_user_id AS collector_user_id,
      b.final_weight_kg::text AS final_weight_kg
    FROM app.shipment_bags b
    JOIN app.collection_requests r ON r.id = b.request_id
    WHERE b.shipment_id = ${shipmentId} AND b.status = 'weighed'
  `);
  return res.rows as { citizen_user_id: string; collector_user_id: string | null; final_weight_kg: string }[];
}

export async function readyToInvoiceShipments(db: DbOrTx, limit = 20) {
  const res = await db.execute(sql`
    SELECT s.id, s.shipment_number, s.opened_at,
           count(b.id)::int AS bag_count,
           count(b.final_weight_kg)::int AS weighed_count,
           coalesce(sum(b.final_weight_kg), 0)::text AS total_weight_kg
    FROM app.shipments s
    LEFT JOIN app.shipment_bags b ON b.shipment_id = s.id
    WHERE s.status = 'open'
    GROUP BY s.id, s.shipment_number, s.opened_at
    HAVING count(b.id) > 0 AND count(b.id) = count(b.final_weight_kg)
    ORDER BY s.opened_at ASC
    LIMIT ${limit}
  `);
  return res.rows as {
    id: string;
    shipment_number: number;
    opened_at: string;
    bag_count: number;
    weighed_count: number;
    total_weight_kg: string;
  }[];
}

export async function financeKpis(db: DbOrTx) {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM app.sales_invoices WHERE status = 'active') AS active_invoices,
      (SELECT coalesce(sum(amount), 0)::text FROM app.sales_invoices WHERE status = 'active') AS total_invoiced,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'calculated') AS payouts_pending,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'approved') AS payouts_approved,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'paid') AS payouts_paid,
      (SELECT coalesce(sum(amount), 0)::text FROM app.payouts WHERE status = 'paid') AS total_paid,
      (SELECT count(*)::int FROM app.ledger_entries) AS ledger_entries
  `);
  return res.rows[0] as {
    active_invoices: number;
    total_invoiced: string;
    payouts_pending: number;
    payouts_approved: number;
    payouts_paid: number;
    total_paid: string;
    ledger_entries: number;
  };
}

export async function cleanupExpiredIdempotencyKeys(db: DbOrTx): Promise<void> {
  await db.execute(sql`DELETE FROM app.idempotency_keys WHERE expires_at < now()`);
}

