/**
 * PHASE-016 T4/T6 — print helper for HTML artifacts (POS receipts, guest
 * checks, the Z report): renders the HTML in an off-screen iframe and calls
 * its `print()` — the same document the server Chromium renderer would
 * print (ADR-0011: screen and paper cannot diverge). Styling inside the
 * payload is the artifact's own (pt/mm units, no screen tokens).
 */
export function printHtmlDocument(html: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "print");
  frame.setAttribute("style", "position:fixed;inset-inline-start:-100%;width:0;height:0;border:0");
  frame.srcdoc = html;
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1000);
    }
  });
  document.body.appendChild(frame);
}
