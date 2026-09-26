/**
 * Role dashboard read models — pure queries, no writes, no business rules.
 * Each role's dashboard is served by its own query and obeys VisibilityPolicy.
 */
import { sql, eq, desc, inArray } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
import {
  collectionRequests,
  payouts,
  salesInvoices,
  shipmentBags,
  shipments,
  users,
  serviceAreas,
  trackingEvents
} from "../../../shared/db/schema.js";

// ── Citizen ──────────────────────────────────────────────────────────────
export async function citizenDashboard(db: Db, citizenUserId: string) {
  const statusRows = await db.execute(sql`
    SELECT status, count(*)::int AS count FROM app.collection_requests
    WHERE citizen_user_id = ${citizenUserId} GROUP BY status
  `);
  const statusCounts = Object.fromEntries(
    (statusRows.rows as { status: string; count: number }[]).map((r) => [r.status, r.count])
  );

  const lastRequest = await db
    .select()
    .from(collectionRequests)
    .where(eq(collectionRequests.citizenUserId, citizenUserId))
    .orderBy(desc(collectionRequests.createdAt))
    .limit(1);

  const lastPayout = await db
    .select({
      id: payouts.id,
      amount: payouts.amount,
      status: payouts.status,
      paidAt: payouts.paidAt,
      calculatedAt: payouts.calculatedAt
    })
    .from(payouts)
    .where(eq(payouts.beneficiaryUserId, citizenUserId))
    .orderBy(desc(payouts.calculatedAt))
    .limit(1);

  const totalEarned = await db.execute(sql`
    SELECT coalesce(sum(amount), 0)::text AS total FROM app.payouts
    WHERE beneficiary_user_id = ${citizenUserId} AND status IN ('calculated','approved','paid')
  `);

  return {
    role: "citizen",
    statusCounts,
    totalRequests: Object.values(statusCounts).reduce((a: number, b) => a + (b as number), 0),
    lastRequest: lastRequest[0]
      ? {
          id: lastRequest[0].id,
          requestNumber: lastRequest[0].requestNumber,
          status: lastRequest[0].status,
          combinedHash: lastRequest[0].combinedHash,
          createdAt: lastRequest[0].createdAt
        }
      : null,
    lastPayout: lastPayout[0] ?? null,
    totalEarned: (totalEarned.rows[0] as { total: string }).total,
    shortcuts: { createRequest: true, trackLast: lastRequest[0]?.combinedHash ?? null }
  };
}

// ── Collector ────────────────────────────────────────────────────────────
export async function collectorDashboard(db: Db, collectorUserId: string) {
  const areaRows = await db.execute(
    sql`SELECT service_area_id FROM app.collectors WHERE user_id = ${collectorUserId} LIMIT 1`
  );
  const serviceAreaId = (areaRows.rows as { service_area_id: string | null }[])[0]?.service_area_id ?? null;

  const queue = await db
    .select({
      id: collectionRequests.id,
      requestNumber: collectionRequests.requestNumber,
      status: collectionRequests.status,
      scheduledDay: collectionRequests.scheduledDay,
      scheduledHour: collectionRequests.scheduledHour,
      citizenName: users.displayName
    })
    .from(collectionRequests)
    .leftJoin(users, eq(users.id, collectionRequests.citizenUserId))
    .where(
      sql`(${collectionRequests.collectorUserId} = ${collectorUserId}
        OR (${collectionRequests.status} = 'sent_to_collector'
            AND ${collectionRequests.collectorUserId} IS NULL
            ${serviceAreaId ? sql`AND ${collectionRequests.serviceAreaId} = ${serviceAreaId}` : sql``}))
        AND ${collectionRequests.status} IN ('sent_to_collector','on_the_way','arrived')`
    )
    .orderBy(desc(collectionRequests.createdAt))
    .limit(20);

  const totals = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'collected')::int AS collected_today,
      count(*) FILTER (WHERE collector_user_id = ${collectorUserId} AND status IN ('collected','sorted','sold'))::int AS lifetime_completed,
      coalesce((
        SELECT sum(p.amount)::text FROM app.payouts p
        WHERE p.beneficiary_user_id = ${collectorUserId} AND p.status IN ('calculated','approved','paid')
      ), '0.00') AS total_earned
    FROM app.collection_requests WHERE collector_user_id = ${collectorUserId}
  `);

  return {
    role: "collector",
    serviceAreaId,
    queue,
    operational: (totals.rows as { collected_today: number; lifetime_completed: number; total_earned: string }[])[0],
    shortcuts: { openSchedule: true }
  };
}

// ── Authority ────────────────────────────────────────────────────────────
export async function authorityDashboard(db: Db, serviceAreaId: string | null) {
  const areaFilter = serviceAreaId ? sql`WHERE r.service_area_id = ${serviceAreaId}` : sql``;
  const statusRows = await db.execute(sql`
    SELECT r.status, count(*)::int AS count
    FROM app.collection_requests r ${areaFilter} GROUP BY r.status
  `);
  const statusCounts = Object.fromEntries(
    (statusRows.rows as { status: string; count: number }[]).map((r) => [r.status, r.count])
  );

  const needsDispatch = await db
    .select({
      id: collectionRequests.id,
      requestNumber: collectionRequests.requestNumber,
      citizenName: users.displayName,
      createdAt: collectionRequests.createdAt,
      version: collectionRequests.version
    })
    .from(collectionRequests)
    .leftJoin(users, eq(users.id, collectionRequests.citizenUserId))
    .where(
      sql`${collectionRequests.status} = 'received'
        ${serviceAreaId ? sql`AND ${collectionRequests.serviceAreaId} = ${serviceAreaId}` : sql``}`
    )
    .orderBy(collectionRequests.createdAt)
    .limit(20);

  // Collectors serving this area + their current active load, so the
  // authority can pick wisely when dispatching directly to one of them.
  const areaCollectors = serviceAreaId
    ? (
        await db.execute(sql`
          SELECT u.id, u.display_name,
            count(r.id) FILTER (WHERE r.status IN ('sent_to_collector','on_the_way','arrived'))::int AS active_load
          FROM app.collectors c
          JOIN app.users u ON u.id = c.user_id AND u.status = 'active'
          LEFT JOIN app.collection_requests r
            ON r.collector_user_id = u.id AND r.status IN ('sent_to_collector','on_the_way','arrived')
          WHERE c.service_area_id = ${serviceAreaId}
          GROUP BY u.id, u.display_name
          ORDER BY active_load ASC, u.display_name ASC
        `)
      ).rows
    : [];

  // Waste inventory for the area: awaiting collection (estimated at request
  // time) vs. actually collected & weighed (real scale weight).
  let wasteInventory: {
    wasteTypeCode: string;
    nameAr: string;
    unit: string;
    pendingQuantity: string;
    pendingWeightKg: string;
    collectedBagCount: number;
    collectedWeightKg: string;
  }[] = [];
  if (serviceAreaId) {
    const pendingRows = (
      await db.execute(sql`
        SELECT ri.waste_type_code, wt.name_ar, wt.unit,
          coalesce(sum(ri.quantity), 0)::text AS pending_quantity,
          coalesce(sum(ri.weight_kg), 0)::text AS pending_weight_kg
        FROM app.request_items ri
        JOIN app.collection_requests r ON r.id = ri.request_id
        JOIN app.waste_types wt ON wt.code = ri.waste_type_code
        WHERE r.service_area_id = ${serviceAreaId}
          AND r.status IN ('received', 'sent_to_collector', 'on_the_way', 'arrived')
        GROUP BY ri.waste_type_code, wt.name_ar, wt.unit
      `)
    ).rows as {
      waste_type_code: string;
      name_ar: string;
      unit: string;
      pending_quantity: string;
      pending_weight_kg: string;
    }[];

    const collectedRows = (
      await db.execute(sql`
        SELECT b.waste_type_code, wt.name_ar, wt.unit,
          count(*)::int AS bag_count,
          coalesce(sum(b.final_weight_kg), 0)::text AS actual_weight_kg
        FROM app.shipment_bags b
        JOIN app.collection_requests r ON r.id = b.request_id
        JOIN app.waste_types wt ON wt.code = b.waste_type_code
        WHERE r.service_area_id = ${serviceAreaId} AND b.status = 'weighed'
        GROUP BY b.waste_type_code, wt.name_ar, wt.unit
      `)
    ).rows as { waste_type_code: string; name_ar: string; unit: string; bag_count: number; actual_weight_kg: string }[];

    const byCode = new Map<string, (typeof wasteInventory)[number]>();
    for (const r of pendingRows) {
      byCode.set(r.waste_type_code, {
        wasteTypeCode: r.waste_type_code,
        nameAr: r.name_ar,
        unit: r.unit,
        pendingQuantity: r.pending_quantity,
        pendingWeightKg: r.pending_weight_kg,
        collectedBagCount: 0,
        collectedWeightKg: "0"
      });
    }
    for (const r of collectedRows) {
      const existing = byCode.get(r.waste_type_code);
      if (existing) {
        existing.collectedBagCount = r.bag_count;
        existing.collectedWeightKg = r.actual_weight_kg;
      } else {
        byCode.set(r.waste_type_code, {
          wasteTypeCode: r.waste_type_code,
          nameAr: r.name_ar,
          unit: r.unit,
          pendingQuantity: "0",
          pendingWeightKg: "0",
          collectedBagCount: r.bag_count,
          collectedWeightKg: r.actual_weight_kg
        });
      }
    }
    wasteInventory = Array.from(byCode.values()).sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar"));
  }

  return {
    role: "authority",
    serviceAreaId,
    statusCounts,
    needsDispatch,
    areaCollectors: (areaCollectors as { id: string; display_name: string; active_load: number }[]).map((c) => ({
      userId: c.id,
      displayName: c.display_name,
      activeLoad: c.active_load
    })),
    wasteInventory,
    inFlight: (statusRows.rows as { status: string; count: number }[])
      .filter((r) => ["sent_to_collector", "on_the_way", "arrived"].includes(r.status))
      .reduce((acc, r) => acc + r.count, 0)
  };
}

// ── Sorter ───────────────────────────────────────────────────────────────
export async function sorterDashboard(db: Db) {
  const openShipments = await db
    .select({
      id: shipments.id,
      shipmentNumber: shipments.shipmentNumber,
      openedAt: shipments.openedAt,
      buyerName: shipments.buyerName
    })
    .from(shipments)
    .where(eq(shipments.status, "open"))
    .orderBy(desc(shipments.openedAt))
    .limit(10);

  const bagCounts = await db.execute(sql`
    SELECT status, count(*)::int AS count FROM app.shipment_bags GROUP BY status
  `);
  const bagStatusCounts = Object.fromEntries(
    (bagCounts.rows as { status: string; count: number }[]).map((r) => [r.status, r.count])
  );

  const arrivedBags = await db
    .select({
      id: shipmentBags.id,
      bagCode: shipmentBags.bagCode,
      wasteTypeCode: shipmentBags.wasteTypeCode,
      status: shipmentBags.status,
      shipmentId: shipmentBags.shipmentId
    })
    .from(shipmentBags)
    .where(inArray(shipmentBags.status, ["collected", "attached"]))
    .orderBy(desc(shipmentBags.updatedAt))
    .limit(15);

  const recentWeighsRows = await db
    .select({
      bagCode: shipmentBags.bagCode,
      finalWeightKg: shipmentBags.finalWeightKg,
      weighedAt: shipmentBags.weighedAt
    })
    .from(shipmentBags)
    .where(eq(shipmentBags.status, "weighed"))
    .orderBy(desc(shipmentBags.weighedAt))
    .limit(10);

  return {
    role: "sorter",
    openShipments,
    bagStatusCounts,
    arrivedBags,
    recentWeighs: recentWeighsRows
  };
}

// ── Manager ──────────────────────────────────────────────────────────────
export async function managerDashboard(db: Db) {
  const [requestStatuses, bagStatuses, invoiceStats, userCounts, areaList, chainStats] =
    await Promise.all([
      db.execute(sql`SELECT status, count(*)::int AS count FROM app.collection_requests GROUP BY status`),
      db.execute(sql`SELECT status, count(*)::int AS count FROM app.shipment_bags GROUP BY status`),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE status = 'active')::int AS active,
          count(*) FILTER (WHERE status = 'void')::int AS voided,
          coalesce(sum(amount) FILTER (WHERE status = 'active'), 0)::text AS total_amount
        FROM app.sales_invoices
      `),
      db.execute(sql`SELECT role, count(*)::int AS count FROM app.users WHERE status = 'active' GROUP BY role`),
      db.select().from(serviceAreas).orderBy(serviceAreas.code),
      db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM app.tracking_events) AS total_events,
          (SELECT count(DISTINCT aggregate_id)::int FROM app.tracking_events) AS aggregates,
          (SELECT count(*)::int FROM app.outbox WHERE processed_at IS NULL) AS pending_anchors
      `)
    ]);

  return {
    role: "manager",
    requestStatusCounts: Object.fromEntries(
      (requestStatuses.rows as { status: string; count: number }[]).map((r) => [r.status, r.count])
    ),
    bagStatusCounts: Object.fromEntries(
      (bagStatuses.rows as { status: string; count: number }[]).map((r) => [r.status, r.count])
    ),
    invoiceStats: invoiceStats.rows[0],
    usersByRole: Object.fromEntries(
      (userCounts.rows as { role: string; count: number }[]).map((r) => [r.role, r.count])
    ),
    serviceAreas: areaList.map((a) => ({
      id: a.id,
      code: a.code,
      nameAr: a.nameAr,
      zone: a.zone,
      households: a.households
    })),
    traceability: chainStats.rows[0],
    recentInvoices: await db
      .select({
        id: salesInvoices.id,
        invoiceNumber: salesInvoices.invoiceNumber,
        amount: salesInvoices.amount,
        status: salesInvoices.status,
        createdAt: salesInvoices.createdAt
      })
      .from(salesInvoices)
      .orderBy(desc(salesInvoices.createdAt))
      .limit(5),
    lastTrackingEvents: await db
      .select({
        aggregateType: trackingEvents.aggregateType,
        statusCode: trackingEvents.statusCode,
        occurredAt: trackingEvents.occurredAt
      })
      .from(trackingEvents)
      .orderBy(desc(trackingEvents.recordedAt))
      .limit(5)
  };
}

// Re-exported helper for finance dashboard (module-local composition).
export async function financeDashboardData(db: Db) {
  const ready = await db.execute(sql`
    SELECT s.id, s.shipment_number, s.opened_at,
           count(b.id)::int AS bag_count,
           count(b.final_weight_kg)::int AS weighed_count,
           coalesce(sum(b.final_weight_kg), 0)::text AS total_weight_kg
    FROM app.shipments s
    LEFT JOIN app.shipment_bags b ON b.shipment_id = s.id
    WHERE s.status = 'open'
    GROUP BY s.id, s.shipment_number, s.opened_at
    HAVING count(b.id) > 0 AND count(b.id) = count(b.final_weight_kg)
    ORDER BY s.opened_at ASC LIMIT 20
  `);
  const kpis = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM app.sales_invoices WHERE status = 'active') AS active_invoices,
      (SELECT coalesce(sum(amount), 0)::text FROM app.sales_invoices WHERE status = 'active') AS total_invoiced,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'calculated') AS payouts_pending,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'approved') AS payouts_approved,
      (SELECT count(*)::int FROM app.payouts WHERE status = 'paid') AS payouts_paid,
      (SELECT coalesce(sum(amount), 0)::text FROM app.payouts WHERE status = 'paid') AS total_paid,
      (SELECT count(*)::int FROM app.ledger_entries) AS ledger_entries
  `);
  return {
    role: "finance",
    readyToInvoice: ready.rows,
    kpis: kpis.rows[0]
  };
}

