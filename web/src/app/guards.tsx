/**
 * Route guards — RequireAuth / RequireRole / PublicOnly.
 */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession, type Role } from "./session.js";
import { Loading } from "../shared/ui/components.js";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return <Loading />;
  if (user) return <Navigate to={`/${user.role}`} replace />;
  return <>{children}</>;
}

export function ForbiddenPage(): ReactNode {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="text-5xl">⛔</div>
      <h1 className="mt-4 text-2xl font-bold text-stone-800">لا تملك صلاحية الوصول</h1>
      <p className="mt-2 text-sm text-stone-500">
        هذه الصفحة مخصصة لدور آخر. تواصل مع إدارة المنصة إن كنت تعتقد أن هذا خطأ.
      </p>
    </div>
  );
}

export function NotFoundPage(): ReactNode {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="text-5xl">🧭</div>
      <h1 className="mt-4 text-2xl font-bold text-stone-800">الصفحة غير موجودة</h1>
      <p className="mt-2 text-sm text-stone-500">تحقق من الرابط أو عد إلى لوحة التحكم.</p>
    </div>
  );
}
