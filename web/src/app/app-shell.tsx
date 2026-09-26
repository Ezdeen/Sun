/**
 * App shell — single shell for ALL roles: header, role-aware navigation,
 * global area, error boundary. Never duplicated per role.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession, type Role } from "./session.js";
import { ar } from "../shared/i18n/ar.js";

const ROLE_LABELS: Record<Role, string> = {
  citizen: ar.roleCitizen,
  collector: ar.roleCollector,
  authority: ar.roleAuthority,
  sorter: ar.roleSorter,
  finance: ar.roleFinance,
  manager: ar.roleManager
};

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: Record<Role, NavItem[]> = {
  citizen: [
    { to: "/citizen", label: ar.dashboard, end: true },
    { to: "/citizen/requests", label: ar.requests },
    { to: "/citizen/requests/new", label: ar.newRequest },
    { to: "/citizen/payouts", label: ar.myPayouts },
    { to: "/citizen/profile", label: "الملف الشخصي" }
  ],
  collector: [
    { to: "/collector", label: ar.dashboard, end: true },
    { to: "/collector/schedule", label: ar.schedule },
    { to: "/collector/requests", label: ar.requests },
    { to: "/collector/scan", label: ar.scanBarcode },
    { to: "/collector/payouts", label: ar.myPayouts },
    { to: "/collector/profile", label: "الملف الشخصي" }
  ],
  authority: [
    { to: "/authority", label: ar.dashboard, end: true },
    { to: "/authority/requests", label: ar.requests },
    { to: "/authority/profile", label: "الملف الشخصي" }
  ],
  sorter: [
    { to: "/sorter", label: ar.dashboard, end: true },
    { to: "/sorter/shipments", label: ar.shipments },
    { to: "/sorter/bags", label: ar.bags },
    { to: "/sorter/weights", label: "تسجيل الأوزان" }
  ],
  finance: [
    { to: "/finance", label: ar.dashboard, end: true },
    { to: "/finance/invoices", label: ar.invoices },
    { to: "/finance/payouts", label: ar.payouts },
    { to: "/finance/ledger", label: ar.ledger }
  ],
  manager: [
    { to: "/manager", label: ar.dashboard, end: true },
    { to: "/manager/accounts", label: ar.accounts },
    { to: "/manager/service-areas", label: ar.serviceAreas },
    { to: "/manager/invitations", label: ar.invitations },
    { to: "/manager/catalog", label: ar.catalog },
    { to: "/manager/settings", label: ar.settings },
    { to: "/manager/traceability", label: ar.tracking },
    { to: "/manager/audit", label: ar.auditLog }
  ]
};

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] crashed:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="m-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">حدث خطأ غير متوقع</h2>
          <p className="mt-2 text-sm text-red-600">{this.state.error.message}</p>
          <button
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => window.location.assign("/")}
          >
            العودة للصفحة الرئيسية
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppShell(): ReactNode {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  if (!user) return null; // router handles login redirect

  const nav = NAV[user.role];

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-lg text-white">
              ♻️
            </span>
            <div>
              <div className="text-sm font-bold text-stone-900">{ar.appName}</div>
              <div className="text-xs text-stone-500">{ar.appTagline}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-end sm:block">
              <div className="text-sm font-semibold text-stone-800">{user.displayName ?? ROLE_LABELS[user.role]}</div>
              <div className="text-xs text-brand-700">{ROLE_LABELS[user.role]}</div>
            </div>
            <button
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
            >
              {ar.logout}
            </button>
          </div>
        </div>
        <nav className="border-t border-stone-100 bg-stone-50">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-brand-600 text-white" : "text-stone-600 hover:bg-stone-200"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-400">
        {ar.appName} — {new Date().getFullYear()}
      </footer>
    </div>
  );
}
