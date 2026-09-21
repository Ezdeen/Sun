# دليل التشغيل (RUNBOOK)

## النشر على Render + Supabase — خطوة بخطوة

### 1) قاعدة البيانات (Supabase)
1. أنشئ مشروع Supabase (منطقة قريبة — فرانكفورت مقترحة لتطابق render.yaml).
2. **SQL Editor → New query** → الصق كامل `sql/supabase_schema.sql` → Run.
   - السكربت Idempotent (آمن للإعادة) وينشئ: schema `app` + 24 جدولاً + المتتاليات + المحرّمات + RLS deny-all + البيانات المرجعية.
   - قسم الحسابات التجريبية **معلّق** افتراضياً ولا يُفعّل إلا في قواعد التطوير.
3. انسخ سلسلة الاتصال: Project Settings → Database → Connection string (Pooler/Transaction, منفذ 6543). استبدل `[password]`.
   > الاتصال عبر Pooler (6543) هو المناسب لخدمة Render (pool داخلي صغير max=10).

### 2) الخدمة (Render)
**طريقة Blueprint (موصى بها):** New → Blueprint → اربط المستودع → سيلتقط `deploy/render.yaml`.

**يدوياً (Web Service):**
- Runtime: Node
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @waste/web gen:api && pnpm --filter @waste/web build && pnpm --filter @waste/backend build`
- **Pre-Deploy Command:** `corepack enable && pnpm --filter @waste/backend db:migrate`
- Start: `node backend/dist/main.js`
- Health Check Path: `/api/v1/health/ready`

**متغيرات البيئة (Environment):**
| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | سلسلة Supabase (سرّي) |
| `JWT_SECRET_KEY` | `openssl rand -base64 48` (سرّي) |
| `IDENTITY_PEPPER` | `openssl rand -base64 48` (سرّي) |
| `APP_ENV` / `NODE_ENV` | production |
| `DEMO_MODE` | false (**إلزامي** — الإقلاع يفشل خلافه) |
| `ALLOW_CITIZEN_SELF_REGISTRATION` | true/false حسب سياساتك |
| `CORS_ORIGINS` | اتركه فارغاً (نفس الأصل) |
| `LOG_LEVEL` | info |

### 3) أول مدير (مرة واحدة)
من جهاز لديه اتصال بقاعدة الإنتاج:
```bash
DATABASE_URL="<سلسلة supabase>" APP_ENV=development \
  pnpm --filter @waste/backend cli create-admin admin@yourdomain.com 'Str0ng!Passw0rd!'
```
بعد ذلك أنشئ بقية الأدوار عبر **الدعوات** من واجهة المدير (`/manager/invitations`).

### 4) فحص الدخان بعد النشر (§11.6)
```
GET /health/live          → 200 {"status":"ok"}
GET /health/ready         → 200 {"database":"up"}
GET /login                → صفحة SPA (200 HTML)
POST /auth/login (خطأ)    → 401 Problem Details عربية
أي dashboard بلا رمز      → 401
migration head            → drizzle/meta/_journal.json آخر إدخال = آخر هجرة
```

## التشغيل المحلي

```bash
pnpm install
cp .env.example .env          # عدّل القيم
pnpm db:migrate               # يطبق الهجرات
pnpm db:seed                  # البيانات المرجعية (Idempotent)
pnpm --filter @waste/backend cli create-admin …
pnpm db:seed:demo             # تطوير فقط — 6 حسابات Demo@12345!
pnpm dev                      # API :4000 + واجهة :5173 (بروكسي)
pnpm test && cd backend && npx tsx tests/e2e/full-journey.ts
docker compose -f deploy/docker-compose.yml up --build
```

## المهام التشغيلية

### التحقق من سلسلة التتبع (روتيني)
```bash
DATABASE_URL=… pnpm --filter @waste/backend cli verify-chain request <uuid>
# exit code 0 = سليمة، 2 = مكسورة (يعرض أول حدث مكسور)
```
أو من الواجهة: المدير → التتبع → الصق معرف الطلب.

### تدوير JWT_SECRET_KEY
1. أضف المتغير الجديد مع `JWT_KEY_ID` جديد (مثل `waste-jwt-2026-02`) وأعد النشر.
2. الرموز القديمة تنتهي طبيعياً خلال `ACCESS_TOKEN_TTL_SECONDS` (15 دقيقة افتراضياً)؛ الجلسات تبقى عبر refresh rotation.
3. (اختياري للطرد الفوري) اطلب من المستخدمين إعادة الدخول.

### تدوير IDENTITY_PEPPER (حساس)
تغيير الفليبر يُبطل مطابقة هويات المواطنين المخزنة (CIT- hash). المسار الآمن:
1. أضف kid جديداً واحتفظ بالقديم مفعّلاً (المخطط الحالي يحفظ `identity_hash` واحداً — **قبل أي تدوير فعلي** نفّذ ADR جديداً يضيف عمود هاش متعدد الأجيال إن احتجته).
2. القاعدة العملية: **لا تدير الفليبر ما لم تضطر**؛ عند الضرورة تعتمد خطة إعادة تسجيل هوية المواطنين.

### الاسترجاع (Backup/Restore)
- Supabase: Daily Backups مفعّلة افتراضياً — راجع Database → Backups.
- تأكيد إضافي: `pg_dump` دوري خارجي لجدولي `tracking_events` و`ledger_entries` (سجلات مالية غير قابلة للتعديل حتى إدارياً).

### إلغاء فاتورة (تصحيح مالي)
الفواتير لا تُعدَّل أبداً. المسار: **قيد عكسي** — أنشئ فاتورة عكسية مرتبطة (`reversal_of`) + إبطال المستحقات (`void` بسبب إلزامي) ثم فاتورة جديدة صحيحة. (حالة `invoice_status='void'` مدعومة في المخطط؛ تطبيق الحالة العكسي عبر use case مخصص عند الحاجة الفعلية — وثّق قرارك في ASSUMPTIONS).

## استكشاف الأخطاء

| العرضة | السبب الأرجح | الحل |
|---|---|---|
| الإقلاع يفشل: "JWT_SECRET_KEY … too short" | سر مفقود/ضعيف في Render | عيّن قيمة `openssl rand -base64 48` |
| `/health/ready` = 503 | قاعدة غير موجودة أو DATABASE_URL خاطئ | تحقق من Pooler 6543 وبيانات الاعتماد |
| 500 على أول طلب بعد نشر جديد | الهجرات لم تُطبق | Pre-Deploy Command مضبوط؟ نفّذ `db:migrate` |
| دخول demo مرفوض في الإنتاج | سلوك مقصود (DEMO_MODE) | أنشئ حسابات حقيقية عبر create-admin والدعوات |
| "relation app.users does not exist" | القاعدة فارغة | نفّذ `sql/supabase_schema.sql` أو `db:migrate + db:seed` |
| عرض بطيء للوحات | فهارس المنطقة/الحالة موجودة؛ راجع pool size | ارفع DB_POOL_SIZE في Supabase pooler settings |
