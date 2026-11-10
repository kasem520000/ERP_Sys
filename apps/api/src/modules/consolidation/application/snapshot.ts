import { createHash } from "node:crypto";

import type { FxTranslationMethod } from "./fx-translation";
import type {
  ConsolidatedLine,
  EliminationEffectLine,
  MemberExtractLine,
} from "./consolidation-math";

/**
 * PHASE-034 T6 · the run snapshot — the immutable, versioned DERIVED
 * artifact (ADR-0017: never a second ledger, never a source of truth):
 * member statement extracts in group currency (dated stored rates, INV-008)
 * + the frozen elimination set as of the run + the consolidated line set.
 * Statements read snapshots — never live member books (O(1) renders; a
 * re-run is always a NEW run, old snapshots never mutate underfoot).
 *
 * SNAPSHOT_VERSION is the payload schema version (independent of each run
 * row's snapshot_version counter, which increments per re-run lineage).
 * Determinism: buildSnapshot is a pure function of its inputs (dates and
 * uuids are passed in — the caller supplies runId/createdAt) and
 * canonicalize() produces a byte-stable JSON serialization: same inputs ⇒
 * byte-identical output (the suite's determinism pin), and the content
 * hash makes tampering detectable (INV-026 seeded-drift surface).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotMemberMeta {
  memberTenantId: string;
  memberName: string | null;
  ownershipPercent: string;
  includeFrom: string | null;
  baseCurrency: string;
  /** The dated stored rates applied (per currency — exactly as stored). */
  appliedRates: Record<string, string>;
}

export interface SnapshotGroupMeta {
  groupId: string;
  name: string;
  nameAr: string;
  baseCurrency: string;
  fxTranslationMethod: FxTranslationMethod;
}

export interface ConsolidationSnapshot {
  schemaVersion: number;
  runId: string;
  groupId: string;
  fiscalPeriodId: string;
  /** The period end (the dated-rate anchor — INV-008). */
  periodEndDate: string;
  group: SnapshotGroupMeta;
  members: SnapshotMemberMeta[];
  /** Per (member, account): the translated extract (group currency). */
  memberExtracts: MemberExtractLine[];
  /** The frozen elimination set as of the run (group currency effects). */
  eliminations: EliminationEffectLine[];
  /** The consolidated line set (Σ members − eliminations, line-by-line). */
  consolidated: ConsolidatedLine[];
  /** The INV-026 assertion result recorded at build time. */
  inv026: {
    status: "PASS" | "FAIL";
    compared: { left: string; right: string };
    brokenLines: string[];
  };
}

/** Byte-stable canonical JSON: keys sorted recursively, no whitespace. */
export function canonicalize(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value instanceof Object) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return "null";
}

/** SHA-256 over the canonical serialization (the tamper-evidence digest). */
export function snapshotContentHash(snapshot: ConsolidationSnapshot): string {
  return createHash("sha256").update(canonicalize(snapshot)).digest("hex");
}

/** Build the snapshot (pure — caller supplies identities/timestamps so the
 * determinism suite can pin byte-identical rebuilds). */
export function buildSnapshot(input: {
  runId: string;
  groupId: string;
  fiscalPeriodId: string;
  periodEndDate: string;
  group: SnapshotGroupMeta;
  members: SnapshotMemberMeta[];
  memberExtracts: MemberExtractLine[];
  eliminations: EliminationEffectLine[];
  consolidated: ConsolidatedLine[];
  inv026: ConsolidationSnapshot["inv026"];
}): ConsolidationSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId: input.runId,
    groupId: input.groupId,
    fiscalPeriodId: input.fiscalPeriodId,
    periodEndDate: input.periodEndDate,
    group: input.group,
    members: [...input.members].sort((a, b) =>
      a.memberTenantId < b.memberTenantId ? -1 : a.memberTenantId > b.memberTenantId ? 1 : 0,
    ),
    memberExtracts: [...input.memberExtracts].sort(byMemberThenAccount),
    eliminations: [...input.eliminations].sort(
      (a, b) =>
        (a.eliminationId < b.eliminationId ? -1 : a.eliminationId > b.eliminationId ? 1 : 0) ||
        (a.accountCode < b.accountCode ? -1 : a.accountCode > b.accountCode ? 1 : 0),
    ),
    consolidated: [...input.consolidated].sort(
      (a, b) => (a.accountCode < b.accountCode ? -1 : a.accountCode > b.accountCode ? 1 : 0),
    ),
    inv026: input.inv026,
  };
}

function byMemberThenAccount(
  a: MemberExtractLine,
  b: MemberExtractLine,
): number {
  return (
    (a.memberTenantId < b.memberTenantId ? -1 : a.memberTenantId > b.memberTenantId ? 1 : 0) ||
    (a.accountCode < b.accountCode ? -1 : a.accountCode > b.accountCode ? 1 : 0)
  );
}
