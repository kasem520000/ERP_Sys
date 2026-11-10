import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { JobCardService, type JobCardLineInput } from "../../modules/sales/job-cards/application/job-card-service";
import * as jobCardsStore from "../../modules/sales/infrastructure/job-cards.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import { S_ACTOR, TENANT_S, setupSalesFixture, type SalesFixture } from "./fixtures";

/**
 * PHASE-017 T3 job-card state-machine packs (DB-backed on the real sales
 * fixture): the full lifecycle happy path (create → JC- number → diagnosis
 * → quotation → approve under `reserve` → hours → complete), the
 * no-ledger-before-INVOICED invariant (journal count snapshots), cancel
 * semantics (DRAFT clean, IN_PROGRESS releases the JOB_CARD holds,
 * invoiced cards NEVER cancel — credit notes), the line-type/kind and
 * hours gates, and JC- numbering distinctness.
 *
 * Invoicing intentionally stops at the typed
 * `sales/job-card-posting-not-configured` boundary — the T4 posting port
 * (4-a) is registered via setPostingPort; a stub port drives the
 * INVOICED-transition simulation for the never-cancel pack.
 */

let fixture: SalesFixture;
let service: JobCardService;
let laborItemId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const numbering = new NumberingService(audit);
  service = new JobCardService(audit, numbering);

  // The fixture items are STOCK kind — the LABOR fixture needs a SERVICE
  // item (priced from the labor rate, base 80/h here).
  await withTenant(TENANT_S, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const existing = await itemsStore.findItemBySku("S-LABOR");
    if (existing !== undefined) {
      laborItemId = existing.id;
      return;
    }
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const created = await itemsStore.insertItem({
      sku: "S-LABOR",
      name: "Workshop labor",
      nameAr: "أجور العمل",
      kind: "SERVICE",
      uomId: pcs.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: false,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: "80.000000",
    });
    laborItemId = created.id;
  });
});

/** Journal count over the whole tenant — the no-ledger invariant probe. */
async function countJournals(): Promise<number> {
  return withTenant(TENANT_S, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

const defaultLines = (): JobCardLineInput[] => [
  {
    lineType: "PARTS",
    itemId: fixture.items.a,
    qty: "2",
    unitPrice: "100",
    estimatedHours: null,
    discountAmount: null,
    taxCodeId: fixture.taxCodeIds.standard,
    description: "brake pads",
    descriptionAr: "فرامل",
    note: null,
  },
  {
    lineType: "LABOR",
    itemId: laborItemId,
    qty: "1",
    unitPrice: "80",
    estimatedHours: "1.5",
    discountAmount: null,
    taxCodeId: fixture.taxCodeIds.standard,
    description: "replace pads",
    descriptionAr: null,
    note: null,
  },
];

async function createCard(lines: readonly JobCardLineInput[] = defaultLines()) {
  return withTenant(TENANT_S, () =>
    service.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      vehicleId: null,
      warehouseId: fixture.warehouseId,
      partsIssueMode: "reserve",
      complaints: "brake noise",
      complaintsAr: "صوت فرامل",
      odometerKm: "125000.5",
      checkedInAt: null,
      note: null,
      noteAr: null,
      actorId: S_ACTOR,
      lines,
    }),
  );
}

describe("PHASE-017 T3 job cards: lifecycle, policies, validations", () => {
  it("happy path: create → JC- number → diagnosis → quotation → approve(reserve, zero ledger) → hours → complete; invoice needs the T4 port", async () => {
    const journalsAtStart = await countJournals();

    // 1. Check-in: DRAFT with the official JC- number (assigned at creation).
    const card = await createCard();
    expect(card.status).toBe("DRAFT");
    expect(card.cardNo).toMatch(/^JC-\d{4}-\d{5}$/);
    expect(card.partsIssueMode).toBe("reserve");
    expect(card.complaintsAr).toBe("صوت فرامل");
    const cardLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    expect(cardLines).toHaveLength(2);
    expect(cardLines.every((line) => line.status === "PENDING")).toBe(true);
    const labor = cardLines.find((line) => line.lineType === "LABOR")!;
    expect(labor.estimatedHours).toBe("1.500000");

    // 2. Diagnosis edit.
    const diagnosed = await withTenant(TENANT_S, () =>
      service.update(card.id, { diagnosis: "worn pads", diagnosisAr: "تآكل الفرامل", actorId: S_ACTOR }),
    );
    expect(diagnosed.diagnosis).toBe("worn pads");
    expect(diagnosed.diagnosisAr).toBe("تآكل الفرامل");

    // 3. Quotation from the card (BR-006): parts qty × price; labor
    //    qty = estimated hours at the per-hour rate.
    const quotation = await withTenant(TENANT_S, () =>
      service.generateQuotation(card.id, { actorId: S_ACTOR }),
    );
    expect(quotation.status).toBe("DRAFT");
    expect(quotation.totalNet).toBe("320.0000"); // 2×100 parts + 1.5×80 labor
    const linked = await withTenant(TENANT_S, () => service.find(card.id));
    expect(linked.quotationId).toBe(quotation.id);
    const quoteLines = await withTenant(TENANT_S, () => sStore.listQuotationLines(quotation.id));
    const laborQuote = quoteLines.find((line) => line.itemId === laborItemId)!;
    expect(laborQuote.qty).toBe("1.500000"); // estimated hours as the billed qty
    expect(laborQuote.unitPrice).toBe("80.000000"); // per-hour rate

    // 4. Approval under `reserve`: JOB_CARD-held availability holds, lines
    //    RESERVED, and ZERO journal entries (no ledger before INVOICED).
    const journalsBeforeApprove = await countJournals();
    const approved = await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    expect(approved.status).toBe("IN_PROGRESS");
    expect(approved.approvedAt).not.toBeNull();
    const activeLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const parts = activeLines.find((line) => line.lineType === "PARTS")!;
    const activeLabor = activeLines.find((line) => line.lineType === "LABOR")!;
    expect(parts.status).toBe("RESERVED");
    expect(parts.reservationId).not.toBeNull();
    expect(activeLabor.status).toBe("PENDING"); // labor is never reserved
    const reservation = await withTenant(TENANT_S, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(reservation?.holderType).toBe("JOB_CARD");
    expect(reservation?.holderId).toBe(card.id);
    expect(reservation?.status).toBe("ACTIVE");
    expect(await countJournals()).toBe(journalsBeforeApprove);

    // 5. Work execution: hours accumulate on the LABOR line only.
    await withTenant(TENANT_S, () =>
      service.logHours(card.id, activeLabor.id, { hours: "1", actorId: S_ACTOR }),
    );
    const executing = await withTenant(TENANT_S, () =>
      service.logHours(card.id, activeLabor.id, { hours: "0.5", actorId: S_ACTOR }),
    );
    expect(executing.laborHoursTotal).toBe("1.500000");
    const laborAfter = await withTenant(TENANT_S, () => jobCardsStore.findJobCardLineById(activeLabor.id));
    expect(laborAfter?.loggedHours).toBe("1.500000");

    // 6. Completion.
    const completed = await withTenant(TENANT_S, () => service.complete(card.id, { actorId: S_ACTOR }));
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    // 7. Invoicing is the T4 boundary — documented: without the posting
    //    port the typed not-configured error fires (4-a registers it).
    await expect(
      withTenant(TENANT_S, () => service.invoice(card.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "sales/job-card-posting-not-configured" });

    // 8. A COMPLETED card no longer cancels.
    await expect(
      withTenant(TENANT_S, () => service.cancel(card.id, { reason: "no longer needed", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "JOB_CARD_STATE" });

    // The whole DRAFT→COMPLETED chain posted NO ledger rows at all.
    expect(await countJournals()).toBe(journalsAtStart);
  });

  it("cancel: DRAFT clean; IN_PROGRESS releases the JOB_CARD holds; INVOICED never cancels", async () => {
    // (a) DRAFT clean cancel — audited, no ledger, reason on note (the
    //     migration's CHECK demands cancelled_at + note).
    const draft = await createCard();
    const cancelled = await withTenant(TENANT_S, () =>
      service.cancel(draft.id, { reason: "customer declined", actorId: S_ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.note).toBe("customer declined");
    const draftLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(draft.id));
    expect(draftLines.every((line) => line.status === "CANCELLED")).toBe(true);

    // (b) IN_PROGRESS under `reserve`: cancel releases the active holds.
    const active = await createCard();
    await withTenant(TENANT_S, () => service.approve(active.id, { actorId: S_ACTOR }));
    const activeLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(active.id));
    const parts = activeLines.find((line) => line.lineType === "PARTS")!;
    const reservationId = parts.reservationId!;
    expect((await withTenant(TENANT_S, () => inventoryStore.findReservationById(reservationId)))?.status).toBe("ACTIVE");
    const cancelledActive = await withTenant(TENANT_S, () =>
      service.cancel(active.id, { reason: "customer changed mind", actorId: S_ACTOR }),
    );
    expect(cancelledActive.status).toBe("CANCELLED");
    expect(
      (await withTenant(TENANT_S, () => inventoryStore.findReservationById(reservationId)))?.status,
    ).toBe("RELEASED");

    // (c) INVOICED (simulated via a stub T4 port driving the real service
    //     transition) can NEVER cancel — corrections are credit notes.
    const invoiced = await createCard();
    await withTenant(TENANT_S, () => service.approve(invoiced.id, { actorId: S_ACTOR }));
    await withTenant(TENANT_S, () => service.complete(invoiced.id, { actorId: S_ACTOR }));
    service.setPostingPort({
      issuePartsImmediate: async () => {},
      invoiceCard: async () => ({
        invoiceId: "eeeeeeee-0000-4000-8000-0000000000e1",
        invoiceNo: "INV-2026-000001",
        journalEntryId: "eeeeeeee-0000-4000-8000-0000000000e2",
        cogsJournalEntryId: "eeeeeeee-0000-4000-8000-0000000000e3",
      }),
    });
    const invoicedCard = await withTenant(TENANT_S, () => service.invoice(invoiced.id, { actorId: S_ACTOR }));
    expect(invoicedCard.status).toBe("INVOICED");
    expect(invoicedCard.invoiceId).toBe("eeeeeeee-0000-4000-8000-0000000000e1");
    const invoicedLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(invoiced.id));
    expect(invoicedLines.every((line) => line.status === "INVOICED")).toBe(true);
    service.setPostingPort(null);
    await expect(
      withTenant(TENANT_S, () => service.cancel(invoiced.id, { reason: "oops", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "JOB_CARD_NOT_CANCELABLE" });
  });

  it("validations: line-type/kind gates, LABOR hours, logHours line + card-state gates", async () => {
    const base = {
      lineType: "PARTS" as const,
      itemId: fixture.items.a,
      qty: "2",
      unitPrice: "100",
      estimatedHours: null as string | null,
      discountAmount: null,
      taxCodeId: fixture.taxCodeIds.standard,
      description: null,
      descriptionAr: null,
      note: null,
    };
    // PARTS on a SERVICE item.
    await expect(
      createCard([{ ...base, lineType: "PARTS", itemId: laborItemId }]),
    ).rejects.toMatchObject({ code: "JOB_CARD_LINE_INVALID" });
    // LABOR on a STOCK item.
    await expect(
      createCard([{ ...base, lineType: "LABOR", itemId: fixture.items.a, estimatedHours: "1.5" }]),
    ).rejects.toMatchObject({ code: "JOB_CARD_LINE_INVALID" });
    // LABOR without estimatedHours (the billed quantity).
    await expect(
      createCard([{ ...base, lineType: "LABOR", itemId: laborItemId, estimatedHours: null }]),
    ).rejects.toMatchObject({ code: "JOB_CARD_LINE_INVALID" });

    // logHours on a PARTS line (after approval so the card is workable).
    const worked = await createCard();
    await withTenant(TENANT_S, () => service.approve(worked.id, { actorId: S_ACTOR }));
    const workedLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(worked.id));
    const partsLine = workedLines.find((line) => line.lineType === "PARTS")!;
    await expect(
      withTenant(TENANT_S, () => service.logHours(worked.id, partsLine.id, { hours: "1", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "JOB_CARD_LINE_INVALID" });

    // logHours on a DRAFT card.
    const draft = await createCard();
    const draftLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(draft.id));
    const draftLabor = draftLines.find((line) => line.lineType === "LABOR")!;
    await expect(
      withTenant(TENANT_S, () => service.logHours(draft.id, draftLabor.id, { hours: "1", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "JOB_CARD_STATE" });
  });

  it("distinct JC- numbers for two cards (the JC- series is per tenant-year)", async () => {
    const one = await createCard();
    const two = await createCard();
    expect(one.cardNo).toMatch(/^JC-\d{4}-\d{5}$/);
    expect(two.cardNo).toMatch(/^JC-\d{4}-\d{5}$/);
    expect(one.cardNo).not.toBe(two.cardNo);
  });

  it("PUT semantics: DRAFT full-replace preserves provided line ids and input order; non-DRAFT rejects", async () => {
    const card = await createCard();
    const original = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const parts = original.find((line) => line.lineType === "PARTS")!;
    const oldLabor = original.find((line) => line.lineType === "LABOR")!;

    const updated = await withTenant(TENANT_S, () =>
      service.update(card.id, {
        diagnosis: "resurface discs",
        lines: [
          { ...defaultLines()[0]!, id: parts.id, qty: "3", unitPrice: "90" },
          { ...defaultLines()[1]!, id: null, estimatedHours: "2", unitPrice: "70" },
        ],
        actorId: S_ACTOR,
      }),
    );
    expect(updated.diagnosis).toBe("resurface discs");
    const replaced = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const live = replaced.filter((line) => line.status !== "CANCELLED");
    expect(live).toHaveLength(2);
    // The PARTS row id survived with the new qty/price, at position 1.
    const kept = live.find((line) => line.id === parts.id)!;
    expect(kept.lineNo).toBe(1);
    expect(kept.qty).toBe("3.000000");
    expect(kept.unitPrice).toBe("90.000000");
    // The new LABOR row carries its hours at position 2; the unmentioned old
    // LABOR row is tombstoned CANCELLED (never deleted — grant model).
    expect(live.some((line) => line.id === oldLabor.id)).toBe(false);
    const newLabor = live.find((line) => line.lineType === "LABOR")!;
    expect(newLabor.lineNo).toBe(2);
    expect(newLabor.estimatedHours).toBe("2.000000");
    const tombstone = replaced.find((line) => line.id === oldLabor.id)!;
    expect(tombstone.status).toBe("CANCELLED");

    // Full-replace is DRAFT-only.
    await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    await expect(
      withTenant(TENANT_S, () =>
        service.update(card.id, { lines: defaultLines(), actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "JOB_CARD_STATE" });
  });
});
