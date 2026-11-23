import { Inject, Injectable } from "@nestjs/common";
import { generateUuidV7 } from "@erp/domain-core";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { findAssetCard } from "../../fixed_assets/infrastructure/cmms.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/quality.store";
import {
  CalibrationDueDateInvalidError,
  CalibrationRecordNotFoundError,
  QualityInputInvalidError,
  QualityInstrumentNotFoundError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) THE CALIBRATION ENGINE (Q-03): the
 * calibration register (D-08 — the 049 handoff verbatim): the instrument
 * IS an asset on the 049 surfaces — `calibration_records` binds the asset
 * card through the fixed-assets module's OWN read (findAssetCard — the
 * composite FK's service face, zero parallel computation) and the
 * register IS the service-history timeline's calibration leg.
 *
 *   THE DUE-AFTER FLOOR (the 0115 CHECK's typed pre-check): the due
 *   date follows the calibration act strictly (the comparison pinned to
 *   the act's own UTC day — the refusal names BOTH dates, never a raw
 *   23514-shaped violation). The due date is the
 *   `quality-calibration-due` sweep's own anchor (the ix_calibration_
 *   records_tenant_due index — W-26's own probe reads it).
 *
 *   THE G-63 POSTING (D-06): the EXTERNAL calibration cost posts
 *   through the REAL engine at the create act — DR the purpose-mapped
 *   QUALITY_EXPENSE (5320, the 0116 marker) · CR the purpose-mapped
 *   EXTERNAL_ACCRUAL (2137, the existing marker), fail-closed
 *   PURPOSE_NOT_MAPPED until the tenant maps, INV-013 exactly-once on
 *   the single-use source key (calibration_record, id, 'external_cost')
 *   — the record id is PRE-GENERATED (uuidv7) so the source key names
 *   the row before it exists; the posting and the insert share ONE
 *   ambient transaction (INV-018 — a failure anywhere rolls both back,
 *   zero residue). A zero-cost (in-house) calibration carries NO entry
 *   (the 0115 gate's own NULL allowance — the recorded honest shape).
 *
 *   THE RECORD IS THE EVENT'S OWN HISTORY (the declared W-26 shape): a
 *   calibration row is the immutable evidence of the act — the number,
 *   the standard, the result, the dates and the journal link land at
 *   create and never move again (the register's grants carry UPDATE
 *   for the platform's own stamp discipline; the service exposes no
 *   mutation surface — a corrected record is a NEW calibration).
 */

export const CALIBRATION_NUMBER_FORMAT = {
  prefix: "CAL",
  format: "CAL-{YYYY}-{SEQ:6}",
  docType: "calibration_record",
} as const;

const RESULTS = ["PASS", "FAIL", "ADJUSTED"] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateCalibrationInput {
  assetId: string;
  standardUsed: string;
  result: string;
  calibratedAt: string;
  dueDate: string;
  providerId?: string | null;
  certificateRef?: string | null;
  externalCost?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class CalibrationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  async create(input: CreateCalibrationInput): Promise<store.CalibrationRow> {
    requireUuid(input.assetId, "assetId");
    if (input.standardUsed.length < 1 || input.standardUsed.length > 120) {
      throw new QualityInputInvalidError({
        field: "standardUsed",
        reason: "the standard used is required (1…120 chars)",
      });
    }
    if (!(RESULTS as readonly string[]).includes(input.result)) {
      throw new QualityInputInvalidError({
        field: "result",
        reason: `result must be one of ${RESULTS.join("/")}: ${input.result}`,
      });
    }
    if (!STAMP_RE.test(input.calibratedAt)) {
      throw new QualityInputInvalidError({
        field: "calibratedAt",
        reason: `calibratedAt must be an ISO datetime: ${input.calibratedAt}`,
      });
    }
    if (!DAY_RE.test(input.dueDate)) {
      throw new QualityInputInvalidError({
        field: "dueDate",
        reason: `dueDate must be an ISO date (YYYY-MM-DD): ${input.dueDate}`,
      });
    }
    if (
      input.certificateRef !== undefined &&
      input.certificateRef !== null &&
      (input.certificateRef.length < 1 || input.certificateRef.length > 120)
    ) {
      throw new QualityInputInvalidError({
        field: "certificateRef",
        reason: "certificateRef must be 1…120 chars",
      });
    }
    const externalCostInput = input.externalCost ?? null;
    let externalCost: Decimal = new Decimal(0);
    if (externalCostInput !== null) {
      externalCost = new Decimal(externalCostInput);
      if (externalCost.lessThan(0)) {
        throw new QualityInputInvalidError({
          field: "externalCost",
          reason: "the external cost is ≥ 0 (a negative cost is refused)",
        });
      }
    }
    // THE INSTRUMENT-ASSET BINDING (D-08): the asset card through the
    // fixed-assets module's OWN read — the typed not-found for a foreign
    // id (RLS makes it indistinguishable from absence).
    const asset = await findAssetCard(input.assetId);
    if (asset === undefined) {
      throw new QualityInstrumentNotFoundError({ assetId: input.assetId });
    }
    // THE DUE-AFTER FLOOR (the 0115 CHECK's typed pre-check — the
    // comparison pinned to the act's own UTC day, exactly the CHECK's
    // own shape: due_date > (calibrated_at AT TIME ZONE 'UTC')::date).
    const calibratedDay = input.calibratedAt.slice(0, 10);
    if (input.dueDate <= calibratedDay) {
      throw new CalibrationDueDateInvalidError({
        calibratedAt: input.calibratedAt,
        dueDate: input.dueDate,
      });
    }

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CALIBRATION_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: CALIBRATION_NUMBER_FORMAT.format,
      prefix: CALIBRATION_NUMBER_FORMAT.prefix,
      year,
    });

    // THE G-63 POSTING (D-06): the id is pre-generated so the source key
    // names the row before it exists — the posting and the insert share
    // ONE ambient transaction (INV-018). A zero-cost (in-house)
    // calibration carries NO entry.
    const id = generateUuidV7();
    let journalEntryId: string | null = null;
    if (externalCost.greaterThan(0)) {
      const today = todayIso();
      const lines: JournalLineSpec[] = [
        {
          purpose: "QUALITY_EXPENSE",
          direction: "DEBIT",
          amount: externalCost.toFixed(4),
          memo: {
            en: `Calibration ${acquired.number} — instrument ${asset.code} (G-63)`,
            ar: `معايرة ${acquired.number} — الجهاز ${asset.code} (G-63)`,
          },
        },
        {
          purpose: "EXTERNAL_ACCRUAL",
          direction: "CREDIT",
          amount: externalCost.toFixed(4),
          memo: {
            en: `Calibration ${acquired.number} — accrued external calibration service (G-63)`,
            ar: `معايرة ${acquired.number} — خدمة المعايرة الخارجية المستحقة (G-63)`,
          },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "calibration_record", docId: id, operation: "external_cost" },
        entryDate: today,
        description: {
          en: `Calibration ${acquired.number} — G-63 external quality cost`,
          ar: `معايرة ${acquired.number} — التكلفة الخارجية G-63`,
        },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
    }

    const row = await store.insertCalibration({
      id,
      calibrationNo: acquired.number,
      assetId: input.assetId,
      standardUsed: input.standardUsed,
      result: input.result,
      calibratedAt: input.calibratedAt,
      dueDate: input.dueDate,
      providerId: input.providerId ?? null,
      certificateRef: input.certificateRef ?? null,
      externalCost: externalCost.toFixed(4),
      journalEntryId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.numbering.bind(CALIBRATION_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.calibration_created",
      entityType: "calibration_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        calibrationNo: row.calibrationNo,
        assetId: row.assetId,
        assetCode: asset.code,
        result: row.result,
        dueDate: row.dueDate,
        externalCost: row.externalCost,
        journalEntryId: row.journalEntryId,
      },
    });
    return row;
  }

  async find(id: string): Promise<store.CalibrationRow> {
    requireUuid(id, "id");
    const row = await store.findCalibrationById(id);
    if (row === undefined) throw new CalibrationRecordNotFoundError({ calibrationId: id });
    return row;
  }

  /** The instrument's own history (D-08: the service-history timeline's
   * calibration leg — the register reads, newest first). */
  async list(filter: { assetId?: string; limit?: number }): Promise<store.CalibrationRow[]> {
    return store.listCalibrations({
      assetId: filter.assetId,
      limit: filter.limit ?? 200,
    });
  }
}
