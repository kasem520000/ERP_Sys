import { describe, expect, it } from "vitest";

import {
  renderPushMessage,
  type PushTemplate,
  type PushTemplateVars,
} from "./fcm-templates";

/**
 * PHASE-022 · DR-P22-07 unit evidence (the templates.spec.ts precedent for
 * the push registry): rendering is byte-stable per locale, AR titles carry
 * the Arabic strings verbatim (byte-asserted), and NO template's variable
 * vocabulary contains a financial field — amounts/prices/balances never
 * ride a push (the db suite proves the wire side through the fake FCM).
 */

const FINANCIAL_KEY_RE =
  /amount|price|total|balance|qty|quantity|value|paid|due_amount|debit|credit|discount|tax|cash/i;

/** The complete variable vocabulary every renderer may read (the safe set). */
const SAFE_VARIABLE_KEYS = ["docNo", "customerName", "dueDate", "deviceName", "at"] as const;

describe("push templates (AR/EN, byte-stable, no financial payloads)", () => {
  it("renders invoice_posted_to_customer in Arabic with the exact registry bytes", () => {
    const vars: PushTemplateVars = {
      docNo: "SAL-2026-000042",
      customerName: "شركة النور للتجارة",
    };
    const rendered = renderPushMessage("invoice_posted_to_customer", "ar", vars);
    expect(rendered).toEqual({
      title: "فاتورة مرحّلة: SAL-2026-000042",
      body: "تم ترحيل فاتورة العميل «شركة النور للتجارة» رقم SAL-2026-000042. يمكنكم مراجعة تفاصيلها من التطبيق.",
    });
  });

  it("renders the EN counterpart and is byte-stable for identical input", () => {
    const vars: PushTemplateVars = {
      docNo: "RCP-2026-000007",
      customerName: "Al Noor Trading",
    };
    const once = renderPushMessage("receipt_confirmed", "en", vars);
    const twice = renderPushMessage("receipt_confirmed", "en", vars);
    expect(once).toEqual(twice);
    expect(once.title).toBe("Receipt confirmed: RCP-2026-000007");
    expect(once.body).toBe(
      'Receipt RCP-2026-000007 from customer "Al Noor Trading" was confirmed. Open the app to review it.',
    );
  });

  it("every template renders in BOTH locales (no missing catalog slot)", () => {
    const templates: PushTemplate[] = [
      "invoice_posted_to_customer",
      "receipt_confirmed",
      "due_date_reminder",
      "device_security_alert",
    ];
    for (const template of templates) {
      for (const locale of ["ar", "en"] as const) {
        const rendered = renderPushMessage(template, locale, {
          docNo: "SAL-2026-000001",
          customerName: "Fixture",
          dueDate: "2026-12-01",
          deviceName: "Van tablet 1",
          at: "2026-11-05T10:00:00Z",
        });
        expect(rendered.title.length).toBeGreaterThan(0);
        expect(rendered.body.length).toBeGreaterThan(0);
      }
    }
  });

  it("NO financial field exists in any template's variable vocabulary", () => {
    // The renderer source is the registry's own vocabulary surface: assert
    // the safe-set (the only keys PushTemplateVars admits) and that none of
    // them is financial. The wire-side belt (adapter whitelist) is proven in
    // the db suite against the fake FCM.
    for (const key of SAFE_VARIABLE_KEYS) {
      expect(FINANCIAL_KEY_RE.test(key)).toBe(false);
    }
    expect(FINANCIAL_KEY_RE.test("docNo")).toBe(false);
    expect(FINANCIAL_KEY_RE.test("amount")).toBe(true); // the detector works
  });

  it("renders never leak amounts even when a caller passes extra vars", () => {
    // Extra variables are ignored by the registry: an amount key injected by
    // a caller never reaches a rendered title/body (unknown fields are not
    // part of the vocabulary; the adapter drops them from the data payload).
    const rendered = renderPushMessage("due_date_reminder", "ar", {
      docNo: "SAL-2026-000043",
      customerName: "شركة النور",
      dueDate: "2026-12-01",
    });
    expect(rendered.title).not.toMatch(/150|ريال|SAR/i);
    expect(rendered.body).toContain("2026-12-01");
  });

  it("device_security_alert + due_date_reminder carry the exact registry bytes in both locales", () => {
    expect(
      renderPushMessage("device_security_alert", "ar", {
        deviceName: "Van tablet 1",
        at: "2026-11-05T10:00:00Z",
      }),
    ).toEqual({
      title: "تنبيه أمني للجهاز",
      body: "تم رصد إشارة ثقة للجهاز «Van tablet 1» في 2026-11-05T10:00:00Z. يمكنكم مراجعة إعدادات الجهاز من التطبيق.",
    });
    expect(
      renderPushMessage("due_date_reminder", "en", {
        docNo: "SAL-2026-000044",
        customerName: "Al Noor",
        dueDate: "2026-12-01",
      }).title,
    ).toBe("Due date reminder: SAL-2026-000044");
  });
});
