import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../../audit/api/audit";
import { InboxService } from "../../../notifications/application/inbox-service";
import {
  ConfigRepository,
  CONFIG_REPOSITORY,
} from "../../infrastructure/config-repository";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { compareVersions } from "../apply/apply-service";
import { findAppliedStateRow } from "../apply/applied-state.store";

/**
 * Registry drift detection (PHASE-015 T7 §2 item 11 + T4's drift hook;
 * industries/README §8 versioning): compares the tenant's applied
 * `applied_version` against the registry row's current version.
 *
 * - PATCH/MINOR drift ⇒ an upgrade OFFER is recorded (notifications
 *   category `templates`, bilingual, actionUrl to the admin templates
 *   screen, dedupeKey `template.upgrade:<key>:<registryVersion>`) —
 *   offers are recorded, NEVER auto-applied (§2 item 11; the tenant
 *   reviews the §5-R9 diff and upgrades explicitly).
 * - MAJOR drift ⇒ the offer is flagged CRITICAL (§8: migration note
 *   mandatory — switch-in allowed, switch-out follows R6 archive rules).
 * - Registry behind the applied version ⇒ a data anomaly, surfaced as
 *   `registry-behind` (the registry cannot have shipped less than what a
 *   tenant applied — no notification, the apply service fails closed on it).
 *
 * `checkDrift(tenantId)` runs inside the ambient tenant scope (the API
 * endpoint + specs wrap it in `withTenant`), mirroring the resolve
 * service's tenant-scope assertion.
 */

export type DriftKind = "patch" | "minor" | "major";

/** Which semver segment differs first between two versions. */
export function driftKind(applied: string, registry: string): DriftKind {
  const [appliedMajor, appliedMinor] = applied.split(".").map((part) => Number.parseInt(part, 10));
  const [registryMajor, registryMinor] = registry.split(".").map((part) => Number.parseInt(part, 10));
  if (registryMajor !== appliedMajor) {
    return "major";
  }
  if (registryMinor !== appliedMinor) {
    return "minor";
  }
  return "patch";
}

export interface DriftCheckResult {
  readonly status: "no-template" | "current" | "upgrade-available" | "registry-behind";
  readonly templateKey: string | null;
  readonly appliedVersion: string | null;
  readonly registryVersion: string | null;
  readonly drift: DriftKind | null;
  /** The recorded upgrade-offer outcome (null when no offer was recorded). */
  readonly notification: { readonly recorded: boolean; readonly dedupeKey: string } | null;
}

export const TEMPLATE_DRIFT_SERVICE = Symbol("TEMPLATE_DRIFT_SERVICE");

/** The admin templates screen the offer's actionUrl opens. */
export const TEMPLATES_ADMIN_URL = "/settings/templates";

@Injectable()
export class TemplateDriftService {
  constructor(
    @Inject(CONFIG_REPOSITORY) private readonly repository: ConfigRepository,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Compare the applied version with the registry and record the upgrade
   * offer when drift exists. Pure read + one inbox row; NOTHING is
   * auto-applied (the tenant upgrades through the switch/re-apply flows).
   */
  async checkDrift(tenantId: string): Promise<DriftCheckResult> {
    const context = requireTenantContext();
    if (context.tenantId !== tenantId) {
      throw new Error(
        `ambient tenant scope is ${context.tenantId} but drift was requested for ${tenantId} — run checkDrift inside withTenant(tenantId)`,
      );
    }
    const applied = await findAppliedStateRow();
    if (applied === undefined) {
      return {
        status: "no-template",
        templateKey: null,
        appliedVersion: null,
        registryVersion: null,
        drift: null,
        notification: null,
      };
    }
    const registry = await this.repository.findIndustryTemplate(applied.templateKey);
    if (registry === undefined) {
      // The engine's L1 load fails closed on the same corruption — surface
      // it here as a registry anomaly without a notification.
      return {
        status: "registry-behind",
        templateKey: applied.templateKey,
        appliedVersion: applied.appliedVersion,
        registryVersion: null,
        drift: null,
        notification: null,
      };
    }
    if (compareVersions(applied.appliedVersion, registry.version) === 0) {
      return {
        status: "current",
        templateKey: applied.templateKey,
        appliedVersion: applied.appliedVersion,
        registryVersion: registry.version,
        drift: null,
        notification: null,
      };
    }
    if (compareVersions(applied.appliedVersion, registry.version) > 0) {
      return {
        status: "registry-behind",
        templateKey: applied.templateKey,
        appliedVersion: applied.appliedVersion,
        registryVersion: registry.version,
        drift: null,
        notification: null,
      };
    }

    // Registry is newer: record the upgrade OFFER (never auto-apply).
    const kind = driftKind(applied.appliedVersion, registry.version);
    const dedupeKey = `template.upgrade:${applied.templateKey}:${registry.version}`;
    const severity = kind === "major" ? "critical" : "info";
    const templateName = registry.manifest.name;
    const templateNameAr = registry.manifest.name_ar;
    const majorNote =
      kind === "major"
        ? {
            ar: " هذا إصدار رئيسي — راجع ملاحظات الترحيل قبل الترقية.",
            en: " This is a MAJOR version — review the migration note before upgrading.",
          }
        : { ar: "", en: "" };
    const input = {
      category: "templates" as const,
      severity: severity as "info" | "critical",
      title: {
        ar: `تحديث متاح لقالب ${templateNameAr}`,
        en: `Template update available: ${templateName}`,
      },
      body: {
        ar:
          `الإصدار ${registry.version} من قالب «${templateNameAr}» متاح (المطبّق حاليًا ${applied.appliedVersion}).` +
          ` راجع التغييرات من شاشة القوالب ثم قم بالترقية — لا يتم تطبيق التحديث تلقائيًا.${majorNote.ar}`,
        en:
          `Version ${registry.version} of "${templateName}" is available (currently applied: ${applied.appliedVersion}).` +
          ` Review the changes on the templates screen and upgrade explicitly — nothing is auto-applied.${majorNote.en}`,
      },
      actionLabel: { ar: "مراجعة التحديث", en: "Review update" },
      actionUrl: TEMPLATES_ADMIN_URL,
      dedupeKey,
    };

    // Audience: the tenant owner (their in-app preference gates the row).
    let recorded = false;
    const owner = await this.inbox.ownerTarget();
    if (owner !== null) {
      const prefs = await this.inbox.prefsFor(owner.userId, "templates");
      if (prefs.inApp) {
        recorded = (await this.inbox.record({ ...input, userId: owner.userId })).inserted;
      }
    } else {
      recorded = (await this.inbox.record({ ...input, userId: null })).inserted;
    }

    if (recorded) {
      // The offer itself is an auditable configuration event (§2 item 11).
      await this.audit.record({
        action: "industry.template.upgrade_offered",
        entityType: "tenant_industry_config",
        entityId: requireTenantContext().tenantId, // audit entityId is a uuid column
        before: { appliedVersion: applied.appliedVersion },
        after: { registryVersion: registry.version, drift: kind, dedupeKey },
      });
    }

    return {
      status: "upgrade-available",
      templateKey: applied.templateKey,
      appliedVersion: applied.appliedVersion,
      registryVersion: registry.version,
      drift: kind,
      notification: { recorded, dedupeKey },
    };
  }
}
