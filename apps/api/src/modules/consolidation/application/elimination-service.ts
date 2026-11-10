import { Inject, Injectable } from "@nestjs/common";

import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { AuditService } from "../../audit/api/audit";
import { addExact, compareExact } from "../../accounting/application/decimal-strings";
import {
  EliminationAlreadyPostedError,
  EliminationNotApprovedError,
  EliminationNotFoundError,
  GroupNotActiveError,
  GroupNotFoundError,
  MemberNotInGroupError,
  SelfApprovalBlockedError,
} from "../domain/consolidation-errors";
import {
  buildReversalLines,
  parseEliminationLines,
  validateEliminationLines,
  type EliminationKind,
  type EliminationLine,
} from "./elimination-lines";
import {
  findEliminationById,
  findGroupById,
  findGroupMember,
  findOwnerPeriod,
  insertElimination,
  listEliminations,
  tenantBaseCurrency,
  updateElimination,
  type EliminationRow,
} from "../infrastructure/consolidation.store";
import { callReaderMemberArAp, type MemberArApRow } from "../infrastructure/consolidation.store";

/**
 * PHASE-034 T5 · the elimination service — DRAFT authoring over member-pair
 * lines (manual authoring by design, DR-006 option A: "elimination
 * authoring is real work"; the workspace SUGGESTS intercompany pairings
 * from the members' AR/AP subledgers via the audited reader — matching is
 * human-confirmed, the automatic matching engine is out of scope), the
 * §4 SoD approve gate (creator ≠ approver), and POST via
 * `PostingEngine.post` with source_type `CONSOLIDATION_ELIMINATION`
 * **in the parent tenant's consolidation books only** (G-32: DR AP_CONTROL
 * entity B intercompany · CR AR_CONTROL entity A intercompany;
 * investment/equity lines through the CONSOLIDATION_ADJUSTMENT purpose).
 *
 * Corrections are REVERSAL-ONLY counter-entries (BR-056): reverse() creates
 * a NEW DRAFT with every line's direction flipped, linked through
 * reversal_of — the original stays POSTED and immutable (INV-003). The
 * engine re-checks the parent's ordinary period rules on every post;
 * INV-006 chain + INV-013 idempotency apply like any journal
 * (source {docType: "consolidation_elimination", docId, operation: "post"}).
 *
 * ZERO member-ledger writes exist anywhere in this service — eliminations
 * land ONLY in the parent's books (ADR-0018; the INV-026 suite proves it
 * by byte-comparing member GL before/after).
 */

/** Official elimination numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention, docType consolidation_elimination). */
const ELIMINATION_NUMBER_FORMAT = {
  prefix: "EL",
  format: "EL-{YYYY}-{SEQ:6}",
  docType: "consolidation_elimination",
} as const;

@Injectable()
export class EliminationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async find(eliminationId: string): Promise<EliminationRow> {
    const row = await findEliminationById(eliminationId);
    if (row === undefined) throw new EliminationNotFoundError(eliminationId);
    return row;
  }

  async list(filter: {
    groupId?: string;
    fiscalPeriodId?: string;
    status?: string;
  }): Promise<EliminationRow[]> {
    return listEliminations(filter);
  }

  /**
   * Draft an elimination: validates the DRAFT body (balanced, the kind's
   * purposes, the member pair on INTERCOMPANY), the group (ACTIVE), the
   * parent's fiscal period, and the pair's membership — zero residue on
   * any typed rejection.
   */
  async createDraft(input: {
    groupId: string;
    fiscalPeriodId: string;
    kind: EliminationKind;
    description: string;
    memberATenantId?: string | null;
    memberBTenantId?: string | null;
    lines: readonly EliminationLine[];
    reversalOf?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<EliminationRow> {
    const group = await findGroupById(input.groupId);
    if (group === undefined) throw new GroupNotFoundError(input.groupId);
    if (group.status !== "ACTIVE") {
      throw new GroupNotActiveError({ groupId: input.groupId, status: group.status });
    }
    const period = await findOwnerPeriod(input.fiscalPeriodId);
    if (period === undefined) {
      // A7/S-04: foreign/unknown period ids are typed 404s before any write.
      throw new EliminationNotFoundError("(fiscal-period)");
    }
    if (input.kind === "INTERCOMPANY") {
      // Both pair members must be ACTIVE members of the group.
      for (const memberTenantId of [input.memberATenantId, input.memberBTenantId]) {
        if (memberTenantId == null) continue;
        const member = await findGroupMember(input.groupId, memberTenantId);
        if (member === undefined || member.status !== "ACTIVE") {
          throw new MemberNotInGroupError({
            groupId: input.groupId,
            memberTenantId,
          });
        }
      }
    }
    // The zero-residue failure pack (ENTRY_NOT_BALANCED / PURPOSE shape).
    validateEliminationLines({
      eliminationId: "(draft)",
      kind: input.kind,
      memberATenantId: input.memberATenantId ?? null,
      memberBTenantId: input.memberBTenantId ?? null,
      lines: input.lines,
    });
    const row = await insertElimination({
      groupId: input.groupId,
      fiscalPeriodId: input.fiscalPeriodId,
      kind: input.kind,
      description: input.description,
      memberATenantId: input.memberATenantId ?? null,
      memberBTenantId: input.memberBTenantId ?? null,
      lines: input.lines,
      reversalOf: input.reversalOf ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "consolidation.elimination.created",
      entityType: "elimination_entry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        groupId: input.groupId,
        fiscalPeriodId: input.fiscalPeriodId,
        kind: input.kind,
        lineCount: input.lines.length,
      },
    });
    return row;
  }

  /**
   * Update a DRAFT body (only while DRAFT — posted documents are immutable,
   * 409 IMMUTABLE_DOCUMENT).
   */
  async updateDraft(
    eliminationId: string,
    patch: { description?: string; lines?: readonly EliminationLine[]; note?: string | null; noteAr?: string | null },
    actorId: string | null,
  ): Promise<EliminationRow> {
    const row = await this.find(eliminationId);
    if (row.status !== "DRAFT") {
      throw new EliminationAlreadyPostedError({ eliminationId, status: row.status });
    }
    if (patch.lines !== undefined) {
      validateEliminationLines({
        eliminationId,
        kind: row.kind as EliminationKind,
        memberATenantId: row.memberATenantId,
        memberBTenantId: row.memberBTenantId,
        lines: patch.lines,
      });
    }
    const updated = await updateElimination(eliminationId, {
      description: patch.description,
      lines: patch.lines === undefined ? undefined : [...patch.lines],
      note: patch.note,
      noteAr: patch.noteAr,
    });
    if (updated === undefined) throw new EliminationNotFoundError(eliminationId);
    await this.audit.record({
      action: "consolidation.elimination.updated",
      entityType: "elimination_entry",
      entityId: eliminationId,
      actorId: actorId ?? undefined,
    });
    return updated;
  }

  /**
   * The §4 SoD approval gate: a SECOND user (the creator cannot approve —
   * SELF_APPROVAL_BLOCKED) approves the DRAFT before it may post.
   */
  async approve(eliminationId: string, actorId: string | null): Promise<EliminationRow> {
    const row = await this.find(eliminationId);
    if (row.status !== "DRAFT") {
      throw new EliminationAlreadyPostedError({ eliminationId, status: row.status });
    }
    if (actorId !== null && row.createdBy !== null && actorId === row.createdBy) {
      throw new SelfApprovalBlockedError({ eliminationId, actorId });
    }
    const updated = await updateElimination(eliminationId, {
      approvedBy: actorId,
      approvedAt: new Date().toISOString(),
    });
    if (updated === undefined) throw new EliminationNotFoundError(eliminationId);
    await this.audit.record({
      action: "consolidation.elimination.approved",
      entityType: "elimination_entry",
      entityId: eliminationId,
      actorId: actorId ?? undefined,
    });
    return updated;
  }

  /**
   * POST — the G-32 golden path: one balanced journal per elimination set
   * in the PARENT tenant's consolidation books (source
   * CONSOLIDATION_ELIMINATION; INV-006 chain; INV-013 idempotency per
   * source/operation; the engine's ordinary parent-period checks apply).
   * Assigns the official elimination_no (numbering service, INV-021).
   */
  async post(eliminationId: string, actorId: string | null): Promise<EliminationRow> {
    const row = await this.find(eliminationId);
    if (row.status !== "DRAFT") {
      throw new EliminationAlreadyPostedError({ eliminationId, status: row.status });
    }
    if (row.approvedBy === null || row.approvedAt === null) {
      // SoD backstop: the service re-checks even if the controller was
      // bypassed (defense in depth on the §4 row).
      throw new EliminationNotApprovedError({ eliminationId, status: row.status });
    }
    const lines = parseEliminationLines(row.lines);
    const totals = validateEliminationLines({
      eliminationId,
      kind: row.kind as EliminationKind,
      memberATenantId: row.memberATenantId,
      memberBTenantId: row.memberBTenantId,
      lines,
    });
    void totals;

    const period = await findOwnerPeriod(row.fiscalPeriodId);
    if (period === undefined) throw new EliminationNotFoundError("(fiscal-period)");
    const base = await tenantBaseCurrency();

    // The G-32 spec: lines ride their purposes (AR_CONTROL/AP_CONTROL on
    // INTERCOMPANY; CONSOLIDATION_ADJUSTMENT on INVESTMENT_EQUITY); the
    // member-pair provenance rides the bilingual memos; the parent's own
    // books take the entry (the ambient tenant IS the parent — never a
    // member scope is established anywhere in this flow).
    const specLines: JournalLineSpec[] = lines.map((line) => ({
      purpose: line.purposeKey,
      direction: line.direction,
      amount: line.amount,
      memo: {
        en: line.memoEn || `Elimination ${row.eliminationNo ?? row.id}`,
        ar: line.memoAr || `قيد استبعاد ${row.eliminationNo ?? row.id}`,
      },
    }));
    const spec: JournalSpec = {
      source: { docType: ELIMINATION_NUMBER_FORMAT.docType, docId: row.id, operation: "post" },
      entryDate: period.endDate,
      fiscalPeriodId: row.fiscalPeriodId,
      description: {
        en: `Consolidation elimination — ${row.description} (G-32, parent consolidation books)`,
        ar: `قيد استبعاد توحيد — ${row.description} (دفاتر التوحيد للشركة الأم)`,
      },
      currency: base,
      lines: specLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });

    // Official number at post (INV-021 — the disposal precedent).
    const year = period.endDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: ELIMINATION_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: ELIMINATION_NUMBER_FORMAT.format,
      prefix: ELIMINATION_NUMBER_FORMAT.prefix,
      year,
    });
    await this.numbering.bind(ELIMINATION_NUMBER_FORMAT.docType, acquired.number, row.id);

    const journalEntryIds = Array.isArray(row.journalEntryIds)
      ? (row.journalEntryIds as unknown[])
      : [];
    const updated = await updateElimination(eliminationId, {
      status: "POSTED",
      eliminationNo: acquired.number,
      postedAt: new Date().toISOString(),
      postedBy: actorId,
      journalEntryIds: [...journalEntryIds, result.journalEntryId],
    });
    if (updated === undefined) throw new EliminationNotFoundError(eliminationId);
    await this.audit.record({
      action: "consolidation.elimination.posted",
      entityType: "elimination_entry",
      entityId: eliminationId,
      actorId: actorId ?? undefined,
      after: {
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        eliminationNo: acquired.number,
        idempotentReplay: result.idempotentReplay,
        postedInto: "parent-consolidation-books",
      },
    });
    return updated;
  }

  /**
   * Reversal-only correction (BR-056): creates a NEW DRAFT counter-entry
   * (every direction flipped, linked through reversal_of). The caller then
   * approves + posts it like any elimination — a new audited DRAFT→POSTED
   * pair; the original stays POSTED (INV-003).
   */
  async reverse(input: {
    eliminationId: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<EliminationRow> {
    const original = await this.find(input.eliminationId);
    if (original.status !== "POSTED") {
      throw new EliminationNotApprovedError({
        eliminationId: input.eliminationId,
        status: original.status,
      });
    }
    const originalLines = parseEliminationLines(original.lines);
    const reversalLines = buildReversalLines(originalLines);
    return this.createDraft({
      groupId: original.groupId,
      fiscalPeriodId: original.fiscalPeriodId,
      kind: original.kind as EliminationKind,
      description: `Reversal — ${original.description}`,
      memberATenantId: original.memberATenantId,
      memberBTenantId: original.memberBTenantId,
      lines: reversalLines,
      reversalOf: original.id,
      note: input.note ?? original.note,
      noteAr: input.noteAr ?? original.noteAr,
      actorId: input.actorId,
    });
  }

  /**
   * Intercompany pairing SUGGESTIONS from the members' AR/AP subledgers
   * (the authoring workspace's surface — read through the audited reader;
   * human-confirmed; the automatic matching engine is out of scope).
   * Audited per read (the reader service's discipline).
   */
  async suggestIntercompanyPairs(input: {
    groupId: string;
    memberTenantId: string;
    asOf: string;
    actorId: string | null;
  }): Promise<MemberArApRow[]> {
    const group = await findGroupById(input.groupId);
    if (group === undefined) throw new GroupNotFoundError(input.groupId);
    const member = await findGroupMember(input.groupId, input.memberTenantId);
    if (member === undefined || member.status !== "ACTIVE") {
      throw new MemberNotInGroupError({
        groupId: input.groupId,
        memberTenantId: input.memberTenantId,
      });
    }
    // The read is audited at the reader seam (read-audit completeness).
    return callReaderMemberArAp(input.groupId, input.memberTenantId, input.asOf);
  }

  /** The live balanced DR/CR preview over a DRAFT body (the §4 workspace's
   * preview surface — pure, no writes; the UI recomputes locally too). */
  previewBalance(lines: readonly EliminationLine[]): { debitTotal: string; creditTotal: string; balanced: boolean } {
    let debit = "0.0000";
    let credit = "0.0000";
    for (const line of lines) {
      if (line.direction === "DEBIT") {
        debit = addExact(debit, line.amount);
      } else {
        credit = addExact(credit, line.amount);
      }
    }
    return { debitTotal: debit, creditTotal: credit, balanced: compareExact(debit, credit) === 0 };
  }
}
