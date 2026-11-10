import QRCode from "qrcode";

/**
 * PHASE-037 T-04 · the QR image renderer: the stored base64 TLV payload →
 * a real scannable QR image. Server-side, render-at-print ONLY (OA-06:
 * the image is never persisted — `qr_payload` is the stored truth, the
 * pixels are derived each time; batch prints re-render cheaply from the
 * same payload).
 *
 * Two output shapes, both consumed by the versioned print templates
 * (packages/ui/print):
 *   - dataUri  — a PNG data URI for the <img> tag (receipts + A4; the
 *                same HTML the web preview shows — ADR-0011).
 *   - svg      — an inline <svg> string (the Chromium PDF path prefers
 *                vector; the template embeds it directly).
 *
 * Sizing budget (phase §7 risk 4): the PNG pixel size is fixed at 256px
 * (prints at ~25-30mm on A4 / 80mm rolls — inside the ZATCA reader's
 * minimum module size at typical printer DPIs) with margin 1 quiet zone;
 * the receipt templates scale via CSS max-inline-size.
 */

const QR_PNG_SIZE = 256;

/** PNG data URI for the print templates' <img> tags. */
export async function qrDataUri(payload: string): Promise<string> {
  // No explicit color option: the qrcode library's default is maximum-
  // contrast dark-on-light (the scanner-functional requirement); the
  // DESIGN_TOKENS rule forbids raw hex outside packages/ui tokens.
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: QR_PNG_SIZE,
  });
}

/** Inline SVG string (vector path for the Chromium PDF renderer). */
export async function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
