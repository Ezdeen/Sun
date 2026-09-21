# ADR-005 — خط الأساس Node.js 24 LTS

**الحالة:** مقبول (2026-09)

## السياق
مواصفة المشروع تشترط LTS مستقراً مثبتاً في كل مكان، مع ترقية موثقة عند الحاجة.

## القرار
Node.js 24 LTS خط الأساس: `engines.node >=24 <25` في root/backend/web، صورة `node:24-alpine` في Docker، `node-version: 24` في CI، وruntime node في render.yaml. لا إصدارات Current/Experimental.

## العواقب
- ✅ سلوك موحد بين المحلي/Docker/CI/Render.
- ✅ Node 24 يوفر `fetch` و`crypto.randomUUID` وWebCrypto أصلية (تقليل الاعتمادات).
- ⚠️ الترقية إلى LTS أحدث = ADR جديد + تحديث متزامن للأربعة مواضع (قائمة في AGENTS.md).
