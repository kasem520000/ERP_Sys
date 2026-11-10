import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { AuditService } from "../../audit/api/audit";
import { EMAIL_SERVICE } from "../../notifications/notifications.module";
import { type EmailService } from "../../notifications/application/email-service";
import { InboxService } from "../../notifications/application/inbox-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/inventory.store";

/**
 * Reorder monitoring (PHASE-010 T11; §2.14; BR-019): the nightly scan over
 * `item_warehouse_settings` — every active warehouse item whose on-hand ≤
 * its reorder level emits ONE `stock.below_reorder` digest per tenant per
 * window (24 h — `last_reorder_alerted_at` is the once-per-window dedupe
 * stamp). Alert, NOT autopilot: no purchase orders are created, nothing
 * reorders on its own (BR-019 fixed).
 *
 * PHASE-015 T10 adds the in-app alerting leg + the replenishment
 * suggestions surface: the scan now ALSO records an in-app notification
 * (category `stock`, severity warning) in the owner's inbox — same 24 h
 * window discipline via the dedupe key `stock.below_reorder:<window>` —
 * alongside the existing email + audit, and `belowReorderList()` exposes
 * the replenishment suggestions (suggested reorder quantity per item;
 * still an alert surface, never a PO).
 *
 * The durable, assertable surface is the audit event + the dedupe stamp +
 * the inbox row; the email rides the notifications module's templated
 * adapter (AR+EN), addressed to the tenant's owner (first owner-role
 * membership).
 */
const WINDOW_HOURS = 24;
/** How many item names the in-app digest body names (the rest stay a count). */
const MAX_NAMED_ITEMS = 5;

export interface BelowReorderRow {
  itemId: string;
  itemSku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseId: string;
  warehouseCode: string;
  qtyOnHand: string;
  reorderLevel: string;
  minQty: string;
  /** Suggested replenishment qty: max(reorder level × 2 − on-hand, reorder level). */
  suggestedReorderQty: string;
}

@Injectable()
export class ReorderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /** The tenant owner's email (first owner-role membership — read-only). */
  async ownerEmail(): Promise<string | null> {
    const context = requireTenantContext();
    const rows = await store
      .inventoryTx()
      .execute(sql`
        SELECT u.email
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
        WHERE m.tenant_id = ${context.tenantId} AND r.key = 'owner'
        ORDER BY m.created_at
        LIMIT 1
      `);
    return (rows.rows as unknown as { email: string }[])[0]?.email ?? null;
  }

  /**
   * The nightly scan (pg-boss schedule + on-demand endpoint). Returns the
   * per-window digest; re-running inside the window is a documented no-op
   * for already-alerted rows (the test asserts exactly-once).
   */
  async runNightlyScan(input: {
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }): Promise<{
    belowReorder: number;
    alerted: number;
    withinWindow: number;
    recipient: string | null;
    notifiedInApp: boolean;
  }> {
    const candidates = await store.listReorderCandidates();
    const now = Date.now();
    const windowMs = WINDOW_HOURS * 3_600_000;
    const due = candidates.filter(
      (row) =>
        row.lastReorderAlertedAt === null ||
        now - Date.parse(row.lastReorderAlertedAt) >= windowMs,
    );
    const withinWindow = candidates.length - due.length;
    if (due.length === 0) {
      return {
        belowReorder: candidates.length,
        alerted: 0,
        withinWindow,
        recipient: null,
        notifiedInApp: false,
      };
    }

    const items = due
      .map(
        (row) =>
          `${row.itemSku} — ${row.itemName} @ ${row.warehouseCode}: ${row.qtyOnHand} ≤ ${row.reorderLevel}`,
      )
      .join("\n");
    const recipient = await this.ownerEmail();
    if (recipient !== null) {
      const context = requireTenantContext();
      const tenantRows = await store.inventoryTx().execute(sql`
        SELECT name FROM tenants WHERE id = ${context.tenantId}
      `);
      const tenantName = (tenantRows.rows as unknown as { name: string }[])[0]?.name ?? "ERP";
      await this.email.enqueue(context.tenantId, {
        template: "stock_below_reorder",
        locale: "ar",
        recipient,
        variables: { tenantName, items },
      });
    }

    // PHASE-015 T10 · the in-app leg: ONE `stock`-category digest in the
    // owner's inbox per 24h window (dedupe key carries the window index, so
    // a later scan inside the same window — even with newly-due rows —
    // never duplicates). Prefs suppress per channel; BR-019 unchanged.
    const notifiedInApp = await this.recordInAppDigest(candidates, due, now, windowMs);

    for (const row of due) {
      await store.markReorderAlerted(row.settingId);
    }
    await this.audit.record({
      action: "inventory.stock_below_reorder",
      entityType: "item_warehouse_setting",
      entityId: due[0]!.settingId,
      actorId: input.checkedBy ?? undefined,
      after: {
        runMode: input.runMode,
        belowReorder: candidates.length,
        alerted: due.length,
        withinWindow,
        notifiedInApp,
        items: due.map((row) => ({
          itemId: row.itemId,
          warehouseId: row.warehouseId,
          qtyOnHand: row.qtyOnHand,
          reorderLevel: row.reorderLevel,
        })),
      },
    });
    return {
      belowReorder: candidates.length,
      alerted: due.length,
      withinWindow,
      recipient,
      notifiedInApp,
    };
  }

  /**
   * The in-app digest row (category `stock`): bilingual title/body naming
   * the below-reorder count + up to ${MAX_NAMED_ITEMS} item names, an
   * action link to the replenishment view. Returns whether a NEW row was
   * inserted (a dedupe hit is success, not a duplicate).
   */
  private async recordInAppDigest(
    candidates: readonly {
      itemSku: string;
      itemName: string;
    }[],
    due: readonly { itemSku: string; itemName: string }[],
    now: number,
    windowMs: number,
  ): Promise<boolean> {
    const target = await this.inbox.ownerTarget();
    if (target === null) {
      return false;
    }
    const prefs = await this.inbox.prefsFor(target.userId, "stock");
    if (!prefs.inApp) {
      return false;
    }
    const named = due
      .slice(0, MAX_NAMED_ITEMS)
      .map((row) => `${row.itemSku} — ${row.itemName}`)
      .join("، ");
    const count = candidates.length;
    const outcome = await this.inbox.record({
      category: "stock",
      severity: "warning",
      title: {
        ar: `أصناف بلغت حد إعادة الطلب (${count})`,
        en: `${count} item(s) at or below reorder level`,
      },
      body: {
        ar:
          `${count} صنف/أصناف بلغت حد إعادة الطلب أو دونه` +
          (named === "" ? "" : `: ${named}`) +
          ". هذا تنبيه فقط — لا يتم إنشاء أوامر شراء تلقائيًا (BR-019).",
        en:
          `${count} item(s) are at or below their reorder level` +
          (named === "" ? "" : `: ${named}`) +
          ". Alert only — no purchase orders are created automatically (BR-019).",
      },
      actionLabel: { ar: "مراجعة مقترحات التزويد", en: "Review replenishment suggestions" },
      actionUrl: "/inventory/below-reorder",
      // The 24h window index — integer arithmetic only (ADR-0009: no
      // floating-point rounding; the division is exact by construction).
      dedupeKey: `stock.below_reorder:${(now - (now % windowMs)) / windowMs}`,
      userId: target.userId,
    });
    return outcome.inserted;
  }

  /**
   * PHASE-015 · the replenishment suggestions surface (the report route
   * GET /inventory/reports/below-reorder): every item/warehouse at or
   * below its reorder level with a suggested reorder quantity —
   * max(reorder level × 2 − on-hand, reorder level). The predicate is the
   * scan's own (`listReorderCandidates` — same active-warehouse,
   * reorder-level, on-hand conditions) so the alert and the suggestion
   * surface can never disagree. SUGGESTION ONLY: the caller decides;
   * nothing here creates a purchase order (BR-019).
   */
  async belowReorderList(): Promise<BelowReorderRow[]> {
    const rows = await store
      .inventoryTx()
      .execute(sql`
        SELECT s.item_id AS "itemId", it.sku AS "itemSku",
               it.name AS "itemName", it.name_ar AS "itemNameAr",
               s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
               COALESCE(st.qty, '0')::text AS "qtyOnHand",
               s.reorder_level::text AS "reorderLevel", s.min_qty::text AS "minQty"
        FROM item_warehouse_settings s
        JOIN items it ON it.id = s.item_id AND it.tenant_id = s.tenant_id
        JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
        LEFT JOIN item_stock st ON st.item_id = s.item_id
          AND st.warehouse_id = s.warehouse_id AND st.tenant_id = s.tenant_id
        WHERE w.is_active AND s.reorder_level > 0
          AND COALESCE(st.qty, '0') <= s.reorder_level
        ORDER BY it.sku, w.code
      `);
    return (rows.rows as unknown as Omit<BelowReorderRow, "suggestedReorderQty">[]).map((row) => {
      const suggested = Decimal.max(
        new Decimal(row.reorderLevel).times(2).minus(new Decimal(row.qtyOnHand)),
        new Decimal(row.reorderLevel),
      );
      return { ...row, suggestedReorderQty: suggested.toDecimalPlaces(6, Decimal.ROUND_UP).toFixed(6) };
    });
  }
}
