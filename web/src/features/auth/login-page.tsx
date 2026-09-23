import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../app/session.js";
import { ar } from "../../shared/i18n/ar.js";
import "./LoginPage.css";

type IconName =
  | "user"
  | "lock"
  | "eye"
  | "eyeOff"
  | "arrow"
  | "shield"
  | "leaf"
  | "truck"
  | "cycle"
  | "alert";

function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v3" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="m3 3 18 18" />
        <path d="M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.9" />
        <path d="M6.5 6.5A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.5-1.5" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>
    ),
    arrow: <path d="M19 12H5m6-6-6 6 6 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 4C10 2 3 7 5 14c2 7 14 6 15-10Z" />
        <path d="M4 21 15 10" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 4v3h-7" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </>
    ),
    cycle: (
      <>
        <path d="M20 7a9 9 0 0 0-15-2L2 8" />
        <path d="M2 3v5h5" />
        <path d="M4 17a9 9 0 0 0 15 2l3-3" />
        <path d="M22 21v-5h-5" />
      </>
    ),
    alert: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6m0 4h.01" />
      </>
    ),
  };

return (
    <svg
      className={`eco-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

/** شعار متجهي قابل للتكبير، دون ملفات صور خارجية. */
function CircularLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M63 29A25 25 0 0 0 20 20l-6 7"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="m14 15-.5 12.5L26 27"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 51a25 25 0 0 0 43 9l6-7"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="m66 65 .5-12.5L54 53"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28 46c-4-13 7-22 25-20 2 18-8 29-21 24"
        fill="currentColor"
        opacity=".85"
      />
      <path
        d="m26 55 19-20"
        stroke="var(--eco-leaf-vein, #075747)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const features: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "truck",
    title: "جمع منظّم",
    text: "خطوة أولى نحو إدارة أفضل للنفايات.",
  },
  {
    icon: "cycle",
    title: "موارد متجددة",
    text: "إعادة الاستخدام بدلًا من الهدر.",
  },
  {
    icon: "leaf",
    title: "أثر مستدام",
    text: "مسؤولية مشتركة لبيئة أكثر نظافة.",
  },
];

function getReturnPath(state: unknown): string {
  if (!state || typeof state !== "object" || !("from" in state)) {
    return "/";
  }

const from = (state as { from?: unknown }).from;

// السماح بمسار داخلي فقط، ومنع الروابط الخارجية والمحارف غير الآمنة.
  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(from)
  ) {
    return "/";
  }

return from;
}

export function LoginPage(): ReactNode {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const formId = useId();

const submitting = useRef(false);
  const identifierRef = useRef<HTMLInputElement>(null);

const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

const identifierId = `${formId}-identifier`;
  const passwordId = `${formId}-password`;
  const errorId = `${formId}-error`;
  const capsId = `${formId}-caps`;
  const titleId = `${formId}-title`;

const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

if (submitting.current) return;

const normalizedIdentifier = identifier.trim();

if (!normalizedIdentifier) {
      setError("يرجى إدخال البريد الإلكتروني أو اسم المستخدم.");
      identifierRef.current?.focus();
      return;
    }

submitting.current = true;
    setBusy(true);
    setError(null);

try {
      // لا نزيل المسافات من كلمة المرور؛ فقد تكون جزءًا منها.
      await login(normalizedIdentifier, password);
      navigate(getReturnPath(location.state), { replace: true });
    } catch {
      // رسالة عامة بدل إظهار تفاصيل تقنية محتملة من الخادم.
      setError(ar.loginFailed || "تعذّر تسجيل الدخول. يرجى المحاولة مجددًا.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

return (
    <main className="eco-login" dir="rtl" lang="ar">
      <div className="eco-shell">
        <aside className="eco-story" aria-label="عن المنصة">
          <div className="eco-brand">
            <span className="eco-brand__mark">
              <CircularLogo />
            </span>

<div className="eco-brand__text">
              <span className="eco-brand__name">{ar.appName}</span>
              <span className="eco-brand__tagline">{ar.appTagline}</span>
            </div>
          </div>

<div className="eco-story__body">
            <span className="eco-eyebrow">
              <span className="eco-status-dot" />
              معًا نحو اقتصاد دائري
            </span>

<h2>
              لكل مورد
              <br />
              <span>فرصة جديدة.</span>
            </h2>

<p className="eco-story__description">
              تبدأ المدن الأكثر استدامة بخطوة منك. لنجعل جمع النفايات
              وإدارتها بدايةً لدورة جديدة من القيمة، لا نهايةً لها.
            </p>

<div className="eco-orbit" aria-hidden="true">
              <div className="eco-orbit__ring eco-orbit__ring--outer" />
              <div className="eco-orbit__ring eco-orbit__ring--inner" />

<div className="eco-orbit__core">
                <CircularLogo />
              </div>

<span className="eco-orbit__label eco-orbit__label--top">
                <Icon name="truck" />
                جمع
              </span>

<span className="eco-orbit__label eco-orbit__label--right">
                <Icon name="cycle" />
                تدوير
              </span>

<span className="eco-orbit__label eco-orbit__label--left">
                <Icon name="leaf" />
                تجديد
              </span>

<span className="eco-orbit__spark eco-orbit__spark--one" />
              <span className="eco-orbit__spark eco-orbit__spark--two" />
            </div>
          </div>

<ul className="eco-features">
            {features.map((feature) => (
              <li className="eco-feature" key={feature.title}>
                <span className="eco-feature__icon">
                  <Icon name={feature.icon} />
                </span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

<section className="eco-access" aria-labelledby={titleId}>
          <div className="eco-access__top">
            <span className="eco-section-label">
              <Icon name="leaf" />
              بوابتك للمشاركة
            </span>
            <span className="eco-language">العربية</span>
          </div>

<div className="eco-form-container">
            <header className="eco-form-header">
              <span className="eco-welcome-icon">
                <Icon name="lock" />
              </span>

<p className="eco-kicker">خطوة صغيرة. أثر أكبر.</p>
              <h1 id={titleId}>أهلًا بعودتك</h1>
              <p>سجّل دخولك لمتابعة رحلتك نحو بيئة أكثر استدامة.</p>
            </header>

<form
              className="eco-form"
              onSubmit={submit}
              aria-busy={busy}
              aria-describedby={error ? errorId : undefined}
            >
              <fieldset className="eco-fieldset" disabled={busy}>
                <legend className="eco-sr-only">بيانات تسجيل الدخول</legend>

<div className="eco-form-field">
                  <label htmlFor={identifierId}>{ar.identifier}</label>

<div className="eco-input-wrap">
                    <Icon name="user" className="eco-input-icon" />
                    <input
                      ref={identifierRef}
                      id={identifierId}
                      name="username"
                      type="text"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="البريد الإلكتروني أو اسم المستخدم"
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      dir="ltr"
                    />
                  </div>
                </div>

<div className="eco-form-field">
                  <label htmlFor={passwordId}>{ar.password}</label>

<div className="eco-input-wrap">
                    <Icon name="lock" className="eco-input-icon" />
                    <input
                      id={passwordId}
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyDown={(event) =>
                        setCapsLock(event.getModifierState("CapsLock"))
                      }
                      onKeyUp={(event) =>
                        setCapsLock(event.getModifierState("CapsLock"))
                      }
                      onBlur={() => setCapsLock(false)}
                      placeholder="أدخل كلمة المرور"
                      required
                      autoComplete="current-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-describedby={capsLock ? capsId : undefined}
                      dir="ltr"
                    />

<button
                      className="eco-password-toggle"
                      type="button"
                      onClick={() => setShowPassword((previous) => !previous)}
                      aria-label="إظهار كلمة المرور"
                      aria-pressed={showPassword}
                      aria-controls={passwordId}
                      title={
                        showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                      }
                    >
                      <Icon name={showPassword ? "eyeOff" : "eye"} />
                    </button>
                  </div>

{capsLock && (
                    <p className="eco-caps-warning" id={capsId} role="status">
                      <Icon name="alert" />
                      مفتاح الأحرف الكبيرة Caps Lock مفعّل.
                    </p>
                  )}
                </div>

{error && (
                  <div className="eco-error" id={errorId} role="alert">
                    <Icon name="alert" />
                    <span>{error}</span>
                  </div>
                )}

<button
                  className="eco-submit"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="eco-spinner" aria-hidden="true" />
                      <span>جارٍ تسجيل الدخول…</span>
                    </>
                  ) : (
                    <>
                      <span>{ar.login}</span>
                      <Icon name="arrow" />
                    </>
                  )}
                </button>
              </fieldset>

<span className="eco-sr-only" role="status">
                {busy ? "جارٍ التحقق من بيانات تسجيل الدخول." : ""}
              </span>
            </form>

<div className="eco-divider">
              <span>مساحة للجميع، وأثر يجمعنا</span>
            </div>

<div className="eco-account-links">
              <p>
                مواطن جديد؟
                <Link to="/register">{ar.createAccount}</Link>
              </p>

<Link
                className="eco-invitation-link"
                to="/accept-invitation"
              >
                <span className="eco-invitation-link__icon">
                  <Icon name="shield" />
                </span>
                <span>
                  <strong>لديك دعوة للانضمام؟</strong>
                  <span>{ar.acceptInvite}</span>
                </span>
                <Icon name="arrow" className="eco-invitation-arrow" />
              </Link>
            </div>
          </div>

<footer className="eco-access__footer">
            <Icon name="leaf" />
            <span>نفايات أقل. قيمة أكبر. مستقبل أفضل.</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
