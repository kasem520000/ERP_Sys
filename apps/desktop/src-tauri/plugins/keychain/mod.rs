// PHASE-021 T3/T7 · keychain glue — Windows Credential Manager behind the
// DesktopBridge `keychain` surface (MASTER-PLAN §4; SECURITY_AND_DEVICE_MANAGEMENT
// §3: device refresh token, device private key, and the SQLite key live ONLY
// here — never in SQLite, logs, or preferences; access tokens stay in memory).
//
// Implementation: the `keyring` crate 4 (crates.io "All-in-One Rust Keyring")
// with its default Windows Credential Manager backend (advapi32 CredRead/
// CredWrite/CredDelete). DEVIATION from the plan's "tauri-plugin-keyring":
// that crate is a single 0.1.0 community release (2024-12, no repository) —
// the direct, mature crate is the production choice (agent-ctx/T-P21-2c.md).
//
// Names: the TS auth layer namespaces its entries `erp.<deviceId>.{refreshToken
// |deviceKey}` and the shell-level SQLite key lives at `erp.dbKey` (see
// plugins/sql) — this glue is namespace-agnostic (service, user) storage.

use keyring::Entry;

/// The Credential Manager service every entry lives under (one vault per app).
const SERVICE: &str = "ERP Desktop";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|error| format!("keychain entry {name}: {error}"))
}

/// Shell-internal read used by the sql glue at open time (no tauri State).
pub fn get_raw(name: &str) -> Option<String> {
    let entry = entry(name).ok()?;
    match entry.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            eprintln!("erp-desktop keychain: read {name} failed: {error}");
            None
        }
    }
}

/// DesktopBridge `keychain.get(name)` → the stored secret or null (no
/// existence errors — a missing entry is a legitimate state, not a failure).
#[tauri::command]
pub fn keychain_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("keychain get {name}: {error}")),
    }
}

/// DesktopBridge `keychain.set(name, value)` — create or overwrite.
#[tauri::command]
pub fn keychain_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?
        .set_password(&value)
        .map_err(|error| format!("keychain set {name}: {error}"))
}

/// DesktopBridge `keychain.delete(name)` — remove; deleting a missing entry
/// is success (idempotent, the TS logout/revocation path may race a purge).
#[tauri::command]
pub fn keychain_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("keychain delete {name}: {error}")),
    }
}
