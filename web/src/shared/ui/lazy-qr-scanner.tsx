import { lazy, Suspense } from "react";
import { Loading } from "./components.js";

const QrScanner = lazy(() =>
  import("./qr-scanner.js").then((m) => ({ default: m.QrScanner }))
);

export function LazyQrScanner(props: {
  onScan: (text: string) => void;
  onCancel?: () => void;
}): React.ReactNode {
  return (
    <Suspense fallback={<Loading />}>
      <QrScanner {...props} />
    </Suspense>
  );
}
