import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Input } from "../../shared/ui/components.js";
import { ar } from "../../shared/i18n/ar.js";

export function AcceptInvitationPage(): React.ReactNode {
  const [form, setForm] = useState({ token: "", password: "", displayName: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: form.token,
        password: form.password,
        displayName: form.displayName,
        phone: form.phone || undefined
      })
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      setError(body?.detail ?? "تعذر تفعيل الدعوة");
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md text-center">
          <div className="text-4xl">🎉</div>
          <h1 className="mt-3 text-xl font-bold">تم تفعيل الحساب</h1>
          <Link to="/login">
            <Button className="mt-4 w-full">{ar.login}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-6 text-center text-2xl font-bold">{ar.acceptInvite}</h1>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="رمز الدعوة"
            required
            dir="ltr"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
          />
          <Input label={ar.displayName} required value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <Input label={ar.phone} dir="ltr" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label={ar.password} type="password" required minLength={10} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : ar.acceptInvite}
          </Button>
        </form>
      </Card>
    </div>
  );
}
