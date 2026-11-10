import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/tax.store";
import {
  JurisdictionNotFoundError,
  TaxCodeArchivedError,
  TaxCodeInUseError,
  TaxCodeNotFoundError,
  TaxCodeTakenError,
} from "../domain/tax-errors";

/**
 * PHASE-009 T5 — tax codes service: tenant-unique codes (per jurisdiction),
 * bilingual names, default treatment bound to a seeded pack. Codes are the
 * resolver's input binder; items (and categories) carry their defaults via
 * the FK this phase wired (items.tax_code_id + item_categories.default_
 * tax_code_id). Archive is reference-guarded — never a silent dangling FK.
 */
@Injectable()
export class TaxCodesService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { countryCode?: string; status?: string }) {
    return store.listTaxCodes(filter);
  }

  async find(id: string) {
    const code = await store.findTaxCodeById(id);
    if (code === undefined) throw new TaxCodeNotFoundError(id);
    return code;
  }

  async create(input: {
    code: string;
    name: string;
    nameAr: string | null;
    countryCode: string;
    defaultTreatment: string;
    actorId: string | null;
  }) {
    const jurisdiction = await store.findJurisdictionByCountry(input.countryCode);
    if (jurisdiction === undefined) throw new JurisdictionNotFoundError(input.countryCode);
    const existing = (await store.listTaxCodes({ countryCode: input.countryCode })).find(
      (row) => row.code === input.code,
    );
    if (existing !== undefined) {
      throw new TaxCodeTakenError({ code: input.code, countryCode: input.countryCode });
    }
    const created = await store.insertTaxCode({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      countryCode: input.countryCode,
      defaultTreatment: input.defaultTreatment,
      snapshotPolicy: "STAMP_AT_POSTING",
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "tax.code_created",
      entityType: "tax_code",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        countryCode: created.countryCode,
        defaultTreatment: created.defaultTreatment,
      },
    });
    return created;
  }

  async archive(id: string, actorId: string | null) {
    const code = await this.find(id);
    if (code.status === "ARCHIVED") throw new TaxCodeArchivedError(id);
    const refs = await store.countTaxCodeReferences(id);
    if (refs.items > 0 || refs.categories > 0) {
      throw new TaxCodeInUseError({ id, items: refs.items, categories: refs.categories });
    }
    await store.archiveTaxCode(id);
    await this.audit.record({
      action: "tax.code_archived",
      entityType: "tax_code",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "ACTIVE" },
      after: { status: "ARCHIVED" },
    });
    return store.findTaxCodeById(id);
  }
}
