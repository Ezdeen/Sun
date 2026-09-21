/**
 * Shared request transition action — used by collector/authority/sorter.
 * Enforces NOTHING itself (backend is the enforcer); purely UX guidance.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import { Alert, Button, Input } from "../../shared/ui/components.js";

interface NextStepInfo {
  next: string | null;
  roles: string[];
  requiresBarcode: boolean;
  assignsCollector: boolean;
}

const NEXT_LABELS: Record<string, string> = {
  sent_to_collector: "إرسال للجامع",
  on_the_way: "بدء الطريق",
  arrived: "تسجيل الوصول",
  collected: "تأكيد الجمع",
  sorted: "إتمام الفرز",
  sold: "البيع (آلي عبر الفاتورة)"
};

export function TransitionAction({
  requestId,
  currentStatus,
  version,
  nextInfo,
  role
}: {
  requestId: string;
  currentStatus: string;
  version: number;
  nextInfo: NextStepInfo;
  role: "collector" | "authority" | "sorter" | "manager";
}): React.ReactNode {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.POST("/requests/{id}/transitions", {
        params: { path: { id: requestId } },
        body: { target: nextInfo.next as never, expectedVersion: version, ...body }
      });
      if (!res.response.ok) {
        const data = res.data as { detail?: string; code?: string } | undefined;
        throw new Error(`${data?.detail ?? "تعذر التنفيذ"}${data?.code ? ` (${data.code})` : ""}`);
      }
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      setBarcode("");
      void qc.invalidateQueries({ queryKey: ["request", requestId] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["collector-schedule"] });
      void qc.invalidateQueries({ queryKey: ["collector-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["authority-dashboard"] });
    },
    onError: (err) => setError(err.message)
  });

  if (currentStatus === "sold") {
    return <div className="text-sm text-stone-400">اكتملت دورة الطلب بالبيع.</div>;
  }
  if (!nextInfo.next || nextInfo.next === "sold") {
    return <div className="text-sm text-stone-400">{NEXT_LABELS["sold"]}</div>;
  }
  if (!nextInfo.roles.includes(role)) {
    return <div className="text-sm text-stone-400">الانتقال التالي ({NEXT_LABELS[nextInfo.next]}) خارج نطاق دورك.</div>;
  }

  const needsBarcode = nextInfo.requiresBarcode;

  return (
    <div className="space-y-3">
      {needsBarcode ? (
        <Input
          label={ar.scanBarcode}
          dir="ltr"
          placeholder="CMP-… أو WASTE-QR:v1:CMP-…"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
        />
      ) : null}
      {role === "manager" ? (
        <Input label={`سبب التجاوز (${ar.reason})`} value={reason} onChange={(e) => setReason(e.target.value)} />
      ) : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <Button
        disabled={mutation.isPending || (needsBarcode && barcode.trim().length < 5)}
        onClick={() =>
          mutation.mutate({
            ...(needsBarcode ? { barcode: barcode.trim() } : {}),
            ...(role === "manager" && reason ? { reason } : {})
          })
        }
      >
        {mutation.isPending ? "…" : NEXT_LABELS[nextInfo.next]}
      </Button>
    </div>
  );
}

/** Transition metadata derived on the client for UX only (mirrors §6.2 table). */
export function nextStepFor(status: string): NextStepInfo {
  switch (status) {
    case "received":
      return { next: "sent_to_collector", roles: ["authority", "manager"], requiresBarcode: false, assignsCollector: false };
    case "sent_to_collector":
      return { next: "on_the_way", roles: ["collector", "manager"], requiresBarcode: false, assignsCollector: true };
    case "on_the_way":
      return { next: "arrived", roles: ["collector", "manager"], requiresBarcode: false, assignsCollector: false };
    case "arrived":
      return { next: "collected", roles: ["collector", "manager"], requiresBarcode: true, assignsCollector: false };
    case "collected":
      return { next: "sorted", roles: ["sorter", "manager"], requiresBarcode: false, assignsCollector: false };
    default:
      return { next: null, roles: [], requiresBarcode: false, assignsCollector: false };
  }
}
