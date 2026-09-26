/**
 * Authority feature — dashboard (dispatch queue) + requests + detail.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Card, EmptyState, ErrorState, Loading, PageHeader, StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime } from "../../shared/lib/format.js";
import { TransitionAction, nextStepFor } from "../../shared/ui/transition-action.js";

interface AreaCollector {
  userId: string;
  displayName: string;
  /** Requests currently assigned to them and not yet collected. */
  activeLoad: number;
}

interface WasteInventoryRow {
  wasteTypeCode: string;
  nameAr: string;
  unit: string;
  /** Awaiting collection — summed from citizens' estimates at request time. */
  pendingQuantity: string;
  pendingWeightKg: string;
  /** Actually collected & weighed on the real scale. */
  collectedBagCount: number;
  collectedWeightKg: string;
}

interface AuthorityDashboardData {
  serviceAreaId: string | null;
  statusCounts: Record<string, number>;
  needsDispatch: { id: string; requestNumber: number; citizenName: string | null; createdAt: string; version: number }[];
  areaCollectors: AreaCollector[];
  wasteInventory: WasteInventoryRow[];
  inFlight: number;
}

/** Inline "dispatch now" control on the dashboard queue row — pool or a specific collector. */
function DispatchRow({
  request, collectors, onDone
}: {
  request: AuthorityDashboardData["needsDispatch"][number];
  collectors: AreaCollector[];
  onDone: () => void;
}): React.ReactNode {
  const [collectorUserId, setCollectorUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/requests/{id}/transitions", {
        params: { path: { id: request.id } },
        body: {
          target: "sent_to_collector",
          expectedVersion: request.version,
          ...(collectorUserId ? { collectorUserId } : {})
        }
      });
      if (!res.response.ok) {
        const data = res.data as { detail?: string } | undefined;
        throw new Error(data?.detail ?? "تعذر التوجيه");
      }
      return res.data;
    },
    onSuccess: onDone,
    onError: (err) => setError(err.message)
  });

  return (
    <tr className="hover:bg-stone-50">
      <Td className="font-semibold">#{request.requestNumber}</Td>
      <Td>{request.citizenName ?? "—"}</Td>
      <Td className="text-stone-500">{formatDateTime(request.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
            value={collectorUserId}
            onChange={(e) => setCollectorUserId(e.target.value)}
          >
            <option value="">— البركة المشتركة —</option>
            {collectors.map((c) => (
              <option key={c.userId} value={c.userId}>{c.displayName} ({c.activeLoad} نشط)</option>
            ))}
          </select>
          <button
            className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            disabled={dispatchMutation.isPending}
            onClick={() => dispatchMutation.mutate()}
          >
            {dispatchMutation.isPending ? "…" : collectorUserId ? "توجيه مباشر" : "إرسال للبركة"}
          </button>
          <Link className="text-brand-700 hover:underline" to={`/authority/requests/${request.id}`}>التفاصيل ←</Link>
        </div>
        {error ? <div className="mt-1"><Alert kind="error">{error}</Alert></div> : null}
      </Td>
    </tr>
  );
}

export function AuthorityDashboard(): React.ReactNode {
  const qc = useQueryClient();
  const dash = useQuery({
    queryKey: ["authority-dashboard"],
    queryFn: async () => (await api.GET("/authority/dashboard")).data as unknown as AuthorityDashboardData | undefined
  });
  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["authority-dashboard"] });

  return (
    <>
      <PageHeader title={ar.roleAuthority} subtitle={ar.dashboard} />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="بانتظار التوجيه" value={d.needsDispatch.length} />
        <StatCard label="قيد التنفيذ" value={d.inFlight} />
        <StatCard label="جامعو المنطقة" value={d.areaCollectors.length} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-bold">طلبات بانتظار التوجيه للجامعين</h2>
        {d.needsDispatch.length === 0 ? (
          <EmptyState label="لا طلبات بانتظار التوجيه" />
        ) : (
          <Table head={[ar.requestNumber, "المواطن", ar.date, ""]}>
            {d.needsDispatch.map((r) => (
              <DispatchRow key={r.id} request={r} collectors={d.areaCollectors} onDone={refresh} />
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold">مخزون المنطقة حسب نوع النفاية</h2>
        {d.wasteInventory.length === 0 ? (
          <EmptyState label="لا بيانات بعد" />
        ) : (
          <Table head={["نوع النفاية", "بانتظار الجمع (الكمية)", "الوزن التقديري (كغ)", "أكياس مُجمّعة", "الوزن الفعلي (كغ)"]}>
            {d.wasteInventory.map((w) => (
              <tr key={w.wasteTypeCode} className="hover:bg-stone-50">
                <Td className="font-semibold">{w.nameAr}</Td>
                <Td>{w.pendingQuantity} {w.unit}</Td>
                <Td className="text-stone-500">{Number(w.pendingWeightKg).toFixed(1)}</Td>
                <Td>{w.collectedBagCount}</Td>
                <Td className="text-stone-500">{Number(w.collectedWeightKg).toFixed(1)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

interface RequestsListData {
  items: { id: string; requestNumber: number; status: string; citizenName: string | null; createdAt: string }[];
  total: number;
}

export function AuthorityRequests(): React.ReactNode {
  const list = useQuery({
    queryKey: ["requests", "authority"],
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
            <Td><Link className="text-brand-700 hover:underline" to={`/authority/requests/${r.id}`}>{ar.details}</Link></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface RequestDetailData {
  request: { id: string; requestNumber: number; status: string; version: number; createdAt: string };
  items: { id: string; wasteTypeCode: string; quantity: string; estimatedPrice: string }[];
  chain: { valid: boolean; events: { seq: number; statusCode: string; occurredAt: string }[] };
}

export function AuthorityRequestDetail(): React.ReactNode {
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
        actions={<Link to="/authority/requests"><span className="text-sm text-brand-700 hover:underline">{ar.back} ←</span></Link>} />
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
              role="authority"
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
