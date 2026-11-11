import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../../infra/db/client";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import * as sourcingStore from "../../../purchasing/infrastructure/sourcing.store";
import * as collaborationStore from "../../../purchasing/infrastructure/collaboration.store";

/**
 * PHASE-038 · the sourcing query surface for the report contracts: the
 * frozen comparison/award matrix (rendered VERBATIM from the stored
 * snapshot — the evidence contract) and the scorecard list. Read-only
 * over the ambient tenant transaction (the registry query-service
 * convention).
 */

export interface AwardMatrixRender {
  snapshot: Record<string, unknown>;
  award: Record<string, unknown> | null;
  generatedDocs: { kind: string; id: string; documentNo?: string | null }[] | null;
  supplierNames: Record<string, string>;
}

export interface ScorecardReportRow {
  supplierId: string;
  supplierName: string;
  windowStart: string;
  windowEnd: string;
  deliveryScore: string;
  qualityScore: string;
  priceScore: string;
  overallScore: string;
  sampleSize: number;
}

export class SourcingQueriesService {
  /** The frozen matrix verbatim (null when no live comparison exists). */
  async awardMatrix(rfqId: string): Promise<AwardMatrixRender | null> {
    const comparison = await sourcingStore.findLiveComparisonByRfq(rfqId);
    if (comparison === undefined) return null;
    const tx = tenantTx();
    const supplierIds = new Set<string>();
    const snapshot = comparison.snapshot as unknown as {
      lines?: { offers?: { supplierId: string }[] }[];
    };
    for (const line of snapshot.lines ?? []) {
      for (const offer of line.offers ?? []) supplierIds.add(offer.supplierId);
    }
    const names: Record<string, string> = {};
    for (const supplierId of supplierIds) {
      const rows = await tx.execute(sql`
        SELECT name, code FROM partners WHERE id = ${supplierId} LIMIT 1
      `);
      const row = (rows.rows as unknown as { name: string; code: string }[])[0];
      names[supplierId] = row ? `${row.code} — ${row.name}` : supplierId;
    }
    return {
      snapshot: comparison.snapshot,
      award: comparison.award,
      generatedDocs: comparison.generatedDocs,
      supplierNames: names,
    };
  }

  /** The stored scorecards (optionally one supplier), within the window. */
  async scorecards(filter: {
    supplierId: string | null;
    dateFrom: string;
    dateTo: string;
  }): Promise<ScorecardReportRow[]> {
    const rows =
      filter.supplierId !== null
        ? [await collaborationStore.findSupplierRating(filter.supplierId)].filter(
            (r): r is NonNullable<typeof r> => r !== undefined,
          )
        : await collaborationStore.listSupplierRatings(500);
    const inWindow = rows.filter(
      (r) => r.windowStart <= filter.dateTo && r.windowEnd >= filter.dateFrom,
    );
    const tx = tenantTx();
    const out: ScorecardReportRow[] = [];
    for (const row of inWindow) {
      const partner = await tx.execute(sql`
        SELECT name, code FROM partners WHERE id = ${row.supplierId} LIMIT 1
      `);
      const p = (partner.rows as unknown as { name: string; code: string }[])[0];
      out.push({
        supplierId: row.supplierId,
        supplierName: p ? `${p.code} — ${p.name}` : row.supplierId,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        deliveryScore: row.deliveryScore,
        qualityScore: row.qualityScore,
        priceScore: row.priceScore,
        overallScore: row.overallScore,
        sampleSize: row.sampleSize,
      });
    }
    return out;
  }
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("sourcing report reads require an ambient tenant scope");
  }
  return context.tx;
}
