import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { publishTenancyEvent } from "../../configuration/api";
import {
  cloneSystemTemplate,
  findTenantRoleByKey,
  listSystemTemplates,
} from "../../identity/api/identity";
import * as store from "../infrastructure/tenancy.store";
import { systemClock } from "../../identity/api/identity";
import { getOwnTenant, seedMasterDataBasics } from "../infrastructure/tenancy.store";
// PHASE-046 (D-11): the canonical statutory set materializes for NEW
// tenants at the same provisioning site (the rates are jurisdiction
// facts the platform carries — one source: statutory-canonical.ts, the
// same rows the 0092 seed materialized for existing tenants). The
// payroll module's infrastructure surface, imported the way the master-
// data basics ride the tenancy store — never an ad hoc SQL copy.
import { materializeCanonicalStatutorySet } from "../../payroll/infrastructure/statutory-canonical";
import { materializeCanonicalCompetencyScale } from "../../hr/infrastructure/talent-canonical";
// PHASE-051 (W-35 — D-16): the trade plane's canonical seeds — the
// Incoterms-2020 set + the HS chapter-level starter set with the
// accuracy disclaimer — materialize for NEW tenants at this same
// provisioning site (one source: trade-canonical.ts, the same rows the
// 0122 §6 seed materialized for every EXISTING tenant; the 0098
// competency-scale precedent's own shape — never an ad hoc SQL copy).
import {
  materializeCanonicalHsStarterSet,
  materializeCanonicalIncoterms,
} from "../../trade/infrastructure/trade-canonical";

/**
 * `provisionWorkspace` onboarding backend (PHASE-004 §2.3/T5): produces
 * the initial workspace inside the caller's tenant UoW —
 *
 * - instantiates the bilingual CoA template (42 rows, CHART_OF_ACCOUNTS §3)
 *   into tenant-owned `accounts` + `account_purposes` rows with 1:1
 *   purpose markers (posting readiness V1–V6 is PHASE-007);
 * - instantiates the system role templates as tenant roles with template
 *   grants (the owner role was already cloned at registration; the rest
 *   land here);
 * - writes the document-numbering policy defaults (BR-029 — policy rows
 *   only; the numbering service ships in PHASE-007);
 * - records the jurisdiction pack binding (ADR-0010 concept; the versioned
 *   registry + rates land in PHASE-009);
 * - seeds the fiscal-calendar start-month preference (years/periods
 *   themselves are PHASE-007).
 *
 * Idempotency (acceptance 2): re-runs skip every existing artifact and
 * surface a created-vs-existing diff — never a duplicate.
 */

const SYSTEM_ROLE_KEYS = [
  "owner",
  "accountant",
  "sales",
  "purchasing",
  "warehouse",
  "cashier",
  "viewer",
  "payroll_officer",
] as const;

export interface ProvisionInput {
  fiscalCalendarStartMonth?: number;
  numberingAssignAt?: "approval" | "posting";
  industryTemplateKey?: string;
}

export interface ProvisionDiff {
  tenantId: string;
  roles: { created: string[]; existing: string[] };
  accounts: { created: number; existing: number };
  purposes: { created: number; existing: number };
  settings: { created: string[]; existing: string[] };
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async provision(
    actorId: string,
    input: ProvisionInput,
  ): Promise<ProvisionDiff> {
    const tenant = await getOwnTenant();
    const diff: ProvisionDiff = {
      tenantId: tenant.id,
      roles: { created: [], existing: [] },
      accounts: { created: 0, existing: 0 },
      purposes: { created: 0, existing: 0 },
      settings: { created: [], existing: [] },
    };

    // 1. System role templates → tenant roles (idempotent per key).
    const templates: readonly { key: string }[] = await listSystemTemplates();
    const templateKeys = new Set(templates.map((row) => row.key));
    for (const key of SYSTEM_ROLE_KEYS) {
      if (!templateKeys.has(key)) {
        continue; // template catalog changed — clone only what exists
      }
      const existing = await findTenantRoleByKey(tenant.id, key);
      if (existing !== undefined) {
        diff.roles.existing.push(key);
        continue;
      }
      await cloneSystemTemplate(key, tenant.id);
      diff.roles.created.push(key);
    }

    // 1b. PHASE-006 master-data basics: common units + NET-N terms (the
    // migration-0009 contract; idempotent per natural key like every step).
    await seedMasterDataBasics();

    // 1c. PHASE-046 (D-11) — the canonical statutory set: the GOSI
    // row-set (VERIFIED — the owner's corrected schedule) + the KSA EOSB
    // tiers + the AE/EG/JO REQUIRES_VERIFICATION placeholders,
    // materialized idempotently for the new tenant (the 0092 seed's
    // existing-tenant sweep is the same canonical source).
    await materializeCanonicalStatutorySet();

    // 1d. PHASE-047 (W-1, T-04) — the canonical competency scale: the
    // 1–5 AR/EN default (the ONE shipped default, red line 5's law —
    // tenant-configurable DATA), materialized idempotently for the new
    // tenant (the 0098 §4 seed's existing-tenant sweep is the same
    // canonical source — talent-canonical.ts, one source, both paths).
    await materializeCanonicalCompetencyScale();

    // 1e. PHASE-051 (W-35 — T-08, D-16) — the trade plane's canonical
    // seeds: the Incoterms-2020 set (11 rules, the ICC ownership matrix
    // as registry DATA) + the HS chapter-level starter set (14 headings),
    // materialized idempotently for the new tenant with the accuracy
    // disclaimer on every starter row (the 0122 §6 seed's
    // existing-tenant sweep is the same canonical source —
    // trade-canonical.ts, one source, both paths; «البذور بإقرار
    // الدقة»: the tenant owns the final applicability/classification;
    // NO duty rates anywhere on the seeds). The registry rows exist
    // regardless of the trade flag (the flag gates the mandate and the
    // routes, never the reference data — the 0122 §6 shape).
    await materializeCanonicalIncoterms();
    await materializeCanonicalHsStarterSet();

    // 2. CoA template instantiation (code-ordered so parents insert first).
    const template = await store.listCoaTemplate();
    const idByCode = new Map<string, string>();
    for (const row of template) {
      const existing = await store.findAccountByCode(row.code);
      if (existing !== undefined) {
        idByCode.set(row.code, existing.id);
        diff.accounts.existing += 1;
        continue;
      }
      const parent = row.parentCode !== null ? idByCode.get(row.parentCode) : null;
      if (row.parentCode !== null && parent === undefined) {
        throw new Error(
          `CoA template parent ${row.parentCode} missing before ${row.code} — template integrity violated`,
        );
      }
      const account = await store.insertAccount({
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        type: row.type,
        parentId: parent ?? null,
        isPostable: !row.isGroup,
      });
      idByCode.set(row.code, account.id);
      diff.accounts.created += 1;
    }

    // 3. Purpose markers → account_purposes (1:1 active mappings, V1).
    const activeFrom = systemClock.now().toISOString().slice(0, 10);
    for (const row of template) {
      if (row.purposeKey === null) {
        continue;
      }
      const existing = await store.findActivePurpose(row.purposeKey);
      if (existing !== undefined) {
        diff.purposes.existing += 1;
        continue;
      }
      const accountId = idByCode.get(row.code);
      if (accountId === undefined) {
        throw new Error(`purpose marker ${row.purposeKey} has no instantiated account`);
      }
      await store.insertAccountPurpose({
        purposeKey: row.purposeKey,
        accountId,
        activeFrom,
      });
      diff.purposes.created += 1;
    }

    // 4. Numbering + fiscal + jurisdiction settings (defaults only).
    const settingsToWrite: Record<string, unknown> = {
      "numbering.defaults": { assign_at: input.numberingAssignAt ?? "posting" },
      "fiscal_calendar.start_month": input.fiscalCalendarStartMonth ?? 1,
      "tax.jurisdiction.binding": {
        country_code: tenant.countryCode,
        pack_key: `${tenant.countryCode.toLowerCase()}-baseline`,
        bound_at: systemClock.now().toISOString(),
      },
    };
    for (const [key, value] of Object.entries(settingsToWrite)) {
      const { created } = await store.upsertSettingDefault(key, value, actorId);
      (created ? diff.settings.created : diff.settings.existing).push(key);
    }

    await this.audit.record({
      action: "tenant.onboarded",
      entityType: "tenant",
      entityId: tenant.id,
      actorId,
      before: { re_run_hint: diff.accounts.created === 0 && diff.roles.created.length === 0 },
      after: {
        roles_created: diff.roles.created,
        accounts_created: diff.accounts.created,
        purposes_created: diff.purposes.created,
        settings_created: diff.settings.created,
      },
    });
    // Settings writes fired defaults — invalidation per CONFIGURATION §9.
    publishTenancyEvent({ type: "settings.changed", tenantId: tenant.id, key: "numbering.defaults" });

    return diff;
  }
}
