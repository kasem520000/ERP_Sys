import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { JobsService, type JobPayloadBase } from "../../../infra/jobs/boss";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { FilesService } from "../../files/api/files";
import * as partnerStore from "../../partners/infrastructure/partners.store";
import { getItemForOpeningBalance } from "../api/items";
import {
  ImportCommitConflictError,
  ImportFileInvalidError,
  ImportJobNotFoundError,
  ImportNotPreviewedError,
} from "../domain/items-errors";
import * as store from "../infrastructure/items.store";
import { assertImportBounds, parseSheet } from "../infrastructure/import/parse";
import { ItemService } from "./item-service";
import { OpeningBalancesService } from "../../partners/api/partners";
import { PartnerService } from "../../partners/api/partners";

/**
 * Preview-gated bulk import (PHASE-006 §2.6/T8; matrix `items.import.run`):
 *
 * - upload happens through the files module (direct-upload slot, tenant-
 *   prefixed key, size/type-validated at issuance);
 * - `createJob` is idempotent per upload-token and runs the DRY-RUN
 *   synchronously (bounded ≤ 5000 rows: parse + per-row validation +
 *   reference resolution + duplicate detection) storing the deterministic
 *   row-level report — no tenant data is written;
 * - `commit` claims PREVIEW_READY → COMMITTING atomically (concurrent
 *   duplicate commits see a typed conflict; a re-commit after COMMITTED is
 *   idempotent and replays the stored result) and enqueues the bounded
 *   tenant-scoped pg-boss job (ADR-0008: payload carries ids only);
 * - the worker applies exactly the previewed VALID/WARNING rows through the
 *   real services (which re-validate), recording per-row outcomes; rows
 *   referencing unknown data (including foreign-tenant ids — resolved
 *   inside the tenant UoW, so the error text is identical either way) are
 *   rejected per-row with no existence disclosure.
 */

export const IMPORT_QUEUE = "items-import-commit";

export interface ImportJobPayload extends JobPayloadBase {
  readonly jobId: string;
}

export interface CreateImportJobInput {
  kind: "PARTNERS" | "ITEMS" | "OPENING_BALANCES";
  format: "CSV" | "XLSX";
  uploadToken: string;
  fileKey: string;
  fileName: string | null;
}

interface RowError {
  readonly field: string;
  readonly message: string;
}

interface ReportRow {
  readonly row: number;
  readonly status: "VALID" | "ERROR" | "DUPLICATE" | "WARNING";
  readonly errors: readonly RowError[];
  readonly warnings: readonly RowError[];
  readonly preview: Readonly<Record<string, string>>;
}

export interface ImportReport {
  readonly kind: string;
  readonly headers: readonly string[];
  readonly unmappedColumns: readonly string[];
  readonly rows: readonly ReportRow[];
  readonly summary: {
    readonly total: number;
    readonly valid: number;
    readonly invalid: number;
    readonly duplicates: number;
    readonly warnings: number;
  };
  readonly commitRowErrors?: readonly { row: number; message: string }[];
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  // -- HTTP surface -------------------------------------------------------------

  async list(cursor: string | undefined, limit: number) {
    return store.listImportJobs(cursor, limit);
  }

  async get(jobId: string): Promise<store.ImportJobRow> {
    const job = await store.findImportJobById(jobId);
    if (job === undefined) {
      throw new ImportJobNotFoundError(jobId);
    }
    return job;
  }

  /** Idempotent per upload-token; runs the synchronous dry-run preview. */
  async createJob(actorId: string, input: CreateImportJobInput): Promise<store.ImportJobRow> {
    const existing = await store.findImportJobByToken(input.uploadToken);
    if (existing !== undefined) {
      return existing;
    }
    const job = await store.insertImportJob({
      kind: input.kind,
      format: input.format,
      uploadToken: input.uploadToken,
      fileKey: input.fileKey,
      fileName: input.fileName,
      createdBy: actorId,
    });
    const tenantId = requireTenantContext().tenantId;
    try {
      const report = await this.preview(tenantId, job);
      const updated = await store.updateImportJob(job.id, {
        status: "PREVIEW_READY",
        totalRows: report.summary.total,
        validRows: report.summary.valid,
        invalidRows: report.summary.invalid,
        duplicateRows: report.summary.duplicates,
        report,
      });
      await this.audit.record({
        action: "import.previewed",
        entityType: "import_job",
        entityId: job.id,
        actorId,
        after: {
          kind: input.kind,
          format: input.format,
          total: report.summary.total,
          valid: report.summary.valid,
          invalid: report.summary.invalid,
          duplicates: report.summary.duplicates,
        },
      });
      return updated ?? job;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.updateImportJob(job.id, { status: "FAILED", error: message });
      throw error;
    }
  }

  /** Idempotent commit: claims PREVIEW_READY → COMMITTING, enqueues the job. */
  async commit(actorId: string, jobId: string): Promise<store.ImportJobRow> {
    const job = await store.findImportJobById(jobId);
    if (job === undefined) {
      throw new ImportJobNotFoundError(jobId);
    }
    if (job.status === "COMMITTED") {
      return job; // idempotent replay of the same token's result
    }
    if (job.status === "COMMITTING") {
      throw new ImportCommitConflictError(jobId);
    }
    if (job.status !== "PREVIEW_READY" || job.validRows + countWarnings(job) === 0) {
      throw new ImportNotPreviewedError(jobId);
    }
    const claimed = await store.claimImportJobForCommit(jobId);
    if (claimed === undefined) {
      throw new ImportCommitConflictError(jobId);
    }
    await this.jobs.publish<ImportJobPayload>(IMPORT_QUEUE, {
      tenantId: requireTenantContext().tenantId,
      jobId,
      correlationId: generateUuidV7(),
    });
    await this.audit.record({
      action: "import.commit_requested",
      entityType: "import_job",
      entityId: jobId,
      actorId,
      after: { valid_rows: job.validRows, duplicates: job.duplicateRows },
    });
    return claimed;
  }

  // -- worker --------------------------------------------------------------------

  /** pg-boss handler: applies the previewed VALID/WARNING rows in the tenant UoW. */
  async runCommit(payload: ImportJobPayload): Promise<void> {
    await withTenant(payload.tenantId, async () => {
      const job = await store.findImportJobById(payload.jobId);
      if (job === undefined || job.status !== "COMMITTING") {
        return; // claim already consumed (retry/replay safety)
      }
      const report = job.report as ImportReport | null;
      if (report === null) {
        await store.updateImportJob(job.id, { status: "FAILED", error: "missing report" });
        return;
      }
      let committed = 0;
      const commitRowErrors: { row: number; message: string }[] = [];
      for (const entry of report.rows) {
        if (entry.status === "VALID" || entry.status === "WARNING") {
          try {
            await applyRow(this.audit, job.kind, entry.preview, job.createdBy ?? undefined);
            committed += 1;
          } catch (error) {
            commitRowErrors.push({
              row: entry.row,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      await store.updateImportJob(job.id, {
        status: "COMMITTED",
        committedRows: committed,
        report: { ...report, commitRowErrors },
        committedAt: new Date().toISOString(),
      });
      await this.audit.record({
        action: "import.committed",
        entityType: "import_job",
        entityId: job.id,
        actorId: job.createdBy ?? undefined,
        after: {
          committed_rows: committed,
          row_errors: commitRowErrors.length,
          valid_rows: job.validRows,
        },
      });
    });
  }

  // -- preview (deterministic dry-run) ---------------------------------------------

  private async preview(tenantId: string, job: store.ImportJobRow): Promise<ImportReport> {
    const object = await this.files.readObject(tenantId, job.fileKey);
    assertImportBounds(object.body, job.format);
    const sheet = await parseSheet(object.body, job.format);
    const columns = HEADER_MAPS[job.kind]!;
    const unmapped: string[] = [];
    const index: Record<string, number> = {};
    for (const [position, header] of sheet.headers.entries()) {
      const canonical = columns.aliases[header.trim().toLowerCase()];
      if (canonical !== undefined) {
        index[canonical] = position;
      } else {
        unmapped.push(header);
      }
    }
    for (const required of columns.required) {
      if (index[required] === undefined) {
        throw new ImportFileInvalidError(
          `missing required column "${required}" for a ${job.kind.toLowerCase()} import`,
        );
      }
    }

    const rows: ReportRow[] = [];
    const seenKeys = new Map<string, number>();
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;
    let warnings = 0;

    for (const [rowPosition, raw] of sheet.rows.entries()) {
      const rowNumber = rowPosition + 2; // header is row 1
      const values: Record<string, string> = {};
      for (const [field, position] of Object.entries(index)) {
        values[field] = raw[position] ?? "";
      }
      const errors: RowError[] = [];
      const rowWarnings: RowError[] = [];

      // Natural-key duplicates: within-file + against the tenant — rows
      // whose ONLY problem is the duplicate key classify DUPLICATE (they
      // are blocked at commit and reported as duplicates, not errors);
      // anything else wrong with the row still classifies ERROR.
      const key = columns.naturalKey(values);
      let duplicate = false;
      if (key !== null) {
        const inFile = seenKeys.get(key);
        if (inFile !== undefined) {
          errors.push({
            field: "code",
            message: `duplicate of row ${inFile} (same natural key in this file)`,
          });
          duplicate = true;
        } else if (await columns.existsInDb(values)) {
          errors.push({ field: "code", message: "already exists in this tenant" });
          duplicate = true;
        }
        seenKeys.set(key, rowNumber);
      }
      columns.validate(values, errors);
      await columns.checkReferences(values, errors);
      // Fuzzy name-match warning (partners/items) — warned, never blocked.
      if (!duplicate && (await columns.nameDuplicate?.(values)) === true) {
        rowWarnings.push({
          field: "name",
          message: "an existing record carries the same name — verify before committing",
        });
      }

      if (duplicate) {
        const dupErrors = errors.filter((error) => error.field === "code" && /duplicate|already exists/.test(error.message));
        if (dupErrors.length === errors.length) {
          duplicates += 1;
          rows.push({ row: rowNumber, status: "DUPLICATE", errors, warnings: [], preview: values });
          continue;
        }
      }
      if (errors.length > 0) {
        invalid += 1;
        rows.push({ row: rowNumber, status: "ERROR", errors, warnings: rowWarnings, preview: values });
        continue;
      }
      if (rowWarnings.length > 0) {
        warnings += 1;
        rows.push({ row: rowNumber, status: "WARNING", errors: [], warnings: rowWarnings, preview: values });
        continue;
      }
      valid += 1;
      rows.push({ row: rowNumber, status: "VALID", errors: [], warnings: [], preview: values });
    }

    return {
      kind: job.kind,
      headers: sheet.headers,
      unmappedColumns: unmapped,
      rows,
      summary: { total: sheet.rows.length, valid, invalid, duplicates, warnings },
    };
  }
}

function countWarnings(job: store.ImportJobRow): number {
  const report = job.report as ImportReport | null;
  return report === null ? 0 : report.summary.warnings;
}

async function applyRow(
  audit: AuditService,
  kind: "PARTNERS" | "ITEMS" | "OPENING_BALANCES",
  rawValues: Record<string, string>,
  actorId: string | undefined,
): Promise<string> {
  const values = (name: string): string => rawValues[name] ?? "";

  if (kind === "PARTNERS") {
    const termsCode = values("credit_terms_code");
    const creditTermsId =
      termsCode === "" ? null : (await partnerStore.findCreditTermsByCode(termsCode))?.id ?? null;
    const service = new PartnerService(audit);
    const kindRaw = values("kind");
    const partner = await service.create(actorId ?? "__import__", {
      kind: (kindRaw === "" ? "CUSTOMER" : kindRaw) as "CUSTOMER" | "SUPPLIER" | "BOTH",
      code: values("code") === "" ? undefined : values("code"),
      name: values("name"),
      nameAr: values("name_ar") === "" ? null : values("name_ar"),
      taxNumber: values("tax_number") === "" ? null : values("tax_number"),
      creditLimit: values("credit_limit") === "" ? null : values("credit_limit"),
      creditTermsId,
      priceListId: null,
    });
    return partner.id;
  }
  if (kind === "ITEMS") {
    const service = new ItemService(audit);
    const uom = await store.findUomByCode(values("uom_code"));
    const categoryCode = values("category_code");
    const category =
      categoryCode === "" ? null : (await store.findCategoryByCode(categoryCode))?.id ?? null;
    const kindRaw = values("kind");
    const costingRaw = values("costing_method");
    const item = await service.create(actorId ?? "__import__", {
      sku: values("sku"),
      name: values("name"),
      nameAr: values("name_ar") === "" ? null : values("name_ar"),
      kind: (kindRaw === "" ? "STOCK" : kindRaw) as "STOCK" | "SERVICE" | "COMPOSITE",
      uomId: uom === undefined ? "" : uom.id,
      categoryId: category,
      taxCodeId: null,
      costingMethod: (costingRaw === "" ? "WAC" : costingRaw) as "WAC" | "FIFO",
      trackBatch: parseBool(values("track_batch")),
      trackSerial: parseBool(values("track_serial")),
      trackImei: parseBool(values("track_imei")),
      hasExpiry: parseBool(values("has_expiry")),
      reorderLevel: values("reorder_level") === "" ? null : values("reorder_level"),
      reorderQty: values("reorder_qty") === "" ? null : values("reorder_qty"),
      basePrice: values("base_price") === "" ? null : values("base_price"),
    });
    return item.id;
  }
  // OPENING_BALANCES — resolve targets by natural key inside the tenant UoW.
  const service = new OpeningBalancesService(audit);
  const draftKind = values("kind") as "PARTNER" | "ACCOUNT" | "STOCK";
  let partnerId: string | undefined;
  let accountId: string | undefined;
  let itemId: string | undefined;
  if (draftKind === "PARTNER") {
    const code = values("partner_code");
    partnerId = (await partnerStore.findPartnerByCode(code))?.id;
    if (partnerId === undefined) {
      throw new Error(`unknown partner_code ${code}`);
    }
  } else if (draftKind === "ACCOUNT") {
    const code = values("account_code");
    accountId = await partnerStore.accountIdByCode(code);
    if (accountId === undefined) {
      throw new Error(`unknown account_code ${code}`);
    }
  } else {
    const sku = values("item_sku");
    const itemRow = await store.findItemBySku(sku);
    const visible = itemRow === undefined ? undefined : await getItemForOpeningBalance(itemRow.id);
    itemId = visible?.id;
    if (itemId === undefined) {
      throw new Error(`unknown item_sku ${sku}`);
    }
  }
  const doc = await service.create(actorId ?? "__import__", {
    kind: draftKind,
    partnerId,
    accountId,
    itemId,
    amount: values("amount") === "" ? undefined : values("amount"),
    qty: values("qty") === "" ? undefined : values("qty"),
    unitCost: values("unit_cost") === "" ? undefined : values("unit_cost"),
    note: values("note") === "" ? null : values("note"),
  });
  return doc.id;
}

function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "نعم";
}

// -- per-kind column dictionaries (EN + AR aliases; AR templates ship too) -----

interface ColumnMap {
  aliases: Record<string, string>;
  required: readonly string[];
  naturalKey(values: Record<string, string>): string | null;
  existsInDb(values: Record<string, string>): Promise<boolean>;
  nameDuplicate?(values: Record<string, string>): Promise<boolean>;
  validate(values: Record<string, string>, errors: RowError[]): void;
  /** Unknown references (incl. foreign-tenant data) → per-row rejection. */
  checkReferences(values: Record<string, string>, errors: RowError[]): Promise<void>;
}

const PARTNER_COLUMNS: ColumnMap = {
  aliases: {
    code: "code",
    الكود: "code",
    kind: "kind",
    النوع: "kind",
    name: "name",
    الاسم: "name",
    name_ar: "name_ar",
    الاسم_العربي: "name_ar",
    tax_number: "tax_number",
    الرقم_الضريبي: "tax_number",
    credit_limit: "credit_limit",
    حد_الائتمان: "credit_limit",
    credit_terms_code: "credit_terms_code",
    شروط_الدفع: "credit_terms_code",
  },
  required: ["name"],
  naturalKey(values) {
    return values["code"] === "" || values["code"] === undefined ? null : `code:${values["code"]}`;
  },
  async existsInDb(values) {
    if (values["code"] === undefined || values["code"] === "") {
      return false;
    }
    return (await partnerStore.findPartnerByCode(values["code"])) !== undefined;
  },
  async nameDuplicate(values) {
    const rows = await partnerStore.searchPartners(values["name"] ?? "", 5);
    const needle = (values["name"] ?? "").toLowerCase();
    return rows.some((row) => row.name.toLowerCase() === needle);
  },
  validate(values, errors) {
    const kind = values["kind"] ?? "";
    if (kind !== "" && kind !== "CUSTOMER" && kind !== "SUPPLIER" && kind !== "BOTH") {
      errors.push({ field: "kind", message: "kind must be CUSTOMER, SUPPLIER or BOTH" });
    }
    const name = values["name"] ?? "";
    if (name === "" || name.length > 200) {
      errors.push({ field: "name", message: "name is required (1–200 chars)" });
    }
    const code = values["code"] ?? "";
    if (code !== "" && !/^[A-Za-z0-9_-]{1,20}$/.test(code)) {
      errors.push({ field: "code", message: "code must match [A-Za-z0-9_-]{1,20}" });
    }
    const creditLimit = values["credit_limit"] ?? "";
    if (creditLimit !== "" && (Number.isNaN(Number(creditLimit)) || Number(creditLimit) < 0)) {
      errors.push({ field: "credit_limit", message: "credit_limit must be a number ≥ 0" });
    }
    const taxNumber = values["tax_number"] ?? "";
    if (taxNumber !== "" && !/^[0-9A-Za-z-]{5,30}$/.test(taxNumber)) {
      errors.push({ field: "tax_number", message: "tax_number must be 5–30 of [0-9A-Za-z-]" });
    }
  },
  async checkReferences(values, errors) {
    const termsCode = values["credit_terms_code"] ?? "";
    if (termsCode !== "") {
      const terms = await partnerStore.findCreditTermsByCode(termsCode);
      if (terms === undefined) {
        errors.push({ field: "credit_terms_code", message: "unknown credit terms code in this tenant" });
      }
    }
  },
};

const ITEM_COLUMNS: ColumnMap = {
  aliases: {
    sku: "sku",
    رمز_الصنف: "sku",
    name: "name",
    الاسم: "name",
    name_ar: "name_ar",
    الاسم_العربي: "name_ar",
    kind: "kind",
    النوع: "kind",
    uom_code: "uom_code",
    وحدة_القياس: "uom_code",
    category_code: "category_code",
    الفئة: "category_code",
    base_price: "base_price",
    السعر_الأساسي: "base_price",
    reorder_level: "reorder_level",
    حد_إعادة_الطلب: "reorder_level",
    reorder_qty: "reorder_qty",
    كمية_إعادة_الطلب: "reorder_qty",
    track_batch: "track_batch",
    تتبع_الدفعة: "track_batch",
    track_serial: "track_serial",
    تتبع_التسلسل: "track_serial",
    track_imei: "track_imei",
    تتبع_الإيمي: "track_imei",
    has_expiry: "has_expiry",
    تاريخ_الانتهاء: "has_expiry",
    costing_method: "costing_method",
    طريقة_التكلفة: "costing_method",
  },
  required: ["sku", "name", "uom_code"],
  naturalKey(values) {
    return `sku:${values["sku"] ?? ""}`;
  },
  async existsInDb(values) {
    return (await store.findItemBySku(values["sku"] ?? "")) !== undefined;
  },
  async nameDuplicate(values) {
    const rows = await store.searchItems(values["name"] ?? "", 5);
    const needle = (values["name"] ?? "").toLowerCase();
    return rows.some((row) => row.name.toLowerCase() === needle);
  },
  validate(values, errors) {
    const sku = values["sku"] ?? "";
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(sku)) {
      errors.push({ field: "sku", message: "sku is required ([A-Za-z0-9._-]{1,40})" });
    }
    const name = values["name"] ?? "";
    if (name === "" || name.length > 200) {
      errors.push({ field: "name", message: "name is required (1–200 chars)" });
    }
    const kind = values["kind"] ?? "";
    if (kind !== "" && !["STOCK", "SERVICE", "COMPOSITE"].includes(kind)) {
      errors.push({ field: "kind", message: "kind must be STOCK, SERVICE or COMPOSITE" });
    }
    const basePrice = values["base_price"] ?? "";
    if (basePrice !== "" && (Number.isNaN(Number(basePrice)) || Number(basePrice) < 0)) {
      errors.push({ field: "base_price", message: "base_price must be a number ≥ 0" });
    }
    const costing = values["costing_method"] ?? "";
    if (costing !== "" && costing !== "WAC" && costing !== "FIFO") {
      errors.push({ field: "costing_method", message: "costing_method must be WAC or FIFO" });
    }
  },
  async checkReferences(values, errors) {
    const uom = await store.findUomByCode(values["uom_code"] ?? "");
    if (uom === undefined) {
      errors.push({ field: "uom_code", message: "unknown unit code in this tenant" });
    }
    const categoryCode = values["category_code"] ?? "";
    if (categoryCode !== "") {
      const category = await store.findCategoryByCode(categoryCode);
      if (category === undefined) {
        errors.push({ field: "category_code", message: "unknown category code in this tenant" });
      }
    }
  },
};

const OBD_COLUMNS: ColumnMap = {
  aliases: {
    kind: "kind",
    النوع: "kind",
    partner_code: "partner_code",
    كود_الجهة: "partner_code",
    account_code: "account_code",
    كود_الحساب: "account_code",
    item_sku: "item_sku",
    رمز_الصنف: "item_sku",
    amount: "amount",
    المبلغ: "amount",
    qty: "qty",
    الكمية: "qty",
    unit_cost: "unit_cost",
    تكلفة_الوحدة: "unit_cost",
    note: "note",
    ملاحظة: "note",
  },
  required: ["kind"],
  naturalKey(values) {
    const kind = values["kind"] ?? "";
    if (kind === "PARTNER") {
      return `obd-partner:${values["partner_code"] ?? ""}`;
    }
    if (kind === "ACCOUNT") {
      return `obd-account:${values["account_code"] ?? ""}`;
    }
    if (kind === "STOCK") {
      return `obd-item:${values["item_sku"] ?? ""}`;
    }
    return null;
  },
  async existsInDb(values) {
    // One DRAFT per target — the same partial uniques the service enforces.
    const kind = values["kind"] ?? "";
    if (kind === "PARTNER") {
      const partner = await partnerStore.findPartnerByCode(values["partner_code"] ?? "");
      return partner === undefined
        ? false
        : (await partnerStore.findOpeningBalanceDocForPartner(partner.id)) !== undefined;
    }
    if (kind === "ACCOUNT") {
      const accountId = await partnerStore.accountIdByCode(values["account_code"] ?? "");
      return accountId === undefined
        ? false
        : (await partnerStore.findOpeningBalanceDocForAccount(accountId)) !== undefined;
    }
    if (kind === "STOCK") {
      const item = await store.findItemBySku(values["item_sku"] ?? "");
      return item === undefined
        ? false
        : (await partnerStore.findOpeningBalanceDocForItem(item.id)) !== undefined;
    }
    return false;
  },
  validate(values, errors) {
    const kind = values["kind"] ?? "";
    if (!["PARTNER", "ACCOUNT", "STOCK"].includes(kind)) {
      errors.push({ field: "kind", message: "kind must be PARTNER, ACCOUNT or STOCK" });
      return;
    }
    if (kind === "PARTNER") {
      if ((values["partner_code"] ?? "") === "") {
        errors.push({ field: "partner_code", message: "partner_code is required for PARTNER drafts" });
      }
      const amount = values["amount"] ?? "";
      if (amount === "" || Number.isNaN(Number(amount)) || Number(amount) === 0) {
        errors.push({ field: "amount", message: "a nonzero amount is required for PARTNER drafts" });
      }
    }
    if (kind === "ACCOUNT") {
      if ((values["account_code"] ?? "") === "") {
        errors.push({ field: "account_code", message: "account_code is required for ACCOUNT drafts" });
      }
      const amount = values["amount"] ?? "";
      if (amount === "" || Number.isNaN(Number(amount)) || Number(amount) === 0) {
        errors.push({ field: "amount", message: "a nonzero amount is required for ACCOUNT drafts" });
      }
    }
    if (kind === "STOCK") {
      if ((values["item_sku"] ?? "") === "") {
        errors.push({ field: "item_sku", message: "item_sku is required for STOCK drafts" });
      }
      const qty = values["qty"] ?? "";
      if (qty === "" || Number.isNaN(Number(qty)) || Number(qty) <= 0) {
        errors.push({ field: "qty", message: "qty > 0 is required for STOCK drafts" });
      }
      const unitCost = values["unit_cost"] ?? "";
      if (unitCost === "" || Number.isNaN(Number(unitCost)) || Number(unitCost) < 0) {
        errors.push({ field: "unit_cost", message: "unit_cost ≥ 0 is required for STOCK drafts" });
      }
    }
  },
  async checkReferences(values, errors) {
    const kind = values["kind"] ?? "";
    if (kind === "PARTNER" && (await partnerStore.findPartnerByCode(values["partner_code"] ?? "")) === undefined) {
      errors.push({ field: "partner_code", message: "unknown partner code in this tenant" });
    }
    if (kind === "ACCOUNT" && (await partnerStore.accountIdByCode(values["account_code"] ?? "")) === undefined) {
      errors.push({ field: "account_code", message: "unknown account code in this tenant" });
    }
    if (kind === "STOCK" && (await store.findItemBySku(values["item_sku"] ?? "")) === undefined) {
      errors.push({ field: "item_sku", message: "unknown item sku in this tenant" });
    }
  },
};

const HEADER_MAPS: Record<string, ColumnMap> = {
  PARTNERS: PARTNER_COLUMNS,
  ITEMS: ITEM_COLUMNS,
  OPENING_BALANCES: OBD_COLUMNS,
};
