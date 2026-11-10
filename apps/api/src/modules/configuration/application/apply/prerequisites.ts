import { DomainError } from "@erp/domain-core";
import type { IndustryTemplateManifest } from "@erp/contracts";

import {
  INTAKE_TARGET_PHASE,
  closureViolations,
  isPhaseGatedIntakeKey,
} from "../../domain/feature-catalog";

/**
 * Entitlement + phase-gate check (PHASE-015 T5/T7; industries/README §4
 * "Entitlement + phase check via capability_prerequisites"; BR-040):
 *
 * For every `capability_prerequisites` entry of a manifest, given the
 * tenant's ACTIVE entitlement keys:
 *
 * - REQUIRED with keys missing from the entitlements AND NOT phase-gated
 *   ⇒ `blocked` — guided plan selection, never silent degradation (the
 *   missing chain names the exact keys + the bilingual upgrade guidance);
 * - REQUIRED whose capability ships with a later phase
 *   (`available_from_phase` > the CURRENT shipped phase, or its missing
 *   keys are CAPABILITY_MATRIX §3 intake keys) ⇒ `phase_gated` — the
 *   tenant applies in BACK-OFFICE mode with the entries labeled
 *   "قادم مع المرحلة 0NN / coming with PHASE-0NN" (README §4's deliberate
 *   roadmap consequence: templates ship in PHASE-015, POS ships in 016,
 *   job cards + distribution ship in 017);
 * - OPTIONAL missing ⇒ `hidden` — the corresponding menus hide cleanly
 *   (§5 R10) and nothing else degrades;
 * - OPTIONAL phase-gated ⇒ `phase_gated` (labeled coming-soon);
 * - fully present ⇒ `included`.
 *
 * On top of the capability classification, the BR-040 dependency-closure
 * check runs over `required_feature_keys` (phase-gated keys count as
 * satisfied-but-labeled): every shipped required key's dependency chain —
 * and the tenant's own active set — must be closure-valid, or the apply is
 * blocked with the specific missing chain (CONFIGURATION_ENGINE §7).
 */

/**
 * The phase whose features have SHIPPED platform-wide. A capability whose
 * `available_from_phase` is ≤ this is live today; "PHASE-021"+ = gated.
 * Bump this constant with the roadmap (a phase-scoped constant, not a
 * config knob — it is a statement about the running build). PHASE-017
 * shipped `sales.job_cards` + the distribution set (migration 0025), so
 * automotive/distribution capabilities and the grocery tier entry resolve
 * LIVE at that rung; PHASE-018 shipped the manufacturing set (migration
 * 0026 — the bom/production_orders/wip/costing/scrap/batch_genealogy/qc
 * keys), so the food_manufacturing capabilities and the automotive/
 * grocery qc_inspections entries resolve LIVE too; PHASE-019 shipped the
 * CRM set (migration 0027 — crm.leads/tasks_activities/service_contracts/
 * recurring_billing/service_orders + accounting.projects), so the
 * professional_services capabilities and the automotive service_contracts
 * entry resolve LIVE as well; PHASE-020 shipped the offline sync foundation
 * (migrations 0029–0031 — the offline.sync_protocol +
 * offline.device_management plan keys, granted to business too by 0029),
 * so the sync plane's device registry, feeds, and reconciliation resolve
 * LIVE for business + enterprise tenants; PHASE-021 shipped the desktop
 * application on top of it (migration 0032 — the one-time enrollment proof
 * DR-P21-01; the Tauri shell + offline console + the seven DR-P21-08
 * desktop write intents — no new plan keys or SETTINGS_REGISTRY keys, so
 * no template classification moves with this bump); PHASE-022 shipped the
 * Android application on top of the same foundation (the @erp/mobile
 * package + feeds/intents — again no new plan keys, no classification
 * moves); PHASE-023 shipped the external-integration substrate (migration
 * 0035 — treasury.bank_statement_parking + sales.commerce_channels join
 * business + enterprise, platform.payouts is operator-only so no plan
 * carries it; no SETTINGS_REGISTRY/template classification changes — the
 * ZATCA adapter is the UNVERIFIED refusing stub and rollout flags default
 * OFF, so no e-invoicing capability resolves LIVE from this bump).
 */
// PHASE-024 security hardening shipped (2026-11-06): the MFA policy
// substrate, the offboarding purge, the audit review tooling, the rate-limit
// + headers hardening — no new industry-template capabilities, so no
// template chain changes (the 023→024 bump is bookkeeping only).
// PHASE-025 GA readiness shipped (2026-11-06): performance/DR/SLO evidence
// + the in-process SLO substrate — GA hardening only, zero new plan keys or
// template capabilities (the 024→025 bump is bookkeeping only; the roadmap
// notes PHASE-026+ fixed-assets keys arrive with their own phase).
// PHASE-029 payroll shipped (2026-11-08): the financial-scope payroll
// module + its eight feature-key plan grants — no industry-template
// capability rides payroll (no template's prerequisite chain cites a
// payroll key), so the 028→029 leg is bookkeeping only.
// PHASE-030 wholesale + electronics shipped (2026-11-08): the first two
// Blueprint v2.0 stage-10 templates register over already-granted keys —
// their REQUIRED chains (notes 0038, POS 0024, crm.service_orders 0027,
// distribution.customer_tiers 0025) resolve LIVE from this bump (the
// wholesale pdc_notes capability's available_from_phase PHASE-027 ≤ 030);
// zero new capability ids past PHASE-027 exist in any shipped manifest, so
// nothing phase-gates at 030.
// PHASE-031 healthcare shipped (2026-11-08): the Healthcare Commercial
// Shell (ED-07) registers over already-granted keys with ONE new capability
// id — insurance_claim_billing (REQUIRED: sales.invoices + notes.received +
// partners.statements, all granted) at available_from_phase PHASE-031 ≤
// 031, so the shell's defining entry resolves LIVE from this bump; the
// claim-ref light extension is the single additive sales_invoices.claim_ref
// column (migration 0042) with capture enforced by the
// claim_ref_required_for_insured_invoices policy on the settings surface.
// THE RESTORATION MERGE (2026-11-08, post-034): the stage-9/10 siblings
// 028–031 (budgeting / payroll / wholesale+electronics / healthcare) were
// restored from the lost lineage and merged on top of PHASE-034 — the
// 34-phase roadmap is now COMPLETE in this single build (001–034 all
// implemented: 032 education + 033 agriculture + 034 consolidation from the
// surviving lineage, 028–031 from the restored one, migrations renumbered
// 0042–0046). The honest gate is therefore the roadmap's end: every
// capability in every shipped manifest cites available_from_phase ≤ 034
// (agriculture's crop_cycle_costing @ 033 and the education/consolidation
// surfaces @ ≤ 033 included), so nothing phase-gates any more — the §4
// mechanism itself stays proven by the synthetic post-roadmap PHASE-035
// fixtures in template-prerequisites.spec.
export const CURRENT_SHIPPED_PHASE = "PHASE-034";

/** "PHASE-0NN" → the numeric phase (for ordering). */
export function phaseNumber(phase: string): number {
  const match = /^PHASE-(\d{3})$/.exec(phase);
  if (match === null) {
    throw new DomainError(
      "configuration/invalid-phase-gate",
      `Phase gate "${phase}" is not PHASE-0NN (industries/README §3 phase pattern)`,
      { phase },
    );
  }
  return Number.parseInt(match[1]!, 10);
}

/** Per-capability classification for the "included / optional / coming
 *  soon / blocked" screen (onboarding wizard + admin preview). */
export type PrerequisiteCapabilityStatus = "included" | "phase_gated" | "hidden" | "blocked";

export interface PrerequisiteCapabilityState {
  readonly capabilityId: string;
  readonly level: "REQUIRED" | "OPTIONAL";
  readonly featureKeys: readonly string[];
  readonly status: PrerequisiteCapabilityStatus;
  /** For `phase_gated`: the phase the capability ships with (e.g. PHASE-016). */
  readonly phase?: string;
  /** For `blocked`/`hidden`: the keys missing from the entitlements. */
  readonly missingKeys?: readonly string[];
}

export interface PrerequisiteClosureViolation {
  readonly featureKey: string;
  readonly missing: readonly string[];
}

/** The structured result the apply service and the onboarding UI consume. */
export interface PrerequisiteCheck {
  /** `blocked` ⇒ the apply/switch must fail with the missing chain. */
  readonly status: "ok" | "blocked";
  /**
   * The exact missing feature keys (REQUIRED-shipped capability keys +
   * uncovered `required_feature_keys` + BR-040 closure gaps), sorted —
   * the "missing chain" the typed error carries.
   */
  readonly missingChain: readonly string[];
  /** Bilingual guided-plan-selection guidance (null when not blocked). */
  readonly guidance: { readonly ar: string; readonly en: string } | null;
  /** Per-capability classification (ordered by capability id). */
  readonly capabilities: readonly PrerequisiteCapabilityState[];
  /** BR-040 closure violations over required keys + the active set. */
  readonly closureViolations: readonly PrerequisiteClosureViolation[];
  /**
   * True when at least one REQUIRED capability is phase-gated — the
   * switch flow requires an explicit acknowledgement of these
   * "coming with PHASE-0NN" differences before it proceeds.
   */
  readonly requiresAcknowledgement: boolean;
}

/**
 * The typed blocked error (README §4: "Blocked: guided plan selection —
 * never silent degradation"). Carries the exact missing chain + the
 * bilingual upgrade guidance; ERROR_MODEL maps it to 422 with the code as
 * the envelope contract.
 */
export class TemplatePrerequisitesBlockedError extends DomainError {
  constructor(
    readonly templateKey: string,
    readonly missingChain: readonly string[],
    readonly guidance: { ar: string; en: string },
    readonly closureViolations: readonly PrerequisiteClosureViolation[] = [],
  ) {
    super(
      "configuration/template-prerequisites-blocked",
      `Template ${templateKey} cannot be applied: required capabilities are missing ` +
        `from the plan: ${missingChain.join(", ")} — ${guidance.en}`,
      { templateKey, missingChain, guidance, closureViolations },
    );
  }
}

function blockedGuidance(missingChain: readonly string[]): { ar: string; en: string } {
  const keys = missingChain.join(", ");
  return {
    ar: `القدرات المطلوبة لهذا القالب غير مفعّلة في خطتك الحالية: ${keys}. اختر خطة أعلى لإتمام تفعيل القالب.`,
    en: `Required capabilities are missing from your current plan: ${keys}. Choose a higher plan to finish setting up this template.`,
  };
}

/** Run the §4 entitlement + phase-gate + BR-040 closure check (pure). */
export function checkPrerequisites(
  manifest: IndustryTemplateManifest,
  activeEntitlementKeys: readonly string[],
): PrerequisiteCheck {
  const active = new Set(activeEntitlementKeys);
  const capabilities: PrerequisiteCapabilityState[] = [];
  const blockedChain = new Set<string>();

  // -- capability classification (§4 decision tree) ------------------------
  const capabilityIds = Object.keys(manifest.capability_prerequisites).sort();
  for (const capabilityId of capabilityIds) {
    const capability = manifest.capability_prerequisites[capabilityId]!;
    const missing = capability.feature_keys.filter((key) => !active.has(key));
    if (missing.length === 0) {
      capabilities.push({
        capabilityId,
        level: capability.level,
        featureKeys: capability.feature_keys,
        status: "included",
      });
      continue;
    }
    // A capability is PHASE-GATED when its owning roadmap phase has not
    // shipped (available_from_phase > CURRENT_SHIPPED_PHASE) or its missing
    // keys are §3 intake keys (ungrantable before the catalog intake).
    const capabilityPhaseGated =
      phaseNumber(capability.available_from_phase) > phaseNumber(CURRENT_SHIPPED_PHASE);
    if (capabilityPhaseGated) {
      capabilities.push({
        capabilityId,
        level: capability.level,
        featureKeys: capability.feature_keys,
        status: "phase_gated",
        phase: capability.available_from_phase,
        missingKeys: missing,
      });
      continue;
    }
    const trulyMissing = missing.filter((key) => !isPhaseGatedIntakeKey(key));
    if (trulyMissing.length === 0) {
      // Only intake-key misses on a shipped capability (e.g. a PHASE-010
      // capability whose key is pending intake): labeled coming-soon with
      // the intake target phase.
      capabilities.push({
        capabilityId,
        level: capability.level,
        featureKeys: capability.feature_keys,
        status: "phase_gated",
        phase: INTAKE_TARGET_PHASE,
        missingKeys: missing,
      });
      continue;
    }
    if (capability.level === "REQUIRED") {
      for (const key of trulyMissing) {
        blockedChain.add(key);
      }
      capabilities.push({
        capabilityId,
        level: "REQUIRED",
        featureKeys: capability.feature_keys,
        status: "blocked",
        missingKeys: trulyMissing,
      });
      continue;
    }
    capabilities.push({
      capabilityId,
      level: "OPTIONAL",
      featureKeys: capability.feature_keys,
      status: "hidden",
      missingKeys: trulyMissing,
    });
  }

  // -- required_feature_keys backstop (fail-closed resolution, §3) ---------
  // Every required key must resolve: active, phase-gated (intake), or
  // covered by a capability entry whose classification already decided.
  // An uncovered, ungranted, shipped required key blocks the apply.
  const coveredByCapability = new Set<string>();
  for (const capability of Object.values(manifest.capability_prerequisites)) {
    for (const key of capability.feature_keys) {
      coveredByCapability.add(key);
    }
  }
  for (const key of manifest.required_feature_keys) {
    if (active.has(key) || isPhaseGatedIntakeKey(key) || coveredByCapability.has(key)) {
      continue;
    }
    blockedChain.add(key);
  }

  // -- BR-040 closure (CONFIGURATION_ENGINE §7) ----------------------------
  // Closure universe = the checked set = the active entitlements ∪ the
  // shipped (non-intake) required keys: the tenant's OWN set must be
  // closure-valid (BR-040 activation rule), and every shipped required
  // key's dependency chain must be inside the universe. Intake keys are
  // excluded from the universe on purpose — they are ungrantable before
  // the catalog intake, so they count as satisfied-but-labeled (phase-
  // gated), and no FEATURE_DEPS edge references them today (they are
  // leaves); a future edge onto an intake key would surface here as a
  // named missing key, exactly the fail-loud posture §7 demands.
  const closureInput = [
    ...new Set([
      ...activeEntitlementKeys,
      ...manifest.required_feature_keys.filter((key) => !isPhaseGatedIntakeKey(key)),
    ]),
  ].sort();
  const closureGaps = closureViolations(closureInput).filter(
    (violation) => violation.missing.length > 0,
  );
  for (const violation of closureGaps) {
    for (const key of violation.missing) {
      blockedChain.add(key);
    }
  }

  const missingChain = [...blockedChain].sort();
  const requiresAcknowledgement = capabilities.some(
    (capability) => capability.level === "REQUIRED" && capability.status === "phase_gated",
  );
  return {
    status: missingChain.length > 0 ? "blocked" : "ok",
    missingChain,
    guidance: missingChain.length > 0 ? blockedGuidance(missingChain) : null,
    capabilities,
    closureViolations: closureGaps,
    requiresAcknowledgement,
  };
}
