import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../shared/api/client.js";
import "./RegisterPage.css";

interface CatalogResponse {
  serviceAreas: {
    id: string;
    code: string;
    nameAr: string;
  }[];
}

interface RegisterForm {
  displayName: string;
  email: string;
  phone: string;
  password: string;
  idNumber: string;
  serviceAreaId: string;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  action?: ReactNode;
  wide?: boolean;
};

function Field({
  label,
  hint,
  action,
  wide,
  ...inputProps
}: FieldProps) {
  const generatedId = useId();
  const id = inputProps.id ?? generatedId;

return (
    <div className={`eco-field${wide ? " eco-field--wide" : ""}`}>
      <label htmlFor={id}>{label}</label>

<div className={`eco-input-wrap${action ? " has-action" : ""}`}>
        <input
          {...inputProps}
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {action}
      </div>

{hint && (
        <small id={`${id}-hint`} className="eco-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

function LeafMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M25 6C13 4 5 10 7 19c2 8 17 10 18-13Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 26 21 12M13 21v-7M17 17h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {!visible && (
        <path
          d="m4 4 16 16"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function CircularArtwork() {
  return (
    <div className="eco-art" aria-hidden="true">
      <svg
        className="eco-orbits"
        viewBox="0 0 360 360"
        fill="none"
        focusable="false"
      >
        <circle cx="180" cy="180" r="158" />
        <circle
          cx="180"
          cy="180"
          r="119"
          strokeDasharray="3 10"
        />
        <path
          className="eco-orbit-accent"
          d="M180 22a158 158 0 0 1 137 79"
        />
        <path
          className="eco-orbit-accent"
          d="M180 338a158 158 0 0 1-137-79"
        />
        <circle className="eco-orbit-dot" cx="317" cy="101" r="5" />
        <circle className="eco-orbit-dot" cx="43" cy="259" r="5" />
      </svg>

<div className="eco-art-center">
        <LeafMark />
        <strong>موارد تتجدد</strong>
        <span>وقيمة تستمر</span>
      </div>

<span className="eco-orbit-label eco-orbit-label--top">
        جمع وفرز
      </span>
      <span className="eco-orbit-label eco-orbit-label--left">
        إعادة تدوير
      </span>
      <span className="eco-orbit-label eco-orbit-label--bottom">
        قيمة جديدة
      </span>
    </div>
  );
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0))
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0))
    );
}

export function RegisterPage(): ReactNode {
  const [form, setForm] = useState<RegisterForm>({
    displayName: "",
    email: "",
    phone: "",
    password: "",
    idNumber: "",
    serviceAreaId: ""
  });

const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: async (): Promise<CatalogResponse> => {
      const { data, error: catalogError } = await api.GET("/catalog");

if (catalogError || !data) {
        throw new Error("تعذر تحميل مناطق الخدمة");
      }

const result = data as CatalogResponse;

if (!Array.isArray(result.serviceAreas)) {
        throw new Error("بيانات مناطق الخدمة غير مكتملة");
      }

return result;
    }
  });

const areas = catalog.data?.serviceAreas ?? [];
  const catalogLoading = catalog.isPending || catalog.isFetching;
  const canChooseArea = areas.length > 0;
  const selectedAreaExists = areas.some(
    (area) => area.id === form.serviceAreaId
  );

useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

function updateField<K extends keyof RegisterForm>(
    key: K,
    value: RegisterForm[K]
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

if (busy) return;

setError(null);

if (!form.displayName.trim()) {
      setError("يرجى إدخال الاسم الكامل.");
      return;
    }

if (!selectedAreaExists) {
      setError("يرجى اختيار منطقة خدمة متاحة قبل إنشاء الحساب.");
      return;
    }

setBusy(true);

try {
      const response = await fetch("/api/v1/citizens/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          phone: normalizeDigits(form.phone.trim()),
          idNumber: normalizeDigits(form.idNumber.trim())
        })
      });

if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);

const detail =
          body &&
          typeof body === "object" &&
          "detail" in body &&
          typeof body.detail === "string"
            ? body.detail
            : null;

setError(
          detail || "تعذر إنشاء الحساب. راجع البيانات وحاول مرة أخرى."
        );
        return;
      }

// لا نحتفظ بكلمة المرور في حالة المكوّن بعد نجاح التسجيل.
      setForm((previous) => ({ ...previous, password: "" }));
      setDone(true);
    } catch {
      setError(
        "تعذر تأكيد إنشاء الحساب بسبب مشكلة في الاتصال. " +
          "تحقق من اتصالك؛ وإذا استمرت المشكلة، جرّب تسجيل الدخول قبل إعادة التسجيل."
      );
    } finally {
      setBusy(false);
    }
  }

if (done) {
    return (
      <main className="eco-register eco-register--success" dir="rtl" lang="ar">
        <section className="eco-success-card" aria-labelledby="success-title">
          <div className="eco-success-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="m8 16 5 5L24 10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

<span className="eco-eyebrow">بداية جديدة لأثر أفضل</span>

<h1 id="success-title" ref={successRef} tabIndex={-1}>
            أهلًا بك في المنظومة
          </h1>

<p>
            تم إنشاء حسابك بنجاح.
            <br />
            يمكنك الآن تسجيل الدخول والبدء بطلب الجمع.
          </p>

<Link className="eco-primary" to="/login">
            الانتقال إلى تسجيل الدخول
            <span aria-hidden="true">←</span>
          </Link>
        </section>
      </main>
    );
  }

return (
    <main className="eco-register" dir="rtl" lang="ar">
      <div className="eco-shell">
        <aside className="eco-story" aria-labelledby="eco-story-title">
          <div className="eco-brand">
            <span className="eco-brand-mark">
              <LeafMark />
            </span>
            <div>
              <strong>الاقتصاد الدائري</strong>
              <span>موارد مستدامة · مجتمع مشارك</span>
            </div>
          </div>

<div className="eco-story-copy">
            <span className="eco-story-tag">
              <span aria-hidden="true" />
              معًا نحو اقتصاد أخضر
            </span>

<h2 id="eco-story-title">
              لكل مورد فرصة.
              <br />
              <span>ولمشاركتك أثر.</span>
            </h2>

<p>
              انضم إلى منظومة تربط المشاركة المجتمعية بجمع الموارد
              وإعادة تدويرها، لتبدأ دورة جديدة من القيمة.
            </p>
          </div>

<CircularArtwork />

<div className="eco-story-footer">
            <span className="eco-footer-line" aria-hidden="true" />
            خطوات صغيرة اليوم، وموارد أفضل للغد.
          </div>
        </aside>

<section className="eco-panel" aria-labelledby="register-title">
          <div className="eco-panel-top">
            <span className="eco-membership">عضوية الأفراد</span>
            <span className="eco-panel-note">نبدأ من هنا</span>
          </div>

<header className="eco-form-heading">
            <h1 id="register-title">أنشئ حسابك</h1>
            <p>أدخل بياناتك وحدد منطقة الخدمة لبدء مشاركتك.</p>
          </header>

<form
            onSubmit={submit}
            aria-busy={busy}
            aria-describedby="required-note"
          >
            <p id="required-note" className="eco-required-note">
              جميع الحقول مطلوبة.
            </p>

{error && (
              <div
                ref={errorRef}
                className="eco-alert"
                role="alert"
                tabIndex={-1}
              >
                <strong>لم نتمكن من إكمال التسجيل</strong>
                <p>{error}</p>
              </div>
            )}

<fieldset className="eco-fields" disabled={busy}>
              <legend className="eco-sr-only">بيانات إنشاء العضوية</legend>

<Field
                label="الاسم الكامل"
                name="displayName"
                autoComplete="name"
                placeholder="أدخل اسمك الكامل"
                required
                value={form.displayName}
                onChange={(event) =>
                  updateField("displayName", event.target.value)
                }
              />

<Field
                label="البريد الإلكتروني"
                name="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@example.com"
                required
                value={form.email}
                onChange={(event) =>
                  updateField("email", event.target.value)
                }
              />

<Field
                label="رقم الهاتف"
                name="phone"
                type="tel"
                dir="ltr"
                autoComplete="tel"
                placeholder="رقم الهاتف"
                required
                value={form.phone}
                onChange={(event) =>
                  updateField("phone", normalizeDigits(event.target.value))
                }
              />

<Field
                label="رقم الهوية"
                name="idNumber"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]{9}"
                minLength={9}
                maxLength={9}
                title="أدخل رقم الهوية المكوّن من 9 أرقام"
                placeholder="رقم الهوية"
                hint="يتكوّن من 9 أرقام."
                required
                value={form.idNumber}
                onChange={(event) =>
                  updateField(
                    "idNumber",
                    normalizeDigits(event.target.value)
                  )
                }
              />

<Field
                label="كلمة المرور"
                name="password"
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                placeholder="أنشئ كلمة مرور"
                minLength={10}
                hint="10 أحرف على الأقل. يُفضّل استخدام عبارة طويلة وغير متوقعة."
                required
                wide
                value={form.password}
                onChange={(event) =>
                  updateField("password", event.target.value)
                }
                action={
                  <button
                    className="eco-password-toggle"
                    type="button"
                    aria-label={
                      showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((previous) => !previous)}
                  >
                    <EyeIcon visible={showPassword} />
                  </button>
                }
              />

<div className="eco-field eco-field--wide">
                <label htmlFor="eco-service-area">منطقة الخدمة</label>

<div className="eco-select-wrap">
                  <select
                    id="eco-service-area"
                    name="serviceAreaId"
                    required
                    disabled={!canChooseArea}
                    aria-describedby="eco-area-hint"
                    value={form.serviceAreaId}
                    onChange={(event) =>
                      updateField("serviceAreaId", event.target.value)
                    }
                  >
                    <option value="">
                      {!canChooseArea && catalogLoading
                        ? "جارٍ تحميل مناطق الخدمة..."
                        : !canChooseArea
                          ? "مناطق الخدمة غير متاحة حاليًا"
                          : "اختر منطقة الخدمة"}
                    </option>

{areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.nameAr}
                      </option>
                    ))}
                  </select>

<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="m5 7.5 5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

<small id="eco-area-hint" className="eco-hint">
                  اختر المنطقة التي ترغب في طلب خدمة الجمع فيها.
                </small>

{!canChooseArea && (
                  <div className="eco-catalog-status" role="status">
                    <span>
                      {catalogLoading
                        ? "نجهّز قائمة المناطق المتاحة."
                        : catalog.isError
                          ? "تعذر تحميل المناطق. يرجى المحاولة مرة أخرى."
                          : "لا توجد مناطق خدمة متاحة للتسجيل حاليًا."}
                    </span>

{!catalogLoading && (
                      <button
                        type="button"
                        className="eco-text-button"
                        onClick={() => void catalog.refetch()}
                      >
                        إعادة المحاولة
                      </button>
                    )}
                  </div>
                )}
              </div>
            </fieldset>

<button
              type="submit"
              className="eco-primary eco-submit"
              disabled={busy || !canChooseArea}
            >
              {busy ? (
                <>
                  <span className="eco-spinner" aria-hidden="true" />
                  جارٍ إنشاء حسابك...
                </>
              ) : (
                <>
                  إنشاء حساب
                  <span aria-hidden="true">←</span>
                </>
              )}
            </button>

<p className="eco-next-step">
              بعد إنشاء الحساب، يمكنك تسجيل الدخول وطلب الجمع.
            </p>
          </form>

<div className="eco-login">
            <span>لديك حساب بالفعل؟</span>
            <Link to="/login">تسجيل الدخول</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
