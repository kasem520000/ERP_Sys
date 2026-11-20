import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { OpeningStockService } from "../../modules/inventory/application/opening-stock-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ServiceOrderService } from "../../modules/crm/application/service-order-service";
import { ServiceOrderPosting } from "../../modules/crm/application/service-order-posting";
import { FieldserviceService } from "../../modules/crm/application/fieldservice-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import {
  FieldserviceInputInvalidError,
  ServiceOrderCancelledError,
  ServiceVisitStateError,
  ServiceVisitTechnicianRequiredError,
  SlaRegisterMalformedError,
} from "../../modules/crm/domain/projects-errors";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import {
  ensureP1BudgetWorld,
  mapPjwPurpose,
  setPjwSetting,
  PJW_ACTOR,
  TENANT_PJW,
} from "./fixtures";

/**
 * PHASE-048 (W-12 — T-13) — the field service pinned over real
 * PostgreSQL 16 (the plan §4's `projects-fieldservice.db.spec` —
 * acceptance #8's API arms: the SLA test matrix): the dispatch board's
 * status machine on service_visits (D-12 — NEW → SCHEDULED → DISPATCHED
 * → IN_PROGRESS → COMPLETED → CLOSED, the 0103 stamp law), the SINGLE
 * clock service with pause states (both clocks pause-aware, the history
 * on the append-only audit trail), BR-096's breach escalation (the
 * deduped inbox notification — once per (visit, clock) ever), and the
 * parts-used record through THE SERVICE-ORDER LINE ISSUE PATH (the WMS
 * movement core — zero parallel stock writes).
 *
 * THE DEDICATED WORLD (the PJW tenant, the family's own): a customer
 * partner PJW-FS-CUST + the SERVICE item PJW-FEE-HR (the fixture's own)
 * + the STOCK item PJW-FS-PART (opening ×20 @ 40.000000 WAC at PJW-WH)
 * + the technician PJW-EMP-1 (the fixture's employee) + a SUSPENDED
 * technician (the live-technician law's refusal arm). The SLA clock's
 * RAW INPUTS are backdated by DIRECT SQL on the substrate (the
 * fixture-seed precedent — the honest alternative to sleeping three
 * hours): dispatched_at/the response stamp/the completion stamp move on
 * service_visits, and the pause HISTORY rides seeded audit_events rows
 * (INSERT-only — the append-only guard permits it; UPDATE never).
 *
 * THE POISONED-TRANSACTION LAW (the W-11 lesson, now permanent): every
 * REFUSAL arm runs against ITS OWN visit/order world created inside the
 * arm — no arm shares a surrounding transaction or a row with any other
 * arm; a refusal can never poison a later arm's state.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const reservations = new ReservationService(audit);
const postings = new ServiceOrderPosting(posting, invoices, reservations);
const serviceOrders = new ServiceOrderService(audit, numbering);
serviceOrders.setPostingPort(postings);
const inbox = new InboxService();
const fieldservice = new FieldserviceService(audit, inbox, postings);

const HOUR = 3_600_000;

let customerId = "";
let partsItemId = "";
let serviceItemId = "";
let warehouseId = "";
let branchId = "";
let technicianId = "";
let suspendedTechnicianId = "";
let fiscalReady = false;

/** The opening stock's golden: PJW-FS-PART ×20 @ 40.000000 (delta-based
 * stock asserts never see the absolute size — the sales-fixture law). */
const OPENING_QTY = 20;
const OPENING_UNIT = "40.000000";

beforeAll(async () => {
  await ensureP1BudgetWorld();
  const su = await superuserClient();

  // The OPENING_EQUITY purpose (the opening-stock leg's credit side —
  // the service-orders fixture set; idempotent via mapPjwPurpose).
  await su.end();
  const capitalAccount = await withTenant(TENANT_PJW, async () => {
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const account = await accounting.findAccountByCode("3100");
    if (account === undefined) throw new Error("fixture account 3100 missing");
    return account.id;
  });
  await mapPjwPurpose("OPENING_EQUITY", capitalAccount);

  await withTenant(TENANT_PJW, async () => {
    // The customer the service orders bill (the fixture has only the
    // supplier PJW-SUB-A).
    const existingCustomer = await partnersStore.findPartnerByCode("PJW-FS-CUST");
    customerId =
      existingCustomer?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "PJW-FS-CUST",
          name: "The field-service customer (PJW)",
          nameAr: "عميل الخدمة الميدانية",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;

    // The STOCK parts item (PCS) — the parts-used record's substrate.
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const existingPart = await itemsStore.findItemBySku("PJW-FS-PART");
    partsItemId =
      existingPart?.id ??
      (
        await itemsStore.insertItem({
          sku: "PJW-FS-PART",
          name: "Field-service parts kit",
          nameAr: "طقم قطع الخدمة الميدانية",
          kind: "STOCK",
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
          basePrice: "90.000000",
        })
      ).id;

    const fixture = (await import("./fixtures")).pjw();
    serviceItemId = fixture.feeItemId;
    warehouseId = fixture.warehouseId;
    technicianId = fixture.employeeId;
  });

  // The branch id (the service order's branchId — the MAIN branch the
  // fixture created).
  const suBranch = await superuserClient();
  const branch = await suBranch.query<{ id: string }>(
    `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'MAIN' LIMIT 1`,
    [TENANT_PJW],
  );
  branchId = branch.rows[0]!.id;

  // The SUSPENDED technician (the live-technician law's refusal arm).
  await suBranch.query(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status, created_by)
     VALUES ($1, $2, 'PJW-FS-SUSP', 'Suspended technician', '2024-01-01', 'FULL_TIME', 5000, 'SUSPENDED', $3)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    ["6f6f6f6f-0000-4000-8000-000000000f01", TENANT_PJW, PJW_ACTOR],
  );
  suspendedTechnicianId = "6f6f6f6f-0000-4000-8000-000000000f01";

  // Opening stock at PJW-WH (the service-orders fixture pattern): the
  // DRAFT doc + the real OpeningStockService post (the engine's own
  // journal — OPENING_EQUITY × INVENTORY).
  const suStock = await superuserClient();
  const existingStockDoc = await suStock.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM opening_balance_docs WHERE tenant_id = $1 AND item_id = $2`,
    [TENANT_PJW, partsItemId],
  );
  if ((existingStockDoc.rows[0]?.n ?? 0) === 0) {
    await suStock.query(
      `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
       VALUES (gen_random_uuid(), $1, 'STOCK', $2, $3, $4, 'SAR', 'DRAFT')`,
      [TENANT_PJW, partsItemId, OPENING_QTY, OPENING_UNIT],
    );
  }
  await suStock.end();
  await withTenant(TENANT_PJW, () =>
    new OpeningStockService(audit, posting).post({ warehouseId, actorId: PJW_ACTOR }),
  );
  fiscalReady = true;

  await suBranch.end();
}, 300_000);

afterAll(async () => {
  // The register returns to the unset state for any later family run.
  await setPjwSetting("projects.fieldservice_sla_targets", null);
  await closeDb();
});

// -- the world helpers ---------------------------------------------------------

interface LineInput {
  lineType: "SERVICE" | "PARTS";
  itemId: string;
  qty: string | null;
  unitPrice: string | null;
  estimatedHours: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

const serviceLine = (): LineInput => ({
  lineType: "SERVICE",
  itemId: serviceItemId,
  qty: null,
  unitPrice: "250",
  estimatedHours: "2",
  description: "Field hours",
  descriptionAr: "ساعات ميدانية",
  note: null,
});

const partsLine = (qty = "2"): LineInput => ({
  lineType: "PARTS",
  itemId: partsItemId,
  qty,
  unitPrice: "90",
  estimatedHours: null,
  description: "Parts used",
  descriptionAr: "قطع مستخدمة",
  note: null,
});

/** A fresh service order through the REAL service (the machine's world —
 * every arm builds its own; the poisoned-transaction law). */
async function createOrder(lines: readonly LineInput[] = [serviceLine()]): Promise<string> {
  return withTenant(TENANT_PJW, () =>
    serviceOrders.create({
      branchId,
      partnerId: customerId,
      contractId: null,
      warehouseId,
      note: "the W-12 fieldservice world",
      noteAr: null,
      actorId: PJW_ACTOR,
      lines,
    }),
  ).then((order) => order.id);
}

/** A fresh NEW visit on its own order. */
async function createVisit(input?: {
  lines?: readonly LineInput[];
  technician?: string | null;
  serviceOrderId?: string;
}): Promise<{ visitId: string; orderId: string }> {
  const orderId = input?.serviceOrderId ?? (await createOrder(input?.lines));
  const visit = await withTenant(TENANT_PJW, () =>
    fieldservice.createVisit({
      serviceOrderId: orderId,
      technicianEmployeeId: input?.technician ?? null,
      scheduledStart: "2026-11-20T08:00:00Z",
      scheduledEnd: "2026-11-20T12:00:00Z",
      note: "the visit",
      noteAr: "الزيارة",
      actorId: PJW_ACTOR,
    }),
  );
  return { visitId: visit.id, orderId };
}

/** Backdate the clock's raw input stamps by DIRECT SQL (the fixture-seed
 * precedent — the honest alternative to sleeping hours). */
async function backdateStamps(
  visitId: string,
  offsets: { dispatchedHours?: number; respondedHours?: number; completedHours?: number },
): Promise<void> {
  const su = await superuserClient();
  const sets: string[] = [];
  const params: unknown[] = [visitId];
  const push = (column: string, hours: number | undefined): void => {
    if (hours === undefined) return;
    params.push(hours);
    sets.push(`${column} = now() - ($${params.length}::double precision * interval '1 hour')`);
  };
  push("dispatched_at", offsets.dispatchedHours);
  push("first_responded_at", offsets.respondedHours);
  push("completed_at", offsets.completedHours);
  await su.query(
    `UPDATE service_visits SET ${sets.join(", ")} WHERE id = $1`,
    params,
  );
  await su.end();
}

/** Seed ONE pause interval on the append-only audit trail (INSERTs with
 * an explicit at — the guard permits INSERT, never UPDATE/DELETE). Both
 * events land in a SINGLE statement so the pair shares ONE now(): the
 * interval's length is EXACT (two statements' now() differ by the
 * inter-statement skew — the first run's honest finding, corrected
 * here at the claim site). */
async function seedPauseInterval(
  visitId: string,
  pausedHoursAgo: number,
  resumedHoursAgo: number,
): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `WITH t AS (SELECT now() AS ts)
     INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, at)
     SELECT gen_random_uuid(), $1::uuid, 'crm.service_visit.paused', 'service_visit', $2::uuid,
            t.ts - ($3::double precision * interval '1 hour') FROM t
     UNION ALL
     SELECT gen_random_uuid(), $1::uuid, 'crm.service_visit.resumed', 'service_visit', $2::uuid,
            t.ts - ($4::double precision * interval '1 hour') FROM t`,
    [TENANT_PJW, visitId, pausedHoursAgo, resumedHoursAgo],
  );
  await su.end();
}

/** The escalation notification rows for a visit (the dedupe-key prefix). */
async function escalationRows(visitId: string): Promise<
  { dedupeKey: string; category: string; severity: string; userId: string | null }[]
> {
  const su = await superuserClient();
  const rows = await su.query<{
    dedupe_key: string;
    category: string;
    severity: string;
    user_id: string | null;
  }>(
    `SELECT dedupe_key, category, severity, user_id FROM notifications
     WHERE dedupe_key LIKE $1`,
    [`fieldservice-sla-breach:${visitId}:%`],
  );
  await su.end();
  return rows.rows.map((row) => ({
    dedupeKey: row.dedupe_key,
    category: row.category,
    severity: row.severity,
    userId: row.user_id,
  }));
}

async function notificationCount(): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications`);
  await su.end();
  return rows.rows[0]!.n;
}

/** The visit's audit actions (the leads.spec read pattern). */
async function auditActions(visitId: string): Promise<string[]> {
  const su = await superuserClient();
  const rows = await su.query<{ action: string }>(
    `SELECT action FROM audit_events WHERE entity_type = 'service_visit' AND entity_id = $1 ORDER BY at`,
    [visitId],
  );
  await su.end();
  return rows.rows.map((row) => row.action);
}

async function stockQty(): Promise<string> {
  return withTenant(TENANT_PJW, async () => {
    const row = await inventoryStore.findItemStock(partsItemId, warehouseId);
    if (row === undefined) throw new Error("no stock row for PJW-FS-PART");
    return row.qty;
  });
}

async function journalCount(): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM journal_entries
     WHERE source_type = 'service_order'`,
  );
  await su.end();
  return rows.rows[0]!.n;
}

// -- 1. the machine (D-12's status ladder) --------------------------------------

describe("W-12 fieldservice — the status machine (the 0103 stamp law)", () => {
  it("(a) the golden lifecycle: every state's stamps land exactly (NEW → … → CLOSED)", async () => {
    expect(fiscalReady).toBe(true);
    const { visitId } = await createVisit({ technician: technicianId });

    // NEW: the machine's floor — every stamp NULL.
    let visit = await withTenant(TENANT_PJW, () => fieldservice.find(visitId));
    expect(visit.status).toBe("NEW");
    expect(visit.dispatchedAt).toBeNull();
    expect(visit.firstRespondedAt).toBeNull();
    expect(visit.startedAt).toBeNull();
    expect(visit.completedAt).toBeNull();
    expect(visit.closedAt).toBeNull();
    expect(visit.isPaused).toBe(false);

    // SCHEDULED: the window lands; still no machine stamps.
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.schedule(visitId, {
        scheduledStart: "2026-11-21T08:00:00Z",
        scheduledEnd: "2026-11-21T12:00:00Z",
        technicianEmployeeId: technicianId,
        actorId: PJW_ACTOR,
      }),
    );
    expect(visit.status).toBe("SCHEDULED");
    expect(Date.parse(visit.scheduledStart)).toBe(Date.parse("2026-11-21T08:00:00Z"));
    expect(visit.dispatchedAt).toBeNull();

    // DISPATCHED: dispatched_at stamps; the clocks' start.
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    expect(visit.status).toBe("DISPATCHED");
    expect(visit.dispatchedAt).not.toBeNull();
    expect(visit.technicianEmployeeId).toBe(technicianId);
    expect(visit.startedAt).toBeNull();

    // The response event — idempotent (the second call returns the SAME
    // stamp, zero writes).
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.respond(visitId, { actorId: PJW_ACTOR }),
    );
    expect(visit.firstRespondedAt).not.toBeNull();
    const firstResponse = visit.firstRespondedAt;
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.respond(visitId, { actorId: PJW_ACTOR }),
    );
    expect(visit.firstRespondedAt).toBe(firstResponse);

    // IN_PROGRESS: started_at stamps.
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.start(visitId, { actorId: PJW_ACTOR }),
    );
    expect(visit.status).toBe("IN_PROGRESS");
    expect(visit.startedAt).not.toBeNull();

    // The pause pair — idempotent replays return unchanged rows.
    visit = await withTenant(TENANT_PJW, () => fieldservice.pause(visitId, { actorId: PJW_ACTOR }));
    expect(visit.isPaused).toBe(true);
    visit = await withTenant(TENANT_PJW, () => fieldservice.pause(visitId, { actorId: PJW_ACTOR }));
    expect(visit.isPaused).toBe(true);
    visit = await withTenant(TENANT_PJW, () => fieldservice.resume(visitId, { actorId: PJW_ACTOR }));
    expect(visit.isPaused).toBe(false);
    visit = await withTenant(TENANT_PJW, () => fieldservice.resume(visitId, { actorId: PJW_ACTOR }));
    expect(visit.isPaused).toBe(false);

    // COMPLETED: the notes land; the stamp stamps.
    visit = await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: "Pump replaced; tested 30 minutes.",
        completionNotesAr: "استُبدل المضخة وتم الاختبار ثلاثين دقيقة.",
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    ).then((result) => result.visit);
    expect(visit.status).toBe("COMPLETED");
    expect(visit.completedAt).not.toBeNull();
    expect(visit.completionNotes).toBe("Pump replaced; tested 30 minutes.");

    // CLOSED: terminal.
    visit = await withTenant(TENANT_PJW, () => fieldservice.close(visitId, { actorId: PJW_ACTOR }));
    expect(visit.status).toBe("CLOSED");
    expect(visit.closedAt).not.toBeNull();

    // The audit trail — the machine's every move + the pause history.
    expect(await auditActions(visitId)).toEqual([
      "crm.service_visit.created",
      "crm.service_visit.scheduled",
      "crm.service_visit.dispatched",
      "crm.service_visit.responded",
      "crm.service_visit.started",
      "crm.service_visit.paused",
      "crm.service_visit.resumed",
      "crm.service_visit.completed",
      "crm.service_visit.closed",
    ]);
  });

  it("(b) the start catch-up: starting the work IS a response (the never-unstamped-clock law)", async () => {
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.schedule(visitId, {
        scheduledStart: "2026-11-21T08:00:00Z",
        scheduledEnd: "2026-11-21T12:00:00Z",
        technicianEmployeeId: technicianId,
        actorId: PJW_ACTOR,
      }),
    );
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    // No respond() — the start stamps the response itself.
    const visit = await withTenant(TENANT_PJW, () =>
      fieldservice.start(visitId, { actorId: PJW_ACTOR }),
    );
    expect(visit.status).toBe("IN_PROGRESS");
    expect(visit.firstRespondedAt).not.toBeNull();
  });

  it("(c) the completed-while-paused law: the flag releases in the same CAS + the history closes", async () => {
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.schedule(visitId, {
        scheduledStart: "2026-11-21T08:00:00Z",
        scheduledEnd: "2026-11-21T12:00:00Z",
        technicianEmployeeId: technicianId,
        actorId: PJW_ACTOR,
      }),
    );
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    await withTenant(TENANT_PJW, () => fieldservice.pause(visitId, { actorId: PJW_ACTOR }));
    const result = await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: "Closed while paused.",
        completionNotesAr: null,
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    );
    expect(result.visit.status).toBe("COMPLETED");
    expect(result.visit.isPaused).toBe(false); // the 0103 CHECK's own demand
    // The honest history close: the closing RESUMED lands at completion.
    const actions = await auditActions(visitId);
    expect(actions.filter((a) => a === "crm.service_visit.resumed")).toHaveLength(1);
  });
});

// -- 2. the refusals (each arm its OWN world — the poisoned-transaction law) -----

describe("W-12 fieldservice — the typed refusals (the CAS ladder's walls)", () => {
  it("(a) schedule refuses past the planning plane", async () => {
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.schedule(visitId, {
        scheduledStart: "2026-11-21T08:00:00Z",
        scheduledEnd: "2026-11-21T12:00:00Z",
        technicianEmployeeId: technicianId,
        actorId: PJW_ACTOR,
      }),
    );
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.schedule(visitId, {
          scheduledStart: "2026-11-22T08:00:00Z",
          scheduledEnd: "2026-11-22T12:00:00Z",
          technicianEmployeeId: technicianId,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
  });

  it("(b) dispatch refuses off the planning plane; the technician is required", async () => {
    const { visitId } = await createVisit({ technician: null });
    // No technician on the row, none in the input — the board's law.
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(ServiceVisitTechnicianRequiredError);
    // With the technician in the INPUT the dispatch passes (the row
    // itself never carried one).
    const visit = await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: technicianId, actorId: PJW_ACTOR }),
    );
    expect(visit.status).toBe("DISPATCHED");
  });

  it("(c) the unknown + the suspended technician refuse", async () => {
    const { visitId } = await createVisit({ technician: null });
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.dispatch(visitId, {
          technicianEmployeeId: "11111111-1111-4111-8111-111111111111",
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.dispatch(visitId, {
          technicianEmployeeId: suspendedTechnicianId,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
    const visit = await withTenant(TENANT_PJW, () => fieldservice.find(visitId));
    expect(visit.status).toBe("NEW"); // untouched by the refusals
  });

  it("(d) start/complete/close/respond each refuse off their own plane", async () => {
    // start on NEW.
    const startWorld = await createVisit({ technician: technicianId });
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.start(startWorld.visitId, { actorId: PJW_ACTOR })),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
    // respond on NEW (the response needs the dispatch stamp).
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.respond(startWorld.visitId, { actorId: PJW_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
    // complete on DISPATCHED.
    const completeWorld = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(completeWorld.visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.complete(completeWorld.visitId, {
          completionNotes: null,
          completionNotesAr: null,
          issueParts: false,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
    // close on IN_PROGRESS.
    const closeWorld = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(closeWorld.visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(closeWorld.visitId, { actorId: PJW_ACTOR }));
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.close(closeWorld.visitId, { actorId: PJW_ACTOR })),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
    // pause on DISPATCHED (the clock exists on the in-progress plane
    // ONLY — the completeWorld visit still sits at DISPATCHED).
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.pause(completeWorld.visitId, { actorId: PJW_ACTOR })),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
  });

  it("(e) CLOSED is terminal — the second close refuses", async () => {
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: technicianId, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: null,
        completionNotesAr: null,
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.close(visitId, { actorId: PJW_ACTOR }));
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.close(visitId, { actorId: PJW_ACTOR })),
    ).rejects.toBeInstanceOf(ServiceVisitStateError);
  });

  it("(f) the cancelled-order law: no visit writes on a CANCELLED order", async () => {
    const orderId = await createOrder();
    await withTenant(TENANT_PJW, () =>
      serviceOrders.cancel(orderId, { reason: "the W-12 cancelled-order arm", actorId: PJW_ACTOR }),
    );
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.createVisit({
          serviceOrderId: orderId,
          technicianEmployeeId: null,
          scheduledStart: "2026-11-21T08:00:00Z",
          scheduledEnd: "2026-11-21T12:00:00Z",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceOrderCancelledError);
  });

  it("(g) the window law: inverted windows and malformed timestamps refuse", async () => {
    const orderId = await createOrder();
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.createVisit({
          serviceOrderId: orderId,
          technicianEmployeeId: null,
          scheduledStart: "2026-11-21T12:00:00Z",
          scheduledEnd: "2026-11-21T08:00:00Z",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.createVisit({
          serviceOrderId: orderId,
          technicianEmployeeId: null,
          scheduledStart: "not-a-timestamp",
          scheduledEnd: "2026-11-21T08:00:00Z",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
    // The unknown order refuses too.
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.createVisit({
          serviceOrderId: "11111111-1111-4111-8111-111111111111",
          technicianEmployeeId: null,
          scheduledStart: "2026-11-21T08:00:00Z",
          scheduledEnd: "2026-11-21T12:00:00Z",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
  });

  it("(h) the board: filters + the unknown-status typed refusal; a PURE read", async () => {
    const { visitId } = await createVisit({ technician: technicianId });
    const before = await notificationCount();
    const rows = await withTenant(TENANT_PJW, () =>
      fieldservice.board({ technicianEmployeeId: technicianId, limit: 50 }),
    );
    expect(rows.some((row) => row.id === visitId)).toBe(true);
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.board({ status: "PAUSED" })),
    ).rejects.toBeInstanceOf(FieldserviceInputInvalidError);
    // The pure-read law: no escalation ever fires on the listing.
    expect(await notificationCount()).toBe(before);
  });

  // PHASE-048 (W-13 — T-16): the board listing's PRESENTATION JOIN — the
  // parent service order's own number + the technician's own names ride
  // the listing rows (read-side enrichment, additive; the engine's own
  // figures never change — the dashboard renders handles, not bare uuids).
  it("(i) the board listing carries the order's own number + the technician's own names (the W-13 presentation join)", async () => {
    const { visitId, orderId } = await createVisit({ technician: technicianId });
    const orderNo = await withTenant(TENANT_PJW, async () => {
      const crmStore = await import("../../modules/crm/infrastructure/crm.store");
      const order = await crmStore.findServiceOrderById(orderId);
      return order?.orderNo;
    });
    expect(orderNo).toBeDefined();
    const rows = await withTenant(TENANT_PJW, () =>
      fieldservice.board({ serviceOrderId: orderId, limit: 10 }),
    );
    const row = rows.find((candidate) => candidate.id === visitId);
    expect(row).toBeDefined();
    // The parent order's own number (the dashboard's human handle).
    expect(row!.orderNo).toBe(orderNo);
    // The technician's own names (the PJW fixture's employee row).
    expect(row!.technicianName).toBe("Lina Al-Muhandisa");
    expect(row!.technicianNameAr).toBe("لينا المهندسة");
  });
});

// -- 3. the single clock (the SLA test matrix — BR-096) --------------------------

describe("W-12 fieldservice — the single clock (pause-aware SLA + BR-096)", () => {
  it("(a) NO_TARGET: the unset register is the honest absence — no breach, no escalation", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", null);
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await backdateStamps(visitId, { dispatchedHours: 48 });
    const before = await notificationCount();
    const evaluation = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(evaluation.targets).toBeNull();
    expect(evaluation.response.targetMs).toBeNull();
    expect(evaluation.response.breached).toBe(false);
    expect(evaluation.resolution.breached).toBe(false);
    expect(evaluation.escalations).toEqual([]);
    expect(await notificationCount()).toBe(before);
  });

  it("(b) the response breach + THE ESCALATION (once per (visit, clock) ever)", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: 1,
      resolution_target_hours: 100,
    });
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    // Backdate the dispatch 3h (no response, no pause): the response
    // clock reads ~3h against the 1h target — breached by ~2h.
    await backdateStamps(visitId, { dispatchedHours: 3 });
    const first = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(first.response.breached).toBe(true);
    expect(first.response.overMs).toBeGreaterThanOrEqual(2 * HOUR - 60_000);
    expect(first.resolution.breached).toBe(false); // 100h target
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]!.clock).toBe("RESPONSE");
    expect(first.escalations[0]!.notified).toBe(true);

    // The dedupe: the re-evaluation reports notified:false and the row
    // count stays ONE (the once-per-event law — BR-096's proof).
    const second = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(second.response.breached).toBe(true);
    expect(second.escalations[0]!.notified).toBe(false);
    const rows = await escalationRows(visitId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("crm");
    expect(rows[0]!.severity).toBe("warning");
    expect(rows[0]!.dedupeKey).toBe(`fieldservice-sla-breach:${visitId}:RESPONSE`);
  });

  it("(c) THE PAUSE SUBTRACTION: 6h wall − 3h paused = 3h on the resolution clock", async () => {
    // Twin register states on ONE visit: the 4h target holds (3h < 4h —
    // no breach, no escalation), then the 2h target breaches by ~1h.
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: 100,
      resolution_target_hours: 4,
    });
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    // The clock's raw inputs: dispatched 6h ago; a seeded pause interval
    // [now−5h, now−2h] — 3h EXACTLY inside the window (one statement's
    // one now()).
    await backdateStamps(visitId, { dispatchedHours: 6, respondedHours: 5.5 });
    await seedPauseInterval(visitId, 5, 2);

    const within = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(within.resolution.pausedMs).toBe(3 * HOUR); // EXACT — the interval is
    expect(within.resolution.elapsedMs).toBeGreaterThanOrEqual(3 * HOUR);
    expect(within.resolution.elapsedMs).toBeLessThanOrEqual(3 * HOUR + 60_000);
    expect(within.resolution.breached).toBe(false); // 3h < 4h
    expect(within.escalations).toEqual([]);
    // The response window [−6h, −5.5h] closes before the pause opens →
    // the response clock subtracts nothing (the window clamp's proof).
    expect(within.response.pausedMs).toBe(0);
    expect(within.response.elapsedMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(within.response.elapsedMs).toBeLessThanOrEqual(30 * 60_000 + 60_000);

    // Tighten the target below the elapsed: breached by ~1h, escalated.
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: 100,
      resolution_target_hours: 2,
    });
    const over = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(over.resolution.breached).toBe(true);
    expect(over.resolution.overMs).toBeGreaterThanOrEqual(HOUR - 60_000);
    expect(over.escalations).toHaveLength(1);
    expect(over.escalations[0]!.clock).toBe("RESOLUTION");
    expect(over.escalations[0]!.notified).toBe(true);
  });

  it("(d) the frozen clock: a completed visit's readings never move + the once-only escalation", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: 1,
      resolution_target_hours: 1,
    });
    const { visitId } = await createVisit({ technician: technicianId });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: "done",
        completionNotesAr: null,
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    );
    // The frozen window: dispatched −5h, responded −4.5h, completed −1h.
    await backdateStamps(visitId, { dispatchedHours: 5, respondedHours: 4.5, completedHours: 1 });
    const first = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    // Response 30m > 1h? NO — 30m < 1h: NOT breached. Resolution 4h > 1h.
    expect(first.response.breached).toBe(false);
    expect(first.resolution.breached).toBe(true);
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]!.clock).toBe("RESOLUTION");
    const frozenElapsed = first.resolution.elapsedMs;
    const second = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(second.resolution.elapsedMs).toBe(frozenElapsed); // FROZEN
    expect(second.escalations[0]!.notified).toBe(false); // the dedupe held
    expect(await escalationRows(visitId)).toHaveLength(1);
  });

  it("(e) the undispatched clock never starts", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: 1,
      resolution_target_hours: 1,
    });
    const { visitId } = await createVisit({ technician: technicianId });
    const evaluation = await withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId));
    expect(evaluation.response.running).toBe(false);
    expect(evaluation.response.elapsedMs).toBe(0);
    expect(evaluation.resolution.running).toBe(false);
    expect(evaluation.escalations).toEqual([]);
  });

  it("(f) the malformed register is the typed refusal (never a fabricated target)", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", {
      response_target_hours: "one",
      resolution_target_hours: 2,
    });
    const { visitId } = await createVisit({ technician: technicianId });
    await expect(
      withTenant(TENANT_PJW, () => fieldservice.slaEvaluation(visitId)),
    ).rejects.toBeInstanceOf(SlaRegisterMalformedError);
    await setPjwSetting("projects.fieldservice_sla_targets", null);
  });
});

// -- 4. the parts-used record (the service-order line issue path) ----------------

describe("W-12 fieldservice — the parts-used record (the WMS path, all-or-nothing)", () => {
  it("(a) complete(issueParts) issues the order's PARTS lines through the WMS path", async () => {
    const { visitId, orderId } = await createVisit({
      lines: [serviceLine(), partsLine("2")],
      technician: technicianId,
    });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    const stockBefore = await stockQty();
    const journalsBefore = await journalCount();

    const result = await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: "Used two kits.",
        completionNotesAr: "استُخدم طقمان.",
        issueParts: true,
        actorId: PJW_ACTOR,
      }),
    );
    expect(result.visit.status).toBe("COMPLETED");
    expect(result.issueJournalId).not.toBeNull();

    // The WMS delta: 2 × the parts kit left the warehouse (delta-based —
    // the sales-fixture law).
    const stockAfter = await stockQty();
    expect(Number(stockBefore) - Number(stockAfter)).toBe(2);
    // The COGS journal (source service_order:issue_parts) exists.
    expect(await journalCount()).toBe(journalsBefore + 1);
    // The order's line stamps the issue (the service-order line path).
    const line = await withTenant(TENANT_PJW, async () => {
      const crmStore = await import("../../modules/crm/infrastructure/crm.store");
      const lines = await crmStore.listServiceOrderLines(orderId);
      return lines.find((l) => l.lineType === "PARTS")!;
    });
    expect(line.status).toBe("ISSUED");
    expect(line.issueJournalId).not.toBeNull();
  });

  it("(b) the all-or-nothing rollback: an insufficient stock refusal leaves the visit IN_PROGRESS", async () => {
    // An order whose PARTS line exceeds the on-hand (9999 > 20).
    const { visitId } = await createVisit({
      lines: [serviceLine(), partsLine("9999")],
      technician: technicianId,
    });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    const journalsBefore = await journalCount();
    await expect(
      withTenant(TENANT_PJW, () =>
        fieldservice.complete(visitId, {
          completionNotes: "will roll back",
          completionNotesAr: null,
          issueParts: true,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    // The completion rolled back with the issue: the visit untouched, no
    // journal, no notes (INV-018 — zero residue).
    const visit = await withTenant(TENANT_PJW, () => fieldservice.find(visitId));
    expect(visit.status).toBe("IN_PROGRESS");
    expect(visit.completedAt).toBeNull();
    expect(visit.completionNotes).toBeNull();
    expect(await journalCount()).toBe(journalsBefore);
  });

  it("(c) a notes-only completion moves no stock (the parts record is optional)", async () => {
    const { visitId } = await createVisit({
      lines: [serviceLine(), partsLine("2")],
      technician: technicianId,
    });
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(visitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(visitId, { actorId: PJW_ACTOR }));
    const stockBefore = await stockQty();
    const result = await withTenant(TENANT_PJW, () =>
      fieldservice.complete(visitId, {
        completionNotes: "No parts needed.",
        completionNotesAr: null,
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    );
    expect(result.visit.status).toBe("COMPLETED");
    expect(result.issueJournalId).toBeNull();
    expect(await stockQty()).toBe(stockBefore);
  });
});
