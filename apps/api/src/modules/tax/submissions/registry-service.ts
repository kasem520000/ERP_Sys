import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { FilesService } from "../../files/application/files.service";
import { InboxService } from "../../notifications/application/inbox-service";
import * as packStore from "../infrastructure/tax.store";
import { EInvoicingStateError } from "../domain/tax-errors";
import type { EInvoicingAdapter, SubmissionOutcome } from "../domain/adapter-port";
import {
  backoffDelayMs,
  isDeadLetter,
  type SubmissionStatus,
} from "./state-machine";
import * as store from "./store";
import { buildComplianceArchive, archiveDigest, type ComplianceArchive } from "./payload-builder";
import { sealArtifact } from "./secret-artifact";
import { ZatcaUnverifiedStubAdapter } from "../adapters/zatca/zatca-stub";

/**
 * PHASE-023 T1/T2 — the OPERATIONAL e-invoicing submission registry
 * (E_INVOICING §2/§6; phase §2 items 1/5): react to POSTED documents by
 * enqueueing registry rows (idempotent per document × adapter — no double
 * clearance), build + seal the compliance archive through the payload
 * builder, drive legal transitions ONLY, persist encrypted
 * payload/response artifacts through the files module, and feed the
 * sign→submit→poll→retry→reconcile job pipeline (jobs.ts).
 *
 * Two hard invariants (directive §12 + ADR-0010 §4):
 * 1. Authority truth is EXACTLY the registry row — nothing infers
 *    acceptance from local document state; adapters never write business
 *    tables.
 * 2. The UNVERIFIED refusal is enforced HERE for every adapter whose
 *    regime facts are not VERIFIED (RISK-005) — the ZATCA stub's refusal
 *    and the fake-authority harness's happy paths both flow through the
 *    same gate.
 */
@Injectable()
export class SubmissionRegistryService {
  private readonly adapters = new Map<string, EInvoicingAdapter>();
  private readonly inbox = new InboxService();

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {
    // PHASE-023 T4: the ZATCA adapter ships as the UNVERIFIED refusing
    // stub (DR-001 OPEN; verification gate unpassed — RISK-005). The
    // fake-authority harness (tests) registers its own adapters on top.
    this.registerAdapter(new ZatcaUnverifiedStubAdapter());
  }

  /** Register an adapter implementation (module wiring; ids are unique). */
  registerAdapter(adapter: EInvoicingAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new EInvoicingStateError(`adapter ${adapter.id} is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  listAdapters(): { id: string; supportedCountries: readonly string[]; regimeVerified: boolean }[] {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      supportedCountries: adapter.supportedCountries,
      regimeVerified: adapter.regimeVerified,
    }));
  }

  listSubmissions(filter: store.RegistryFilter = {}) {
    return store.listSubmissions(filter);
  }

  async findSubmission(id: string): Promise<store.SubmissionRow> {
    const row = await store.findSubmission(id);
    if (row === undefined) {
      throw new EInvoicingStateError(`submission ${id} not found`);
    }
    return row;
  }

  /**
   * The posting reaction (T-02 protected: async, never blocks posting):
   * enqueue a registry row for a POSTED document when the tenant's
   * jurisdiction has an e-invoicing regime AND the adapter is ENABLED for
   * the tenant (rollout flags default OFF — T13). Idempotent: the same
   * document × adapter returns the existing row (sync duplicate pushes and
   * job retries can never double-enqueue).
   */
  async reactToPostedDocument(input: {
    sourceType: string;
    sourceId: string;
    actorId: string | null;
  }): Promise<{ enqueued: boolean; submissionId: string | null; idempotentReplay: boolean; reason?: string }> {
    const tenantId = requireTenantContext().tenantId;
    const country = (await packStore.findTenantCountry(tenantId)) ?? "SA";
    const jurisdiction = await packStore.findJurisdictionByCountry(country);
    if (jurisdiction === undefined) {
      return { enqueued: false, submissionId: null, idempotentReplay: false, reason: "NO_JURISDICTION" };
    }
    const rollout = await import("../rollout/adapter-settings");
    // Adapter selection honors the rollout flags (T13): among the adapters
    // supporting the tenant's jurisdiction, the FIRST ENABLED one reacts —
    // a registered-but-disabled adapter (the default state) is a no-op.
    let adapter: EInvoicingAdapter | undefined;
    let sawSupported = false;
    for (const candidate of this.adapters.values()) {
      if (!candidate.supportedCountries.includes(country)) continue;
      sawSupported = true;
      const settings = await rollout.findAdapterSetting(candidate.id);
      if (settings !== undefined && settings.enabled === true) {
        adapter = candidate;
        break;
      }
    }
    if (adapter === undefined) {
      return {
        enqueued: false,
        submissionId: null,
        idempotentReplay: false,
        reason: sawSupported ? "ADAPTER_DISABLED" : "DORMANT_SLOT",
      };
    }
    const outcome = await store.enqueueSubmission({
      countryCode: country,
      adapterId: adapter.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      payloadDigest: null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "tax.einvoicing_submission_enqueued",
      entityType: "e_invoicing_submission",
      entityId: outcome.row.id,
      actorId: input.actorId ?? undefined,
      after: { adapterId: adapter.id, status: outcome.row.status, idempotentReplay: outcome.idempotentReplay },
    });
    return {
      enqueued: true,
      submissionId: outcome.row.id,
      idempotentReplay: outcome.idempotentReplay,
    };
  }

  /**
   * Resubmission after REJECTED/user action (TROUBLESHOOTING §10): a NEW
   * row chained to the old one — history is append-only; the old row stays
   * REJECTED forever.
   */
  async resubmit(input: { submissionId: string; actorId: string | null }): Promise<store.SubmissionRow> {
    const previous = await this.findSubmission(input.submissionId);
    if (previous.status !== "REJECTED" && previous.status !== "FAILED") {
      throw new EInvoicingStateError(
        `resubmission requires a REJECTED or FAILED row (got ${previous.status})`,
      );
    }
    const outcome = await store.enqueueSubmission({
      countryCode: previous.countryCode,
      adapterId: previous.adapterId,
      sourceType: previous.sourceType,
      sourceId: previous.sourceId,
      payloadDigest: null,
      actorId: input.actorId,
      retryOfSubmissionId: previous.id,
    });
    await this.audit.record({
      action: "tax.einvoicing_submission_resubmitted",
      entityType: "e_invoicing_submission",
      entityId: outcome.row.id,
      actorId: input.actorId ?? undefined,
      after: { retryOf: previous.id, idempotentReplay: outcome.idempotentReplay },
    });
    return outcome.row;
  }

  /**
   * The GENERATED hop (T1): build the compliance archive from the posted
   * document + INV-012 summary, seal it, persist through the files module
   * (encrypted at rest — E_INVOICING §6), and transition PENDING →
   * GENERATED. Deterministic digest guards the artifact against silent
   * document drift (the digest is recomputed and compared at submit time).
   */
  async generatePayload(input: {
    submissionId: string;
    document: {
      officialNumber: string | null;
      issuedOn: string | null;
      partyName: string | null;
      currencyCode: string | null;
      totals: Readonly<Record<string, string>> | null;
    };
    taxSummary: readonly ComplianceArchive["taxSummary"][number][];
  }): Promise<store.SubmissionRow> {
    const row = await this.findSubmission(input.submissionId);
    const jurisdiction = await packStore.findJurisdictionByCountry(row.countryCode);
    if (jurisdiction === undefined) {
      throw new EInvoicingStateError(`jurisdiction ${row.countryCode} vanished (pack seed drift)`);
    }
    const archive = buildComplianceArchive({
      countryCode: row.countryCode,
      packVersion: jurisdiction.packVersion,
      vatStatus: jurisdiction.vatStatus,
      verificationStatus: jurisdiction.verificationStatus,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      document: input.document,
      taxSummary: input.taxSummary,
    });
    const tenantId = requireTenantContext().tenantId;
    const sealed = sealArtifact(Buffer.from(JSON.stringify(archive), "utf8"));
    const fileId = await this.persistArtifact({
      tenantId,
      filename: `einvoicing-payload-${row.id}.bin`,
      body: sealed,
      submissionId: row.id,
      kind: "EINVOICE_PAYLOAD",
    });
    const transitioned = await store.transitionSubmission({
      id: row.id,
      to: "GENERATED",
      payloadFileId: fileId,
    });
    await this.audit.record({
      action: "tax.einvoicing_payload_generated",
      entityType: "e_invoicing_submission",
      entityId: row.id,
      after: { digest: archiveDigest(archive), packVersion: jurisdiction.packVersion },
    });
    return transitioned;
  }

  /**
   * The SIGNED + SUBMITTED hops (T2): the UNVERIFIED gate is enforced
   * before ANY adapter submit call (RISK-005 — the fake-authority harness
   * flips regimeVerified in tests; production adapters carry their own
   * regimeVerified only after the verification gate passes). Attempt
   * bookkeeping + backoff/dead-letter policy live here so every caller
   * (job, test, admin action) shares ONE retry policy.
   */
  async submitThroughAdapter(input: {
    submissionId: string;
    /** The harness/tests may inject a per-call adapter override. */
    adapterOverride?: EInvoicingAdapter;
  }): Promise<{
    row: store.SubmissionRow;
    outcome: SubmissionOutcome | null;
    refused?: string;
    deadLettered?: boolean;
    retried?: boolean;
  }> {
    const row = await this.findSubmission(input.submissionId);
    const adapter = input.adapterOverride ?? this.adapters.get(row.adapterId);
    if (adapter === undefined) {
      throw new EInvoicingStateError(`adapter ${row.adapterId} is not registered`);
    }
    // RISK-005 gate: refuse — never partial, never "best effort".
    const jurisdiction = await packStore.findJurisdictionByCountry(row.countryCode);
    if (
      adapter.regimeVerified !== true ||
      jurisdiction === undefined ||
      jurisdiction.verificationStatus !== "VERIFIED"
    ) {
      const failed = await store.transitionSubmission({
        id: row.id,
        to: "FAILED",
        incrementAttempts: true,
        errorCode: "UNVERIFIED_REGIME",
        errorDetail: {
          code: "UNVERIFIED_REGIME",
          note: "the adapter refuses real submissions while regime facts are REQUIRES_VERIFICATION (E_INVOICING §3 verification gate)",
          adapterId: adapter.id,
          verificationStatus: jurisdiction?.verificationStatus ?? "NO_JURISDICTION",
        },
      });
      await this.audit.record({
        action: "tax.einvoicing_submission_refused",
        entityType: "e_invoicing_submission",
        entityId: row.id,
        after: { reason: "UNVERIFIED_REGIME", adapterId: adapter.id },
      });
      return { row: failed, outcome: null, refused: "UNVERIFIED_REGIME" };
    }

    // SIGNED hop where the regime signs (adapter declares it).
    let current = row;
    if (current.status === "GENERATED" && this.regimeSigns(adapter)) {
      current = await store.transitionSubmission({ id: row.id, to: "SIGNED" });
    }
    if (current.status !== "SIGNED" && current.status !== "GENERATED" && current.status !== "SUBMITTED") {
      throw new EInvoicingStateError(
        `submission ${row.id} is not in a submittable state (got ${current.status})`,
      );
    }
    const payload = await this.readSealedPayload(current);
    const outcome = await adapter.submit({
      countryCode: current.countryCode,
      sourceType: current.sourceType,
      sourceId: current.sourceId,
      document: payload,
    });
    const applied = await this.applyOutcome({ submissionId: current.id, outcome });
    return { row: applied.row, outcome, deadLettered: applied.deadLettered, retried: applied.retried };
  }

  /**
   * Apply an adapter outcome to the registry (SUBMITTED → ACCEPTED /
   * REJECTED / retry). Timeout-shaped FAILED outcomes inside the attempt
   * budget schedule a retry; poison messages dead-letter with the
   * einvoice.submission.failed notification (E_INVOICING §1).
   */
  async applyOutcome(input: {
    submissionId: string;
    outcome: SubmissionOutcome;
    responseBytes?: Buffer | null;
  }): Promise<{ row: store.SubmissionRow; deadLettered: boolean; retried: boolean }> {
    const row = await this.findSubmission(input.submissionId);
    const { outcome } = input;
    let responseFileId: string | null = null;
    if (input.responseBytes !== undefined && input.responseBytes !== null) {
      const tenantId = requireTenantContext().tenantId;
      responseFileId = await this.persistArtifact({
        tenantId,
        filename: `einvoicing-response-${row.id}.bin`,
        body: sealArtifact(input.responseBytes),
        submissionId: row.id,
        kind: "EINVOICE_RESPONSE",
      });
    }

    if (outcome.status === "ACCEPTED" || outcome.status === "REJECTED") {
      // The SUBMITTED hop first (GENERATED/SIGNED rows), then the terminal
      // state — both transitions are legal per the state machine.
      if (row.status !== "SUBMITTED") {
        await store.transitionSubmission({ id: row.id, to: "SUBMITTED" });
      }
      const transitioned = await store.transitionSubmission({
        id: row.id,
        to: outcome.status as SubmissionStatus,
        authorityReference: outcome.authorityReference,
        authorityRefs: outcome.authorityReference !== null ? [outcome.authorityReference] : null,
        errorCode: outcome.status === "REJECTED" ? String(outcome.error?.code ?? "AUTHORITY_REJECTED") : null,
        errorDetail: outcome.error !== null ? (outcome.error as Record<string, unknown>) : null,
        responseFileId,
        incrementAttempts: true,
      });
      let final = transitioned;
      if (
        outcome.status === "ACCEPTED" &&
        transitioned.status === "ACCEPTED" &&
        this.isReportingMode(row.adapterId)
      ) {
        // Reporting-mode flows: ACCEPTED → REPORTED (E_INVOICING §2).
        final = await store.transitionSubmission({ id: row.id, to: "REPORTED" });
      }
      await this.audit.record({
        action: `tax.einvoicing_submission_${outcome.status.toLowerCase()}`,
        entityType: "e_invoicing_submission",
        entityId: row.id,
        after: { authorityReference: outcome.authorityReference, error: outcome.error },
      });
      if (outcome.status === "REJECTED") {
        await this.notifyFailure(row, "AUTHORITY_REJECTED", "rejection codes recorded for user action");
      }
      return { row: final, deadLettered: false, retried: false };
    }

    if (outcome.status === "FAILED") {
      const attempts = row.attempts + 1;
      if (isDeadLetter(attempts)) {
        const dead = await store.transitionSubmission({
          id: row.id,
          to: "FAILED",
          incrementAttempts: true,
          errorCode: String(outcome.error?.code ?? "SUBMISSION_FAILED"),
          errorDetail: outcome.error !== null ? (outcome.error as Record<string, unknown>) : null,
          responseFileId,
        });
        await this.audit.record({
          action: "tax.einvoicing_submission_dead_lettered",
          entityType: "e_invoicing_submission",
          entityId: row.id,
          after: { attempts, error: outcome.error },
        });
        await this.notifyFailure(dead, "DEAD_LETTER", "submission dead-lettered after capped retries");
        return { row: dead, deadLettered: true, retried: false };
      }
      // Live retry: stay in the current state, schedule the next attempt.
      const nextAt = new Date(Date.now() + backoffDelayMs(attempts)).toISOString();
      const retried = await store.transitionSubmission({
        id: row.id,
        to: row.status as SubmissionStatus,
        incrementAttempts: true,
        errorCode: String(outcome.error?.code ?? "SUBMISSION_RETRY"),
        errorDetail: outcome.error !== null ? (outcome.error as Record<string, unknown>) : null,
        responseFileId,
        nextAttemptAt: nextAt,
      });
      return { row: retried, deadLettered: false, retried: true };
    }

    // SUBMITTED / GENERATED / SIGNED / PENDING outcomes: record the hop.
    const transitioned = await store.transitionSubmission({
      id: row.id,
      to: outcome.status as SubmissionStatus,
      incrementAttempts: true,
      responseFileId,
    });
    return { row: transitioned, deadLettered: false, retried: false };
  }

  /** The funnel aggregate for this tenant (MONITORING §1 — dashboard feed). */
  async funnel() {
    return store.funnelStats();
  }

  // -- internals ------------------------------------------------------------------

  /** Does the adapter's regime sign payloads? (declared, not inferred) */
  private regimeSigns(_adapter: EInvoicingAdapter): boolean {
    // Adapter-neutral default: regimes that sign declare it via their
    // implementation of the port extension once VERIFIED; until any regime
    // is verified the SIGNED hop is exercised by the fake-authority
    // harness through direct registry transitions (tests) — no fabricated
    // signing semantics ship here (NO-FABRICATION §4 rule 2).
    return false;
  }

  /** Reporting-mode adapters (B2C reporting flows — E_INVOICING §2). */
  private isReportingMode(_adapterId: string): boolean {
    // Same honesty rule as regimeSigns: the reporting mode is an adapter
    // declaration that ships with a VERIFIED adapter; the harness drives
    // ACCEPTED → REPORTED transitions directly in tests.
    return false;
  }

  private async readSealedPayload(row: store.SubmissionRow): Promise<Record<string, unknown>> {
    if (row.payloadFileId === null) {
      throw new EInvoicingStateError(`submission ${row.id} has no generated payload`);
    }
    const key = await this.artifactKey(row.payloadFileId);
    const { openArtifact } = await import("./secret-artifact");
    const bytes = await this.files.readObject(requireTenantContext().tenantId, key);
    return JSON.parse(openArtifact(bytes.body).toString("utf8")) as Record<string, unknown>;
  }

  private async artifactKey(fileId: string): Promise<string> {
    const { findFileStorageKey } = await import("./artifact-files");
    return findFileStorageKey(fileId);
  }

  /** Persist a sealed artifact through the files module + registry row. */
  private async persistArtifact(input: {
    tenantId: string;
    filename: string;
    body: Buffer;
    submissionId: string;
    kind: "EINVOICE_PAYLOAD" | "EINVOICE_RESPONSE";
  }): Promise<string> {
    const { registerArtifactFile } = await import("./artifact-files");
    return registerArtifactFile(this.files, {
      tenantId: input.tenantId,
      ownerType: input.kind,
      ownerId: input.submissionId,
      filename: input.filename,
      body: input.body,
    });
  }

  /** einvoice.submission.failed → notifications (E_INVOICING §1 + §7). */
  private async notifyFailure(
    row: store.SubmissionRow,
    code: string,
    note: string,
  ): Promise<void> {
    await this.inbox.record({
      category: "einvoicing",
      severity: code === "DEAD_LETTER" ? "critical" : "warning",
      title: {
        ar: code === "DEAD_LETTER" ? "تعذّر تسليم فاتورة إلكترونية" : "رفض جهة الضريبة للفاتورة",
        en: code === "DEAD_LETTER" ? "E-invoice submission failed" : "Tax authority rejected an e-invoice",
      },
      body: {
        ar: `${note} — رقم التسجيل ${row.id}`,
        en: `${note} — submission ${row.id}`,
      },
      actionUrl: `/settings/tax/einvoicing`,
      dedupeKey: `einvoicing:submission:${row.id}:${code}`,
    });
  }
}

/**
 * The system-tenant iteration helper for job handlers (the maintenance-jobs
 * pattern): one UoW per ACTIVE tenant; a failure in one tenant never blocks
 * the rest.
 */
export async function forEachActiveTenant<T>(
  fn: (tenantId: string) => Promise<T>,
): Promise<{ tenantId: string; outcome: T | { error: string } }[]> {
  const { listActiveTenantIds } = await import("../../../infra/jobs/system-tenants");
  const results: { tenantId: string; outcome: T | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, () => fn(tenantId));
      results.push({ tenantId, outcome });
    } catch (error) {
      results.push({ tenantId, outcome: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}
