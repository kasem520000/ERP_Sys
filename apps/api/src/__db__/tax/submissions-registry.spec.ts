import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../modules/files/api/files";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import {
  SubmissionRegistryService,
} from "../../modules/tax/submissions/registry-service";
import {
  assertLegalTransition,
  backoffDelayMs,
  isDeadLetter,
  isLegalTransition,
  RETRY_MAX_ATTEMPTS,
  type SubmissionStatus,
} from "../../modules/tax/submissions/state-machine";
import * as store from "../../modules/tax/submissions/store";
import { ZatcaUnverifiedStubAdapter, ZATCA_UNMET_GATE_ITEMS } from "../../modules/tax/adapters/zatca/zatca-stub";
import { sealArtifact, openArtifact } from "../../modules/tax/submissions/secret-artifact";
import { generateUuidV7 } from "@erp/domain-core";
import { setupPackTenant, X_ACTOR, type PackTenant } from "./fixtures";

/**
 * PHASE-023 T1/T2/T4 verification (phase §6): the registry state machine
 * accepts ONLY legal transitions; encrypted payload/response storage works
 * end to end (seal → files → read → open); the ZATCA stub refuses every
 * regulated action with the explicit UNVERIFIED error naming the unmet
 * gate items (the no-fabrication proof); duplicate enqueues dedupe via the
 * registry (no double clearance); retry/dead-letter policy is deterministic.
 */

const audit = new AuditService(new DrizzleAuditStore());
const files = new FilesService(new S3FilesStore());

let tenant: PackTenant;
let registry: SubmissionRegistryService;
let sourceId: string;

beforeAll(async () => {
  tenant = await setupPackTenant("SA");
  registry = new SubmissionRegistryService(audit, files);
  sourceId = generateUuidV7();
});

describe("state machine — legal transitions only (E_INVOICING §2)", () => {
  it("accepts the documented happy lifecycle", () => {
    expect(isLegalTransition("PENDING", "GENERATED")).toBe(true);
    expect(isLegalTransition("GENERATED", "SIGNED")).toBe(true);
    expect(isLegalTransition("GENERATED", "SUBMITTED")).toBe(true);
    expect(isLegalTransition("SIGNED", "SUBMITTED")).toBe(true);
    expect(isLegalTransition("SUBMITTED", "ACCEPTED")).toBe(true);
    expect(isLegalTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(isLegalTransition("ACCEPTED", "REPORTED")).toBe(true);
  });

  it("rejects every illegal hop with the legal set named", () => {
    const verdict = assertLegalTransition("PENDING", "ACCEPTED");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.from).toBe("PENDING");
      expect(verdict.attempted).toBe("ACCEPTED");
      expect(verdict.legal).toEqual(["PENDING", "GENERATED", "FAILED"]);
    }
    expect(isLegalTransition("REJECTED", "SUBMITTED")).toBe(false);
    expect(isLegalTransition("FAILED", "PENDING")).toBe(false);
    expect(isLegalTransition("REPORTED", "ACCEPTED")).toBe(false);
    expect(isLegalTransition("ACCEPTED", "PENDING")).toBe(false);
  });

  it("backoff is exponential and capped; dead-letter at the cap", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(20)).toBe(30 * 60_000);
    expect(isDeadLetter(RETRY_MAX_ATTEMPTS - 1)).toBe(false);
    expect(isDeadLetter(RETRY_MAX_ATTEMPTS)).toBe(true);
  });
});

describe("registry idempotency — no double clearance", () => {
  it("duplicate enqueue for the same document × adapter returns the SAME row", async () => {
    const first = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "zatca",
        sourceType: "sales_invoice",
        sourceId,
        payloadDigest: "sha256-test",
        actorId: X_ACTOR,
      }),
    );
    expect(first.idempotentReplay).toBe(false);
    const second = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "zatca",
        sourceType: "sales_invoice",
        sourceId,
        payloadDigest: "sha256-test",
        actorId: X_ACTOR,
      }),
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    const all = await withTenant(tenant.tenantId, () =>
      store.listSubmissions({ sourceType: "sales_invoice", sourceId }),
    );
    expect(all).toHaveLength(1);
  });

  it("a second adapter may submit the same document (1:N per adapter)", async () => {
    const other = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "fake-zatca",
        sourceType: "sales_invoice",
        sourceId,
        payloadDigest: null,
        actorId: X_ACTOR,
      }),
    );
    expect(other.idempotentReplay).toBe(false);
    expect(other.row.adapterId).toBe("fake-zatca");
  });
});

describe("transition discipline — illegal moves rejected at the store", () => {
  it("a PENDING row cannot jump to ACCEPTED", async () => {
    const row = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "zatca",
        sourceType: "sales_invoice",
        sourceId: generateUuidV7(),
        payloadDigest: null,
        actorId: X_ACTOR,
      }),
    );
    await expect(
      withTenant(tenant.tenantId, () =>
        store.transitionSubmission({ id: row.row.id, to: "ACCEPTED" as SubmissionStatus }),
      ),
    ).rejects.toThrow(/illegal registry transition PENDING → ACCEPTED/);
  });
});

describe("encrypted artifacts — seal → files → read → open (E_INVOICING §6)", () => {
  it("round-trips a payload through the sealed envelope", () => {
    const plaintext = Buffer.from(JSON.stringify({ kind: "erp.compliance-archive.v1" }), "utf8");
    const sealed = sealArtifact(plaintext);
    expect(sealed.equals(plaintext)).toBe(false);
    expect(openArtifact(sealed).toString("utf8")).toBe(plaintext.toString("utf8"));
  });

  it("tampered ciphertext fails authentication (GCM tag)", () => {
    const sealed = sealArtifact(Buffer.from("secret-payload"));
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 0xff;
    expect(() => openArtifact(sealed)).toThrow();
  });

  it("the payload builder output is stored encrypted at rest (read-back verifies)", async () => {
    const row = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "fake-zatca",
        sourceType: "sales_invoice",
        sourceId: generateUuidV7(),
        payloadDigest: null,
        actorId: X_ACTOR,
      }),
    );
    const generated = await withTenant(tenant.tenantId, () =>
      registry.generatePayload({
        submissionId: row.row.id,
        document: {
          officialNumber: "INV-2026-0001",
          issuedOn: "2026-11-06",
          partyName: "شركة اختبار",
          currencyCode: "SAR",
          totals: { net: "100.0000", tax: "15.0000", gross: "115.0000" },
        },
        taxSummary: [
          {
            direction: "OUTPUT",
            treatment: "STANDARD_RATED",
            rate: "15",
            taxableBase: "100.0000",
            taxAmount: "15.0000",
          },
        ],
      }),
    );
    expect(generated.status).toBe("GENERATED");
    expect(generated.payloadFileId).not.toBeNull();
    // The file row exists with the EINVOICE_PAYLOAD owner + octet-stream.
    const key = await withTenant(tenant.tenantId, async () => {
      const { registerArtifactFile } = await import("../../modules/tax/submissions/artifact-files");
      void registerArtifactFile;
      const tx = (await import("../../infra/db/tenant-context")).requireTenantContext();
      const rows = await tx.tx!.execute(
        (await import("drizzle-orm")).sql`
          SELECT storage_key AS key, content_type AS ct FROM file_objects WHERE id = ${generated.payloadFileId}
        `,
      );
      return (rows.rows as unknown as { key: string; ct: string }[])[0]!;
    });
    expect(key!.ct).toBe("application/octet-stream");
    // The stored bytes decrypt to the compliance archive (encrypted at rest).
    const stored = await files.readObject(tenant.tenantId, key!.key);
    const opened = JSON.parse(openArtifact(stored.body).toString("utf8")) as {
      kind: string;
      authoritative: boolean;
    };
    expect(opened.kind).toBe("erp.compliance-archive.v1");
    expect(opened.authoritative).toBe(false); // non-authoritative by design (§5)
  });
});

describe("ZATCA stub — refuses every regulated action (T4, RISK-005)", () => {
  const stub = new ZatcaUnverifiedStubAdapter();

  it("declares itself unverified with SA-only scope", () => {
    expect(stub.regimeVerified).toBe(false);
    expect(stub.supportedCountries).toEqual(["SA"]);
  });

  it("submit returns the explicit UNVERIFIED refusal naming the gate items", async () => {
    const outcome = await stub.submit({
      countryCode: "SA",
      sourceType: "sales_invoice",
      sourceId: sourceId,
      document: {},
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("UNVERIFIED_REGIME");
    const error = outcome.error as { unmetGateItems: string[]; decisionRecord: string };
    expect(error.unmetGateItems).toHaveLength(ZATCA_UNMET_GATE_ITEMS.length);
    expect(error.unmetGateItems[0]).toContain("GATE-1");
    expect(error.decisionRecord).toContain("DR-001");
  });

  it("the registry service refuses BEFORE the adapter call and marks FAILED", async () => {
    const row = await withTenant(tenant.tenantId, () =>
      store.enqueueSubmission({
        countryCode: "SA",
        adapterId: "zatca",
        sourceType: "sales_invoice",
        sourceId: generateUuidV7(),
        payloadDigest: null,
        actorId: X_ACTOR,
      }),
    );
    // Drive to GENERATED first (the refusal path needs a payload).
    await withTenant(tenant.tenantId, () =>
      registry.generatePayload({
        submissionId: row.row.id,
        document: {
          officialNumber: "INV-2026-0002",
          issuedOn: "2026-11-06",
          partyName: null,
          currencyCode: "SAR",
          totals: null,
        },
        taxSummary: [],
      }),
    );
    const result = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId: row.row.id }),
    );
    expect(result.refused).toBe("UNVERIFIED_REGIME");
    const after = await withTenant(tenant.tenantId, () => store.findSubmission(row.row.id));
    expect(after?.status).toBe("FAILED");
    expect(after?.lastErrorCode).toBe("UNVERIFIED_REGIME");
  });
});
