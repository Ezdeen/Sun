/**
 * Citizen feature — dashboard, requests, new request (live estimate),
 * detail with timeline, payouts, profile, public tracking page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Select,
  StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { QrCode } from "../../shared/ui/qr-code.js";
import { formatDateTime, formatMoney, formatWeight, shortHash } from "../../shared/lib/format.js";

interface DashboardData {
  statusCounts: Record<string, number>;
  totalRequests: number;
  lastRequest: { id: string; requestNumber: number; status: string; combinedHash: string; createdAt: string } | null;
  lastPayout: { id: string; amount: string; status: string; paidAt: string | null } | null;
  totalEarned: string;
}

export function CitizenDashboard(): React.ReactNode {
  const dash = useQuery({
    queryKey: ["citizen-dashboard"],
    queryFn: async () => (await api.GET("/citizen/dashboard")).data as unknown as DashboardData | undefined
  });

  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;

  return (
    <>
      <PageHeader title={ar.welcomeCitizen} subtitle={ar.dashboard} />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label={ar.yourRequests} value={d.totalRequests} />
        <StatCard label={ar.totalEarned} value={formatMoney(d.totalEarned)} />
        <StatCard label={ar.lastRequest} value={d.lastRequest ? `#${d.lastRequest.requestNumber}` : "—"}
          hint={d.lastRequest ? ar.requestStatus[d.lastRequest.status] : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">{ar.requests}</h2>
          {Object.keys(d.statusCounts).length === 0 ? (
            <EmptyState label="لم تنشئ أي طلب بعد" />
          ) : (
            <ul className="space-y-2">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <li key={status} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2">
                  <StatusBadge code={status} label={ar.requestStatus[status] ?? status} />
                  <span className="font-bold">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">{ar.myPayouts}</h2>
          {d.lastPayout ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">{ar.amount}</span>
                <span className="font-bold text-brand-700">{formatMoney(d.lastPayout.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">{ar.status}</span>
                <StatusBadge code={d.lastPayout.status} label={ar.payoutStatus[d.lastPayout.status] ?? d.lastPayout.status} />
              </div>
            </div>
          ) : (
            <EmptyState label="لا مستحقات بعد — ستظهر بعد بيع الصفقات" />
          )}
        </Card>
      </div>
      <div className="mt-6 flex gap-3">
        <Link to="/citizen/requests/new">
          <Button>＋ {ar.newRequest}</Button>
        </Link>
        {d.lastRequest ? (
          <Link to={`/citizen/track/${encodeURIComponent(d.lastRequest.combinedHash)}`}>
            <Button variant="secondary">{ar.trackYourRequest}</Button>
          </Link>
        ) : null}
      </div>
    </>
  );
}

interface RequestsListData {
  items: {
    id: string; requestNumber: number; status: string; version: number;
    createdAt: string; collectedAt: string | null; combinedHash: string;
  }[];
  total: number;
}

export function CitizenRequests(): React.ReactNode {
  const list = useQuery({
    queryKey: ["my-requests"],
    queryFn: async () => (await api.GET("/requests", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as RequestsListData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) {
    return (
      <>
        <PageHeader title={ar.yourRequests} />
        <EmptyState label="لم تنشئ أي طلب بعد" />
      </>
    );
  }
  return (
    <>
      <PageHeader title={ar.yourRequests} actions={<Link to="/citizen/requests/new"><Button>＋ {ar.newRequest}</Button></Link>} />
      <Table head={[ar.requestNumber, ar.status, ar.date, "التتبع", ""]}>
        {list.data.items.map((r) => (
          <tr key={r.id} className="hover:bg-stone-50">
            <Td className="font-semibold">#{r.requestNumber}</Td>
            <Td><StatusBadge code={r.status} label={ar.requestStatus[r.status] ?? r.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(r.createdAt)}</Td>
            <Td className="font-mono text-xs text-stone-400" >{shortHash(r.combinedHash)}</Td>
            <Td><Link className="text-brand-700 hover:underline" to={`/citizen/requests/${r.id}`}>{ar.details}</Link></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface CatalogData {
  wasteTypes: {
    code: string; nameAr: string; unit: string; pricePerUnit: string;
    isBulkOnly: boolean; minWeightKg: string | null; category: string;
  }[];
  addons: { code: string; nameAr: string; bonusPercent: string; appliesTo: string[] }[];
}

interface EstimateResult {
  lines: { wasteTypeCode: string; price: string; warnings: { code: string; message: string }[] }[];
  totalPrice: string;
  warnings: { code: string; message: string }[];
}

interface CartLine {
  wasteTypeCode: string;
  quantity: string;
  weightKg: string;
  selectedAddons: string[];
}

export function NewCitizenRequest(): React.ReactNode {
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => (await api.GET("/catalog")).data as unknown as CatalogData | undefined
  });
  const [lines, setLines] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ requestNumber: number; combinedHash: string; qrPayload: string } | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (catalog.data && lines.length === 0) {
      setLines([{ wasteTypeCode: catalog.data.wasteTypes[0]?.code ?? "", quantity: "1", weightKg: "", selectedAddons: [] }]);
    }
  }, [catalog.data, lines.length]);

  const estimateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/pricing/estimate", {
        body: {
          lines: lines
            .filter((l) => l.wasteTypeCode)
            .map((l) => ({
              wasteTypeCode: l.wasteTypeCode,
              quantity: l.quantity || undefined,
              weightKg: l.weightKg || undefined,
              selectedAddons: l.selectedAddons
            }))
        }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "خطأ في التقدير");
      return res.data as unknown as EstimateResult;
    },
    onSuccess: (data) => setEstimate(data),
    onError: (err) => setError(err.message)
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/requests", {
        body: {
          notes: notes || undefined,
          lines: lines
            .filter((l) => l.wasteTypeCode)
            .map((l) => ({
              wasteTypeCode: l.wasteTypeCode,
              quantity: l.quantity || undefined,
              weightKg: l.weightKg || undefined,
              selectedAddons: l.selectedAddons
            }))
        }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر إنشاء الطلب");
      return res.data as unknown as { request: { requestNumber: number; combinedHash: string; qrPayload: string } };
    },
    onSuccess: (data) => {
      setCreated({
        requestNumber: data.request.requestNumber,
        combinedHash: data.request.combinedHash,
        qrPayload: data.request.qrPayload
      });
      void qc.invalidateQueries({ queryKey: ["my-requests"] });
      void qc.invalidateQueries({ queryKey: ["citizen-dashboard"] });
    },
    onError: (err) => setError(err.message)
  });

  if (catalog.isLoading) return <Loading />;
  if (catalog.isError || !catalog.data) return <ErrorState />;

  if (created) {
    return (
      <Card className="mx-auto max-w-2xl text-center">
        <div className="text-4xl">✅</div>
        <h1 className="mt-3 text-xl font-bold">تم إنشاء الطلب #{created.requestNumber}</h1>

        <div className="mt-5 flex flex-col items-center justify-center gap-5 sm:flex-row">
          <QrCode value={created.qrPayload} label="أظهر هذا الرمز للجامع عند الاستلام" />
          <div className="text-start">
            <p className="text-sm text-stone-500">احتفظ بكود التتبع الخاص بك:</p>
            <p className="mt-1 break-all font-mono text-xs" dir="ltr">{created.combinedHash}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <Link to="/citizen/requests"><Button>{ar.yourRequests}</Button></Link>
          <Link to={`/citizen/track/${encodeURIComponent(created.combinedHash)}`}>
            <Button variant="secondary">{ar.trackYourRequest}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const types = catalog.data.wasteTypes;

  const updateLine = (idx: number, patch: Partial<CartLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  return (
    <>
      <PageHeader title={ar.newRequest} subtitle="اختر الأنواع والكميات ثم احصل على تقدير فوري" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {lines.map((line, idx) => {
            const type = types.find((t) => t.code === line.wasteTypeCode);
            const addonsForType = catalog.data!.addons.filter((a) => a.appliesTo.includes(line.wasteTypeCode));
            return (
              <Card key={idx}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label={ar.wasteTypes}
                    value={line.wasteTypeCode}
                    onChange={(e) => updateLine(idx, { wasteTypeCode: e.target.value, selectedAddons: [] })}
                  >
                    {types.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.nameAr} {t.isBulkOnly ? "(كيس منفصل)" : ""}
                      </option>
                    ))}
                  </Select>
                  {type?.unit === "kg" ? (
                    <Input label={ar.weight} type="number" step="0.001" min="0" dir="ltr"
                      value={line.weightKg}
                      onChange={(e) => updateLine(idx, { weightKg: e.target.value })} />
                  ) : (
                    <Input label="الكمية" type="number" step="1" min="0" dir="ltr"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                  )}
                </div>
                {addonsForType.length > 0 ? (
                  <fieldset className="mt-3">
                    <legend className="mb-1 text-sm font-medium text-stone-700">{ar.addons}</legend>
                    <div className="flex flex-wrap gap-2">
                      {addonsForType.map((a) => {
                        const checked = line.selectedAddons.includes(a.code);
                        return (
                          <label key={a.code} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${checked ? "border-brand-500 bg-brand-50 text-brand-800" : "border-stone-300"}`}>
                            <input
                              type="checkbox"
                              className="me-1"
                              checked={checked}
                              onChange={() =>
                                updateLine(idx, {
                                  selectedAddons: checked
                                    ? line.selectedAddons.filter((c) => c !== a.code)
                                    : [...line.selectedAddons, a.code]
                                })
                              }
                            />
                            {a.nameAr} (+{a.bonusPercent}%)
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}
                {lines.length > 1 ? (
                  <button
                    className="mt-3 text-sm text-red-600 hover:underline"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ✕ {ar.remove}
                  </button>
                ) : null}
              </Card>
            );
          })}
          <Button variant="secondary" onClick={() => setLines((prev) => [...prev, { wasteTypeCode: types[0]?.code ?? "", quantity: "1", weightKg: "", selectedAddons: [] }])}>
            ＋ {ar.add}
          </Button>
          <Input label={ar.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-bold">{ar.estimate}</h2>
            <Button className="w-full" onClick={() => estimateMutation.mutate()} disabled={estimateMutation.isPending}>
              {estimateMutation.isPending ? "…" : "احسب التقدير"}
            </Button>
            {estimate ? (
              <div className="mt-4 space-y-2 text-sm">
                {estimate.lines.map((l, i) => {
                  const t = types.find((x) => x.code === l.wasteTypeCode);
                  return (
                    <div key={i} className="flex justify-between">
                      <span className="text-stone-500">{t?.nameAr ?? l.wasteTypeCode}</span>
                      <span className="font-semibold">{formatMoney(l.price)}</span>
                    </div>
                  );
                })}
                <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-bold">
                  <span>{ar.estimatedTotal}</span>
                  <span className="text-brand-700">{formatMoney(estimate.totalPrice)}</span>
                </div>
                {estimate.warnings.length > 0 ? (
                  <div className="space-y-1">
                    {estimate.warnings.map((w, i) => (
                      <Alert key={i} kind="warn">{w.message}</Alert>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-stone-400">التقدير مبدئي ويُعتمد الوزن النهائي عند الفرز.</p>
            )}
          </Card>
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button
            className="w-full"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "…" : "إرسال الطلب"}
          </Button>
        </div>
      </div>
    </>
  );
}

interface RequestDetailData {
  request: {
    id: string; requestNumber: number; status: string; version: number;
    combinedHash: string; qrPayload: string; notes: string | null; createdAt: string;
  };
  items: { id: string; wasteTypeCode: string; quantity: string; estimatedPrice: string; warnings: unknown[] }[];
  bags: { id: string; bagCode: string; status: string; finalWeightKg: string | null; shipmentId: string | null }[];
  chain: { valid: boolean; events: { seq: number; statusCode: string; occurredAt: string }[] };
}

export function CitizenRequestDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({
    queryKey: ["request", id],
    queryFn: async () => (await api.GET("/requests/{id}", { params: { path: { id: id! } } })).data as unknown as RequestDetailData | undefined
  });
  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorState />;
  const d = detail.data;

  return (
    <>
      <PageHeader title={`الطلب #${d.request.requestNumber}`}
        actions={<Link to="/citizen/requests"><Button variant="secondary">{ar.back}</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-stone-500">{ar.status}</span>
            <StatusBadge code={d.request.status} label={ar.requestStatus[d.request.status] ?? d.request.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">{ar.date}</dt><dd>{formatDateTime(d.request.createdAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">كود التتبع</dt><dd className="font-mono text-xs">{d.request.combinedHash}</dd></div>
            {d.request.notes ? <div className="flex justify-between"><dt className="text-stone-500">{ar.notes}</dt><dd>{d.request.notes}</dd></div> : null}
          </dl>
          {["received", "sent_to_collector", "on_the_way", "arrived"].includes(d.request.status) ? (
            <div className="mt-4 flex justify-center">
              <QrCode value={d.request.qrPayload} label="أظهر هذا الرمز للجامع عند الاستلام" />
            </div>
          ) : null}
          <h3 className="mt-4 mb-2 font-bold">{ar.estimate}</h3>
          <ul className="space-y-1 text-sm">
            {d.items.map((it) => (
              <li key={it.id} className="flex justify-between rounded bg-stone-50 px-3 py-2">
                <span>{it.wasteTypeCode}</span>
                <span className="font-semibold">{formatMoney(it.estimatedPrice)}</span>
              </li>
            ))}
          </ul>
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
          <div className={`mt-4 ${d.chain.valid ? "" : "text-red-600"}`}>
            {d.chain.valid ? `✅ ${ar.chainValid}` : `⚠️ ${ar.chainInvalid}`}
          </div>
        </Card>
      </div>
      {d.bags.length > 0 ? (
        <div className="mt-4">
          <h2 className="mb-2 font-bold">{ar.bags}</h2>
          <Table head={[ar.bagCode, ar.status, ar.finalWeight]}>
            {d.bags.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono text-xs">{b.bagCode}</Td>
                <Td><StatusBadge code={b.status} label={ar.bagStatus[b.status] ?? b.status} /></Td>
                <Td>{b.finalWeightKg ? formatWeight(b.finalWeightKg) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
    </>
  );
}

interface PayoutsData {
  items: { id: string; invoiceNumber: number; amount: string; status: string; calculatedAt: string; paidAt: string | null; weightBasisKg: string | null }[];
}

export function CitizenPayouts(): React.ReactNode {
  const payouts = useQuery({
    queryKey: ["my-payouts"],
    queryFn: async () => (await api.GET("/me/payouts", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as PayoutsData | undefined
  });
  if (payouts.isLoading) return <Loading />;
  if (payouts.isError || !payouts.data) return <ErrorState />;
  if (payouts.data.items.length === 0) return <><PageHeader title={ar.myPayouts} /><EmptyState label="لا مستحقات بعد" /></>;
  const total = payouts.data.items
    .filter((p) => p.status !== "void")
    .reduce((acc, p) => acc + Number.parseFloat(p.amount), 0);
  return (
    <>
      <PageHeader title={ar.myPayouts} subtitle={`${ar.total}: ${total.toFixed(2)} ₪`} />
      <Table head={[ar.invoiceNumber, ar.amount, ar.weight, ar.status, "تاريخ الحساب", "تاريخ الدفع"]}>
        {payouts.data.items.map((p) => (
          <tr key={p.id}>
            <Td>#{p.invoiceNumber}</Td>
            <Td className="font-bold text-brand-700">{formatMoney(p.amount)}</Td>
            <Td>{p.weightBasisKg ? formatWeight(p.weightBasisKg) : "—"}</Td>
            <Td><StatusBadge code={p.status} label={ar.payoutStatus[p.status] ?? p.status} /></Td>
            <Td className="text-stone-500">{formatDateTime(p.calculatedAt)}</Td>
            <Td className="text-stone-500">{p.paidAt ? formatDateTime(p.paidAt) : "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface TrackData {
  combinedHash: string;
  currentStatusLabel: string;
  createdAt: string;
  timeline: { statusCode: string; statusLabel: string; occurredAt: string; actorRoleLabel: string | null }[];
}

export function CitizenTrack(): React.ReactNode {
  const { hash } = useParams<{ hash: string }>();
  const [query, setQuery] = useState(decodeURIComponent(hash ?? ""));
  const [activeHash, setActiveHash] = useState(decodeURIComponent(hash ?? ""));
  const track = useQuery({
    queryKey: ["track", activeHash],
    queryFn: async () => (await api.GET("/track/{hash}", { params: { path: { hash: activeHash } } })).data as unknown as TrackData | undefined,
    enabled: activeHash.length > 10
  });

  return (
    <>
      <PageHeader title={ar.tracking} subtitle="أدخل كود التتبع (CMP-…) الخاص بطلبك" />
      <Card className="mb-6">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setActiveHash(query.trim());
          }}
        >
          <input
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
            dir="ltr"
            placeholder="CMP-…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit">{ar.tracking}</Button>
        </form>
      </Card>
      {track.isLoading ? <Loading /> : null}
      {track.isError ? <ErrorState message="كود التتبع غير صحيح أو غير موجود" /> : null}
      {track.data ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-stone-500">الحالة الحالية</span>
            <StatusBadge code="collected" label={track.data.currentStatusLabel} />
          </div>
          <ol className="relative space-y-4 border-s-2 border-stone-200 ps-4">
            {track.data.timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -start-[21px] top-1 h-3 w-3 rounded-full bg-brand-600" />
                <div className="text-sm font-semibold">{i === 0 ? "تم استلام الطلب" : e.statusLabel}</div>
                <div className="text-xs text-stone-400">
                  {formatDateTime(e.occurredAt)} {e.actorRoleLabel ? `· ${e.actorRoleLabel}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}
