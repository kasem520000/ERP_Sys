// PHASE-021 T1 · the ERP Desktop shell runtime (ADR-0013, MASTER-PLAN §8).
//
// SOURCE-ONLY: compiled by the Windows CI workflow (no Rust toolchain in the
// dev sandbox — the k6 precedent). scripts/check-desktop-shell.ts validates
// the invariants below WITHOUT compiling:
//   1. the tauri.conf.json shape (identifier/bundle/updater),
//   2. the bridge-contract ↔ Rust-command parity (this file's mapping table),
//   3. the exported web shell (apps/web/out-desktop) after build:desktop,
//   4. no secrets embedded in the shell configs.
//
// ─── DesktopBridge ↔ Rust command mapping (the parity table) ────────────────
// The bridge contract lives in apps/desktop/src/bridge/contract.ts; the web
// bundle consumes the injected `window.__erpDesktop` (BOOTSTRAP_JS below).
// EVERY invoke-based member maps 1:1 onto a `#[tauri::command]` here, named
// `<group>_<method>` in snake_case:
//
//   contract member                    Rust #[tauri::command] fn
//   ─────────────────────────────────  ─────────────────────────────────────
//   keychain.get(name)                 keychain_get
//   keychain.set(name, value)          keychain_set
//   keychain.delete(name)              keychain_delete
//   sql.execute(sql, params?)          sql_execute
//   sql.query(sql, params?)            sql_query
//   http.request({method,url,headers,body}) http_request
//   updater.checkNow()                 updater_check_now
//   updater.install()                  updater_install
//   system.webview2Version()           system_webview2_version
//   system.osInfo()                    system_os_info
//   print.printRaw(bytes)              print_print_raw
//   print.printHtml(html)              print_print_html
//   connectivity.isOnline()            connectivity_is_online
//   sync.syncNow() [DR-P21-09, optional] sync_sync_now
//   sync.pushNow() [DR-P21-09, optional] sync_push_now
//   connectivity.onChange(callback)    EVENT "erp:connectivity" (listen-only;
//                                     not an invoke — the shell pushes state
//                                     changes; isOnline reads the mirrored
//                                     local state the bootstrap keeps)
//
// A member added to contract.ts MUST add its command here (the check script
// fails with the exact missing pair otherwise).
//
// ─── Boot sequence ──────────────────────────────────────────────────────────
//   setup: sql glue opens <app_data>/erp-desktop.db (WAL; keychain key per
//   DR-P21-02) · the connectivity watcher starts (5 s probe, event on change)
//   · on every page load the bootstrap below injects window.__erpDesktop
//   BEFORE the web bundle runs (the web app's detectBridge validates it).

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest;
use tauri_plugin_updater::UpdaterExt;

// Plugin glue modules live at src-tauri/plugins/{sql,keychain,print}/
// (the MASTER-PLAN §2 layout — siblings of src/), bound into the crate
// through the src/plugins/mod.rs #[path] shim so `plugins::sql::…` resolves.
mod plugins;
mod sync_driver;

use plugins::keychain;
use plugins::print;
use plugins::sql;

/// Shared connectivity state (mirrored into the bootstrap on change).
struct ConnectivityState {
    online: bool,
}

/// The event the shell emits on connectivity transitions (the bridge
/// `connectivity.onChange` listens to exactly this name).
const CONNECTIVITY_EVENT: &str = "erp:connectivity";

/// Probe target for the connectivity watcher (any-cast DNS resolver, TCP 443
/// — a cheap, unauthenticated liveness probe; the sync layer's real online
/// test is the API status call itself).
const CONNECTIVITY_PROBE: (&str, u16) = ("1.1.1.1", 443);
const CONNECTIVITY_PROBE_INTERVAL: Duration = Duration::from_secs(5);

/// DesktopBridge `sync.syncNow()` (DR-P21-09, optional member) — ask the
/// shell-side sync driver to run a full cycle. The driver hosts the
/// TypeScript desktop runtime (@erp/desktop SyncDesktopHost over
/// sync-core); this command signals it (channel state) and resolves with
/// the host's outcome. Compiled + integration-tested on Windows CI
/// (source-only posture in the sandbox — the k6 precedent).
#[tauri::command]
async fn sync_sync_now(app: AppHandle) -> Result<serde_json::Value, String> {
    crate::sync_driver::request_cycle(&app, true).await
}

/// DesktopBridge `sync.pushNow()` (DR-P21-09) — post-write fast push
/// (push-only cycle).
#[tauri::command]
async fn sync_push_now(app: AppHandle) -> Result<serde_json::Value, String> {
    crate::sync_driver::request_cycle(&app, false).await
}

/// DesktopBridge `connectivity.isOnline()` — synchronous read of the last
/// probed state (the bootstrap keeps the same value client-side).
#[tauri::command]
fn connectivity_is_online(state: tauri::State<Mutex<ConnectivityState>>) -> bool {
    state.lock().map(|state| state.online).unwrap_or(true)
}

/// DesktopBridge `http.request(input)` — shell-side HTTP with the updater
/// plugin's reqwest client (one TLS stack: rustls; the sync transport sends
/// device credentials — the browser fetch path never sees tokens, ADR-0015).
#[tauri::command]
async fn http_request(
    app: AppHandle,
    method: String,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut request = match method.to_ascii_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        other => return Err(format!("http_request: unsupported method {other}")),
    };
    if let Some(headers) = headers {
        for (name, value) in headers {
            request = request.header(name, value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("http_request: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("http_request: body: {error}"))?;
    Ok(serde_json::json!({ "status": status, "body": body }))
}

/// DesktopBridge `updater.checkNow()` — the Tauri v2 updater check against
/// plugins.updater.endpoints (tauri.conf.json; minisign-signed manifests, the
/// signature verified by the plugin against plugins.updater.pubkey). The
/// pending update is stashed for `updater_install`. Returns the Tauri Update
/// shape (version/date/body) or {available: false}.
#[tauri::command]
async fn updater_check_now(
    app: AppHandle,
    pending: tauri::State<'_, Mutex<Option<tauri_plugin_updater::Update>>>,
) -> Result<serde_json::Value, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|error| format!("updater_check_now: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("updater_check_now: {error}"))?;
    match update {
        Some(update) => {
            let payload = serde_json::json!({
                "available": true,
                "version": update.version,
                "currentVersion": update.current_version,
                "date": update.date.map(|date| date.to_string()),
                "body": update.body,
            });
            *pending
                .lock()
                .map_err(|error| format!("updater_check_now: {error}"))? = Some(update);
            Ok(payload)
        }
        None => Ok(serde_json::json!({ "available": false })),
    }
}

/// DesktopBridge `updater.install()` — download + minisign-verify + install
/// the update stashed by `updater_check_now`, then restart the app.
#[tauri::command]
async fn updater_install(
    app: AppHandle,
    pending: tauri::State<'_, Mutex<Option<tauri_plugin_updater::Update>>>,
) -> Result<(), String> {
    let update = pending
        .lock()
        .map_err(|error| format!("updater_install: {error}"))?
        .take()
        .ok_or("updater_install: no update was checked (call checkNow first)")?;
    let mut downloaded: Vec<u8> = Vec::new();
    update
        .download(
            |chunk, _| downloaded.extend_from_slice(chunk),
            || (),
        )
        .await
        .map_err(|error| format!("updater_install: download: {error}"))?;
    update
        .install_bytes(&downloaded)
        .map_err(|error| format!("updater_install: {error}"))?;
    app.restart();
}

/// DesktopBridge `system.webview2Version()` — the installed Evergreen runtime
/// version from the EdgeUpdate registry key, or null when absent (the TS
/// webview2Policy bands it against WEBVIEW2_MINIMUM/RECOMMENDED).
#[tauri::command]
fn system_webview2_version() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        // {F3017226-FE2A-4295-8BDF-00C3A9A7E4C5} = the WebView2 runtime
        // (EdgeUpdate client id); "pv" holds the version string.
        for path in [
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ] {
            let key = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path);
            if let Ok(key) = key {
                if let Ok(version) = key.get_value::<String, _>("pv") {
                    return Ok(Some(version));
                }
            }
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    Ok(None)
}

/// DesktopBridge `system.osInfo()` — name/version/arch/family strings.
#[tauri::command]
fn system_os_info() -> std::collections::HashMap<String, String> {
    let info = os_info::get();
    let mut map = std::collections::HashMap::new();
    map.insert("os".to_string(), info.os_type().to_string());
    map.insert("version".to_string(), info.version().to_string());
    map.insert(
        "architecture".to_string(),
        std::env::consts::ARCH.to_string(),
    );
    map.insert("family".to_string(), std::env::consts::FAMILY.to_string());
    map.insert("bitness".to_string(), info.bitness().to_string());
    map
}

/// The pre-web bootstrap: defines window.__erpDesktop over Tauri's injected
/// `__TAURI_INTERNALS__.invoke` (the same bridge @tauri-apps/api uses — see
/// its event/plugin source; withGlobalTauri stays off, nothing else leaks).
/// `connectivity.onChange` mirrors the official event API: transformCallback
/// registers the JS handler, plugin:event|listen subscribes. {ONLINE} is the
/// probed initial state, formatted in by the Rust side before eval.
const BOOTSTRAP_JS: &str = r#"
(function () {
  if (window.__erpDesktop) { return; }
  var invoke = function (command, args) {
    return window.__TAURI_INTERNALS__.invoke(command, args);
  };
  var online = {ONLINE};
  var notify = [];
  function emitChange() {
    for (var index = 0; index < notify.length; index += 1) { try { notify[index](online); } catch (_) {} }
  }
  window.__erpDesktop = {
    version: "1.0.0",
    capabilities: {
      keychain: true, sqlite: true, http: true,
      updater: true, print: true, webview2Probe: true
    },
    keychain: {
      get: function (name) { return invoke("keychain_get", { name: name }); },
      set: function (name, value) { return invoke("keychain_set", { name: name, value: value }); },
      delete: function (name) { return invoke("keychain_delete", { name: name }); }
    },
    sql: {
      execute: function (sql, params) { return invoke("sql_execute", { sql: sql, params: params || [] }); },
      query: function (sql, params) { return invoke("sql_query", { sql: sql, params: params || [] }); }
    },
    http: {
      request: function (input) {
        return invoke("http_request", {
          method: input.method, url: input.url,
          headers: input.headers || {}, body: input.body
        });
      }
    },
    updater: {
      checkNow: function () { return invoke("updater_check_now", {}); },
      install: function () { return invoke("updater_install", {}); }
    },
    system: {
      webview2Version: function () { return invoke("system_webview2_version", {}); },
      osInfo: function () { return invoke("system_os_info", {}); }
    },
    print: {
      printRaw: function (bytes) {
        var plain = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
        return invoke("print_print_raw", { bytes: plain });
      },
      printHtml: function (html) { return invoke("print_print_html", { html: html }); }
    },
    connectivity: {
      onChange: function (callback) {
        notify.push(callback);
        var unlistenPromise = null;
        try {
          var internals = window.__TAURI_INTERNALS__;
          var handler = internals.transformCallback(function () { emitChange(); }, true);
          unlistenPromise = internals
            .invoke("plugin:event|listen", { event: "erp:connectivity", target: "main", handler: handler })
            .then(function (eventId) {
              return function () {
                delete internals.callbacks[handler];
                return internals.invoke("plugin:event|unlisten", { event: "erp:connectivity", eventId: eventId });
              };
            });
        } catch (_) { /* events unavailable — poll-free degradation, isOnline stays live */ }
        return function () {
          var index = notify.indexOf(callback);
          if (index >= 0) { notify.splice(index, 1); }
          if (unlistenPromise) { unlistenPromise.then(function (unlisten) { unlisten(); }); }
        };
      },
      isOnline: function () { return online; }
    }
  };
  // Keep the synchronous state mirror fresh: the shell re-evals this setter
  // line on every connectivity transition before emitting the event.
  window.__erpDesktop.__setOnline = function (value) { online = !!value; emitChange(); };
})();
"#;

/// Runs the shell: plugins + commands + state + the connectivity watcher.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Local store (plugins/sql) — WAL, keychain key per DR-P21-02.
            let sql_state = sql::open(app.handle());
            let online = probe_connectivity();
            app.manage(sql_state);
            app.manage(Mutex::new(ConnectivityState { online }));
            app.manage(Mutex::<Option<tauri_plugin_updater::Update>>::new(None));
            start_connectivity_watcher(app.handle().clone());
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                let online = webview
                    .app_handle()
                    .try_state::<Mutex<ConnectivityState>>()
                    .map(|state| state.lock().map(|s| s.online).unwrap_or(true))
                    .unwrap_or(true);
                let bootstrap = BOOTSTRAP_JS.replace("{ONLINE}", if online { "true" } else { "false" });
                if let Err(error) = webview.eval(&bootstrap) {
                    eprintln!("erp-desktop: bridge bootstrap injection failed: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // keychain (plugins/keychain)
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            // sql (plugins/sql)
            sql::sql_execute,
            sql::sql_query,
            // http (this module)
            http_request,
            // updater (this module — the plugin's Rust API underneath)
            updater_check_now,
            updater_install,
            // system (this module)
            system_webview2_version,
            system_os_info,
            // print (plugins/print)
            print::print_print_raw,
            print::print_print_html,
            // sync driver (DR-P21-09 — this module; optional member: older
            // shells predate it, the UI gates on capabilities.sync)
            sync_sync_now,
            sync_push_now,
            // connectivity (this module)
            connectivity_is_online,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the ERP Desktop shell");
}

/// One TCP liveness probe (true = online).
fn probe_connectivity() -> bool {
    use std::net::TcpStream;
    let address = format!("{}:{}", CONNECTIVITY_PROBE.0, CONNECTIVITY_PROBE.1);
    let Ok(address) = address.parse() else {
        return false;
    };
    TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok()
}

/// Spawns the connectivity watcher: probes every 5 s, updates the shared
/// state, re-evals the bootstrap mirror line, then emits CONNECTIVITY_EVENT.
/// Started from run()'s setup via the app handle (kept here for cohesion).
pub fn start_connectivity_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last: Option<bool> = None;
        loop {
            let online = tokio::task::spawn_blocking(probe_connectivity)
                .await
                .unwrap_or(false);
            if last != Some(online) {
                last = Some(online);
                if let Some(state) = app.try_state::<Mutex<ConnectivityState>>() {
                    if let Ok(mut guard) = state.lock() {
                        guard.online = online;
                    }
                }
                if let Some(webview) = app.get_webview_window("main") {
                    let _ = webview.eval(&format!(
                        "window.__erpDesktop && window.__erpDesktop.__setOnline && window.__erpDesktop.__setOnline({});",
                        online
                    ));
                    let _ = app.emit(CONNECTIVITY_EVENT, online);
                }
            }
            tokio::time::sleep(CONNECTIVITY_PROBE_INTERVAL).await;
        }
    });
}
