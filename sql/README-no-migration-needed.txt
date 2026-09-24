لا حاجة لأي هجرة أو تعديل على قاعدة البيانات لهذه الميزة.

جدول app.users يحتوي أصلاً على كل الأعمدة اللازمة
(role, display_name, email, phone, status ...) وجداول الملفات الشخصية
(citizens/collectors/authorities/staff_profiles) موصولة بعلاقة
ON DELETE CASCADE مع users، لذا حذف حساب يحذف ملفه الفرعي تلقائياً.

عند حذف حساب له سجلات عمل مرتبطة (طلبات، صفقات، فواتير...) فإن قيد
المفتاح الخارجي (FK) يرفض الحذف (ON DELETE NO ACTION) — وهذا مقصود
لحماية البيانات المالية والتشغيلية. الكود الخلفي
(backend/src/modules/identity/application/manage-accounts.ts)
يلتقط هذا الرفض ويحوّله لرسالة عربية تطلب تعطيل الحساب بدلاً من حذفه.

بإيجاز: لا يوجد ملف SQL مطلوب لتفعيل هذه الميزة.
