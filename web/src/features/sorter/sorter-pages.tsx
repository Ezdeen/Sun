/**
 * Sorter feature — dashboard, shipments (create/attach), and the unified
 * "sorting station" (arrival check-in → weigh + waste-type confirm →
 * shipment placement). See ASSUMPTIONS A-011 for the pipeline redesign.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Select, StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime, formatWeight } from "../../shared/lib/format.js";
import { LazyQrScanner } from "../../shared/ui/lazy-qr-scanner.js";

interface SorterDashboardData {
  openShipments: { id: string; shipmentNumber: number; openedAt: string; buyerName: string | null }[];
  bagStatusCounts: Record<string, number>;
  arrivedBags: { id: string; bagCode: string; wasteTypeCode: string; status: string; shipmentId: string | null }[];
  recentWeighs: { bagCode: string; finalWeightKg: string | null; weighedAt: string | null }[];
}

export function SorterDashboard(): React.ReactNode {
  const dash = useQuery({
    queryKey: ["sorter-dashboard"],
    queryFn: async () => (await api.GET("/sorter/dashboard")).data as unknown as SorterDashboardData | undefined
  });
  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;
  return (
    <>
      <PageHeader title={ar.roleSorter} subtitle={ar.dashboard}
        actions={<Link to="/sorter/shipments/new"><Button>＋ {ar.newShipment}</Button></Link>} />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="صفقات مفتوحة" value={d.openShipments.length} />
        <StatCard label="بالطريق للفرز (لم تُسجّل وصولها)" value={d.bagStatusCounts["collected"] ?? 0} />
        <StatCard label="واصلة (بانتظار الوزن)" value={d.bagStatusCounts["arrived"] ?? 0} />
        <StatCard label="موزونة (بانتظار الصفقة)" value={d.bagStatusCounts["weighed"] ?? 0} />
        <StatCard label="مربوطة بصفقة" value={d.bagStatusCounts["attached"] ?? 0} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">{ar.shipments} المفتوحة</h2>
          {d.openShipments.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2">
              {d.openShipments.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2 text-sm">
                  <span className="font-semibold">صفقة #{s.shipmentNumber}{s.buyerName ? ` · ${s.buyerName}` : ""}</span>
                  <Link className="text-brand-700 hover:underline" to={`/sorter/shipments/${s.id}`}>{ar.details} ←</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">أكياس قيد المعالجة (وصول/وزن/وضع بالصفقة)</h2>
          {d.arrivedBags.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2">
              {d.arrivedBags.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2 text-sm">
                  <Link className="font-mono text-xs text-brand-700 hover:underline" to={`/sorter/weights?code=${b.bagCode}`}>
                    {b.bagCode}
                  </Link>
                  <StatusBadge code={b.status} label={ar.bagStatus[b.status] ?? b.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

interface ShipmentsListData {
  items: { id: string; shipmentNumber: number; status: string; buyerName: string | null; openedAt: string; soldAt: string | null }[];
  total: number;
}

export function SorterShipments(): React.ReactNode {
  const list = useQuery({
    queryKey: ["shipments"],
    queryFn: async () => (await api.GET("/shipments", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as ShipmentsListData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.shipments} actions={<Link to="/sorter/shipments/new"><Button>＋ {ar.newShipment}</Button></Link>} /><EmptyState /></>;
  return (
    <>
      <PageHeader title={ar.shipments} subtitle={`${list.data.total} ${ar.of}`}
        actions={<Link to="/sorter/shipments/new"><Button>＋ {ar.newShipment}</Button></Link>} />
      <Table head={[ar.shipmentNumber, ar.buyer, ar.status, "تاريخ الفتح", ""]}>
        {list.data.items.map((s) => (
          <tr key={s.id} className="hover:bg-stone-50">
            <Td className="font-semibold">#{s.shipmentNumber}</Td>
            <Td>{s.buyerName ?? "—"}</Td>
            <Td><StatusBadge code={s.status} label={ar.shipmentStatus[s.status] ?? s.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(s.openedAt)}</Td>
            <Td><Link className="text-brand-700 hover:underline" to={`/sorter/shipments/${s.id}`}>{ar.details}</Link></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

export function NewShipmentPage(): React.ReactNode {
  const [buyerName, setBuyerName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/shipments", {
        body: { buyerName: buyerName || undefined, notes: notes || undefined }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر إنشاء الصفقة");
      return res.data as unknown as { id: string };
    },
    onSuccess: (data) => navigate(`/sorter/shipments/${data.id}`),
    onError: (err) => setError(err.message)
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };
  return (
    <>
      <PageHeader title={ar.newShipment} />
      <Card className="mx-auto max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <Input label={ar.buyer} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="اسم المشتري (اختياري)" />
          <Input label={ar.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button type="submit" disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "…" : "إنشاء الصفقة"}
          </Button>
        </form>
      </Card>
    </>
  );
}

interface ShipmentDetailData {
  shipment: { id: string; shipmentNumber: number; status: string; buyerName: string | null; openedAt: string };
  bags: {
    id: string; bagCode: string; status: string; wasteTypeCode: string;
    citizenUserId: string; collectorUserId: string | null;
    requestId: string; arrivedAt: string | null; finalWeightKg: string | null; weighedAt: string | null;
    observedWasteTypeCode: string | null; wasteTypeMismatch: boolean;
  }[];
}

/** Placing an already-weighed bag into its shipment/batch — step 3 of §5.11.
 *  Weighing itself now happens BEFORE this, at the sorting station
 *  (/sorter/weights) — this screen only accepts bags whose status is
 *  already `weighed`. */
export function ShipmentDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [bagCode, setBagCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => (await api.GET("/shipments/{id}", { params: { path: { id: id! } } })).data as unknown as ShipmentDetailData | undefined,
    enabled: !!id
  });

  const attachMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/shipments/{id}/bags", {
        params: { path: { id: id! } },
        body: { bagCode: bagCode.trim() }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر وضع الكيس في الصفقة");
      return res.data;
    },
    onSuccess: () => {
      setBagCode("");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["shipment", id] });
      void qc.invalidateQueries({ queryKey: ["sorter-dashboard"] });
    },
    onError: (err) => setError(err.message)
  });

  if (!id) return <ErrorState />;
  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorState />;
  const d = detail.data;
  const isOpen = d.shipment.status === "open";

  return (
    <>
      <PageHeader title={`صفقة #${d.shipment.shipmentNumber}`}
        subtitle={d.shipment.buyerName ?? undefined}
        actions={<Link to="/sorter/shipments"><span className="text-sm text-brand-700 hover:underline">{ar.back} ←</span></Link>} />
      {error ? <div className="mb-4"><Alert kind="error">{error}</Alert></div> : null}
      {isOpen ? (
        <Card className="mb-4">
          <h2 className="mb-3 font-bold">وضع كيس موزون في هذه الصفقة</h2>
          <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); attachMutation.mutate(); }}>
            <input
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
              dir="ltr"
              placeholder="BAG-…"
              value={bagCode}
              onChange={(e) => setBagCode(e.target.value)}
            />
            <Button type="submit" disabled={attachMutation.isPending || bagCode.trim().length < 4}>
              {attachMutation.isPending ? "…" : "وضع في الصفقة"}
            </Button>
          </form>
          <p className="mt-2 text-xs text-stone-400">
            يجب أن يكون الكيس قد وُزن مسبقاً (حالته &quot;{ar.bagStatus.weighed}&quot;) في محطة الفرز قبل وضعه هنا —
            <Link className="mr-1 text-brand-700 hover:underline" to="/sorter/weights">اذهب لمحطة الفرز ←</Link>
          </p>
        </Card>
      ) : null}
      <Table head={[ar.bagCode, ar.wasteTypes, ar.status, ar.finalWeight, "تاريخ الوزن", "ملاحظات"]}>
        {d.bags.map((b) => (
          <tr key={b.id}>
            <Td className="font-mono text-xs">{b.bagCode}</Td>
            <Td>{b.wasteTypeCode}</Td>
            <Td><StatusBadge code={b.status} label={ar.bagStatus[b.status] ?? b.status} /></Td>
            <Td>{b.finalWeightKg ? formatWeight(b.finalWeightKg) : "—"}</Td>
            <Td className="text-stone-500">{b.weighedAt ? formatDateTime(b.weighedAt) : "—"}</Td>
            <Td className="text-xs">
              {b.wasteTypeMismatch ? (
                <span className="text-amber-600">⚠ نوع مختلف: {b.observedWasteTypeCode}</span>
              ) : "—"}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface BagLookup {
  id: string;
  bagCode: string;
  qrPayload: string;
  status: string;
  wasteTypeCode: string;
  requestId: string;
  shipmentId: string | null;
  arrivedAt: string | null;
  finalWeightKg: string | null;
  weighedAt: string | null;
  observedWasteTypeCode: string | null;
  wasteTypeMismatch: boolean;
  citizenUserId: string;
}

interface CatalogMini {
  wasteTypes: { code: string; nameAr: string }[];
}

/**
 * THE SORTING STATION — one scan box, the whole pipeline (§5.11):
 *   1) status = collected  → register arrival (check-in)
 *   2) status = arrived    → confirm waste type + lock in the scale
 *      reading, then save
 *   3) status = weighed    → pick the destination shipment/batch and place it
 *   4) status = attached   → done, read-only confirmation
 * The screen itself figures out which step applies from the bag's current
 * status — the sorter never has to remember which page to be on.
 */
export function WeightsPage(): React.ReactNode {
  const qc = useQueryClient();
  const initialCode = new URLSearchParams(window.location.search).get("code") ?? "";
  const [code, setCode] = useState(initialCode);
  const [bagCode, setBagCode] = useState(initialCode);
  const [scanning, setScanning] = useState(false);
  const [observedType, setObservedType] = useState("");
  const [mismatchNote, setMismatchNote] = useState("");
  const [weightReading, setWeightReading] = useState("");
  const [lockedWeight, setLockedWeight] = useState<string | null>(null);
  const [shipmentPick, setShipmentPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => (await api.GET("/catalog")).data as unknown as CatalogMini | undefined
  });

  const bag = useQuery({
    queryKey: ["bag", bagCode],
    queryFn: async () => {
      const res = await api.GET("/bags/{qr}", { params: { path: { qr: bagCode } } });
      if (!res.response.ok) throw new Error("كيس غير موجود");
      const data = res.data as unknown as BagLookup;
      setObservedType((prev) => prev || data.wasteTypeCode);
      return data;
    },
    enabled: bagCode.length > 4
  });

  const openShipments = useQuery({
    queryKey: ["shipments-open-mini"],
    queryFn: async () =>
      (await api.GET("/shipments", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as
        | { items: { id: string; shipmentNumber: number; status: string; buyerName: string | null }[] }
        | undefined,
    enabled: bag.data?.status === "weighed"
  });

  function startOver() {
    setCode(""); setBagCode(""); setObservedType(""); setMismatchNote("");
    setWeightReading(""); setLockedWeight(null); setShipmentPick("");
  }

  const arriveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/bags/{qr}/arrive", { params: { path: { qr: bagCode } } });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر تسجيل الوصول");
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess(`تم تسجيل وصول الكيس ${bagCode} — الخطوة التالية: الوزن.`);
      void bag.refetch();
      void qc.invalidateQueries({ queryKey: ["sorter-dashboard"] });
    },
    onError: (err) => setError(err.message)
  });

  const weighMutation = useMutation({
    mutationFn: async () => {
      if (!lockedWeight) throw new Error("ثبّت قراءة الميزان أولاً قبل الحفظ");
      const res = await api.POST("/bags/{qr}/weigh", {
        params: { path: { qr: bagCode } },
        body: {
          finalWeightKg: lockedWeight,
          observedWasteTypeCode: observedType || undefined,
          mismatchNote: mismatchNote.trim() || undefined
        }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر تسجيل الوزن");
      return res.data as unknown as { finalWeightKg: string; wasteTypeMismatch: boolean };
    },
    onSuccess: (data) => {
      setError(null);
      setSuccess(
        `تم وزن الكيس ${bagCode}: ${data.finalWeightKg} كجم` +
          (data.wasteTypeMismatch ? " — ⚠ نوع النفاية المُلاحَظ مختلف عن المصرَّح به، تم تسجيل ذلك للتتبع." : "")
      );
      setWeightReading("");
      setLockedWeight(null);
      void bag.refetch();
      void qc.invalidateQueries({ queryKey: ["sorter-dashboard"] });
    },
    onError: (err) => setError(err.message)
  });

  const attachMutation = useMutation({
    mutationFn: async () => {
      if (!shipmentPick) throw new Error("اختر الصفقة المخصصة أولاً");
      const res = await api.POST("/shipments/{id}/bags", { params: { path: { id: shipmentPick } }, body: { bagCode } });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر وضع الكيس في الصفقة");
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess(`تم وضع الكيس ${bagCode} في الصفقة المختارة — اكتملت رحلة هذا الكيس.`);
      void qc.invalidateQueries({ queryKey: ["sorter-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      startOver();
    },
    onError: (err) => setError(err.message)
  });

  const weightValid = Number.isFinite(Number.parseFloat(weightReading)) && Number.parseFloat(weightReading) > 0;
  const b = bag.data;

  return (
    <>
      <PageHeader title="محطة الفرز" subtitle="امسح رمز الكيس — الشاشة تنتقل تلقائياً للخطوة التالية المناسبة لحالته" />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setBagCode(code.trim()); }}>
          <input
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
            dir="ltr"
            placeholder="BAG-… أو WASTE-QR:v1:…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit">بحث</Button>
          <Button type="button" variant="secondary" onClick={() => setScanning((v) => !v)}>
            📷 مسح بالكاميرا
          </Button>
        </form>
        {scanning ? (
          <div className="mt-3">
            <LazyQrScanner
              onScan={(text) => { setCode(text); setBagCode(text); setScanning(false); }}
              onCancel={() => setScanning(false)}
            />
          </div>
        ) : null}
      </Card>

      {bag.isError ? <ErrorState message="كيس غير موجود" /> : null}
      {error ? <div className="mb-4"><Alert kind="error">{error}</Alert></div> : null}
      {success ? <div className="mb-4"><Alert kind="success">{success}</Alert></div> : null}

      {b ? (
        <Card>
          <div className="mb-4 flex items-center justify-between border-b border-stone-100 pb-3">
            <span className="font-mono text-sm">{b.bagCode}</span>
            <StatusBadge code={b.status} label={ar.bagStatus[b.status] ?? b.status} />
          </div>

          {b.status === "pending_collection" ? (
            <p className="text-sm text-stone-500">هذا الكيس بانتظار الجمع من عند المواطن — لا يمكن التعامل معه هنا بعد.</p>
          ) : null}

          {b.status === "collected" ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                الخطوة ١: امسح رمز الكيس وطابقه مع الأكياس الواصلة لتسجيل وصوله لمنطقة الفرز.
              </p>
              <Button disabled={arriveMutation.isPending} onClick={() => arriveMutation.mutate()}>
                {arriveMutation.isPending ? "…" : `✓ ${ar.registerArrival}`}
              </Button>
            </div>
          ) : null}

          {b.status === "arrived" ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">الخطوة ٢: تأكيد نوع النفاية ثم تثبيت الوزن من الميزان.</p>
              <Select
                label={ar.confirmWasteType}
                value={observedType}
                onChange={(e) => setObservedType(e.target.value)}
              >
                {(catalog.data?.wasteTypes ?? [{ code: b.wasteTypeCode, nameAr: b.wasteTypeCode }]).map((wt) => (
                  <option key={wt.code} value={wt.code}>
                    {wt.nameAr} {wt.code === b.wasteTypeCode ? "(المصرَّح به عند الطلب)" : ""}
                  </option>
                ))}
              </Select>
              {observedType && observedType !== b.wasteTypeCode ? (
                <Input
                  label="ملاحظة الاختلاف (اختياري)"
                  value={mismatchNote}
                  onChange={(e) => setMismatchNote(e.target.value)}
                  placeholder="مثال: يحتوي خليط بلاستيك وكرتون"
                />
              ) : null}

              {lockedWeight === null ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Input
                    label="قراءة الميزان (كجم)"
                    type="number"
                    step="0.001"
                    min="0"
                    dir="ltr"
                    value={weightReading}
                    onChange={(e) => setWeightReading(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={!weightValid}
                    onClick={() => setLockedWeight(Number.parseFloat(weightReading).toFixed(3))}
                  >
                    {ar.lockWeight}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3">
                  <span className="text-sm text-stone-600">الوزن المثبَّت:</span>
                  <span dir="ltr" className="font-mono text-lg font-bold text-emerald-700">{lockedWeight} كجم</span>
                  <Button variant="ghost" onClick={() => setLockedWeight(null)}>تعديل</Button>
                  <div className="mr-auto">
                    <Button disabled={weighMutation.isPending} onClick={() => weighMutation.mutate()}>
                      {weighMutation.isPending ? "…" : "✓ تأكيد الوزن وحفظه"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {b.status === "weighed" ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                موزون بوزن <strong dir="ltr">{formatWeight(b.finalWeightKg ?? "0")}</strong> —
                الخطوة ٣: اختر الصفقة المخصصة لوضع الكيس فيها.
              </p>
              {b.wasteTypeMismatch ? (
                <Alert kind="warn">⚠ نوع النفاية المُلاحَظ ({b.observedWasteTypeCode}) مختلف عن المصرَّح به ({b.wasteTypeCode}).</Alert>
              ) : null}
              <Select label="الصفقة المخصصة" value={shipmentPick} onChange={(e) => setShipmentPick(e.target.value)}>
                <option value="">— اختر —</option>
                {(openShipments.data?.items ?? []).filter((s) => s.status === "open").map((s) => (
                  <option key={s.id} value={s.id}>صفقة #{s.shipmentNumber}{s.buyerName ? ` · ${s.buyerName}` : ""}</option>
                ))}
              </Select>
              <Button disabled={attachMutation.isPending || !shipmentPick} onClick={() => attachMutation.mutate()}>
                {attachMutation.isPending ? "…" : "✓ وضع الكيس في الصفقة"}
              </Button>
              {(openShipments.data?.items ?? []).filter((s) => s.status === "open").length === 0 ? (
                <p className="text-xs text-stone-400">
                  لا توجد صفقة مفتوحة حالياً — <Link className="text-brand-700 hover:underline" to="/sorter/shipments/new">أنشئ صفقة جديدة ←</Link>
                </p>
              ) : null}
            </div>
          ) : null}

          {b.status === "attached" ? (
            <div className="space-y-2">
              <p className="text-sm text-emerald-700">✓ اكتملت رحلة هذا الكيس: موزون وموضوع في صفقته المخصصة.</p>
              <p className="text-xs text-stone-500">
                الوزن: <span dir="ltr" className="font-mono">{formatWeight(b.finalWeightKg ?? "0")}</span>
                {" · "}تاريخ الوزن: {b.weighedAt ? formatDateTime(b.weighedAt) : "—"}
              </p>
              {b.shipmentId ? (
                <Link className="text-sm text-brand-700 hover:underline" to={`/sorter/shipments/${b.shipmentId}`}>
                  عرض الصفقة ←
                </Link>
              ) : null}
              <div>
                <Button variant="secondary" onClick={startOver}>مسح كيس آخر</Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
