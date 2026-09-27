/**
 * Shared request transition action — used by collector/authority/sorter.
 * Enforces NOTHING itself (backend is the enforcer); purely UX guidance.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/api/client.js";
import { ar } from "../../shared/i18n/ar.js";
import { Alert, Button, Input, Select } from "../../shared/ui/components.js";
import { LazyQrScanner } from "./lazy-qr-scanner.js";
import { BagPrintPrompt } from "./bag-print-prompt.js";
import type { PrintableBag } from "./bag-label-print.js";

interface NextStepInfo {
  next: string | null;
  roles: string[];
  requiresBarcode: boolean;
  assignsCollector: boolean;
  /** Authority/manager MAY pick a specific collector here (direct dispatch)
   *  instead of broadcasting to the area's shared pool. */
  assignsCollectorOptional?: boolean;
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
  role,
  initialBarcode
}: {
  requestId: string;
  currentStatus: string;
  version: number;
  nextInfo: NextStepInfo;
  role: "collector" | "authority" | "sorter" | "manager";
  /** يُعبَّأ مسبقاً عند القدوم من شاشة المسح. */
  initialBarcode?: string;
}): React.ReactNode {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState(initialBarcode ?? "");
  const [scanning, setScanning] = useState(false);
  const [reason, setReason] = useState("");
  const [collectorUserId, setCollectorUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Shown once, right after the collector confirms "تم الجمع" — see
   *  BagPrintPrompt. Pure transient state: never persisted, never re-shown
   *  on reload, which is exactly what makes it "مرة واحدة". */
  const [printableBags, setPrintableBags] = useState<PrintableBag[] | null>(null);

  const showCollectorPicker = role === "authority" && Boolean(nextInfo.assignsCollectorOptional);

  const authorityDash = useQuery({
    queryKey: ["authority-dashboard"],
    queryFn: async () =>
      (await api.GET("/authority/dashboard")).data as unknown as
        | { areaCollectors: { userId: string; displayName: string; activeLoad: number }[] }
        | undefined,
    enabled: showCollectorPicker
  });

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.POST("/requests/{id}/transitions", {
        params: { path: { id: requestId } },
        body: {
          target: nextInfo.next as never,
          expectedVersion: version,
          ...(collectorUserId ? { collectorUserId } : {}),
          ...body
        }
      });
      if (!res.response.ok) {
        const data = res.data as { detail?: string; code?: string } | undefined;
        throw new Error(`${data?.detail ?? "تعذر التنفيذ"}${data?.code ? ` (${data.code})` : ""}`);
      }
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setBarcode("");
      void qc.invalidateQueries({ queryKey: ["request", requestId] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["collector-schedule"] });
      void qc.invalidateQueries({ queryKey: ["collector-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["authority-dashboard"] });

      // One-time print prompt: collector just confirmed "تم الجمع" — offer
      // printing each bag's QR for the thermal label right away.
      if (role === "collector" && nextInfo.next === "collected") {
        const detail = await api.GET("/requests/{id}", { params: { path: { id: requestId } } });
        const bags = (detail.data as unknown as { bags?: PrintableBag[] } | undefined)?.bags ?? [];
        if (bags.length > 0) setPrintableBags(bags);
      }
    },
    onError: (err) => setError(err.message)
  });

  if (printableBags) {
    return (
      <BagPrintPrompt
        bags={printableBags}
        requestRef={requestId.slice(0, 8)}
        onDismiss={() => setPrintableBags(null)}
      />
    );
  }

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
        <>
          <Input
            label={ar.scanBarcode}
            dir="ltr"
            placeholder="CMP-… أو WASTE-QR:v1:CMP-…"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
          />
          {scanning ? (
            <LazyQrScanner
              onScan={(text) => {
                setBarcode(text);
                setScanning(false);
              }}
              onCancel={() => setScanning(false)}
            />
          ) : (
            <Button variant="secondary" onClick={() => setScanning(true)}>
              📷 مسح QR بالكاميرا
            </Button>
          )}
        </>
      ) : null}
      {role === "manager" ? (
        <Input label={`سبب التجاوز (${ar.reason})`} value={reason} onChange={(e) => setReason(e.target.value)} />
      ) : null}
      {showCollectorPicker ? (
        <Select
          label="توجيه إلى"
          value={collectorUserId}
          onChange={(e) => setCollectorUserId(e.target.value)}
        >
          <option value="">— البركة المشتركة (أي جامع متاح في المنطقة) —</option>
          {(authorityDash.data?.areaCollectors ?? []).map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.displayName} — {c.activeLoad} طلب نشط حالياً
            </option>
          ))}
        </Select>
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
        {mutation.isPending
          ? "…"
          : showCollectorPicker && collectorUserId
            ? "توجيه مباشر للجامع المحدد"
            : NEXT_LABELS[nextInfo.next]}
      </Button>
    </div>
  );
}

/** Transition metadata derived on the client for UX only (mirrors §6.2 table). */
export function nextStepFor(status: string): NextStepInfo {
  switch (status) {
    case "received":
      return {
        next: "sent_to_collector", roles: ["authority", "manager"], requiresBarcode: false,
        assignsCollector: false, assignsCollectorOptional: true
      };
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
