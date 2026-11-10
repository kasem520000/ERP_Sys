# Currency and Precision

> **Status:** STABLE · **Owner:** Localization & Accounting Architecture · **Updated:** 2026-10-27

The authoritative money-precision rulebook, expanding
[ADR-0009](../architecture/ADR/ADR-0009-money-precision.md) into operational detail:
storage types, minor units, rounding points, rounding-difference accounting, FX
conventions, calculation order, worked examples, and display rules. Tax computation
consumes these rules ([TAX_ENGINE.md](TAX_ENGINE.md) §2); the posting engine enforces
the resulting balance invariants
([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)
INV-002, INV-007). **No binary floating point for money anywhere** (NFR-012).

## 1. Storage types (PostgreSQL)

| Value kind | Type | Notes |
|------------|------|-------|
| Monetary amounts (all money columns) | `numeric(19,4)` | Document lines, journal lines, totals, balances |
| Quantities | `numeric(19,6)` | Supports fractional units (kg, liters, hours) |
| FX rates | `numeric(19,8)` | Dated rates; high precision for weak-currency pairs |
| Percentages (tax rates, discount rates) | `numeric(7,4)` | e.g., `15.0000`; the *rate* is never rounded before use |
| Unit costs (WAC/FIFO internal) | `numeric(19,6)` | 6-decimal internal precision; issue amounts round to 4 |
| API transport | JSON **strings** | decimal regex `^-?\d{1,15}(\.\d{1,8})?$` ([ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)) |
| SQLite (offline) | `TEXT` canonical decimal strings | Never REAL/float affinity |

Application arithmetic uses `decimal.js` (34 significant digits) wrapped in
`Money`/`Quantity`/`Rate` value objects; constructing money from a JS number is
lint-banned ([ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)).

## 2. Minor units per regional currency (ISO-4217)

Minor units are **published-standard facts** (ISO-4217), not legal research — they are
seeded in [PHASE-002](../planning/MASTER_ROADMAP.md) as read-only reference data
([../database/SEEDS/README.md](../database/SEEDS/README.md)) and cross-checked once
against the standard at seed review:

| Currency | Minor units | Example |
|----------|-------------|---------|
| SAR — Saudi Riyal | 2 | 1,234.50 |
| AED — UAE Dirham | 2 | 1,234.50 |
| QAR — Qatari Riyal | 2 | 1,234.50 |
| EGP — Egyptian Pound | 2 | 1,234.50 |
| YER — Yemeni Rial | 2 | 1,234.50 |
| BHD — Bahraini Dinar | 3 | 1,234.500 |
| KWD — Kuwaiti Dinar | 3 | 1,234.500 |
| OMR — Omani Rial | 3 | 1,234.500 |
| JOD — Jordanian Dinar | 3 | 1,234.500 |
| IQD — Iraqi Dinar | 3 | 1,234.500 |

A 3-decimal currency is never truncated to 2 for convenience — an OMR invoice rounding at
2 decimals is a correctness bug, not a simplification. USD/EUR (2) are seeded for
cross-border trade.

## 3. Rounding policies

Mode: **decimal half-up** at the currency's minor units (0.005 → 0.01; 0.0375 → 0.038 at
3 decimals). Banker's rounding, float math, and truncation are forbidden for these points.

| Rounding point | Rule |
|----------------|------|
| Line net | `round(qty × unit_price − discount, minor units, half-up)` |
| Line tax | `round(taxable_base × rate, minor units, half-up)` — per line, per tax code ([TAX_ENGINE.md](TAX_ENGINE.md) §2) |
| Document totals | Σ already-rounded lines; the sum is not re-rounded beyond minor units |
| Document tax total | Σ rounded **line** taxes (see §7 example B — never `round(Σ exact)`) |
| FX conversion | Round at the **final posting step only**, not per intermediate computation; residuals are explicit rounding lines ([ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)) |
| Unit costs | 6-decimal internal; issue/consumption amounts round to 4 decimals at posting |

Rounding happens only at these defined points
([../accounting/ACCOUNTING_PRINCIPLES.md](../accounting/ACCOUNTING_PRINCIPLES.md) §5);
everything between them is exact decimal arithmetic.

## 4. Rounding-difference accounting

Residuals are **never dropped, never absorbed into revenue or tax silently** (INV-007):

| Purpose | Direction | Used when |
|---------|-----------|-----------|
| `ROUNDING_GAIN` | Credit | Document header exceeds Σ converted/rounded lines by a residual |
| `ROUNDING_LOSS` | Debit | Σ converted/rounded lines exceeds the header by a residual |

Posting cases:

1. **FX conversion residual** — Σ line-level base amounts (rounded at posting) ≠ rounded
   header conversion (§7 example E).
2. **Tax-only residual** — e.g., a credit note correcting tax without touching net, where
   line rounding leaves a 0.01 gap between document tax and Σ tax-account movements.
3. **Header adjustment residual** — any approved header-level adjustment whose arithmetic
   does not re-derive exactly from lines.

The rounding line is a first-class journal line (account from the `ROUNDING_GAIN`/
`ROUNDING_LOSS` purposes, [../accounting/CHART_OF_ACCOUNTS.md](../accounting/CHART_OF_ACCOUNTS.md)),
visible on the document's journal preview — not a hidden plug.

## 5. FX rate conventions

- **Quotation (normative):** a rate is **base-currency units per 1 unit of document
  (foreign) currency** ([../GLOSSARY.md](../GLOSSARY.md) "Exchange rate"). Multiply a
  document-currency amount by the rate to obtain base-currency value.
  Example: base SAR, document USD, rate `3.7526` → 1 USD = 3.7526 SAR.
- **Storage:** dated rows in the `exchange_rates` table (per currency, per date, 8-dec
  `numeric`), editable under the `accounting.multi_currency` permission; a manual
  override at document level is stored **on the document and its journal** (INV-008) —
  never mutated afterwards
  ([../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md) §4).
- **Rate sources:** manually entered by the tenant, or imported from a configured source
  (bank feed / provider adapter). The source is recorded per rate row; the platform takes
  no responsibility for rate accuracy — it guarantees only that the *stored* rate is the
  one used, immutably.
- **Inverse quoting** in UI is display-only: screens may show "1 SAR = 0.2665 USD", but
  the stored value keeps the forward convention; inverse values are derived, never stored.

## 6. Calculation order (normative)

```
line gross  = qty × unit price
line net    = line gross − line discount            (discount BEFORE tax)
taxable base = line net                             (tax on POST-DISCOUNT net)
line tax    = round(taxable base × rate, minor units)
document net / tax / total = Σ line values
```

- **Discount before tax — always.** Tax is computed on the post-discount net, never on
  the gross and never on a "discounted tax" shortcut.
- **Tax-inclusive pricing:** when a price is tax-inclusive, net is *extracted*, not added:
  `net = round(gross − tax)` where `tax = round(gross × rate / (100 + rate))` at minor
  units; the extraction happens per line before document totals, using the same half-up
  mode. The tenant's inclusive/exclusive default is settable, overridable per document
  ([TAX_ENGINE.md](TAX_ENGINE.md) §5).
- Document-level discounts are allocated proportionally to lines (at full precision)
  **before** line tax is computed, so tax still follows post-discount nets.
- Order matters observably: with fixed-amount discounts and inclusive prices, computing
  tax on gross produces different cents than extracting after discount — golden tests
  pin the correct order (§7 example C).

## 7. Worked examples

> Rates and tax percentages below are **illustrative baseline values** — actual rates are
> versioned per jurisdiction pack with `REQUIRES_VERIFICATION` flags
> ([COUNTRY_PACKS.md](COUNTRY_PACKS.md), [compliance-matrix/](compliance-matrix/README.md)).

### A. Three-line invoice, SAR (2 decimals), 15% standard rate

| Line | Qty × Unit price | Treatment | Net (rounded) | Tax (15%) exact | Tax (rounded) |
|------|------------------|-----------|----------------|-----------------|---------------|
| 1 | 3 × 33.33 = 99.99 | STANDARD_RATED | 99.99 | 14.9985 | **15.00** |
| 2 | 2 × 12.50 = | ZERO_RATED | 25.00 | 0 | 0.00 |
| 3 | 1 × 8.33 = | EXEMPT | 8.33 | 0 | 0.00 |
| **Σ** | | | **133.32** | | **15.00** |

Document totals: net **133.32**, VAT **15.00**, total **148.32**. The tax summary by
treatment feeds the VAT return (INV-012) and the e-invoicing payload.

### B. Line rounding vs. sum rounding (why Σ rounded lines wins)

Three standard-rated lines, nets 1.01, 1.01, 1.02:

- Exact taxes: 0.1515, 0.1515, 0.1530 → rounded line taxes: **0.15, 0.15, 0.15**.
- Document VAT = Σ rounded lines = **0.45**.
- `round(Σ exact) = round(0.456) = 0.46` — **rejected**: the document tax total is the sum
  of its lines, so lines, header, VAT return, and GL tax accounts all agree. The 0.01
  discrepancy between the two methods is expected and *not* posted anywhere.

### C. Discount before tax (fixed discount, exclusive price)

Qty 4 × 25.00 = 100.00 gross; line discount 20.00 → taxable net **80.00** → tax 15% =
**12.00** → line total **92.00**. Computing tax on gross first (15.00) and discounting
afterwards violates the order rule and is blocked by golden tests, not by convention.

### D. FX receipt with realized difference (base SAR, document USD)

Zero-rated export invoice (avoids VAT noise): 10,000.00 USD at invoice-date rate
`3.7526`:

- AR = round(10,000.00 × 3.7526, 2) = **37,526.00 SAR**.
- Posting: `Dr AR 37,526.00` / `Cr Revenue (ZERO_RATED) 37,526.00`.

Receipt one month later, 10,000.00 USD at rate `3.7600`, allocated to the invoice:

- Cash = round(10,000.00 × 3.7600, 2) = **37,600.00 SAR**.
- Posting: `Dr Bank 37,600.00` / `Cr AR 37,526.00` / `Cr FX_GAIN 74.00` (realized FX
  difference, partner + original-document references attached per
  [../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md) §4).
- Partial allocation variant: receipt of 4,000.00 USD → cash 15,040.00; AR settled at
  invoice rate = 15,010.40; `FX_GAIN 29.60`; open AR remaining 6,000.00 USD =
  22,515.60 SAR at the original booked rate.

### E. FX conversion residual → rounding account

Base SAR (2), supplier invoice 100.000 BHD (3) at rate `9.95` SAR/BHD; lines 33.333,
33.333, 33.334 BHD:

- Header conversion (final posting step): round(100.000 × 9.95, 2) = **995.00**.
- Line conversions rounded at posting: 331.66 + 331.66 + 331.67 = **994.99**.
- Residual **0.01** posts as an explicit `ROUNDING_GAIN` journal line (INV-007) — the
  entry balances in base currency exactly (INV-002).

### F. 3-decimal currency rounding (BHD)

Qty 3 × 0.125 BHD = net 0.375; tax at a 10% baseline rate = 0.0375 → half-up at **3**
decimals = **0.038 BHD**. The same value in a 2-decimal currency would round to 0.04 —
the pack's `minor_units` drives the rounding, never a global constant.

## 8. Display formatting rules

- All formatting via `Intl.NumberFormat` with the currency's minor units from the seed
  table — no hand-rolled formatters ([LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md) §7).
- **Symbol vs code policy:** ISO **code** (`SAR 1,234.50`) on formal documents, financial
  statements, and reports — unambiguous and bilingual-safe; **symbol** (e.g., a riyal
  glyph) allowed only in dense interactive UI and POS receipts where space wins and the
  currency is obvious from context. A tenant printing `1,234.50 ﷼` on an A4 statement is
  a formatting bug.
- **Tabular numerals required** (`tnum` font feature) for every numeric column in UI,
  print, and export — decimal points must align in both RTL and LTR layouts
  ([../ui/DESIGN_TOKENS.md](../ui/DESIGN_TOKENS.md)).
- Digit shape per tenant setting (`latn` default, `arab` optional); identifiers, codes,
  and phone numbers are always `latn` ([RTL_AND_LTR.md](RTL_AND_LTR.md) §5).
- **Negative amounts:** minus sign attached to the number (`-1,234.50`); in RTL contexts
  the whole amount renders as one LTR-isolated run so the sign cannot detach or jump
  ([RTL_AND_LTR.md](RTL_AND_LTR.md) §8 case 3). Parenthesis negatives `(1,234.50)` are
  not used; red/green color is a *supplement* to the sign, never a replacement
  (accessibility).
- **Never re-parse a formatted value** as authoritative input (ADR-0009): inputs are
  decimal strings; display is a one-way projection.
- Quantities display up to 6 decimals, trailing zeros trimmed per tenant preference;
  stored precision is untouched.

## 9. Where these rules are enforced

| Layer | Enforcement |
|-------|-------------|
| Domain value objects (`packages/domain-core`) | Types, half-up rounding helpers, banned float construction |
| Tax engine ([TAX_ENGINE.md](TAX_ENGINE.md)) | Line tax rounding, summary by treatment |
| Posting engine ([../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md)) | Base-currency balance (INV-002), explicit rounding lines (INV-007) |
| Tests ([../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md)) | Golden worked examples above (A–F) run as fixtures per release; property tests fuzz rounding points |
