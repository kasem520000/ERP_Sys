// PHASE-021 T1 · module shim: the plugin glue lives at src-tauri/plugins/
// (the MASTER-PLAN §2 layout — siblings of src/); these #[path] declarations
// bind it into the crate as `plugins::{keychain,print,sql}`.
//
// The keychain/print/sql submodules each stay minimal (<100 lines of glue per
// the plan) — ALL application logic is TypeScript in apps/desktop/src
// (ADR-0013 "Rust stays confined to plugins").

#[path = "../../plugins/keychain/mod.rs"]
pub mod keychain;

#[path = "../../plugins/print/mod.rs"]
pub mod print;

#[path = "../../plugins/sql/mod.rs"]
pub mod sql;
