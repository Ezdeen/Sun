import { useState } from "react";
import { QrCode } from "./qr-code.js";
import { BagLabelPrintSheet, printBagLabels, type PrintableBag } from "./bag-label-print.js";
import { Button, Card } from "./components.js";

/**
 * One-time prompt shown to the collector immediately after a request is
 * confirmed "تم الجمع" — offers printing a thermal-label QR for each bag,
 * to stick on the physical bag before it's handed off to sorting.
 * Pure transient UI state in the parent (no persistence, no re-appearance
 * on reload) — that's what makes it "مرة واحدة".
 */
export function BagPrintPrompt({
  bags,
  requestRef,
  onDismiss
}: {
  bags: PrintableBag[];
  requestRef?: string;
  onDismiss: () => void;
}): React.ReactNode {
  const [printed, setPrinted] = useState(false);

  if (bags.length === 0) return null;

  return (
    <Card className="border-2 border-emerald-200 bg-emerald-50/40">
      <div className="space-y-3">
        <h3 className="font-semibold text-stone-800">طباعة QR الأكياس</h3>
        <p className="text-sm text-stone-600">
          تم تأكيد الجمع. اطبع رمز كل كيس والصقه عليه قبل تسليمه لمنطقة الفرز — يُستخدم هذا الرمز لاحقاً لتسجيل
          وصول الكيس وتتبعه حتى الوزن والفرز.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {bags.map((bag) => (
            <QrCode key={bag.bagCode} value={bag.qrPayload} label={bag.bagCode} />
          ))}
        </div>
        <BagLabelPrintSheet bags={bags} requestRef={requestRef} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDismiss}>
            {printed ? "تم، إغلاق" : "تخطي"}
          </Button>
          <Button
            onClick={() => {
              setPrinted(true);
              printBagLabels();
            }}
          >
            🖨️ طباعة على الطابعة الحرارية
          </Button>
        </div>
        {printed ? <p className="text-xs text-stone-400">يمكنك إعادة الطباعة أو الإغلاق.</p> : null}
      </div>
    </Card>
  );
}
