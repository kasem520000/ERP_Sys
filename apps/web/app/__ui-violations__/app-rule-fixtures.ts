/**
 * App-side negative fixture: deep @erp/ui import violates erp-ui/import-path
 * (apps consume the public surface only — DESIGN_SYSTEM §2).
 */
import { Button } from "@erp/ui/src/components/button"; // violates erp-ui/import-path

export const badDeepImport = Button;
