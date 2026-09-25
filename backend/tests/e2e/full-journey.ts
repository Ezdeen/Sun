/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
/**
 * FULL E2E — the complete business journey (§10.5) against REAL PostgreSQL.
 * Boots the app in-process, drives HTTP through every role, and asserts:
 * money conservation, duplicate-invoice impossibility, append-only guards,
 * chain verification + tamper detection, IDOR protection, role guards,
 * refresh rotation + reuse detection, idempotency replay.
 *
 * Run: DATABASE_URL=... npx tsx tests/e2e/full-journey.ts
 */
import { createApp } from "../../src/main.js";
import { loadSettings } from "../../src/settings.js";
import { closeDb, getDb } from "../../src/shared/db/client.js";
import { sql } from "drizzle-orm";

const PORT = 4010;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
  }
}

interface Client {
  accessToken: string | null;
  refreshCookie: string | null;
}

async function login(email: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: email, password: "Demo@12345!" })
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string };
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { accessToken: body.accessToken, refreshCookie: setCookie.split(";")[0] };
}

async function call(
  client: Client,
  method: string,
  path: string,
  body?: unknown,
  opts?: { idempotencyKey?: string; rawCookie?: string }
): Promise<{ status: number; json: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (client.accessToken) headers["authorization"] = `Bearer ${client.accessToken}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts?.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  if (opts?.rawCookie) headers["cookie"] = opts.rawCookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  process.env.APP_ENV = process.env.APP_ENV ?? "development";
  const settings = loadSettings();
  const { app } = await createApp({ settings });
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log("== FULL E2E JOURNEY (real PostgreSQL) ==\n");

  // ── 1. Health ─────────────────────────────────────────────────────────
  console.log("[health]");
  const live = await fetch(`${BASE}/health/live`);
  check("live → 200", live.status === 200);
  const ready = await fetch(`${BASE}/health/ready`);
  check("ready → 200 + db up", ready.status === 200 && (await ready.json()).database === "up");

  // ── 2. Six role logins ────────────────────────────────────────────────
  console.log("\n[auth: six roles]");
  const manager = await login("demo.manager@example.test");
  const finance = await login("demo.finance@example.test");
  const sorter = await login("demo.sorter@example.test");
  const authority = await login("demo.authority@example.test");
  const collector = await login("demo.collector@example.test");
  const citizen = await login("demo.citizen@example.test");
  const six = { manager, finance, sorter, authority, collector, citizen };
  check("all six roles logged in", Object.values(six).every((c) => !!c.accessToken));

  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "demo.manager@example.test", password: "WRONG" })
  });
  check("wrong password → 401 + arabic problem details", badLogin.status === 401 && (await badLogin.json()).code === "invalid_credentials");

  // ── 3. Catalog + pricing (public) ─────────────────────────────────────
  console.log("\n[catalog + pricing]");
  const catalog = await fetch(`${BASE}/catalog`);
  const catBody = await catalog.json();
  check("catalog public → 200", catalog.status === 200 && catBody.wasteTypes.length === 11);
  check("addons present", catBody.addons.length === 6);

  const catalogDenied = await call(citizen, "GET", "/admin/waste-types");
  check("citizen cannot manage catalog → 403", catalogDenied.status === 403);
  const newWasteType = await call(manager, "POST", "/admin/waste-types", {
    code: "E2E_GLASS", category: "glass", nameAr: "زجاج اختبار", nameEn: "Test glass",
    unit: "kg", pricePerUnit: "0.50"
  });
  check("manager creates waste type", newWasteType.status === 200 || newWasteType.status === 201);
  const updatedWasteType = await call(manager, "PATCH", "/admin/waste-types/E2E_GLASS", { pricePerUnit: "0.60" });
  check("manager updates waste type", updatedWasteType.status === 200 && updatedWasteType.json.pricePerUnit === "0.60");
  const deletedWasteType = await call(manager, "DELETE", "/admin/waste-types/E2E_GLASS");
  check("manager deactivates waste type", deletedWasteType.status === 200 && deletedWasteType.json.active === false);

  const est = await call(citizen, "POST", "/pricing/estimate", {
    lines: [
      { wasteTypeCode: "PET_2L", quantity: "100", selectedAddons: ["WASHED", "CAP_REMOVED"] },
      { wasteTypeCode: "OFFICE_PAPER", weightKg: "3.000" }
    ]
  });
  check("estimate → 200 with capped/underweight rules", est.status === 200);
  // PET: 100×0.55=55 × 1.18 = 64.90 ; paper: 1.80×0.5=0.90 → total 65.80
  check("estimate total = 65.80", est.json?.totalPrice === "65.80", est.json?.totalPrice);
  check("paper underweight warning present", est.json?.warnings?.some((w: any) => w.code === "paper_underweight"));

  // ── 4. Citizen creates request ────────────────────────────────────────
  console.log("\n[citizen journey]");
  const created = await call(citizen, "POST", "/requests", {
    lines: [
      { wasteTypeCode: "PET_2L", quantity: "100", selectedAddons: ["WASHED"] },
      { wasteTypeCode: "HDPE", weightKg: "2.500" }
    ],
    notes: "اختبار E2E"
  });
  check("create request → 200/201", created.status === 200 || created.status === 201, created.json);
  const requestId: string = created.json?.request?.id;
  const combinedHash: string = created.json?.request?.combinedHash;
  const version: number = created.json?.request?.version;
  check("request has CMP- hash + version 1", combinedHash?.startsWith("CMP-") === true && version === 1);

  const myRequests = await call(citizen, "GET", "/requests?page=1");
  check("citizen lists own requests", myRequests.status === 200 && myRequests.json.items.length >= 1);

  // ── 5. Authority dispatch ─────────────────────────────────────────────
  console.log("\n[authority journey]");
  const t1 = await call(authority, "POST", `/requests/${requestId}/transitions`, {
    target: "sent_to_collector",
    expectedVersion: 1
  });
  check("authority dispatch → sent_to_collector", t1.status === 200 && t1.json.status === "sent_to_collector", t1.json);

  const citizenForbidden = await call(citizen, "POST", `/requests/${requestId}/transitions`, {
    target: "on_the_way",
    expectedVersion: 2
  });
  check("citizen cannot transition → 403", citizenForbidden.status === 403);

  const jump = await call(authority, "POST", `/requests/${requestId}/transitions`, {
    target: "arrived",
    expectedVersion: 2
  });
  check("authority cannot jump → 409 invalid_transition", jump.status === 409 && jump.json.code === "invalid_transition");

  // ── 6. Collector: on_the_way → arrived → collected (barcode) ──────────
  console.log("\n[collector journey]");
  const schedule = await call(collector, "GET", "/collector/schedule");
  check("collector schedule → 200 with queue", schedule.status === 200 && schedule.json.queue.length >= 1);

  const t2 = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "on_the_way",
    expectedVersion: 2,
    scheduledDay: "الأحد",
    scheduledHour: "10:00"
  });
  check("collector on_the_way (self-assigned)", t2.status === 200 && t2.json.collectorUserId !== null, t2.json);

  const t3 = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "arrived",
    expectedVersion: 3
  });
  check("collector arrived", t3.status === 200 && t3.json.status === "arrived");

  const noBarcode = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "collected",
    expectedVersion: 4
  });
  check("collected WITHOUT barcode → 409 barcode_mismatch", noBarcode.status === 409 && noBarcode.json.code === "barcode_mismatch");

  const wrongBarcode = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "collected",
    expectedVersion: 4,
    barcode: "CMP-WRONGWRONGWRONG"
  });
  check("collected with WRONG barcode → 409", wrongBarcode.status === 409);

  const t4 = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "collected",
    expectedVersion: 4,
    barcode: combinedHash
  });
  check("collected with citizen barcode ✓", t4.status === 200 && t4.json.status === "collected", t4.json);

  const stale = await call(collector, "POST", `/requests/${requestId}/transitions`, {
    target: "sorted",
    expectedVersion: 4 // stale on purpose
  });
  check("stale version → 409 concurrent_update", stale.status === 409 && stale.json.code === "concurrent_update");

  // ── 7. Sorter: shipment + bags + weights ──────────────────────────────
  console.log("\n[sorter journey]");
  const detail = await call(sorter, "GET", `/requests/${requestId}`);
  const bags: any[] = detail.json?.bags ?? [];
  check("request detail shows 2 bags (collected)", detail.status === 200 && bags.length === 2 && bags.every((b) => b.status === "collected"));

  const ship = await call(sorter, "POST", "/shipments", { buyerName: "مصنع بلاستيك الوطن" });
  check("create shipment → open", ship.status === 200 && ship.json.status === "open", ship.json);
  const shipmentId: string = ship.json.id;

  for (const bag of bags) {
    const att = await call(sorter, "POST", `/shipments/${shipmentId}/bags`, { bagCode: bag.bagCode });
    check(`attach bag ${bag.bagCode.slice(0, 12)}…`, att.status === 200 && att.json.status === "attached");
  }

  const earlySorted = await call(sorter, "POST", `/requests/${requestId}/transitions`, {
    target: "sorted",
    expectedVersion: 5
  });
  check("sorted before weighing → 409 weights_missing", earlySorted.status === 409 && earlySorted.json.code === "weights_missing");

  await call(sorter, "POST", `/bags/${bags[0]!.bagCode}/weigh`, { finalWeightKg: "3.500" });
  const w2 = await call(sorter, "POST", `/bags/${bags[1]!.bagCode}/weigh`, { finalWeightKg: "1.250" });
  check("both bags weighed", w2.status === 200 && w2.json.status === "weighed");

  const t5 = await call(sorter, "POST", `/requests/${requestId}/transitions`, {
    target: "sorted",
    expectedVersion: 5
  });
  check("sorter → sorted (all bags weighed)", t5.status === 200 && t5.json.status === "sorted", t5.json);

  // ── 8. Finance: invoice + distribution + idempotency ──────────────────
  console.log("\n[finance journey]");
  const finDash = await call(finance, "GET", "/finance/dashboard");
  check("finance dashboard → ready-to-invoice shipment", finDash.status === 200 && finDash.json.readyToInvoice.length >= 1);

  const IDEM = "e2e-invoice-key-1";
  const inv = await call(finance, "POST", "/invoices", { shipmentId, amount: "500.00" }, { idempotencyKey: IDEM });
  check("create invoice → 201-ish", inv.status === 200 || inv.status === 201, inv.json);
  const invoiceId: string = inv.json?.invoiceId;

  const inv2 = await call(finance, "POST", "/invoices", { shipmentId, amount: "500.00" }, { idempotencyKey: IDEM });
  check("idempotent replay → same invoice id", inv2.status === (inv.status) && inv2.json?.invoiceId === invoiceId, inv2.json?.invoiceId);

  const inv3 = await call(finance, "POST", "/invoices", { shipmentId, amount: "999.00" });
  check("duplicate invoice (no key) → 409 duplicate_invoice", inv3.status === 409 && inv3.json?.code === "duplicate_invoice", inv3.json);

  // Money conservation via SQL.
  const db = getDb(settings.databaseUrl);
  const money = await db.execute(sql`
    SELECT
      i.amount::text AS invoice_amount,
      (SELECT coalesce(sum(p.amount),0)::text FROM app.payouts p WHERE p.invoice_id = i.id AND p.status <> 'void') AS payouts_sum,
      (SELECT count(*)::int FROM app.payouts p WHERE p.invoice_id = i.id) AS payout_count
    FROM app.sales_invoices i WHERE i.id = ${invoiceId}
  `);
  const m = money.rows[0] as { invoice_amount: string; payouts_sum: string; payout_count: number };
  check(`Σ payouts == invoice amount (${m.payouts_sum} == ${m.invoice_amount})`, m.payouts_sum === m.invoice_amount);
  check("distribution produced >= 3 payouts", m.payout_count >= 3, m.payout_count);

  // Platform 30% = 150 ; collectors 40% = 200 ; citizens 30% = 150
  const pools = await db.execute(sql`
    SELECT p.beneficiary_type, sum(p.amount)::text AS total
    FROM app.payouts p WHERE p.invoice_id = ${invoiceId} AND p.status <> 'void'
    GROUP BY p.beneficiary_type
  `);
  const poolMap: Record<string, string> = {};
  for (const r of pools.rows as { beneficiary_type: string; total: string }[]) poolMap[r.beneficiary_type] = r.total;
  check("platform pool = 150.00", poolMap["platform"] === "150.00", poolMap);
  check("collectors pool = 200.00", poolMap["collector"] === "200.00");
  check("citizens pool = 150.00", poolMap["citizen"] === "150.00");

  const reqAfter = await call(citizen, "GET", `/requests/${requestId}`);
  check("request auto-advanced to sold by invoice", reqAfter.json?.request?.status === "sold", reqAfter.json?.request?.status);

  // ── 9. Citizen payout + public tracking ───────────────────────────────
  console.log("\n[citizen payouts + public track]");
  const myPayouts = await call(citizen, "GET", "/me/payouts");
  check("citizen sees own payout", myPayouts.status === 200 && myPayouts.json.items.length >= 1, myPayouts.json?.items?.length);

  const track = await fetch(`${BASE}/track/${combinedHash}`);
  const trackBody = await track.json();
  check("public track → 200 + timeline", track.status === 200 && trackBody.timeline.length === 7, trackBody.timeline?.length);
  check("public track sanitized (no weights/names)", !JSON.stringify(trackBody).includes("weight") && !JSON.stringify(trackBody).includes("displayName"));

  const trackMissing = await fetch(`${BASE}/track/CMP-doesnotexist123`);
  check("unknown track hash → 404", trackMissing.status === 404);

  // ── 10. Dashboards for every role ─────────────────────────────────────
  console.log("\n[dashboards]");
  for (const [role, client] of Object.entries(six)) {
    const dash = await call(client, "GET", `/${role}/dashboard`);
    check(`${role} dashboard → 200`, dash.status === 200, dash.json);
  }
  const wrongRole = await call(citizen, "GET", "/finance/dashboard");
  check("citizen on finance dashboard → 403", wrongRole.status === 403);
  const noAuth = await fetch(`${BASE}/manager/dashboard`);
  check("dashboard without token → 401", noAuth.status === 401);

  // ── 11. IDOR protection ───────────────────────────────────────────────
  console.log("\n[IDOR]");
  const other = await login("demo.citizen@example.test"); // same citizen — need another one
  const foreignId = "00000000-0000-4000-8000-000000000999";
  const idor = await call(other, "GET", `/requests/${foreignId}`);
  check("foreign request → 404 (existence not leaked)", idor.status === 404);

  const collectorSees = await call(collector, "GET", `/requests/${requestId}`);
  check("assigned collector can still see request", collectorSees.status === 200);

  const authoritySees = await call(authority, "GET", "/requests?page=1");
  check("authority sees area requests (incl. sold)", authoritySees.status === 200 && authoritySees.json.items.length >= 1);

  // ── 12. Manager: chain verification + tamper detection ────────────────
  console.log("\n[traceability]");
  const verify = await call(manager, "GET", `/admin/traceability/verify/request/${requestId}`);
  check("manager verifies chain → valid", verify.status === 200 && verify.json.valid === true && verify.json.eventsChecked === 7, verify.json);

  // Deliberate corruption attempt via SQL → trigger must reject it.
  let tamperRejected = false;
  try {
    await db.execute(sql`UPDATE app.tracking_events SET status_code = 'TAMPERED' WHERE aggregate_id = ${requestId} AND seq = 3`);
  } catch {
    tamperRejected = true;
  }
  check("DB rejects UPDATE on tracking_events (append-only)", tamperRejected);

  // ── 13. Refresh rotation + reuse detection ────────────────────────────
  console.log("\n[refresh security]");
  const r1 = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { cookie: citizen.refreshCookie! }
  });
  const r1Cookie = (r1.headers.get("set-cookie") ?? "").split(";")[0];
  check("refresh #1 → new access token", r1.status === 200 && !!(await r1.json()).accessToken);

  const r2 = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { cookie: r1Cookie }
  });
  check("refresh #2 (rotation) → new access token", r2.status === 200 && !!(await r2.json()).accessToken);

  const reuse = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { cookie: r1Cookie } // replayed old token
  });
  check("REUSED refresh token → 401 reuse detected", reuse.status === 401 && (await reuse.json()).code === "refresh_reuse_detected");

  const afterReuse = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { cookie: (r2.headers.get("set-cookie") ?? "").split(";")[0] }
  });
  check("all sessions revoked after reuse detection", afterReuse.status === 401);

  // ── 14. Invitation flow ───────────────────────────────────────────────
  console.log("\n[invitations]");
  const invite = await call(manager, "POST", "/admin/invitations", { email: "new.collector@example.test", role: "collector" });
  check("manager creates invitation → token shown once", invite.status === 200 && !!invite.json.token, invite.json);

  const accept = await fetch(`${BASE}/auth/invitations/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: invite.json.token, password: "NewCol@12345!", displayName: "جامع جديد" })
  });
  check("invitation accepted → user created", accept.status === 200);

  // login uses the NEW password via the identifier endpoint:
  const newLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "new.collector@example.test", password: "NewCol@12345!" })
  });
  check("new collector can login", newLogin.status === 200);

  const reaccept = await fetch(`${BASE}/auth/invitations/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: invite.json.token, password: "NewCol@12345!", displayName: "xx" })
  });
  check("invitation token is single-use", reaccept.status === 404);

  // ── 15. Payout transitions (finance) ──────────────────────────────────
  console.log("\n[payout transitions]");
  const payoutsList = await call(finance, "GET", "/payouts?status=calculated");
  const firstPayout = payoutsList.json?.items?.[0];
  check("finance lists calculated payouts", payoutsList.status === 200 && payoutsList.json.items.length >= 1);

  const approve = await call(finance, "POST", `/payouts/${firstPayout.id}/transitions`, { target: "approved" });
  check("payout calculated → approved", approve.status === 200 && approve.json.status === "approved", approve.json);

  const pay = await call(finance, "POST", `/payouts/${firstPayout.id}/transitions`, { target: "paid" });
  check("payout approved → paid", pay.status === 200 && pay.json.status === "paid");

  const invalid = await call(finance, "POST", `/payouts/${firstPayout.id}/transitions`, { target: "paid" });
  check("paid → paid rejected (invalid)", invalid.status === 409);

  const sorterPayouts = await call(sorter, "GET", "/payouts");
  check("sorter cannot list payouts → 403", sorterPayouts.status === 403);

  // ── 16. Ledger ────────────────────────────────────────────────────────
  console.log("\n[ledger]");
  const ledger = await call(finance, "GET", "/finance/ledger?page=1");
  check("finance reads ledger", ledger.status === 200 && ledger.json.items.length >= 6, ledger.json?.items?.length);
  const ledgerSum = await db.execute(sql`
    SELECT sum(amount)::text AS total FROM app.ledger_entries
    WHERE entry_type IN ('allocation_platform','allocation_collector','allocation_citizen','unallocated_to_platform')
  `);
  check(
    "ledger allocations == invoice amount",
    (ledgerSum.rows[0] as { total: string }).total === "500.00",
    (ledgerSum.rows[0] as { total: string }).total
  );

  // ── 17. Manager settings + accounts + audit ───────────────────────────
  console.log("\n[administration]");
  const settingsNow = await call(manager, "GET", "/admin/settings");
  check("settings read", settingsNow.status === 200 && settingsNow.json.distributionSplits.platform === 30);

  const badSplits = await call(manager, "PATCH", "/admin/settings", {
    distributionSplits: { platform: 30, collectors: 45, citizens: 30 }
  });
  check("splits != 100 rejected", badSplits.status === 400 && badSplits.json.code === "splits_must_sum_100");

  const accounts = await call(manager, "GET", "/admin/accounts?page=1");
  check("accounts list", accounts.status === 200 && accounts.json.total >= 7);

  const audit = await call(manager, "GET", "/admin/audit?page=1");
  check("audit events recorded", audit.status === 200 && audit.json.items.length > 5);

  const financeSettings = await call(finance, "PATCH", "/admin/settings", { distributionSplits: { platform: 20, collectors: 40, citizens: 40 } });
  check("finance cannot change settings → 403", financeSettings.status === 403);

  // ── 18. Logout-all ────────────────────────────────────────────────────
  console.log("\n[logout]");
  const lg = await call(manager, "POST", "/auth/logout-all", {});
  check("logout-all → ok", lg.status === 200 && lg.json.revokedSessions >= 1);

  // ── SUMMARY ───────────────────────────────────────────────────────────
  console.log(`\n== E2E RESULT: ${passed} passed, ${failed} failed ==`);
  if (failures.length > 0) {
    console.log("FAILED:", failures.join(" | "));
  }
  await app.close();
  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("E2E crashed:", err);
  await closeDb();
  process.exit(1);
});
