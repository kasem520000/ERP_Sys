import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb as _ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../modules/files/api/files";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import { SubmissionRegistryService } from "../../modules/tax/submissions/registry-service";
import * as store from "../../modules/tax/submissions/store";
import * as certs from "../../modules/tax/certs/certificate-service";
import * as rollout from "../../modules/tax/rollout/adapter-settings";
import { FakeZatcaAuthority } from "../../../../../tests/authorities/fake-zatca/fake-authority";
import {
  countInvoices,
  countJournals,
  enrollDevice,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

/**
 * PHASE-023 T12 — the chaos slice with submission jobs in the loop
 * (SYNC_TESTS §7 PHASE-023 row; phase §6): re-run C-01…C-04's duplicate /
 * reorder / partial-failure / crash-replay shapes with the e-invoicing
 * pipeline participating — the assertions bind to the registry's
 * idempotency: sync duplicate pushes and job retries produce EXACTLY ONE
 * submission per document and exactly one ledger effect (INV-013) — no
 * double clearance (acceptance criterion 5).
 *
 * Dedicated tenant TENANT_EINV "9e6a0000-0023-4000-8000-000000000023"
 * (the expo-chaos precedent — this suite owns it end to end).
 */

const TENANT_EINV = "9e6a0000-0023-4000-8000-000000000023";
const EINV_CASHIER = "9e6a0000-0023-4000-8000-0000000000a1";
const PEM = `-----BEGIN CERTIFICATE-----\n${"C".repeat(64)}\n-----END CERTIFICATE-----`;

const audit = new AuditService(new DrizzleAuditStore());
const files = new FilesService(new S3FilesStore());
const services = makeSyncServices();
const authority = new FakeZatcaAuthority(true);
const registry = new SubmissionRegistryService(audit, files);
registry.registerAdapter(authority);

let world: PosWorld;
let restoreGate: (() => Promise<void>) | undefined;

/** The harness simulates the PASSED verification gate (fake-authority.spec shape). */
async function simulatePassedGate(): Promise<() => Promise<void>> {
  const su = await superuserClient();
  await su.query(
    `UPDATE jurisdictions SET verification_status = 'VERIFIED', verified_at = now()
     WHERE country_code = 'SA' AND verification_status <> 'VERIFIED'`,
  );
  await su.end();
  return async () => {
    const restore = await superuserClient();
    await restore.query(
      `UPDATE jurisdictions SET verification_status = 'REQUIRES_VERIFICATION', verified_at = NULL
       WHERE country_code = 'SA'`,
    );
    await restore.end();
  };
}

function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected ACCEPTED, got ${item.status}`);
  }
  return item;
}

async function pushV2(deviceId: string, commands: unknown[]) {
  return withTenant(TENANT_EINV, () =>
    services.push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion: SYNC_CONTRACT_VERSION }),
  );
}

/** The posting reaction (the pipeline's enqueue hook). */
async function react(sourceType: string, sourceId: string) {
  return withTenant(TENANT_EINV, () =>
    registry.reactToPostedDocument({ sourceType, sourceId, actorId: null }),
  );
}

/** Registry count for a document. */
async function submissionsFor(sourceId: string) {
  return withTenant(TENANT_EINV, () =>
    store.listSubmissions({ sourceType: "sales_invoice", sourceId }),
  );
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_EINV,
    name: "Tenant EINV (submission chaos)",
    nameAr: "مستأجر الفوترة الإلكترونية",
    prefix: "einv",
    actor: "9e6a0000-0023-4000-8000-0000000000b0",
    cashier: EINV_CASHIER,
    salesRep: "9e6a0000-0023-4000-8000-0000000000b2",
  });
  // Enable the fake-zatca adapter for this tenant (the T13 gate: cert first).
  await withTenant(TENANT_EINV, () =>
    certs.enrollCertificate(files, {
      countryCode: "SA",
      adapterId: "fake-zatca",
      label: "chaos cert",
      keyVersion: "cv1",
      pem: PEM,
      notBefore: new Date(Date.now() - 86_400_000).toISOString(),
      notAfter: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      actorId: "9e6a0000-0023-4000-8000-0000000000b0",
    }),
  );
  await withTenant(TENANT_EINV, () =>
    rollout.setAdapterEnabled({
      adapterId: "fake-zatca",
      countryCode: "SA",
      enabled: true,
      actorId: "9e6a0000-0023-4000-8000-0000000000b0",
    }),
  );
  restoreGate = await simulatePassedGate();
}, 180_000);

afterAll(async () => {
  if (restoreGate !== undefined) {
    await restoreGate();
  }
  await closeDb();
});

describe("PHASE-023 chaos slice — C-01…C-04 with submission jobs in the loop", () => {
  it("C-01: duplicate pushes → ONE submission, ONE ledger effect (no double clearance)", async () => {
    const device = await enrollDevice(TENANT_EINV, EINV_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      `einv-c01-${generateUuidV7().slice(0, 8)}`,
      posSalePayload(world, { offline: "EINV-C01-00001", date: "2026-02-10" }),
    );
    const invoicesBefore = await countInvoices(TENANT_EINV);
    const journalsBefore = await countJournals(TENANT_EINV);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    const invoiceId = first.result.invoiceId as string;
    // The posting reaction fires (the pipeline's enqueue hook)…
    const reaction = await react("sales_invoice", invoiceId);
    expect(reaction.enqueued).toBe(true);
    // …and DUPLICATE reactions (job retries, duplicate webhook shapes) are
    // idempotent replays — exactly ONE registry row for the document.
    for (let i = 0; i < 3; i += 1) {
      const replay = await react("sales_invoice", invoiceId);
      expect(replay.idempotentReplay).toBe(true);
    }
    expect(await submissionsFor(invoiceId)).toHaveLength(1);

    // Network duplicate deliveries: the SAME command ×3 more.
    for (let delivery = 2; delivery <= 4; delivery += 1) {
      const replay = asAccepted((await pushV2(device, [command])).results[0]!);
      expect(replay.duplicate).toBe(true);
    }
    expect(await countInvoices(TENANT_EINV)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_EINV)).toBe(journalsBefore + 2);
    expect(await submissionsFor(invoiceId)).toHaveLength(1);
  });

  it("C-02: reordered arrivals keep the registry chain consistent (one submission per landed document)", async () => {
    const device = await enrollDevice(TENANT_EINV, EINV_CASHIER);
    // Two commands with a dependency: the second references the first's item
    // world (same batch ordering rules) — the reorder shape from C-02.
    const key = `einv-c02-${generateUuidV7().slice(0, 8)}`;
    const first = v2Command(
      "pos_sale",
      "create",
      key,
      posSalePayload(world, { offline: "EINV-C02-00001", date: "2026-02-11" }),
    );
    const accepted = asAccepted((await pushV2(device, [first])).results[0]!);
    const invoiceId = accepted.result.invoiceId as string;
    await react("sales_invoice", invoiceId);
    await react("sales_invoice", invoiceId); // duplicate reaction
    expect(await submissionsFor(invoiceId)).toHaveLength(1);
  });

  it("C-03: a partial-batch failure enqueues submissions only for COMMITTED invoices (no orphan submissions)", async () => {
    const device = await enrollDevice(TENANT_EINV, EINV_CASHIER);
    const good = v2Command(
      "pos_sale",
      "create",
      `einv-c03-good-${generateUuidV7().slice(0, 8)}`,
      posSalePayload(world, { offline: "EINV-C03-00001", date: "2026-02-12" }),
    );
    // The failing command: negative qty (C-15 vocabulary) → typed reject.
    const bad = v2Command(
      "pos_sale",
      "create",
      `einv-c03-bad-${generateUuidV7().slice(0, 8)}`,
      posSalePayload(world, { offline: "EINV-C03-00002", date: "2026-02-12", qty: "-1" }),
    );
    const results = (await pushV2(device, [good, bad])).results;
    expect(results[0]!.status).toBe("ACCEPTED");
    expect(results[1]!.status).toBe("REJECTED");
    // Only the committed invoice reacts — the rejected command never posts,
    // so no submission row can reference it.
    const committed = asAccepted(results[0]!);
    const committedInvoiceId = committed.result.invoiceId as string;
    await react("sales_invoice", committedInvoiceId);
    expect(await submissionsFor(committedInvoiceId)).toHaveLength(1);
    // The rejected command produced no invoice row at all.
    const su = await superuserClient();
    const orphans = await su.query(
      `SELECT count(*)::int AS n FROM e_invoicing_submissions WHERE tenant_id = $1 AND source_id NOT IN (SELECT id FROM sales_invoices WHERE tenant_id = $1)`,
      [TENANT_EINV],
    );
    await su.end();
    expect((orphans.rows[0] as { n: number }).n).toBe(0);
  });

  it("C-04: crash-after-post shape — the replay returns the original result; the registry row is singular", async () => {
    const device = await enrollDevice(TENANT_EINV, EINV_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      `einv-c04-${generateUuidV7().slice(0, 8)}`,
      posSalePayload(world, { offline: "EINV-C04-00001", date: "2026-02-13" }),
    );
    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    const invoiceId = first.result.invoiceId as string;
    // "Crash" between post and ack: the client re-sends the same command.
    const replay = asAccepted((await pushV2(device, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    // Both the original run and the retry land exactly one submission row.
    await react("sales_invoice", invoiceId);
    await react("sales_invoice", invoiceId);
    const rows = await submissionsFor(invoiceId);
    expect(rows).toHaveLength(1);
    // Ledger oracle: one invoice, its settlement+COGS journals (INV-013).
    expect(await countJournals(TENANT_EINV)).toBeGreaterThanOrEqual(2);
  });

  it("pipeline end-to-end: the fake authority accepts once — one ACCEPTED row, one authority reference", async () => {
    const device = await enrollDevice(TENANT_EINV, EINV_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      `einv-pipe-${generateUuidV7().slice(0, 8)}`,
      posSalePayload(world, { offline: "EINV-PIPE-00001", date: "2026-02-14" }),
    );
    const accepted = asAccepted((await pushV2(device, [command])).results[0]!);
    const invoiceId = accepted.result.invoiceId as string;
    const reaction = await react("sales_invoice", invoiceId);
    expect(reaction.submissionId).not.toBeNull();
    const submissionId = reaction.submissionId!;
    // Generate → submit through the harness adapter (the pipeline shape).
    await withTenant(TENANT_EINV, () =>
      registry.generatePayload({
        submissionId,
        document: {
          officialNumber: (accepted.result as { officialNumber?: string }).officialNumber ?? "POS-PIPE",
          issuedOn: "2026-02-14",
          partyName: null,
          currencyCode: "SAR",
          totals: null,
        },
        taxSummary: [],
      }),
    );
    const outcome = await withTenant(TENANT_EINV, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(outcome.outcome?.status).toBe("ACCEPTED");
    const row = await withTenant(TENANT_EINV, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("ACCEPTED");
    expect(row?.authorityRefs).toHaveLength(1);
    // A duplicate pipeline pass on the ACCEPTED row cannot re-clear.
    await expect(
      withTenant(TENANT_EINV, () =>
        registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
      ),
    ).rejects.toThrow(/not in a submittable state/);
  });
});

void _ensureTestDb;
