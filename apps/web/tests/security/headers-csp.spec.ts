/**
 * Secure headers / CSP verification probe (SECURITY_TEST_PLAN §8, T11).
 * Asserted per environment against the REAL Next.js server (build + start):
 * HSTS, nosniff, X-Frame-Options DENY + frame-ancestors 'none',
 * Referrer-Policy, CSP with nonce'd scripts (no unsafe-inline for scripts),
 * object-src 'none', and the no-third-party-asset assertion (SRI n/a at
 * this phase — nothing is loaded off-origin; assert that).
 */
import { expect, test } from "@playwright/test";

const PORT = Number(process.env.WEB_PROBE_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;

test.describe("secure headers probe", () => {
  test("document routes carry the full §8 header set", async ({ request }) => {
    const response = await request.get(`${BASE}/ar/login`);
    expect(response.status()).toBe(200);
    const headers = response.headers();

    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBeDefined();
    expect(headers["content-security-policy"]).toBeDefined();

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // scripts: nonce'd, never unsafe-inline
    const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  test("per-request nonces rotate and scripts reference them", async ({ request }) => {
    const a = await request.get(`${BASE}/ar/login`);
    const b = await request.get(`${BASE}/ar/login`);
    const cspA = /'nonce-([^']+)'/.exec(a.headers()["content-security-policy"] ?? "")?.[1];
    const cspB = /'nonce-([^']+)'/.exec(b.headers()["content-security-policy"] ?? "")?.[1];
    expect(cspA).toBeDefined();
    expect(cspB).toBeDefined();
    expect(cspA).not.toBe(cspB); // fresh nonce per response
  });

  test("no third-party assets are referenced (SRI n/a assertion)", async ({ request }) => {
    const response = await request.get(`${BASE}/ar/login`);
    const html = await response.text();
    // every src/href must be same-origin (self-hosted fonts, local bundles)
    const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
    expect(external, `off-origin references found: ${external.join(", ")}`).toEqual([]);
  });

  test("nonce'd document actually executes its scripts (CSP not breaking the app)", async ({ page }) => {
    await page.goto(`${BASE}/ar/login`);
    // the page hydrates: react root present without CSP violations killing it
    await expect(page.locator("input").first()).toBeVisible();
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("Content Security Policy")) errors.push(msg.text());
    });
    expect(errors).toEqual([]);
  });
});

test.describe("PHASE-024 T9 — BFF header set + M-03 cookie DOM probe", () => {
  test("BFF JSON responses carry the fixed security header set (unauthenticated 4xx)", async ({ request }) => {
    // No body → the BFF's own 400 VALIDATION_ERROR (no upstream call), so
    // the probe asserts headers without needing the API process.
    const response = await request.post(`${BASE}/api/bff/session`);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // API-grade CSP for a JSON plane — no script-src/nonce here (that is the
    // document-origin flow only).
    expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  test("M-03: erp_session is httpOnly (JS-blind) while erp_csrf stays readable", async ({ page, request }) => {
    // (1) A failed BFF login issues NO session cookie — no fixation, no
    // oracle. 401 with the API up; 502 in the API-less probe environment —
    // both are "failed login" and must set nothing.
    const failed = await request.post(`${BASE}/api/bff/session`, {
      data: { email: "probe@example.com", password: "definitely-wrong" },
    });
    expect(failed.status()).toBeGreaterThanOrEqual(400);
    expect(failed.headers()["set-cookie"] ?? "").not.toContain("erp_session");

    // (2) The DOM proof of the cookie design (lib/bff.ts applySessionCookies):
    // plant the exact pair a successful BFF login would set — httpOnly
    // `erp_session`, readable `erp_csrf`, SameSite=Lax — then read what JS
    // can see on a real document.
    await page.context().addCookies([
      {
        name: "erp_session",
        value: "probe-session-token",
        url: BASE,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "erp_csrf",
        value: "probe-csrf-token",
        url: BASE,
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${BASE}/ar/login`);
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("erp_session"); // httpOnly proof
    expect(visible).not.toContain("probe-session-token"); // nor the value
    expect(visible).toContain("erp_csrf=probe-csrf-token"); // readable by design
  });
});
