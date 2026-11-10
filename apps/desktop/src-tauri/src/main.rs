// PHASE-021 T1 · the ERP Desktop shell entry (standard Tauri v2 scaffold).
//
// SOURCE-ONLY in this repository: no Rust toolchain exists in the dev sandbox
// (MASTER-PLAN §0) — compiled and signed only by the Windows CI workflow
// (.github/workflows/desktop-release.yml). scripts/check-desktop-shell.ts
// validates the structural invariants instead.
//
// Prevents an extra console window on Windows in release builds (standard
// tauri scaffold attribute).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    erp_desktop::run()
}
