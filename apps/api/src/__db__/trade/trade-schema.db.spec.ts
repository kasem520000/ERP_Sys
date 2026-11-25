import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { superuserClient } from "../test-db";
import {
  TENANT_TRADE,
  TR_ACTOR,
  freshTradeBl,
  freshTradeDeclaration,
  freshTradeLc,
  setupTradeFixture,
} from "./fixtures";

/**
 * PHASE-051 (W-33 — T-01…T-04, the foundation wave) — the trade
 * family's FIRST spec (the quality family's own precedent: the
 * `__db__/trade/` directory opens with the migrations' own structural
 * laws; the service specs land with their W-34…W-38 waves). What this
 * spec pins over real PostgreSQL 16 (the plan §4's foundation arms):
 *
 * - the LC ladder + the G-64 STAMP FLOORS (the margin stamp only past
 *   DRAFT on a real margin; the retirement pair only on RETIRED and
 *   TOGETHER — never a settled row without its entry, never an entry
 *   on a live row) + the composite journal FK (the dummy-entry proof);
 * - the LC amendments' TYPED-CHANGE LAW (each amendment exactly one
 *   typed dimension — VALUE ⇔ its pair, VALIDITY ⇔ its pair, DOCUMENTS
 *   ⇔ its note, OTHER ⇒ its summary) + the (tenant, lc, no)
 *   uniqueness;
 * - the checklist FLOOR (a stamp only on its own state; a verification
 *   presupposes presentation) + the (tenant, lc, type) uniqueness;
 * - the collections: the terms vocabulary, the D/A USANCE FLOOR (a
 *   time collection carries its maturity), the ladder's stamp law,
 *   the settlement pair TOGETHER, the documents array shape;
 * - the Incoterms registry: the code shape + the (tenant, code)
 *   uniqueness + the matrix booleans legal shapes;
 * - the B/Ls: the multimodal vocabulary, the fold's milestone ladder
 *   vocabulary, the container refs array shape;
 * - the packing lists: the lines array shape;
 * - the certificates: the ORIGIN/CONFORMITY one-table law + THE
 *   FROZEN SNAPSHOT object shape;
 * - the declarations: the type + status vocabularies + THE INV-036
 *   LADDER STAMPS (COMPLETED ⇒ completed_at — the completeness
 *   floor's own stamp; DRAFT carries none);
 * - the declaration lines: the line/hs shapes, the TENANT'S-OWN-ROWS
 *   amounts law, the (tenant, declaration, line) uniqueness + the
 *   composite item FK;
 * - the HS registry: the code shape + the (tenant, code) uniqueness;
 * - the bonded moves: THE G-66 NO-DUTY FLOOR (an in-bond transfer
 *   NEVER carries a duty figure or a recognition stamp) + THE BR-107
 *   ATOMIC STAMPS (the release trio TOGETHER, requiring the
 *   declaration link — the G-65 shape's own source law) + the
 *   composite journal FK + the warehouse composite FKs;
 * - the drawback claims: THE BR-108 EVIDENCE FLOOR (submission
 *   requires the linked export evidence), the stamps, the no-GL shape
 *   (no journal column exists — asserted structurally);
 * - the tracking events: the milestone vocabulary (the fold's
 *   unknown-event law's own floor) + the B/L composite FK.
 *
 * THE OWNER'S PER-ARM-WORLD LAW («أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its OWN world — a fresh LC/B-L/declaration with
 * a unique natural key; no arm shares mutable rows with another.
 */

interface PgError {
  code?: string;
  constraint?: string;
}

async function expectConstraint(
  run: () => Promise<unknown>,
  constraint: string,
  pgCode: "23514" | "23505" | "23503",
): Promise<void> {
  let caught: PgError | undefined;
  try {
    await run();
  } catch (error) {
    caught = error as PgError;
  }
  expect(caught, `expected ${constraint} to refuse the row`).toBeTruthy();
  expect(caught?.code).toBe(pgCode);
  expect(caught?.constraint).toBe(constraint);
}

let su: Client;
let baseItemId: string;
let warehouseAId: string;
let warehouseBId: string;

/** The G-64 dummy journal id (a CHECK arm fires before the FK; the FK
 * arms below use the SAME id to prove the composite law 23503). */
const DUMMY_JOURNAL = "00000000-0000-0000-0000-0000000000dd";

beforeAll(async () => {
  const base = await setupTradeFixture();
  baseItemId = base.itemId;
  warehouseAId = base.warehouseAId;
  warehouseBId = base.warehouseBId;
  su = await superuserClient();
});

async function insertLc(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO letters_of_credit
       (id, tenant_id, lc_no, purchase_order_id, currency, amount, margin_amount, issuing_bank,
        beneficiary_name, applicant_name, issued_at, expiry_date, status,
        margin_journal_entry_id, settled_at, retirement_journal_entry_id, created_by)
     VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, $6, $7, $8,
        '2026-11-01T09:00:00Z', $9, $10, $11, $12, $13, $14)`,
    [
      TENANT_TRADE,
      row.lcNo,
      row.currency ?? "USD",
      row.amount ?? 50000,
      row.marginAmount ?? 5000,
      row.issuingBank ?? "Bank Fixture",
      row.beneficiary ?? "Overseas Seller SARL",
      row.applicant ?? "TR Trading Co",
      row.expiryDate ?? "2027-06-30",
      row.status ?? "DRAFT",
      row.marginJournalEntryId ?? null,
      row.settledAt ?? null,
      row.retirementJournalEntryId ?? null,
      TR_ACTOR,
    ],
  );
}

async function insertAmendment(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO lc_amendments
       (id, tenant_id, lc_id, amendment_no, change_type, value_from, value_to,
        expiry_from, expiry_to, documents_note, summary, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      TENANT_TRADE,
      row.lcId,
      row.amendmentNo ?? 1,
      row.changeType ?? "OTHER",
      row.valueFrom ?? null,
      row.valueTo ?? null,
      row.expiryFrom ?? null,
      row.expiryTo ?? null,
      row.documentsNote ?? null,
      row.summary ?? null,
      TR_ACTOR,
    ],
  );
}

describe("PHASE-051 W-33 — the LC ladder + the G-64 stamp floors (0119, L-01/D-05)", () => {
  it("the legal shapes all insert: DRAFT, ISSUED, EXPIRED, CANCELLED, RETIRED with its full pair", async () => {
    // The trade fixture's own OPEN fiscal year + period (the lean
    // fixture seeds master data, not the accounting calendar — the
    // journal's composite FK needs one real period).
    await su.query(
      `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status)
       VALUES (gen_random_uuid(), $1, 'FY-TR-FIX', '2026-01-01', '2026-12-31', 'OPEN')
       ON CONFLICT DO NOTHING`,
      [TENANT_TRADE],
    );
    await su.query(
      `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status)
       SELECT gen_random_uuid(), $1, fy.id, '2026-11', 'REGULAR', '2026-11-01', '2026-11-30', 'OPEN'
       FROM fiscal_years fy
       WHERE fy.tenant_id = $1 AND fy.name = 'FY-TR-FIX'
         AND NOT EXISTS (
           SELECT 1 FROM fiscal_periods fp
           WHERE fp.tenant_id = $1 AND fp.fiscal_year_id = fy.id AND fp.name = '2026-11')`,
      [TENANT_TRADE],
    );
    const journalEntry = async (description: string): Promise<string> => {
      const row = await su.query<{ id: string }>(
        `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code,
           source_type, operation, description)
         VALUES (gen_random_uuid(), $1, '2026-11-20',
           (SELECT id FROM fiscal_periods WHERE tenant_id = $1 AND status = 'OPEN'
            ORDER BY start_date LIMIT 1),
           'SAR', 'trade_probe', 'post', $2)
         RETURNING id`,
        [TENANT_TRADE, description],
      );
      return row.rows[0]!.id;
    };
    const marginEntryId = await journalEntry("LC margin deposit fixture entry");
    const retirementEntryId = await journalEntry("LC retirement fixture entry");
    await insertLc({ lcNo: "LC-LEGAL-1", status: "DRAFT" });
    await insertLc({ lcNo: "LC-LEGAL-2", status: "ISSUED", marginJournalEntryId: marginEntryId });
    await insertLc({ lcNo: "LC-LEGAL-3", status: "EXPIRED" });
    await insertLc({ lcNo: "LC-LEGAL-4", status: "CANCELLED" });
    await insertLc({
      lcNo: "LC-LEGAL-5",
      status: "RETIRED",
      settledAt: "2026-11-20T10:00:00Z",
      retirementJournalEntryId: retirementEntryId,
      marginJournalEntryId: marginEntryId,
    });
    expect(retirementEntryId).toBeTruthy();
  });

  it("the status vocabulary is closed — an unknown status refused BY NAME", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-BAD-STATUS", status: "LIVE" }),
      "ck_letters_of_credit_status",
      "23514",
    );
  });

  it("the amounts law: a non-positive amount refused; a negative margin refused", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-BAD-AMT", amount: 0 }),
      "ck_letters_of_credit_amounts",
      "23514",
    );
    await expectConstraint(
      () => insertLc({ lcNo: "LC-BAD-MARGIN", marginAmount: -1 }),
      "ck_letters_of_credit_amounts",
      "23514",
    );
  });

  it("the validity law: an expiry before the issuance refused", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-BAD-VAL", expiryDate: "2026-10-01" }),
      "ck_letters_of_credit_validity",
      "23514",
    );
  });

  it("THE G-64 MARGIN FLOOR: the stamp on the DRAFT path refused BY NAME", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-MARGIN-DRAFT", status: "DRAFT", marginJournalEntryId: DUMMY_JOURNAL }),
      "ck_letters_of_credit_margin_shape",
      "23514",
    );
  });

  it("THE G-64 MARGIN FLOOR: the stamp on the CANCELLED path refused; a zero-margin stamp refused", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-MARGIN-CXL", status: "CANCELLED", marginJournalEntryId: DUMMY_JOURNAL }),
      "ck_letters_of_credit_margin_shape",
      "23514",
    );
    await expectConstraint(
      () => insertLc({ lcNo: "LC-MARGIN-ZERO", status: "ISSUED", marginAmount: 0, marginJournalEntryId: DUMMY_JOURNAL }),
      "ck_letters_of_credit_margin_shape",
      "23514",
    );
  });

  it("THE G-64 RETIREMENT PAIR: RETIRED without the settled stamp refused; without its entry refused", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-RET-NOSTAMP", status: "RETIRED", retirementJournalEntryId: DUMMY_JOURNAL }),
      "ck_letters_of_credit_retirement_shape",
      "23514",
    );
    await expectConstraint(
      () => insertLc({ lcNo: "LC-RET-NOENTRY", status: "RETIRED", settledAt: "2026-11-20T10:00:00Z" }),
      "ck_letters_of_credit_retirement_shape",
      "23514",
    );
  });

  it("THE G-64 RETIREMENT PAIR: the stamps on the LIVE paths refused (never an entry on a live row)", async () => {
    await expectConstraint(
      () => insertLc({ lcNo: "LC-LIVE-STAMP", status: "ISSUED", settledAt: "2026-11-20T10:00:00Z" }),
      "ck_letters_of_credit_retirement_shape",
      "23514",
    );
    await expectConstraint(
      () => insertLc({ lcNo: "LC-LIVE-ENTRY", status: "EXPIRED", retirementJournalEntryId: DUMMY_JOURNAL }),
      "ck_letters_of_credit_retirement_shape",
      "23514",
    );
  });

  it("the journal stamps carry the COMPOSITE FK — a nonexistent entry refused 23503", async () => {
    // The composite (journal id, tenant) FK: a stamp pointing at no
    // entry refuses BY NAME (the real entry arm above proves the legal
    // path; the RLS suite's A3 attacks prove the tenant-boundary
    // composite law on the whole family).
    await expectConstraint(
      () =>
        insertLc({
          lcNo: "LC-FK-JOURNAL",
          status: "ISSUED",
          marginJournalEntryId: "00000000-0000-0000-0000-0000000000ee",
        }),
      "fk_letters_of_credit_margin_journal",
      "23503",
    );
  });

  it("the (tenant, lc_no) uniqueness", async () => {
    await insertLc({ lcNo: "LC-UQ-1" });
    await expectConstraint(
      () => insertLc({ lcNo: "LC-UQ-1" }),
      "uq_letters_of_credit_tenant_no",
      "23505",
    );
  });
});

describe("PHASE-051 W-33 — the amendments' TYPED-CHANGE LAW (0119, L-01)", () => {
  it("the legal shapes: a VALUE pair, a VALIDITY pair, a DOCUMENTS note, an OTHER summary", async () => {
    const lc = await freshTradeLc("AMD-LEGAL");
    await insertAmendment({ lcId: lc, amendmentNo: 1, changeType: "VALUE", valueFrom: 50000, valueTo: 60000 });
    await insertAmendment({ lcId: lc, amendmentNo: 2, changeType: "VALIDITY", expiryFrom: "2027-06-30", expiryTo: "2027-09-30" });
    await insertAmendment({ lcId: lc, amendmentNo: 3, changeType: "DOCUMENTS", documentsNote: "Add certificate of origin" });
    await insertAmendment({ lcId: lc, amendmentNo: 4, changeType: "OTHER", summary: "Bank details corrected" });
  });

  it("VALUE without its pair refused; the pair on the WRONG type refused", async () => {
    const lc = await freshTradeLc("AMD-VAL");
    await expectConstraint(
      () => insertAmendment({ lcId: lc, changeType: "VALUE", valueFrom: 50000 }),
      "ck_lc_amendments_typed_value",
      "23514",
    );
    await expectConstraint(
      () => insertAmendment({ lcId: lc, changeType: "OTHER", summary: "x", valueFrom: 1, valueTo: 2 }),
      "ck_lc_amendments_typed_value",
      "23514",
    );
  });

  it("VALIDITY without its pair refused; DOCUMENTS without its note refused; OTHER without its summary refused", async () => {
    const lc = await freshTradeLc("AMD-TYPED");
    await expectConstraint(
      () => insertAmendment({ lcId: lc, changeType: "VALIDITY", expiryTo: "2027-09-30" }),
      "ck_lc_amendments_typed_validity",
      "23514",
    );
    await expectConstraint(
      () => insertAmendment({ lcId: lc, changeType: "DOCUMENTS" }),
      "ck_lc_amendments_typed_documents",
      "23514",
    );
    await expectConstraint(
      () => insertAmendment({ lcId: lc, changeType: "OTHER" }),
      "ck_lc_amendments_other_summary",
      "23514",
    );
  });

  it("the (tenant, lc, amendment_no) uniqueness", async () => {
    const lc = await freshTradeLc("AMD-UQ");
    await insertAmendment({ lcId: lc, amendmentNo: 7, changeType: "OTHER", summary: "first" });
    await expectConstraint(
      () => insertAmendment({ lcId: lc, amendmentNo: 7, changeType: "OTHER", summary: "second" }),
      "uq_lc_amendments_tenant_lc_no",
      "23505",
    );
  });
});

describe("PHASE-051 W-33 — the checklist FLOOR + the collections (0119, L-01/L-02)", () => {
  it("the legal shapes: presented with its stamp, verified on a presented doc; D/P at sight; D/A with its maturity", async () => {
    const lc = await freshTradeLc("CHK-LEGAL");
    await su.query(
      `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented, presented_at,
         verified, verified_at, discrepancy_notes)
       VALUES (gen_random_uuid(), $1, $2, 'COMMERCIAL_INVOICE', true, '2026-11-10T09:00:00Z',
         true, '2026-11-11T09:00:00Z', 'Minor mismatch in invoice total')`,
      [TENANT_TRADE, lc],
    );
    await su.query(
      `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type)
       VALUES (gen_random_uuid(), $1, $2, 'BILL_OF_LADING')`,
      [TENANT_TRADE, lc],
    );
    await su.query(
      `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount,
         currency, documents, status)
       VALUES (gen_random_uuid(), $1, 'COL-LEGAL-DP', 'D/P', 12000, 'SAR',
         '["invoice","bl"]'::jsonb, 'OPEN')`,
      [TENANT_TRADE],
    );
    await su.query(
      `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount,
         currency, due_date, documents, status)
       VALUES (gen_random_uuid(), $1, 'COL-LEGAL-DA', 'D/A', 8000, 'USD', '2027-01-31',
         '[]'::jsonb, 'OPEN')`,
      [TENANT_TRADE],
    );
  });

  it("the presented shape: a stamp only on its own state", async () => {
    const lc = await freshTradeLc("CHK-PRES");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented)
           VALUES (gen_random_uuid(), $1, $2, 'INVOICE', true)`,
          [TENANT_TRADE, lc],
        ),
      "ck_lc_documents_presented_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented, presented_at)
           VALUES (gen_random_uuid(), $1, $2, 'INVOICE', false, '2026-11-10T09:00:00Z')`,
          [TENANT_TRADE, lc],
        ),
      "ck_lc_documents_presented_shape",
      "23514",
    );
  });

  it("the verified shape: an unpresented doc is NEVER verified; the stamp only on its own state", async () => {
    const lc = await freshTradeLc("CHK-VER");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, verified)
           VALUES (gen_random_uuid(), $1, $2, 'INVOICE', true)`,
          [TENANT_TRADE, lc],
        ),
      "ck_lc_documents_verified_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented, presented_at,
             verified)
           VALUES (gen_random_uuid(), $1, $2, 'INVOICE', true, '2026-11-10T09:00:00Z', true)`,
          [TENANT_TRADE, lc],
        ),
      "ck_lc_documents_verified_shape",
      "23514",
    );
  });

  it("the (tenant, lc, doc_type) uniqueness", async () => {
    const lc = await freshTradeLc("CHK-UQ");
    await su.query(
      `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type)
       VALUES (gen_random_uuid(), $1, $2, 'CERTIFICATE_OF_ORIGIN')`,
      [TENANT_TRADE, lc],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type)
           VALUES (gen_random_uuid(), $1, $2, 'CERTIFICATE_OF_ORIGIN')`,
          [TENANT_TRADE, lc],
        ),
      "uq_lc_documents_tenant_lc_type",
      "23505",
    );
  });

  it("THE D/A USANCE FLOOR: a time collection without its maturity refused; the terms closed", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency)
           VALUES (gen_random_uuid(), $1, 'COL-DA-NODUE', 'D/A', 8000, 'USD')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_usance",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency)
           VALUES (gen_random_uuid(), $1, 'COL-BAD-TERMS', 'D/X', 8000, 'USD')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_terms",
      "23514",
    );
  });

  it("the ladder stamps: PRESENTED without its stamp refused; the stamp on OPEN refused; PAID without its own refused", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency, status)
           VALUES (gen_random_uuid(), $1, 'COL-LAD-1', 'D/P', 100, 'SAR', 'PRESENTED')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_presented_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency,
             status, presented_at)
           VALUES (gen_random_uuid(), $1, 'COL-LAD-2', 'D/P', 100, 'SAR', 'OPEN', '2026-11-10T09:00:00Z')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_presented_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency,
             status, presented_at, accepted_at, paid_at)
           VALUES (gen_random_uuid(), $1, 'COL-LAD-3', 'D/P', 100, 'SAR', 'ACCEPTED',
             '2026-11-10T09:00:00Z', '2026-11-11T09:00:00Z', '2026-11-12T09:00:00Z')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_paid_shape",
      "23514",
    );
  });

  it("the settlement pair TOGETHER; the amount positive; the documents an array", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency,
             settled_at)
           VALUES (gen_random_uuid(), $1, 'COL-SET-1', 'D/P', 100, 'SAR', '2026-11-12T09:00:00Z')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_settlement_pair",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency)
           VALUES (gen_random_uuid(), $1, 'COL-AMT-0', 'D/P', 0, 'SAR')`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_amount",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount, currency, documents)
           VALUES (gen_random_uuid(), $1, 'COL-DOCS', 'D/P', 100, 'SAR', '"not-an-array"'::jsonb)`,
          [TENANT_TRADE],
        ),
      "ck_documentary_collections_documents_shape",
      "23514",
    );
  });
});

describe("PHASE-051 W-33 — the Incoterms registry + the transport documents (0120, L-03/L-04/L-05)", () => {
  it("the legal shapes: a registry row with its matrix; a B/L; a packing list; a certificate", async () => {
    await su.query(
      `INSERT INTO incoterms (id, tenant_id, code, name, name_ar, carriage_by_seller,
         insurance_by_seller, export_clearance_by_seller, import_clearance_by_seller,
         import_duty_by_seller, note)
       VALUES (gen_random_uuid(), $1, 'CIF', 'Cost, Insurance and Freight',
         'التكلفة والتأمين والنولون', true, true, true, false, false,
         'Fixture row — the tenant owns the final applicability')`,
      [TENANT_TRADE],
    );
    const bl = await freshTradeBl("DOCS-LEGAL");
    await su.query(
      `INSERT INTO packing_lists (id, tenant_id, pl_no, bill_of_lading_id, lines)
       VALUES (gen_random_uuid(), $1, 'PL-LEGAL-1', $2,
         '[{"description":"Pallets","packages":40,"grossKg":8200,"netKg":8000}]'::jsonb)`,
      [TENANT_TRADE, bl],
    );
    await su.query(
      `INSERT INTO certificates_of_origin (id, tenant_id, certificate_no, cert_type, snapshot)
       VALUES (gen_random_uuid(), $1, 'CRT-LEGAL-1', 'ORIGIN',
         '{"exporter":"TR Trading Co","originCountry":"SA"}'::jsonb)`,
      [TENANT_TRADE],
    );
  });

  it("the incoterm code shape closed; the (tenant, code) uniqueness", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO incoterms (id, tenant_id, code, name, name_ar, carriage_by_seller,
             insurance_by_seller, export_clearance_by_seller, import_clearance_by_seller, import_duty_by_seller)
           VALUES (gen_random_uuid(), $1, 'bad code!', 'X', 'س', true, true, true, true, true)`,
          [TENANT_TRADE],
        ),
      "ck_incoterms_code",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO incoterms (id, tenant_id, code, name, name_ar, carriage_by_seller,
             insurance_by_seller, export_clearance_by_seller, import_clearance_by_seller, import_duty_by_seller)
           VALUES (gen_random_uuid(), $1, 'CIF', 'Duplicate', 'مكرر', true, true, true, true, true)`,
          [TENANT_TRADE],
        ),
      "uq_incoterms_tenant_code",
      "23505",
    );
  });

  it("the B/L doc-type vocabulary + the milestone ladder vocabulary closed; the refs an array", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bills_of_lading (id, tenant_id, bl_no, doc_type, carrier_name)
           VALUES (gen_random_uuid(), $1, 'BL-BAD-TYPE', 'PIPE', 'Carrier')`,
          [TENANT_TRADE],
        ),
      "ck_bills_of_lading_doc_type",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bills_of_lading (id, tenant_id, bl_no, doc_type, carrier_name, shipment_status)
           VALUES (gen_random_uuid(), $1, 'BL-BAD-MILE', 'SEA', 'Carrier', 'LOST')`,
          [TENANT_TRADE],
        ),
      "ck_bills_of_lading_shipment_status",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bills_of_lading (id, tenant_id, bl_no, doc_type, carrier_name, container_refs)
           VALUES (gen_random_uuid(), $1, 'BL-BAD-REFS', 'SEA', 'Carrier', '"MSKU123"'::jsonb)`,
          [TENANT_TRADE],
        ),
      "ck_bills_of_lading_container_refs_shape",
      "23514",
    );
  });

  it("the packing lists' lines an array; the certificates' snapshot an OBJECT (the frozen print shape)", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO packing_lists (id, tenant_id, pl_no, lines)
           VALUES (gen_random_uuid(), $1, 'PL-BAD-LINES', '"not-an-array"'::jsonb)`,
          [TENANT_TRADE],
        ),
      "ck_packing_lists_lines_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO certificates_of_origin (id, tenant_id, certificate_no, cert_type, snapshot)
           VALUES (gen_random_uuid(), $1, 'CRT-BAD-SNAP', 'ORIGIN', '[{"not":"an object"}]'::jsonb)`,
          [TENANT_TRADE],
        ),
      "ck_certificates_of_origin_snapshot_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO certificates_of_origin (id, tenant_id, certificate_no, cert_type, snapshot)
           VALUES (gen_random_uuid(), $1, 'CRT-BAD-TYPE', 'ANALYSIS', '{}'::jsonb)`,
          [TENANT_TRADE],
        ),
      "ck_certificates_of_origin_type",
      "23514",
    );
  });
});

describe("PHASE-051 W-33 — the declarations + the lines (0121, L-06/L-07/L-08)", () => {
  it("the legal shapes: a DRAFT, the full ladder with its stamps, a line with the tenant's own figures", async () => {
    await freshTradeDeclaration("DECL-LEGAL");
    const declared = await su.query<{ id: string }>(
      `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type,
         customs_office, status, submitted_at, accepted_at, completed_at, currency)
       VALUES (gen_random_uuid(), $1, 'DEC-LEGAL-DONE', 'IMPORT', 'Jeddah Customs', 'COMPLETED',
         '2026-11-10T08:00:00Z', '2026-11-10T12:00:00Z', '2026-11-11T10:00:00Z', 'SAR')
       RETURNING id`,
      [TENANT_TRADE],
    );
    await su.query(
      `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code,
         origin_country, item_id, description, quantity, uom, customs_value, duty_rate,
         duty_amount, import_vat)
       VALUES (gen_random_uuid(), $1, $2, 1, '8471', 'CN', $3, 'Automatic data machines', 10, 'PCS',
         5000, 0.05, 250, 37.5)`,
      [TENANT_TRADE, declared.rows[0]!.id, baseItemId],
    );
  });

  it("the type + status vocabularies closed", async () => {
    await expectConstraint(
      () => freshTradeDeclaration("DECL-BAD-TYPE", { declarationType: "RE_EXPORT" }),
      "ck_customs_declarations_type",
      "23514",
    );
    await expectConstraint(
      () => freshTradeDeclaration("DECL-BAD-STATUS", { status: "LodGED" }),
      "ck_customs_declarations_status",
      "23514",
    );
  });

  it("THE INV-036 LADDER STAMPS: COMPLETED without its stamp refused; the stamp on DRAFT refused", async () => {
    // The full-submission shape (submitted + accepted stamps present)
    // missing ONLY the completion stamp: the completed_shape fires BY
    // NAME (a bare COMPLETED row trips the earlier accepted_shape
    // first — this world isolates the completion law itself).
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type,
             customs_office, status, submitted_at, accepted_at, currency)
           VALUES (gen_random_uuid(), $1, 'DECL-COMP-NOST', 'IMPORT', 'Jeddah Customs', 'COMPLETED',
             '2026-11-10T08:00:00Z', '2026-11-10T12:00:00Z', 'SAR')`,
          [TENANT_TRADE],
        ),
      "ck_customs_declarations_completed_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type,
             customs_office, status, completed_at, currency)
           VALUES (gen_random_uuid(), $1, 'DECL-DRAFT-STAMP', 'IMPORT', 'Jeddah', 'DRAFT',
             '2026-11-11T10:00:00Z', 'SAR')`,
          [TENANT_TRADE],
        ),
      "ck_customs_declarations_completed_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type,
             customs_office, status, accepted_at, currency)
           VALUES (gen_random_uuid(), $1, 'DECL-SUB-ACC', 'IMPORT', 'Jeddah', 'SUBMITTED',
             '2026-11-10T12:00:00Z', 'SAR')`,
          [TENANT_TRADE],
        ),
      "ck_customs_declarations_accepted_shape",
      "23514",
    );
  });

  it("the declaration lines: the hs shape, the positive line no, the tenant's-own amounts law, the composite item FK", async () => {
    const decl = await freshTradeDeclaration("DECL-LINE");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, customs_value)
           VALUES (gen_random_uuid(), $1, $2, 1, 'AB12', 100)`,
          [TENANT_TRADE, decl],
        ),
      "ck_customs_declaration_lines_hs_code",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, customs_value)
           VALUES (gen_random_uuid(), $1, $2, 0, '8471', 100)`,
          [TENANT_TRADE, decl],
        ),
      "ck_customs_declaration_lines_line_no",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, customs_value, duty_rate)
           VALUES (gen_random_uuid(), $1, $2, 1, '8471', -100, 0)`,
          [TENANT_TRADE, decl],
        ),
      "ck_customs_declaration_lines_amounts",
      "23514",
    );
    // THE COMPOSITE FK LAW: an item of ANOTHER tenant refuses (the
    // boundary tenant is empty by construction — any item id is
    // foreign).
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, item_id, customs_value)
           VALUES (gen_random_uuid(), $1, $2, 1, '8471', $3, 100)`,
          [TENANT_TRADE, decl, "11111111-1111-1111-1111-111111111111"],
        ),
      "fk_customs_declaration_lines_item",
      "23503",
    );
  });

  it("the (tenant, declaration, line) uniqueness; the HS registry's own shapes", async () => {
    const decl = await freshTradeDeclaration("DECL-UQ");
    await su.query(
      `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, customs_value)
       VALUES (gen_random_uuid(), $1, $2, 5, '8471', 100)`,
      [TENANT_TRADE, decl],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code, customs_value)
           VALUES (gen_random_uuid(), $1, $2, 5, '8471', 100)`,
          [TENANT_TRADE, decl],
        ),
      "uq_customs_declaration_lines_tenant_decl_line",
      "23505",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO hs_code_registry (id, tenant_id, hs_code, name, name_ar)
           VALUES (gen_random_uuid(), $1, '8A', 'Bad', 'سيء')`,
          [TENANT_TRADE],
        ),
      "ck_hs_code_registry_code",
      "23514",
    );
    await su.query(
      `INSERT INTO hs_code_registry (id, tenant_id, hs_code, name, name_ar, note)
       VALUES (gen_random_uuid(), $1, '90', 'Optical, photographic, medical instruments',
         'الأدوات البصرية والتصوير والطبية', 'STARTER SET — the tenant owns the final classification')`,
      [TENANT_TRADE],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO hs_code_registry (id, tenant_id, hs_code, name, name_ar)
           VALUES (gen_random_uuid(), $1, '90', 'Duplicate', 'مكرر')`,
          [TENANT_TRADE],
        ),
      "uq_hs_code_registry_tenant_code",
      "23505",
    );
  });
});

describe("PHASE-051 W-33 — THE G-66 FLOORS + the drawback gate (0121, L-14/L-12)", () => {
  it("the legal shapes: an in-bond transfer between the two warehouses; a DRAFT drawback claim", async () => {
    await su.query(
      `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, from_warehouse_id,
         to_warehouse_id, lines, status)
       VALUES (gen_random_uuid(), $1, 'BND-LEGAL-1', 'IN_BOND', $2, $3,
         '[{"itemId":null,"description":"Pallets under bond","qty":10}]'::jsonb, 'DRAFT')`,
      [TENANT_TRADE, warehouseAId, warehouseBId],
    );
    await su.query(
      `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, claimed_amount, currency, status)
       VALUES (gen_random_uuid(), $1, 'DRB-LEGAL-1', 1500, 'SAR', 'DRAFT')`,
      [TENANT_TRADE],
    );
  });

  it("THE G-66 NO-DUTY FLOOR: an in-bond transfer carrying a duty figure refused BY NAME", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, from_warehouse_id,
             to_warehouse_id, duty_amount, status)
           VALUES (gen_random_uuid(), $1, 'BND-INDUTY-1', 'IN_BOND', $2, $3, 500, 'DRAFT')`,
          [TENANT_TRADE, warehouseAId, warehouseBId],
        ),
      "ck_bonded_warehouse_moves_in_bond_no_duty",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, from_warehouse_id,
             to_warehouse_id, release_recognized_at, status)
           VALUES (gen_random_uuid(), $1, 'BND-INSTAMP-1', 'IN_BOND', $2, $3,
             '2026-11-20T10:00:00Z', 'DRAFT')`,
          [TENANT_TRADE, warehouseAId, warehouseBId],
        ),
      "ck_bonded_warehouse_moves_in_bond_no_duty",
      "23514",
    );
  });

  it("THE BR-107 ATOMIC STAMPS: the release trio TOGETHER — partial shapes refused BY NAME", async () => {
    const decl = await freshTradeDeclaration("BND-REL");
    // duty + recognized_at, no journal entry
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, declaration_id,
             duty_amount, release_recognized_at, status)
           VALUES (gen_random_uuid(), $1, 'BND-REL-NOJ', 'RELEASE', $2, 500,
             '2026-11-20T10:00:00Z', 'DRAFT')`,
          [TENANT_TRADE, decl],
        ),
      "ck_bonded_warehouse_moves_release_shape",
      "23514",
    );
    // journal + recognized_at, no duty figure
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, declaration_id,
             release_recognized_at, release_journal_entry_id, status)
           VALUES (gen_random_uuid(), $1, 'BND-REL-NODUTY', 'RELEASE', $2,
             '2026-11-20T10:00:00Z', $3, 'DRAFT')`,
          [TENANT_TRADE, decl, DUMMY_JOURNAL],
        ),
      "ck_bonded_warehouse_moves_release_shape",
      "23514",
    );
    // the full trio WITHOUT the declaration link (the G-65 shape's own
    // source law: the duty recognized is the declaration's own figure)
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, duty_amount,
             release_recognized_at, release_journal_entry_id, status)
           VALUES (gen_random_uuid(), $1, 'BND-REL-NODECL', 'RELEASE', 500,
             '2026-11-20T10:00:00Z', $2, 'DRAFT')`,
          [TENANT_TRADE, DUMMY_JOURNAL],
        ),
      "ck_bonded_warehouse_moves_release_shape",
      "23514",
    );
  });

  it("the release's journal stamp carries the COMPOSITE FK — the dummy entry refuses 23503", async () => {
    const decl = await freshTradeDeclaration("BND-REL-FK");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, declaration_id,
             duty_amount, release_recognized_at, release_journal_entry_id, status)
           VALUES (gen_random_uuid(), $1, 'BND-REL-FK-1', 'RELEASE', $2, 500,
             '2026-11-20T10:00:00Z', $3, 'DRAFT')`,
          [TENANT_TRADE, decl, DUMMY_JOURNAL],
        ),
      "fk_bonded_warehouse_moves_release_journal",
      "23503",
    );
  });

  it("the execution stamp law: EXECUTED without its stamp refused; the stamps on DRAFT refused", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, from_warehouse_id,
             to_warehouse_id, status)
           VALUES (gen_random_uuid(), $1, 'BND-EXEC-1', 'IN_BOND', $2, $3, 'EXECUTED')`,
          [TENANT_TRADE, warehouseAId, warehouseBId],
        ),
      "ck_bonded_warehouse_moves_executed_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, from_warehouse_id,
             to_warehouse_id, status, executed_at)
           VALUES (gen_random_uuid(), $1, 'BND-EXEC-2', 'IN_BOND', $2, $3, 'DRAFT',
             '2026-11-20T10:00:00Z')`,
          [TENANT_TRADE, warehouseAId, warehouseBId],
        ),
      "ck_bonded_warehouse_moves_executed_shape",
      "23514",
    );
  });

  it("THE BR-108 EVIDENCE FLOOR: submission without the linked export evidence refused BY NAME", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, claimed_amount, currency, status)
           VALUES (gen_random_uuid(), $1, 'DRB-NOEV-1', 1500, 'SAR', 'SUBMITTED')`,
          [TENANT_TRADE],
        ),
      "ck_duty_drawback_claims_evidence",
      "23514",
    );
  });

  it("the drawback workflow stamps + the amount law; the evidence-armed legal submission", async () => {
    const bl = await freshTradeBl("DRB-EV");
    await su.query(
      `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, export_bill_of_lading_id,
         claimed_amount, currency, status, submitted_at)
       VALUES (gen_random_uuid(), $1, 'DRB-LEGAL-SUB', $2, 1500, 'SAR', 'SUBMITTED',
         '2026-11-20T10:00:00Z')`,
      [TENANT_TRADE, bl],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, claimed_amount, currency, status)
           VALUES (gen_random_uuid(), $1, 'DRB-AMT-0', 0, 'SAR', 'DRAFT')`,
          [TENANT_TRADE],
        ),
      "ck_duty_drawback_claims_amount",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, claimed_amount, currency, status, submitted_at)
           VALUES (gen_random_uuid(), $1, 'DRB-DRAFT-ST', 100, 'SAR', 'DRAFT', '2026-11-20T10:00:00Z')`,
          [TENANT_TRADE],
        ),
      "ck_duty_drawback_claims_submitted_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, claimed_amount, currency, status, decided_at)
           VALUES (gen_random_uuid(), $1, 'DRB-DEC-DRAFT', 100, 'SAR', 'DRAFT', '2026-11-20T10:00:00Z')`,
          [TENANT_TRADE],
        ),
      "ck_duty_drawback_claims_decided_shape",
      "23514",
    );
  });
});

describe("PHASE-051 W-33 — the tracking events (0122, L-11/D-14)", () => {
  it("the legal shape: an event anchored on the B/L (the shipment's identity)", async () => {
    const bl = await freshTradeBl("TRK-LEGAL");
    await su.query(
      `INSERT INTO shipment_tracking_events (id, tenant_id, bill_of_lading_id, milestone, event_at,
         carrier_ref, location)
       VALUES (gen_random_uuid(), $1, $2, 'BOOKED', '2026-11-24T08:00:00Z', 'REF-001', 'Port Jeddah')`,
      [TENANT_TRADE, bl],
    );
  });

  it("the milestone vocabulary closed — an UNKNOWN EVENT refused BY NAME (the fold's own floor)", async () => {
    const bl = await freshTradeBl("TRK-BAD");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO shipment_tracking_events (id, tenant_id, bill_of_lading_id, milestone, event_at)
           VALUES (gen_random_uuid(), $1, $2, 'DELAYED', '2026-11-24T08:00:00Z')`,
          [TENANT_TRADE, bl],
        ),
      "ck_shipment_tracking_events_milestone",
      "23514",
    );
  });

  it("the events carry the B/L composite FK — a foreign-tenant B/L refuses 23503", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO shipment_tracking_events (id, tenant_id, bill_of_lading_id, milestone, event_at)
           VALUES (gen_random_uuid(), $1, $2, 'BOOKED', '2026-11-24T08:00:00Z')`,
          [TENANT_TRADE, "11111111-1111-1111-1111-111111111111"],
        ),
      "fk_shipment_tracking_events_bl",
      "23503",
    );
  });
});

describe("PHASE-051 W-33 — the no-GL shape of the drawback claim (the 050 note-20 law)", () => {
  it("the claim carries NO journal column — asserted structurally (the refund lands in treasury, 053's surface)", async () => {
    const columns = await su.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'duty_drawback_claims' AND table_schema = 'public'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names.some((name) => name.includes("journal"))).toBe(false);
    // the same structural assertion for the certificates + transport
    // documents + collections (the non-ledger-document law): none of
    // the fourteen tables outside the LC/bonded stamps carries a
    // journal column.
    for (const table of [
      "bills_of_lading",
      "packing_lists",
      "certificates_of_origin",
      "documentary_collections",
      "customs_declarations",
      "shipment_tracking_events",
    ]) {
      const cols = await su.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = 'public'`,
        [table],
      );
      expect(
        cols.rows.some((row) => row.column_name.includes("journal")),
        `${table} carries no journal column`,
      ).toBe(false);
    }
  });
});
