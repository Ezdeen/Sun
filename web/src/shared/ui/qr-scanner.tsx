import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Alert, Button } from "./components.js";

function describeCameraError(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (!window.isSecureContext) return "الكاميرا تتطلب اتصالاً آمناً (HTTPS).";
  if (/NotAllowed|Permission/i.test(text)) return "تم رفض إذن الكاميرا. اسمح بالوصول من إعدادات المتصفح ثم أعد المحاولة.";
  if (/NotFound|device not found/i.test(text)) return "لم يتم العثور على كاميرا في هذا الجهاز.";
  return "تعذر تشغيل الكاميرا. يمكنك إدخال الكود يدوياً.";
}

export function QrScanner({
  onScan,
  onCancel
}: {
  onScan: (text: string) => void;
  onCancel?: () => void;
}): React.ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // عنصر مستقل لكل تشغيل: يتفادى تعارض StrictMode (تشغيل/إيقاف مزدوج).
    const el = document.createElement("div");
    el.id = `qr-${Math.random().toString(36).slice(2)}`;
    host.appendChild(el);

    const scanner = new Html5Qrcode(el.id, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });

    let handled = false;
    const started = scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          if (handled) return;
          handled = true;
          onScanRef.current(text.trim());
        },
        () => {
          /* إطارات بلا رمز — تجاهل */
        }
      )
      .catch((err: unknown) => setError(describeCameraError(err)));

    return () => {
      void started.then(async () => {
        try {
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        } catch {
          /* الكاميرا أُغلقت مسبقاً */
        } finally {
          el.remove();
        }
      });
    };
  }, []);

  return (
    <div className="space-y-3">
      <div ref={hostRef} className="overflow-hidden rounded-xl bg-stone-900 [&_video]:w-full" />
      {error ? (
        <Alert kind="error">{error}</Alert>
      ) : (
        <p className="text-center text-xs text-stone-500">وجّه الكاميرا نحو رمز QR الخاص بالمواطن</p>
      )}
      {onCancel ? (
        <Button variant="secondary" onClick={onCancel}>إيقاف الكاميرا</Button>
      ) : null}
    </div>
  );
}
