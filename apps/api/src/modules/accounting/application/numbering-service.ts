import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/accounting.store";
import { NumberingFormatInvalidError } from "../domain/accounting-errors";

/**
 * Numbering service (PHASE-007 T13; BR-029/INV-021/ADR-0006): per-(tenant,
 * branch, type, period) sequences with format templates, assigned at
 * approval-reserve or posting per the tenant's `numbering.assign_at`
 * policy (default posting — POSTING_ENGINE §6 assigns journal numbers
 * inside the posting transaction), immutable once assigned, voided numbers
 * reserved forever, and the row-lock-safe atomic acquire (CC-03). Document
 * modules consume this from PHASE-008; the journal entry_no uses it from
 * day one (via PostingService).
 */

export interface ReserveResult {
  number: string;
  value: bigint;
}

@Injectable()
export class NumberingService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The assign_at policy (BR-029): 'approval' reserves early, 'posting' assigns late. */
  async assignAtPolicy(docType: string): Promise<"approval" | "posting"> {
    const defaults = await readEffectiveSetting<{ assign_at?: "approval" | "posting" }>(
      "numbering.defaults",
    );
    // Per-doctype rows land with the first document consumer (PHASE-008);
    // the journal entry always assigns at posting per POSTING_ENGINE §6 —
    // recorded in the phase report.
    void docType;
    return defaults?.assign_at ?? "posting";
  }

  /**
   * Reserve/assign an official number (atomic upsert-increment — CC-03:
   * 50 parallel acquirers serialize on the row update, no deadlocks).
   * `format` placeholders: {PREFIX}, {YYYY}, {SEQ:n}.
   */
  async reserve(input: {
    docType: string;
    branchId: string | null;
    periodKey: string | null;
    format: string;
    prefix: string;
    year: string | null;
  }): Promise<ReserveResult> {
    if (!input.format.includes("{SEQ:")) {
      throw new NumberingFormatInvalidError(
        `format "${input.format}" must contain a {SEQ:n} placeholder`,
      );
    }
    if (input.format.includes("{YYYY}") && input.year === null) {
      throw new NumberingFormatInvalidError("format uses {YYYY} but no year was provided");
    }
    const acquired = await store.acquireNumber(input);
    return { number: acquired.number, value: acquired.value };
  }

  /** Bind the owning document to the assignment row (audit view). */
  async bind(docType: string, number: string, documentId: string): Promise<void> {
    await store.bindNumberAssignment(docType, number, documentId);
  }

  /**
   * Void (INV-021): tombstones the assignment — the number stays reserved
   * forever and the gap is documented (ADR-0006's only sanctioned gap).
   */
  async void(actorId: string, docType: string, number: string): Promise<void> {
    const assignmentId = await store.voidNumber(docType, number, actorId);
    await this.audit.record({
      action: "accounting.number_voided",
      entityType: "number_assignment",
      entityId: assignmentId ?? "00000000-0000-0000-0000-000000000000",
      actorId,
      after: { docType, number },
    });
  }

  /** The numbering audit view: assignments with void tombstones visible. */
  async listAssignments(filter: { docType?: string }): Promise<
    { id: string; docType: string; number: string; value: string; documentId: string | null; voidedAt: string | null }[]
  > {
    const rows = await (await import("../infrastructure/accounting.store")).listNumberAssignments(filter);
    return rows;
  }
}
