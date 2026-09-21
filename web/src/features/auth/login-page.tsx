import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../app/session.js";
import { Alert, Button, Card, Input } from "../../shared/ui/components.js";
import { ar } from "../../shared/i18n/ar.js";

export function LoginPage(): React.ReactNode {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.loginFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-earth-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-3xl text-white">
            ♻️
          </div>
          <h1 className="text-2xl font-bold text-stone-900">{ar.appName}</h1>
          <p className="mt-1 text-sm text-stone-500">{ar.appTagline}</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label={ar.identifier}
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              dir="ltr"
            />
            <Input
              label={ar.password}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            {error ? <Alert kind="error">{error}</Alert> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "…" : ar.login}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-stone-500">
          مواطن جديد؟{" "}
          <a className="font-semibold text-brand-700 hover:underline" href="/register">
            {ar.createAccount}
          </a>
        </p>
        <p className="mt-1 text-center text-sm text-stone-500">
          لديك دعوة؟{" "}
          <a className="font-semibold text-brand-700 hover:underline" href="/accept-invitation">
            {ar.acceptInvite}
          </a>
        </p>
      </div>
    </div>
  );
}
