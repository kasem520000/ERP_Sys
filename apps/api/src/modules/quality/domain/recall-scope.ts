/**
 * PHASE-050 (W-28 — T-14, 2026-11-23) THE RECALL-SCOPE FOLD — the PURE
 * layer first (the unit-first law, the plan §4's own arm). D-14: the
 * drill RECORD (the recall_registry row) is distinct from the drill
 * QUERY (the live read) — this fold assembles the drill's ANSWER shape
 * (the customers who received the batch, deduped and deterministic) and
 * guards the registry's own stamp ladder (0116's
 * ck_recall_registry_stamps). The genealogy walk itself is the EXISTING
 * manufacturing read (zero parallel computation — the fold consumes its
 * edges VERBATIM).
 */

export type RecallStatus = "INITIATED" | "EXECUTED" | "CLOSED";

export const RECALL_STATUSES: readonly RecallStatus[] = ["INITIATED", "EXECUTED", "CLOSED"];

/** The registry moves the service exposes (one guarded CAS each). */
export type RecallMove = "execute" | "close";

/** The refusal shapes (each maps to exactly one typed error's reason). */
export type RecallMoveRefusal =
  /** A close attempt on an INITIATED record — the drill must execute
   * first (the frozen snapshots are the executed paths' own record). */
  | "EXECUTION_REQUIRED"
  /** Any move on a CLOSED record — the register is evidence. */
  | "ALREADY_CLOSED"
  /** An execute attempt on an EXECUTED record (the single-use snapshot
   * stamp — the frozen scope never re-freezes). */
  | "ALREADY_EXECUTED";

export interface RecallMoveVerdict {
  allowed: boolean;
  refusal?: RecallMoveRefusal;
  reason?: string;
}

/**
 * The registry verdict for a move from a state. The ladder:
 * INITIATED →(execute)→ EXECUTED →(close)→ CLOSED. Every other cell is
 * refused with its named reason — the fold is total (the property test
 * walks the full matrix).
 */
export function nextRecallMove(status: RecallStatus, move: RecallMove): RecallMoveVerdict {
  if (status === "CLOSED") {
    return {
      allowed: false,
      refusal: "ALREADY_CLOSED",
      reason: "the recall is CLOSED — the register is evidence, no move reopens it",
    };
  }
  if (move === "execute") {
    if (status === "INITIATED") return { allowed: true };
    return {
      allowed: false,
      refusal: "ALREADY_EXECUTED",
      reason: "the drill's snapshots are single-use — the executed scope never re-freezes",
    };
  }
  // move === "close" on INITIATED | EXECUTED
  if (status === "EXECUTED") return { allowed: true };
  return {
    allowed: false,
    refusal: "EXECUTION_REQUIRED",
    reason: "the recall must execute its drill before it closes — the frozen snapshots are the executed paths' own record",
  };
}

/** One sales edge off the genealogy walk (the manufacturing read's own
 * shape — consumed VERBATIM, zero parallel computation). */
export interface DrillSaleEdge {
  level: number;
  batchId: string;
  docType: "sales_invoice" | "delivery_note";
  docId: string;
  docDate: string;
  qty: string;
}

/** One resolved document row (the store's doc→customer lookup). */
export interface DrillDocCustomer {
  docType: "sales_invoice" | "delivery_note";
  docId: string;
  docNo: string | null;
  customerId: string;
  customerName: string;
  customerNameAr: string | null;
}

/** The drill's per-customer answer (the frozen snapshot's own shape). */
export interface DrillCustomerScope {
  customerId: string;
  customerName: string;
  customerNameAr: string | null;
  /** The documents that reached this customer — deterministic
   * (docType, docNo, docId). */
  documents: {
    docType: "sales_invoice" | "delivery_note";
    docId: string;
    docNo: string | null;
    docDate: string;
    qty: string;
  }[];
}

/**
 * THE CUSTOMER FOLD: dedupe the customers across every sale edge (a
 * customer reached by two documents appears ONCE, both documents
 * carried), keep the edge's qty per document, sort deterministically
 * (customerId ASC; the documents by docType, docNo, docId). An edge
 * whose document lookup is missing (a doc deleted out from under the
 * append-only ledger — impossible by the guard, the belt-and-suspenders
 * law) is dropped HONESTLY and disclosed by the count delta the caller
 * can assert (never fabricated into a customer row).
 */
export function foldRecallCustomers(
  saleEdges: readonly DrillSaleEdge[],
  docs: readonly DrillDocCustomer[],
): DrillCustomerScope[] {
  const docByKey = new Map(docs.map((doc) => [`${doc.docType}:${doc.docId}`, doc]));
  const byCustomer = new Map<string, DrillCustomerScope>();
  for (const edge of saleEdges) {
    const doc = docByKey.get(`${edge.docType}:${edge.docId}`);
    if (doc === undefined) continue;
    let scope = byCustomer.get(doc.customerId);
    if (scope === undefined) {
      scope = {
        customerId: doc.customerId,
        customerName: doc.customerName,
        customerNameAr: doc.customerNameAr,
        documents: [],
      };
      byCustomer.set(doc.customerId, scope);
    }
    scope.documents.push({
      docType: edge.docType,
      docId: edge.docId,
      docNo: doc.docNo,
      docDate: edge.docDate,
      qty: edge.qty,
    });
  }
  const scopes = [...byCustomer.values()];
  for (const scope of scopes) {
    scope.documents.sort((a, b) =>
      a.docType === b.docType
        ? (a.docNo ?? a.docId) === (b.docNo ?? b.docId)
          ? a.docId < b.docId
            ? -1
            : 1
          : (a.docNo ?? a.docId) < (b.docNo ?? b.docId)
            ? -1
            : 1
        : a.docType < b.docType
          ? -1
          : 1,
    );
  }
  scopes.sort((a, b) => (a.customerId < b.customerId ? -1 : 1));
  return scopes;
}
