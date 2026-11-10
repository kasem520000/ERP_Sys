// PHASE-021 T1 · tauri-build entry (standard Tauri v2 scaffold): emits the
// build script that generates the context (tauri.conf.json embedding, asset
// hashing for the CSP, capability ACL compilation). Compiled only by the
// Windows CI workflow — see Cargo.toml's source-only note.
fn main() {
    tauri_build::build()
}
