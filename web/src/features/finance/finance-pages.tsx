/**
 * Finance feature — dashboard, invoices (create from ready shipments),
 * invoice detail (distribution + payout transitions), payouts, ledger.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime, formatMoney, formatWeight } from "../../shared/lib/format.js";

interface FinanceDashboardData {
  readyToInvoice: { id: string; shipment_number: number; opened_at: string; bag_count: number; weighed_count: number; total_weight_kg: string }[];
  kpis: {
    active_invoices: number; total_invoiced: string; payouts_pending: number;
    payouts_approved: number; payouts_paid: number; total_paid: string; ledger_entries: number;
  };
}

export function FinanceDashboard(): React.ReactNode {
  const dash = useQuery({
    queryKey: ["finance-dashboard"],
    queryFn: async () => (await api.GET("/finance/dashboard")).data as unknown as FinanceDashboardData | undefined
  });
  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;
  return (
    <>
      <PageHeader title={ar.roleFinance} subtitle={ar.dashboard} />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="فواتير فعّالة" value={d.kpis.active_invoices} />
        <StatCard label={ar.total} value={formatMoney(d.kpis.total_invoiced)} />
        <StatCard label="مستحقات بانتظار الاعتماد" value={d.kpis.payouts_pending} />
        <StatCard label="مستحقات مدفوعة" value={d.kpis.payouts_paid} hint={formatMoney(d.kpis.total_paid)} />
      </div>
      <Card>
        <h2 className="mb-3 font-bold">{ar.readyToInvoice}</h2>
        {d.readyToInvoice.length === 0 ? (
          <EmptyState label="لا صفقات جاهزة للفوترة (يجب وزن جميع الأكياس)" />
        ) : (
          <Table head={[ar.shipmentNumber, "الأكياس", "الوزن الكلي", ""]}>
            {d.readyToInvoice.map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold">#{s.shipment_number}</Td>
                <Td>{s.weighed_count}/{s.bag_count}</Td>
                <Td>{formatWeight(s.total_weight_kg)}</Td>
                <Td><Link className="text-brand-700 hover:underline" to={`/finance/invoices/new?shipment=${s.id}`}>{ar.createInvoice} ←</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="mt-4">
        <Link to="/finance/ledger"><Button variant="secondary">{ar.ledger}</Button></Link>
      </div>
    </>
  );
}

interface InvoicesListData {
  items: { id: string; invoiceNumber: number; shipmentNumber: number | null; amount: string; status: string; createdAt: string }[];
  total: number;
}

export function FinanceInvoices(): React.ReactNode {
  const list = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.GET("/invoices", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as InvoicesListData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.invoices} /><EmptyState label="لا فواتير بعد" /></>;
  return (
    <>
      <PageHeader title={ar.invoices} subtitle={`${list.data.total} ${ar.of}`} />
      <Table head={[ar.invoiceNumber, "الصفقة", ar.amount, ar.status, ar.date, ""]}>
        {list.data.items.map((i) => (
          <tr key={i.id} className="hover:bg-stone-50">
            <Td className="font-semibold">#{i.invoiceNumber}</Td>
            <Td>#{i.shipmentNumber ?? "—"}</Td>
            <Td className="font-bold text-brand-700">{formatMoney(i.amount)}</Td>
            <Td><StatusBadge code={i.status} label={ar.invoiceStatus[i.status] ?? i.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(i.createdAt)}</Td>
            <Td><Link className="text-brand-700 hover:underline" to={`/finance/invoices/${i.id}`}>{ar.details}</Link></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

export function NewInvoicePage(): React.ReactNode {
  const params = new URLSearchParams(window.location.search);
  const [shipmentId, setShipmentId] = useState(params.get("shipment") ?? "");
  const [amount, setAmount] = useState("");
  const [idemKey] = useState(() => `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ invoiceNumber: number; invoiceId: string } | null>(null);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/invoices", {
        params: { header: { "idempotency-key": idemKey } } as never,
        body: { shipmentId, amount }
      });
      if (!res.response.ok) {
        const data = res.data as unknown as { detail?: string } | undefined;
        throw new Error(data?.detail ?? "تعذر إنشاء الفاتورة");
      }
      return res.data as unknown as { invoiceNumber: number; invoiceId: string };
    },
    onSuccess: (data) => setCreated(data),
    onError: (err) => setError(err.message)
  });

  if (created) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="text-4xl">🧾</div>
        <h1 className="mt-3 text-xl font-bold">تم إنشاء الفاتورة #{created.invoiceNumber} والتوزيع المالي</h1>
        <div className="mt-4 flex justify-center gap-3">
          <Link to={`/finance/invoices/${created.invoiceId}`}><Button>{ar.details}</Button></Link>
          <Button variant="secondary" onClick={() => navigate("/finance/invoices")}>{ar.invoices}</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={ar.createInvoice} subtitle="التوزيع المالي يتم آلياً وذرّياً مع إنشاء الفاتورة" />
      <Card className="mx-auto max-w-lg">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
          <Input label="معرف الصفقة (UUID)" dir="ltr" required value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)} />
          <Input label={`${ar.amount} (₪)`} dir="ltr" required type="number" step="0.01" min="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Alert kind="info">
            النسب الحالية: منصة 30% · جامعون 40% · مواطنون 30% — توزيع آلي بطريقة الباقي الأكبر مع ضمان حفظ المبلغ بالكامل.
          </Alert>
          <Button type="submit" disabled={mutation.isPending || !shipmentId || !amount} className="w-full">
            {mutation.isPending ? "…" : ar.createInvoice}
          </Button>
        </form>
      </Card>
    </>
  );
}

interface InvoiceDetailData {
  invoice: {
    id: string; invoiceNumber: number; shipmentId: string; amount: string; currency: string;
    status: string; splitsSnapshot: { platform: number; collectors: number; citizens: number };
    createdAt: string;
  };
  payouts: {
    id: string; beneficiaryType: string; beneficiaryUserId: string | null;
    amount: string; weightBasisKg: string | null; status: string; reason: string | null;
  }[];
}

export function InvoiceDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => (await api.GET("/invoices/{id}", { params: { path: { id: id! } } })).data as unknown as InvoiceDetailData | undefined,
    enabled: !!id
  });

  const payoutMutation = useMutation({
    mutationFn: async (input: { payoutId: string; target: "approved" | "paid"; reason?: string }) => {
      const res = await api.POST("/payouts/{id}/transitions", {
        params: { path: { id: input.payoutId } },
        body: { target: input.target, reason: input.reason }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر تحديث المستحق");
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["invoice", id] });
      void qc.invalidateQueries({ queryKey: ["payouts"] });
    },
    onError: (err) => setError(err.message)
  });

  if (!id) return <ErrorState />;
  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorState />;
  const d = detail.data;

  const totals = d.payouts.reduce<Record<string, number>>((acc, p) => {
    if (p.status !== "void") acc[p.beneficiaryType] = (acc[p.beneficiaryType] ?? 0) + Number.parseFloat(p.amount);
    return acc;
  }, {});

  return (
    <>
      <PageHeader title={`فاتورة #${d.invoice.invoiceNumber}`}
        subtitle={`الصفقة ${d.invoice.shipmentId.slice(0, 8)}… · ${formatDateTime(d.invoice.createdAt)}`}
        actions={<Link to="/finance/invoices"><span className="text-sm text-brand-700 hover:underline">{ar.back} ←</span></Link>} />
      {error ? <div className="mb-4"><Alert kind="error">{error}</Alert></div> : null}
      <div className="mb-4 flex flex-wrap gap-4">
        <StatCard label={ar.amount} value={formatMoney(d.invoice.amount)} />
        <StatCard label="حصة المنصة" value={formatMoney(String(totals["platform"] ?? 0))} hint={`${d.invoice.splitsSnapshot.platform}%`} />
        <StatCard label="حصة الجامعين" value={formatMoney(String(totals["collector"] ?? 0))} hint={`${d.invoice.splitsSnapshot.collectors}%`} />
        <StatCard label="حصة المواطنين" value={formatMoney(String(totals["citizen"] ?? 0))} hint={`${d.invoice.splitsSnapshot.citizens}%`} />
      </div>
      <Table head={["المستفيد", "المعرف", ar.amount, ar.weight, ar.status, ""]}>
        {d.payouts.map((p) => (
          <tr key={p.id}>
            <Td>{p.beneficiaryType === "platform" ? "المنصة" : p.beneficiaryType === "collector" ? "جامع" : "مواطن"}{p.reason ? ` (${p.reason})` : ""}</Td>
            <Td className="font-mono text-xs text-stone-400">{p.beneficiaryUserId?.slice(0, 8) ?? "—"}</Td>
            <Td className="font-semibold">{formatMoney(p.amount)}</Td>
            <Td>{p.weightBasisKg ? formatWeight(p.weightBasisKg) : "—"}</Td>
            <Td><StatusBadge code={p.status} label={ar.payoutStatus[p.status] ?? p.status} /></Td>
            <Td>
              <div className="flex gap-2">
                {p.status === "calculated" ? (
                  <Button variant="secondary" onClick={() => payoutMutation.mutate({ payoutId: p.id, target: "approved" })}>اعتماد</Button>
                ) : null}
                {p.status === "approved" ? (
                  <Button variant="secondary" onClick={() => payoutMutation.mutate({ payoutId: p.id, target: "paid" })}>دفع</Button>
                ) : null}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface PayoutsListData {
  items: {
    id: string; invoiceNumber: number | null; beneficiaryType: string; beneficiaryUserId: string | null;
    amount: string; status: string; reason: string | null; calculatedAt: string; paidAt: string | null;
  }[];
  total: number;
}

export function FinancePayouts(): React.ReactNode {
  const list = useQuery({
    queryKey: ["payouts"],
    queryFn: async () => (await api.GET("/payouts", { params: { query: { page: 1, pageSize: 100 } } })).data as unknown as PayoutsListData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.payouts} /><EmptyState /></>;
  return (
    <>
      <PageHeader title={ar.payouts} subtitle={`${list.data.total} ${ar.of}`} />
      <Table head={[ar.invoiceNumber, "المستفيد", ar.amount, ar.status, "تاريخ الحساب", "تاريخ الدفع"]}>
        {list.data.items.map((p) => (
          <tr key={p.id}>
            <Td>#{p.invoiceNumber ?? "—"}</Td>
            <Td>{p.beneficiaryType === "platform" ? "المنصة" : p.beneficiaryType === "collector" ? "جامع" : "مواطن"}</Td>
            <Td className="font-semibold">{formatMoney(p.amount)}</Td>
            <Td><StatusBadge code={p.status} label={ar.payoutStatus[p.status] ?? p.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(p.calculatedAt)}</Td>
            <Td className="text-stone-500">{p.paidAt ? formatDateTime(p.paidAt) : "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface LedgerData {
  items: { id: string; entryNumber: number; entryType: string; amount: string; reason: string; createdAt: string }[];
  total: number;
}

const LEDGER_LABELS: Record<string, string> = {
  invoice_issued: "إصدار فاتورة",
  invoice_voided: "إلغاء فاتورة",
  allocation_platform: "حصة منصة",
  allocation_collector: "حصة جامع",
  allocation_citizen: "حصة مواطن",
  unallocated_to_platform: "مبلغ غير مخصص → المنصة",
  unallocated_held: "مبلغ محتفظ به",
  payout_approved: "اعتماد مستحق",
  payout_paid: "دفع مستحق",
  payout_voided: "إلغاء مستحق"
};

export function FinanceLedger(): React.ReactNode {
  const list = useQuery({
    queryKey: ["ledger"],
    queryFn: async () => (await api.GET("/finance/ledger", { params: { query: { page: 1, pageSize: 100 } } })).data as unknown as LedgerData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.ledger} /><EmptyState /></>;
  return (
    <>
      <PageHeader title={ar.ledger} subtitle={`${list.data.total} قيد — الدفتر للقراءة فقط (append-only)`} />
      <Table head={["رقم القيد", "النوع", ar.amount, ar.reason, ar.date]}>
        {list.data.items.map((e) => (
          <tr key={e.id}>
            <Td className="font-semibold">#{e.entryNumber}</Td>
            <Td>{LEDGER_LABELS[e.entryType] ?? e.entryType}</Td>
            <Td className="font-semibold">{formatMoney(e.amount)}</Td>
            <Td className="text-stone-500">{e.reason}</Td>
            <Td className="text-stone-500">{formatDateTime(e.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
