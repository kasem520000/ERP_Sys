import { createHash } from "node:crypto";

import { DomainError } from "@erp/domain-core";

import { sql } from "drizzle-orm";

import { withPlatformScope, withTenant } from "../../../../infra/db/tenant-context";
import { AuditService } from "../../../audit/api/audit";
import { FilesService } from "../../../files/api/files";
import * as store from "../../infrastructure/offboarding.store";
import { LifecycleService } from "../lifecycle-service";
import {
  OFFBOARDING_GRACE_DAYS,
  OFFBOARDING_RETENTION_DAYS,
} from "./purge-service";

/**
 * Offboarding flow service (PHASE-024 T11; DATA_PROTECTION §4; Journey H):
 * the non-destructive half — request (read-only grace) → export (manifest
 * with checksums) → two-person execution (suspend + retention window) →
 * cancel-during-grace, plus the platform legal-hold lever. The destructive
 * half (the purge sweep) lives in purge-service.ts on the migration-scope
 * connection.
 *
 * Design notes (recorded in the completion report):
 * - The read-only grace rides the PHASE-014 subscription machinery
 *   (`GRACE_READ_ONLY` + the tenant-context interceptor's typed 403): the
 *   documented H1 behavior ("users can export but not post") without a
 *   parallel read-only path.
 * - The export package is the §4 step-2 entity list as JSON artifacts +
 *   CSV alternates for the core lists + manifest.json (per-artifact
 *   sha256, entity counts, schema version). A ZIP bundler dependency is
 *   deliberately NOT added mid-security-phase (dependency-triage
 *   discipline); the manifest + per-artifact signed URLs deliver the same
 *   verifiable content (H3) and the deviation is recorded.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export class OffboardingNotEligibleError extends DomainError {
  constructor(message: string) {
    super("tenancy/offboarding-not-eligible", message);
  }
}

export class OffboardingConfirmationError extends DomainError {
  constructor() {
    super(
      "tenancy/offboarding-confirmation",
      "type the tenant name exactly to confirm offboarding",
    );
  }
}

export interface OffboardingExportResult {
  manifestFileId: string;
  manifestChecksum: string;
  artifacts: { key: string; entity: string; format: "json" | "csv"; rows: number; sha256: string }[];
  downloadUrl: string;
}

/**
 * DATA_PROTECTION §4 step 2 — the export entity list: full-fidelity
 * financial data (posted journal entries with all lines), the master data,
 * and the settings — JSON for every entity, CSV alternates for the core
 * lists (the bounded §4 wording, not a 150-table dump).
 */
const EXPORT_ENTITIES: readonly { table: string; name: string; csv: boolean }[] = [
  { table: "branches", name: "branches", csv: false },
  { table: "partners", name: "partners", csv: true },
  { table: "partner_contacts", name: "partner_contacts", csv: false },
  { table: "partner_addresses", name: "partner_addresses", csv: false },
  { table: "item_categories", name: "item_categories", csv: false },
  { table: "items", name: "items", csv: true },
  { table: "uoms", name: "uoms", csv: false },
  { table: "price_lists", name: "price_lists", csv: false },
  { table: "credit_terms", name: "credit_terms", csv: false },
  { table: "fiscal_years", name: "fiscal_years", csv: false },
  { table: "fiscal_periods", name: "fiscal_periods", csv: false },
  { table: "accounts", name: "accounts", csv: false },
  { table: "cost_centers", name: "cost_centers", csv: false },
  { table: "journal_entries", name: "journal_entries", csv: true },
  { table: "journal_lines", name: "journal_lines", csv: true },
  { table: "partner_subledger_entries", name: "partner_subledger_entries", csv: false },
  { table: "sales_invoices", name: "sales_invoices", csv: true },
  { table: "sales_invoice_lines", name: "sales_invoice_lines", csv: false },
  { table: "sales_orders", name: "sales_orders", csv: false },
  { table: "sales_order_lines", name: "sales_order_lines", csv: false },
  { table: "quotations", name: "quotations", csv: false },
  { table: "purchase_orders", name: "purchase_orders", csv: false },
  { table: "purchase_order_lines", name: "purchase_order_lines", csv: false },
  { table: "supplier_invoices", name: "supplier_invoices", csv: true },
  { table: "supplier_invoice_lines", name: "supplier_invoice_lines", csv: false },
  { table: "receipts", name: "receipts", csv: true },
  { table: "payments", name: "payments", csv: true },
  { table: "cash_accounts", name: "cash_accounts", csv: false },
  { table: "tenant_settings", name: "settings", csv: false },
];

export interface OffboardingDeps {
  readonly audit: AuditService;
  readonly files: FilesService;
  readonly lifecycle: LifecycleService;
  readonly now?: () => Date;
}

export class OffboardingService {
  constructor(private readonly deps: OffboardingDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * H1: the owner requests offboarding (typed-name confirmation). The
   * tenant enters the read-only grace (subscription GRACE_READ_ONLY — the
   * PHASE-014 machinery: reads/exports work, posting 403s with the typed
   * resolving action).
   */
  async request(input: { tenantId: string; requestedBy: string; confirmName: string }): Promise<store.OffboardingRow> {
    const existing = await store.findLiveOffboarding(input.tenantId);
    if (existing !== undefined) {
      throw new OffboardingNotEligibleError(
        "an offboarding request is already in progress for this tenant",
      );
    }
    // Typed-name confirmation (H1): the CURRENT tenant name, exact match.
    const tenant = await store.findTenantForPlatform(input.tenantId);
    if (tenant === undefined) {
      throw new OffboardingNotEligibleError("tenant not found");
    }
    if (input.confirmName !== tenant.name) {
      throw new OffboardingConfirmationError();
    }
    const graceUntil = new Date(this.now().getTime() + OFFBOARDING_GRACE_DAYS * DAY_MS);
    const row = await store.insertOffboarding({
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      graceUntil: graceUntil.toISOString(),
    });
    await store.setSubscriptionGrace(input.tenantId, "GRACE_READ_ONLY", graceUntil.toISOString());
    await this.auditTenant(input.tenantId, "offboarding.requested", input.requestedBy, {
      grace_until: graceUntil.toISOString(),
    });
    return row;
  }

  /**
   * H2/H3: the full export package — JSON artifacts per entity + CSV
   * alternates for core lists + manifest.json (sha256 per artifact, entity
   * counts, schema version 36); a signed download URL for the manifest.
   */
  async triggerExport(input: { tenantId: string; actorId: string }): Promise<OffboardingExportResult> {
    const row = await store.findLiveOffboarding(input.tenantId);
    if (row === undefined || (row.status !== "REQUESTED" && row.status !== "EXPORTED")) {
      throw new OffboardingNotEligibleError("no offboarding request to export for");
    }
    const artifacts: OffboardingExportResult["artifacts"] = [];

    for (const entity of EXPORT_ENTITIES) {
      const rows = await this.readEntityRows(input.tenantId, entity.table);
      if (rows.length > 0 || entity.csv) {
        const json = Buffer.from(JSON.stringify(rows), "utf8");
        const key = await this.deps.files.writeArtifact(
          input.tenantId,
          "offboarding_export",
          `${entity.name}.json`,
          json,
        );
        artifacts.push({
          key,
          entity: entity.name,
          format: "json",
          rows: rows.length,
          sha256: createHash("sha256").update(json).digest("hex"),
        });
      }
      if (entity.csv && rows.length > 0) {
        const csv = Buffer.from(toCsv(rows), "utf8");
        const key = await this.deps.files.writeArtifact(
          input.tenantId,
          "offboarding_export",
          `${entity.name}.csv`,
          csv,
        );
        artifacts.push({
          key,
          entity: entity.name,
          format: "csv",
          rows: rows.length,
          sha256: createHash("sha256").update(csv).digest("hex"),
        });
      }
    }

    const manifest = {
      generated_at: this.now().toISOString(),
      schema_version: 36,
      tenant_id: input.tenantId,
      entity_count: new Set(artifacts.map((artifact) => artifact.entity)).size,
      artifacts: artifacts.map((artifact) => ({
        key: artifact.key,
        entity: artifact.entity,
        format: artifact.format,
        rows: artifact.rows,
        sha256: artifact.sha256,
      })),
    };
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const manifestKey = await this.deps.files.writeArtifact(
      input.tenantId,
      "offboarding_export",
      "manifest.json",
      manifestBody,
    );
    const manifestChecksum = createHash("sha256").update(manifestBody).digest("hex");
    const downloadUrl = await this.deps.files.issueDownloadUrl(input.tenantId, manifestKey);

    await store.updateOffboarding(input.tenantId, {
      status: "EXPORTED",
      exportFileId: manifestFileIdOf(manifestKey),
      manifestChecksum,
      exportedAt: this.now().toISOString(),
    });
    await this.auditTenant(input.tenantId, "export.generated", input.actorId, {
      artifacts: artifacts.length,
      manifest_checksum: manifestChecksum,
    });
    return {
      manifestFileId: manifestFileIdOf(manifestKey),
      manifestChecksum,
      artifacts,
      downloadUrl,
    };
  }

  /**
   * H4: the two-person execution — the owner's REQUESTED/EXPORTED flow row
   * must exist (person 1); the platform admin executes (person 2,
   * `platform.tenants.offboard`): suspend (sessions die, sync rejects —
   * the LifecycleService semantics) + the 90-day retention window
   * (OQ-009 placeholder).
   */
  async execute(input: { tenantId: string; adminId: string }): Promise<store.OffboardingRow> {
    const row = await store.findLiveOffboarding(input.tenantId);
    if (row === undefined || (row.status !== "REQUESTED" && row.status !== "EXPORTED")) {
      throw new OffboardingNotEligibleError(
        "two-person rule: an owner offboarding request must exist before execution",
      );
    }
    const retentionUntil = new Date(
      this.now().getTime() + OFFBOARDING_RETENTION_DAYS * DAY_MS,
    );
    await this.deps.lifecycle.suspend(input.adminId, input.tenantId, "offboarding execution");
    await store.updateOffboarding(input.tenantId, {
      status: "EXECUTED",
      executedBy: input.adminId,
      executedAt: this.now().toISOString(),
      retentionUntil: retentionUntil.toISOString(),
    });
    await this.auditPlatform("offboarding.executed", input.tenantId, input.adminId, {
      retention_until: retentionUntil.toISOString(),
      requested_by: row.requestedBy,
    });
    return (await store.findLiveOffboarding(input.tenantId)) ?? row;
  }

  /** H4 edge: the owner cancels during grace → ACTIVE + the reversal audited. */
  async cancel(input: { tenantId: string; actorId: string }): Promise<void> {
    const row = await store.findLiveOffboarding(input.tenantId);
    if (row === undefined || row.status !== "REQUESTED") {
      throw new OffboardingNotEligibleError(
        "cancellation is only available during the grace period (before execution)",
      );
    }
    await store.updateOffboarding(input.tenantId, {
      status: "CANCELLED",
      cancelledAt: this.now().toISOString(),
    });
    await store.setSubscriptionGrace(input.tenantId, "ACTIVE", null);
    await this.auditTenant(input.tenantId, "tenant.restored", input.actorId, {
      offboarding_cancelled: true,
    });
  }

  /** Journey H guardrail: the platform legal-hold lever (audited both ways). */
  async setLegalHold(input: { tenantId: string; adminId: string; legalHold: boolean; reason: string }): Promise<void> {
    const tenant = await store.setTenantLegalHold(input.tenantId, input.legalHold);
    if (tenant === undefined) {
      throw new OffboardingNotEligibleError("tenant not found");
    }
    await this.auditPlatform(
      input.legalHold ? "legal_hold.applied" : "legal_hold.released",
      input.tenantId,
      input.adminId,
      { reason: input.reason },
    );
  }

  /** H6: the platform console reads the flow state. */
  async state(tenantId: string): Promise<store.OffboardingRow | undefined> {
    return store.findLiveOffboarding(tenantId);
  }

  async list(): Promise<readonly store.OffboardingRow[]> {
    return store.listOffboarding();
  }

  private async readEntityRows(tenantId: string, table: string): Promise<Record<string, unknown>[]> {
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new Error(`unsafe table name: ${table}`);
    }
    return withTenant(tenantId, async (tx) => {
      // Table names come from the frozen EXPORT_ENTITIES constant — never
      // user input; the identifier regex above is the belt.
      const result = await tx.execute(
        sql`SELECT * FROM ${sql.identifier(table)} ORDER BY id`,
      );
      return result.rows as unknown as Record<string, unknown>[];
    });
  }

  private async auditTenant(
    tenantId: string,
    action: string,
    actorId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await withTenant(tenantId, async () => {
      await this.deps.audit.record({
        action,
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after,
      });
    });
  }

  private async auditPlatform(
    action: string,
    tenantId: string,
    actorId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await withPlatformScope(async () => {
      await this.deps.audit.recordPlatform({
        action,
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after,
      });
    });
  }
}

/** file_objects row id for the manifest key (the object registry row —
 * written by the regular upload path; the export records the key). */
function manifestFileIdOf(key: string): string {
  // The manifest's durable reference is its storage key; export_file_id
  // stores the key's uuid segment (the offboarding row dies with the
  // tenant anyway — purged_tenants carries the checksum).
  const segments = key.split("/");
  return segments[2] ?? key;
}

/** Minimal complete CSV: keys from the first row, quoted on demand. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }
  const keys = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    const text =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(keys.map((key) => escape(row[key])).join(","));
  }
  return lines.join("\r\n");
}

/** Kept for the future zip bundler decision record (unused today). */
export const EXPORT_ZIP_NOTE =
  "no zip dependency added in-phase (dependency-triage discipline); manifest + per-artifact signed URLs deliver the H3 verifiable content";
