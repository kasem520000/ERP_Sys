import { describe, expect, it } from "vitest";

import {
  ACTOR,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  resolveAccounts,
  setupAccountingFixture,
  TENANT_A,
} from "./fixtures";
import { withTenant as withTenantRaw } from "../../infra/db/tenant-context";

/**
 * PHASE-007 posting smoke — local k6-equivalent harness (TEST_STRATEGY
 * §2.7; PERFORMANCE_TEST_PLAN "Smoke — core API" tier). The k6 binary is
 * a hosted-runner dependency; this harness runs the SAME shape against the
 * embedded PostgreSQL through the production service path (5 concurrent
 * workers × N postings) and measures the p95 posting latency against the
 * smoke-tier budget (< 500 ms per post, server-side). Recorded as the
 * local-gate substitute evidence — same posture as the PHASE-001 waivers.
 */

const WORKERS = 5;
const POSTS_PER_WORKER = 20;
const P95_BUDGET_MS = 500;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  // eslint-disable-next-line no-restricted-properties -- latency-statistics index (rank selection), not money math (ADR-0009).
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

describe("PHASE-007 posting smoke (k6-equivalent, smoke tier)", () => {
  it(
    `posts under ${WORKERS} concurrent workers measure p95 < ${P95_BUDGET_MS}ms with zero failures`,
    async () => {
      await setupAccountingFixture();
      await ensureFiscalYear();
      const accounts = await resolveAccounts();

      const latencies: number[] = [];
      const failures: unknown[] = [];
      await Promise.all(
        Array.from({ length: WORKERS }, async () => {
          for (let i = 0; i < POSTS_PER_WORKER; i += 1) {
            const started = performance.now();
            try {
              await withTenantRaw(TENANT_A, () =>
                posting.post(
                  manualSpec({
                    docId: newDocId(),
                    debitAccountId: accounts.cash,
                    creditAccountId: accounts.salesRevenue,
                    amount: "10.0000",
                    entryDate: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
                  }),
                  { postedBy: ACTOR },
                ),
              );
            } catch (error) {
              failures.push(error);
            }
            latencies.push(performance.now() - started);
          }
        }),
      );

      expect(failures).toEqual([]);
      expect(latencies.length).toBe(WORKERS * POSTS_PER_WORKER);
      const sorted = [...latencies].sort((a, b) => a - b);
      const p95 = percentile(sorted, 95);
      const p50 = percentile(sorted, 50);
      // Smoke-tier budget assertion (server-side posting path).
      expect(
        p95,
        `posting p95 ${p95.toFixed(1)}ms must stay under ${P95_BUDGET_MS}ms (p50 ${p50.toFixed(1)}ms, n=${latencies.length})`,
      ).toBeLessThan(P95_BUDGET_MS);
      console.log(
        `[posting-smoke] n=${latencies.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${sorted[sorted.length - 1]!.toFixed(1)}ms failures=0`,
      );
    },
    180_000,
  );
});
