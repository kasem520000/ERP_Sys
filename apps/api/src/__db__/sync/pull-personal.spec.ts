import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import {
  pull,
  PULL_PAGE_BYTE_CAP,
  SyncEntityNotPulledError,
} from "../../modules/sync/application/pull-service";
import { encodeCursor } from "../../modules/sync/application/cursor-tokens";
import { makeSyncServices, seedPosWorld, enrollDevice, type PosWorld } from "./_oracle";

/**
 * PHASE-022 T-P22-1d · DR-P22-05 — the PERSONAL feed group (MASTER-PLAN §0
 * golden constants + §6; OFFLINE_CAPABILITIES_MATRIX rows 13/14/29
 * android-personal): the server-side partner scope. LOCAL_DATABASE §1.1
 * rule 2 — personal-account mirrors are filtered by partner authorization
 * BEFORE they ever enter a change feed: the device's linked partner ONLY
 * (devices.linked_partner_id, migration 0033) for the partner-keyed
 * entities, the device user for notifications. A tampered device — a
 * stolen cursor from ANOTHER device's feed, a forged (bad-signature)
 * cursor, a cross-entity cursor — gets NOTHING outside its scope
 * (SECURITY_AND_DEVICE_MANAGEMENT; the phase doc's acceptance: "cannot pull
 * or render any row outside its linked partner, tampered-client attempts
 * included").
 *
 * Same suite conventions as pull-fields.spec (the 020 suite): a DEDICATED
 * tenant (seedPosWorld is once-per-tenant — the roles seed keys on
 * (tenant_id, key)), idempotent seeding, self-sufficient beforeAll; the
 * posted-invoice helper is duplicated per file, the world-seeding
 * convention).
 */

const TENANT = "f2e2d2d2-f2e2-f2e2-f2e2-f2e2f2e2f2e2";
const ACTOR = "f2e2d2d2-0000-4000-8000-000000000001";
const CASHIER = "f2e2d2d2-0000-4000-8000-000000000002";
const REP_USER = "f2e2d2d2-0000-4000-8000-000000000003";
const PA_USER = "f2e2d2d2-0000-4000-8000-000000000004";
const PB_USER = "f2e2d2d2-0000-4000-8000-000000000005";
/** P1 = world.customerId (seedPosWorld's customer); P2–P4 direct rows. */
const P2 = "f2e2d2d2-0000-4000-8000-000000000101";
const P3 = "f2e2d2d2-0000-4000-8000-000000000102";
const P4 = "f2e2d2d2-0000-4000-8000-000000000103";
const RECEIPT_P1 = "f2e2d2d2-0000-4000-8000-000000000201";
const RECEIPT_P2 = "f2e2d2d2-0000-4000-8000-000000000202";
const RECEIPT_P4 = "f2e2d2d2-0000-4000-8000-000000000203";
const NOTE_A = "f2e2d2d2-0000-4000-8000-000000000301";
const NOTE_B = "f2e2d2d2-0000-4000-8000-000000000302";
const NOTE_NULL = "f2e2d2d2-0000-4000-8000-000000000303";
const NOTE_BIG1 = "f2e2d2d2-0000-4000-8000-000000000304";
const NOTE_BIG2 = "f2e2d2d2-0000-4000-8000-000000000305";

/** The per-change serialized size (the pull service's own metric). */
function changeBytes(change: { id: string }): number {
  return Buffer.byteLength(JSON.stringify(change));
}

let world: PosWorld;
let personalA = "";
let personalB = "";
let personalAInvoiceIds: string[] = [];
let p2InvoiceId = "";

beforeAll(async () => {
  ensureTestDb();
  world = await seedPosWorld({
    tenant: TENANT,
    name: "Tenant P1D (personal feeds)",
    nameAr: "مستأجر ١د الشخصي",
    prefix: "P1D",
    actor: ACTOR,
    cashier: CASHIER,
    salesRep: REP_USER,
  });

  const su = await superuserClient();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'p1d-personal-a@fixture.test', 'P1D Personal A', 'x', 'ACTIVE'),
       ($2, 'p1d-personal-b@fixture.test', 'P1D Personal B', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [PA_USER, PB_USER],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $4, 'CUSTOMER', 'P1D-CUST-02', 'Personal Fixture Partner 2'),
       ($2, $4, 'CUSTOMER', 'P1D-CUST-03', 'Personal Fixture Partner 3'),
       ($3, $4, 'CUSTOMER', 'P1D-CUST-04', 'Personal Fixture Partner 4')
     ON CONFLICT (id) DO NOTHING`,
    [P2, P3, P4, TENANT],
  );
  // The receipts fixture: one per partner (P1/P2/P4) — DRAFT rows on the
  // REAL treasury tables (0012); the personal serve filter keys on
  // payload.partnerId.
  await su.query(
    `INSERT INTO receipts (id, tenant_id, status, cash_account_id, partner_id, method,
                           currency_code, amount, value_date)
     VALUES
       ($1, $6, 'DRAFT', $7, $2, 'CASH', 'SAR', 50.0000, '2026-03-15'),
       ($3, $6, 'DRAFT', $7, $4, 'CASH', 'SAR', 60.0000, '2026-03-15'),
       ($5, $6, 'DRAFT', $7, $8, 'CASH', 'SAR', 70.0000, '2026-03-15')
     ON CONFLICT (id) DO NOTHING`,
    [RECEIPT_P1, world.customerId, RECEIPT_P2, P2, RECEIPT_P4, TENANT, world.cashAccountId, P4],
  );
  // The notifications fixture: A_USER's + B_USER's rows, a NULL-user
  // broadcast (never served to any personal device), and the two ~1.1 MB
  // rows for the page-budget pack. $1–$5 ids, $6 tenant, $7 A user,
  // $8 B user, $9 the bilingual title.
  await su.query(
    `INSERT INTO notifications (id, tenant_id, user_id, category, severity, title, body,
                                dedupe_key, read_at)
     VALUES
       ($1, $6, $7,  'invoice_overdue', 'info', $9, '{}'::jsonb, 'p1d-note-a', NULL),
       ($2, $6, $8,  'invoice_overdue', 'info', $9, '{}'::jsonb, 'p1d-note-b', NULL),
       ($3, $6, NULL, 'subscription',   'info', $9, '{}'::jsonb, 'p1d-note-null', NULL),
       ($4, $6, $7,  'invoice_overdue', 'info', $9,
         ('{"blob":"' || repeat('x', 1100000) || '"}')::jsonb, 'p1d-note-big1', NULL),
       ($5, $6, $7,  'invoice_overdue', 'info', $9,
         ('{"blob":"' || repeat('x', 1100000) || '"}')::jsonb, 'p1d-note-big2', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [
      NOTE_A,
      NOTE_B,
      NOTE_NULL,
      NOTE_BIG1,
      NOTE_BIG2,
      TENANT,
      PA_USER,
      PB_USER,
      JSON.stringify({ ar: "فاتورة متأخرة", en: "Invoice overdue" }),
    ],
  );
  await su.end();

  // P1's two + P2's one REAL posted credit invoices (the AR subledger
  // content both feeds read over) — idempotent by note.
  personalAInvoiceIds = [
    await ensurePostedCreditInvoice(world.customerId, "P1D statement invoice 1"),
    await ensurePostedCreditInvoice(world.customerId, "P1D statement invoice 2"),
  ];
  p2InvoiceId = await ensurePostedCreditInvoice(P2, "P1D statement invoice P2");

  personalA = await enrollDevice(TENANT, PA_USER, {
    deviceClass: "android-personal",
    linkedPartnerId: world.customerId,
  });
  personalB = await enrollDevice(TENANT, PB_USER, {
    deviceClass: "android-personal",
    linkedPartnerId: P2,
  });
});

afterAll(async () => {
  await closeDb();
});

/** A posted CREDIT invoice for a customer (the REAL create→submit→approve→
 * post chain — the AR subledger entries the statement computes over),
 * idempotent by note (the dedicated-tenant re-seed convention; duplicated
 * from pull-fields.spec per the world-seeding convention). */
async function ensurePostedCreditInvoice(customerId: string, note: string): Promise<string> {
  const su = await superuserClient();
  const found = await su.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
    [TENANT, note],
  );
  const existing = found.rows[0]?.id;
  await su.end();
  if (existing !== undefined) {
    return existing;
  }
  const { invoices } = makeSyncServices();
  const invoice = await withTenant(TENANT, () =>
    invoices.create({
      branchId: world.branchId,
      customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-03-15",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: world.warehouseId,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: REP_USER,
      lines: [
        {
          itemId: world.itemA,
          accountId: null,
          deliveryLineId: null,
          description: null,
          descriptionAr: null,
          qty: "1",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: world.taxStd,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT, () => invoices.submit(invoice.id, REP_USER));
  await withTenant(TENANT, () => invoices.approve(invoice.id, ACTOR, false));
  const posted = await withTenant(TENANT, () => invoices.post(invoice.id, ACTOR));
  return posted.invoice.id;
}

describe("PHASE-022 T-P22-1d · personal feed scope (DR-P22-05; LOCAL_DATABASE §1.1 rule 2)", () => {
  it("partner scope: device A (linked P1) pulls ONLY P1's statements/invoices/receipts — fabricated other-partner rows never appear", async () => {
    // Fabricate the other partner's ledger content FIRST: device B's pull
    // computes P2's statement (and P2's posted invoice exists) — both live
    // in the tenant's change_log, invisible to A's scope.
    const bFeed = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: personalB, limit: 100 }),
    );
    expect(bFeed.changes.map((c) => c.id)).toEqual([P2]);

    // statements: ONLY the linked partner's snapshots — P2/P3/P4 never.
    const aStatements = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: personalA, limit: 100 }),
    );
    expect(aStatements.changes.length).toBeGreaterThan(0);
    expect(aStatements.changes.every((c) => c.id === world.customerId)).toBe(true);
    const aStatement = aStatements.changes[aStatements.changes.length - 1]!
      .payload as {
      partnerId: string;
      entries: { docRef: string | null }[];
      closingBalance: string;
    };
    expect(aStatement.partnerId).toBe(world.customerId);
    expect(aStatement.entries).toHaveLength(2); // the latest snapshot: both posted invoices
    // The posted invoice's official number (SAL_FORMAT "SAL-{YYYY}-{SEQ:6}",
    // invoices.ts) — the AR subledger entry's docRef.
    expect(aStatement.entries[0]!.docRef).toMatch(/^SAL-\d{4}-\d{6}$/);

    // sales_invoices: only P1's two posted invoices — P2's never, the
    // payload customerIds are all P1.
    const aInvoices = await withTenant(TENANT, () =>
      pull({ entityType: "sales_invoices", cursor: null, deviceId: personalA, limit: 1000 }),
    );
    const aInvoiceIds = aInvoices.changes.map((c) => c.id);
    expect(aInvoiceIds).toEqual(expect.arrayContaining(personalAInvoiceIds));
    expect(aInvoiceIds).not.toContain(p2InvoiceId);
    for (const change of aInvoices.changes) {
      expect(change.payload?.customerId).toBe(world.customerId);
    }

    // receipts: only P1's row — P2's and P4's (no device at all) never.
    const aReceipts = await withTenant(TENANT, () =>
      pull({ entityType: "receipts", cursor: null, deviceId: personalA, limit: 100 }),
    );
    expect(aReceipts.changes.map((c) => c.id)).toEqual([RECEIPT_P1]);
    expect(aReceipts.changes[0]!.payload).toMatchObject({
      partnerId: world.customerId,
      status: "DRAFT",
      method: "CASH",
      amount: "50.0000", // TEXT decimal string (ADR-0009)
      valueDate: "2026-03-15",
    });

    // The field device's statements serve is scoped to route customers —
    // this personal tenant has NO routes, so its scope is EMPTY (fail-safe:
    // no route customers, no statements) and P2's statement — computed into
    // the tenant's change_log by device B's pull above — never leaks into a
    // field pull (the route-customer field scope itself is pull-fields.spec's
    // subject).
    const fieldDevice = await enrollDevice(TENANT, ACTOR, { deviceClass: "android-field" });
    const fieldStatements = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: fieldDevice, limit: 100 }),
    );
    const fieldIds = fieldStatements.changes.map((c) => c.id);
    expect(fieldIds).toEqual([]);
    expect(fieldIds).not.toContain(P2);
  });

  it("tampered cursors: a stolen cursor never widens the scope; forged + cross-entity cursors get the typed rejection", async () => {
    // (a) STOLEN: device B's valid statements cursor presented by device A —
    // the serve stays scoped to A (whatever of A's rows sit after B's
    // position ride — the scope filter rides the SAME query), and P2's row
    // never surfaces.
    const bPage = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: personalB, limit: 100 }),
    );
    const bCursor = bPage.cursor;
    const stolen = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: bCursor, deviceId: personalA, limit: 100 }),
    );
    expect(stolen.changes.every((c) => c.id !== P2)).toBe(true);
    expect(stolen.changes.every((c) => c.id === world.customerId)).toBe(true);

    // (b) FORGED: a validly-shaped cursor with a broken signature is
    // rejected with the 016 message contract (restart from null).
    const validCursor = stolen.cursor;
    const forged = `${validCursor.slice(0, -6)}AAAAAA`;
    await expect(
      withTenant(TENANT, () =>
        pull({ entityType: "statements", cursor: forged, deviceId: personalA }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_INVALID" });

    // (c) CROSS-ENTITY: a validly-signed items cursor on a statements pull —
    // the cursor is entity-bound (tamper-evident), never a feed swap.
    const itemsCursor = encodeCursor({
      entityType: "items",
      seq: 1,
      issuedAt: new Date().toISOString(),
    });
    await expect(
      withTenant(TENANT, () =>
        pull({ entityType: "statements", cursor: itemsCursor, deviceId: personalA }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_INVALID" });
  });

  it("notifications per-user scope: only the device user's rows — the NULL-user broadcast is never served", async () => {
    // Drain the pages: the two ~1.1 MB rows split at the ≤ 2 MB byte cap
    // (the page-budget test below pins the split mechanics; scope must hold
    // across EVERY page).
    const ids: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await withTenant(TENANT, () =>
        pull({ entityType: "notifications", cursor, deviceId: personalA, limit: 100 }),
      );
      ids.push(...page.changes.map((c) => c.id));
      for (const change of page.changes) {
        expect(change.payload?.userId).toBe(PA_USER);
        expect(change.payload?.category).toBe("invoice_overdue");
      }
      cursor = page.cursor;
      if (!page.hasMore) {
        break;
      }
    }
    expect(ids).toEqual(expect.arrayContaining([NOTE_A, NOTE_BIG1, NOTE_BIG2]));
    expect(ids).not.toContain(NOTE_B);
    expect(ids).not.toContain(NOTE_NULL);

    // Device B mirrors the same shape for its own user.
    const bFeed = await withTenant(TENANT, () =>
      pull({ entityType: "notifications", cursor: null, deviceId: personalB, limit: 100 }),
    );
    expect(bFeed.changes.map((c) => c.id)).toEqual([NOTE_B]);
  });

  it("out-of-group for personal: items/van_stocks/routes/settlement_templates → SYNC_ENTITY_NOT_PULLED", async () => {
    for (const entityType of [
      "items",
      "van_stocks",
      "routes",
      "settlement_templates",
    ] as const) {
      await expect(
        withTenant(TENANT, () => pull({ entityType, cursor: null, deviceId: personalA })),
      ).rejects.toBeInstanceOf(SyncEntityNotPulledError);
      await expect(
        withTenant(TENANT, () => pull({ entityType, cursor: null, deviceId: personalA })),
      ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });
    }

    // A personal device with NO linked partner fails closed: an empty
    // partner scope, never an unscoped serve (the fail-closed rule).
    const unlinked = await enrollDevice(TENANT, PB_USER, { deviceClass: "android-personal" });
    const invoices = await withTenant(TENANT, () =>
      pull({ entityType: "sales_invoices", cursor: null, deviceId: unlinked, limit: 100 }),
    );
    expect(invoices.changes).toHaveLength(0);
    expect(invoices.hasMore).toBe(false);
    const bInvoices = await withTenant(TENANT, () =>
      pull({ entityType: "sales_invoices", cursor: null, deviceId: personalB, limit: 100 }),
    );
    expect(bInvoices.changes.map((c) => c.id)).toEqual([p2InvoiceId]);
  });

  it("page budgets: the two ~1.1 MB notifications split pages at the ≤ 2 MB delta cap (first item always rides)", async () => {
    expect(PULL_PAGE_BYTE_CAP).toBe(2_000_000);
    // Page 1: the small row + the first big row fit; the second big row
    // would push the page past 2 MB → byteCapped, hasMore.
    const page1 = await withTenant(TENANT, () =>
      pull({ entityType: "notifications", cursor: null, deviceId: personalA }),
    );
    expect(page1.hasMore).toBe(true);
    expect(page1.changes.length).toBe(2);
    const page1Bytes = page1.changes.reduce((sum, c) => sum + changeBytes(c), 0);
    expect(page1Bytes).toBeLessThanOrEqual(PULL_PAGE_BYTE_CAP);
    // The page that WOULD have been: adding the next item breaks the cap.
    expect(page1Bytes + 1_100_000).toBeGreaterThan(PULL_PAGE_BYTE_CAP);

    // The continuation serves the remainder, contiguously (no overlap).
    const page2 = await withTenant(TENANT, () =>
      pull({ entityType: "notifications", cursor: page1.cursor, deviceId: personalA }),
    );
    expect(page2.hasMore).toBe(false);
    expect(page2.changes).toHaveLength(1);
    const union = [...page1.changes, ...page2.changes].map((c) => c.id);
    expect(new Set(union).size).toBe(3);
    expect(union).toEqual(expect.arrayContaining([NOTE_A, NOTE_BIG1, NOTE_BIG2]));
    const page1Seqs = page1.changes.map((c) => c.seq);
    expect(page2.changes[0]!.seq).toBeGreaterThan(page1Seqs[page1Seqs.length - 1]!);

    // The idle pull from the drained position is empty (the same mechanics
    // for every entity type — pull.spec's pure fitsByteCap is the math).
    const idle = await withTenant(TENANT, () =>
      pull({ entityType: "notifications", cursor: page2.cursor, deviceId: personalA }),
    );
    expect(idle.changes).toHaveLength(0);
  });
});
