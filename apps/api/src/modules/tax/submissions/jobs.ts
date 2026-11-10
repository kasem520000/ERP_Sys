import { sql } from "drizzle-orm";

import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { getBoss } from "../../../infra/jobs/boss";
import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../files/application/files.service";
import { S3FilesStore } from "../../files/infrastructure/s3-files.store";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "./store";
import { RETRY_MAX_ATTEMPTS, type SubmissionStatus } from "./state-machine";
import { evaluateExpiry } from "../certs/certificate-service";

/**
 * PHASE-023 T2 — the submission job pipeline (E_INVOICING §1/§7; phase §2
 * item 5): pg-boss queues drive the registry's live rows through
 * sign → submit → poll → retry → reconcile → alert. Every handler:
 *
 * - carries `{ system: true }` (no tenant id in the payload — ADR-0008 §5:
 *   jobs re-establish tenant scope per ACTIVE tenant through withTenant);
 * - is IDEMPOTENT (the registry's UNIQUE(document × adapter) + legal-
 *   transition assertion make re-delivery a no-op — no double clearance);
 * - declares the retry/dead-letter policy ONCE (state-machine.ts: expo
 *   backoff capped at 30 min, dead-letter at RETRY_MAX_ATTEMPTS with the
 *   einvoice.submission.failed notification);
 * - degrades the FEATURE, never the platform: a thrown handler error is
 *   caught + logged per tenant (circuit-breaker semantics — the posting
 *   path is untouched, T-02 protected).
 *
 * The `run*` functions are plain-callable so the db specs exercise them
 * WITHOUT pg-boss (the maintenance-jobs precedent).
 */

const log = childLogger({ module: "einvoicing-jobs" });
const audit = new AuditService(new DrizzleAuditStore());

// -- queue names + crons --------------------------------------------------------

/** Every 2 minutes: drive live rows through their next hop. */
export const EINVOICING_PIPELINE_QUEUE = "einvoicing.submission.pipeline";
export const EINVOICING_PIPELINE_CRON = "*/2 * * * *";

/** Daily 03:10 UTC: certificate expiry sweep (CertExpiry 30/14/7). */
export const EINVOICING_CERT_EXPIRY_QUEUE = "einvoicing.cert.expiry";
export const EINVOICING_CERT_EXPIRY_CRON = "10 3 * * *";

/** Every 5 minutes: EInvoiceRejectSpike evaluation (>5% in 15 min, Sev-2). */
export const EINVOICING_REJECT_SPIKE_QUEUE = "einvoicing.reject.spike";
export const EINVOICING_REJECT_SPIKE_CRON = "*/5 * * * *";

export interface EInvoicingSystemJobPayload {
  system: true;
}

// -- per-tenant passes (plain-callable; specs drive them directly) ---------------

/**
 * The pipeline pass for one tenant: due live rows advance one hop.
 *
 * The pass is deliberately adapter-agnostic about WHERE the payload comes
 * from: a row in PENDING needs its compliance archive (the payload builder
 * reads the posted document through the OWNING module's service — the
 * sales/purchasing read APIs; the fake-authority harness injects the
 * archive directly through the registry service). Rows past GENERATED
 * call the adapter through the registry service's UNVERIFIED-gated
 * submit path. The default no-adapter-doc case parks the row with a
 * PENDING_DOCUMENT_DATA error (honest, retried) — never a fabricated
 * payload.
 */
export async function runPipelinePass(options?: {
  /** Harness injection: supply the archive for PENDING rows. */
  onPendingRow?: (row: store.SubmissionRow) => Promise<{
    document: Parameters<import("./registry-service").SubmissionRegistryService["generatePayload"]>[0]["document"];
    taxSummary: Parameters<import("./registry-service").SubmissionRegistryService["generatePayload"]>[0]["taxSummary"];
  } | null>;
}): Promise<{ processed: number; advanced: number; errors: number }> {
  const due = await store.listDueSubmissions({ now: new Date().toISOString() });
  let advanced = 0;
  let errors = 0;
  const registry = new (await import("./registry-service")).SubmissionRegistryService(
    audit,
    new FilesService(new S3FilesStore()),
  );
  for (const row of due) {
    try {
      if (row.status === "PENDING") {
        const input = options?.onPendingRow !== undefined ? await options.onPendingRow(row) : null;
        if (input === null) {
          // No document data supplier registered in this pass — schedule a
          // retry and move on (honest PENDING, never fabricated).
          await store.transitionSubmission({
            id: row.id,
            to: "PENDING",
            incrementAttempts: true,
            errorCode: "PENDING_DOCUMENT_DATA",
            nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          });
          continue;
        }
        await registry.generatePayload({
          submissionId: row.id,
          document: input.document,
          taxSummary: input.taxSummary,
        });
        advanced += 1;
        continue;
      }
      const result = await registry.submitThroughAdapter({ submissionId: row.id });
      if (result.refused === undefined) {
        advanced += 1;
      }
    } catch (error) {
      errors += 1;
      log.warn(
        { action: "einvoicing-pipeline-row-error", submissionId: row.id, err: error },
        "pipeline row failed (feature degrades, platform unaffected)",
      );
    }
  }
  return { processed: due.length, advanced, errors };
}

/** The system-job body: one pass per ACTIVE tenant (failures isolated). */
export async function runPipeline(
  options?: Parameters<typeof runPipelinePass>[0],
): Promise<{ tenantId: string; outcome: { processed: number; advanced: number; errors: number } | { error: string } }[]> {
  const results: { tenantId: string; outcome: { processed: number; advanced: number; errors: number } | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, () => runPipelinePass(options));
      results.push({ tenantId, outcome });
    } catch (error) {
      results.push({ tenantId, outcome: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

/** CertExpiry pass (T5): one expiry evaluation per ACTIVE tenant. */
export async function runCertExpirySweep(now: Date = new Date()): Promise<
  { tenantId: string; outcome: { checked: number; alerted: unknown[] } | { error: string } }[]
> {
  const results: { tenantId: string; outcome: { checked: number; alerted: unknown[] } | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, () => evaluateExpiry(now));
      results.push({ tenantId, outcome });
    } catch (error) {
      results.push({ tenantId, outcome: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

/**
 * EInvoiceRejectSpike (MONITORING §3: >5% rejections in 15 min → Sev-2):
 * per-tenant evaluation from the funnel aggregate; the alert dedupes per
 * 15-minute window (a sustained spike re-fires at most once per window).
 */
export async function runRejectSpikeSweep(): Promise<
  { tenantId: string; outcome: { fired: boolean; ratePct: number | null } | { error: string } }[]
> {
  const inbox = new InboxService();
  const results: { tenantId: string; outcome: { fired: boolean; ratePct: number | null } | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, async () => {
        const stats = await store.funnelStats();
        const rate = stats.rejectionWindow.ratePct;
        const fired = rate !== null && rate > 5 && stats.rejectionWindow.total >= 5;
        if (fired) {
          // Integer floor division via the house pattern (cf. rate-limiter.ts):
          // Math.floor is banned by the ADR-0009 floating-math lint rule.
          const windowKey = new Date((Date.now() / (15 * 60_000) | 0) * 15 * 60_000).toISOString();
          await inbox.record({
            category: "einvoicing",
            severity: "critical",
            title: {
              ar: "ارتفاع مفاجئ في رفض الفواتير الإلكترونية",
              en: "E-invoice rejection spike detected",
            },
            body: {
              ar: `نسبة الرفض ${rate}% خلال آخر 15 دقيقة — ابدأ بتشخيص أسباب الرفض (دليل §10)`,
              en: `Rejection rate ${rate}% in the last 15 minutes — start the rejection triage runbook (§10)`,
            },
            actionUrl: `/platform/einvoicing-funnel`,
            dedupeKey: `einvoicing:reject-spike:${tenantId}:${windowKey}`,
          });
        }
        return { fired, ratePct: rate };
      });
      results.push({ tenantId, outcome });
    } catch (error) {
      results.push({ tenantId, outcome: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

/** Dead-letter growth monitor (phase §2 item 5): FAILED count > 0 alerts once/hour. */
export async function runDeadLetterWatch(): Promise<
  { tenantId: string; outcome: { deadLetter: number; alerted: boolean } | { error: string } }[]
> {
  const inbox = new InboxService();
  const results: { tenantId: string; outcome: { deadLetter: number; alerted: boolean } | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, async () => {
        const stats = await store.funnelStats();
        const alerted = stats.deadLetter > 0;
        if (alerted) {
          const hourKey = new Date((Date.now() / 3_600_000 | 0) * 3_600_000).toISOString();
          await inbox.record({
            category: "einvoicing",
            severity: "critical",
            title: {
              ar: "رسائل ميتة في قائمة الفوترة الإلكترونية",
              en: "Dead-lettered e-invoicing submissions",
            },
            body: {
              ar: `${stats.deadLetter} تسليمًا في حالة FAILED — راجع سجل التسليمات وابدأ إعادة الإرسال`,
              en: `${stats.deadLetter} submissions are FAILED — review the submission log and resubmit`,
            },
            actionUrl: `/settings/tax/einvoicing`,
            dedupeKey: `einvoicing:dead-letter:${tenantId}:${hourKey}`,
          });
        }
        return { deadLetter: stats.deadLetter, alerted };
      });
      results.push({ tenantId, outcome });
    } catch (error) {
      results.push({ tenantId, outcome: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

// -- module registration ---------------------------------------------------------

/** Register the queues + cron schedules (tax.module onModuleInit). */
export async function registerSubmissionJobs(): Promise<void> {
  const boss = getBoss();
  for (const queue of [
    EINVOICING_PIPELINE_QUEUE,
    EINVOICING_CERT_EXPIRY_QUEUE,
    EINVOICING_REJECT_SPIKE_QUEUE,
  ]) {
    try {
      await boss.createQueue(queue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(message)) {
        throw error;
      }
    }
  }
  await boss.work<EInvoicingSystemJobPayload>(EINVOICING_PIPELINE_QUEUE, async (jobs) => {
    for (let index = 0; index < jobs.length; index += 1) {
      const result = await runPipeline();
      log.info({ action: "einvoicing-pipeline-run", tenants: result.length }, "pipeline pass complete");
    }
  });
  await boss
    .schedule(EINVOICING_PIPELINE_QUEUE, EINVOICING_PIPELINE_CRON, { system: true })
    .catch(() => undefined);
  await boss.work<EInvoicingSystemJobPayload>(EINVOICING_CERT_EXPIRY_QUEUE, async (jobs) => {
    for (let index = 0; index < jobs.length; index += 1) {
      await runCertExpirySweep();
    }
  });
  await boss
    .schedule(EINVOICING_CERT_EXPIRY_QUEUE, EINVOICING_CERT_EXPIRY_CRON, { system: true })
    .catch(() => undefined);
  await boss.work<EInvoicingSystemJobPayload>(EINVOICING_REJECT_SPIKE_QUEUE, async (jobs) => {
    for (let index = 0; index < jobs.length; index += 1) {
      await runRejectSpikeSweep();
      await runDeadLetterWatch();
    }
  });
  await boss
    .schedule(EINVOICING_REJECT_SPIKE_QUEUE, EINVOICING_REJECT_SPIKE_CRON, { system: true })
    .catch(() => undefined);
}

/**
 * The maintenance sweep bound (bounded retention for certificate usage
 * rows — 90 days; the maintenance-jobs LIMIT/loop precedent).
 */
export const CERT_USAGE_RETENTION_DAYS = 90;

export async function runCertUsageRetention(): Promise<{ deleted: number }> {
  let deleted = 0;
  for (const tenantId of await listActiveTenantIds()) {
    deleted += await withTenant(tenantId, async () => {
      const { requireTenantContext } = await import("../../../infra/db/tenant-context");
      const context = requireTenantContext();
      if (context.tx === undefined) {
        throw new Error("cert usage retention requires an ambient tenant scope");
      }
      const rows = await context.tx.execute(sql`
        WITH doomed AS (
          SELECT id FROM e_invoicing_certificate_usage
          WHERE used_at < now() - interval '${sql.raw(String(CERT_USAGE_RETENTION_DAYS))} days'
          LIMIT 5000
        )
        DELETE FROM e_invoicing_certificate_usage WHERE id IN (SELECT id FROM doomed)
        RETURNING id
      `);
      return rows.rows.length;
    });
  }
  return { deleted };
}

export type { SubmissionStatus };
export { RETRY_MAX_ATTEMPTS };
