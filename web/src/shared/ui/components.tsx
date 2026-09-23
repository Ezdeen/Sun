"use client";

import {
  forwardRef,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TdHTMLAttributes
} from "react";

import "./ui.css";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Decorative icons                                                           */
/* -------------------------------------------------------------------------- */

type IconName =
  | "info"
  | "warn"
  | "error"
  | "success"
  | "chevron"
  | "empty";

const ICON_PATHS: Record<IconName, string> = {
  info: "M12 8h.01 M12 11v6",
  warn: "M12 8v5 M12 16h.01",
  error: "m9 9 6 6 M15 9l-6 6",
  success: "m8 12 3 3 5-6",
  chevron: "m6 9 6 6 6-6",
  empty: "M4 7h6l2 2h8v10H4Z M4 7V5h6l2 2"
};

function Icon({
  name,
  className = ""
}: {
  name: IconName;
  className?: string;
}) {
  const circular =
    name === "info" || name === "error" || name === "success";

return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("h-5 w-5 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      {circular ? <circle cx="12" cy="12" r="9" /> : null}

{name === "warn" ? (
        <path d="M12 3 22 20H2Z" />
      ) : null}

<path d={ICON_PATHS[name]} />
    </svg>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("ui-spinner", className)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Page header                                                                */
/* -------------------------------------------------------------------------- */

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  actions,
  className
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        "mb-7 flex flex-wrap items-center justify-between gap-4",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-snug text-slate-900 sm:text-3xl">
          {title}
        </h1>

{subtitle ? (
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
            {subtitle}
          </p>
        ) : null}
      </div>

{actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
  animated?: boolean;
};

const CARD_PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8"
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card(
    {
      children,
      className,
      padding = "md",
      animated = false,
      ...props
    },
    ref
  ) {
    return (
      <div
        {...props}
        ref={ref}
        className={cx(
          "ui-card",
          CARD_PADDING[padding],
          animated && "ui-enter",
          className
        )}
      >
        {children}
      </div>
    );
  }
);

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  className?: string;
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  className
}: StatCardProps) {
  return (
    <Card className={cx("min-w-40", className)}>
      <div className="flex items-start justify-between gap-4">
        <dl className="min-w-0">
          <dt className="text-sm font-medium leading-6 text-slate-600">
            {label}
          </dt>

<dd className="ui-stat-value mt-3 break-words text-3xl font-bold leading-tight tabular-nums">
            <bdi>{value}</bdi>
          </dd>

{hint ? (
            <dd className="mt-2 text-xs leading-6 text-slate-600">
              {hint}
            </dd>
          ) : null}
        </dl>

{icon ? (
          <span
            aria-hidden="true"
            className="ui-icon-surface flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          >
            {icon}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  loadingText?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      type = "button",
      variant = "primary",
      size = "md",
      loading = false,
      loadingText,
      startIcon,
      endIcon,
      fullWidth = false,
      disabled,
      className,
      "aria-busy": ariaBusy,
      ...props
    },
    ref
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading ? true : ariaBusy}
        className={cx(
          "ui-button",
          `ui-button--${variant}`,
          `ui-button--${size}`,
          fullWidth && "w-full",
          className
        )}
      >
        {loading ? (
          <Spinner />
        ) : startIcon ? (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center"
          >
            {startIcon}
          </span>
        ) : null}

<span>
          {loading && loadingText ? loadingText : children}
        </span>

{!loading && endIcon ? (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center"
          >
            {endIcon}
          </span>
        ) : null}
      </button>
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Accessible field structure                                                 */
/* -------------------------------------------------------------------------- */

type FieldBaseProps = {
  label: string;
  helperText?: string;
  error?: string;
  containerClassName?: string;
};

type FieldShellProps = FieldBaseProps & {
  id: string;
  required?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

function FieldShell({
  id,
  label,
  helperText,
  error,
  required,
  disabled,
  containerClassName,
  children
}: FieldShellProps) {
  return (
    <div className={cx("min-w-0", containerClassName)}>
      <label
        htmlFor={id}
        className={cx(
          "mb-2 block text-sm font-semibold leading-6",
          disabled ? "text-slate-600" : "text-slate-800"
        )}
      >
        {label}

{required ? (
          <span className="ms-1 text-red-700" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

{children}

{helperText ? (
        <p
          id={`${id}-hint`}
          className="mt-2 text-xs leading-6 text-slate-600"
        >
          {helperText}
        </p>
      ) : null}

{error ? (
        <p
          id={`${id}-error`}
          className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-6 text-red-700"
        >
          <Icon name="error" className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function fieldDescription(
  existing: string | undefined,
  id: string,
  helperText: string | undefined,
  error: string | undefined
) {
  return (
    cx(
      existing,
      helperText && `${id}-hint`,
      error && `${id}-error`
    ) || undefined
  );
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldBaseProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      helperText,
      error,
      containerClassName,
      id,
      className,
      required,
      disabled,
      "aria-describedby": describedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const invalid = Boolean(error) || ariaInvalid === true || ariaInvalid === "true";

return (
      <FieldShell
        id={inputId}
        label={label}
        helperText={helperText}
        error={error}
        required={required}
        disabled={disabled}
        containerClassName={containerClassName}
      >
        <input
          {...props}
          ref={ref}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={fieldDescription(
            describedBy,
            inputId,
            helperText,
            error
          )}
          className={cx(
            "ui-control",
            invalid && "ui-control--invalid",
            className
          )}
        />
      </FieldShell>
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Select                                                                     */
/* -------------------------------------------------------------------------- */

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldBaseProps;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      helperText,
      error,
      containerClassName,
      id,
      className,
      children,
      required,
      disabled,
      multiple,
      size,
      "aria-describedby": describedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref
  ) {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const invalid = Boolean(error) || ariaInvalid === true || ariaInvalid === "true";
    const showChevron = !multiple && (!size || size === 1);

return (
      <FieldShell
        id={selectId}
        label={label}
        helperText={helperText}
        error={error}
        required={required}
        disabled={disabled}
        containerClassName={containerClassName}
      >
        <div className="relative">
          <select
            {...props}
            ref={ref}
            id={selectId}
            required={required}
            disabled={disabled}
            multiple={multiple}
            size={size}
            aria-invalid={error ? true : ariaInvalid}
            aria-describedby={fieldDescription(
              describedBy,
              selectId,
              helperText,
              error
            )}
            className={cx(
              "ui-control",
              showChevron && "ui-select",
              invalid && "ui-control--invalid",
              className
            )}
          >
            {children}
          </select>

{showChevron ? (
            <Icon
              name="chevron"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          ) : null}
        </div>
      </FieldShell>
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Status badges                                                              */
/* -------------------------------------------------------------------------- */

type StatusTone =
  | "neutral"
  | "amber"
  | "blue"
  | "indigo"
  | "emerald"
  | "cyan"
  | "red";

const STATUS_TONES: Record<string, StatusTone> = {
  received: "neutral",
  sent_to_collector: "amber",
  on_the_way: "blue",
  arrived: "indigo",
  collected: "emerald",
  sorted: "cyan",
  sold: "emerald",
  calculated: "neutral",
  approved: "amber",
  paid: "emerald",
  void: "red",
  open: "blue",
  active: "emerald",
  pending_collection: "neutral",
  attached: "amber",
  weighed: "emerald"
};

const BADGE_STYLES: Record<StatusTone, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
  red: "border-red-200 bg-red-50 text-red-800"
};

export function StatusBadge({
  code,
  label,
  className
}: {
  code: string;
  label: string;
  className?: string;
}) {
  const tone = STATUS_TONES[code] ?? "neutral";

return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-5",
        BADGE_STYLES[tone],
        className
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
      />
      <span>{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

type TableProps = {
  head: string[];
  children: ReactNode;
  caption?: string;
  className?: string;
};

export function Table({
  head,
  children,
  caption = "جدول البيانات",
  className
}: TableProps) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cx(
        "ui-table-wrap overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm",
        className
      )}
    >
      <table className="ui-table w-full text-start text-sm">
        <caption className="sr-only">{caption}</caption>

<thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
          <tr>
            {head.map((heading, index) => (
              <th
                key={`${heading}-${index}`}
                scope="col"
                className="whitespace-nowrap px-4 py-4 text-start font-semibold"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

<tbody className="divide-y divide-slate-100">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={cx(
        "px-4 py-4 align-middle leading-6 text-slate-700",
        className
      )}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading & empty states                                                     */
/* -------------------------------------------------------------------------- */

export function Loading({
  label = "جارٍ التحميل…"
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center justify-center gap-3 py-16 text-sm font-medium text-slate-600"
    >
      <Spinner className="ui-loading-spinner" />
      <span>{label}</span>
    </div>
  );
}

type EmptyStateProps = {
  label?: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({
  label = "لا توجد بيانات لعرضها",
  description,
  action
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm">
        <Icon name="empty" className="h-7 w-7" />
      </span>

<p className="text-base font-semibold text-slate-800">
        {label}
      </p>

{description ? (
        <p className="mt-2 max-w-sm text-sm leading-7 text-slate-600">
          {description}
        </p>
      ) : null}

{action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

type AlertKind = "info" | "warn" | "error" | "success";

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  kind?: AlertKind;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  announcement?: "polite" | "assertive" | "off";
  animated?: boolean;
};

const ALERT_STYLES: Record<AlertKind, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900"
};

export function Alert({
  kind = "info",
  title,
  children,
  action,
  announcement = kind === "error" ? "assertive" : "polite",
  animated = false,
  className,
  role,
  "aria-live": ariaLive,
  ...props
}: AlertProps) {
  const defaultRole =
    announcement === "off"
      ? undefined
      : announcement === "assertive"
        ? "alert"
        : "status";

return (
    <div
      {...props}
      role={role ?? defaultRole}
      aria-live={ariaLive ?? announcement}
      aria-atomic="true"
      className={cx(
        "ui-alert flex items-start gap-3 rounded-2xl border p-4 sm:p-5",
        ALERT_STYLES[kind],
        animated && "ui-enter",
        className
      )}
    >
      <Icon name={kind} className="mt-0.5" />

<div className="min-w-0 flex-1">
        {title ? (
          <p className="mb-1 text-sm font-bold leading-6">
            {title}
          </p>
        ) : null}

<div className="break-words text-sm leading-7">
          {children}
        </div>

{action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

export function ErrorState({
  message = "حدث خطأ أثناء جلب البيانات",
  onRetry,
  retrying = false
}: {
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert
      kind="error"
      title="تعذّر إكمال العملية"
      action={
        onRetry ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            loading={retrying}
            loadingText="جارٍ إعادة المحاولة…"
          >
            إعادة المحاولة
          </Button>
        ) : null
      }
    >
      {message}
    </Alert>
  );
}
