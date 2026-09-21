/**
 * Collector feature — dashboard, schedule (work queue + transitions + scan),
 * requests, payouts.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Card, EmptyState, ErrorState, Loading, PageHeader, StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime, formatMoney } from "../../shared/lib/format.js";
import { TransitionAction, nextStepFor } from "../../shared/ui/transition-action.js";

interface CollectorDashboardData {
  serviceAreaId: string | null;
  queue: { id: string; requestNumber: number; status: string; citizenName: string | null; scheduledDay: string | null; scheduledHour: string | null }[];
  operational: { collected_today: number; lifetime_completed: number; total_earned: string };
}

export function CollectorDashboard(): React.ReactNode {
  const dash = useQuery({
    queryKey: ["collector-dashboard"],
    queryFn: async () => (await api.GET("/collector/dashboard")).data as unknown as CollectorDashboardData | undefined
  });
  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;
  return (
    <>
      <PageHeader title={ar.roleCollector} subtitle={ar.dashboard} />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="طلبات قيد التنفيذ" value={d.queue.length} />
        <StatCard label="جامعة مكتملة" value={d.operational.lifetime_completed} />
        <StatCard label={ar.totalEarned} value={formatMoney(d.operational.total_earned)} />
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">قائمة العمل الحالية</h2>
          <Link className="text-sm text-brand-700 hover:underline" to="/collector/schedule">{ar.schedule} ←</Link>
        </div>
        {d.queue.length === 0 ? (
          <EmptyState label="لا طلبات في قائمتك حالياً" />
        ) : (
          <ul className="space-y-2">
            {d.queue.slice(0, 6).map((q) => (
              <li key={q.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2 text-sm">
                <span className="font-semibold">#{q.requestNumber} · {q.citizenName ?? "—"}</span>
                <StatusBadge code={q.status} label={ar.requestStatus[q.status] ?? q.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

interface ScheduleData {
  serviceAreaId: string | null;
  date: string;
  queue: {
    id: string; requestNumber: number; status: string; version: number;
    citizenName: string | null; citizenPhone: string | null;
    scheduledDay: string | null; scheduledHour: string | null;
    combinedHash: string; qrPayload: string; createdAt: string;
  }[];
  activeCount: number;
}

export function CollectorSchedule(): React.ReactNode {
  const schedule = useQuery({
    queryKey: ["collector-schedule"],
    queryFn: async () => (await api.GET("/collector/schedule")).data as unknown as ScheduleData | undefined
  });
  if (schedule.isLoading) return <Loading />;
  if (schedule.isError || !schedule.data) return <ErrorState />;
  const s = schedule.data;
  return (
    <>
      <PageHeader title={ar.schedule} subtitle={`${s.queue.length} طلب · التاريخ ${s.date}`} />
      {s.queue.length === 0 ? (
        <EmptyState label="لا طلبات في الجدول" />
      ) : (
        <div className="space-y-4">
          {s.queue.map((q) => {
            const next = nextStepFor(q.status);
            return (
              <Card key={q.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold">#{q.requestNumber}</div>
                    <div className="text-sm text-stone-500">{q.citizenName ?? "مواطن"} · {q.citizenPhone ?? ""}</div>
                    <div className="mt-1 text-xs text-stone-400">
                      {q.scheduledDay ? `${q.scheduledDay} ${q.scheduledHour ?? ""}` : formatDateTime(q.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge code={q.status} label={ar.requestStatus[q.status] ?? q.status} />
                    <Link className="text-xs text-brand-700 hover:underline" to={`/collector/requests/${q.id}`}>
                      {ar.details} ←
                    </Link>
                  </div>
                </div>
                {q.status !== "collected" ? (
                  <div className="mt-4 max-w-sm border-t border-stone-100 pt-4">
                    <TransitionAction
                      requestId={q.id}
                      currentStatus={q.status}
                      version={q.version}
                      nextInfo={next}
                      role="collector"
                    />
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-stone-400">
                    باركود التأكيد: <span className="font-mono" dir="ltr">{q.combinedHash}</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

interface RequestsListData {
  items: { id: string; requestNumber: number; status: string; citizenName: string | null; createdAt: string; combinedHash: string }[];
  total: number;
}

export function CollectorRequests(): React.ReactNode {
  const list = useQuery({
    queryKey: ["requests", "collector"],
    queryFn: async () => (await api.GET("/requests", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as RequestsListData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.requests} /><EmptyState /></>;
  return (
    <>
      <PageHeader title={ar.requests} subtitle={`${list.data.total} ${ar.of}`} />
      <Table head={[ar.requestNumber, "المواطن", ar.status, ar.date, ""]}>
        {list.data.items.map((r) => (
          <tr key={r.id} className="hover:bg-stone-50">
            <Td className="font-semibold">#{r.requestNumber}</Td>
            <Td>{r.citizenName ?? "—"}</Td>
            <Td><StatusBadge code={r.status} label={ar.requestStatus[r.status] ?? r.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(r.createdAt)}</Td>
            <Td><Link className="text-brand-700 hover:underline" to={`/collector/requests/${r.id}`}>{ar.details}</Link></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface RequestDetailData {
  request: { id: string; requestNumber: number; status: string; version: number; combinedHash: string; qrPayload: string; createdAt: string; collectorUserId: string | null };
  items: { id: string; wasteTypeCode: string; quantity: string; estimatedPrice: string }[];
  bags: { id: string; bagCode: string; status: string; finalWeightKg: string | null }[];
  chain: { valid: boolean; events: { seq: number; statusCode: string; occurredAt: string }[] };
}

export function CollectorRequestDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({
    queryKey: ["request", id],
    queryFn: async () => (await api.GET("/requests/{id}", { params: { path: { id: id! } } })).data as unknown as RequestDetailData | undefined,
    enabled: !!id
  });
  if (!id) return <ErrorState />;
  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorState />;
  const d = detail.data;
  const next = nextStepFor(d.request.status);
  return (
    <>
      <PageHeader title={`الطلب #${d.request.requestNumber}`}
        actions={<Link to="/collector/requests"><span className="text-sm text-brand-700 hover:underline">{ar.back} ←</span></Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-stone-500">{ar.status}</span>
            <StatusBadge code={d.request.status} label={ar.requestStatus[d.request.status] ?? d.request.status} />
          </div>
          <div className="text-sm text-stone-500">{formatDateTime(d.request.createdAt)}</div>
          <h3 className="mt-4 mb-2 font-bold">{ar.estimate}</h3>
          <ul className="space-y-1 text-sm">
            {d.items.map((it) => (
              <li key={it.id} className="flex justify-between rounded bg-stone-50 px-3 py-2">
                <span>{it.wasteTypeCode}</span><span>{it.estimatedPrice} ₪</span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <TransitionAction
              requestId={d.request.id}
              currentStatus={d.request.status}
              version={d.request.version}
              nextInfo={next}
              role="collector"
            />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">{ar.timeline}</h2>
          <ol className="relative space-y-4 border-s-2 border-stone-200 ps-4">
            {d.chain.events.map((e) => (
              <li key={e.seq} className="relative">
                <span className="absolute -start-[21px] top-1 h-3 w-3 rounded-full bg-brand-600" />
                <div className="text-sm font-semibold">{ar.requestStatus[e.statusCode] ?? e.statusCode}</div>
                <div className="text-xs text-stone-400">{formatDateTime(e.occurredAt)}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

interface PayoutsData {
  items: { id: string; invoiceNumber: number; amount: string; status: string; calculatedAt: string; paidAt: string | null; weightBasisKg: string | null }[];
}

export function CollectorPayouts(): React.ReactNode {
  const payouts = useQuery({
    queryKey: ["my-payouts"],
    queryFn: async () => (await api.GET("/me/payouts", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as PayoutsData | undefined
  });
  if (payouts.isLoading) return <Loading />;
  if (payouts.isError || !payouts.data) return <ErrorState />;
  if (payouts.data.items.length === 0) return <><PageHeader title={ar.myPayouts} /><EmptyState label="لا مستحقات بعد" /></>;
  const total = payouts.data.items.filter((p) => p.status !== "void").reduce((acc, p) => acc + Number.parseFloat(p.amount), 0);
  return (
    <>
      <PageHeader title={ar.myPayouts} subtitle={`${ar.total}: ${total.toFixed(2)} ₪`} />
      <Table head={[ar.invoiceNumber, ar.amount, ar.weight, ar.status, "تاريخ الدفع"]}>
        {payouts.data.items.map((p) => (
          <tr key={p.id}>
            <Td>#{p.invoiceNumber}</Td>
            <Td className="font-bold text-brand-700">{p.amount} ₪</Td>
            <Td>{p.weightBasisKg ?? "—"}</Td>
            <Td><StatusBadge code={p.status} label={ar.payoutStatus[p.status] ?? p.status} /></Td>
            <Td className="text-stone-500">{p.paidAt ? formatDateTime(p.paidAt) : "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/** Scan page — quick barcode verification before collection transition. */
export function CollectorScan(): React.ReactNode {
  return (
    <>
      <PageHeader title={ar.scanBarcode} subtitle="ادخل باركود المواطن لتأكيد الجمع من صفحة الطلب" />
      <Card>
        <p className="text-sm text-stone-500">
          استخدم هذه الشاشة لقراءة الباركود المطبوع على ملصق أكياس المواطن، ثم انتقل إلى الطلب المطابق لتأكيد الجمع.
          الباركود بصيغة <span className="font-mono" dir="ltr">CMP-…</span> أو <span className="font-mono" dir="ltr">WASTE-QR:v1:CMP-…</span>
        </p>
        <div className="mt-4">
          <Link to="/collector/schedule">
            <span className="text-brand-700 hover:underline">الانتقال إلى جدول العمل ←</span>
          </Link>
        </div>
      </Card>
    </>
  );
}
