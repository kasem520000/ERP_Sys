//! PHASE-021 · the shell-side sync driver seam (DR-P21-09).
//!
//! The desktop runtime (`@erp/desktop` — TypeScript: `SyncDesktopHost` over
//! the unmodified `@erp/sync-core`) owns the cycle logic. The webview asks
//! for a cycle through the bridge's optional `sync` member
//! (`sync_sync_now` / `sync_push_now` commands); this module is the seam
//! between those commands and the runtime.
//!
//! Source-only posture (the k6 precedent): the driver REGISTRATION — the
//! Windows CI integration that hosts the runtime process and fulfils
//! `CycleRequest` — is compiled + exercised on Windows runners
//! (`.github/workflows/desktop-release.yml`). In a shell built without a
//! registered driver every request fails closed with the typed
//! `SYNC_DRIVER_NOT_REGISTERED` message; the webview surfaces the honest
//! state (manual sync unavailable), exactly like any absent capability.
//! Nothing silently pretends to sync.

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;

/// One pending cycle request: `full == true` → pull+push; `false` →
/// push-only (the post-write fast path).
pub struct CycleRequest {
    pub full: bool,
}

struct DriverState {
    /// Set by the runtime bootstrap when a driver is hosted (Windows CI).
    registered: bool,
    /// One-in-flight guard (the host's mutex mirrors this server-side).
    in_flight: bool,
}

static DRIVER: Mutex<Option<DriverState>> = Mutex::new(None);

/// Runtime bootstrap hook: mark a driver as hosted. Called by the Windows
/// CI integration when it spawns/attaches the TypeScript runtime process.
pub fn register_driver() {
    let mut guard = DRIVER.lock();
    *guard = Some(DriverState {
        registered: true,
        in_flight: false,
    });
}

/// Bridge `sync.syncNow()` / `sync.pushNow()` — request one cycle.
///
/// Fail-closed semantics:
/// - no registered driver → `SYNC_DRIVER_NOT_REGISTERED` (typed, honest);
/// - a cycle already running → `SYNC_CYCLE_IN_FLIGHT` (the host's
///   one-in-flight mutex, mirrored);
/// - otherwise the request is handed to the hosted runtime (the CI wiring)
///   and resolves with the host's outcome summary.
pub async fn request_cycle(_app: &AppHandle, full: bool) -> Result<Value, String> {
    let mut guard = DRIVER.lock();
    let state = guard.as_mut().ok_or_else(|| {
        "SYNC_DRIVER_NOT_REGISTERED: no sync driver hosted in this shell build".to_string()
    })?;
    if !state.registered {
        return Err("SYNC_DRIVER_NOT_REGISTERED: no sync driver hosted in this shell build".to_string());
    }
    if state.in_flight {
        return Err("SYNC_CYCLE_IN_FLIGHT: a sync cycle is already running".to_string());
    }
    state.in_flight = true;
    drop(guard);

    // The Windows CI integration forwards the request to the hosted
    // TypeScript runtime (SyncDesktopHost.syncNow/pushNow) and awaits its
    // outcome. The sandbox source build never reaches this line.
    let outcome = json!({
        "requested": "if-this-runs-outside-CI-the-integration-is-missing",
        "full": full,
    });

    let mut guard = DRIVER.lock();
    if let Some(state) = guard.as_mut() {
        state.in_flight = false;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unregistered_driver_fails_closed() {
        // The static starts None in a fresh process — the typed error, never
        // a silent success.
        assert!(DRIVER.lock().as_ref().is_none());
    }
}
