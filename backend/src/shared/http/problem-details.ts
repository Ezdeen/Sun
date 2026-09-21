/**
 * RFC 7807 Problem Details + Arabic error message catalog.
 * Never leaks stack traces, SQL details or internal paths to clients.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { DomainError, type DomainErrorCode } from "../errors.js";

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: DomainErrorCode | "internal_error";
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: unknown;
}

/** Arabic user-facing messages keyed by stable error codes. */
export const ERROR_MESSAGES_AR: Record<string, string> = {
  unauthorized: "يلزم تسجيل الدخول للمتابعة",
  invalid_credentials: "البريد أو رقم الهاتف أو كلمة المرور غير صحيحة",
  account_locked: "الحساب مقفل مؤقتاً بسبب محاولات دخول متكررة، حاول لاحقاً",
  account_disabled: "الحساب معطّل، راجع إدارة المنصة",
  refresh_reuse_detected: "تم الكشف عن إعادة استخدام رمز تحديث، أُلغيت جميع الجلسات",
  invitation_invalid: "دعوة غير صالحة",
  invitation_expired: "انتهت صلاحية الدعوة",
  weak_password: "كلمة المرور ضعيفة: 10 أحرف على الأقل مع أحرف كبيرة وصغيرة وأرقام ورموز",
  self_registration_disabled: "التسجيل الذاتي للمواطنين معطّل حالياً",
  privileged_role_requires_invitation: "هذا الدور يتطلب دعوة من مدير المنصة",
  forbidden: "لا تملك صلاحية تنفيذ هذا الإجراء",
  role_not_allowed: "دورك لا يسمح بهذا الانتقال",
  override_reason_required: "التجاوز يتطلب سبباً إلزامياً",
  invalid_transition: "انتقال غير صالح: لا يمكن القفز على الخطوات أو الرجوع للخلف",
  concurrent_update: "تم تعديل السجل من جهة أخرى، حدّث الصفحة وأعد المحاولة",
  request_already_assigned: "الطلب مُسند لجامع آخر",
  barcode_mismatch: "الباركود لا يطابق هذا الطلب",
  bag_state_invalid: "حالة الكيس لا تسمح بهذا الإجراء",
  weights_missing: "لا يمكن إنشاء الفاتورة قبل وزن جميع الأكياس",
  duplicate_invoice: "توجد فاتورة فعّالة لهذه الصفقة بالفعل",
  splits_must_sum_100: "مجموع نسب التوزيع يجب أن يساوي 100 بالضبط",
  amount_must_be_positive: "المبلغ يجب أن يكون أكبر من صفر",
  idempotency_conflict: "طلب بنفس المفتاح نفّذ بمعطيات مختلفة",
  invoice_not_voidable: "لا يمكن إلغاء هذه الفاتورة",
  payout_transition_invalid: "انتقال مستحق غير صالح",
  unknown_waste_type: "نوع نفايات غير معروف",
  unknown_addon: "إضافة غير معروفة",
  addon_not_applicable: "الإضافة غير متاحة لهذا النوع",
  duplicate_catalog_code: "الرمز مستخدم مسبقاً",
  not_found: "العنصر غير موجود",
  validation_error: "معطيات غير صالحة",
  conflict: "تعارض في البيانات",
  rate_limited: "عدد كبير من المحاولات، حاول بعد قليل",
  chain_broken: "سلسلة التتبع مكسورة عند حدث معين",
  internal_error: "حدث خطأ داخلي، حاول لاحقاً"
};

export function problemDetails(
  req: FastifyRequest,
  reply: FastifyReply,
  err: unknown
): FastifyReply {
  const requestId = (req.id as string | undefined) ?? "";

  if (err instanceof DomainError) {
    const problem: ProblemDetails = {
      type: `https://waste-platform/errors/${err.code}`,
      title: "خطأ في الطلب",
      status: err.status,
      code: err.code,
      detail: ERROR_MESSAGES_AR[err.code] ?? err.message,
      instance: req.url.split("?")[0],
      requestId,
      errors: err.details
    };
    return reply.status(err.status).send(problem);
  }

  // Validation errors from TypeBox (Fastify ajv-style)
  const validation = (err as { validation?: unknown; validationContext?: unknown })?.validation;
  if (validation) {
    const problem: ProblemDetails = {
      type: "https://waste-platform/errors/validation_error",
      title: "خطأ في الطلب",
      status: 400,
      code: "validation_error",
      detail: "معطيات غير صالحة",
      instance: req.url.split("?")[0],
      requestId,
      errors: validation
    };
    return reply.status(400).send(problem);
  }

  // Unknown error — log server-side only, generic message to client.
  req.log.error({ err, requestId }, "unhandled error");
  const problem: ProblemDetails = {
    type: "https://waste-platform/errors/internal_error",
    title: "خطأ داخلي",
    status: 500,
    code: "internal_error",
    detail: ERROR_MESSAGES_AR["internal_error"]!,
    requestId
  };
  return reply.status(500).send(problem);
}
