/**
 * Manager feature — overview dashboard, accounts, invitations, catalog,
 * settings, traceability verification, audit log.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import {
  Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Select,
  StatCard, StatusBadge, Table, Td
} from "../../shared/ui/components.js";
import { formatDateTime, formatMoney, shortHash } from "../../shared/lib/format.js";

interface ManagerDashboardData {
  requestStatusCounts: Record<string, number>;
  bagStatusCounts: Record<string, number>;
  invoiceStats: { active: number; voided: number; total_amount: string };
  usersByRole: Record<string, number>;
  serviceAreas: { id: string; code: string; nameAr: string; zone: string; households: number }[];
  traceability: { total_events: number; aggregates: number; pending_anchors: number };
  recentInvoices: { id: string; invoiceNumber: number; amount: string; status: string; createdAt: string }[];
}

export function ManagerDashboard(): React.ReactNode {
  const dash = useQuery({
    queryKey: ["manager-dashboard"],
    queryFn: async () => (await api.GET("/manager/dashboard")).data as unknown as ManagerDashboardData | undefined
  });
  if (dash.isLoading) return <Loading />;
  if (dash.isError || !dash.data) return <ErrorState />;
  const d = dash.data;
  return (
    <>
      <PageHeader title={ar.roleManager} subtitle="نظرة تشغيلية كلية" />
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="طلبات مستلمة" value={d.requestStatusCounts["received"] ?? 0} />
        <StatCard label="طلبات مكتملة (مبيعة)" value={d.requestStatusCounts["sold"] ?? 0} />
        <StatCard label="فواتير فعّالة" value={d.invoiceStats.active} hint={formatMoney(d.invoiceStats.total_amount)} />
        <StatCard label="أحداث تتبع" value={d.traceability.total_events} hint={`${d.traceability.aggregates} كيان`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">توزيع الطلبات على الحالات</h2>
          <ul className="space-y-2">
            {Object.entries(d.requestStatusCounts).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2 text-sm">
                <StatusBadge code={status} label={ar.requestStatus[status] ?? status} />
                <span className="font-bold">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">المستخدمون حسب الدور</h2>
          <ul className="space-y-2 text-sm">
            {Object.entries(d.usersByRole).map(([role, count]) => (
              <li key={role} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2">
                <span>{role === "citizen" ? ar.roleCitizen : role === "collector" ? ar.roleCollector : role === "authority" ? ar.roleAuthority : role === "sorter" ? ar.roleSorter : role === "finance" ? ar.roleFinance : ar.roleManager}</span>
                <span className="font-bold">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">{ar.shipments} — آخر الفواتير</h2>
          {d.recentInvoices.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2 text-sm">
              {d.recentInvoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2">
                  <span className="font-semibold">#{i.invoiceNumber}</span>
                  <span className="font-bold text-brand-700">{formatMoney(i.amount)}</span>
                  <StatusBadge code={i.status} label={ar.invoiceStatus[i.status] ?? i.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">مناطق الخدمة</h2>
          <ul className="space-y-2 text-sm">
            {d.serviceAreas.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-2">
                <span>{a.nameAr} ({a.zone === "north" ? "شمال" : a.zone === "center" ? "وسط" : "جنوب"})</span>
                <span className="text-stone-500">{a.households} {ar.household}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

interface AccountsData {
  items: { id: string; role: string; displayName: string; email: string; status: string; createdAt: string }[];
  total: number;
}

const ROLE_LABELS: Record<string, string> = {
  citizen: ar.roleCitizen, collector: ar.roleCollector, authority: ar.roleAuthority,
  sorter: ar.roleSorter, finance: ar.roleFinance, manager: ar.roleManager
};

export function ManagerAccounts(): React.ReactNode {
  const [role, setRole] = useState("");
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["accounts", role],
    queryFn: async () =>
      (await api.GET("/admin/accounts", { params: { query: { page: 1, pageSize: 100, role: (role || undefined) as never } } }))
        .data as unknown as AccountsData | undefined
  });
  const statusMutation = useMutation({
    mutationFn: async (input: { userId: string; status: "active" | "disabled" }) => {
      const res = await api.PATCH("/admin/accounts/{id}/status", {
        params: { path: { id: input.userId } },
        body: { status: input.status }
      });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر التحديث");
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["accounts"] })
  });

  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;

  return (
    <>
      <PageHeader title={ar.accounts} subtitle={`${list.data.total} حساب`}
        actions={
          <Select label="الدور" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">كل الأدوار</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        } />
      {statusMutation.isError ? <div className="mb-4"><Alert kind="error">{(statusMutation.error as Error).message}</Alert></div> : null}
      <Table head={["الاسم", "الدور", "البريد", ar.status, ar.date, ""]}>
        {list.data.items.map((u) => (
          <tr key={u.id}>
            <Td className="font-semibold">{u.displayName}</Td>
            <Td>{ROLE_LABELS[u.role] ?? u.role}</Td>
            <Td dir="ltr" className="text-stone-500">{u.email}</Td>
            <Td><StatusBadge code={u.status === "active" ? "active" : "void"} label={u.status === "active" ? "فعّال" : "معطّل"} /></Td>
            <Td className="text-stone-500">{formatDateTime(u.createdAt)}</Td>
            <Td>
              <Button
                variant={u.status === "active" ? "danger" : "secondary"}
                onClick={() => statusMutation.mutate({ userId: u.id, status: u.status === "active" ? "disabled" : "active" })}
              >
                {u.status === "active" ? "تعطيل" : "تفعيل"}
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface InvitationsData {
  items: { id: string; email: string; role: string; status: string; expiresAt: string; createdAt: string }[];
  total: number;
}

export function ManagerInvitations(): React.ReactNode {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("collector");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["invitations"],
    queryFn: async () => (await api.GET("/admin/invitations", { params: { query: { page: 1, pageSize: 50 } } })).data as unknown as InvitationsData | undefined
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.POST("/admin/invitations", { body: { email, role: inviteRole as never } });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر إنشاء الدعوة");
      return res.data as unknown as { token: string };
    },
    onSuccess: (data) => {
      setToken(data.token);
      setError(null);
      setEmail("");
      void qc.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (err) => setError(err.message)
  });

  return (
    <>
      <PageHeader title={ar.invitations} subtitle="دعوة أدوار مميزة: جامع، هيئة، فرز، مالية، مدير" />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}>
          <div className="flex-1 min-w-48">
            <Input label="البريد الإلكتروني" type="email" dir="ltr" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Select label="الدور" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="collector">{ar.roleCollector}</option>
            <option value="authority">{ar.roleAuthority}</option>
            <option value="sorter">{ar.roleSorter}</option>
            <option value="finance">{ar.roleFinance}</option>
            <option value="manager">{ar.roleManager}</option>
          </Select>
          <Button type="submit" disabled={createMutation.isPending || !email}>
            {createMutation.isPending ? "…" : "إنشاء دعوة"}
          </Button>
        </form>
        {error ? <div className="mt-3"><Alert kind="error">{error}</Alert></div> : null}
        {token ? (
          <div className="mt-3">
            <Alert kind="success">
              رمز الدعوة (يُعرض مرة واحدة — أرسله للمدعو):{" "}
              <span className="font-mono text-xs break-all" dir="ltr">{token}</span>
            </Alert>
          </div>
        ) : null}
      </Card>
      {list.isLoading ? <Loading /> : list.isError ? <ErrorState /> : list.data && list.data.items.length > 0 ? (
        <Table head={["البريد", "الدور", ar.status, "الانتهاء"]}>
          {list.data.items.map((i) => (
            <tr key={i.id}>
              <Td dir="ltr">{i.email}</Td>
              <Td>{ROLE_LABELS[i.role] ?? i.role}</Td>
              <Td>{i.status === "pending" ? "معلّقة" : i.status === "accepted" ? "مقبولة" : "ملغاة"}</Td>
              <Td className="text-stone-500">{formatDateTime(i.expiresAt)}</Td>
            </tr>
          ))}
        </Table>
      ) : <EmptyState />}
    </>
  );
}

interface CatalogData {
  wasteTypes: { code: string; category: string; nameAr: string; unit: string; pricePerUnit: string; isBulkOnly: boolean }[];
  addons: { code: string; nameAr: string; bonusPercent: string; appliesTo: string[] }[];
}

export function ManagerCatalog(): React.ReactNode {
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => (await api.GET("/catalog")).data as unknown as CatalogData | undefined
  });
  if (catalog.isLoading) return <Loading />;
  if (catalog.isError || !catalog.data) return <ErrorState />;
  return (
    <>
      <PageHeader title={ar.catalog} subtitle={`${catalog.data.wasteTypes.length} نوع`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-bold">{ar.wasteTypes}</h2>
          <Table head={["النوع", ar.category, ar.unit, ar.pricePerUnit]}>
            {catalog.data.wasteTypes.map((t) => (
              <tr key={t.code}>
                <Td className="font-semibold">{t.nameAr}{t.isBulkOnly ? " (كيس منفصل)" : ""}</Td>
                <Td>{t.category}</Td>
                <Td>{t.unit}</Td>
                <Td>{t.pricePerUnit} ₪</Td>
              </tr>
            ))}
          </Table>
        </div>
        <div>
          <h2 className="mb-3 font-bold">{ar.addons}</h2>
          <Table head={["الإضافة", ar.bonusPercent, "تنطبق على"]}>
            {catalog.data.addons.map((a) => (
              <tr key={a.code}>
                <Td className="font-semibold">{a.nameAr}</Td>
                <Td>{a.bonusPercent}%</Td>
                <Td className="text-xs text-stone-500">{a.appliesTo.join(", ")}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}

interface SettingsData {
  pricing: { bonusCapPercent: number; paperMinWeightKg: number; paperUnderweightFactor: number; underUnitFactor: number };
  distributionSplits: { platform: number; collectors: number; citizens: number };
  distributionPolicy: { unallocated: string };
}

export function ManagerSettings(): React.ReactNode {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.GET("/admin/settings")).data as unknown as SettingsData | undefined
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.PATCH("/admin/settings", { body: body as never });
      if (!res.response.ok) throw new Error((res.data as unknown as { detail?: string } | undefined)?.detail ?? "تعذر التحديث");
      return res.data;
    },
    onSuccess: () => {
      setSaved(true);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      setError(err.message);
      setSaved(false);
    }
  });

  if (settings.isLoading) return <Loading />;
  if (settings.isError || !settings.data) return <ErrorState />;
  const s = settings.data;

  return (
    <>
      <PageHeader title={ar.settings} subtitle="نسب التوزيع وسقوف التسعير — تُحفظ بإصدار (versioned)" />
      {error ? <div className="mb-4"><Alert kind="error">{error}</Alert></div> : null}
      {saved ? <div className="mb-4"><Alert kind="success">تم حفظ الإعدادات</Alert></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">{ar.splits} (%)</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              updateMutation.mutate({
                distributionSplits: {
                  platform: Number(f.get("platform")),
                  collectors: Number(f.get("collectors")),
                  citizens: Number(f.get("citizens"))
                }
              });
            }}
          >
            {(["platform", "collectors", "citizens"] as const).map((key) => (
              <Input
                key={key}
                label={key === "platform" ? ar.platformShare : key === "collectors" ? ar.collectorsShare : ar.citizensShare}
                type="number" min="0" max="100" step="1" dir="ltr"
                name={key}
                defaultValue={s.distributionSplits[key]}
              />
            ))}
            <Alert kind="info">المجموع يجب أن يساوي 100 بالضبط.</Alert>
            <Button type="submit" disabled={updateMutation.isPending}>حفظ النسب</Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">تسعير وحدود</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              updateMutation.mutate({
                pricing: {
                  bonusCapPercent: Number(f.get("bonusCapPercent")),
                  paperMinWeightKg: Number(f.get("paperMinWeightKg")),
                  paperUnderweightFactor: Number(f.get("paperUnderweightFactor")),
                  underUnitFactor: Number(f.get("underUnitFactor"))
                }
              });
            }}
          >
            <Input label="سقف المكافآت التشجيعية (%)" name="bonusCapPercent" type="number" min="0" max="100" step="0.5" dir="ltr"
              defaultValue={s.pricing.bonusCapPercent} />
            <Input label="الحد الأدنى لوزن الورق (كجم)" name="paperMinWeightKg" type="number" min="0" step="0.5" dir="ltr"
              defaultValue={s.pricing.paperMinWeightKg} />
            <Input label="عامل تخفيض الورق الناقص" name="paperUnderweightFactor" type="number" min="0" max="1" step="0.05" dir="ltr"
              defaultValue={s.pricing.paperUnderweightFactor} />
            <Input label="عامل الكمية دون الوحدة" name="underUnitFactor" type="number" min="0" max="1" step="0.05" dir="ltr"
              defaultValue={s.pricing.underUnitFactor} />
            <Button type="submit" disabled={updateMutation.isPending}>حفظ التسعير</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

interface VerifyResult {
  aggregateId: string;
  request: { id: string; requestNumber: number; combinedHash: string; status: string } | null;
  valid: boolean;
  eventsChecked: number;
  firstBroken: unknown;
  events: { seq: number; statusCode: string; actorRole: string | null; occurredAt: string; eventHash: string }[];
}

export function ManagerTraceability(): React.ReactNode {
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: async () => {
      const res = await api.GET("/admin/traceability/verify/{aggregateType}/{aggregateId}", {
        params: { path: { aggregateType: "request", aggregateId: reference.trim() } }
      });
      if (!res.response.ok) {
        if (res.response.status === 404) throw new Error("لم يُعثر على طلب مطابق لهذا الكود");
        if (res.response.status === 400) {
          throw new Error("صيغة غير صالحة: أدخل كود CMP-… أو REQ-… أو رقم الطلب أو المعرف (UUID)");
        }
        const body = res.error as unknown as { detail?: string } | undefined;
        throw new Error(body?.detail ?? "تعذر التحقق");
      }
      return res.data as unknown as VerifyResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setResult(null);
      setError(err.message);
    }
  });

  return (
    <>
      <PageHeader title={ar.verifyChain} subtitle="تحقق سلسلة الهاش لأي طلب بكود التتبع (CMP-…) أو رقم الطلب أو المعرف" />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); verify.mutate(); }}>
          <input
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
            dir="ltr"
            placeholder="CMP-… | REQ-… | 1004 | UUID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Button type="submit" disabled={verify.isPending || reference.trim().length < 4}>
            {verify.isPending ? "…" : ar.verifyChain}
          </Button>
        </form>
      </Card>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {result ? (
        <div className="space-y-4">
          <Card>
            {result.valid ? (
              <Alert kind="success">✅ {ar.chainValid} — {result.eventsChecked} حدثاً تم التحقق منها</Alert>
            ) : (
              <Alert kind="error">⚠️ {ar.chainInvalid} — تفاصيل: {JSON.stringify(result.firstBroken)}</Alert>
            )}
            {result.request ? (
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-stone-500">{ar.requestNumber}</dt><dd className="font-semibold">#{result.request.requestNumber}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">{ar.status}</dt><dd><StatusBadge code={result.request.status} label={ar.requestStatus[result.request.status] ?? result.request.status} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-stone-500">كود التتبع</dt><dd className="break-all font-mono text-xs" dir="ltr">{result.request.combinedHash}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-stone-500">المعرف</dt><dd className="break-all font-mono text-xs" dir="ltr">{result.aggregateId}</dd></div>
              </dl>
            ) : null}
          </Card>
          {result.events.length > 0 ? (
            <Table head={["#", ar.status, "الدور", ar.date, "الهاش"]}>
              {result.events.map((e) => (
                <tr key={e.seq}>
                  <Td className="font-semibold">{e.seq}</Td>
                  <Td>{ar.requestStatus[e.statusCode] ?? e.statusCode}</Td>
                  <Td>{e.actorRole ? (ROLE_LABELS[e.actorRole] ?? e.actorRole) : "—"}</Td>
                  <Td className="text-stone-500">{formatDateTime(e.occurredAt)}</Td>
                  <Td className="font-mono text-xs text-stone-400" dir="ltr">{shortHash(e.eventHash, 16)}</Td>
                </tr>
              ))}
            </Table>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface AuditData {
  items: { id: string; eventType: string; userId: string | null; ip: string | null; occurredAt: string; details: Record<string, unknown> }[];
  total: number;
}

const EVENT_LABELS: Record<string, string> = {
  login_success: "دخول ناجح", login_failed: "دخول فاشل", login_locked: "قفل مؤقت",
  refresh_rotated: "تدوير رمز", refresh_reuse_detected: "كشف إعادة استخدام",
  logout: "خروج", logout_all: "إنهاء الجلسات", invitation_created: "إنشاء دعوة",
  invitation_accepted: "قبول دعوة", password_changed: "تغيير كلمة المرور",
  account_status_changed: "تغيير حالة حساب", override_executed: "تجاوز مدير"
};

export function ManagerAudit(): React.ReactNode {
  const list = useQuery({
    queryKey: ["audit"],
    queryFn: async () => (await api.GET("/admin/audit", { params: { query: { page: 1, pageSize: 100 } } })).data as unknown as AuditData | undefined
  });
  if (list.isLoading) return <Loading />;
  if (list.isError || !list.data) return <ErrorState />;
  if (list.data.items.length === 0) return <><PageHeader title={ar.auditLog} /><EmptyState /></>;
  return (
    <>
      <PageHeader title={ar.auditLog} subtitle={`${list.data.total} حدثاً`} />
      <Table head={["الحدث", "المستخدم", "IP", ar.date, "تفاصيل"]}>
        {list.data.items.map((e) => (
          <tr key={e.id}>
            <Td className="font-semibold">{EVENT_LABELS[e.eventType] ?? e.eventType}</Td>
            <Td className="font-mono text-xs text-stone-400">{e.userId?.slice(0, 8) ?? "—"}</Td>
            <Td dir="ltr" className="text-xs text-stone-400">{e.ip ?? "—"}</Td>
            <Td className="text-stone-500">{formatDateTime(e.occurredAt)}</Td>
            <Td className="max-w-64 truncate text-xs text-stone-400">{JSON.stringify(e.details)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
