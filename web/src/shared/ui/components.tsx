/**
 * Shared UI primitives — small, focused, RTL-first (logical properties).
 */
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="min-w-40">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-brand-700">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-400">{hint}</div> : null}
    </Card>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = ""
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-brand-700 hover:bg-brand-50"
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      <select
        {...props}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

const STATUS_COLORS: Record<string, string> = {
  received: "bg-stone-100 text-stone-700",
  sent_to_collector: "bg-amber-100 text-amber-800",
  on_the_way: "bg-blue-100 text-blue-800",
  arrived: "bg-indigo-100 text-indigo-800",
  collected: "bg-brand-100 text-brand-800",
  sorted: "bg-cyan-100 text-cyan-800",
  sold: "bg-emerald-100 text-emerald-800",
  calculated: "bg-stone-100 text-stone-700",
  approved: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  void: "bg-red-100 text-red-700",
  open: "bg-blue-100 text-blue-800",
  active: "bg-emerald-100 text-emerald-800",
  pending_collection: "bg-stone-100 text-stone-700",
  attached: "bg-amber-100 text-amber-800",
  weighed: "bg-brand-100 text-brand-800"
};

export function StatusBadge({ code, label }: { code: string; label: string }) {
  const color = STATUS_COLORS[code] ?? "bg-stone-100 text-stone-700";
  return <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold ${color}`}>{label}</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      <table className="w-full text-right text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className = "",
  dir
}: {
  children: ReactNode;
  className?: string;
  dir?: "rtl" | "ltr";
}) {
  return (
    <td className={`px-4 py-3 ${className}`} dir={dir}>
      {children}
    </td>
  );
}

export function Loading({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-stone-500">
      <span className="me-3 inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ label = "لا توجد بيانات لعرضها" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white py-16 text-stone-400">
      <span className="text-3xl">🗂️</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message = "حدث خطأ أثناء جلب البيانات" }: { message?: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
      {message}
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "bg-blue-50 text-blue-800 border-blue-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    error: "bg-red-50 text-red-700 border-red-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200"
  };
  return <div className={`rounded-lg border p-3 text-sm ${styles[kind]}`}>{children}</div>;
}
