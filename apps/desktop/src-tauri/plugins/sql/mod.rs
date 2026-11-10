// PHASE-021 T2/T7 · sql glue — the local SQLite (SQLCipher) store behind the
// DesktopBridge `sql` surface (MASTER-PLAN §3; ADR-0013: ALL store logic —
// migrations, pruning, corruption path — lives in TypeScript, apps/desktop/
// src/store; the shell only transports statements over the bridge seam).
//
// DEVIATION (documented in Cargo.toml + agent-ctx/T-P21-2c.md): the plan names
// "tauri-plugin-sql with the sqlcipher feature"; tauri-plugin-sql 2.6.0
// publishes only mysql/postgres/sqlite features (crates.io verified) and its
// sqlx backend cannot carry a SQLCipher key. This glue uses rusqlite instead:
//   - default build: `bundled` stock SQLite (DR-P21-02 "standard" profile)
//   - `--features sqlcipher` build: bundled SQLCipher + vendored OpenSSL
//     (the "cipher" profile — PRAGMA key + cipher_version) — the Windows CI
//     release build passes this flag.
//
// Open semantics (the TS runtime expects them, MASTER-PLAN §3):
//   path  = <app_data_dir>/erp-desktop.db (WAL + foreign_keys asserted)
//   key   = keychain entry "erp.dbKey" (set by the TS enrollment flow via
//           keychain_set; per-device secrets use erp.<deviceId>.* names at
//           the TS level — the DB key is the one shell-level name)
//   key present + sqlcipher build → `PRAGMA key` + cipher_version verified
//   key present + stock build    → loud failure (fail closed, DR-P21-02 —
//           the TS layer catches and offers the standard-profile dialog)

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Shared store state opened at app setup (one connection; WAL journal — the
/// TS adapter serializes everything through this same bridge seam).
pub struct SqlState(pub Mutex<Option<Connection>>);

/// Opens the store at setup: WAL + FK pragmas applied, keychain key honored
/// per the profile matrix in the module header. Failures land in the state
/// (None) — the next sql command then reports the honest open error.
pub fn open(app: &AppHandle) -> SqlState {
    let connection = try_open(app);
    match connection {
        Ok(conn) => SqlState(Mutex::new(Some(conn))),
        Err(error) => {
            eprintln!("erp-desktop sql: open failed: {error}");
            SqlState(Mutex::new(None))
        }
    }
}

fn try_open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|error| {
        rusqlite::Error::InvalidParameterName(format!("create app data dir: {error}"))
    })?;
    let conn = Connection::open(dir.join("erp-desktop.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    // DR-P21-02: apply the keychain-held key when present.
    #[cfg(feature = "sqlcipher")]
    {
        if let Some(key) = crate::plugins::keychain::get_raw("erp.dbKey") {
            conn.pragma_update(None, "key", &key)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            let version: String = conn.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
            if version.trim().is_empty() {
                return Err(rusqlite::Error::InvalidParameterName(
                    "cipher build reported no cipher_version".into(),
                ));
            }
        }
    }

    // A key without cipher support is a fail-closed misconfiguration (the TS
    // SqlCipherUnavailableError path — never silently store plaintext).
    #[cfg(not(feature = "sqlcipher"))]
    {
        if crate::plugins::keychain::get_raw("erp.dbKey").is_some() {
            return Err(rusqlite::Error::InvalidParameterName(
                "database key present but this build has no SQLCipher support \
                 (rebuild with --features sqlcipher)"
                    .into(),
            ));
        }
    }
    Ok(conn)
}

/// JSON value → rusqlite binding value (params arrive as a JSON array).
fn json_to_sql(value: &serde_json::Value) -> SqlValue {
    match value {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        serde_json::Value::Number(number) => match number.as_i64() {
            Some(int) => SqlValue::Integer(int),
            None => SqlValue::Real(number.as_f64().unwrap_or(0.0)),
        },
        serde_json::Value::String(text) => SqlValue::Text(text.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// rusqlite column value → JSON (numbers, text, blobs as base64-ish lossless
/// text — SQLCipher-safe: no secrets are ever SELECTed through the bridge
/// beyond what the TS layer itself queries).
fn sql_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(int) => serde_json::Value::from(int),
        ValueRef::Real(float) => serde_json::Value::from(float),
        ValueRef::Text(text) => serde_json::Value::String(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Blob(bytes) => serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

fn bind(params: &Option<Vec<serde_json::Value>>) -> Vec<SqlValue> {
    params
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(json_to_sql)
        .collect()
}

/// DesktopBridge `sql.execute(sql, params?)` — run a statement, no rows back.
#[tauri::command]
pub fn sql_execute(
    state: State<'_, SqlState>,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|error| error.to_string())?;
    let conn = guard.as_ref().ok_or("store not open (see startup log)")?;
    let values = bind(&params);
    let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    conn.execute(&sql, refs.as_slice()).map(|_| ()).map_err(|e| e.to_string())
}

/// DesktopBridge `sql.query(sql, params?)` — rows back as JSON objects keyed
/// by column name (the shape apps/desktop/src/store/sqlite-adapter.ts expects).
#[tauri::command]
pub fn sql_query(
    state: State<'_, SqlState>,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    let guard = state.0.lock().map_err(|error| error.to_string())?;
    let conn = guard.as_ref().ok_or("store not open (see startup log)")?;
    let values = bind(&params);
    let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = statement.query(refs.as_slice()).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = serde_json::Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = row.get_ref(index).map_err(|e| e.to_string())?;
            object.insert(column.clone(), sql_to_json(value));
        }
        out.push(object);
    }
    Ok(out)
}
