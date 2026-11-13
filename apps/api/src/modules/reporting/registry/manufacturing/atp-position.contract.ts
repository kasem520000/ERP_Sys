import { z } from "zod";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-043 T-16 (REPORT_CATALOG addition · M-06/S-10): the ATP/CTP
 * position register — per item × warehouse with the BR-080 exclusion
 * evidence as FIRST-CLASS columns: the quarantined/HOLD bin qty, the ACTIVE
 * reservations, and the owner-partner (consignment) qty are shown but
 * NEVER counted into `available` — the register is the audit trail of what
 * was excluded and why. `ctp` = available + inbound (open POs + open MOs'
 * pending qty + inbound transfers + MPS production on/before as_of).
 */

const UUID_OPTIONAL = z.string().uuid().optional();

export const manufacturingAtpPositionContract = defineReport({
  id: "manufacturing.atp-position",
  version: 1,
  title: bilingual("مراكز المتاح للتعهد", "ATP/CTP Positions"),
  category: "industry",
  description: bilingual(
    "لكل صنف ومستودع: المتاح للتعهد وقدرة التعهد مع أعمدة الاستبعاد الصارمة (المحجوز، المعزول، ملكية الأمانة) — ما استُبعد ظاهر ولا يُعَد أبدًا",
    "Per item × warehouse: available/capable-to-promise with the hard-exclusion evidence columns (reserved, quarantined, consignment-owned) — what was excluded is VISIBLE and never counted",
  ),
  parameters: z.object({
    warehouseId: UUID_OPTIONAL,
    itemId: UUID_OPTIONAL,
    asOf: ISO_DATE.nullish(),
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.mrp",
  dataSources: [
    source(
      "manufacturing",
      "planningQueries.atpPositions",
      ["item_stock", "bin_contents", "stock_reservations", "purchase_orders", "production_orders", "stock_transfers", "mps_entries"],
      "مراكز ATP/CTP مع أدلة الاستبعاد (BR-080)",
      "The ATP/CTP positions with the BR-080 exclusion evidence",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "atp-br080-exclusions",
      "available = on-hand − quarantined − reserved (floored at 0) for EVERY row; consignment-owned stock never enters the computation (it is reported, never promised)",
      "المتاح = المتاح − المعزول − المحجوز لكل سطر؛ مخزون الأمانة لا يدخل الحساب أبدًا",
      "A row whose available includes excluded stock",
    ),
    assertDecl(
      "atp-non-negative",
      "available and ctp are never negative — an over-committed position renders 0, the shortfall lives in the exceptions report",
      "المتاح والقدرة غير سالبين أبدًا — الالتزام الزائد يظهر صفرًا والنقص في تقرير الاستثناءات",
      "A negative availability rendered",
    ),
  ],
  run: async (_ctx, params) => {
    const { planningQueries } = reportingServices();
    const rows = await planningQueries.atpPositions({
      warehouseId: (params.warehouseId as string | undefined) ?? undefined,
      itemId: (params.itemId as string | undefined) ?? undefined,
    });
    const DECIMAL_6DP = /^\d+\.\d{6}$/;
    const shapeOk = rows.every((row) =>
      [row.onHand, row.quarantined, row.reserved, row.consignmentOwned, row.available, row.inbound, row.ctp].every((value) =>
        DECIMAL_6DP.test(value),
      ),
    );
    const exclusionOk = rows.every((row) => {
      const onHand = Number(row.onHand);
      const quarantined = Number(row.quarantined);
      const reserved = Number(row.reserved);
      const available = Number(row.available);
      const expected = Math.max(onHand - quarantined - reserved, 0);
      return Math.abs(available - expected) < 1e-9;
    });
    const nonNegative = rows.every((row) => Number(row.available) >= 0 && Number(row.ctp) >= 0);
    const totalAvailable = rows.reduce((sum, row) => sum + Number(row.available), 0);
    const totalCtp = rows.reduce((sum, row) => sum + Number(row.ctp), 0);
    const totalExcluded = rows.reduce((sum, row) => sum + Number(row.quarantined) + Number(row.reserved), 0);
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "الاسم", "Name"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("onHand", "المتاح (دفتري)", "On-hand"),
        qtyCol("quarantined", "معزول/محجوز قانونيًا", "Quarantine/HOLD"),
        qtyCol("reserved", "محجوز", "Reserved"),
        qtyCol("consignmentOwned", "ملكية الأمانة (ظاهر، غير متاح)", "Consignment-owned (visible, never promised)"),
        qtyCol("available", "المتاح للتعهد", "ATP"),
        qtyCol("inbound", "قادم حتى اليوم", "Inbound ≤ as_of"),
        qtyCol("ctp", "قادر على التعهد", "CTP"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.warehouseId}`,
        values: {
          sku: row.sku,
          itemName: row.itemName,
          warehouseCode: row.warehouseCode,
          onHand: row.onHand,
          quarantined: row.quarantined,
          reserved: row.reserved,
          consignmentOwned: row.consignmentOwned,
          available: row.available,
          inbound: row.inbound,
          ctp: row.ctp,
        },
      })),
      totals: [
        { id: "atp-total", kind: "sum", label: bilingual("إجمالي المتاح للتعهد", "Total ATP"), amount: totalAvailable.toFixed(6) },
        { id: "ctp-total", kind: "sum", label: bilingual("إجمالي القادر على التعهد", "Total CTP"), amount: totalCtp.toFixed(6) },
        {
          id: "excluded-total",
          kind: "sum",
          label: bilingual("المستبعد صراحةً (BR-080)", "Hard-excluded (BR-080)"),
          amount: totalExcluded.toFixed(6),
        },
      ],
      assertionResults: [
        {
          id: "atp-br080-exclusions",
          status: exclusionOk && shapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            exclusionOk && shapeOk ? "المتاح يستبعد المعزول والمحجوز في كل سطر" : "سطر يتضمن مخزونًا مستبعدًا — BR-080 منتهكة",
            exclusionOk && shapeOk ? "every row's availability excludes quarantined + reserved stock" : "a row counted excluded stock — BR-080 violated",
          ),
        },
        {
          id: "atp-non-negative",
          status: nonNegative ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            nonNegative ? "لا قيم سالبة" : "قيمة سالبة ظهرت",
            nonNegative ? "no negative availability rendered" : "a negative availability appeared",
          ),
        },
      ],
      notes: [
        bilingual(
          "الاستبعاد صارم بلا استثناء (BR-080): المخزون المعزول/المحجوز قانونيًا ومخزون الأمانة لا يُعَد أبدًا — يظهر في أعمدته ليكون الاستبعاد مرئيًا وقابلًا للتدقيق. القادم يشمل أوامر الشراء المفتوحة وأوامر الإنتاج المفتوحة (المتبقي) والتحويلات العابرة وجدول الإنتاج الرئيسي حتى اليوم.",
          "The exclusions are HARD rules (BR-080): quarantined/HOLD, ACTIVE-reserved, and consignment-owned stock NEVER promise — each rides its own column so the exclusion is visible and auditable. Inbound covers open POs, open MOs' pending qty, in-transit transfers, and MPS production on/before as_of.",
        ),
      ],
    };
  },
});
