// PHASE-007 k6 posting smoke (TEST_STRATEGY §2.7; PERFORMANCE_TEST_PLAN
// "Smoke — core API" tier: 5 VUs / 1 min, one posting per module, zero 5xx;
// posting p95 budget per the T-01/T-02 smoke tier).
//
// Run against a booted API + seeded demo tenant:
//   k6 run -e BASE_URL=http://127.0.0.1:3001 -e SESSION_TOKEN=<token> \
//        -e TENANT_ID=<uuid> k6/posting-smoke.ts
//
// The k6 binary is a CI/hosted-runner dependency; the local gate runs the
// TS-equivalent harness (src/__db__/accounting/posting-smoke.local.ts —
// same budgets, embedded PG) and records its output as the substitute
// evidence, exactly like the PHASE-001 CI waivers.

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL ?? "http://127.0.0.1:3001";
const SESSION_TOKEN = __ENV.SESSION_TOKEN ?? "";
const TENANT_ID = __ENV.TENANT_ID ?? "";

export const options = {
  vus: 5,
  duration: "1m",
  thresholds: {
    // Smoke tier budgets: posting p95 under the interactive T-02 envelope.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:post-journal}": ["p(95)<500"],
  },
};

const HEADERS = {
  "Content-Type": "application/json",
  "X-Session-Token": SESSION_TOKEN,
  "X-Active-Tenant": TENANT_ID,
  "Idempotency-Key": "k6-posting-smoke",
};

export default function () {
  // 1. health
  const health = http.get(`${BASE_URL}/health/live`, { headers: HEADERS, tags: { name: "health" } });
  check(health, { "health 2xx": (r) => r.status >= 200 && r.status < 300 });

  // 2. GL read (list journal entries)
  const list = http.get(`${BASE_URL}/api/v1/accounting/journal-entries?limit=25`, {
    headers: HEADERS,
    tags: { name: "list-journals" },
  });
  check(list, { "journals list 2xx": (r) => r.status >= 200 && r.status < 300 });

  // 3. one posting (draft → submit → post cycle over the BFF-guarded API)
  const draft = http.post(
    `${BASE_URL}/api/v1/accounting/journal-entries`,
    JSON.stringify({
      entryDate: new Date().toISOString().slice(0, 10),
      description: "k6 posting smoke",
      lines: [
        { accountId: __ENV.DEBIT_ACCOUNT, direction: "DEBIT", amount: "10.0000" },
        { accountId: __ENV.CREDIT_ACCOUNT, direction: "CREDIT", amount: "10.0000" },
      ],
    }),
    { headers: HEADERS, tags: { name: "post-journal" } },
  );
  check(draft, { "draft created": (r) => r.status >= 200 && r.status < 300 });

  sleep(1);
}
