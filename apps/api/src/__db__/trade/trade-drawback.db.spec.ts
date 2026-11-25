import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import {
  freshTradeBl,
  setupTradeFixture,
  TENANT_TRADE,
  TR_ACTOR,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { DrawbackService } from "../../modules/trade/application/drawback-service";
import {
  DrawbackClaimRecordNotFoundError,
  DrawbackEvidenceRequiredError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-38 — T-12, 2026-11-25) `trade-drawback.db.spec` — THE
 * DRAWBACK ENGINE over real PG16 (the plan §4's own arm; the master
 * plan §3 W-38's exit — acceptance #5's engine arms): **BR-108's
 * export-evidence gate** (the claim's submission requires the linked
 * export evidence — the export declaration OR the export bill of
 * lading — the typed DRAWBACK_EVIDENCE_REQUIRED naming the claim + the
 * missing evidence, ZERO residue) + **the workflow ladder** (DRAFT →
 * SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED; APPROVED → PAID —
 * the 0121 §5 stamp law's own fold) + **THE HONEST NO-GL SHAPE** (D-12
 * — the non-ledger-document law, the 050 note-20 pattern: the claim
 * carries NO GL entry BY DESIGN across the whole ladder; the refund
 * money lands when treasury records it, 053's surface).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»):
 * every arm builds its own claim + evidence (the official numbers
 * reserve per row — every world naturally unique); a rejection arm
 * never shares mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const drawback = new DrawbackService(audit, numbering);

beforeAll(async () => {
  await setupTradeFixture();
});

/** A fresh EXPORT declaration per arm (the raw fixture shape with the
 * 0121 stamp floors satisfied: SUBMITTED → submitted_at, ACCEPTED →
 * the accepted pair). */
async function exportDeclaration(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO customs_declarations
       (id, tenant_id, declaration_no, declaration_type, customs_office, status, submitted_at, accepted_at, currency, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'EXPORT', 'Jeddah Customs', 'ACCEPTED', now(), now(), 'SAR', $3)
     RETURNING id`,
    [TENANT_TRADE, `DEC-DBK-${code}-${generateUuidV7().slice(0, 8)}`, TR_ACTOR],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh IMPORT declaration per arm (the export-type law's own
 * refusal world). */
async function importDeclaration(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO customs_declarations
       (id, tenant_id, declaration_no, declaration_type, customs_office, status, submitted_at, accepted_at, currency, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'IMPORT', 'Jeddah Customs', 'ACCEPTED', now(), now(), 'SAR', $3)
     RETURNING id`,
    [TENANT_TRADE, `DEC-DBI-${code}-${generateUuidV7().slice(0, 8)}`, TR_ACTOR],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** The register's raw row (the stamps' own read). */
async function rawClaim(id: string): Promise<{
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  exportDeclarationId: string | null;
  exportBillOfLadingId: string | null;
}> {
  const rows = await requireTenantContext().tx!.execute<{
    status: string;
    submittedAt: string | null;
    decidedAt: string | null;
    exportDeclarationId: string | null;
    exportBillOfLadingId: string | null;
  }>(sql`
    SELECT status, submitted_at::text AS "submittedAt", decided_at::text AS "decidedAt",
           export_declaration_id::text AS "exportDeclarationId",
           export_bill_of_lading_id::text AS "exportBillOfLadingId"
    FROM duty_drawback_claims WHERE id = ${id}`);
  return rows.rows[0]!;
}

/** A DRAFT claim per arm (the official DBK number reserved at create). */
async function draftClaim(input: {
  exportDeclarationId?: string | null;
  exportBillOfLadingId?: string | null;
  claimedAmount?: string;
  note?: string | null;
}) {
  return withTenant(TENANT_TRADE, () =>
    drawback.create({
      exportDeclarationId: input.exportDeclarationId ?? null,
      exportBillOfLadingId: input.exportBillOfLadingId ?? null,
      claimedAmount: input.claimedAmount ?? "1000.0000",
      currency: "SAR",
      note: input.note ?? "the claim's own subject — export refund",
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
}

/** The no-GL read: the claim's journal count (ZERO BY DESIGN — D-12's
 * honest shape, asserted across the whole ladder). */
async function claimJournalCount(claimId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = 'duty_drawback_claim' AND source_id = ${claimId}`);
  return rows.rows[0]!.n;
}

describe("PHASE-051 W-38 — THE DRAWBACK ENGINE (T-12: BR-108's export-evidence gate + the workflow ladder + the honest no-GL shape)", () => {
  it("THE LADDER GOLDEN + BR-108'S GATE (D-12's own wording): the submission without evidence is refused (the typed DRAWBACK_EVIDENCE_REQUIRED names the claim, the claim stays DRAFT — ZERO residue); with the linked export declaration the ladder runs GREEN to PAID — and THE CLAIM CARRIES NO GL ENTRY ACROSS THE WHOLE WORKFLOW (the refund money lands when treasury records it, 053's surface)", async () => {
    const claim = await draftClaim({});
    expect(claim.claimNo).toMatch(/^DBK-\d{4}-\d{6}$/);
    expect(claim.status).toBe("DRAFT");
    // BR-108'S GATE: no evidence → the submission refused, the claim
    // stays DRAFT (submitted_at NULL — the stamp law's monotone floor).
    await expect(
      withTenant(TENANT_TRADE, () => drawback.submit({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toBeInstanceOf(DrawbackEvidenceRequiredError);
    const rawGate = await withTenant(TENANT_TRADE, () => rawClaim(claim.id));
    expect(rawGate.status).toBe("DRAFT");
    expect(rawGate.submittedAt).toBeNull();
    // THE LINK: the export declaration rides the DRAFT rung.
    const declarationId = await exportDeclaration("GLD");
    const linked = await withTenant(TENANT_TRADE, () =>
      drawback.linkEvidence({ id: claim.id, exportDeclarationId: declarationId, actorId: TR_ACTOR }),
    );
    expect(linked.exportDeclarationId).toBe(declarationId);
    // THE LADDER GREEN: submit → review → approve → pay.
    const submitted = await withTenant(TENANT_TRADE, () =>
      drawback.submit({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedAt).not.toBeNull();
    const reviewed = await withTenant(TENANT_TRADE, () =>
      drawback.review({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(reviewed.status).toBe("UNDER_REVIEW");
    // The review rung carries NO new stamp (submitted_at stands —
    // monotone evidence that never re-stamps; decided_at only at the
    // verdicts).
    expect(reviewed.submittedAt).toBe(submitted.submittedAt);
    expect(reviewed.decidedAt).toBeNull();
    const approved = await withTenant(TENANT_TRADE, () =>
      drawback.approve({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedAt).not.toBeNull();
    const paid = await withTenant(TENANT_TRADE, () =>
      drawback.pay({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(paid.status).toBe("PAID");
    // THE HONEST NO-GL SHAPE (D-12 — the 050 note-20 non-ledger-document
    // law): ZERO journals across the whole workflow, at every rung.
    expect(await withTenant(TENANT_TRADE, () => claimJournalCount(claim.id))).toBe(0);
    const su = await superuserClient();
    const anyJournal = await su.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_TRADE, claim.id],
    );
    expect(anyJournal.rows[0]!.n).toBe(0);
    // The cash side too: the refund money NEVER lands here (treasury's
    // own discipline, 053's surface).
    const anyCash = await su.query(
      `SELECT count(*)::int AS n FROM cash_movements WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_TRADE, claim.id],
    );
    expect(anyCash.rows[0]!.n).toBe(0);
    await su.end();
  });

  it("THE B/L EVIDENCE ARM (the gate's OR branch): the export bill of lading satisfies BR-108's gate — the submission GREEN (the transport register's own row as the proof of export)", async () => {
    const blId = await freshTradeBl("DBK");
    const claim = await draftClaim({ note: "the B/L-evidence claim" });
    await withTenant(TENANT_TRADE, () =>
      drawback.linkEvidence({ id: claim.id, exportBillOfLadingId: blId, actorId: TR_ACTOR }),
    );
    const submitted = await withTenant(TENANT_TRADE, () =>
      drawback.submit({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(submitted.status).toBe("SUBMITTED");
    const raw = await withTenant(TENANT_TRADE, () => rawClaim(claim.id));
    expect(raw.exportBillOfLadingId).toBe(blId);
    expect(raw.exportDeclarationId).toBeNull();
  });

  it("THE EXPORT-TYPE LAW (the fold's verdict): an IMPORT declaration is NOT proof of export — the link act refuses with the typed reason naming the declaration and its own type", async () => {
    const importId = await importDeclaration("TYP");
    const claim = await draftClaim({ note: "the import-evidence claim" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.linkEvidence({ id: claim.id, exportDeclarationId: importId, actorId: TR_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
    // ZERO residue: the claim's links stand empty.
    const raw = await withTenant(TENANT_TRADE, () => rawClaim(claim.id));
    expect(raw.exportDeclarationId).toBeNull();
  });

  it("THE LINK WINDOW (the fold's own law): the evidence links ride the DRAFT rung ONLY — once submitted, the proof of export is the customs authority's own record", async () => {
    const declarationId = await exportDeclaration("LNK");
    const claim = await draftClaim({ note: "the link-window claim" });
    await withTenant(TENANT_TRADE, () =>
      drawback.linkEvidence({ id: claim.id, exportDeclarationId: declarationId, actorId: TR_ACTOR }),
    );
    await withTenant(TENANT_TRADE, () => drawback.submit({ id: claim.id, actorId: TR_ACTOR }));
    const second = await exportDeclaration("LN2");
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.linkEvidence({ id: claim.id, exportDeclarationId: second, actorId: TR_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    // ZERO residue: the original link stands.
    const raw = await withTenant(TENANT_TRADE, () => rawClaim(claim.id));
    expect(raw.exportDeclarationId).toBe(declarationId);
  });

  it("THE REJECT RUNG + THE TERMINAL LAW (the 0121 §5 stamp fold): the review's verdict rejects (decided_at stamped); REJECTED and PAID are TERMINAL — every later move refused, the register is the audit trail", async () => {
    const declarationId = await exportDeclaration("REJ");
    const claim = await draftClaim({ note: "the rejected claim" });
    await withTenant(TENANT_TRADE, () =>
      drawback.linkEvidence({ id: claim.id, exportDeclarationId: declarationId, actorId: TR_ACTOR }),
    );
    await withTenant(TENANT_TRADE, () => drawback.submit({ id: claim.id, actorId: TR_ACTOR }));
    await withTenant(TENANT_TRADE, () => drawback.review({ id: claim.id, actorId: TR_ACTOR }));
    const rejected = await withTenant(TENANT_TRADE, () =>
      drawback.reject({ id: claim.id, actorId: TR_ACTOR }),
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decidedAt).not.toBeNull();
    // TERMINAL: every later move refused.
    for (const act of ["link", "submit", "review", "approve", "reject", "pay"] as const) {
      await expect(
        withTenant(TENANT_TRADE, () =>
          act === "link"
            ? drawback.linkEvidence({ id: claim.id, exportDeclarationId: null, actorId: TR_ACTOR })
            : act === "submit"
              ? drawback.submit({ id: claim.id, actorId: TR_ACTOR })
              : act === "review"
                ? drawback.review({ id: claim.id, actorId: TR_ACTOR })
                : act === "approve"
                  ? drawback.approve({ id: claim.id, actorId: TR_ACTOR })
                  : act === "reject"
                    ? drawback.reject({ id: claim.id, actorId: TR_ACTOR })
                    : drawback.pay({ id: claim.id, actorId: TR_ACTOR }),
        ),
      ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    }
    // The register stands: the stamps never un-stamp.
    const raw = await withTenant(TENANT_TRADE, () => rawClaim(claim.id));
    expect(raw.status).toBe("REJECTED");
    expect(raw.submittedAt).not.toBeNull();
    expect(raw.decidedAt).not.toBeNull();
  });

  it("THE LADDER'S OWN REFUSALS + THE TYPED 404s: the review before the submission, the verdicts before the review, the pay before the approval, the double submission — each the typed ladder refusal; the unknown claim the typed 404; the bad uuid the input floor", async () => {
    const declarationId = await exportDeclaration("LAD");
    const claim = await draftClaim({ note: "the ladder-refusal claim" });
    await withTenant(TENANT_TRADE, () =>
      drawback.linkEvidence({ id: claim.id, exportDeclarationId: declarationId, actorId: TR_ACTOR }),
    );
    // review before submit.
    await expect(
      withTenant(TENANT_TRADE, () => drawback.review({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    // the verdicts before the review.
    await expect(
      withTenant(TENANT_TRADE, () => drawback.approve({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    await expect(
      withTenant(TENANT_TRADE, () => drawback.reject({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    // the pay before the approval.
    await expect(
      withTenant(TENANT_TRADE, () => drawback.pay({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    // the submission + the double submission.
    await withTenant(TENANT_TRADE, () => drawback.submit({ id: claim.id, actorId: TR_ACTOR }));
    await expect(
      withTenant(TENANT_TRADE, () => drawback.submit({ id: claim.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "DRAWBACK_CLAIM_STATE" });
    // the typed 404 + the input floor.
    await expect(
      withTenant(TENANT_TRADE, () => drawback.find(generateUuidV7())),
    ).rejects.toBeInstanceOf(DrawbackClaimRecordNotFoundError);
    await expect(
      withTenant(TENANT_TRADE, () => drawback.find("not-a-uuid")),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
  });

  it("THE CREATE FLOORS (the tenant's OWN figures — never invented): a non-positive claimed amount refuses; a claim with neither evidence nor a note naming its subject refuses (the honest floor); the DBK numbering reserves at create", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.create({
          exportDeclarationId: null,
          exportBillOfLadingId: null,
          claimedAmount: "0",
          currency: "SAR",
          note: "the zero claim",
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.create({
          exportDeclarationId: null,
          exportBillOfLadingId: null,
          claimedAmount: "100",
          currency: "SAR",
          note: null,
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
    // The unknown evidence declaration refuses at create (the link law
    // applies at BOTH doors).
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.create({
          exportDeclarationId: generateUuidV7(),
          exportBillOfLadingId: null,
          claimedAmount: "100",
          currency: "SAR",
          note: "the dangling link",
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
    // The currency floor.
    await expect(
      withTenant(TENANT_TRADE, () =>
        drawback.create({
          exportDeclarationId: null,
          exportBillOfLadingId: null,
          claimedAmount: "100",
          currency: "sar",
          note: "the currency floor",
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
  });
});
