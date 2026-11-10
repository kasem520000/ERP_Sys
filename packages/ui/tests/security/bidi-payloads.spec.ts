/**
 * Bidi spoofing payload tests (THREAT_MODEL S-03, PHASE-005 T11): stored
 * bilingual content carrying HTML/script payloads + bidi control characters
 * (RLI/PDI/RLO overrides) must render as inert TEXT through the catalog
 * components — no element injection, no layout/status spoofing; legit
 * mixed-script runs stay isolated (LRI/PDI on bidiIsolate values).
 */
import { expect, test } from "@playwright/test";

const URL = "/iframe.html?id=catalog--bidi-payloads&globals=locale:ar;dir:rtl;density:compact&viewMode=story";
/** The story canvas (Storybook's own scripts are legitimate — scope checks here). */
const STORY_ROOT = "#storybook-root";

test.describe("S-03 bidi/XSS payload neutralization", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("html[data-visual-ready='true']", { state: "attached", timeout: 15_000 });
  });

  test("HTML/script payloads render as literal text — never execute", async ({ page }) => {
    // no injected elements from the payloads inside the story canvas
    expect(await page.locator(`${STORY_ROOT} img`).count()).toBe(0);
    expect(await page.locator(`${STORY_ROOT} svg[onload]`).count()).toBe(0);
    expect(await page.locator(`${STORY_ROOT} script`).count()).toBe(0);
    expect(await page.locator(`${STORY_ROOT} iframe`).count()).toBe(0);
    // the payload strings themselves survive as visible inert text values
    const values = await page.locator(`${STORY_ROOT} input`).evaluateAll((inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value),
    );
    expect(values.some((v) => v.includes('<img src=x onerror="alert(1)">'))).toBe(true);
    expect(values.some((v) => v.includes("<script>alert(2)</script>"))).toBe(true);
  });

  test("bidi override control characters cannot spoof adjacent labels", async ({ page }) => {
    const values = await page.locator(`${STORY_ROOT} input`).evaluateAll((inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value),
    );
    // the RLO/LRO override fixture stays a DISCRETE value — it does not bleed into labels
    expect(values.some((v) => v.includes("\u202E"))).toBe(true);
    // labels stay intact (Arabic label text unaffected by the payload value)
    await expect(page.getByText("rlo-override")).toBeVisible();
    await expect(page.getByText("lri-hidden")).toBeVisible();
    await expect(page.getByText("mixed-ar")).toBeVisible();
  });

  test("legit mixed-script values are isolated (dir=ltr + unicode-bidi isolate)", async ({ page }) => {
    const isolation = await page
      .locator(`${STORY_ROOT} input`)
      .evaluateAll((inputs) =>
        inputs.map((el) => ({
          dir: (el as HTMLElement).style.direction,
          attrDir: el.getAttribute("dir"),
          bidi: (el as HTMLElement).style.unicodeBidi,
          value: (el as HTMLInputElement).value,
        })),
      );
    const mixed = isolation.find((i) => i.value.includes("فاتورة INV-000123"));
    expect(mixed).toBeDefined();
    // bidiIsolate isolation: logical direction LTR + unicode-bidi isolate (RTL §5)
    expect(mixed?.dir === "ltr" || mixed?.attrDir === "ltr").toBe(true);
    expect(mixed?.bidi).toBe("isolate");
  });

  test("money payload cannot inject markup into the amount field", async ({ page }) => {
    const amount = await page.locator(`${STORY_ROOT} [role="group"] input`).first().inputValue();
    expect(amount).toMatch(/^1/); // digits survive sanitization; markup never renders
    expect(await page.locator(`${STORY_ROOT} img`).count()).toBe(0);
  });
});

test("no dangerouslySetInnerHTML anywhere in the design system (static proof)", async () => {
  const { execFileSync } = await import("node:child_process");
  let raw = "";
  try {
    raw = execFileSync("grep", ["-rn", "dangerouslySetInnerHTML", "src", "--include=*.tsx"], {
      cwd: process.cwd(),
    }).toString();
  } catch {
    raw = "";
  }
  expect(raw.trim()).toBe("");
});
