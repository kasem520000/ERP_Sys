/**
 * PHASE-013 T12 · the Chromium render service (PRINTING_AND_EXPORT §3,
 * ADR-0011): pooled headless Chromium rendering the SAME HTML payload as
 * the web preview. Hard rules: no user-supplied HTML (payloads are
 * generated from typed data by the versioned templates), no network fetch
 * inside render (all routes/requests aborted; fonts are embedded data
 * URIs), render timeout 60 s (heavy pack: 300 s), bounded pool
 * concurrency (RISK-013), PDF/A-2b identification stamping for
 * archive-class packs (period close) via pdf-lib XMP metadata.
 */

import { Semaphore } from "../../../../infra/concurrency/semaphore";
import { stampPdfA2b, pdfPageCount } from "./pdf-a";

export interface RenderInput {
  readonly html: string;
  readonly options: {
    readonly format: "A4" | { readonly receiptWidthMm: number };
    readonly locale: "ar" | "en";
    readonly footerTemplate: string;
    readonly pdfA?: "pdfa-2b";
    readonly timeoutMs?: number;
  };
}

export interface RenderOutput {
  readonly pdf: Buffer;
  readonly pages: number;
  readonly renderMs: number;
  readonly templateVersion: number;
}

/** The render-engine port (tests bind a fake; production binds Chromium). */
export interface RenderEngine {
  render(input: RenderInput): Promise<RenderOutput>;
}

const MAX_POOL = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const HEAVY_TIMEOUT_MS = 300_000;

export class ChromiumRenderEngine implements RenderEngine {
  private readonly pool = new Semaphore(MAX_POOL);
  private browserPromise: Promise<import("playwright").ChromiumBrowser> | undefined;

  private async browser() {
    if (this.browserPromise === undefined) {
      this.browserPromise = (async () => {
        const { chromium } = await import("playwright");
        return chromium.launch({ headless: true });
      })();
    }
    return this.browserPromise;
  }

  async render(input: RenderInput): Promise<RenderOutput> {
    const started = Date.now();
    const timeoutMs = input.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const release = await this.pool.acquire();
    try {
      const browser = await this.browser();
      const context = await browser.newContext();
      // No network fetch inside render (binding): abort every route.
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      try {
        page.setDefaultTimeout(timeoutMs);
        await page.setContent(input.html, { waitUntil: "load", timeout: timeoutMs });
        const pdfOptions: Parameters<import("playwright").Page["pdf"]>[0] = {
          format: input.options.format === "A4" ? "A4" : undefined,
          width:
            input.options.format === "A4" ? undefined : `${input.options.format.receiptWidthMm}mm`,
          printBackground: true,
          displayHeaderFooter: true,
          footerTemplate: input.options.footerTemplate,
          headerTemplate: "<span></span>",
          margin:
            input.options.format === "A4"
              ? { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" }
              : { top: "3mm", bottom: "3mm", left: "2.5mm", right: "2.5mm" },
        };
        const raw = await page.pdf(pdfOptions);
        let bytes: Uint8Array = new Uint8Array(raw);
        if (input.options.pdfA === "pdfa-2b") {
          bytes = await stampPdfA2b(bytes);
        }
        const pages = await pdfPageCount(bytes);
        const pdf = Buffer.from(bytes);
        return { pdf, pages, renderMs: Date.now() - started, templateVersion: 1 };
      } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    const promise = this.browserPromise;
    this.browserPromise = undefined;
    if (promise !== undefined) {
      // A rejected launch (no headless Chromium in this environment) must
      // not escape close() — the render spec's afterAll calls this and
      // its documented contract is a graceful skip, not a suite failure.
      const browser = await promise.catch(() => undefined);
      if (browser !== undefined) {
        await browser.close().catch(() => undefined);
      }
    }
  }
}

/** Heavy packs (period close) get the 300 s budget (PRINTING_AND_EXPORT §3). */
export const HEAVY_RENDER_TIMEOUT_MS = HEAVY_TIMEOUT_MS;
