import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import {
  M_ACTOR,
  TENANT_M,
  mrpSuggestions,
  orders,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";
import * as planning from "../../modules/manufacturing/infrastructure/planning.store";
import { MrpSuggestionStateError } from "../../modules/manufacturing/domain/manufacturing-errors";

/**
 * PHASE-043 audit item 3 — the suggestion-conversion races.
 *
 * The audit's finding (confirmed by code reading): MrpSuggestionsService
 * accepted with a plain read → document creation → unguarded patch. Two
 * concurrent transactions both read SUGGESTED, both created a document,
 * and the last patch overwrote the link — two documents, one orphaned, no
 * error. The partial unique index (uq_mrp_suggestions_converted_doc) only
 * anchors the doc→suggestion direction (ONE document claimed by ONE
 * suggestion); it never prevented two DIFFERENT documents for one
 * suggestion — the code comment overstated it (fixed).
 *
 * The fix: the LOCKED read (SELECT … FOR UPDATE inside the caller's one
 * UoW — withTenant wraps the whole method in a single transaction, so the
 * document creation and the link commit or roll back TOGETHER) + the
 * status-guarded patch (requireStatus SUGGESTED) as belt-and-braces. The
 * second concurrent accept now BLOCKS at the read until the first
 * commits, then REPLAYS the stored conversion (INV-030's idempotent law)
 * instead of creating a second document.
 *
 * The three raced pairs (each on its own fresh suggestion, the promises
 * started together and settled with allSettled):
 *   (a) accept vs accept  → both fulfill, ONE document, the loser replays.
 *   (b) accept vs dismiss → exactly one effect; the loser is the typed
 *       state error; the final state matches the winner.
 *   (c) accept vs the re-run supersede (the engine's exact supersede
 *       write) → never both effects on one row; consistent either way.
 */

const spec: { fixture?: MfgFixture; item?: string } = {};

/** A fresh SUGGESTED PRODUCTION_ORDER suggestion on the shared fixture —
 * created in its OWN committed transaction (the racing calls must see it,
 * exactly like a planner's board request after the run committed). */
async function freshSuggestion(): Promise<string> {
  return withTenant(TENANT_M, async () => {
  const run = await planning.insertMrpRun({
    runMode: "NET_CHANGE",
    bucketSize: "DAY",
    horizonBuckets: 7,
    warehouseId: spec.fixture!.warehouseFg,
    asOfDate: "2026-03-01",
    scopeItemIds: [spec.item!],
    params: {},
    actorId: M_ACTOR,
  });
  await planning.patchMrpRun({ id: run.id, status: "COMPLETED" });
  const [suggestion] = await planning.insertMrpSuggestions([
    {
      runId: run.id,
      itemId: spec.item!,
      warehouseId: spec.fixture!.warehouseFg,
      fromWarehouseId: null,
      suggestionType: "PRODUCTION_ORDER",
      qty: "3",
      uomId: null,
      dueDate: "2026-03-20",
      releaseDate: "2026-03-13",
      frozenFence: false,
      substitutedItemId: null,
      bomId: null,
      netting: {},
      actorId: M_ACTOR,
    },
  ]);
  return suggestion!.id;
  });
}

/** The MOs linked to a suggestion (the orphan detector) — its own
 * committed read of the post-race state. */
async function linkedMos(suggestionId: string): Promise<readonly { id: string }[]> {
  return withTenant(TENANT_M, async () => {
    const mos = await orders.list({ limit: 500 });
    return mos.filter((row) => row.mrpSuggestionId === suggestionId);
  });
}

/** The post-race suggestion row — its own committed read. */
async function suggestionRow(suggestionId: string): Promise<planning.MrpSuggestionRow> {
  return withTenant(TENANT_M, async () => {
    const row = await planning.findMrpSuggestionById(suggestionId);
    expect(row).toBeDefined();
    return row!;
  });
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const found = await itemsStore.findItemBySku("M-RACE-FG");
    if (found !== undefined) {
      spec.item = found.id;
      return;
    }
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const created = await itemsStore.insertItem({
      sku: "M-RACE-FG",
      name: "Conversion-race FG",
      nameAr: null,
      kind: "STOCK",
      uomId: pcs.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: true,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      shelfLifeDays: null,
      reorderLevel: null,
      reorderQty: null,
      basePrice: null,
    });
    spec.item = created.id;
  });
});

describe("PHASE-043 audit item 3 — the conversion races (serialized on the row lock)", () => {
  it("accept vs accept: both settle, ONE document, the loser replays the winner's document (INV-030 under concurrency)", async () => {
    {
      const id = await freshSuggestion();
      const settled = await Promise.allSettled([
        withTenant(TENANT_M, () => mrpSuggestions.accept(id, M_ACTOR)),
        withTenant(TENANT_M, () => mrpSuggestions.accept(id, M_ACTOR)),
      ]);
      // Both fulfill — the loser is the idempotent replay, never an error
      // and never a second document.
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      const first = settled[0]!.status === "fulfilled" ? settled[0]!.value : undefined;
      const second = settled[1]!.status === "fulfilled" ? settled[1]!.value : undefined;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      const replays = [first!.replay, second!.replay].sort();
      expect(replays).toEqual([false, true]); // exactly one real conversion
      // The SAME document both ways — the loser replayed the winner's.
      expect(second!.documentId).toBe(first!.documentId);
      // Exactly ONE MO carries the suggestion link (no orphan).
      const linked = await linkedMos(id);
      expect(linked).toHaveLength(1);
      expect(linked[0]!.id).toBe(first!.documentId);
      // The suggestion row links that document.
      const row = await suggestionRow(id);
      expect(row.status).toBe("ACCEPTED");
      expect(row.convertedDocId).toBe(first!.documentId);
    }
  });

  it("accept vs dismiss: exactly one effect; the loser is the typed state error; the final state matches the winner", async () => {
    {
      const id = await freshSuggestion();
      const settled = await Promise.allSettled([
        withTenant(TENANT_M, () => mrpSuggestions.accept(id, M_ACTOR)),
        withTenant(TENANT_M, () => mrpSuggestions.dismiss(id, "planner chose otherwise", M_ACTOR)),
      ]);
      const outcomes = settled.map((s) => s.status).sort();
      expect(outcomes).toEqual(["fulfilled", "rejected"]); // never both effects
      const row = await suggestionRow(id);
      const linked = await linkedMos(id);
      const acceptWon = row.status === "ACCEPTED";
      const dismissWon = row.status === "DISMISSED";
      expect(acceptWon || dismissWon).toBe(true);
      if (acceptWon) {
        // The dismiss lost: the typed state error (ACCEPTED ≠ SUGGESTED).
        const rejected = settled.find((s) => s.status === "rejected") as
          | { status: "rejected"; reason: unknown }
          | undefined;
        expect(rejected?.reason).toBeInstanceOf(MrpSuggestionStateError);
        expect(linked).toHaveLength(1);
        expect(row.convertedDocId).toBe(linked[0]!.id);
      } else {
        // The accept lost: the typed state error (DISMISSED ≠ SUGGESTED)
        // and its document creation rolled back with the throw (one UoW).
        const rejected = settled.find((s) => s.status === "rejected") as
          | { status: "rejected"; reason: unknown }
          | undefined;
        expect(rejected?.reason).toBeInstanceOf(MrpSuggestionStateError);
        expect(linked).toHaveLength(0);
        expect(row.convertedDocId).toBeNull();
      }
    }
  });

  it("accept vs the re-run supersede: never both effects on one row — ACCEPTED keeps its one document or SUPERSEDED rejects the accept", async () => {
    {
      const id = await freshSuggestion();
      const otherRunId = "11111111-2222-4333-8444-555555555555";
      const settled = await Promise.allSettled([
        withTenant(TENANT_M, () => mrpSuggestions.accept(id, M_ACTOR)),
        withTenant(TENANT_M, () =>
          planning.supersedeSuggestionsForItems({
            itemWarehousePairs: [
              { itemId: spec.item!, warehouseId: spec.fixture!.warehouseFg },
            ],
            supersededByRunId: otherRunId,
          }),
        ),
      ]);
      const row = await suggestionRow(id);
      const linked = await linkedMos(id);
      if (row.status === "ACCEPTED") {
        // The accept won the lock; the supersede's guarded UPDATE saw the
        // committed ACCEPTED row and skipped it (0 rows for this one).
        expect(settled[0]!.status).toBe("fulfilled");
        expect(linked).toHaveLength(1);
        expect(row.supersededByRunId).toBeNull();
      } else {
        // The supersede won; the accept's locked read saw SUPERSEDED — the
        // typed state error, its document rolled back with the throw.
        expect(row!.status).toBe("SUPERSEDED");
        expect(settled[0]!.status).toBe("rejected");
        expect((settled[0] as { status: "rejected"; reason: unknown }).reason).toBeInstanceOf(
          MrpSuggestionStateError,
        );
        expect(linked).toHaveLength(0);
        expect(row.convertedDocId).toBeNull();
      }
    }
  });
});
