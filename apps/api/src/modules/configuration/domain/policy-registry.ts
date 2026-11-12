import { DomainError } from "@erp/domain-core";
import type { WorkflowPolicyValue } from "@erp/contracts";

/**
 * Platform policy registry for manifest `workflow_policies` keys
 * (PHASE-015 T1; industries/README §3 "typed policy values validated against
 * the platform policy registry; unknown keys are rejected").
 *
 * A manifest may only set policy keys THIS registry knows — every key used
 * by the thirteen shipped templates (retail / grocery / restaurant + the
 * PHASE-017 automotive / distribution pair + the PHASE-018
 * food_manufacturing template + the PHASE-019 professional_services
 * template + the PHASE-030 wholesale / electronics pair + the PHASE-031
 * healthcare commercial shell + the PHASE-032 education template + the
 * PHASE-033 agriculture template + the delivery-completion rental &
 * logistics shell, v1.0.0,
 * `packages/contracts/src/industry/templates.ts`) is transcribed below with
 * its canonical type, owning module, and optional mapping onto a
 * SETTINGS_REGISTRY key (L5 override surface). *
 * `inventory.fefo_for_expiry_items` NOTE (deliberate): grocery/restaurant
 * set FEFO via `inventory_policy_defaults.fefo_picking`, NOT via
 * workflow_policies — the manifest inventory-defaults section is the L1
 * source for that settings key (applied as an L1 default that L5 may
 * override; the remaining inventory_policy_defaults fields are apply-time
 * defaults for NEWLY created items, industries/README §5 R3 — they are not
 * policy keys and never enter the policy map).
 */

/** Value kinds a workflow policy may carry (§3: string | number | boolean). */
export type PolicyValueType = "boolean" | "string" | "number" | "enum";

export interface PolicyDefinition {
  readonly key: string;
  readonly valueType: PolicyValueType;
  /** For `enum` policies: the closed value set. */
  readonly enumValues?: readonly string[];
  /** Platform default (the lowest precedence rung; manifests refine it). */
  readonly default: WorkflowPolicyValue;
  /**
   * Optional SETTINGS_REGISTRY key this policy maps onto. When present, the
   * manifest value lands as the L1 DEFAULT for that settings key and the
   * tenant overrides it through the normal L5 surface (§3 precedence:
   * L10 > L5 > L1 > platform default).
   */
  readonly settingsKey?: string;
  /** Owning runtime module (MODULE_BOUNDARIES vocabulary). */
  readonly module: string;
  readonly description: string;
}

function booleanPolicy(
  key: string,
  module: string,
  defaultValue: boolean,
  description: string,
  settingsKey?: string,
): PolicyDefinition {
  return settingsKey === undefined
    ? { key, valueType: "boolean", default: defaultValue, module, description }
    : { key, valueType: "boolean", default: defaultValue, module, description, settingsKey };
}

export const POLICY_REGISTRY: Readonly<Record<string, PolicyDefinition>> = Object.freeze({
  // --- shared by all templates --------------------------------------------
  cash_sales_autopost: booleanPolicy(
    "cash_sales_autopost",
    "sales",
    false,
    "BR-005: cash sales may auto-post on save (APPROVED→POSTED recorded as policy-driven). Maps onto the sales.cash_autopost settings key; POS terminals set their own posture in PHASE-016.",
    "sales.cash_autopost",
  ),
  shift_variance_approval_required: booleanPolicy(
    "shift_variance_approval_required",
    "treasury",
    true,
    "BR-021: closing a cashier shift with a variance requires supervisor attestation (id + PIN + reason) instead of auto-posting.",
  ),
  // --- retail --------------------------------------------------------------
  "pos.return_requires_original_invoice": booleanPolicy(
    "pos.return_requires_original_invoice",
    "pos",
    true,
    "BR-004 at the counter: POS returns/exchanges must reference the original invoice; the reference requirement itself never disables.",
  ),
  exchange_same_value_only: booleanPolicy(
    "exchange_same_value_only",
    "pos",
    false,
    "Counter exchanges are limited to same-value items; different-value exchanges route as return + new sale.",
  ),
  stock_transfer_in_transit_visible: booleanPolicy(
    "stock_transfer_in_transit_visible",
    "inventory",
    true,
    "In-transit stock (branch transfers) is visible as a distinct state in stock screens instead of hidden until receipt.",
  ),
  // --- grocery -------------------------------------------------------------
  expiry_writeoff_requires_approval: booleanPolicy(
    "expiry_writeoff_requires_approval",
    "inventory",
    true,
    "Near-expiry write-offs post only after approval; approved write-offs post as shrinkage with reason EXPIRED (INVENTORY_ACCOUNTING §5).",
  ),
  markdown_requires_approval: booleanPolicy(
    "markdown_requires_approval",
    "inventory",
    false,
    "Near-expiry markdown price changes require approval before they take effect on price lists.",
  ),
  batch_expiry_capture_required_on_grn: booleanPolicy(
    "batch_expiry_capture_required_on_grn",
    "inventory",
    true,
    "Goods receipts of batch-tracked items must capture batch expiry dates — missing expiry fails the GRN line (fail closed).",
  ),
  scale_item_weighed_lines: booleanPolicy(
    "scale_item_weighed_lines",
    "items",
    true,
    "Scale items sell on weighed quantity lines (weight pricing) rather than discrete unit counts.",
  ),
  // --- restaurant ----------------------------------------------------------
  default_pos_order_type: Object.freeze({
    key: "default_pos_order_type",
    valueType: "enum",
    enumValues: Object.freeze(["dine_in", "takeaway", "delivery"]),
    default: "dine_in",
    module: "pos",
    description:
      "The default order type new POS orders start with (dine_in / takeaway / delivery).",
  } satisfies PolicyDefinition),
  unpaid_table_holds_no_ledger: booleanPolicy(
    "unpaid_table_holds_no_ledger",
    "pos",
    true,
    "Open table orders hold NO ledger effects until the check is settled — the sale posts at settlement, never at order time (INV-012 discipline).",
  ),
  combo_explosion_at_posting: booleanPolicy(
    "combo_explosion_at_posting",
    "items",
    true,
    "Composite/combos explode into their component items at POSTING time (inventory effects on components, revenue on the combo) — never at order entry.",
  ),
  service_charge_default_rate: Object.freeze({
    key: "service_charge_default_rate",
    valueType: "number",
    default: 0,
    module: "pos",
    description:
      "Default service-charge rate (%) applied to guest checks; 0 = off. Locally mandated service charges come from the jurisdiction pack (L2), never from this default.",
  } satisfies PolicyDefinition),
  daily_waste_count_recommended: booleanPolicy(
    "daily_waste_count_recommended",
    "inventory",
    true,
    "The daily close (Z close) recommends recording a kitchen waste count; it is a recommendation, never a posting requirement.",
  ),
  // --- automotive (PHASE-017) ----------------------------------------------
  job_card_parts_issue_mode: Object.freeze({
    key: "job_card_parts_issue_mode",
    valueType: "enum",
    enumValues: Object.freeze(["reserve", "issue_immediate"]),
    default: "reserve",
    module: "sales",
    description:
      "Workshop parts policy (industry-workflows (b)): reserve = approved job cards HOLD parts via inventory.reservations (availability hold, COGS at invoice); issue_immediate = COGS journal + stock move at issue, referencing the card.",
  } satisfies PolicyDefinition),
  job_card_labor_rate_source: Object.freeze({
    key: "job_card_labor_rate_source",
    valueType: "enum",
    enumValues: Object.freeze(["price_list"]),
    default: "price_list",
    module: "sales",
    description:
      "Labor lines bill from the labor-rate price list (per-hour rate × logged hours); price_list is the only supported source at PHASE-017 — actual technician cost is not tracked (no payroll module).",
  } satisfies PolicyDefinition),
  quotation_validity_days: Object.freeze({
    key: "quotation_validity_days",
    valueType: "number",
    default: 7,
    module: "sales",
    description:
      "Default validity window (days) for diagnosis quotations generated from a job card — BR-006: a quotation past its valid_until cannot be accepted or converted.",
  } satisfies PolicyDefinition),
  invoice_approval_required_over: Object.freeze({
    key: "invoice_approval_required_over",
    valueType: "number",
    default: 0,
    module: "sales",
    description:
      "Workshop invoices require approval when the total exceeds this amount (base currency); 0 = every invoice goes through the BR-034 approval leg (never self-approved).",
  } satisfies PolicyDefinition),
  warranty_credit_note_requires_original_invoice: booleanPolicy(
    "warranty_credit_note_requires_original_invoice",
    "sales",
    true,
    "Warranty credit notes must reference the original invoice (BR-004 family); returned parts re-enter stock at the ORIGINAL issue cost.",
  ),
  // --- distribution (PHASE-017) --------------------------------------------
  van_loadout_requires_transfer: booleanPolicy(
    "van_loadout_requires_transfer",
    "inventory",
    true,
    "Van load-out is executed as a stock transfer to the VAN warehouse (BR-016): in-transit stock is visible but never sellable or reservable.",
  ),
  settlement_required_daily: booleanPolicy(
    "settlement_required_daily",
    "distribution",
    true,
    "Every rep day ends with a settlement (STL-): expected vs counted cash, invoice/return reconciliation — the day cannot close with pending documents.",
  ),
  settlement_variance_approval_required: booleanPolicy(
    "settlement_variance_approval_required",
    "distribution",
    true,
    "A rep settlement whose counted cash differs from the expected total requires supervisor approval (BR-021 family); within tolerance it posts the variance with a reason.",
  ),
  collection_receipt_at_visit: booleanPolicy(
    "collection_receipt_at_visit",
    "treasury",
    true,
    "Collections taken during a route visit post a receipt (RCP-) at the visit itself — the money is attributed to the rep day, never batched to the evening.",
  ),
  tier_price_automatic_by_partner: booleanPolicy(
    "tier_price_automatic_by_partner",
    "distribution",
    true,
    "BR-003 precedence: the customer's tier price list resolves automatically from the partner's tier assignment (customer list → tier list → branch default → base price); manual override stays within BR-002 ceilings.",
  ),
  credit_sale_credit_limit_enforced: booleanPolicy(
    "credit_sale_credit_limit_enforced",
    "sales",
    true,
    "Route credit sales enforce the customer's credit limit online at save (BR-001 block/warn/ignore posture applies at the visit, not at settlement).",
  ),
  free_goods_require_reason_code: booleanPolicy(
    "free_goods_require_reason_code",
    "sales",
    true,
    "BR-008: free goods are zero-price lines carrying a free-goods reason code — never negative lines or memo-only adjustments; the reason rides the sales_invoice_lines.foc_reason_code column.",
  ),
  // --- manufacturing (PHASE-018) -------------------------------------------
  production_qc_gate: Object.freeze({
    key: "production_qc_gate",
    valueType: "enum",
    enumValues: Object.freeze(["required", "off"]),
    default: "off",
    module: "manufacturing",
    settingsKey: "manufacturing.qc_gate",
    description:
      "PHASE-018 §4 QC gate: with 'required' every completed FG batch enters QUARANTINED status until an inspection releases it (PASS+ACCEPT) or scraps it (FAIL+SCRAP — the qc_scrap posting); with 'off' the FG batch lands ACTIVE directly. The platform default is off; the food_manufacturing manifest ships 'required' as its L1 default.",
  } satisfies PolicyDefinition),
  scrap_reason_required: booleanPolicy(
    "scrap_reason_required",
    "manufacturing",
    true,
    "PHASE-018 §1: production scrap (pre-completion WIP scrap and post-completion QC-fail scrap) always carries a reason code — the DR PRODUCTION_SCRAP journal line must explain itself; the platform default requires it.",
    "manufacturing.scrap_reason_required",
  ),
  fg_batch_expiry_from_shelf_life: booleanPolicy(
    "fg_batch_expiry_from_shelf_life",
    "manufacturing",
    true,
    "PHASE-018 §1: at order completion the FG batch expiry = completedAt + item.shelf_life_days (when the item carries a shelf life); turning it off leaves the FG batch without an expiry date.",
    "manufacturing.fg_batch_expiry_from_shelf_life",
  ),
  consumption_variance_threshold_pct: Object.freeze({
    key: "consumption_variance_threshold_pct",
    valueType: "number",
    default: 5,
    module: "manufacturing",
    settingsKey: "manufacturing.consumption_variance_threshold_pct",
    description:
      "PHASE-018 §5 variance review: after each consume, cumulative consumed qty above planned × (1 + threshold/100) flags the order line (over_plan) and raises the stock-category review notification — consumption is never blocked; correction is an adjusted consumption.",
  } satisfies PolicyDefinition),
  // --- manufacturing execution (PHASE-042) -----------------------------------
  downtime_posting: Object.freeze({
    key: "downtime_posting",
    valueType: "enum",
    enumValues: Object.freeze(["off", "post"]),
    default: "off",
    module: "manufacturing",
    settingsKey: "manufacturing.downtime_posting",
    description:
      "PHASE-042 BR-070: work-center downtime records are record-only by default ('off' — the closed row carries ended_at + duration with cost_amount/journal_id NULL); with 'post' the close computes the idle-capacity cost (duration/60 × the center's fixed+var hourly rates) and posts the G-42 journal DR DOWNTIME_EXPENSE · CR PRODUCTION_OVERHEAD (idle capacity absorbed against applied overhead). Posting is the explicit opt-in.",
  } satisfies PolicyDefinition),
  // --- professional services (PHASE-019) ------------------------------------
  contract_billing_mode: Object.freeze({
    key: "contract_billing_mode",
    valueType: "enum",
    enumValues: Object.freeze(["retainer_or_milestones", "retainer", "milestones", "hourly"]),
    default: "retainer_or_milestones",
    module: "crm",
    settingsKey: "crm.contract_billing_mode",
    description:
      "PHASE-019 §9: the fee-model family the practice runs on (retainer / milestones / hourly, or the combined retainer_or_milestones default); gates which schedule grid the contract editor expands and which fee-item inputs it requires.",
  } satisfies PolicyDefinition),
  time_entries_require_case: booleanPolicy(
    "time_entries_require_case",
    "crm",
    true,
    "PHASE-019 §6: recording a time entry requires a project (case) — typed TIME_ENTRY_CASE_REQUIRED; turning it off allows non-project time (tracking-only, still billable when pulled by contract billing).",
    "crm.time_entries_require_case",
  ),
  unbilled_time_review_before_invoice: booleanPolicy(
    "unbilled_time_review_before_invoice",
    "crm",
    true,
    "PHASE-019 §6: the weekly review (DRAFT → APPROVED) is the gate before any time entry may be pulled into an invoice — only APPROVED entries are billable.",
    "crm.unbilled_time_review_before_invoice",
  ),
  invoice_approval_required: booleanPolicy(
    "invoice_approval_required",
    "crm",
    true,
    "PHASE-019 §5: recurring-billing drafts stay DRAFT for manual approve+post (BR-034 SoD — the run's POLICY_ACTOR drafts can never self-approve); turning it off auto-submits them to PENDING_APPROVAL, never auto-posts.",
    "crm.invoice_approval_required",
  ),
  invoice_numbering_per_series: booleanPolicy(
    "invoice_numbering_per_series",
    "crm",
    false,
    "PHASE-019 §9 documented posture v1: numbering stays the standard SAL/INV series (no per-contract-series fork); the key ships false and services read it as informational.",
    "crm.invoice_numbering_per_series",
  ),
  narrative_required_on_time_billing: booleanPolicy(
    "narrative_required_on_time_billing",
    "crm",
    true,
    "PHASE-019 §5: hourly billing pulls only entries with a non-empty narrative (the honest timeslip) — empty-narrative entries are listed needsNarrative in the preview and skipped, never silently billed.",
    "crm.narrative_required_on_time_billing",
  ),
  // --- education (PHASE-032) -------------------------------------------------
  // The tuition shell sets seven workflow_policies; the seventh —
  // `invoice_approval_required` — REUSES the PHASE-019 crm key above
  // (the template's approval gate rides the existing BR-034 SoD surface;
  // templates never fork policy keys). The six below are education-owned.
  // None maps onto a SETTINGS_REGISTRY key: they are template-level
  // postures of the PHASE-027 installments module + the partner/crm/sales
  // surfaces it composes (L1 defaults the tenant may still override via
  // the L5 settings surface's generic policy keys — the 0039 review note
  // records the deliberate no-settingsKey choice: platform-default policy
  // maps stay byte-stable for every non-education tenant).
  "guardian_is_paying_partner": booleanPolicy(
    "guardian_is_paying_partner",
    "partners",
    true,
    "PHASE-032 §2: the guardian is the AR partner — invoices, receipts, allocations, and statements address the guardian; the student stays a partner financial file (attributes only, never academic data — ED-11).",
  ),
  "tuition_invoice_from_contract": booleanPolicy(
    "tuition_invoice_from_contract",
    "crm",
    true,
    "PHASE-032 §2: tuition invoices generate from the enrollment contract's schedule (crm.recurring_billing OPTIONAL, or manual raise) — the contract itself posts nothing; G-01 fires only at the invoice.",
  ),
  "installment_schedule_immutable_after_activation": booleanPolicy(
    "installment_schedule_immutable_after_activation",
    "installments",
    true,
    "PHASE-032 §2: the tuition calendar is the PHASE-027 backbone — BR-048 plan total = invoice total exactly and the schedule (down payment + monthly/term dues) is immutable after activation (409 SCHEDULE_IMMUTABLE).",
  ),
  "late_fee_policy_per_plan": booleanPolicy(
    "late_fee_policy_per_plan",
    "installments",
    true,
    "PHASE-032 §2: late fees post only via the engine as G-28 per the per-plan policy (BR-049 — rate/cap/grace are tenant-configured PLACEHOLDER defaults, OQ-002 family; the template ships no invented rates).",
  ),
  "sibling_discount_line_level": booleanPolicy(
    "sibling_discount_line_level",
    "sales",
    true,
    "PHASE-032 §2: sibling/multi-child discounts are line-level invoice discounts under BR-002 role ceilings — revenue-only effect, VAT mathematics untouched (INV-022); never a new pricing-engine surface.",
  ),
  "dunning_cycle_before_late_fee": booleanPolicy(
    "dunning_cycle_before_late_fee",
    "installments",
    true,
    "PHASE-032 §2: the aging buckets of installments.aging drive the guardian reminder cycle before any late-fee posting — policy + report configuration over the PHASE-027 module, no new dunning engine.",
  ),
  // --- agriculture (PHASE-033) -------------------------------------------------
  // The season shell sets six workflow_policies; two —
  // `scrap_reason_required` and `consumption_variance_threshold_pct` —
  // REUSE the PHASE-018 manufacturing keys above (crop loss rides the
  // G-18 scrap surface; the 5% variance threshold rides the §5 review
  // flag; templates never fork policy keys). The four below are
  // agriculture-owned. None maps onto a SETTINGS_REGISTRY key: they are
  // template-level postures of the PHASE-018 manufacturing module + the
  // PHASE-010 inventory surfaces it composes (L1 defaults the tenant may
  // still override via the L5 settings surface's generic policy keys —
  // the deliberate no-settingsKey choice, the 0039 precedent: platform-
  // default policy maps stay byte-stable for every non-agriculture
  // tenant, so no existing golden pin moves).
  "cycle_order_per_field_project": booleanPolicy(
    "cycle_order_per_field_project",
    "manufacturing",
    true,
    "PHASE-033 §2: every cycle run order is stamped with its field project (accounting.projects) — one order per (field, cycle); multi-crop rotations are separate cycle orders (the no-co-product constraint).",
  ),
  "harvest_batch_genealogy_enabled": booleanPolicy(
    "harvest_batch_genealogy_enabled",
    "manufacturing",
    true,
    "PHASE-033 §2: completion links consumed input batches → harvest batch → produce sales through manufacturing.batch_genealogy — the recall-support traceability chain; the template composes the PHASE-018 surface, no new genealogy primitive.",
  ),
  "field_cost_center_mandatory_on_cycle": booleanPolicy(
    "field_cost_center_mandatory_on_cycle",
    "manufacturing",
    true,
    "PHASE-033 §2: a cycle order without the crop cost-center stamp fails (typed, fail-closed) — per-field profitability rides the accounting.cost_centers dimension on every cycle order, input issue, and produce sale.",
  ),
  "livestock_serial_per_head": booleanPolicy(
    "livestock_serial_per_head",
    "inventory",
    true,
    "PHASE-033 §2: livestock categories opt into inventory.serial_tracking with one serial per head (رأس) — status per animal; intake through existing documents; no biological-asset revaluation path exists (the documented IAS-41 limitation).",
  ),

  // --- wholesale (PHASE-030) ----------------------------------------------
  qty_break_pricing_automatic: booleanPolicy(
    "qty_break_pricing_automatic",
    "sales",
    true,
    "PHASE-030 wholesale: quantity-break tiers (price_list_items.min_qty) resolve automatically at order/quote entry and display the resolved break — exactly BR-003's precedence chain with the quoted price never overridden (CAPABILITY_MATRIX §2.5); the template may emphasize this, never bend it.",
  ),
  bulk_order_from_quote_one_click: booleanPolicy(
    "bulk_order_from_quote_one_click",
    "sales",
    true,
    "PHASE-030 wholesale: an accepted quotation converts to a bulk order (ORD-) in one action — the quote's lines, tiers, and resolved prices carry over verbatim (BR-006 validity window still applies; conversion never re-prices).",
  ),
  delivery_before_credit_invoice: booleanPolicy(
    "delivery_before_credit_invoice",
    "sales",
    true,
    "PHASE-030 wholesale: the credit-invoice flow expects the delivery note (DLV-) first — the invoice consumes delivered quantities (the PHASE-012 chain quote → order → delivery → invoice); turning it off allows invoicing undelivered quantities per the standard sales policy.",
  ),
  statement_monthly_by_default: booleanPolicy(
    "statement_monthly_by_default",
    "partners",
    true,
    "PHASE-030 wholesale: the customer statement (كشف حساب العميل) defaults to a monthly cadence reconciling to the AR control per INV-009/012 — statements are read models over the same allocations, never a second ledger.",
  ),
  pdc_note_requires_maturity_date: booleanPolicy(
    "pdc_note_requires_maturity_date",
    "notes",
    true,
    "PHASE-030 wholesale: receiving a post-dated note requires its maturity date (the BR-045 family — a note without a maturity date is an ordinary on-demand instrument, never a PDC calendar row); the notes module owns the enforcement, the template only sets the posture.",
  ),
  // --- electronics (PHASE-030) --------------------------------------------
  imei_capture_required_flagged_items: booleanPolicy(
    "imei_capture_required_flagged_items",
    "inventory",
    true,
    "PHASE-030 electronics: goods receipts of IMEI-flagged items must capture serial numbers — selling an unregistered IMEI is blocked (the PHASE-010 serial register fail-closed); capture is required for flagged items exactly, never for unflagged ones.",
  ),
  repair_parts_issue_mode: Object.freeze({
    key: "repair_parts_issue_mode",
    valueType: "enum",
    enumValues: Object.freeze(["reserve", "issue_immediate"]),
    default: "reserve",
    module: "crm",
    description:
      "PHASE-030 electronics: the repair-card parts policy over crm.service_orders — reserve = approved cards HOLD parts via inventory.reservations (COGS at invoice); issue_immediate = COGS journal + stock move at issue. The electronics value mirrors job_card_parts_issue_mode (PHASE-017) verbatim — same underlying service-order machinery, the repair-bench spelling.",
  } satisfies PolicyDefinition),
  repair_card_labor_rate_source: Object.freeze({
    key: "repair_card_labor_rate_source",
    valueType: "enum",
    enumValues: Object.freeze(["price_list"]),
    default: "price_list",
    module: "crm",
    description:
      "PHASE-030 electronics: repair labor lines bill from the labor-rate price list (per-hour rate × logged hours); price_list is the only supported source — actual technician cost stays untracked until financial payroll reporting consumes it (the PHASE-029 handoff; repair profitability = parts margin + labor revenue, labeled honestly per CAPABILITY_MATRIX §2.6).",
  } satisfies PolicyDefinition),
  tradein_purchase_at_branch: booleanPolicy(
    "tradein_purchase_at_branch",
    "purchasing",
    true,
    "PHASE-030 electronics: trade-in intake is an ordinary branch goods receipt (G-07/G-08 shape) of a serial-tracked used-device item with a condition-grade attribute — never a special document type; the branch cash account settles the payout.",
  ),
  // --- healthcare (PHASE-031) ----------------------------------------------
  patient_file_financial_only: booleanPolicy(
    "patient_file_financial_only",
    "partners",
    true,
    "PHASE-031 healthcare (ED-07/ED-11): the patient is a partner FINANCIAL file only — identity, contacts, credit terms, opening balances; the honest guard is machine-checked (the zero-clinical-surface test asserts no diagnosis/prescription/appointment/clinical-note key exists anywhere in the shell). Reopening clinical operations requires a new product decision record, never a phase document.",
  ),
  claim_ref_required_for_insured_invoices: booleanPolicy(
    "claim_ref_required_for_insured_invoices",
    "sales",
    true,
    "PHASE-031 healthcare (§2 item 3): an invoice saved with insurance billing selected but an empty claim ref is rejected with the typed CLAIM_REF_REQUIRED error — self-pay invoices save the field null. Capture discipline only: toggling never touches posting (INV-022). Maps onto the sales.claim_ref_required_for_insured settings key (L5 override; the platform default true = the capture invariant, the manifest ships the same true as its L1 default).",
    "sales.claim_ref_required_for_insured",
  ),
  insurance_invoice_billed_to_company_partner: booleanPolicy(
    "insurance_invoice_billed_to_company_partner",
    "sales",
    true,
    "PHASE-031 healthcare (§2 item 3): a claim (insured) invoice is billed to the insurance-company partner — insurers are ordinary customer-kind partners identified by use (no partner classification enum is added); per-insurer exposure is the existing partner subledger (INV-009).",
  ),
  pharmacy_fefo_enforced: booleanPolicy(
    "pharmacy_fefo_enforced",
    "inventory",
    true,
    "PHASE-031 healthcare (§2 item 7): dispensing proposes/forces the nearest-expiry batch (BR-017 FEFO over inventory.batch_tracking, consumed unchanged) and never exceeds on-hand (negative stock forbidden); expiry write-off stays behind approval with reason EXPIRED (INVENTORY_ACCOUNTING §1–§4 discipline).",
  ),
  dunning_by_claim_enabled: booleanPolicy(
    "dunning_by_claim_enabled",
    "reporting",
    true,
    "PHASE-031 healthcare (§2 item 8): claim dunning composes the PHASE-027 reports with the optional group-by-claim parameter (grouping key: the source invoice's claim_ref) — dunning runs per claim مطالبة, not only per insurer; a report-contract parameter extension, never a new report key (register §J stays closed).",
  ),
  insurance_credit_limit_per_company: booleanPolicy(
    "insurance_credit_limit_per_company",
    "sales",
    true,
    "PHASE-031 healthcare (§2 item 5): per-insurer exposure enforces through the EXISTING per-partner credit_limit before invoice save (BR-001 machinery, PHASE-012) — the template sets the enforcement posture, never new mathematics; cross-insurer group exposure aggregation is NOT fabricated (consolidation territory, documented honestly).",
  ),
  // --- rental & logistics (the delivery-completion thirteenth shell) -------
  rental_deposit_required: booleanPolicy(
    "rental_deposit_required",
    "crm",
    true,
    "Rental shell: opening a rental contract requires a security deposit intake — an advance receipt against the customer deposits liability through the EXISTING treasury receipt machinery (never a special document type); the crm.contract_deposits feature-intake pair stays deferred per its RISK-019 decision record.",
  ),
  late_fee_after_grace_hours: Object.freeze({
    key: "late_fee_after_grace_hours",
    valueType: "number",
    default: 3,
    module: "crm",
    description:
      "Rental shell: the grace period (ساعات السماح) after a rental's due return before a late fee line may be added to the contract invoice — the typed policy the late_fee_calculation engine reads; a late fee is an ordinary contract invoice line, never a new document type.",
  } satisfies PolicyDefinition),
  late_fee_calculation: Object.freeze({
    key: "late_fee_calculation",
    valueType: "enum",
    enumValues: Object.freeze(["daily_rate_based"]),
    default: "daily_rate_based",
    module: "crm",
    description:
      "Rental shell: the late-fee computation basis — daily_rate_based (the daily rental rate × overdue days past the grace period) is the only supported source; the fee posts as a contract invoice line through the unmodified posting engine.",
  } satisfies PolicyDefinition),
  damage_charge_requires_inspection: booleanPolicy(
    "damage_charge_requires_inspection",
    "crm",
    true,
    "Rental shell: a damage charge on return may only be added after a damage inspection (فحص الأضرار) is recorded on the return service order — the crm.service_orders machinery; no inspection, no charge line.",
  ),
  deposit_release_requires_manager_approval: booleanPolicy(
    "deposit_release_requires_manager_approval",
    "treasury",
    true,
    "Rental shell: releasing (refunding or offsetting) a security deposit requires manager approval before the payment/disbursement posts — an ordinary approval-gated treasury payment, never a special flow.",
  ),
  overdue_rental_blocks_new_reservation: booleanPolicy(
    "overdue_rental_blocks_new_reservation",
    "crm",
    true,
    "Rental shell: a customer with an overdue (unreturned or unpaid) rental cannot open a new reservation — the BR-001 block posture applied to the pipeline reservation stage, policy-driven and honest.",
  ),
  shipment_milestones_manual: booleanPolicy(
    "shipment_milestones_manual",
    "distribution",
    true,
    "Rental/logistics shell: shipment milestones (تحديث حالة الشحنة) are recorded manually by dispatchers on the route/settlement surfaces — no automatic carrier webhook is fabricated (the no-fabrication gate); an integration adapter would arrive through its own decision record.",
  ),
});

export const POLICY_KEYS: readonly string[] = Object.keys(POLICY_REGISTRY);

/** Is `key` a registered workflow-policy key? */
export function isKnownPolicyKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_REGISTRY, key);
}

/** Unknown manifest workflow-policy key (fail loud — never silently dropped). */
export class UnknownPolicyKeyError extends DomainError {
  constructor(key: string) {
    super(
      "configuration/unknown-policy-key",
      `Unknown workflow policy key: ${key} (industry manifests may only set POLICY_REGISTRY keys — see docs/industries/README.md §3)`,
      { key },
    );
  }
}

/** Type/enum violation on a registered policy key (fail loud). */
export class InvalidPolicyValueError extends DomainError {
  constructor(key: string, message: string) {
    super("configuration/invalid-policy-value", `Invalid value for policy ${key}: ${message}`, {
      key,
      message,
    });
  }
}

/**
 * Validate a raw policy value against its registry definition. Returns the
 * accepted value; throws the typed §3 errors on unknown keys, type
 * violations, or enum misses. Numbers must be finite; NaN/Infinity never
 * pass (determinism: a hash input must be canonical JSON).
 */
export function parsePolicyValue(key: string, value: unknown): WorkflowPolicyValue {
  const definition = POLICY_REGISTRY[key];
  if (definition === undefined) {
    throw new UnknownPolicyKeyError(key);
  }
  switch (definition.valueType) {
    case "boolean":
      if (typeof value !== "boolean") {
        throw new InvalidPolicyValueError(key, "expected a boolean");
      }
      return value;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new InvalidPolicyValueError(key, "expected a finite number");
      }
      return value;
    }
    case "enum": {
      if (typeof value !== "string" || !(definition.enumValues ?? []).includes(value)) {
        throw new InvalidPolicyValueError(
          key,
          `expected one of ${(definition.enumValues ?? []).join(" | ")}`,
        );
      }
      return value;
    }
    case "string":
      if (typeof value !== "string") {
        throw new InvalidPolicyValueError(key, "expected a string");
      }
      return value;
  }
}
