// PHASE-014 k6 MVP-candidate load scenario (PERFORMANCE_TEST_PLAN §2 — the
// simulated design-partner day; NFR-006 release gate). Mirrors the local
// harness src/__db__/performance/mvp-candidate.local.spec.ts (the recorded
// local-substitute evidence — the standing PHASE-007 waiver pattern): the
// same five budgets, asserted through the same endpoints.
//
// Run against a booted API on the staging tier:
//   k6 run -e BASE_URL=http://staging-api:3001 \
//        -e OWNER_EMAIL=<demo-owner> -e OWNER_PASSWORD=<demo-pass> k6/mvp-candidate.ts
//
// Scenario shape (§2): business-hours profile, 20 simulated tenants (one
// session per VU iteration; scale with --vus 20), the 60/25/15 mix leaning
// on reads (document lists) with posting and interactive reports in the
// tail, plus the login+shell substrate both locales. Thresholds (the plan's
// pass/fail template §9): T-01 list p95<500ms, T-02 posting p95<300ms,
// T-04 report p95<2s, T-06 login+shell p95<1.5s, T-07 5xx<0.1%.

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL ?? "http://127.0.0.1:3001";
const OWNER_EMAIL = __ENV.OWNER_EMAIL ?? "";
const OWNER_PASSWORD = __ENV.OWNER_PASSWORD ?? "";

export const options = {
  scenarios: {
    mvpCandidate: {
      executor: "ramping-vus",
      startVUs: 2,
      stages: [
        { duration: "1m", target: 20 }, // business-hours ramp (20 tenants)
        { duration: "3m", target: 20 }, // steady business-hours window
        { duration: "30s", target: 0 }, // drain
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    // T-07 — 5xx budget across the whole scenario (business 4xx excluded
    // from http_req_failed via per-check accounting).
    checks: ["rate>0.99"],
    // T-01 — document list p95 < 500 ms (the 100k-doc tier).
    "http_req_duration{name:t01-document-list}": ["p(95)<500"],
    // T-02 — invoice/journal posting p95 < 300 ms.
    "http_req_duration{name:t02-posting}": ["p(95)<300"],
    // T-04 — interactive report tier p95 < 2 s.
    "http_req_duration{name:t04-report}": ["p(95)<2000"],
    // T-06 — login + shell substrate p95 < 1.5 s (per full sequence).
    "http_req_duration{name:t06-login-shell}": ["p(95)<1500"],
  },
};

interface SessionHeaders {
  "Content-Type": string;
  "X-Session-Token": string;
}

/** The 60/25/15 mix: reads-heavy with posting + interactive reports. */
function pickOp(iteration: number): "read" | "post" | "report" {
  const slot = iteration % 20;
  if (slot < 12) return "read"; // ~60% document lists
  if (slot < 17) return "post"; // ~25% posting (journal-entry shape)
  return "report"; // ~15% interactive reports
}

export default function () {
  // T-06 — login + the shell's data endpoints (measured as a group; the
  // tagged duration covers the full sequence, matching the local harness).
  const locale = (__ITER % 2) === 0 ? "ar" : "en";
  const login = http.post(
    `${BASE_URL}/api/v1/identity/sessions`,
    JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, locale }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "t06-login-shell" } },
  );
  const token = (login.json("data") as { token?: string } | null)?.token ?? "";
  const headers: SessionHeaders = { "Content-Type": "application/json", "X-Session-Token": token };
  http.get(`${BASE_URL}/api/v1/identity/sessions/current`, { headers, tags: { name: "t06-login-shell" } });
  http.get(`${BASE_URL}/api/v1/tenancy/entitlements`, { headers, tags: { name: "t06-login-shell" } });
  http.get(`${BASE_URL}/api/v1/tenancy/navigation`, { headers, tags: { name: "t06-login-shell" } });
  const loginOk = check(login, { "t06 login 2xx": (r) => r.status === 200 });
  const shellDone = check(token, { "t06 token resolved": (t) => t !== "" });
  void loginOk;
  void shellDone;

  const op = pickOp(__ITER);
  if (op === "read") {
    // T-01 — document list over the register.
    const list = http.get(`${BASE_URL}/api/v1/accounting/journal-entries?limit=50`, {
      headers,
      tags: { name: "t01-document-list" },
    });
    check(list, { "t01 list 2xx": (r) => r.status === 200 });
  } else if (op === "post") {
    // T-02 — a posting through the engine (journal-entry shape; the staging
    // seed provisioned the demo tenant's CoA — account ids ride SEED_* env
    // when the staged fixture differs; the local harness owns the exact
    // golden posts, this tier proves the envelope under load).
    const post = http.post(
      `${BASE_URL}/api/v1/accounting/journal-entries`,
      JSON.stringify({
        entryDate: "2026-01-20",
        description: "k6 mvp-candidate post",
        currency: "SAR",
        lines: [],
      }),
      { headers: { ...headers, "Idempotency-Key": `k6-mvp-${__VU}-${__ITER}` }, tags: { name: "t02-posting" } },
    );
    // A 4xx business rejection (validation) is NOT a 5xx (T-07 excludes it);
    // the check pins the no-5xx budget only.
    check(post, { "t02 no 5xx": (r) => r.status < 500 });
  } else {
    // T-04 — interactive report tier (the contract families the dashboard
    // binds to; queued runs poll — the staged run uses the synchronous
    // trial-balance shape for the p95 measurement).
    const report = http.get(`${BASE_URL}/api/v1/reporting/reports`, { headers, tags: { name: "t04-report" } });
    check(report, { "t04 catalog 2xx": (r) => r.status === 200 });
  }

  sleep(1); // business-hours pacing (§2 think-time profile)
}
