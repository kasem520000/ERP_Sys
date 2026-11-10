# Localization Architecture

> **Status:** STABLE · **Owner:** Localization & Experience Architecture · **Updated:** 2026-10-27

The logical internationalization (i18n) model of the Platform: Arabic-first with complete
English parity across web, print, API, and mobile. This file defines locale handling,
message catalogs, and formatting policy. Screen-level direction *styling* lives in
[../ui/RTL_DESIGN_RULES.md](../ui/RTL_DESIGN_RULES.md); the bidi/isolation *data* rules
live in [RTL_AND_LTR.md](RTL_AND_LTR.md); money formatting rules in
[CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md); per-country legal configuration
in [COUNTRY_PACKS.md](COUNTRY_PACKS.md). The foundation lands in
[PHASE-005](../implementation/phases/PHASE-005.md); NFR-001 (identical AR/EN feature
parity, **no untranslated financial term**) is the acceptance bar.

## 1. Locale model

| Property | Decision |
|----------|----------|
| Supported locales | `ar` (Arabic — default, first-class) and `en` (English — complete parity), per assumption A-013 |
| Locale identifiers | BCP-47 tags: `ar` / `ar-SA`-style regional variants and `en` / `en-US`; region subtags resolve from the tenant's jurisdiction pack country |
| Default for new tenants | `ar` (tenant setting, changeable at onboarding and later) |
| Catalog format | ICU MessageFormat; **one source of truth** shared by web, print, API-error rendering, and React Native clients |
| Web runtime | `next-intl` pattern (ICU messages, `messages/{locale}/{module}.json` catalogs, server + client components) |
| Mobile runtime | React Native (Expo, [ADR-0014](../architecture/ADR/ADR-0014-android-expo.md)) uses the same ICU catalogs via an Intl-backed runtime — no separate translation files, ever |
| Print runtime | Print templates resolve strings from the same catalogs at render time ([ADR-0011](../architecture/ADR/ADR-0011-reporting-printing.md)) |

**Parity rule (hard):** a feature ships only when both `ar` and `en` catalogs cover every
user-facing string it renders. An AR-only or EN-only feature is a release blocker, not a
degradation (NFR-001). Arabic is never a "translation of" English: canonical Arabic terms
come from [../GLOSSARY.md](../GLOSSARY.md), and financial terminology is reviewed against
that controlled vocabulary before merge.

## 2. Message key namespacing

Keys are flat strings namespaced `module.screen.element` (dots denote hierarchy; catalogs
are stored as nested JSON files that compile to these keys):

```
sales.invoice_list.title            →  "الفواتير" / "Invoices"
sales.invoice_form.field_due_date   →  "تاريخ الاستحقاق" / "Due date"
tax.return_report.status_ready      →  "جاهز للإرسال" / "Ready to file"
errors.TAX_REGISTRATION_REQUIRED    →  ICU message with placeholders (§10)
enums.STANDARD_RATED                →  "خاضع للنسبة الأساسية" / "Standard-rated"
```

Rules:

1. One catalog file per module per locale (`messages/ar/sales.json`, `messages/en/sales.json`).
2. Shared/shell strings live in a `common` module; error codes in an `errors` module;
   enum labels in an `enums` module (§6).
3. Keys are identifiers, never English text; renaming a key is a reviewed change.
4. The [GLOSSARY.md](../GLOSSARY.md) Arabic column is the terminology source of truth;
   CI runs a glossary-consistency scan on the `ar` catalogs (warning-level until the
   glossary is fully mapped, then error-level).

## 3. Pluralization and gender (Arabic-specific ICU rules)

Arabic has **six** CLDR plural categories (`zero`, `one`, `two`, `few`, `many`, `other`)
— all must be authored, not just `one`/`other`:

```
common.invoice_count = {count, plural,
  zero {لا توجد فواتير}
  one  {فاتورة واحدة}
  two  {فاتورتان}
  few  {# فواتير}
  many {# فاتورةً}
  other {# فاتورة}}
```

English uses the same ICU key with `one`/`other`. Rules:

- All counts rendered through ICU `plural`; concatenating "فاتورة" + a number literal is
  lint-banned.
- Numbers inside messages come from `{count}` placeholders formatted by `Intl` at render
  time (digit shape per §7) — never baked into the string.
- **Gender:** UI copy prefers gender-neutral phrasing. Where a message must address the
  user in a gendered form, use ICU `select`:

```
common.welcome = {gender, select,
  male   {أهلاً بك في المنصة}
  female {أهلاً بكِ في المنصة}
  other  {أهلاً بك في المنصة}}
```

- Gender data is optional on the user profile; absence resolves to the `other` clause.
- Verb tense rules: system status messages use neutral nominal sentences (e.g., "تم
  الترحيل" / "Posted") — no second-person verbs in status toasts.

## 4. Locale negotiation (resolution order)

```
user profile preference  >  tenant default locale  >  browser Accept-Language  >  fallback `ar`
```

1. **User preference** — per-user setting stored on the profile; applies to every client
   (web, desktop shell, Android app).
2. **Tenant default** — set at onboarding (pack suggests `default_language`; tenant
   confirms), changeable by admins.
3. **Accept-Language** — parsed with full BCP-47 range matching; unsupported languages
   (e.g., `fr`) never switch the app to a partial locale; they fall through.
4. **Fallback `ar`** — Arabic is the platform default, so an undetectable preference
   yields Arabic, never English.

The locale does **not** change direction of data: `dir` derives from the active locale
(`ar` → RTL, `en` → LTR) and document/print direction follows template locale
([RTL_AND_LTR.md](RTL_AND_LTR.md) §2).

## 5. Fallback chains

- **Within a language:** regional variants resolve to the base (`ar-SA` → `ar`).
- **Across languages:** a missing key falls back `ar → en` and `en → ar` **in production
  only as an emergency net**. In practice this must never fire: the CI key-parity check
  (§9) fails the build when the `ar` and `en` key sets differ.
- **Dev/test behavior:** a missing key renders as the raw key and logs to the console and
  telemetry — visible, not silent.
- Missing-*string* handling is different from missing-*key*: a key present with an empty
  value is a catalog lint error.

## 6. Localized domain data (bilingual columns pattern)

Regulated business data is bilingual by design, not by translation service:

- Pattern: paired columns `name` (English/primary) + `name_ar` (Arabic) on user-facing
  master data — items, partners, accounts, UoMs, cost centers, print templates, report
  definitions ([../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md)).
- Display resolution: active locale column first; if empty, the other column renders and
  the field is flagged by the bilingual data-quality indicator.
- Tenants can enforce "bilingual required" per entity used on documents (items and
  partners default ON where the jurisdiction pack's `bilingual_requirements` say so —
  e.g., invoice line descriptions must print in Arabic).
- Seed data (CoA template, UoMs, roles — [../database/SEEDS/README.md](../database/SEEDS/README.md))
  ships fully bilingual; tenants extend it bilingually.
- Full-text search spans both columns with the normalization rules in
  [RTL_AND_LTR.md](RTL_AND_LTR.md) §7.
- **Machine data is never localized:** codes, numbers, identifiers, SKUs are single,
  direction-isolated values ([RTL_AND_LTR.md](RTL_AND_LTR.md) §3).

## 7. Numbers, dates, currency, and calendar

All formatting goes through `Intl` (`Intl.NumberFormat`, `Intl.DateTimeFormat`) — never
hand-rolled formatting functions. Configuration per tenant:

| Aspect | Policy |
|--------|--------|
| Digit shape | Tenant setting `display.digits`: `latn` (Western, default) or `arab` (Arabic-Indic ٠١٢…); codes, phone numbers, document numbers are **always** `latn` regardless ([RTL_AND_LTR.md](RTL_AND_LTR.md) §5) |
| Currency | `Intl.NumberFormat` with `currency` style; minor units from the ISO-4217 seed; symbol-vs-code policy in [CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md) §8 |
| Amounts | Never re-parse a formatted value as input; inputs are decimal strings (ADR-0009) |
| Dates | `Intl.DateTimeFormat` per locale; tenant date-order preference (`dd/MM/yyyy` default in the region) seeded from the jurisdiction pack |
| Business calendar | **Gregorian** — fiscal years, periods, document dates are Gregorian (assumption A-004) |
| Hijri | Display and search support via `Intl` Islamic calendar (`islamic-umalqura`): date pickers offer dual calendars; documents may *print* a Hijri date alongside the Gregorian one when the pack requires it — the stored, authoritative date stays Gregorian |
| Fiscal calendar | Never Hijri at MVP; if a jurisdiction later mandates a Hijri fiscal year, that is a pack-driven extension of the `accounting` module (A-004 revisit trigger) |

## 8. Timezone policy

- **Storage:** all timestamps are `timestamptz` in **UTC**; the database never stores local
  wall-clock times ([../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md)).
- **Business dates:** document dates (invoice date, due date) are calendar *dates*
  interpreted in the tenant's display time zone — not UTC instants.
- **Display time zone:** tenant default = the jurisdiction pack's country time zone
  (e.g., KSA `Asia/Riyadh` UTC+3, no DST), with an optional per-user override.
- **Reporting:** "as of" semantics (statement date, aging) evaluate in the tenant display
  time zone so a receipt at 23:30 local is *not* silently tomorrow's transaction.
- **Offline clients** keep the device clock for display only; authoritative times come
  from the server on sync ([ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md)).

## 9. Translation QA (CI-enforced)

| Gate | What it checks |
|------|----------------|
| Key-parity check | `ar` and `en` catalogs have **identical key sets** per module; drift fails the build |
| Untranslated-string scan | No user-facing literal in components (lint rule bans raw strings in JSX/render paths); extraction coverage report per module |
| Pseudo-localization | A generated pseudo-locale (strings padded ~40%, diacritics added, brackets wrapped) runs the app in tests to catch truncation, layout breakage, and hardcoded text — part of the [PHASE-005](../implementation/phases/PHASE-005.md) harness |
| Visual snapshots | Bilingual screenshot suites in **both directions** for every page archetype — the RISK-015 mitigation (Hijri/Arabic-numeral UX edge cases) |
| Glossary consistency | `ar` catalog terms diffed against [../GLOSSARY.md](../GLOSSARY.md); new terms require glossary review |
| ICU parse validation | Every catalog message must compile as valid ICU in **both** locales (a broken `plural` branch fails the build) |

## 10. API errors → localized messages

The API never returns human-readable prose as the only error channel. It returns stable
**machine codes + parameters** ([../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md)
error model); clients localize:

```
HTTP 422
{
  "error": {
    "code": "TAX_REGISTRATION_REQUIRED",
    "params": { "jurisdiction": "SA" },
    "trace_id": "…"
  }
}
```

- Client maps `code` → catalog key `errors.TAX_REGISTRATION_REQUIRED` with ICU params:

```
errors.TAX_REGISTRATION_REQUIRED =
  ar: "لا يمكن ترحيل فاتورة ضريبية دون تسجيل ضريبي ساري في {jurisdiction}."
  en: "A tax invoice cannot be posted without an active tax registration in {jurisdiction}."
```

- Unknown codes (older client, newer server) render a generic localized message **plus
  the raw code**, which the user can quote to support.
- Validation errors carry structured params (field, limit) so messages can pluralize and
  format correctly client-side.
- Offline/desktop/mobile clients embed the same `errors` catalog so behavior is identical
  offline ([../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md)).
- Codes are part of the public API contract: renaming one is a versioned API change.

## 11. Implementation mapping

| Concern | Phase |
|---------|-------|
| Catalog infrastructure, negotiation, parity CI, RTL foundation | [PHASE-005](../implementation/phases/PHASE-005.md) |
| Bilingual seeds, locale-aware master data | [PHASE-006](../implementation/phases/PHASE-006.md) |
| Pack-driven formats (dates, digits, bilingual invoice fields) | [PHASE-009](../implementation/phases/PHASE-009.md) (packs land — [COUNTRY_PACKS.md](COUNTRY_PACKS.md)) |
| Print templates AR/EN | [PHASE-013](../implementation/phases/PHASE-013.md) |
| Mobile parity (same catalogs) | [PHASE-022](../implementation/phases/PHASE-022.md) |

Related: [RTL_AND_LTR.md](RTL_AND_LTR.md) (direction data rules),
[TAX_ENGINE.md](TAX_ENGINE.md) (tax vocabulary), risk RISK-015 in
[../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md).
