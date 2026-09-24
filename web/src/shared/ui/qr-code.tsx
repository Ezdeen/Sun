import { QRCodeSVG } from "qrcode.react";

export function QrCode({
  value,
  size = 168,
  label
}: {
  value: string;
  size?: number;
  label?: string;
}): React.ReactNode {
  return (
    <figure className="inline-flex flex-col items-center gap-2 rounded-xl border border-stone-200 bg-white p-3">
      <QRCodeSVG value={value} size={size} level="M" marginSize={1} title={label ?? "رمز QR"} />
      {label ? <figcaption className="max-w-[200px] text-center text-xs text-stone-500">{label}</figcaption> : null}
    </figure>
  );
}
