# AGENTS.md — دليل التعديل الآمن

> قواعد عامة قبل أي تعديل:
> 1. **لا تعدّل `domain/` بلا اختبار يثبت التغيير.**
> 2. **لا تضف منطقاً في `api/`** — الطبقة HTTP للتحقق والاستدعاء فقط.
> 3. **كل تغيير مالي يتطلب اختبار خاصية** (property test) في `tests/property/`.
> 4. حد أقصى ~300 سطر/ملف و~40 سطر/دالة.
> 5. بعد أي تعديل: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @waste/backend arch`.

---

## الوصفات

### 1) إضافة نوع نفايات أو إضافة تشجيعية
- أضف الصف في `backend/src/modules/seeds/data/waste_types.json` (أو `addons.json` مع `appliesTo`).
- شغّل `pnpm db:seed` (Idempotent — يحدّث الأسعار والأسماء ولا يكرر).
- **لا هجرة مطلوبة** (الجدول موجود). للإضافة عبر API: `POST /api/v1/admin/waste-types` (manager).
- الاختبار: حدّث `tests/unit/pricing.test.ts` إن أضفت قاعدة سعرياً جديدة.

### 2) تغيير نسب التوزيع أو سقف المكافآت
- **وقت التشغيل (بدون نشر):** `PATCH /api/v1/admin/settings` (manager) — يُتحقق أن مجموع النسب = 100.
- **الافتراضيات:** `backend/src/modules/administration/application/settings.ts` (`DEFAULT_PRICING`, `DEFAULT_SPLITS`) + `backend/src/modules/seeds/seed.ts` (صفوف `platform_settings`).
- **الفواتير القديمة لا تتأثر** — لقطة النسب تُجمَّد على كل فاتورة (`splits_snapshot`).
- الاختبار: `tests/property/distribution.test.ts` يجب أن يبقى أخضر (الحفظ مستقل عن النسب).

### 3) إضافة حالة جديدة أو تغيير الأدوار المسموحة
- عدّل `backend/src/modules/collection/domain/lifecycle.ts`:
  - `REQUEST_STATUSES` (الترتيب قانوني — لا قفز) ثم `TRANSITIONS` (جدول البيانات).
  - أضف الحقل الزمني المطابق في `schema.ts` + هجرة (انظر الوصفة 6).
  - حدّث `STATUS_LABELS_AR`.
- حدّث فوراً: `tests/unit/lifecycle.test.ts` (المصفوفة + الخاصية) و`web/src/shared/i18n/ar.ts` و`web/src/shared/ui/transition-action.tsx` (خاصية UX فقط).
- **`sold` يبقى نظامياً فقط** — لا تضف دوراً بشرياً له أبداً.

### 4) إضافة دور أو صلاحية جديدة
- `backend/src/modules/identity/domain/permissions.ts`: أضف للـ `PERMISSIONS` ثم لمصفوفة كل دور في `ROLE_PERMISSIONS`.
- حدّث **المرآة**: `backend/src/modules/seeds/data/permissions.json` (يوجد اختبار يطابقهما: `tests/unit/permissions.test.ts`).
- الواجهة: أضف الدور في `web/src/app/session.tsx` (type Role) + `web/src/app/app-shell.tsx` (NAV) + `web/src/app/router.tsx` (مسارات + guard).
- كل نقطة نهاية جديدة يجب أن تمر بـ `guards.requirePermission(...)` — لا استثناءات.

### 5) إضافة نقطة API جديدة
1. Use Case في `modules/<م>/application/<الحالة>.ts` (ملف واحد، معاملة واحدة).
2. المسار في `modules/<م>/api/routes.ts`: TypeBox schema (body/query/headers) + `guards.requirePermission`.
3. حدّث العقد: `pnpm --filter @waste/backend export-openapi` (يكتب `openapi.json`).
4. ولّد عميل الواجهة: `pnpm gen:api` (يكتب `web/src/shared/api/schema.d.ts`).
5. الاختبارات: أضف فحصاً في `tests/e2e/full-journey.ts` (الدور الصحيح 2xx، دور خاطئ 403/404).
6. شاشة الواجهة تستهلك الـ API فقط — **ممنوع أي منطق تجاري في React**.

### 6) تعديل قاعدة البيانات (هجرة آمنة)
- عدّل `backend/src/shared/db/schema.ts` أولاً (مصدر أنواع الـ ORM).
- هجرة جديدة: `cd backend && npx drizzle-kit generate --name <وصف>` ثم راجع الـ SQL يدوياً.
- اتبع **Expand → Migrate → Contract** للتعديلات الكاسرة (عمود جديد nullable → تعبئة → حذف القديم لاحقاً).
- أضف الحراسات (unique/check/triggers) في `drizzle/0001_guards.sql` أو هجرة جديدة.
- **ممنوع `drizzle-kit push` في الإنتاج** — `db:migrate` فقط (خطوة preDeploy في Render).
- أعد توليد ملف Supabase: `node scripts/generate-supabase-sql.mjs`.
- اختبر على قاعدة فارغة: `db:migrate` ثم `db:seed` ثم شغّل الرحلة E2E.

### 7) تبديل مزود المصادقة أو تفعيل التثبيت (AnchorPort)
- **المصادقة:** طبقة `TokenService` (`identity/application/token-service.ts`) هي نقطة الاستبدال — أنشئ تنفيذاً جديداً لنفس الواجهة ثم بدّل التوصيل في `main.ts`. لا تلمس use cases.
- **التثبيت على Hedera/بلوك تشين:** نفّذ `AnchorPort` (واجهة: `anchor(merkle_root) → AnchorReceipt`). التنفيذ الافتراضي `NoOpAnchor` يترك `anchor_status = not_anchored` — **ممنوع توليد مراجع تثبيت وهمية**. جدول `outbox` جاهز لتجميع الجذور (Merkle) — أضف عاملاً يستهلك `outbox` غير المعالج ويثبّت الجذور ثم يسجل الإيصال. لا يتغير المحرك إطلاقاً.

---

## ماذا تختبر بعد كل تعديل (الحد الأدنى)

| نوع التغيير | الاختبارات الإلزامية |
|---|---|
| domain (أي ملف) | unit + property للمحرك المعني |
| مالي | property distribution + E2E الرحلة كاملة |
| schema/هجرة | migrate من قاعدة فارغة + seed + E2E |
| API | E2E (دور صحيح/خاطئ) + إعادة توليد openapi.json |
| صلاحيات | اختبار المصفوفة (role × endpoint) |
| واجهة | typecheck + build + (اختبار الشاشة عبر Playwright) |

## ممنوعات (تُفشل الـ CI)

- ملف يجمع domain + HTTP + SQL.
- منطق تجاري في `api/` أو في React.
- `any` لإسكات TypeScript، SQL غير معلْمَت، وصول DB من الواجهة.
- endpoint بلا permission أو غير موجود في `openapi.json`.
- query كتابة ضمن Dashboards (قراءة فقط).
- أرقام سحرية خارج الإعدادات أو ثوابت المجال.
- كلمات مرور افتراضية، حسابات تجريبية في الإنتاج، `DEMO_MODE=true` خارج development (الإقلاع يفشل).
