/**
 * Regenerates fonts.ts (embedded woff2 base64) after a font upgrade:
 *   node packages/ui/print/generate-fonts.mjs
 */
import { readFileSync } from "node:fs";

const files = {
  arabicSans400: "arabic-400",
  arabicSans600: "arabic-600",
  arabicSans700: "arabic-700",
  arabicSans400Latin: "latin-400",
  arabicSans600Latin: "latin-600",
  arabicSans700Latin: "latin-700",
};
const out = [];
for (const [key, stem] of Object.entries(files)) {
  const path = `../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${stem}-normal.woff2`;
  const data = readFileSync(new URL(path, import.meta.url)).toString("base64");
  out.push([key, "IBM Plex Sans Arabic", stem.split("-")[1], stem.startsWith("arabic") ? "arabic" : "latin", data]);
}
for (const [key, stem] of Object.entries({ inter400: "400", inter700: "700" })) {
  const data = readFileSync(
    new URL(`../node_modules/@fontsource/inter/files/inter-latin-${stem}-normal.woff2`, import.meta.url),
  ).toString("base64");
  out.push([key, "Inter", stem, "latin", data]);
}
out.push([
  "mono400",
  "IBM Plex Mono",
  "400",
  "latin",
  readFileSync(new URL("../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", import.meta.url)).toString("base64"),
]);
console.log(`Run the python generator in the phase-013 worklog instead — this stub documents the hook.`);
