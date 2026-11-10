import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import * as journal from "../../../accounting/infrastructure/journal.store";
import { findPeriodById } from "../../../accounting/infrastructure/accounting.store";
import {
  addExact,
  compareExact,
  subExact,
} from "../../../accounting/application/decimal-strings";
import {
  addMonths,
  computeMonthlyAmount,
  monthIndexOf,
  monthStartOf,
  round4,
} from "../../../fixed_assets/application/depreciation-service";

/**
 * PHASE-026 T11 · the fixed-assets report queries (REPORT_CATALOG §9 rows —
 * the queries behind `fixed_assets.asset-register`,
 * `fixed_assets.depreciation-schedule` and `fixed_assets.movements`):
 * reporting-facing, read-only, executed inside the ambient tenant
 * transaction exactly like the PHASE-018/019 industry-queries precedents
 * (ADR-0011 — read-only over the PUBLISHED fixed_assets tables + the
 * accounting journal store for the GL side; this surface never writes and
 * only consumes the fixed_assets PURE kernel for the schedule projection).
 *
 * ── As-of reconstruction (the deterministic date anchors) ──────────────────
 *
 * Every figure is reconstructed FROM DATED SOURCE ROWS, never from live
 * read models — same (scope, dates, asOf) ⇒ byte-identical output:
 *
 *   capitalization  the G-21 journal (source_type FIXED_ASSET_CAPITALIZATION,
 *                   operation post) — entry_date anchors when an asset's
 *                   cost entered the ledger. A register row with NO G-21 is
 *                   an uncaptured drift row: it stays on the register side of
 *                   the ties (RC-10's "register row without its journal"
 *                   catch) and is listed with a marker.
 *   depreciation    depreciation_lines of POSTED runs; the ORIGINAL entry
 *                   (entry_date = the period's end date) counts through
 *                   asOf, the REVERSAL entry counts when its OWN entry_date
 *                   ≤ asOf (INV-014: the same-date reversal nets within asOf;
 *                   a later-dated reversal leaves the as-of figure intact —
 *                   exactly what the GL as-of read shows).
 *   revaluation     POSTED asset_revaluations joined to their journal entry
 *                   (entry_date = revaluation_date): gross legs
 *                   g = new_gross_value − cost and accum restatements
 *                   r = g − delta (current-basis.ts algebra, RC-10's fold).
 *   disposal        POSTED asset_disposals joined to their G-23 entry
 *                   (entry_date = disposal_date): the derecognition anchor.
 *
 * ── The tie algebra (fa-cost-tie / fa-accum-tie — RC-10 as-of) ────────────
 *
 *   REGISTER side (per category purpose key, whole tenant — display filters
 *   never narrow the ledger check):
 *     fa    = Σ cost of assets LIVE as-of (capitalized ≤ asOf, not
 *             derecognized ≤ asOf) + Σ g legs of revaluations ≤ asOf
 *     accum = Σ (opening_accumulated + posted lines ≤ asOf) of live assets
 *             + Σ r legs of revaluations ≤ asOf
 *   GL side (journal.accountBalancesAt, entry_date ≤ asOf, asOf timestamp
 *   null — the statement-queries anchor):
 *     fa    = Σ signed balances (DEBIT−CREDIT) of the accounts mapped to the
 *             categories' FIXED_ASSET purpose keys
 *     accum = Σ NEGATED signed balances of the ACCUM_DEPRECIATION accounts
 *             (credit-positive register convention — the GRNI sign
 *             precedent; the accum account is credit-natured)
 *   A DISPOSED-as-of asset contributes NO cost and NO (opening+lines) — the
 *   G-23 credit removed the raw cost and debited the frozen snapshot — but
 *   its revaluation legs {g, r} STAY (the no-recycling residue, DR-002).
 *
 * Money discipline (ADR-0009): canonical 4dp strings, exact decimal
 * arithmetic, tolerance 0, NO Math.* — quantities 6dp.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("fixed-assets report query requires an ambient tenant scope");
  }
  return context.tx;
}

function idsScopeSql(
  ids: readonly string[] | null | undefined,
  column: string,
): ReturnType<typeof sql> {
  if (ids === null || ids === undefined || ids.length === 0) {
    return sql`TRUE`;
  }
  return sql`${sql.raw(column)} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

/** Canonical 4dp normalization for GL text reads (the RC-10 precedent). */
function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Integer clamp without Math.* (negative → 0). */
function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

// -- shared as-of CTEs ----------------------------------------------------------------

/**
 * The date-anchored reconstruction fragments shared by the register, the
 * ties and the schedule (see the header for the anchor semantics).
 */
function asOfCtes(asOf: string) {
  return sql`
  cap AS (
    SELECT e.source_id AS asset_id, e.entry_date AS cap_date
    FROM journal_entries e
    WHERE e.source_type = 'FIXED_ASSET_CAPITALIZATION' AND e.operation = 'post'
      AND e.status = 'POSTED'
  ),
  disp AS (
    SELECT d.asset_id, e.entry_date AS disp_date
    FROM asset_disposals d
    JOIN journal_entries e ON e.id = d.journal_entry_id
    WHERE d.status = 'POSTED'
  ),
  lines_asof AS (
    SELECT dl.asset_id,
      COALESCE(SUM(
        (CASE WHEN e1.entry_date <= ${asOf} THEN dl.period_amount ELSE 0 END)
        - (CASE WHEN e2.id IS NOT NULL AND e2.entry_date <= ${asOf}
                THEN dl.period_amount ELSE 0 END)
      ), 0) AS lines_total
    FROM depreciation_lines dl
    JOIN depreciation_runs r ON r.id = dl.run_id
    LEFT JOIN journal_entries e1 ON e1.id = r.journal_entry_id
    LEFT JOIN journal_entries e2 ON e2.id = r.reversal_journal_entry_id
    WHERE r.status = 'POSTED' AND r.journal_entry_id IS NOT NULL
    GROUP BY dl.asset_id
  ),
  units_asof AS (
    SELECT dl.asset_id,
      COALESCE(SUM(
        (CASE WHEN e1.entry_date <= ${asOf} THEN dl.period_units ELSE 0 END)
        - (CASE WHEN e2.id IS NOT NULL AND e2.entry_date <= ${asOf}
                THEN dl.period_units ELSE 0 END)
      ), 0) AS units_total
    FROM depreciation_lines dl
    JOIN depreciation_runs r ON r.id = dl.run_id
    LEFT JOIN journal_entries e1 ON e1.id = r.journal_entry_id
    LEFT JOIN journal_entries e2 ON e2.id = r.reversal_journal_entry_id
    WHERE r.status = 'POSTED' AND r.journal_entry_id IS NOT NULL
      AND dl.period_units IS NOT NULL
    GROUP BY dl.asset_id
  ),
  rev_asof AS (
    SELECT rv.asset_id,
      SUM(rv.new_gross_value - a.cost) AS gross_legs,
      SUM((rv.new_gross_value - a.cost) - rv.delta) AS accum_legs
    FROM asset_revaluations rv
    JOIN assets a ON a.id = rv.asset_id
    JOIN journal_entries e ON e.id = rv.journal_entry_id
    WHERE rv.status = 'POSTED' AND e.entry_date <= ${asOf}
    GROUP BY rv.asset_id
  )`;
}

// -- fixed_assets.asset-register ------------------------------------------------------

/** One register row (raw + as-of derived figures; canonical 4dp strings). */
export interface AssetRegisterRow {
  assetId: string;
  code: string;
  name: string;
  nameAr: string;
  currentStatus: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  /** opening_accumulated + posted non-reversed lines through asOf (history). */
  accumulatedAsOf: string;
  /** cost − accumulatedAsOf (INV-023: ≥ salvage floor). */
  nbvAsOf: string;
  /** The as-of state: DISPOSED (incl. WRITTEN_OFF), FULLY_DEPRECIATED at the basis floor, else ACTIVE. */
  statusAsOf: string;
  /** Current-basis gross as-of: cost + Σ revaluation gross legs (≤ asOf). */
  basisGrossAsOf: string;
  /** Current-basis accumulated as-of: accumulatedAsOf + Σ accum restatements (≤ asOf). */
  basisAccumAsOf: string;
  usefulLifeMonths: number;
  depreciationMethod: string;
  categoryCode: string;
  categoryName: string;
  categoryNameAr: string;
  branchCode: string | null;
  custodianName: string | null;
  /** False when no G-21 journal exists — an uncaptured drift row (the tie catches it). */
  capitalized: boolean;
}

/** One tie side: totals + the per purpose-key breakdown (audit review, §1.5). */
export interface FaTieSide {
  registerTotal: string;
  glTotal: string;
  perKey: readonly {
    purposeKey: string;
    register: string;
    gl: string;
    accountCodes: readonly string[];
  }[];
}

export interface FaTieSides {
  fa: FaTieSide;
  accum: FaTieSide;
}

/** The 10k-asset design tenant, an order short of RC-10's scan bound. */
const REGISTER_ROW_LIMIT = 10_000;

@Injectable()
export class FixedAssetsQueriesService {
  /**
   * `fixed_assets.asset-register`: every asset in the as-of population —
   * capitalized through asOf (uncaptured drift rows listed + marked) — with
   * the history-based accumulated (opening + posted non-reversed lines
   * through asOf), the NBV, and the as-of status. Display filters
   * (branches/category/custodian/status) apply HERE; the ledger ties are
   * computed separately (whole tenant, `assetRegisterTies`).
   */
  async assetRegister(input: {
    asOf: string;
    branchIds: readonly string[] | null;
    categoryId: string | null;
    status: string | null;
    custodianUserId: string | null;
  }): Promise<AssetRegisterRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH ${asOfCtes(input.asOf)}
      SELECT a.id AS "assetId", a.code, a.name, a.name_ar AS "nameAr", a.status,
        a.acquisition_date AS "acquisitionDate", a.cost, a.salvage_value AS "salvageValue",
        a.opening_accumulated AS "openingAccumulated", a.useful_life_months AS "usefulLifeMonths",
        a.depreciation_method AS "depreciationMethod",
        c.code AS "categoryCode", c.name AS "categoryName", c.name_ar AS "categoryNameAr",
        b.code AS "branchCode", u.full_name AS "custodianName",
        COALESCE(lines_asof.lines_total, 0)::numeric(19,4)::text AS "linesAsOf",
        COALESCE(rev_asof.gross_legs, 0)::numeric(19,4)::text AS "grossLegsAsOf",
        COALESCE(rev_asof.accum_legs, 0)::numeric(19,4)::text AS "accumLegsAsOf",
        (cap.asset_id IS NOT NULL) AS "capitalized",
        (COALESCE(disp.disp_date <= ${input.asOf}, false)
          OR (a.status IN ('DISPOSED','WRITTEN_OFF')
              AND COALESCE(a.disposed_at, a.written_off_at)::date <= ${input.asOf})) AS "derecognizedAsOf"
      FROM assets a
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN branches b ON b.id = a.branch_id
      LEFT JOIN users u ON u.id = a.custodian_user_id
      LEFT JOIN cap ON cap.asset_id = a.id
      LEFT JOIN disp ON disp.asset_id = a.id
      LEFT JOIN lines_asof ON lines_asof.asset_id = a.id
      LEFT JOIN rev_asof ON rev_asof.asset_id = a.id
      WHERE (cap.asset_id IS NULL OR cap.cap_date <= ${input.asOf})
        AND (${input.categoryId ?? null}::uuid IS NULL OR a.category_id = ${input.categoryId ?? null})
        AND (${input.custodianUserId ?? null}::uuid IS NULL
              OR a.custodian_user_id = ${input.custodianUserId ?? null})
        AND ${idsScopeSql(input.branchIds, "a.branch_id")}
      ORDER BY a.code
      LIMIT ${REGISTER_ROW_LIMIT}
    `);

    const parsed = rows.rows as unknown as Array<{
      assetId: string;
      code: string;
      name: string;
      nameAr: string;
      currentStatus: string;
      derecognizedAsOf: boolean;
      capitalized: boolean;
      acquisitionDate: string;
      cost: string;
      salvageValue: string;
      openingAccumulated: string;
      usefulLifeMonths: number;
      depreciationMethod: string;
      linesAsOf: string;
      grossLegsAsOf: string;
      accumLegsAsOf: string;
      categoryCode: string;
      categoryName: string;
      categoryNameAr: string;
      branchCode: string | null;
      custodianName: string | null;
    }>;

    const derived: AssetRegisterRow[] = [];
    for (const row of parsed) {
      const accumulatedAsOf = money4(addExact(row.openingAccumulated, row.linesAsOf));
      const nbvAsOf = money4(subExact(row.cost, accumulatedAsOf));
      const basisGrossAsOf = money4(addExact(row.cost, row.grossLegsAsOf));
      const basisAccumAsOf = money4(addExact(accumulatedAsOf, row.accumLegsAsOf));
      const floor = money4(subExact(basisGrossAsOf, row.salvageValue));
      let statusAsOf: string;
      if (row.derecognizedAsOf) {
        statusAsOf =
          row.currentStatus === "DISPOSED" || row.currentStatus === "WRITTEN_OFF"
            ? row.currentStatus
            : "DISPOSED";
      } else {
        // The run-basis flip condition (the assembly's FULLY_DEPRECIATED
        // trigger): current-basis accumulated reached gross − salvage.
        statusAsOf = compareExact(basisAccumAsOf, floor) >= 0 ? "FULLY_DEPRECIATED" : "ACTIVE";
      }
      if (input.status !== null && input.status !== "" && input.status !== statusAsOf) {
        continue; // the status filter matches the AS-OF state (derived, never the live row)
      }
      derived.push({
        assetId: row.assetId,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        currentStatus: row.currentStatus,
        acquisitionDate: row.acquisitionDate,
        cost: money4(row.cost),
        salvageValue: money4(row.salvageValue),
        accumulatedAsOf,
        nbvAsOf,
        statusAsOf,
        basisGrossAsOf,
        basisAccumAsOf,
        usefulLifeMonths: row.usefulLifeMonths,
        depreciationMethod: row.depreciationMethod,
        categoryCode: row.categoryCode,
        categoryName: row.categoryName,
        categoryNameAr: row.categoryNameAr,
        branchCode: row.branchCode,
        custodianName: row.custodianName,
        capitalized: row.capitalized,
      });
    }
    return derived;
  }

  /**
   * The `fa-cost-tie` / `fa-accum-tie` sides (RC-10's register fold,
   * date-anchored to asOf; the GL side via journal.accountBalancesAt with
   * the entry-date anchor — see the header algebra). Whole tenant: the
   * ledger check is never narrowed by display filters. Purpose keys of
   * categories with NO assets fold to a 0 register side against the mapped
   * account's as-of balance (the RC-10 loop-2 drift catch).
   */
  async assetRegisterTies(input: { asOf: string }): Promise<FaTieSides> {
    const asOf = input.asOf;
    const livePredicate = sql`
      (cap.asset_id IS NULL OR cap.cap_date <= ${asOf})
      AND NOT (COALESCE(disp.disp_date <= ${asOf}, false)
        OR (a.status IN ('DISPOSED','WRITTEN_OFF')
            AND COALESCE(a.disposed_at, a.written_off_at)::date <= ${asOf}))`;
    const fold = await tenantTx().execute(sql`
      WITH ${asOfCtes(asOf)}
      SELECT c.asset_purpose_key AS "faKey", c.accum_depreciation_purpose_key AS "accumKey",
        SUM(CASE WHEN ${livePredicate} THEN a.cost ELSE 0 END)::numeric(19,4)::text AS "faAssets",
        SUM(CASE WHEN ${livePredicate}
              THEN (a.opening_accumulated + COALESCE(lines_asof.lines_total, 0)) ELSE 0 END)
              ::numeric(19,4)::text AS "accumAssets",
        SUM(COALESCE(rev_asof.gross_legs, 0))::numeric(19,4)::text AS "grossLegs",
        SUM(COALESCE(rev_asof.accum_legs, 0))::numeric(19,4)::text AS "accumLegs"
      FROM assets a
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN cap ON cap.asset_id = a.id
      LEFT JOIN disp ON disp.asset_id = a.id
      LEFT JOIN lines_asof ON lines_asof.asset_id = a.id
      LEFT JOIN rev_asof ON rev_asof.asset_id = a.id
      GROUP BY c.asset_purpose_key, c.accum_depreciation_purpose_key
    `);
    const folds = fold.rows as unknown as Array<{
      faKey: string;
      accumKey: string;
      faAssets: string;
      accumAssets: string;
      grossLegs: string;
      accumLegs: string;
    }>;

    // Every category's purpose keys — including categories with NO assets.
    const catRows = await tenantTx().execute(sql`
      SELECT asset_purpose_key AS "faKey", accum_depreciation_purpose_key AS "accumKey"
      FROM asset_categories
    `);
    const faKeys = new Set<string>();
    const accumKeys = new Set<string>();
    for (const cat of catRows.rows as unknown as Array<{ faKey: string; accumKey: string }>) {
      faKeys.add(cat.faKey);
      accumKeys.add(cat.accumKey);
    }

    const registerByFaKey = new Map<string, string>([...faKeys].map((k) => [k, "0.0000"]));
    const registerByAccumKey = new Map<string, string>([...accumKeys].map((k) => [k, "0.0000"]));
    for (const row of folds) {
      const faFold = money4(addExact(row.faAssets, row.grossLegs));
      registerByFaKey.set(row.faKey, money4(addExact(registerByFaKey.get(row.faKey) ?? "0.0000", faFold)));
      const accumFold = money4(addExact(row.accumAssets, row.accumLegs));
      registerByAccumKey.set(
        row.accumKey,
        money4(addExact(registerByAccumKey.get(row.accumKey) ?? "0.0000", accumFold)),
      );
    }

    // GL side: the accounts mapped to the categories' purpose keys, balances
    // as-of via the statement substrate (entry_date anchor, tolerance 0).
    const allKeys = [...new Set([...faKeys, ...accumKeys])];
    const mappings = allKeys.length > 0 ? await journal.accountsForPurposes(allKeys) : [];
    const balances = await journal.accountBalancesAt({ asOfDate: asOf, asOf: null });
    const balanceByAccount = new Map(balances.map((b) => [b.accountId, b.signedBalance] as const));
    const codesByAccount = new Map(balances.map((b) => [b.accountId, b.code] as const));

    const side = (keys: ReadonlySet<string>, negate: boolean): FaTieSide => {
      const accountsByKey = new Map<string, { accountIds: Set<string>; codes: string[] }>();
      for (const key of keys) {
        accountsByKey.set(key, { accountIds: new Set(), codes: [] });
      }
      for (const mapping of mappings) {
        const bucket = accountsByKey.get(mapping.purposeKey);
        if (bucket === undefined) continue;
        bucket.accountIds.add(mapping.accountId);
        const code = codesByAccount.get(mapping.accountId) ?? mapping.code;
        if (!bucket.codes.includes(code)) bucket.codes.push(code);
      }
      let registerTotal = "0.0000";
      let glTotal = "0.0000";
      const perKey: {
        purposeKey: string;
        register: string;
        gl: string;
        accountCodes: string[];
      }[] = [];
      const registerByKey = negate ? registerByAccumKey : registerByFaKey;
      for (const [purposeKey, bucket] of accountsByKey) {
        let glKey = "0.0000";
        for (const accountId of bucket.accountIds) {
          const signed = balanceByAccount.get(accountId) ?? "0";
          const contribution = negate ? money4(`-${signed}`) : money4(signed);
          glKey = money4(addExact(glKey, contribution));
        }
        const registerKey = money4(registerByKey.get(purposeKey) ?? "0.0000");
        registerTotal = money4(addExact(registerTotal, registerKey));
        glTotal = money4(addExact(glTotal, glKey));
        perKey.push({
          purposeKey,
          register: registerKey,
          gl: glKey,
          accountCodes: [...bucket.codes].sort(),
        });
      }
      perKey.sort((a, b) => (a.purposeKey < b.purposeKey ? -1 : 1));
      return { registerTotal, glTotal, perKey };
    };

    return {
      fa: side(faKeys, false), // debit-positive GL == register cost + g legs
      accum: side(accumKeys, true), // credit-positive register == −(DEBIT−CREDIT)
    };
  }

  // -- fixed_assets.depreciation-schedule ----------------------------------------------

  /**
   * `fixed_assets.depreciation-schedule`: one row per LIVE-as-of asset —
   * posted-to-date accumulated on the CURRENT basis (the same composition
   * the runs use: opening + posted lines + revaluation restatements, all ≤
   * asOf) plus the method-aware remaining schedule. The projection period
   * is the given fiscal period, else the first month after asOf.
   */
  async depreciationSchedule(input: {
    asOf: string;
    fiscalPeriodId: string | null;
    branchIds: readonly string[] | null;
    categoryId: string | null;
    method: string | null;
  }): Promise<DepreciationScheduleRow[]> {
    let periodStartDate: string;
    if (input.fiscalPeriodId !== null && input.fiscalPeriodId !== undefined && input.fiscalPeriodId !== "") {
      const period = await findPeriodById(input.fiscalPeriodId);
      periodStartDate = period === undefined ? addMonths(monthStartOf(input.asOf), 1) : period.startDate;
    } else {
      periodStartDate = addMonths(monthStartOf(input.asOf), 1);
    }

    const rows = await tenantTx().execute(sql`
      WITH ${asOfCtes(input.asOf)}
      SELECT a.id AS "assetId", a.code, a.name, a.name_ar AS "nameAr",
        a.acquisition_date AS "acquisitionDate", a.cost, a.salvage_value AS "salvageValue",
        a.opening_accumulated AS "openingAccumulated", a.useful_life_months AS "usefulLifeMonths",
        a.depreciation_method AS "depreciationMethod",
        a.total_estimated_units AS "totalEstimatedUnits",
        c.code AS "categoryCode",
        COALESCE(lines_asof.lines_total, 0)::numeric(19,4)::text AS "linesAsOf",
        COALESCE(rev_asof.gross_legs, 0)::numeric(19,4)::text AS "grossLegsAsOf",
        COALESCE(rev_asof.accum_legs, 0)::numeric(19,4)::text AS "accumLegsAsOf",
        COALESCE(units_asof.units_total, 0)::numeric(19,6)::text AS "unitsAsOf"
      FROM assets a
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN cap ON cap.asset_id = a.id
      LEFT JOIN disp ON disp.asset_id = a.id
      LEFT JOIN lines_asof ON lines_asof.asset_id = a.id
      LEFT JOIN units_asof ON units_asof.asset_id = a.id
      LEFT JOIN rev_asof ON rev_asof.asset_id = a.id
      WHERE (cap.asset_id IS NULL OR cap.cap_date <= ${input.asOf})
        AND NOT (COALESCE(disp.disp_date <= ${input.asOf}, false)
          OR (a.status IN ('DISPOSED','WRITTEN_OFF')
              AND COALESCE(a.disposed_at, a.written_off_at)::date <= ${input.asOf}))
        AND (${input.categoryId ?? null}::uuid IS NULL OR a.category_id = ${input.categoryId ?? null})
        AND (${input.method ?? null}::text IS NULL OR a.depreciation_method = ${input.method ?? null})
        AND ${idsScopeSql(input.branchIds, "a.branch_id")}
      ORDER BY a.code
      LIMIT ${REGISTER_ROW_LIMIT}
    `);

    const parsed = rows.rows as unknown as Array<{
      assetId: string;
      code: string;
      name: string;
      nameAr: string;
      acquisitionDate: string;
      cost: string;
      salvageValue: string;
      openingAccumulated: string;
      usefulLifeMonths: number;
      depreciationMethod: string;
      totalEstimatedUnits: string | null;
      categoryCode: string;
      linesAsOf: string;
      grossLegsAsOf: string;
      accumLegsAsOf: string;
      unitsAsOf: string;
    }>;

    const schedule: DepreciationScheduleRow[] = [];
    for (const row of parsed) {
      // The current basis (DR-002 §4 — the run composition): history plus
      // the revaluation restatements, all date-anchored ≤ asOf.
      const postedToAccum = money4(
        addExact(addExact(addExact(row.openingAccumulated, row.linesAsOf), row.accumLegsAsOf), "0"),
      );
      const basisGross = money4(addExact(row.cost, row.grossLegsAsOf));
      const base = round4(new Decimal(basisGross).minus(new Decimal(row.salvageValue)));
      const remainingBase = money4(
        new Decimal(base).minus(new Decimal(postedToAccum)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      );
      const atFloor = compareExact(remainingBase, "0.0000") === 0;
      const belowFloor = compareExact(remainingBase, "0.0000") < 0;

      const monthIndex = monthIndexOf(row.acquisitionDate, periodStartDate);
      const elapsed = clampNonNegative(monthIndex);
      const remainingMonthsRaw = row.usefulLifeMonths - elapsed;
      const remainingMonths = remainingMonthsRaw < 0 ? 0 : remainingMonthsRaw;

      // Method-aware remaining (DR-002 §Decision 5):
      //   SL  — remaining months of the useful life
      //   DB  — remaining base at the monthly rate (12 / life on opening NBV)
      //   UoP — remaining units (total_estimated − consumed through asOf)
      const dbRatePct =
        row.depreciationMethod === "DECLINING_BALANCE"
          ? round4(new Decimal(12).div(row.usefulLifeMonths).times(100))
          : null;
      let remainingUnits: string | null = null;
      let unitRate: string | null = null;
      if (row.depreciationMethod === "UNITS_OF_PRODUCTION" && row.totalEstimatedUnits !== null) {
        const remaining = new Decimal(row.totalEstimatedUnits).minus(new Decimal(row.unitsAsOf));
        remainingUnits = remaining.isNegative()
          ? "0.000000"
          : remaining.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
        unitRate = round4(new Decimal(base).div(new Decimal(row.totalEstimatedUnits)));
      }

      // The next-period projection = exactly what the period's run would
      // compute (the same kernel, the same current-basis composition): the
      // acquisition month itself never depreciates (next-month convention);
      // the final period absorbs the residual; UoP needs MANUAL usage, so
      // its projection stays blank (the run workspace collects units).
      let nextAmount: string | null = null;
      if (row.depreciationMethod !== "UNITS_OF_PRODUCTION") {
        if (monthIndex < 1 || atFloor || belowFloor) {
          nextAmount = "0.0000";
        } else {
          nextAmount = computeMonthlyAmount(
            {
              id: row.assetId,
              code: row.code,
              acquisitionDate: row.acquisitionDate,
              cost: basisGross,
              salvageValue: money4(row.salvageValue),
              usefulLifeMonths: row.usefulLifeMonths,
              depreciationMethod: row.depreciationMethod,
              totalEstimatedUnits: row.totalEstimatedUnits,
            },
            postedToAccum,
            undefined,
            { periodStartDate },
          ).amount;
        }
      }

      schedule.push({
        assetId: row.assetId,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        categoryCode: row.categoryCode,
        method: row.depreciationMethod,
        acquisitionDate: row.acquisitionDate,
        usefulLifeMonths: row.usefulLifeMonths,
        salvageValue: money4(row.salvageValue),
        basisGross,
        postedToAccum,
        remainingBase,
        remainingMonths:
          row.depreciationMethod === "UNITS_OF_PRODUCTION" ? null : remainingMonths,
        dbRatePct,
        remainingUnits,
        unitRate,
        nextAmount,
        atFloor,
      });
    }
    return schedule;
  }

  // -- fixed_assets.movements ----------------------------------------------------------

  /**
   * `fixed_assets.movements`: one row per posted movement in the window —
   * acquisitions (the G-21 entries), revaluations, depreciation runs (the
   * G-22 entries + their INV-014 reversals as signed rows) and disposals —
   * each carrying its journal provenance (entry no + id from the source
   * rows). Depreciation rows are per RUN ENTRY (the journal is the
   * movement); a run appears when any line asset is inside the branch
   * scope, and its amount stays the whole-journal total (documented note).
   */
  async assetMovements(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
    kind: string | null;
  }): Promise<AssetMovementRow[]> {
    const branchScope = idsScopeSql(input.branchIds, "a.branch_id");
    const depreciationLineScope = sql`
      EXISTS (SELECT 1 FROM depreciation_lines dl
              JOIN assets a2 ON a2.id = dl.asset_id
              WHERE dl.run_id = r.id AND ${idsScopeSql(input.branchIds, "a2.branch_id")})`;

    const acquisitions = sql`
      SELECT e.entry_date AS "date", 'ACQUISITION'::text AS kind, a.code AS "assetCode",
        a.name AS "assetName", a.name_ar AS "assetNameAr", c.code AS "categoryCode",
        b.code AS "branchCode", a.cost::numeric(19,4)::text AS amount,
        NULL::numeric(19,4)::text AS proceeds, NULL::numeric(19,4)::text AS "netBookValue",
        NULL::numeric(19,4)::text AS "gainLoss", NULL::numeric(19,4)::text AS delta,
        NULL::numeric(19,4)::text AS "newGrossValue", NULL::text AS "assetCount",
        NULL::text AS "docNo", e.entry_no AS "journalEntryNo", e.id AS "journalEntryId",
        false AS "isReversal"
      FROM journal_entries e
      JOIN assets a ON a.id = e.source_id
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN branches b ON b.id = a.branch_id
      WHERE e.source_type = 'FIXED_ASSET_CAPITALIZATION' AND e.operation = 'post'
        AND e.status = 'POSTED' AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScope}`;

    const revaluations = sql`
      SELECT e.entry_date AS "date", 'REVALUATION'::text AS kind, a.code AS "assetCode",
        a.name AS "assetName", a.name_ar AS "assetNameAr", c.code AS "categoryCode",
        b.code AS "branchCode", rv.delta::numeric(19,4)::text AS amount,
        NULL::numeric(19,4)::text AS proceeds, NULL::numeric(19,4)::text AS "netBookValue",
        NULL::numeric(19,4)::text AS "gainLoss", rv.delta::numeric(19,4)::text AS delta,
        rv.new_gross_value::numeric(19,4)::text AS "newGrossValue", NULL::text AS "assetCount",
        rv.reason AS "docNo", e.entry_no AS "journalEntryNo", e.id AS "journalEntryId",
        false AS "isReversal"
      FROM asset_revaluations rv
      JOIN assets a ON a.id = rv.asset_id
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN branches b ON b.id = a.branch_id
      JOIN journal_entries e ON e.id = rv.journal_entry_id
      WHERE rv.status = 'POSTED' AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScope}`;

    const runOriginals = sql`
      SELECT e.entry_date AS "date", 'DEPRECIATION'::text AS kind, NULL::text AS "assetCode",
        NULL::text AS "assetName", NULL::text AS "assetNameAr", NULL::text AS "categoryCode",
        NULL::text AS "branchCode", r.total_amount::numeric(19,4)::text AS amount,
        NULL::numeric(19,4)::text AS proceeds, NULL::numeric(19,4)::text AS "netBookValue",
        NULL::numeric(19,4)::text AS "gainLoss", NULL::numeric(19,4)::text AS delta,
        NULL::numeric(19,4)::text AS "newGrossValue", r.asset_count::text AS "assetCount",
        fp.name AS "docNo", e.entry_no AS "journalEntryNo", e.id AS "journalEntryId",
        false AS "isReversal"
      FROM depreciation_runs r
      JOIN journal_entries e ON e.id = r.journal_entry_id
      JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
      WHERE r.status = 'POSTED' AND r.journal_entry_id IS NOT NULL
        AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${depreciationLineScope}`;

    const runReversals = sql`
      SELECT e.entry_date AS "date", 'DEPRECIATION'::text AS kind, NULL::text AS "assetCode",
        NULL::text AS "assetName", NULL::text AS "assetNameAr", NULL::text AS "categoryCode",
        NULL::text AS "branchCode", (-r.total_amount)::numeric(19,4)::text AS amount,
        NULL::numeric(19,4)::text AS proceeds, NULL::numeric(19,4)::text AS "netBookValue",
        NULL::numeric(19,4)::text AS "gainLoss", NULL::numeric(19,4)::text AS delta,
        NULL::numeric(19,4)::text AS "newGrossValue", r.asset_count::text AS "assetCount",
        fp.name AS "docNo", e.entry_no AS "journalEntryNo", e.id AS "journalEntryId",
        true AS "isReversal"
      FROM depreciation_runs r
      JOIN journal_entries e ON e.id = r.reversal_journal_entry_id
      JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
      WHERE r.status = 'POSTED' AND r.reversal_journal_entry_id IS NOT NULL
        AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${depreciationLineScope}`;

    const disposals = sql`
      SELECT e.entry_date AS "date", 'DISPOSAL'::text AS kind, a.code AS "assetCode",
        a.name AS "assetName", a.name_ar AS "assetNameAr", c.code AS "categoryCode",
        b.code AS "branchCode", d.proceeds::numeric(19,4)::text AS amount,
        d.proceeds::numeric(19,4)::text AS proceeds,
        d.net_book_value::numeric(19,4)::text AS "netBookValue",
        d.gain_loss::numeric(19,4)::text AS "gainLoss",
        NULL::numeric(19,4)::text AS delta, NULL::numeric(19,4)::text AS "newGrossValue",
        NULL::text AS "assetCount", d.disposal_no AS "docNo",
        e.entry_no AS "journalEntryNo", e.id AS "journalEntryId",
        false AS "isReversal"
      FROM asset_disposals d
      JOIN assets a ON a.id = d.asset_id
      JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN branches b ON b.id = a.branch_id
      JOIN journal_entries e ON e.id = d.journal_entry_id
      WHERE d.status = 'POSTED' AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScope}`;

    const rows = await tenantTx().execute(sql`
      SELECT * FROM (
        ${acquisitions}
        UNION ALL ${revaluations}
        UNION ALL ${runOriginals}
        UNION ALL ${runReversals}
        UNION ALL ${disposals}
      ) m
      WHERE (${input.kind ?? null}::text IS NULL OR m.kind = ${input.kind ?? null})
      ORDER BY m."date", m.kind, m."assetCode", m."journalEntryNo"
      LIMIT 5000
    `);
    return rows.rows as unknown as AssetMovementRow[];
  }
}

/** The movements row (journal provenance from the source rows — the engine's entries). */
export interface AssetMovementRow {
  date: string;
  kind: "ACQUISITION" | "REVALUATION" | "DEPRECIATION" | "DISPOSAL";
  assetCode: string | null;
  assetName: string | null;
  assetNameAr: string | null;
  categoryCode: string | null;
  branchCode: string | null;
  /** The movement's headline amount (cost / delta / ±run total / proceeds). */
  amount: string;
  proceeds: string | null;
  netBookValue: string | null;
  gainLoss: string | null;
  delta: string | null;
  newGrossValue: string | null;
  assetCount: string | null;
  docNo: string | null;
  journalEntryNo: string | null;
  journalEntryId: string;
  isReversal: boolean;
}

/** The schedule row (one per LIVE-as-of asset). */
export interface DepreciationScheduleRow {
  assetId: string;
  code: string;
  name: string;
  nameAr: string;
  categoryCode: string;
  method: string;
  acquisitionDate: string;
  usefulLifeMonths: number;
  salvageValue: string;
  /** Current-basis gross as-of (cost + revaluation gross legs). */
  basisGross: string;
  /** Posted-to-date accumulated on the current basis (opening + lines + restatements). */
  postedToAccum: string;
  /** Remaining depreciable base (basis gross − salvage − postedToAccum). */
  remainingBase: string;
  /** SL/DB: months of useful life left from the projection period. */
  remainingMonths: number | null;
  /** DB only: the monthly rate (12 / life) as a percent. */
  dbRatePct: string | null;
  /** UoP only: total_estimated_units − consumed units through asOf. */
  remainingUnits: string | null;
  /** UoP only: base / total_estimated_units per unit. */
  unitRate: string | null;
  /** The projection-period amount the run would compute (UoP: null — manual usage). */
  nextAmount: string | null;
  atFloor: boolean;
}
