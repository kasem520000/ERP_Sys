/**
 * PHASE-049 (W-21 — T-14) — the asset-tag print module's tests (THE PRINT
 * LAW, the W-13 clauses carried verbatim):
 *
 * - **DICTIONARY-EXCLUSIVE LABELS** (clause 1): the payload's every label
 *   — the title, the parties block, the columns — comes from the i18n
 *   dictionary through `bi()`, BOTH sides; the AR build renders the AR
 *   side, the EN build the EN side (never a literal in the module).
 * - **DETERMINISM** (clause 3): two builds of the same inputs produce
 *   byte-identical html — docDate is "" (NEVER a wall-clock read), and
 *   every other string is the payload's own.
 * - **THE QR PASSES THROUGH VERBATIM** (clause 2): the engine's
 *   PRE-RENDERED data URI lands in the html exactly as received — the
 *   module never recomputes a QR (OA-06).
 */
import { describe, expect, it } from "vitest";

import { getDictionary } from "../../i18n/dictionaries";
import type { TagPrintSheetPayload } from "../api-types";
import { joinTagSheetPages, tagSheetPages, tagSheetPayload } from "../assets-print";

const AR = getDictionary("ar");
const EN = getDictionary("en");

function sheet(overrides: Partial<TagPrintSheetPayload> = {}): TagPrintSheetPayload {
  return {
    asset: { id: "asset-1", code: "A-100", name: "Generator", nameAr: "المولد" },
    tags: [
      {
        id: "tag-1",
        assetId: "asset-1",
        code: "tg_v1_abc123",
        printedAt: null,
        note: null,
        noteAr: null,
        createdBy: null,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        version: 1,
        qrImageUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
      {
        id: "tag-2",
        assetId: "asset-1",
        code: "tg_v1_def456",
        printedAt: null,
        note: null,
        noteAr: null,
        createdBy: null,
        createdAt: "2026-11-01T00:00:01Z",
        updatedAt: "2026-11-01T00:00:01Z",
        version: 1,
        qrImageUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    ],
    ...overrides,
  };
}

describe("PHASE-049 W-21 — the tag print module (THE PRINT LAW)", () => {
  it("(a) the payload uses ONLY dictionary labels (both sides, never a literal)", () => {
    const payloads = tagSheetPayload(sheet(), "ar");
    expect(payloads.length).toBe(2);
    for (const payload of payloads) {
      // The title — BOTH sides from the dictionary through bi().
      expect(payload.title.ar).toBe(AR.assetsTagsPrintSheetTitle);
      expect(payload.title.en).toBe(EN.assetsTagsPrintSheetTitle);
      // The parties block + the columns — the dictionary's own labels.
      expect(payload.parties[0]?.label.ar).toBe(AR.assetsMetersColAsset);
      expect(payload.parties[0]?.label.en).toBe(EN.assetsMetersColAsset);
      expect(payload.columns[0]?.label.ar).toBe(AR.assetsTagsColCode);
      expect(payload.columns[0]?.label.en).toBe(EN.assetsTagsColCode);
      expect(payload.columns[1]?.label.ar).toBe(AR.assetsMaintenanceColCreatedAt);
      expect(payload.columns[1]?.label.en).toBe(EN.assetsMaintenanceColCreatedAt);
      // docNo is the tag's own code; docDate is "" (the determinism law).
      expect(payload.docDate).toBe("");
    }
    expect(payloads[0]?.docNo).toBe("tg_v1_abc123");
    expect(payloads[1]?.docNo).toBe("tg_v1_def456");
    // The rendered pages carry the ACTIVE locale's side (AR build → AR
    // title + AR column labels; EN build → EN).
    const arHtml = tagSheetPages(sheet(), "ar").join("");
    expect(arHtml.includes(AR.assetsTagsPrintSheetTitle)).toBe(true);
    expect(arHtml.includes(AR.assetsTagsColCode)).toBe(true);
    expect(arHtml.includes(EN.assetsTagsColCode)).toBe(false);
    const enHtml = tagSheetPages(sheet(), "en").join("");
    expect(enHtml.includes(EN.assetsTagsPrintSheetTitle)).toBe(true);
    expect(enHtml.includes(EN.assetsTagsColCode)).toBe(true);
    expect(enHtml.includes(AR.assetsTagsColCode)).toBe(false);
  });

  it("(b) DETERMINISM — two builds of the same input produce identical html strings", () => {
    const input = sheet();
    const first = tagSheetPages(input, "ar");
    const second = tagSheetPages(input, "ar");
    expect(first.length).toBe(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).toBe(second[index]);
    }
    // The joined multi-tag print is deterministic too (one separator
    // shape, one page per tag — never a wall-clock or random id).
    expect(joinTagSheetPages(first)).toBe(joinTagSheetPages(second));
    expect(joinTagSheetPages(first)).toBe(
      `${first[0]}<div style="page-break-after: always; break-after: page;"></div>${first[1]}`,
    );
  });

  it("(c) the QR data URI passes through VERBATIM (the engine's string, never recomputed)", () => {
    const input = sheet();
    const payloads = tagSheetPayload(input, "en");
    // The payload carries the engine's own data URI exactly as received.
    expect(payloads[0]?.qrImageUri).toBe(input.tags[0]?.qrImageUri);
    expect(payloads[1]?.qrImageUri).toBe(input.tags[1]?.qrImageUri);
    // The rendered page embeds the SAME string in the <img src> — the
    // template's own QR block, byte-for-byte.
    const pages = tagSheetPages(input, "en");
    expect(pages[0]?.includes(`src="${input.tags[0]?.qrImageUri}"`)).toBe(true);
    expect(pages[1]?.includes(`src="${input.tags[1]?.qrImageUri}"`)).toBe(true);
    // ONE TAG PER PAGE: each page carries exactly one QR block (the
    // A4DocumentPayload's single-qrImageUri law).
    for (const page of pages) {
      expect(page.split("data:image/png;base64,").length - 1).toBe(1);
    }
  });
});
