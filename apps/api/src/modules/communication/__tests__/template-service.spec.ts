import { describe, expect, it } from "vitest";

import {
  BUILTIN_TEMPLATES,
  builtinVariableCatalog,
  findBuiltinTemplate,
} from "../application/template-catalog";
import {
  renderTemplate,
  validateTemplateUpsert,
  type EffectiveTemplate,
} from "../application/template-service";
import { TemplateRenderError, TemplateShapeInvalidError } from "../domain/communication-errors";

/**
 * PHASE-041 T-04 — the template substrate (pure half): the builtin
 * catalog's SELF-validation (every builtin passes the tenant write gate),
 * the AR/EN parity discipline, the fail-closed renderer, and the
 * WhatsApp positional-parameter order.
 */

describe("builtin catalog integrity (FD-30's fallback contract)", () => {
  it("every builtin passes the same validation a tenant write faces", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(() =>
        validateTemplateUpsert({
          key: template.key,
          channel: template.channel,
          locale: template.locale,
          module: template.module,
          subject: template.subject ?? null,
          body: template.body,
          variables: [...template.variables],
          isActive: true,
        }),
      ).not.toThrow();
    }
  });

  it("carries AR/EN parity for every key × channel (the i18n discipline)", () => {
    const localesByKeyChannel = new Map<string, Set<string>>();
    for (const template of BUILTIN_TEMPLATES) {
      const composite = `${template.key}|${template.channel}`;
      const locales = localesByKeyChannel.get(composite) ?? new Set<string>();
      locales.add(template.locale);
      localesByKeyChannel.set(composite, locales);
    }
    for (const [composite, locales] of localesByKeyChannel) {
      expect([...locales].sort(), `parity for ${composite}`).toEqual(["ar", "en"]);
    }
  });

  it("the dunning ladder ships all three steps × three channels (the 039/036 handoff)", () => {
    for (const key of ["dunning.step1", "dunning.step2", "dunning.step3"]) {
      for (const channel of ["EMAIL", "WHATSAPP", "SMS"] as const) {
        for (const locale of ["ar", "en"] as const) {
          const template = findBuiltinTemplate(key, channel, locale);
          expect(template, `${key}/${channel}/${locale}`).toBeDefined();
          if (channel === "EMAIL") {
            expect(template!.subject).toBeTruthy();
          } else {
            expect(template!.subject).toBeUndefined();
          }
        }
      }
    }
  });

  it("the variable catalog is exposed for the DATA_DICTIONARY wave", () => {
    expect(builtinVariableCatalog().length).toBe(BUILTIN_TEMPLATES.length);
  });
});

describe("validateTemplateUpsert (the write gate)", () => {
  const base = {
    key: "custom.notice",
    channel: "EMAIL" as const,
    locale: "ar" as const,
    module: "crm",
    subject: "إشعار {{doc_number}}",
    body: "مرحباً {{customer_name}}، مستندكم {{doc_number}} جاهز.",
    variables: [
      { name: "customer_name", required: true, description: "d" },
      { name: "doc_number", required: true, description: "d" },
    ],
    isActive: true,
  };

  it("accepts the base shape", () => {
    expect(() => validateTemplateUpsert(base)).not.toThrow();
  });

  it("rejects EMAIL without a subject and WHATSAPP/SMS with one", () => {
    expect(() =>
      validateTemplateUpsert({ ...base, subject: null }),
    ).toThrow(TemplateShapeInvalidError);
    expect(() =>
      validateTemplateUpsert({
        ...base,
        channel: "WHATSAPP",
        subject: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateTemplateUpsert({
        ...base,
        channel: "SMS",
        subject: "عنوان",
      }),
    ).toThrow(/body-only/);
  });

  it("rejects undeclared placeholders, duplicates, and SMS oversize", () => {
    expect(() =>
      validateTemplateUpsert({ ...base, body: "غريب {{unknown_var}}" }),
    ).toThrow(/not declared/);
    expect(() =>
      validateTemplateUpsert({
        ...base,
        variables: [
          { name: "customer_name", required: true, description: "d" },
          { name: "customer_name", required: false, description: "d" },
          { name: "doc_number", required: true, description: "d" },
        ],
      }),
    ).toThrow(/duplicate variable/);
    expect(() =>
      validateTemplateUpsert({ ...base, channel: "SMS", subject: null, body: "ط".repeat(481) }),
    ).toThrow(/480/);
  });
});

describe("renderTemplate (fail-closed rendering)", () => {
  const template: EffectiveTemplate = {
    id: "test",
    key: "nudge.invoice_due",
    channel: "WHATSAPP",
    locale: "ar",
    module: "invoice_overdue",
    subject: null,
    body: "مرحباً {{customer_name}}، الفاتورة {{invoice_number}} بمبلغ {{amount_due}} تستحق في {{due_date}}.",
    variables: [
      { name: "customer_name", required: true, description: "d" },
      { name: "invoice_number", required: true, description: "d" },
      { name: "amount_due", required: true, description: "d" },
      { name: "due_date", required: true, description: "d" },
    ],
    isActive: true,
    overridden: false,
  };

  it("renders byte-stable text and the WhatsApp params in DECLARATION order", () => {
    const rendered = renderTemplate(template, {
      customer_name: "شركة الأمل",
      invoice_number: "INV-001",
      amount_due: "1,250.00 ر.س",
      due_date: "2026-11-20",
    });
    expect(rendered.body).toBe(
      "مرحباً شركة الأمل، الفاتورة INV-001 بمبلغ 1,250.00 ر.س تستحق في 2026-11-20.",
    );
    expect(rendered.whatsappParams).toEqual([
      "شركة الأمل",
      "INV-001",
      "1,250.00 ر.س",
      "2026-11-20",
    ]);
    expect(rendered.subject).toBeNull();
  });

  it("fails closed on a missing required variable (never 'Hello {{name}}')", () => {
    expect(() =>
      renderTemplate(template, {
        customer_name: "شركة الأمل",
        invoice_number: "INV-001",
        amount_due: "1,250.00",
      }),
    ).toThrow(TemplateRenderError);
  });

  it("renders EMAIL subjects too; non-WhatsApp channels carry no params", () => {
    const email: EffectiveTemplate = {
      ...template,
      channel: "EMAIL",
      subject: "تذكير — {{invoice_number}}",
    };
    const rendered = renderTemplate(email, {
      customer_name: "x",
      invoice_number: "INV-9",
      amount_due: "5.00",
      due_date: "2026-01-01",
    });
    expect(rendered.subject).toBe("تذكير — INV-9");
    expect(rendered.whatsappParams).toBeNull();
  });
});
