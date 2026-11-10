/**
 * Catalog-coverage CI check (PHASE-005 T13; DESIGN_SYSTEM §5): every exported
 * COMPONENT from @erp/ui has a COMPONENT_CATALOG.md row (type-only exports,
 * providers and the icon registry utility are documented elsewhere — RTL §4,
 * DESIGN_SYSTEM §7). Future-phase catalog rows (their landing phase is in the
 * row text) are planned entries — their code lands with their consuming
 * phases per NAVIGATION_MODEL/DESIGN_SYSTEM handoff rules.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const index = readFileSync(join(repoRoot, "packages/ui/src/index.ts"), "utf8");
const catalog = readFileSync(join(repoRoot, "docs/ui/COMPONENT_CATALOG.md"), "utf8");

// side A: component names from the re-export blocks (skip `type X` exports)
const exportBlockRe = /export\s*\{([^}]+)\}/g;
const componentExports: string[] = [];
let block: RegExpExecArray | null;
while ((block = exportBlockRe.exec(index)) !== null) {
  for (const rawToken of block[1].split(",")) {
    const token = rawToken.trim().replace(/\s+/g, " ");
    if (token === "" || token === "type") continue;
    if (token.startsWith("type ")) continue;
    const name = token.split(" as ").pop()?.trim() ?? token;
    if (/^[A-Z]/.test(name)) componentExports.push(name);
  }
}

// side B: catalog table rows `` `Component` | … ``
const rowMatches = [...catalog.matchAll(/^\|\s*`([A-Z][A-Za-z0-9]+)`([^\n]*)/gm)].map((m) => ({
  name: m[1] as string,
  line: m[2] as string,
}));

// utility/token surface documented outside the catalog rows (RTL §4 icon
// registry + §5 isolate constants; status vocabulary map per §6.4 companion)
const UTIL_SURFACE = new Set([
  "Icon", "DirectionProvider", "DensityProvider", "ToastProvider",
  "DIRECTIONAL", "ICON_REGISTRY", "LRI", "RLI", "FSI", "PDI",
  "DOCUMENT_STATUS_STYLE", "DOCUMENT_STATUSES", "DOCUMENT_TRANSITIONS",
]);
/** PHASE-005 §2 out-of-scope rows — they land with their consuming phases
 *  (PHASE-006+ patterns; PHASE-013 print templates). PartnerPicker/ItemPicker
 *  SHIPPED in P6-T11a; JournalEntryGrid/ApprovalsQueue/MoneySummaryBar
 *  SHIPPED in PHASE-007 — all left the future set (both directions enforced). */
const FUTURE_ROWS = new Set([
  "LineItemsEditor", "WarehousePicker",
  "StatementViewer", "ReportViewer", "ShiftPanel", "KPIStatCard",
  "ChartCard", "FilterBar", "NotificationBell",
  "PrintPreview", "A4DocumentTemplate", "ReportTemplate", "Receipt80", "Receipt58",
]);
// catalog names implemented by a differently-named export (recorded aliases)
const ALIASES: Record<string, string> = { Toast: "ToastProvider", Radio: "RadioGroup" };
const isEnumRow = (name: string): boolean => /^[A-Z]{3,}$/.test(name);

const exportSet = new Set(componentExports.filter((name) => !UTIL_SURFACE.has(name)));

const missingInCatalog = componentExports.filter(
  (name) => !UTIL_SURFACE.has(name) && !rowMatches.some((r) => r.name === name || ALIASES[name] === r.name),
);
const missingInCode = rowMatches
  .filter((r) => !isEnumRow(r.name) && !(r.name in ALIASES))
  .filter((r) => !FUTURE_ROWS.has(r.name))
  .filter((r) => !(exportSet.has(r.name) || exportSet.has(ALIASES[r.name] ?? r.name)))
  .map((r) => r.name);

console.log(`== ui catalog coverage: ${exportSet.size} component exports ↔ ${rowMatches.length} catalog rows ==`);
let failures = 0;
if (missingInCatalog.length > 0) {
  console.error(`FAIL  exported but no COMPONENT_CATALOG row: ${missingInCatalog.join(", ")}`);
  failures += missingInCatalog.length;
}
if (missingInCode.length > 0) {
  console.error(`FAIL  catalog row with no exported component: ${missingInCode.join(", ")}`);
  failures += missingInCode.length;
}
if (failures > 0) {
  console.error(`\n${failures} coverage violation(s) — a component without a catalog entry cannot ship (DESIGN_SYSTEM §5).`);
  process.exit(1);
}
console.log("export↔row parity green.");
process.exit(0);
