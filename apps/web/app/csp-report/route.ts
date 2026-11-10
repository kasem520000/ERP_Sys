/**
 * CSP violation-report capture (PHASE-024 T9, SECURITY_TEST_PLAN §8
 * "CSP report-only capture in staging"). Wired from middleware.ts via the
 * `report-uri /csp-report` directive on the Content-Security-Policy-
 * Report-Only header — only present when CSP_REPORT_ONLY=1 (staging);
 * production runs the enforced CSP alone, so this route receives nothing.
 *
 * Deliberately minimal: parse the JSON report, log ONE structured line,
 * count in memory, answer 204. Reports are NEVER stored (log-only) — the
 * staging capture exists to smoke out policy regressions before rollout,
 * not to build a retention surface; a malformed body still 204s so a
 * browser's report POST can never become an error channel.
 *
 * NOTE on the path: the task plan drafted `/__csp-report`, but Next.js
 * treats every `app/` folder starting with `_` as PRIVATE (excluded from
 * routing — see the `__boundary-violations__` fixture folders), so the
 * route lives at `/csp-report` and the report-uri matches it.
 */

let cspReportCount = 0;

export async function POST(request: Request): Promise<Response> {
  let report: unknown = null;
  try {
    report = await request.json();
  } catch {
    report = null; // garbage report body — still acknowledged, never an error
  }
  cspReportCount += 1;
  // Single structured line (console — the web app has no logger dependency).
  console.log(
    JSON.stringify({
      msg: "csp violation report (staging, report-only)",
      count: cspReportCount,
      report,
    }),
  );
  return new Response(null, { status: 204 });
}
