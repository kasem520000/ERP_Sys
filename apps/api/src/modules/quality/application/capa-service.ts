import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/quality.store";
import { capaActionsValid, capaCloseGate, nextCapaMove, type CapaAction } from "../domain/capa-lifecycle";
import {
  CapaActionsPendingError,
  CapaCostAlreadyRecordedError,
  CapaEffectivenessRequiredError,
  CapaRecordNotFoundError,
  CapaStateError,
  NcrRecordNotFoundError,
  QualityInputInvalidError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-26 — T-07, 2026-11-23) THE CAPA ENGINE (Q-02): the
 * corrective/preventive action register's lifecycle (root cause, actions
 * with owners and dates, BR-103's effectiveness gate — D-10) + G-63's
 * external-cost posting (D-06):
 *
 *   THE LADDER (the declared W-26 interpretation, the wave README's
 *   table): OPEN →(root cause recorded — the start act)→ IN_PROGRESS
 *   →(the effectiveness check recorded, every open window elapsed)→
 *   CLOSED. The actions array records at OPEN and IN_PROGRESS both (the
 *   plan may be drafted before or after the analysis); the root-cause
 *   act re-records at IN_PROGRESS (the analysis evolved — the stamp
 *   refreshed).
 *
 *   BR-103's GATE (D-10's two conditions, exactly): the close requires
 *   every OPEN action's window elapsed (an undated open action BLOCKS —
 *   no declared window can never prove its passage; a future-dated one
 *   BLOCKS — the refusal carries the open action/due-date figures) AND
 *   the effectiveness check RECORDED — the payload lands with the close
 *   CAS (the 0114 floor's own shape). The record's OUTCOME is the
 *   tenant's honest evidence — D-10 demands the CHECK RECORDED, never a
 *   forced "effective" verdict. THE checkedAt FLOOR (the service's own
 *   fabrication guard): a future-dated check is refused (a check
 *   "performed" tomorrow is a fabrication; a backdated check is the
 *   tenant's honest record of when it actually happened).
 *
 *   THE G-63 POSTING (D-06 — the 049 G-59 external leg's own shape): the
 *   external CAPA service cost posts through the REAL engine — DR the
 *   purpose-mapped QUALITY_EXPENSE (5320, the 0116 marker) · CR the
 *   purpose-mapped EXTERNAL_ACCRUAL (2137, the existing marker),
 *   fail-closed PURPOSE_NOT_MAPPED until the tenant maps, INV-013
 *   exactly-once on the single-use source key (capa_record, id,
 *   'external_cost'), the cost line never double-counted with a
 *   maintenance work order's external leg (the source keys differ by
 *   construction), the stamp landing cost + journal link in ONE guarded
 *   CAS — ONE ambient transaction, all-or-nothing (INV-018: a failure
 *   anywhere rolls the journal and the stamp back to zero).
 */

export const CAPA_NUMBER_FORMAT = {
  prefix: "CAPA",
  format: "CAPA-{YYYY}-{SEQ:6}",
  docType: "capa_record",
} as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateCapaInput {
  title: string;
  ncrId?: string | null;
  ownerEmployeeId?: string | null;
  dueDate?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

/** The effectiveness check's canonical payload (the 0114 jsonb's own
 * shape — the record the close CAS lands verbatim). */
export interface CapaEffectivenessPayload {
  summary: string;
  effective: boolean;
  checkedAt: string;
}

export interface RecordCapaActionsInput {
  actions: readonly unknown[];
  actorId: string | null;
}

@Injectable()
export class CapaService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  async create(input: CreateCapaInput): Promise<store.CapaRow> {
    if (input.title.trim().length === 0 || input.title.length > 2000) {
      throw new QualityInputInvalidError({
        field: "title",
        reason: "the title is required (1…2000 chars)",
      });
    }
    if (input.dueDate !== undefined && input.dueDate !== null && !DAY_RE.test(input.dueDate)) {
      throw new QualityInputInvalidError({
        field: "dueDate",
        reason: `dueDate must be an ISO date (YYYY-MM-DD): ${input.dueDate}`,
      });
    }
    const ncrId = input.ncrId ?? null;
    if (ncrId !== null) {
      requireUuid(ncrId, "ncrId");
      // The NCR link's typed pre-check — the module's OWN row (the 0114
      // composite FK's service face; a foreign id is the typed
      // not-found, RLS making it indistinguishable from absence).
      const ncr = await store.findNcrById(ncrId);
      if (ncr === undefined) {
        throw new NcrRecordNotFoundError({ ncrId });
      }
    }
    const ownerEmployeeId = input.ownerEmployeeId ?? null;
    if (ownerEmployeeId !== null) requireUuid(ownerEmployeeId, "ownerEmployeeId");

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CAPA_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: CAPA_NUMBER_FORMAT.format,
      prefix: CAPA_NUMBER_FORMAT.prefix,
      year,
    });
    const row = await store.insertCapa({
      capaNo: acquired.number,
      ncrId,
      title: input.title,
      ownerEmployeeId,
      dueDate: input.dueDate ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.numbering.bind(CAPA_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.capa_created",
      entityType: "capa_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { capaNo: row.capaNo, title: row.title, ncrId: row.ncrId, status: row.status },
    });
    return row;
  }

  async find(id: string): Promise<store.CapaRow> {
    requireUuid(id, "id");
    const row = await store.findCapaById(id);
    if (row === undefined) throw new CapaRecordNotFoundError({ capaId: id });
    return row;
  }

  async list(filter: { status?: string; ncrId?: string; limit?: number }): Promise<store.CapaRow[]> {
    return store.listCapas({
      status: filter.status,
      ncrId: filter.ncrId,
      limit: filter.limit ?? 200,
    });
  }

  /** THE ROOT-CAUSE ACT (the start act — the declared interpretation): the
   * analysis moves OPEN → IN_PROGRESS in the same CAS that lands the
   * pair; at IN_PROGRESS the act re-records (the analysis evolved). */
  async recordRootCause(
    capaId: string,
    input: { rootCause: string; actorId: string | null },
  ): Promise<store.CapaRow> {
    requireUuid(capaId, "id");
    if (input.rootCause.trim().length === 0 || input.rootCause.length > 4000) {
      throw new QualityInputInvalidError({
        field: "rootCause",
        reason: "the root-cause analysis is required (1…4000 chars)",
      });
    }
    const row = await store.findCapaById(capaId);
    if (row === undefined) throw new CapaRecordNotFoundError({ capaId });
    const verdict = nextCapaMove(row.status as "OPEN" | "IN_PROGRESS" | "CLOSED", "root_cause");
    if (!verdict.allowed) {
      throw new CapaStateError({
        capaId: row.id,
        capaNo: row.capaNo,
        from: row.status,
        to: "IN_PROGRESS",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const stamped = await store.stampCapaRootCause({
      id: row.id,
      rootCause: input.rootCause,
      rootCauseAt: nowIso(),
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      const current = await store.findCapaById(capaId);
      throw new CapaStateError({
        capaId,
        capaNo: current?.capaNo ?? row.capaNo,
        from: current?.status ?? "UNKNOWN",
        to: "IN_PROGRESS",
        reason: "the record moved under the act",
      });
    }
    await this.audit.record({
      action: "quality.capa_root_cause_recorded",
      entityType: "capa_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status, hadRootCause: row.rootCause !== null },
      after: { status: stamped.status, rootCauseAt: stamped.rootCauseAt },
    });
    return stamped;
  }

  /** THE ACTIONS ACT (the plan's array): the shape law at the service
   * floor (the fold validates; the typed refusal names the offending
   * cell), the array replaces wholesale. */
  async recordActions(
    capaId: string,
    input: RecordCapaActionsInput,
  ): Promise<store.CapaRow> {
    requireUuid(capaId, "id");
    const shape = capaActionsValid(input.actions);
    if (!shape.ok) {
      throw new QualityInputInvalidError({ field: "actions", reason: shape.reason });
    }
    const row = await store.findCapaById(capaId);
    if (row === undefined) throw new CapaRecordNotFoundError({ capaId });
    const verdict = nextCapaMove(row.status as "OPEN" | "IN_PROGRESS" | "CLOSED", "actions");
    if (!verdict.allowed) {
      throw new CapaStateError({
        capaId: row.id,
        capaNo: row.capaNo,
        from: row.status,
        to: row.status,
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const stamped = await store.stampCapaActions({
      id: row.id,
      actions: shape.actions,
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      const current = await store.findCapaById(capaId);
      throw new CapaStateError({
        capaId,
        capaNo: current?.capaNo ?? row.capaNo,
        from: current?.status ?? "UNKNOWN",
        to: row.status,
        reason: "the record moved under the act",
      });
    }
    await this.audit.record({
      action: "quality.capa_actions_recorded",
      entityType: "capa_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { actionCount: row.actions.length },
      after: { actionCount: stamped.actions.length },
    });
    return stamped;
  }

  /**
   * THE EXTERNAL-COST ACT (G-63's posting — D-06): ONE ambient
   * transaction, all-or-nothing — the entry posts through the REAL
   * engine (INV-013 exactly-once on (capa_record, id, 'external_cost');
   * fail-closed PURPOSE_NOT_MAPPED on either purpose) then the
   * single-use CAS lands the cost and the journal link together. A
   * failure anywhere rolls EVERYTHING back (the record keeps its
   * pre-act state, zero journal rows — INV-018).
   */
  async recordExternalCost(
    capaId: string,
    input: { amount: string; actorId: string | null },
  ): Promise<{ capa: store.CapaRow; journalEntryId: string }> {
    requireUuid(capaId, "id");
    const amount = new Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new QualityInputInvalidError({
        field: "amount",
        reason: "the external cost act requires a positive amount (a zero cost is no act — the 0114 stamp gate demands external_cost > 0)",
      });
    }
    const row = await store.findCapaById(capaId);
    if (row === undefined) throw new CapaRecordNotFoundError({ capaId });
    const verdict = nextCapaMove(
      row.status as "OPEN" | "IN_PROGRESS" | "CLOSED",
      "external_cost",
      { hasCostStamp: row.journalEntryId !== null },
    );
    if (!verdict.allowed) {
      if (verdict.refusal === "COST_ALREADY_RECORDED") {
        throw new CapaCostAlreadyRecordedError({
          capaId: row.id,
          capaNo: row.capaNo,
          journalEntryId: row.journalEntryId!,
        });
      }
      throw new CapaStateError({
        capaId: row.id,
        capaNo: row.capaNo,
        from: row.status,
        to: "IN_PROGRESS (the cost-carrying record)",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const today = todayIso();
    // THE G-63 ENTRY (D-06): DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL —
    // both purpose-mapped, fail-closed (the 049 G-59 external leg's own
    // shape; the pair differs from a work order's external leg by the
    // source key's construction).
    const lines: JournalLineSpec[] = [
      {
        purpose: "QUALITY_EXPENSE",
        direction: "DEBIT",
        amount: input.amount,
        memo: {
          en: `CAPA ${row.capaNo} — external service cost (G-63)`,
          ar: `سجل إجراءات ${row.capaNo} — التكلفة الخارجية G-63`,
        },
      },
      {
        purpose: "EXTERNAL_ACCRUAL",
        direction: "CREDIT",
        amount: input.amount,
        memo: {
          en: `CAPA ${row.capaNo} — accrued external quality service (G-63)`,
          ar: `سجل إجراءات ${row.capaNo} — خدمات الجودة الخارجية المستحقة G-63`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "capa_record", docId: row.id, operation: "external_cost" },
      entryDate: today,
      description: {
        en: `CAPA ${row.capaNo} — G-63 external quality cost`,
        ar: `سجل إجراءات ${row.capaNo} — التكلفة الخارجية G-63`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    const stamped = await store.stampCapaExternalCost({
      id: row.id,
      externalCost: input.amount,
      journalEntryId: posted.journalEntryId,
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      // The raced/stale move — the ambient transaction rolls the posting
      // back with it (zero residue, INV-018); the typed refusal carries
      // the record's own state.
      const current = await store.findCapaById(capaId);
      throw new CapaStateError({
        capaId,
        capaNo: current?.capaNo ?? row.capaNo,
        from: current?.status ?? "UNKNOWN",
        to: "IN_PROGRESS (the cost-carrying record)",
        reason: "the record moved under the act — the external-cost stamp is single-use",
      });
    }
    await this.audit.record({
      action: "quality.capa_external_cost_recorded",
      entityType: "capa_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { externalCost: row.externalCost, journalEntryId: null },
      after: {
        externalCost: stamped.externalCost,
        journalEntryId: stamped.journalEntryId,
      },
    });
    return { capa: stamped, journalEntryId: posted.journalEntryId };
  }

  /**
   * THE CLOSE ACT (BR-103's own gate — D-10's two conditions): every
   * open action's window elapsed AND the effectiveness check recorded —
   * the typed refusals carry the figures; the payload + closed_at land
   * with the status in ONE CAS (the 0114 floor's own shape).
   */
  async close(
    capaId: string,
    input: CapaEffectivenessPayload & { actorId: string | null },
  ): Promise<store.CapaRow> {
    requireUuid(capaId, "id");
    if (input.summary.trim().length === 0 || input.summary.length > 4000) {
      throw new QualityInputInvalidError({
        field: "summary",
        reason: "the effectiveness summary is required (1…4000 chars)",
      });
    }
    const checkedDay = input.checkedAt.slice(0, 10);
    if (!DAY_RE.test(checkedDay)) {
      throw new QualityInputInvalidError({
        field: "checkedAt",
        reason: `checkedAt must be an ISO datetime: ${input.checkedAt}`,
      });
    }
    // THE FABRICATION GUARD (the service's own floor): a future-dated
    // check is refused — the check is recorded when it happened, never
    // pre-dated; a backdated check is the tenant's honest record.
    const today = todayIso();
    if (checkedDay > today) {
      throw new QualityInputInvalidError({
        field: "checkedAt",
        reason: `the effectiveness check is future-dated (${checkedDay} > ${today}) — a check "performed" tomorrow is a fabrication`,
      });
    }
    const row = await store.findCapaById(capaId);
    if (row === undefined) throw new CapaRecordNotFoundError({ capaId });
    const verdict = nextCapaMove(row.status as "OPEN" | "IN_PROGRESS" | "CLOSED", "close");
    if (!verdict.allowed) {
      throw new CapaStateError({
        capaId: row.id,
        capaNo: row.capaNo,
        from: row.status,
        to: "CLOSED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const gate = capaCloseGate({
      actions: row.actions as CapaAction[],
      effectiveness: { summary: input.summary, effective: input.effective, checkedAt: input.checkedAt },
      today,
    });
    if (!gate.allowed) {
      if (gate.refusal === "ACTIONS_PENDING") {
        throw new CapaActionsPendingError({
          capaId: row.id,
          capaNo: row.capaNo,
          openActionCount: gate.figures!.openActionCount,
          pendingCount: gate.figures!.pendingCount,
          pendingDueDates: gate.figures!.pendingDueDates,
        });
      }
      throw new CapaEffectivenessRequiredError({ capaId: row.id, capaNo: row.capaNo });
    }
    const stamped = await store.stampCapaClosed({
      id: row.id,
      effectiveness: {
        summary: input.summary,
        effective: input.effective,
        checkedAt: input.checkedAt,
      },
      closedAt: nowIso(),
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      const current = await store.findCapaById(capaId);
      throw new CapaStateError({
        capaId,
        capaNo: current?.capaNo ?? row.capaNo,
        from: current?.status ?? "UNKNOWN",
        to: "CLOSED",
        reason: "the record moved under the act",
      });
    }
    await this.audit.record({
      action: "quality.capa_closed",
      entityType: "capa_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status },
      after: {
        status: stamped.status,
        closedAt: stamped.closedAt,
        effective: input.effective,
      },
    });
    return stamped;
  }
}
