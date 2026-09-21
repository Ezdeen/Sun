import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../shared/api/client.js";
import { Alert, Button, Card, Input, Select } from "../../shared/ui/components.js";
import { ar } from "../../shared/i18n/ar.js";

interface CatalogResponse {
  serviceAreas: { id: string; code: string; nameAr: string }[];
}

export function RegisterPage(): React.ReactNode {
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    password: "",
    idNumber: "",
    serviceAreaId: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => (await api.GET("/catalog")).data as CatalogResponse | undefined
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/citizens/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form)
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      setError(body?.detail ?? "تعذر إنشاء الحساب — تحقق من المعطيات");
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md text-center">
          <div className="text-4xl">✅</div>
          <h1 className="mt-3 text-xl font-bold">تم إنشاء الحساب بنجاح</h1>
          <p className="mt-2 text-sm text-stone-500">يمكنك الآن تسجيل الدخول والبدء بطلب الجمع.</p>
          <Link to="/login">
            <Button className="mt-4 w-full">{ar.login}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-6 text-center text-2xl font-bold">{ar.register}</h1>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Input label={ar.displayName} required value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <Input label={ar.identifier} type="email" required dir="ltr" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label={ar.phone} required dir="ltr" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label={ar.password} type="password" required minLength={10} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Input label={ar.idNumber} required dir="ltr" pattern="[0-9]{9}" value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })} />
          <Select
            label={ar.serviceArea}
            required
            value={form.serviceAreaId}
            onChange={(e) => setForm({ ...form, serviceAreaId: e.target.value })}
          >
            <option value="">— اختر المنطقة —</option>
            {(catalog.data?.serviceAreas ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.nameAr}</option>
            ))}
          </Select>
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : ar.register}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-brand-700 hover:underline">لديك حساب؟ {ar.login}</Link>
      </p>
    </div>
  );
}
