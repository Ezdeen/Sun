/**
 * Sorter feature — dashboard, shipments (create/attach/weigh), bag lookup.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime, formatWeight } from "../../shared/lib/format.js";

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
        <StatCard label="أكياس مجموعة (بانتظار الربط)" value={d.bagStatusCounts["collected"] ?? 0} />
        <StatCard label="أكياس مربوطة" value={d.bagStatusCounts["attached"] ?? 0} />
        <StatCard label="أكياس موزونة" value={d.bagStatusCounts["weighed"] ?? 0} />
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
          <h2 className="mb-3 font-bold">أكياس واصلة</h2>
          {d.arrivedBags.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2">
              {d.arrivedBags.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2 text-sm">
                  <span className="font-mono text-xs">{b.bagCode}</span>
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
    requestId: string; finalWeightKg: string | null; weighedAt: string | null;
  }[];
}

export function ShipmentDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [bagCode, setBagCode] = useState("");
  const [weight, setWeight] = useState("");
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
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر ربط الكيس");
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

  const weighMutation = useMutation({
    mutationFn: async (bag: ShipmentDetailData["bags"][number]) => {
      const res = await api.POST("/bags/{qr}/weigh", {
        params: { path: { qr: bag.bagCode } },
        body: { finalWeightKg: weight.trim() }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر تسجيل الوزن");
      return res.data;
    },
    onSuccess: () => {
      setWeight("");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["shipment", id] });
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
          <h2 className="mb-3 font-bold">{ar.attachBag}</h2>
          <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); attachMutation.mutate(); }}>
            <input
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
              dir="ltr"
              placeholder="BAG-…"
              value={bagCode}
              onChange={(e) => setBagCode(e.target.value)}
            />
            <Button type="submit" disabled={attachMutation.isPending || bagCode.trim().length < 4}>
              {attachMutation.isPending ? "…" : ar.attachBag}
            </Button>
          </form>
          <p className="mt-2 text-xs text-stone-400">الأكياس المتاحة للحبس: حالتها "تم الجمع" وغير مربوطة بأي صفقة.</p>
        </Card>
      ) : null}
      <Table head={[ar.bagCode, ar.wasteTypes, ar.status, ar.finalWeight, "تاريخ الوزن", ""]}>
        {d.bags.map((b) => (
          <tr key={b.id}>
            <Td className="font-mono text-xs">{b.bagCode}</Td>
            <Td>{b.wasteTypeCode}</Td>
            <Td><StatusBadge code={b.status} label={ar.bagStatus[b.status] ?? b.status} /></Td>
            <Td>{b.finalWeightKg ? formatWeight(b.finalWeightKg) : "—"}</Td>
            <Td className="text-stone-500">{b.weighedAt ? formatDateTime(b.weighedAt) : "—"}</Td>
            <Td>
              {isOpen && b.status === "attached" ? (
                <div className="flex items-center gap-2">
                  <input
                    className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-sm"
                    dir="ltr"
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="كجم"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={weighMutation.isPending || !weight}
                    onClick={() => weighMutation.mutate(b)}
                  >
                    {ar.weighBag}
                  </Button>
                </div>
              ) : null}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/** Weight entry screen — lookup bag by code then weigh. */
export function WeightsPage(): React.ReactNode {
  const [code, setCode] = useState("");
  const [bagCode, setBagCode] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const bag = useQuery({
    queryKey: ["bag", bagCode],
    queryFn: async () => {
      const res = await api.GET("/bags/{qr}", { params: { path: { qr: bagCode } } });
      if (!res.response.ok) throw new Error("كيس غير موجود");
      return res.data as unknown as { bagCode: string; status: string; wasteTypeCode: string; shipmentId: string | null; finalWeightKg: string | null };
    },
    enabled: bagCode.length > 4
  });

  const weighMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/bags/{qr}/weigh", {
        params: { path: { qr: bagCode } },
        body: { finalWeightKg: weight.trim() }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر الوزن");
      return res.data as unknown as { finalWeightKg: string };
    },
    onSuccess: (data) => {
      setSuccess(`تم وزن الكيس ${bagCode}: ${data.finalWeightKg} كجم`);
      setError(null);
      setBagCode("");
      setWeight("");
      void bag.refetch();
    },
    onError: (err) => setError(err.message)
  });

  return (
    <>
      <PageHeader title="تسجيل الأوزان" subtitle="ابحث عن الكيس برمزه ثم سجّل وزنه النهائي" />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setBagCode(code.trim()); }}>
          <input
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
            dir="ltr"
            placeholder="BAG-…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit">بحث</Button>
        </form>
      </Card>
      {bag.isError ? <ErrorState message="كيس غير موجود" /> : null}
      {bag.data ? (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">{bag.data.bagCode}</span>
            <StatusBadge code={bag.data.status} label={ar.bagStatus[bag.data.status] ?? bag.data.status} />
          </div>
          <div className="mt-2 text-sm text-stone-500">
            {bag.data.wasteTypeCode} · {bag.data.finalWeightKg ? `الوزن: ${bag.data.finalWeightKg} كجم` : "غير موزون"}
          </div>
          {bag.data.status === "attached" ? (
            <form className="mt-4 flex gap-3" onSubmit={(e) => { e.preventDefault(); weighMutation.mutate(); }}>
              <Input label={ar.finalWeight} type="number" step="0.001" min="0" dir="ltr" value={weight}
                onChange={(e) => setWeight(e.target.value)} />
              <div className="flex items-end">
                <Button type="submit" disabled={weighMutation.isPending || !weight}>{ar.weighBag}</Button>
              </div>
            </form>
          ) : (
            <p className="mt-3 text-xs text-stone-400">الكيس بحالة {ar.bagStatus[bag.data.status]} — الوزن يتطلب ربطه بصفقة أولاً.</p>
          )}
        </Card>
      ) : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      {success ? <Alert kind="success">{success}</Alert> : null}
    </>
  );
}
