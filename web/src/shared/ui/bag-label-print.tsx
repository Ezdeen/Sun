import { QRCodeSVG } from "qrcode.react";
import "./bag-label-print.css";

export interface PrintableBag {
  bagCode: string;
  qrPayload: string;
  wasteTypeCode?: string;
}

/**
 * Thermal-label sheet for one or more bags — one label per bag, sized for a
 * common 50×30mm thermal label printer (see @page rule in bag-label-print.css).
 * Rendered off-screen except when the browser's print dialog is active
 * (`.bag-label-print` is hidden on screen, visible only `@media print`).
 */
export function BagLabelPrintSheet({
  bags,
  requestRef
}: {
  bags: PrintableBag[];
  /** رقم/مرجع الطلب — يُطبع كنص صغير أسفل كل ملصق للمطابقة اليدوية عند الحاجة. */
  requestRef?: string;
}): React.ReactNode {
  return (
    <div className="bag-label-print" aria-hidden="true">
      {bags.map((bag) => (
        <div className="bag-label" key={bag.bagCode}>
          <QRCodeSVG value={bag.qrPayload} size={132} level="M" marginSize={0} />
          <div className="bag-label-code">{bag.bagCode}</div>
          {requestRef ? <div className="bag-label-ref">{requestRef}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function printBagLabels(): void {
  window.print();
}
