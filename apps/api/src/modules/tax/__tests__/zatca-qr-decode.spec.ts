import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qrDataUri, qrSvg } from "../application/zatca/qr-renderer";
import { encodeZatcaQrPayload, zatcaDocumentedSampleFields } from "../application/zatca/tlv";

/**
 * PHASE-037 T-04/H-02 — the QR image DECODE spec (acceptance 3's decode
 * leg): the rendered image must decode back to the EXACT stored payload
 * through a REAL QR reader. The reader runs inside headless Chromium
 * (the same engine the print preview/PDF renderer uses — ADR-0011): the
 * data-URI image is drawn onto a canvas, its pixels feed jsQR, and the
 * decoded text is compared byte-for-byte.
 *
 * jsQR is injected as a STRING script (the UMD dist source) — no DOM
 * reference ever leaks into the Node program, and the evaluate context
 * stays the page's.
 */

const JSQR_DIST = join(__dirname, "../../../../node_modules/jsqr/dist/jsQR.js");

let browser: Awaited<ReturnType<typeof chromium.launch>>;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

/** Decode a QR data-URI image through jsQR inside headless Chromium. */
async function decodeDataUri(dataUri: string): Promise<string> {
  const page = await browser.newPage();
  try {
    // The UMD dist assigns root["jsQR"] in a bare page context — inject
    // it as a script tag, then drive the decode as a STRING expression
    // (the browser-side code never type-checks against the Node lib;
    // no DOM reference leaks into the Node program).
    await page.addScriptTag({ content: readFileSync(JSQR_DIST, "utf8") });
    return (await page.evaluate(
      `(async (uri) => {
        const reader = self.jsQR;
        if (typeof reader !== "function") throw new Error("jsQR failed to initialize");
        const img = new Image();
        img.src = uri;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("image failed to load"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("canvas 2d context unavailable");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = reader(imageData.data, imageData.width, imageData.height);
        if (result === null) throw new Error("the QR image did not decode");
        return result.data;
      })(${JSON.stringify(dataUri)})`,
    )) as string;
  } finally {
    await page.close();
  }
}

describe("QR image renderer — decode round-trip (H-02)", () => {
  it("the documented sample payload decodes back to the EXACT bytes", async () => {
    const payload = encodeZatcaQrPayload(zatcaDocumentedSampleFields());
    const dataUri = await qrDataUri(payload);
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = await decodeDataUri(dataUri);
    expect(decoded).toBe(payload);
  });

  it("an Arabic-seller payload decodes back (multi-byte UTF-8 survives the image)", async () => {
    const payload = encodeZatcaQrPayload({
      sellerName: "شركة الاختبار للتجارة",
      vatRegistrationNumber: "310122393500003",
      timestamp: "2026-01-15T10:30:00Z",
      invoiceTotal: "115.0000",
      vatTotal: "15.0000",
    });
    const decoded = await decodeDataUri(await qrDataUri(payload));
    expect(decoded).toBe(payload);
  });

  it("the SVG path renders a real <svg> (the vector print leg)", async () => {
    const payload = encodeZatcaQrPayload(zatcaDocumentedSampleFields());
    const svg = await qrSvg(payload);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("path");
  });
});
