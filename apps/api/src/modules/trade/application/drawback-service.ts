import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";

import * as store from "../infrastructure/trade.store";
// PHASE-052 (W-44, dated 2026-11-27): the workflow gateway — the
// documented plain-function contract (the trade-order-gate pattern:
// zero module coupling; the engine binds at boot, unbound = the legacy
// path byte-identical).
import {
  onDocumentSubmitted,
  recordApprovalThroughChain,
  recordRejectionThroughChain,
} from "../../workflow/infrastructure/workflow-gateway";
import {
  drawbackEvidenceSatisfied,
  isExportDeclarationType,
  nextDrawbackMove,
} from "../domain/drawback-fold";
import {
  DrawbackClaimDuplicateError,
  DrawbackClaimRecordNotFoundError,
  DrawbackClaimStateError,
  DrawbackEvidenceRequiredError,
  TradeInputInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-38 — T-12, 2026-11-25) THE DRAWBACK ENGINE (L-12 —
 * BR-108, D-12): the duty_drawback_claims register's workflow — create
 * → link the export evidence → submit → review → approve | reject →
 * pay.
 *
 *   THE EXPORT-EVIDENCE GATE (BR-108 — D-12's own wording): the
 *   claim's submission REQUIRES the linked export evidence — the
 *   export declaration (an EXPORT-type declaration, verified at the
 *   link act: an IMPORT or TRANSIT declaration is not proof of export)
 *   OR the export bill of lading (the transport register's own row);
 *   the typed DRAWBACK_EVIDENCE_REQUIRED refusal names the claim + the
 *   missing evidence. The links ride the DRAFT rung ONLY (the fold's
 *   own law — once submitted, the proof of export is the customs
 *   authority's own record).
 *
 *   THE WORKFLOW (the 0121 §5 stamp law's fold VERBATIM): DRAFT →
 *   SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED; APPROVED → PAID.
 *   Every rung is ONE guarded statement (the status pins the
 *   from-state, the stamp lands in the SAME statement, zero rows = the
 *   raced/stale move — the typed refusal). REJECTED and PAID are
 *   terminal: the register is the audit trail — S/I/U, NO DELETE.
 *
 *   THE HONEST NO-GL SHAPE (D-12 — the non-ledger-document law, the
 *   050 note-20 pattern): the claim itself carries NO GL entry BY
 *   DESIGN — the workflow records the claimed amounts and the status
 *   ladder only; the refund money lands when treasury records it (the
 *   honest boundary, 053's surface). The `pay` act is a registry
 *   stamp, NEVER a posting — no journal column exists on the register
 *   (the 0121 §5 floor's own comment).
 *
 *   THE CLAIMED AMOUNTS (the tenant's OWN figures — the
 *   no-hardcoded-rates law's own family): the claimed amount is the
 *   claimant's own declaration to the customs authority (> 0, the
 *   0121 §5 floor); the currency is the claim's own ISO-4217 figure.
 *   The engine never computes, never invents, never re-derives a
 *   refund figure (the drawback computation discipline lives with the
 *   jurisdiction packs — REQUIRES_VERIFICATION, D-16's own law).
 */
const DBK_NUMBER_FORMAT = { prefix: "DBK", format: "DBK-{YYYY}-{SEQ:6}", docType: "duty_drawback_claim" };

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TradeInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class DrawbackService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  // ── the reads ─────────────────────────────────────────────────────────

  async list(filter: { status?: string }) {
    return store.listDrawbackClaims({ ...filter, limit: 200 });
  }

  async find(id: string) {
    const row = await store.findDrawbackClaimById(requireUuid(id, "id"));
    if (row === undefined) {
      throw new DrawbackClaimRecordNotFoundError({ claimId: id });
    }
    return row;
  }

  // ── the create act (the DRAFT claim) ──────────────────────────────────

  async create(input: {
    exportDeclarationId?: string | null;
    exportBillOfLadingId?: string | null;
    claimedAmount: string;
    currency: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.DrawbackClaimRow> {
    const amount = new Decimal(input.claimedAmount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new TradeInputInvalidError({
        field: "claimedAmount",
        reason: `a positive finite decimal figure is required (the claimant's own declaration to the customs authority), got "${input.claimedAmount}"`,
      });
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new TradeInputInvalidError({
        field: "currency",
        reason: `an ISO-4217 code is required, got "${input.currency}"`,
      });
    }
    const declarationId = input.exportDeclarationId ?? null;
    const blId = input.exportBillOfLadingId ?? null;
    if (declarationId === null && blId === null && (input.note === undefined || input.note === null)) {
      // A claim with neither evidence link nor a note naming the
      // claim's subject is refused — the honest floor (the evidence
      // links ride the link act; a bare claim carries its subject).
      throw new TradeInputInvalidError({
        field: "note",
        reason:
          "a claim with no export evidence link carries a note naming its subject (the evidence links may land at the link act while DRAFT — BR-108's gate fires at the submission)",
      });
    }
    if (declarationId !== null) {
      await this.verifyExportDeclaration(declarationId);
    }
    if (blId !== null) {
      const bl = await store.findBlById(requireUuid(blId, "exportBillOfLadingId"));
      if (bl === undefined) {
        throw new TradeInputInvalidError({
          field: "exportBillOfLadingId",
          reason: `the bill of lading ${blId} does not exist (the transport register's own row — the claim's proof of export)`,
        });
      }
    }
    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: DBK_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: DBK_NUMBER_FORMAT.format,
      prefix: DBK_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findDrawbackClaimByNo(acquired.number)) !== undefined) {
      throw new DrawbackClaimDuplicateError({ claimNo: acquired.number });
    }
    const row = await store.insertDrawbackClaim({
      claimNo: acquired.number,
      exportDeclarationId: declarationId,
      exportBillOfLadingId: blId,
      claimedAmount: amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      currency: input.currency,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.drawback_claim_created",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { claimNo: row.claimNo, claimedAmount: row.claimedAmount, currency: row.currency },
    });
    return row;
  }

  // ── the evidence link act (the DRAFT-only rung) ────────────────────────

  async linkEvidence(input: {
    id: string;
    exportDeclarationId?: string | null;
    exportBillOfLadingId?: string | null;
    actorId: string | null;
  }): Promise<store.DrawbackClaimRow> {
    const row = await store.findDrawbackClaimById(requireUuid(input.id, "id"));
    if (row === undefined) {
      throw new DrawbackClaimRecordNotFoundError({ claimId: input.id });
    }
    const verdict = nextDrawbackMove(row.status as "DRAFT", "link");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "DRAFT",
        reason: verdict.reason!,
      });
    }
    if (input.exportDeclarationId !== undefined && input.exportDeclarationId !== null) {
      await this.verifyExportDeclaration(input.exportDeclarationId);
    }
    if (input.exportBillOfLadingId !== undefined && input.exportBillOfLadingId !== null) {
      const bl = await store.findBlById(requireUuid(input.exportBillOfLadingId, "exportBillOfLadingId"));
      if (bl === undefined) {
        throw new TradeInputInvalidError({
          field: "exportBillOfLadingId",
          reason: `the bill of lading ${input.exportBillOfLadingId} does not exist (the transport register's own row — the claim's proof of export)`,
        });
      }
    }
    const linked = await store.linkDrawbackEvidence({
      id: row.id,
      exportDeclarationId: input.exportDeclarationId ?? null,
      exportBillOfLadingId: input.exportBillOfLadingId ?? null,
    });
    if (linked === undefined) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "DRAFT",
        reason: "the evidence link raced — the claim left the DRAFT rung underfoot",
      });
    }
    await this.audit.record({
      action: "trade.drawback_evidence_linked",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        claimNo: row.claimNo,
        exportDeclarationId: input.exportDeclarationId ?? null,
        exportBillOfLadingId: input.exportBillOfLadingId ?? null,
      },
    });
    return linked;
  }

  // ── the workflow acts (the ladder's own CAS statements) ───────────────

  /** THE SUBMISSION (BR-108's gate): the export-evidence refusal fires
   * BEFORE the rung moves — the typed verdict names the claim + the
   * missing evidence; ZERO residue (the claim stays DRAFT, nothing
   * moves). */
  async submit(input: { id: string; actorId: string | null }): Promise<store.DrawbackClaimRow> {
    const row = await this.requireClaim(input.id);
    const verdict = nextDrawbackMove(row.status as "DRAFT", "submit");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "SUBMITTED",
        reason: verdict.reason!,
      });
    }
    const evidence = drawbackEvidenceSatisfied({
      exportDeclarationId: row.exportDeclarationId,
      exportBillOfLadingId: row.exportBillOfLadingId,
    });
    if (!evidence.satisfied) {
      throw new DrawbackEvidenceRequiredError({ claimNo: row.claimNo });
    }
    const stamped = await store.stampDrawbackSubmitted(row.id);
    if (stamped === undefined) {
      throw this.raced(row, "SUBMITTED");
    }
    await this.audit.record({
      action: "trade.drawback_claim_submitted",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { claimNo: row.claimNo, status: "SUBMITTED" },
    });
    // PHASE-052 (W-44): the workflow chain opens AFTER the module's own
    // submit transition (the vocabulary mapping law — SUBMITTED is the
    // drawback claim's own submit-transition status, the register's own
    // ready-made ladder); an unresolvable chain (a typed refusal)
    // surfaces — a chain that cannot open NEVER silently ungates the
    // document.
    await onDocumentSubmitted({
      triggerEntity: "duty_drawback_claim",
      documentId: row.id,
      actorId: input.actorId,
    });
    return stamped;
  }

  async review(input: { id: string; actorId: string | null }): Promise<store.DrawbackClaimRow> {
    const row = await this.requireClaim(input.id);
    const verdict = nextDrawbackMove(row.status as "DRAFT", "review");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "UNDER_REVIEW",
        reason: verdict.reason!,
      });
    }
    const stamped = await store.stampDrawbackUnderReview(row.id);
    if (stamped === undefined) {
      throw this.raced(row, "UNDER_REVIEW");
    }
    await this.audit.record({
      action: "trade.drawback_claim_reviewed",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { claimNo: row.claimNo, status: "UNDER_REVIEW" },
    });
    return stamped;
  }

  async approve(input: { id: string; actorId: string | null }): Promise<store.DrawbackClaimRow> {
    const row = await this.requireClaim(input.id);
    const verdict = nextDrawbackMove(row.status as "DRAFT", "approve");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "APPROVED",
        reason: verdict.reason!,
      });
    }
    // PHASE-052 (W-44): THE CHAIN GATE FIRST — with a live chain the
    // approval routes INTO the current step (the actor must be its
    // assignee); a mid-chain approval takes the typed
    // WORKFLOW_CHAIN_STEPS_REMAIN refusal (the approval landed on the
    // chain; the claim's own verdict is not yet due); the legacy ladder
    // below runs only when the chain just completed or no chain exists
    // (the compatibility mode — byte-identical).
    await recordApprovalThroughChain({
      triggerEntity: "duty_drawback_claim",
      documentId: row.id,
      actorId: input.actorId,
    });
    const stamped = await store.stampDrawbackApproved(row.id);
    if (stamped === undefined) {
      throw this.raced(row, "APPROVED");
    }
    await this.audit.record({
      action: "trade.drawback_claim_approved",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { claimNo: row.claimNo, status: "APPROVED", claimedAmount: row.claimedAmount },
    });
    return stamped;
  }

  async reject(input: { id: string; actorId: string | null }): Promise<store.DrawbackClaimRow> {
    const row = await this.requireClaim(input.id);
    const verdict = nextDrawbackMove(row.status as "DRAFT", "reject");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "REJECTED",
        reason: verdict.reason!,
      });
    }
    // PHASE-052 (W-44): THE CHAIN GATE FIRST — with a live chain the
    // rejection routes INTO the current step (the actor must be its
    // assignee), the chain COMPLETES (a rejection is a terminal
    // verdict), and the module's own rejection proceeds; no chain =
    // the legacy path byte-identical.
    await recordRejectionThroughChain({
      triggerEntity: "duty_drawback_claim",
      documentId: row.id,
      actorId: input.actorId,
    });
    const stamped = await store.stampDrawbackRejected(row.id);
    if (stamped === undefined) {
      throw this.raced(row, "REJECTED");
    }
    await this.audit.record({
      action: "trade.drawback_claim_rejected",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { claimNo: row.claimNo, status: "REJECTED" },
    });
    return stamped;
  }

  /** THE PAY RUNG (the honest no-GL shape — D-12): a registry stamp
   * ONLY — the refund money lands when treasury records it (053's
   * surface); NO journal, NO cash movement, by design. */
  async pay(input: { id: string; actorId: string | null }): Promise<store.DrawbackClaimRow> {
    const row = await this.requireClaim(input.id);
    const verdict = nextDrawbackMove(row.status as "DRAFT", "pay");
    if (!verdict.allowed) {
      throw new DrawbackClaimStateError({
        claimId: row.id,
        claimNo: row.claimNo,
        from: row.status,
        to: "PAID",
        reason: verdict.reason!,
      });
    }
    const stamped = await store.stampDrawbackPaid(row.id);
    if (stamped === undefined) {
      throw this.raced(row, "PAID");
    }
    await this.audit.record({
      action: "trade.drawback_claim_paid",
      entityType: "duty_drawback_claims",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        claimNo: row.claimNo,
        status: "PAID",
        claimedAmount: row.claimedAmount,
        noGlEntry: "BY DESIGN — the refund money lands when treasury records it (D-12, 053's surface)",
      },
    });
    return stamped;
  }

  // ── the private helpers ───────────────────────────────────────────────

  private async requireClaim(id: string): Promise<store.DrawbackClaimRow> {
    const row = await store.findDrawbackClaimById(requireUuid(id, "id"));
    if (row === undefined) {
      throw new DrawbackClaimRecordNotFoundError({ claimId: id });
    }
    return row;
  }

  private raced(row: store.DrawbackClaimRow, to: string): DrawbackClaimStateError {
    return new DrawbackClaimStateError({
      claimId: row.id,
      claimNo: row.claimNo,
      from: row.status,
      to,
      reason: `the move raced — the claim left the ${row.status} rung underfoot (the stamp law's own CAS verdict)`,
    });
  }

  /** THE EXPORT-TYPE LAW (the fold's verdict): only an EXPORT
   * declaration is proof of export — the typed refusal names the
   * declaration and its own type. */
  private async verifyExportDeclaration(declarationId: string): Promise<void> {
    const declaration = await store.findDeclarationById(requireUuid(declarationId, "exportDeclarationId"));
    if (declaration === undefined) {
      throw new TradeInputInvalidError({
        field: "exportDeclarationId",
        reason: `the declaration ${declarationId} does not exist (the customs register's own row — the claim's proof of export)`,
      });
    }
    if (!isExportDeclarationType(declaration.declarationType)) {
      throw new TradeInputInvalidError({
        field: "exportDeclarationId",
        reason: `the declaration ${declaration.declarationNo} is ${declaration.declarationType} — the drawback's evidence must be an EXPORT declaration (BR-108's own proof of export)`,
      });
    }
  }
}
