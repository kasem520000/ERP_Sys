/**
 * PHASE-050 (W-28 — T-14, 2026-11-23) THE RECALL-SCOPE PROPERTY TESTS —
 * the fold's own totality (the matrix walk, the dedupe law, the
 * deterministic sort under permutation).
 */
import { describe, expect, it } from "vitest";

import {
  RECALL_STATUSES,
  foldRecallCustomers,
  nextRecallMove,
  type DrillDocCustomer,
  type DrillSaleEdge,
} from "./recall-scope";

describe("nextRecallMove — the total status × move matrix", () => {
  it("the ladder walks its two rungs in order", () => {
    expect(nextRecallMove("INITIATED", "execute").allowed).toBe(true);
    expect(nextRecallMove("EXECUTED", "close").allowed).toBe(true);
  });

  it("every illegal cell is refused BY NAME (the full matrix walk)", () => {
    const moves = ["execute", "close"] as const;
    for (const status of RECALL_STATUSES) {
      for (const move of moves) {
        const verdict = nextRecallMove(status, move);
        const ladderOk =
          (status === "INITIATED" && move === "execute") ||
          (status === "EXECUTED" && move === "close");
        expect(verdict.allowed).toBe(ladderOk);
        if (!ladderOk) {
          expect(verdict.refusal).toBeDefined();
          expect(verdict.reason).toBeTruthy();
        }
      }
    }
  });

  it("the refusal names its rung (the typed-reason law)", () => {
    expect(nextRecallMove("INITIATED", "close").refusal).toBe("EXECUTION_REQUIRED");
    expect(nextRecallMove("EXECUTED", "execute").refusal).toBe("ALREADY_EXECUTED");
    expect(nextRecallMove("CLOSED", "execute").refusal).toBe("ALREADY_CLOSED");
  });
});

describe("foldRecallCustomers — the dedupe + determinism laws", () => {
  const edges: DrillSaleEdge[] = [
    { level: 1, batchId: "b1", docType: "delivery_note", docId: "d1", docDate: "2026-01-02", qty: "10.000000" },
    { level: 1, batchId: "b1", docType: "delivery_note", docId: "d2", docDate: "2026-01-03", qty: "5.000000" },
    { level: 2, batchId: "b2", docType: "sales_invoice", docId: "i1", docDate: "2026-01-04", qty: "3.000000" },
  ];
  const docs: DrillDocCustomer[] = [
    { docType: "delivery_note", docId: "d1", docNo: "DEL-1", customerId: "c2", customerName: "Beta", customerNameAr: null },
    { docType: "delivery_note", docId: "d2", docNo: "DEL-2", customerId: "c1", customerName: "Alpha", customerNameAr: "ألفا" },
    { docType: "sales_invoice", docId: "i1", docNo: "INV-1", customerId: "c1", customerName: "Alpha", customerNameAr: "ألفا" },
  ];

  it("dedupes the customers — Alpha once with BOTH documents", () => {
    const scopes = foldRecallCustomers(edges, docs);
    expect(scopes).toHaveLength(2);
    const alpha = scopes.find((scope) => scope.customerId === "c1")!;
    expect(alpha.documents).toHaveLength(2);
    expect(alpha.documents.map((doc) => doc.docId).sort()).toEqual(["d2", "i1"]);
  });

  it("keeps the edge's qty per document (the frozen figures verbatim)", () => {
    const scopes = foldRecallCustomers(edges, docs);
    const beta = scopes.find((scope) => scope.customerId === "c2")!;
    expect(beta.documents[0]!.qty).toBe("10.000000");
    expect(beta.documents[0]!.docNo).toBe("DEL-1");
  });

  it("sorts the customers deterministically (customerId ASC)", () => {
    expect(foldRecallCustomers(edges, docs).map((scope) => scope.customerId)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("is INVARIANT under the edge input order (property ×50)", () => {
    const baseline = JSON.stringify(foldRecallCustomers(edges, docs));
    let seed = 123456789;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    // The house bitwise truncation (ADR-0009 bans Math.floor; the index
    // math is a pure array position, far inside the 2^31 safe range).
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const shuffled = [...edges];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = (random() * (i + 1)) | 0;
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(JSON.stringify(foldRecallCustomers(shuffled, docs))).toBe(baseline);
    }
  });

  it("drops an edge whose document lookup is missing — HONESTLY, never fabricated", () => {
    const scopes = foldRecallCustomers(
      edges,
      docs.filter((doc) => doc.docId !== "d1"),
    );
    // c2 was reached ONLY through d1 — its scope drops with the missing
    // lookup (never a fabricated customer row); c1 survives with BOTH
    // its documents (d2 + i1).
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.customerId).toBe("c1");
    expect(scopes[0]!.documents).toHaveLength(2);
  });

  it("the empty drill is the honest empty scope (a batch nothing left on)", () => {
    expect(foldRecallCustomers([], docs)).toEqual([]);
    expect(foldRecallCustomers(edges, [])).toEqual([]);
  });

  it("carries the Arabic name verbatim (the bilingual record's own law)", () => {
    const scopes = foldRecallCustomers(edges, docs);
    expect(scopes.find((scope) => scope.customerId === "c1")!.customerNameAr).toBe("ألفا");
  });
});
