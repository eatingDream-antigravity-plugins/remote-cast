use crate::cdp::client::BOOT_SNAPSHOT_MAX_DATA_URL_CHARS;
use crate::config::{Config, APP_VERSION};
use crate::local_io::read_bounded_line;
#[cfg(test)]
use crate::mcp::tools::dispatch_tool_with_cache;
use crate::mcp::tools::{
    attach_settings_snapshot, dispatch_tool_with_context, redact_relay_payload, tool_definitions,
    APP_MIME, STAGE_URI,
};
use crate::relay::ipc::{RelayBackend, RelayClient};
use crate::settings::SettingsStore;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18"];
const APPS_EXTENSION: &str = "io.modelcontextprotocol/ui";
const MAX_CONCURRENT_REQUESTS: usize = 16;
const MAX_MCP_REQUEST_BYTES: usize = 1024 * 1024;
const SWR_FRESH_TTL: Duration = Duration::from_millis(500);
const SWR_MAX_STALE_TTL: Duration = Duration::from_millis(2500);
#[cfg(not(test))]
const KEEP_FRESH_INTERVAL: Duration = Duration::from_secs(15);
const HTML_STAT_TTL: Duration = Duration::from_millis(500);
const BOOT_MARKER: &str = "/*__CHROME_STREAM_BOOT__*/";

#[derive(Default)]
struct HtmlCache {
    path: PathBuf,
    mtime: Option<SystemTime>,
    size: u64,
    checked_at: Option<Instant>,
    prefix: String,
    suffix: String,
    has_marker: bool,
}

impl HtmlCache {
    fn ensure_loaded(&mut self, path: &Path) -> Result<(), String> {
        if self.path == path && !self.prefix.is_empty() {
            if let Some(ts) = self.checked_at {
                if ts.elapsed() < HTML_STAT_TTL {
                    return Ok(());
                }
            }
        }
        let meta = fs::metadata(path).map_err(|e| format!("Failed reading panel HTML: {e}"))?;
        let mtime = meta.modified().ok();
        let size = meta.len();
        self.checked_at = Some(Instant::now());
        if self.path == path && self.mtime == mtime && self.size == size && !self.prefix.is_empty()
        {
            return Ok(());
        }
        let text =
            fs::read_to_string(path).map_err(|e| format!("Failed reading panel HTML: {e}"))?;
        self.path = path.to_path_buf();
        self.mtime = mtime;
        self.size = size;
        if let Some((pre, suf)) = text.split_once(BOOT_MARKER) {
            self.prefix = pre.to_string();
            self.suffix = suf.to_string();
            self.has_marker = true;
        } else {
            self.prefix = text;
            self.suffix.clear();
            self.has_marker = false;
        }
        Ok(())
    }

    fn render_metadata(&mut self, path: &Path, metadata: Option<&Value>) -> Result<String, String> {
        self.ensure_loaded(path)?;
        if !self.has_marker {
            return Ok(self.prefix.clone());
        }
        match metadata {
            Some(meta) => {
                let serialized = serialize_boot_data(meta);
                let mut out = String::with_capacity(
                    self.prefix.len() + self.suffix.len() + serialized.len() + 26,
                );
                out.push_str(&self.prefix);
                out.push_str("window.__CHROME_STREAM_BOOT__=");
                out.push_str(&serialized);
                out.push(';');
                out.push_str(&self.suffix);
                Ok(out)
            }
            None => {
                let mut out = String::with_capacity(
                    self.prefix.len() + BOOT_MARKER.len() + self.suffix.len(),
                );
                out.push_str(&self.prefix);
                out.push_str(BOOT_MARKER);
                out.push_str(&self.suffix);
                Ok(out)
            }
        }
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn serialize_boot_data(val: &impl Serialize) -> String {
    let raw = serde_json::to_string(val).unwrap_or_else(|_| "null".to_string());
    let mut out = String::with_capacity(raw.len() + 32);
    for ch in raw.chars() {
        match ch {
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            _ => out.push(ch),
        }
    }
    out
}

#[derive(Clone)]
struct BootSnapshot {
    metadata: Value,
    #[cfg_attr(not(test), allow(dead_code))]
    image: Arc<str>,
}

impl BootSnapshot {
    fn from_relay(mut metadata: Value) -> Option<Self> {
        let obj = metadata.as_object_mut()?;
        let image = match obj.remove("imageDataUrl") {
            Some(Value::String(data)) if data.len() <= BOOT_SNAPSHOT_MAX_DATA_URL_CHARS => {
                Arc::from(data)
            }
            Some(Value::String(_)) => {
                clear_boot_frame(&mut metadata);
                Arc::from("")
            }
            _ => Arc::from(""),
        };
        redact_relay_payload(&mut metadata);
        if let Some(obj) = metadata.as_object_mut() {
            obj.insert("appVersion".to_string(), json!(APP_VERSION));
            if obj.get("bootTs").and_then(Value::as_u64).is_none() {
                obj.insert("bootTs".to_string(), json!(now_epoch_ms()));
            }
        }
        Some(Self { metadata, image })
    }
}

fn clear_boot_frame(snapshot: &mut Value) {
    snapshot["seq"] = json!(0);
    snapshot["frameHash"] = json!("");
    snapshot["imageBytes"] = json!(0);
    snapshot["changed"] = json!(false);
    snapshot["unchanged"] = json!(true);
}

pub fn stage_status_from_snapshot(snap: &Value) -> Value {
    let mut out = json!({ "hostname": "localhost" });
    for key in [
        "connected",
        "connecting",
        "paused",
        "screencastPausedIdle",
        "noTabs",
        "chromeReady",
    ] {
        if let Some(value) = snap[key].as_bool() {
            out[key] = json!(value);
        }
    }
    for key in ["epoch", "pauseEpoch"] {
        if let Some(value) = snap[key].as_u64() {
            out[key] = json!(value);
        }
    }
    out["connectionMode"] = match snap["connectionMode"].as_str() {
        Some(mode @ ("personal" | "remote")) => json!(mode),
        _ => Value::Null,
    };
    out["remotePort"] = snap["remotePort"]
        .as_u64()
        .and_then(|port| u16::try_from(port).ok())
        .filter(|&port| port > 0)
        .map(|port| json!(port))
        .unwrap_or(Value::Null);
    out["portFile"] = json!({
        "exists": snap["portFile"]["exists"].as_bool().unwrap_or(false),
        "valid": snap["portFile"]["valid"].as_bool().unwrap_or(false),
        "stale": snap["portFile"]["stale"].as_bool().unwrap_or(false),
        "port": snap["portFile"]["port"].as_u64().and_then(|port| u16::try_from(port).ok()),
    });
    out
}

struct SwrState {
    snapshot: Option<BootSnapshot>,
    updated_at: Option<Instant>,
    refreshing: bool,
    generation: u64,
    revokes_in_flight: usize,
}

/// Stale-While-Revalidate cache for relay `boot_snapshot` + Chrome readiness.
/// Populated asynchronously at `chrome-stream-mcp serve` startup so first-click `resources/read`
/// and `chrome_stream_stage` return from RAM in <0.5 ms without blocking on relay spawn or IPC.
pub struct SwrBootCache {
    relay: Arc<dyn RelayBackend>,
    state: Mutex<SwrState>,
    ready_cv: Condvar,
    #[cfg(not(test))]
    stop_mu: Mutex<bool>,
    #[cfg(not(test))]
    stop_cv: Condvar,
}

impl SwrBootCache {
    pub fn new(relay: Arc<dyn RelayBackend>) -> Arc<Self> {
        Arc::new(Self {
            relay,
            state: Mutex::new(SwrState {
                snapshot: None,
                updated_at: None,
                refreshing: false,
                generation: 0,
                revokes_in_flight: 0,
            }),
            ready_cv: Condvar::new(),
            #[cfg(not(test))]
            stop_mu: Mutex::new(false),
            #[cfg(not(test))]
            stop_cv: Condvar::new(),
        })
    }

    #[cfg(test)]
    fn is_warm(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .is_some()
    }

    fn fetch_from_relay(&self, timeout: Duration) -> Option<BootSnapshot> {
        self.relay
            .call("boot_snapshot", json!({}), timeout)
            .or_else(|_| self.relay.call("status", json!({}), timeout))
            .ok()
            .and_then(BootSnapshot::from_relay)
    }

    fn finish_refresh(
        &self,
        generation: u64,
        previous_update: Option<Instant>,
        fetched: Option<BootSnapshot>,
        clear_on_failure: bool,
    ) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if st.generation != generation {
            return;
        }
        if st.updated_at == previous_update {
            if let Some(snapshot) = fetched {
                st.snapshot = Some(snapshot);
                st.updated_at = Some(Instant::now());
            } else if clear_on_failure {
                st.snapshot = None;
                st.updated_at = None;
            }
        }
        st.refreshing = false;
        self.ready_cv.notify_all();
    }

    /// Triggers a single-flight background refresh (warms relay connection + fetches snapshot).
    pub fn prewarm_async(self: &Arc<Self>, warm_relay: bool) {
        let (generation, previous_update) = {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if st.refreshing || st.revokes_in_flight != 0 {
                return;
            }
            st.refreshing = true;
            (st.generation, st.updated_at)
        };
        let me = Arc::clone(self);
        let worker = thread::Builder::new()
            .name("chrome-stream-warm".to_string())
            .spawn(move || {
                if warm_relay {
                    let _ = me.relay.warm();
                    // Also nudge relay's Chrome readiness check asynchronously without downgrading active streams.
                    let _ = me.relay.call("warm", json!({}), Duration::from_millis(800));
                }
                let fetched = me.fetch_from_relay(Duration::from_millis(1500));
                me.finish_refresh(generation, previous_update, fetched, false);
            });
        if worker.is_err() {
            self.finish_refresh(generation, previous_update, None, false);
        }
    }

    /// Returns cached snapshot immediately (<0.1 ms) if within `max_stale_ttl` (triggering async
    /// revalidation past `SWR_FRESH_TTL`). Revalidates synchronously when cold or expired.
    fn get_swr_with_ttl(
        self: &Arc<Self>,
        cold_wait: Duration,
        max_stale_ttl: Duration,
    ) -> Option<BootSnapshot> {
        let (
            cached,
            needs_bg_refresh,
            wait_in_flight,
            clear_on_failure,
            generation,
            previous_update,
        ) = {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if st.revokes_in_flight != 0 {
                return None;
            }
            let age = st.updated_at.map(|t| t.elapsed());
            if let Some(snap) = st
                .snapshot
                .clone()
                .filter(|_| age.is_some_and(|a| a <= max_stale_ttl))
            {
                let stale = age.is_none_or(|a| a >= SWR_FRESH_TTL);
                let bg = stale && !st.refreshing;
                if bg {
                    st.refreshing = true;
                }
                (Some(snap), bg, false, false, st.generation, st.updated_at)
            } else if st.refreshing {
                (None, false, true, false, st.generation, st.updated_at)
            } else {
                let expired = st.snapshot.is_some();
                st.refreshing = true;
                (None, false, false, expired, st.generation, st.updated_at)
            }
        };

        if let Some(snap) = cached {
            if needs_bg_refresh {
                let me = Arc::clone(self);
                let worker = thread::Builder::new()
                    .name("chrome-stream-swr".to_string())
                    .spawn(move || {
                        let fetched = me.fetch_from_relay(Duration::from_millis(1500));
                        me.finish_refresh(generation, previous_update, fetched, false);
                    });
                if worker.is_err() {
                    self.finish_refresh(generation, previous_update, None, false);
                }
            }
            return Some(snap);
        }

        if wait_in_flight {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if st.refreshing && !cold_wait.is_zero() {
                let (guard, _) = self
                    .ready_cv
                    .wait_timeout_while(st, cold_wait, |s| {
                        s.refreshing
                            && s.generation == generation
                            && s.updated_at == previous_update
                    })
                    .unwrap_or_else(|e| e.into_inner());
                st = guard;
            }
            if st.revokes_in_flight != 0
                || st.updated_at.is_none_or(|t| t.elapsed() > max_stale_ttl)
            {
                return None;
            }
            return st.snapshot.clone();
        }

        // Cold or expired path with no in-flight refresh: fetch synchronously once (bounded).
        let fetched = self.fetch_from_relay(cold_wait.max(Duration::from_millis(200)));
        self.finish_refresh(generation, previous_update, fetched, clear_on_failure);
        let st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if st.revokes_in_flight != 0 || st.updated_at.is_none_or(|t| t.elapsed() > max_stale_ttl) {
            return None;
        }
        st.snapshot.clone()
    }

    fn get_swr(self: &Arc<Self>, cold_wait: Duration) -> Option<BootSnapshot> {
        self.get_swr_with_ttl(cold_wait, SWR_MAX_STALE_TTL)
    }

    pub fn stage_status(self: &Arc<Self>, cold_wait: Duration) -> Option<Value> {
        self.get_swr_with_ttl(cold_wait, SWR_FRESH_TTL)
            .map(|snapshot| stage_status_from_snapshot(&snapshot.metadata))
    }

    #[cfg(not(test))]
    fn refresh_keep_fresh(&self) {
        let (generation, previous_update) = {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if st.refreshing
                || st.revokes_in_flight != 0
                || st
                    .updated_at
                    .is_some_and(|t| t.elapsed() < KEEP_FRESH_INTERVAL)
            {
                return;
            }
            st.refreshing = true;
            (st.generation, st.updated_at)
        };
        let fetched = self.fetch_from_relay(Duration::from_millis(1500));
        self.finish_refresh(generation, previous_update, fetched, false);
    }

    #[cfg(not(test))]
    fn wait_stop(&self, timeout: Duration) -> bool {
        let Ok(guard) = self.stop_mu.lock() else {
            return true;
        };
        if *guard {
            return true;
        }
        let (guard, _) = self
            .stop_cv
            .wait_timeout_while(guard, timeout, |stopped| !*stopped)
            .unwrap_or_else(|e| e.into_inner());
        *guard
    }

    #[cfg(not(test))]
    fn stop_keep_fresh(&self) {
        if let Ok(mut stopped) = self.stop_mu.lock() {
            *stopped = true;
            self.stop_cv.notify_all();
        }
    }

    pub fn generation(&self) -> u64 {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .generation
    }

    pub fn begin_revoke(&self) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.generation += 1;
        st.revokes_in_flight += 1;
        st.snapshot = None;
        st.updated_at = None;
        st.refreshing = false;
        self.ready_cv.notify_all();
    }

    pub fn finish_revoke(&self, confirmed: Option<&Value>) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.generation += 1;
        st.revokes_in_flight -= 1;
        if st.revokes_in_flight == 0 {
            if let Some(sc) = confirmed {
                Self::merge_result(&mut st, sc);
            }
        }
        self.ready_cv.notify_all();
    }

    /// Merges metadata in place and keeps the cached pixels shared on unchanged frames.
    pub fn update_from_tool_result(&self, generation: u64, sc: &Value) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if st.generation != generation || st.revokes_in_flight != 0 {
            return;
        }
        Self::merge_result(&mut st, sc);
        self.ready_cv.notify_all();
    }

    fn merge_result(st: &mut SwrState, sc: &Value) {
        let BootSnapshot {
            metadata: snap,
            image,
        } = st.snapshot.get_or_insert_with(|| BootSnapshot {
            metadata: json!({
                "hostname": "localhost",
                "appVersion": APP_VERSION,
                "connected": false,
                "connectionMode": Value::Null,
                "crisp": false,
                "format": Value::Null,
                "connecting": false,
                "tabs": [],
                "tabsHash": "empty",
                "changed": false,
                "unchanged": true,
                "seq": 0,
                "frameHash": "",
                "imageBytes": 0,
                "qualityApplied": "low",
            }),
            image: Arc::from(""),
        });

        let connected = sc.get("connected").and_then(|v| v.as_bool());
        if let Some(c) = connected {
            snap["connected"] = json!(c);
        }
        let mut mode_changed = false;
        if let Some(mode) = sc.get("connectionMode") {
            mode_changed = snap.get("connectionMode") != Some(mode);
            snap["connectionMode"] = mode.clone();
            if mode == "personal" {
                snap["remotePort"] = Value::Null;
            }
        }
        if let Some(rp) = sc.get("remotePort") {
            snap["remotePort"] = rp.clone();
        }
        for key in ["locale", "pauseEpoch", "connecting"] {
            if let Some(value) = sc.get(key) {
                snap[key] = value.clone();
            }
        }
        if let Some(pf) = sc.get("portFile") {
            if !pf.is_null() {
                snap["portFile"] = pf.clone();
                if let Some(valid) = pf.get("valid").and_then(|v| v.as_bool()) {
                    snap["chromeReady"] = json!(valid);
                }
            }
        }

        if connected == Some(false) {
            snap["connectionMode"] = Value::Null;
            snap["remotePort"] = Value::Null;
            snap["crisp"] = json!(false);
            snap["format"] = Value::Null;
            snap["paused"] = json!(false);
            snap["screencastPausedIdle"] = json!(false);
            snap["noTabs"] = json!(false);
            snap["dialog"] = Value::Null;
            snap["tabs"] = json!([]);
            snap["tabsHash"] = json!("empty");
            snap["activeTargetId"] = Value::Null;
            snap["page"] =
                json!({ "title": "", "url": "", "viewportWidth": 1280, "viewportHeight": 800 });
            clear_boot_frame(snap);
            *image = Arc::from("");
        } else {
            if let Some(p) = sc.get("paused").and_then(|v| v.as_bool()) {
                snap["paused"] = json!(p);
            }
            if let Some(idle) = sc.get("screencastPausedIdle").and_then(|v| v.as_bool()) {
                snap["screencastPausedIdle"] = json!(idle);
            }
            if let Some(dlg) = sc.get("dialog") {
                snap["dialog"] = dlg.clone();
            }
            let no_tabs = sc
                .get("noTabs")
                .and_then(Value::as_bool)
                .or_else(|| sc.get("tabs").and_then(Value::as_array).map(Vec::is_empty))
                .unwrap_or_else(|| snap["noTabs"] == true);
            let prev_tid = snap
                .get("activeTargetId")
                .and_then(|v| v.as_str())
                .map(String::from);
            if no_tabs {
                snap["noTabs"] = json!(true);
                snap["activeTargetId"] = Value::Null;
            } else {
                snap["noTabs"] = json!(false);
                if let Some(tid) = sc.get("activeTargetId") {
                    if !tid.is_null() {
                        snap["activeTargetId"] = tid.clone();
                    }
                }
            }
            let new_tid = snap
                .get("activeTargetId")
                .and_then(|v| v.as_str())
                .map(String::from);
            let target_changed = prev_tid != new_tid;

            if let Some(ep) = sc.get("epoch") {
                if !ep.is_null() {
                    snap["epoch"] = ep.clone();
                }
            }
            if let Some(tabs) = sc.get("tabs") {
                if tabs.is_array() {
                    snap["tabs"] = tabs.clone();
                }
            }
            if let Some(th) = sc.get("tabsHash").and_then(|v| v.as_str()) {
                if !th.is_empty() {
                    snap["tabsHash"] = json!(th);
                }
            }
            if let Some(page) = sc.get("page") {
                if page.is_object() {
                    snap["page"] = page.clone();
                }
            }
            if let Some(q) = sc.get("qualityApplied").and_then(|v| v.as_str()) {
                snap["qualityApplied"] = json!(q);
            }

            if target_changed || mode_changed || no_tabs {
                clear_boot_frame(snap);
                *image = Arc::from("");
                snap["crisp"] = json!(false);
                snap["format"] = Value::Null;
            }
            if !no_tabs {
                for key in ["crisp", "format"] {
                    if let Some(value) = sc.get(key) {
                        snap[key] = value.clone();
                    }
                }
                if sc["changed"] == true {
                    let img = sc["imageDataUrl"].as_str().unwrap_or("");
                    if !img.is_empty() && img.len() <= BOOT_SNAPSHOT_MAX_DATA_URL_CHARS {
                        *image = Arc::from(img);
                        for key in ["imageBytes", "seq", "frameHash"] {
                            snap[key] = sc[key].clone();
                        }
                        snap["changed"] = json!(true);
                        snap["unchanged"] = json!(false);
                    } else {
                        clear_boot_frame(snap);
                        *image = Arc::from("");
                    }
                }
            }
        }

        redact_relay_payload(snap);
        snap["appVersion"] = json!(APP_VERSION);
        snap["bootTs"] = json!(now_epoch_ms());
        st.updated_at = Some(Instant::now());
    }
}

pub struct McpServer {
    relay: Arc<dyn RelayBackend>,
    panel_html_path: PathBuf,
    html_cache: Arc<Mutex<HtmlCache>>,
    swr_cache: Arc<SwrBootCache>,
    settings: Option<Arc<SettingsStore>>,
    client_supports_apps: OnceLock<bool>,
}

fn supports_apps(capabilities: &Value) -> bool {
    capabilities["extensions"][APPS_EXTENSION]["mimeTypes"]
        .as_array()
        .is_some_and(|types| types.iter().any(|mime| mime == APP_MIME))
}

fn valid_request(msg: &Value) -> bool {
    msg.is_object()
        && msg["jsonrpc"] == "2.0"
        && msg["method"].is_string()
        && msg
            .get("id")
            .is_none_or(|id| id.is_null() || id.is_string() || id.is_number())
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn is_app_only_tool(name: &str) -> bool {
    matches!(
        name,
        "chrome_stream_frame"
            | "chrome_stream_input"
            | "chrome_stream_launch"
            | "chrome_stream_launch_remote"
            | "chrome_stream_config"
    )
}

impl McpServer {
    #[cfg(test)]
    pub fn new(relay: Arc<dyn RelayBackend>, panel_html_path: PathBuf) -> Arc<Self> {
        Self::with_settings(relay, panel_html_path, None)
    }

    pub fn with_settings(
        relay: Arc<dyn RelayBackend>,
        panel_html_path: PathBuf,
        settings: Option<Arc<SettingsStore>>,
    ) -> Arc<Self> {
        let swr_cache = SwrBootCache::new(Arc::clone(&relay));
        Arc::new(Self {
            relay,
            panel_html_path,
            html_cache: Arc::new(Mutex::new(HtmlCache::default())),
            swr_cache,
            settings,
            client_supports_apps: OnceLock::new(),
        })
    }

    pub fn prewarm_startup(&self) {
        let html_cache = Arc::clone(&self.html_cache);
        let panel_path = self.panel_html_path.clone();
        let swr = Arc::clone(&self.swr_cache);
        let _ = thread::Builder::new()
            .name("chrome-stream-html".to_string())
            .spawn(move || {
                let _ = html_cache
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .ensure_loaded(&panel_path);
            });
        swr.prewarm_async(true);
    }

    fn apps_capable(&self) -> bool {
        self.client_supports_apps.get().copied().unwrap_or(false)
    }

    pub fn handle_message(&self, msg: &Value) -> Option<Value> {
        if !valid_request(msg) {
            return Some(error_response(Value::Null, -32600, "Invalid Request"));
        }
        let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let id = msg.get("id").cloned();
        let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));

        // JSON-RPC notifications have no `id` and expect no reply.
        let req_id = id?;

        let result = match method {
            "initialize" => {
                let ver = params
                    .get("protocolVersion")
                    .and_then(|v| v.as_str())
                    .filter(|version| SUPPORTED_PROTOCOL_VERSIONS.contains(version))
                    .unwrap_or(LATEST_PROTOCOL_VERSION);
                let client_supports_apps = *self
                    .client_supports_apps
                    .get_or_init(|| supports_apps(&params["capabilities"]));
                let mut capabilities = json!({ "tools": {}, "resources": {} });
                if client_supports_apps {
                    capabilities["extensions"] = json!({ (APPS_EXTENSION): {} });
                }
                Ok(json!({
                    "protocolVersion": ver,
                    "capabilities": capabilities,
                    "serverInfo": {
                        "name": "chrome-stream-mcp",
                        "version": APP_VERSION
                    }
                }))
            }
            "ping" => Ok(json!({})),
            "resources/list" => Ok(json!({
                "resources": [{
                    "uri": STAGE_URI,
                    "name": "Remote Cast",
                    "title": "Remote Cast",
                    "description": "Low-bandwidth adaptive screencast viewer and interactive controller for local Google Chrome tabs.",
                    "mimeType": APP_MIME,
                    "_meta": {
                        "ui": {
                            "prefersBorder": false
                        }
                    }
                }]
            })),
            "resources/read" => self.handle_read_resource(&params),
            "tools/list" => Ok(json!({
                "tools": tool_definitions(self.apps_capable())
            })),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if is_app_only_tool(name) && !self.apps_capable() {
                    Err((
                        -32602,
                        format!("Tool {name} requires MCP Apps UI capability"),
                    ))
                } else {
                    let args = params
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    Ok(dispatch_tool_with_context(
                        &self.relay,
                        Some(&self.swr_cache),
                        self.settings.as_ref(),
                        name,
                        args,
                    ))
                }
            }
            _ => Err((-32601, format!("Method not found: {method}"))),
        };

        match result {
            Ok(res) => Some(json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": res
            })),
            Err((code, message)) => Some(json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": { "code": code, "message": message }
            })),
        }
    }

    fn handle_read_resource(&self, params: &Value) -> Result<Value, (i64, String)> {
        let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
        if uri != STAGE_URI {
            return Err((-32602, format!("Unknown resource URI: {uri}")));
        }

        let mut boot_meta = self
            .apps_capable()
            .then(|| self.swr_cache.get_swr(Duration::from_millis(1200)))
            .flatten()
            .map(|bd| bd.metadata);
        if let Some(meta) = boot_meta.as_mut() {
            // Strip any frame payload from boot JSON so `resources/read` HTML stays < 65 KiB
            // and never blocks Frame-0 paint on a 100 KB base64 JPEG.
            clear_boot_frame(meta);
            if let Some(obj) = meta.as_object_mut() {
                obj.remove("imageDataUrl");
                if obj.get("bootTs").and_then(Value::as_u64).is_none() {
                    obj.insert("bootTs".to_string(), json!(now_epoch_ms()));
                }
            }
            if let Some(store) = self.settings.as_ref() {
                attach_settings_snapshot(meta, Some(store));
            }
        } else if self.apps_capable() {
            if let Some(store) = self.settings.as_ref() {
                let mut meta = json!({ "connected": false });
                attach_settings_snapshot(&mut meta, Some(store));
                boot_meta = BootSnapshot::from_relay(meta).map(|bd| bd.metadata);
            }
        }
        let html = self
            .html_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .render_metadata(&self.panel_html_path, boot_meta.as_ref())
            .map_err(|e| (-32603, e))?;

        Ok(json!({
            "contents": [{
                "uri": STAGE_URI,
                "mimeType": APP_MIME,
                "text": html,
                "_meta": {
                    "ui": {
                        "prefersBorder": false
                    }
                }
            }]
        }))
    }
}

pub fn run_stdio_server(cfg: &Config) -> Result<(), String> {
    let relay_client = RelayClient::from_config(cfg);
    let settings = Some(SettingsStore::new(cfg.data_dir.clone()));
    let server = McpServer::with_settings(
        relay_client as Arc<dyn RelayBackend>,
        cfg.panel_html.clone(),
        settings,
    );

    // Immediately pre-warm panel HTML, detached relay connection, Chrome readiness,
    // and SWR boot snapshot off the critical stdio startup path.
    server.prewarm_startup();

    #[cfg(not(test))]
    let keep_fresh = {
        let swr = Arc::clone(&server.swr_cache);
        thread::Builder::new()
            .name("chrome-stream-keepfresh".to_string())
            .spawn(move || {
                while !swr.wait_stop(KEEP_FRESH_INTERVAL) {
                    swr.refresh_keep_fresh();
                }
            })
            .ok()
    };

    let stdin = io::stdin();
    let res = run_stdio_loop(
        Arc::clone(&server),
        BufReader::new(stdin.lock()),
        BufWriter::new(io::stdout()),
    );

    #[cfg(not(test))]
    {
        server.swr_cache.stop_keep_fresh();
        if let Some(handle) = keep_fresh {
            let _ = handle.join();
        }
    }

    res
}

pub fn run_stdio_loop<R: BufRead, W: Write + Send + 'static>(
    server: Arc<McpServer>,
    mut reader: R,
    writer: W,
) -> Result<(), String> {
    let writer = Arc::new(Mutex::new(writer));
    let in_flight = Arc::new(AtomicUsize::new(0));
    let mut handles: Vec<thread::JoinHandle<()>> = Vec::new();
    let mut line = Vec::new();
    let write = |writer: &Mutex<W>, response: Value| {
        let mut output = writer.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(output, "{response}");
        let _ = output.flush();
    };

    let outcome = loop {
        match read_bounded_line(&mut reader, &mut line, MAX_MCP_REQUEST_BYTES) {
            Ok(0) => break Ok(()),
            Ok(_) => {}
            Err(err) => {
                if err.kind() == io::ErrorKind::InvalidData {
                    write(
                        &writer,
                        error_response(Value::Null, -32700, &err.to_string()),
                    );
                }
                break Err(format!("MCP stdio read error: {err}"));
            }
        }
        let Ok(msg) = serde_json::from_slice::<Value>(&line) else {
            write(&writer, error_response(Value::Null, -32700, "Parse error"));
            continue;
        };

        if !valid_request(&msg)
            || !matches!(
                msg["method"].as_str(),
                Some("resources/read" | "tools/call")
            )
        {
            if let Some(resp) = server.handle_message(&msg) {
                write(&writer, resp);
            }
            continue;
        }
        let Some(id) = msg.get("id") else { continue };
        if in_flight.load(Ordering::SeqCst) >= MAX_CONCURRENT_REQUESTS {
            write(&writer, error_response(id.clone(), -32000, "Server busy"));
            continue;
        }
        // Reclaim finished JoinHandles throughout a long-running session.
        if handles.len() >= MAX_CONCURRENT_REQUESTS {
            handles.retain(|h| !h.is_finished());
        }
        in_flight.fetch_add(1, Ordering::SeqCst);
        let srv = Arc::clone(&server);
        let wr = Arc::clone(&writer);
        let count = Arc::clone(&in_flight);
        let spawn = thread::Builder::new().spawn(move || {
            if let Some(resp) = srv.handle_message(&msg) {
                write(&wr, resp);
            }
            count.fetch_sub(1, Ordering::SeqCst);
        });
        match spawn {
            Ok(handle) => handles.push(handle),
            Err(_) => {
                in_flight.fetch_sub(1, Ordering::SeqCst);
                break Err("Unable to start MCP request worker".into());
            }
        }
    };

    for h in handles {
        let _ = h.join();
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc;

    #[derive(Clone, Default)]
    struct SharedOutput(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedOutput {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl SharedOutput {
        fn responses(&self) -> Vec<Value> {
            std::str::from_utf8(&self.0.lock().unwrap())
                .unwrap()
                .lines()
                .filter_map(|line| serde_json::from_str(line).ok())
                .collect()
        }
    }

    fn dummy_relay() -> Arc<dyn RelayBackend> {
        Arc::new(DummyRelay {
            delay_ms: 0,
            poll_attempts: AtomicUsize::new(0),
        })
    }

    fn initialize(server: &McpServer, capabilities: Value) -> Value {
        server
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "capabilities": capabilities },
            }))
            .unwrap()
    }

    fn apps_capabilities() -> Value {
        json!({ "extensions": { (APPS_EXTENSION): { "mimeTypes": [APP_MIME] } } })
    }

    struct DummyRelay {
        delay_ms: u64,
        poll_attempts: AtomicUsize,
    }

    impl RelayBackend for DummyRelay {
        fn call(&self, method: &str, params: Value, _timeout: Duration) -> Result<Value, String> {
            if self.delay_ms > 0 && matches!(method, "boot_snapshot" | "status") {
                thread::sleep(Duration::from_millis(self.delay_ms));
            }
            match method {
                "boot_snapshot" => Ok(json!({
                    "connected": true,
                    "hostname": "private-laptop.local",
                    "portFile": {
                        "exists": true,
                        "valid": true,
                        "port": 9222,
                        "path": "/var/tmp/private/DevToolsActivePort",
                        "wsUrl": "ws://127.0.0.1:9222/devtools/browser/secret-uuid"
                    },
                    "activeTargetId": "t1",
                    "tabs": [{ "targetId": "t1", "title": "Safe </script><script>alert(1)</script>", "url": "https://example.com" }],
                    "page": { "title": "Example", "url": "https://example.com", "viewportWidth": 1280, "viewportHeight": 800 },
                    "changed": false,
                    "unchanged": true,
                    "seq": 0,
                    "imageDataUrl": "",
                    "imageBytes": 0
                })),
                "status" => Ok(json!({
                    "connected": true,
                    "hostname": "private-laptop.local",
                    "portFile": { "exists": true, "valid": true, "port": 9222 },
                    "activeTargetId": "t2"
                })),
                "launch_remote" => Ok(json!({
                    "ok": true,
                    "connected": true,
                    "connectionMode": "remote",
                    "paused": false,
                    "activeTargetId": "t1",
                    "changed": true,
                    "seq": 1,
                    "frameHash": "still",
                    "imageDataUrl": "data:image/webp;base64,QUFB",
                    "imageBytes": 3,
                    "crisp": true,
                    "format": "webp",
                    "qualityApplied": params["qualityPreset"],
                })),
                "pause" => Ok(json!({
                    "ok": true,
                    "connected": true,
                    "connectionMode": "remote",
                    "paused": true,
                    "standby": true,
                    "mode": "standby",
                    "pauseEpoch": 1,
                })),
                "disconnect" => Ok(json!({ "ok": true, "connected": false })),
                "poll_frame" => {
                    assert_eq!(params["qualityPreset"], "auto");
                    let rtt_ms = params["rttMs"].as_f64().unwrap();
                    if self.poll_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                        Err("No target with given id found".into())
                    } else {
                        Ok(json!({
                            "connected": true,
                            "activeTargetId": "t2",
                            "tabs": [{ "targetId": "t2", "title": "Live", "url": "https://live.test" }],
                            "page": { "title": "Live", "url": "https://live.test", "viewportWidth": 1280, "viewportHeight": 800 },
                            "changed": true,
                            "seq": 4,
                            "imageDataUrl": "data:image/jpeg;base64,QUFB",
                            "imageBytes": 3,
                            "qualityApplied": crate::stream::profiles::resolve_profile("auto", rtt_ms).name,
                        }))
                    }
                }
                "input" if params["targetEpoch"] == 7 => Ok(json!({
                    "ok": false,
                    "staleTarget": true,
                    "needsRefresh": true,
                    "recoverable": true,
                    "connected": true,
                    "error": "The tab epoch changed. Refresh the panel before sending input again.",
                    "epoch": 8,
                })),
                _ => Ok(json!({ "ok": true, "connected": true })),
            }
        }
    }

    #[test]
    fn mcp_negotiates_only_supported_protocol_versions() {
        let server = McpServer::new(
            Arc::new(DummyRelay {
                delay_ms: 0,
                poll_attempts: AtomicUsize::new(0),
            }),
            PathBuf::new(),
        );
        for (requested, expected) in [
            ("2025-11-25", "2025-11-25"),
            ("2025-06-18", "2025-06-18"),
            ("2025-03-26", "2025-11-25"),
            ("2024-11-05", "2025-11-25"),
            ("2099-01-01", "2025-11-25"),
            ("", "2025-11-25"),
        ] {
            let reply = server
                .handle_message(&json!({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": { "protocolVersion": requested },
                }))
                .unwrap();
            assert_eq!(reply["result"]["protocolVersion"], expected);
        }
    }

    #[test]
    fn mcp_lists_app_only_tools_for_clients_that_advertise_apps() {
        let server = McpServer::new(
            Arc::new(DummyRelay {
                delay_ms: 0,
                poll_attempts: AtomicUsize::new(0),
            }),
            PathBuf::new(),
        );
        let list_tools = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        assert_eq!(
            server.handle_message(&list_tools).unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            3
        );

        for (capabilities, apps) in [
            (
                json!({ "extensions": { (APPS_EXTENSION): { "mimeTypes": [APP_MIME, "text/plain"] } } }),
                true,
            ),
            (
                json!({ "experimental": { (APPS_EXTENSION): { "mimeTypes": [APP_MIME] } } }),
                false,
            ),
            (
                json!({ "extensions": { "com.google.antigravity/ui": {} } }),
                false,
            ),
            (json!({ "ui": {} }), false),
            (json!({}), false),
            (json!({ "extensions": { (APPS_EXTENSION): {} } }), false),
            (json!({ "experimental": { (APPS_EXTENSION): {} } }), false),
            (json!({ "extensions": { (APPS_EXTENSION): null } }), false),
            (
                json!({ "ui": {}, "extensions": { (APPS_EXTENSION): { "mimeTypes": ["text/html"] }, "com.google.antigravity/ui": true } }),
                false,
            ),
        ] {
            let server = McpServer::new(dummy_relay(), PathBuf::new());
            let reply = server
                .handle_message(&json!({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": { "protocolVersion": "2025-11-25", "capabilities": capabilities },
                }))
                .unwrap();
            let extension = reply["result"]["capabilities"]["extensions"].get(APPS_EXTENSION);
            assert_eq!(extension, apps.then(|| json!({})).as_ref());

            let listing = server.handle_message(&list_tools).unwrap();
            let tools = listing["result"]["tools"].as_array().unwrap();
            let names: Vec<_> = tools
                .iter()
                .map(|tool| tool["name"].as_str().unwrap())
                .collect();
            if apps {
                assert_eq!(
                    names,
                    [
                        "chrome_stream_stage",
                        "chrome_stream_connect",
                        "chrome_stream_frame",
                        "chrome_stream_input",
                        "chrome_stream_disconnect",
                        "chrome_stream_launch",
                        "chrome_stream_config",
                    ]
                );
                assert_eq!(
                    tools[3]["inputSchema"]["properties"]["targetEpoch"]["type"],
                    "integer"
                );
                assert_eq!(tools[3]["inputSchema"]["required"], json!(["events"]));
                assert_eq!(tools[5]["_meta"]["ui"]["visibility"], json!(["app"]));
                assert_eq!(
                    tools[1]["inputSchema"]["properties"]["mode"]["enum"],
                    json!(["auto", "personal", "remote"])
                );
                assert_eq!(
                    tools[4]["inputSchema"]["properties"]["mode"]["default"],
                    "revoke"
                );
            } else {
                assert_eq!(
                    names,
                    [
                        "chrome_stream_stage",
                        "chrome_stream_connect",
                        "chrome_stream_disconnect"
                    ]
                );
            }
        }

        // Plain session (last iteration had apps=false) MUST reject app-only tools in tools/call.
        for blocked in [
            "chrome_stream_frame",
            "chrome_stream_input",
            "chrome_stream_launch",
            "chrome_stream_launch_remote",
        ] {
            let err_reply = server
                .handle_message(&json!({
                    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": { "name": blocked, "arguments": {} },
                }))
                .unwrap();
            assert_eq!(err_reply["error"]["code"], -32602);
        }

        // The first initialize freezes Apps negotiation for both kinds of session.
        initialize(&server, json!({}));
        let repeat = initialize(&server, apps_capabilities());
        assert!(repeat["result"]["capabilities"]["extensions"].is_null());
        assert_eq!(
            server.handle_message(&list_tools).unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        let server = McpServer::new(dummy_relay(), PathBuf::new());
        initialize(&server, apps_capabilities());
        let repeat = initialize(&server, json!({}));
        assert!(repeat["result"]["capabilities"]["extensions"][APPS_EXTENSION].is_object());
        let input_reply = server
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": {
                    "name": "chrome_stream_input",
                    "arguments": { "targetId": "t1", "targetEpoch": 7, "events": [{ "action": "click" }] },
                },
            }))
            .unwrap();
        let result = &input_reply["result"]["structuredContent"];
        assert_eq!(result["ok"], false);
        assert_eq!(result["staleTarget"], true);
        assert_eq!(result["epoch"], 8);
        assert_eq!(input_reply["result"]["content"][0]["text"], result["error"]);
    }

    #[test]
    fn mcp_stdio_initialize_resources_and_tools_end_to_end() {
        let dir =
            std::env::temp_dir().join(format!("chrome-stream-mcp-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let html_path = dir.join("panel.html");
        fs::write(
            &html_path,
            "<!doctype html><script>/*__CHROME_STREAM_BOOT__*/</script><div>Remote Cast</div>",
        )
        .unwrap();

        let srv = McpServer::new(
            Arc::new(DummyRelay {
                delay_ms: 0,
                poll_attempts: AtomicUsize::new(0),
            }),
            html_path,
        );
        let input = [
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": { "extensions": { (APPS_EXTENSION): { "mimeTypes": [APP_MIME] } } }
            } }).to_string(),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read", "params": { "uri": STAGE_URI } }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "chrome_stream_stage", "arguments": {} } }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": { "name": "chrome_stream_frame", "arguments": { "targetId": "t-closed", "qualityPreset": "auto", "rttMs": 820 } } }).to_string(),
        ]
        .join("\n")
            + "\n";

        let output = SharedOutput::default();
        run_stdio_loop(srv, Cursor::new(input.into_bytes()), output.clone()).unwrap();
        let responses = output.responses();
        assert_eq!(responses.len(), 6);

        let r1 = responses.iter().find(|r| r["id"] == 1).unwrap();
        assert_eq!(r1["result"]["serverInfo"]["name"], "chrome-stream-mcp");

        let r3 = responses.iter().find(|r| r["id"] == 3).unwrap();
        let html = r3["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(html.contains("window.__CHROME_STREAM_BOOT__="));
        assert!(html.contains(&format!("\"appVersion\":\"{APP_VERSION}\"")));
        // XSS escape & privacy redaction checks
        assert!(!html.contains("</script><script>alert(1)"));
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(!html.contains("private-laptop.local"));
        assert!(!html.contains("/var/tmp/private"));
        assert!(!html.contains("secret-uuid"));

        let r4 = responses.iter().find(|r| r["id"] == 4).unwrap();
        let tools = r4["result"]["tools"].as_array().unwrap();
        let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(
            tool_names,
            vec![
                "chrome_stream_stage",
                "chrome_stream_connect",
                "chrome_stream_frame",
                "chrome_stream_input",
                "chrome_stream_disconnect",
                "chrome_stream_launch",
                "chrome_stream_config",
            ]
        );
        for tool in tools {
            let desc = tool["description"].as_str().unwrap();
            assert!(
                desc.is_ascii(),
                "tool description must be clean English ASCII: {desc}"
            );
        }

        let r5 = responses.iter().find(|r| r["id"] == 5).unwrap();
        assert_eq!(r5["result"]["structuredContent"]["connected"], true);
        assert_eq!(r5["result"]["structuredContent"]["hostname"], "localhost");
        assert!(r5["result"]["structuredContent"]["portFile"]
            .get("path")
            .is_none());
        assert!(r5["result"]["structuredContent"]["portFile"]
            .get("wsUrl")
            .is_none());
        assert!(!r5["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("private-laptop"));

        let r6 = responses.iter().find(|r| r["id"] == 6).unwrap();
        let fsc = &r6["result"]["structuredContent"];
        assert_eq!(fsc["connected"], true);
        assert_eq!(fsc["recovered"], true);
        assert_eq!(fsc["activeTargetId"], "t2");
        assert_eq!(fsc["qualityApplied"], "ultra");

        // Verify handle_input measures and returns serverMs even when relay omits it
        let in_resp = dispatch_tool_with_cache(
            &(Arc::new(DummyRelay {
                delay_ms: 0,
                poll_attempts: AtomicUsize::new(0),
            }) as Arc<dyn RelayBackend>),
            None,
            "chrome_stream_input",
            json!({ "events": [{ "action": "click", "x": 10, "y": 20 }] }),
        );
        assert!(in_resp["structuredContent"]["serverMs"].as_u64().is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn advertised_tool_names_fit_antigravity_64_char_limit_and_launch_alias_works() {
        let tools = tool_definitions(true);
        let list = tools.as_array().unwrap();
        assert!(!list.is_empty());
        for tool in list {
            let name = tool["name"].as_str().unwrap();
            let full = format!("mcp_chrome-stream-mcp_chrome-stream-mcp_{name}");
            assert!(
                !full.is_empty() && full.len() <= 64,
                "tool {full} exceeds 64-char limit ({})",
                full.len()
            );
            assert!(
                full.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
                "tool {full} violates ^[a-zA-Z0-9_-]{{1,64}}$"
            );
        }
        assert!(
            !list
                .iter()
                .any(|tool| tool["name"] == "chrome_stream_launch_remote"),
            "legacy alias must not be advertised in tools/list"
        );

        let relay: Arc<dyn RelayBackend> = Arc::new(DummyRelay {
            delay_ms: 0,
            poll_attempts: AtomicUsize::new(0),
        });
        for name in ["chrome_stream_launch", "chrome_stream_launch_remote"] {
            let resp = dispatch_tool_with_cache(
                &relay,
                None,
                name,
                json!({ "qualityPreset": "high", "rttMs": 700 }),
            );
            assert_eq!(resp["structuredContent"]["connectionMode"], "remote");
        }
    }

    #[test]
    fn swr_preserves_remote_metadata_and_crisp_pixels_through_standby() {
        let relay: Arc<dyn RelayBackend> = Arc::new(DummyRelay {
            delay_ms: 0,
            poll_attempts: AtomicUsize::new(0),
        });
        let cache = SwrBootCache::new(Arc::clone(&relay));
        let launched = dispatch_tool_with_cache(
            &relay,
            Some(&cache),
            "chrome_stream_launch",
            json!({ "qualityPreset": "high", "rttMs": 700 }),
        );
        assert_eq!(launched["structuredContent"]["connectionMode"], "remote");
        assert_eq!(
            cache.get_swr(Duration::ZERO).unwrap().metadata["qualityApplied"],
            "high"
        );

        let initial = cache.get_swr(Duration::ZERO).unwrap();
        cache.update_from_tool_result(
            cache.generation(),
            &json!({
                "connected": true, "connectionMode": "remote", "activeTargetId": "t1",
                "unchanged": true, "changed": false, "crisp": true, "format": "webp",
                "seq": 1, "frameHash": "still", "imageBytes": 0, "imageDataUrl": "",
                "page": { "title": "Example", "url": "https://example.test" },
            }),
        );
        let standby = dispatch_tool_with_cache(
            &relay,
            Some(&cache),
            "chrome_stream_disconnect",
            json!({ "mode": "standby" }),
        );
        assert_eq!(standby["structuredContent"]["connected"], true);
        let snapshot = cache.get_swr(Duration::ZERO).unwrap();
        assert_eq!(snapshot.metadata["connectionMode"], "remote");
        assert_eq!(snapshot.metadata["paused"], true);
        assert_eq!(snapshot.metadata["pauseEpoch"], 1);
        assert_eq!(snapshot.metadata["crisp"], true);
        assert_eq!(snapshot.metadata["format"], "webp");
        assert_eq!(snapshot.image.as_ref(), "data:image/webp;base64,QUFB");
        assert!(Arc::ptr_eq(&snapshot.image, &initial.image));

        let before_revoke = cache.generation();
        let revoke = dispatch_tool_with_cache(
            &relay,
            Some(&cache),
            "chrome_stream_disconnect",
            json!({ "mode": "revoke" }),
        );
        assert_eq!(revoke["structuredContent"]["connected"], false);
        cache.update_from_tool_result(
            before_revoke,
            &json!({
                "connected": true, "activeTargetId": "t1", "changed": true,
                "page": { "title": "Old page", "url": "https://example.test" },
                "imageDataUrl": "data:image/webp;base64,QUFB",
            }),
        );
        let snapshot = cache.get_swr(Duration::ZERO).unwrap();
        assert!(snapshot.metadata["connectionMode"].is_null());
        assert!(snapshot.metadata["format"].is_null());
        assert_eq!(snapshot.metadata["connected"], false);
        assert_eq!(snapshot.metadata["crisp"], false);
        assert_eq!(snapshot.metadata["page"]["title"], "");
        assert_eq!(snapshot.metadata["page"]["url"], "");
        assert!(snapshot.image.is_empty());
    }

    #[test]
    fn swr_prewarm_returns_resources_read_and_stage_sub_millisecond() {
        let dir =
            std::env::temp_dir().join(format!("chrome-stream-swr-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let html_path = dir.join("panel.html");
        fs::write(
            &html_path,
            "<!doctype html><script>/*__CHROME_STREAM_BOOT__*/</script><div>Remote Cast</div>",
        )
        .unwrap();

        let srv = McpServer::new(
            Arc::new(DummyRelay {
                delay_ms: 60,
                poll_attempts: AtomicUsize::new(0),
            }),
            html_path,
        );
        initialize(&srv, apps_capabilities());
        srv.prewarm_startup();

        // Wait for startup background pre-warm to finish once
        for _ in 0..40 {
            if srv.swr_cache.is_warm() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(srv.swr_cache.is_warm());

        // Subsequent resources/read and chrome_stream_stage MUST return instantaneously without blocking 60ms!
        let t0 = Instant::now();
        let r_res = srv
            .handle_message(&json!({ "jsonrpc": "2.0", "id": 10, "method": "resources/read", "params": { "uri": STAGE_URI } }))
            .unwrap();
        let read_us = t0.elapsed().as_micros();

        let t1 = Instant::now();
        let s_res = srv
            .handle_message(&json!({ "jsonrpc": "2.0", "id": 11, "method": "tools/call", "params": { "name": "chrome_stream_stage", "arguments": {} } }))
            .unwrap();
        let stage_us = t1.elapsed().as_micros();

        assert!(r_res["result"]["contents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("window.__CHROME_STREAM_BOOT__="));
        assert_eq!(s_res["result"]["structuredContent"]["connected"], true);
        assert!(read_us < 10_000, "warm resources/read took {read_us}us");
        assert!(
            stage_us < 10_000,
            "warm chrome_stream_stage took {stage_us}us"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn swr_expired_cache_revalidates_synchronously_on_reopen() {
        struct CountingRelay {
            calls: AtomicUsize,
            connected: std::sync::atomic::AtomicBool,
        }
        impl RelayBackend for CountingRelay {
            fn call(
                &self,
                _method: &str,
                _args: Value,
                _timeout: Duration,
            ) -> Result<Value, String> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if self.connected.load(Ordering::SeqCst) {
                    Ok(json!({
                        "connected": true,
                        "activeTargetId": "t-old",
                        "tabs": [{ "targetId": "t-old", "title": "Stale Private Tab", "url": "https://private.test" }],
                        "page": { "title": "Stale Private Tab", "url": "https://private.test" },
                        "changed": true,
                        "imageDataUrl": "data:image/webp;base64,U1RBTEU=",
                    }))
                } else {
                    Ok(json!({
                        "connected": false,
                        "tabs": [],
                        "tabsHash": "empty",
                        "activeTargetId": Value::Null,
                        "page": { "title": "", "url": "" },
                        "changed": false,
                        "unchanged": true,
                        "imageDataUrl": "",
                    }))
                }
            }
        }

        let dir = std::env::temp_dir().join(format!(
            "chrome-stream-swr-expire-test-{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);
        let html_path = dir.join("panel.html");
        fs::write(&html_path, "<script>/*__CHROME_STREAM_BOOT__*/</script>").unwrap();

        let relay = Arc::new(CountingRelay {
            calls: AtomicUsize::new(0),
            connected: std::sync::atomic::AtomicBool::new(true),
        });
        let srv = McpServer::new(Arc::clone(&relay) as Arc<dyn RelayBackend>, html_path);
        initialize(&srv, apps_capabilities());

        // Populate warm cache with connected snapshot, then simulate out-of-band revoke on relay.
        let initial = srv.swr_cache.get_swr(Duration::from_millis(500)).unwrap();
        assert_eq!(initial.metadata["connected"], true);
        assert_eq!(relay.calls.load(Ordering::SeqCst), 1);
        relay.connected.store(false, Ordering::SeqCst);

        // Within <= 2500ms TTL, cache stays burst-fast without synchronous IPC.
        let burst = srv.swr_cache.get_swr(Duration::from_millis(500)).unwrap();
        assert_eq!(burst.metadata["connected"], true);
        assert_eq!(relay.calls.load(Ordering::SeqCst), 1);

        // Backdate updated_at past 2500ms -> resources/read MUST revalidate synchronously and never inject stale pixels/titles.
        {
            let mut st = srv.swr_cache.state.lock().unwrap();
            st.updated_at = Some(Instant::now() - Duration::from_millis(2600));
        }
        let read_res = srv
            .handle_message(&json!({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "resources/read",
                "params": { "uri": STAGE_URI }
            }))
            .unwrap();
        let html = read_res["result"]["contents"][0]["text"].as_str().unwrap();
        assert_eq!(relay.calls.load(Ordering::SeqCst), 2);
        assert!(html.contains("\"connected\":false"));
        assert!(!html.contains("Stale Private Tab"));
        assert!(!html.contains("U1RBTEU="));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_apps_resources_are_static_and_stage_exposes_only_status() {
        let dir = std::env::temp_dir().join(format!("csm-static-panel-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("panel.html");
        let static_html = "<script>/*__CHROME_STREAM_BOOT__*/</script>";
        fs::write(&path, static_html).unwrap();
        let server = McpServer::new(dummy_relay(), path);
        initialize(&server, json!({ "ui": {} }));
        server.swr_cache.update_from_tool_result(server.swr_cache.generation(), &json!({
            "connected": true, "activeTargetId": "demo", "tabs": [{"title": "Example"}],
            "page": {"title": "Example", "url": "https://example.test"}, "dialog": {"message": "Example"},
            "changed": true, "imageDataUrl": "data:image/webp;base64,QUFB",
        }));
        let result = server.handle_message(&json!({
            "jsonrpc": "2.0", "id": 2, "method": "resources/read", "params": { "uri": STAGE_URI },
        })).unwrap();
        assert_eq!(result["result"]["contents"][0]["text"], static_html);
        let stage = server.handle_message(&json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "chrome_stream_stage" },
        })).unwrap();
        let status = &stage["result"]["structuredContent"];
        assert_eq!(status["connected"], true);
        for key in ["tabs", "activeTargetId", "page", "dialog", "imageDataUrl"] {
            assert!(status.get(key).is_none());
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn panel_read_errors_omit_absolute_paths() {
        let path = PathBuf::from("/missing-fixture/panel.html");
        let server = McpServer::new(dummy_relay(), path.clone());
        let result = server.handle_message(&json!({
            "jsonrpc": "2.0", "id": 2, "method": "resources/read", "params": { "uri": STAGE_URI },
        })).unwrap();
        let message = result["error"]["message"].as_str().unwrap();
        assert!(message.starts_with("Failed reading panel HTML"));
        assert!(!message.contains(path.to_str().unwrap()));
    }

    #[test]
    fn stdio_distinguishes_parse_errors_invalid_requests_and_notifications() {
        let input = concat!(
            "{\n",
            "{\"jsonrpc\":\"1.0\",\"id\":1,\"method\":\"ping\"}\n",
            "null\n",
            "[]\n",
            "{\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":1}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n",
        );
        let output = SharedOutput::default();
        let server = McpServer::new(dummy_relay(), PathBuf::new());
        run_stdio_loop(server, Cursor::new(input), output.clone()).unwrap();
        let responses = output.responses();
        assert_eq!(responses.len(), 7);
        assert_eq!(
            responses[0],
            error_response(Value::Null, -32700, "Parse error")
        );
        for response in &responses[1..6] {
            assert_eq!(
                *response,
                error_response(Value::Null, -32600, "Invalid Request")
            );
        }
        assert_eq!(responses[6]["id"], 2);
        assert_eq!(responses[6]["result"], json!({}));
    }

    #[test]
    fn stdio_rejects_an_oversized_request_line() {
        let input = vec![b' '; MAX_MCP_REQUEST_BYTES + 1];
        let output = SharedOutput::default();
        let server = McpServer::new(dummy_relay(), PathBuf::new());
        let err = run_stdio_loop(server, Cursor::new(input), output.clone()).unwrap_err();
        assert!(err.contains("1048576-byte limit"));
        assert_eq!(output.responses()[0]["error"]["code"], -32700);
    }

    #[test]
    fn saturated_workers_return_busy_and_keep_stdin_controls_readable() {
        struct BlockingRelay(mpsc::Sender<()>, Mutex<mpsc::Receiver<()>>);
        impl RelayBackend for BlockingRelay {
            fn call(
                &self,
                _method: &str,
                _args: Value,
                _timeout: Duration,
            ) -> Result<Value, String> {
                self.0.send(()).unwrap();
                self.1
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                Ok(json!({ "connected": true }))
            }
        }

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let server = McpServer::new(
            Arc::new(BlockingRelay(entered_tx, Mutex::new(release_rx))),
            PathBuf::new(),
        );
        let mut input = String::new();
        for id in 0..=MAX_CONCURRENT_REQUESTS {
            input.push_str(&format!("{}\n", json!({
                "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": "chrome_stream_connect" },
            })));
        }
        input.push_str(&format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": "ping", "method": "ping" })
        ));
        let output = SharedOutput::default();
        let worker_output = output.clone();
        let worker =
            thread::spawn(move || run_stdio_loop(server, Cursor::new(input), worker_output));
        for _ in 0..MAX_CONCURRENT_REQUESTS {
            entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        let (busy, ping) = loop {
            let responses = output.responses();
            let busy = responses
                .iter()
                .find(|reply| reply["id"] == MAX_CONCURRENT_REQUESTS);
            let ping = responses.iter().find(|reply| reply["id"] == "ping");
            if let (Some(busy), Some(ping)) = (busy, ping) {
                break (busy.clone(), ping.clone());
            }
            assert!(
                Instant::now() < deadline,
                "stdio blocked behind its workers"
            );
            thread::yield_now();
        };
        assert_eq!(busy["error"]["code"], -32000);
        assert_eq!(ping["result"], json!({}));
        for _ in 0..MAX_CONCURRENT_REQUESTS {
            release_tx.send(()).unwrap();
        }
        worker.join().unwrap().unwrap();
    }

    #[test]
    fn resources_read_injects_boot_ts_and_disconnected_settings_fallback_without_auto_dialing() {
        struct FailingRelay {
            calls: AtomicUsize,
        }
        impl RelayBackend for FailingRelay {
            fn call(
                &self,
                method: &str,
                _params: Value,
                _timeout: Duration,
            ) -> Result<Value, String> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                assert!(
                    matches!(method, "boot_snapshot" | "status"),
                    "resources/read must never dial Chrome via {method}"
                );
                Err("relay down".into())
            }
        }

        let nanos = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "chrome-stream-boot-ts-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let html_path = dir.join("panel.html");
        fs::write(&html_path, "<script>/*__CHROME_STREAM_BOOT__*/</script>").unwrap();

        // 1. Warm BootSnapshot includes bootTs
        let srv_warm = McpServer::new(dummy_relay(), html_path.clone());
        initialize(&srv_warm, apps_capabilities());
        let warm_read = srv_warm
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "resources/read", "params": { "uri": STAGE_URI }
            }))
            .unwrap();
        let warm_html = warm_read["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(
            warm_html.contains("\"bootTs\":"),
            "warm boot snapshot must include bootTs: {warm_html}"
        );

        // 2. Disconnected settings fallback includes bootTs + connected:false + redacted settings
        let store = SettingsStore::new(dir.clone());
        store
            .update_patch(json!({ "lang": "zh-CN", "defaultQuality": "high" }))
            .unwrap();
        let relay = Arc::new(FailingRelay {
            calls: AtomicUsize::new(0),
        });
        let srv_fallback = McpServer::with_settings(
            Arc::clone(&relay) as Arc<dyn RelayBackend>,
            html_path,
            Some(store),
        );
        initialize(&srv_fallback, apps_capabilities());
        let fb_read = srv_fallback
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 2, "method": "resources/read", "params": { "uri": STAGE_URI }
            }))
            .unwrap();
        let fb_html = fb_read["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(fb_html.contains("\"connected\":false"));
        assert!(fb_html.contains("\"bootTs\":"));
        assert!(fb_html.contains("\"lang\":\"zh-CN\""));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resources_read_strips_image_data_url_and_stage_refreshes_stale_swr() {
        struct CountingStageRelay {
            calls: AtomicUsize,
            port: std::sync::atomic::AtomicU16,
        }
        impl RelayBackend for CountingStageRelay {
            fn call(
                &self,
                _method: &str,
                _args: Value,
                _timeout: Duration,
            ) -> Result<Value, String> {
                let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
                let port = self.port.load(Ordering::SeqCst);
                let huge_img = format!("data:image/webp;base64,{}", "A".repeat(100_000));
                Ok(json!({
                    "connected": true,
                    "connectionMode": "remote",
                    "remotePort": port,
                    "activeTargetId": "t1",
                    "tabs": [{ "targetId": "t1", "title": format!("Tab {n}"), "url": "https://example.test" }],
                    "page": { "title": format!("Tab {n}"), "url": "https://example.test" },
                    "changed": true,
                    "seq": n,
                    "frameHash": format!("fh-{n}"),
                    "imageBytes": 75_000,
                    "imageDataUrl": huge_img,
                }))
            }
        }

        let dir = std::env::temp_dir().join(format!(
            "chrome-stream-strip-img-test-{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);
        let html_path = dir.join("panel.html");
        fs::write(&html_path, "<script>/*__CHROME_STREAM_BOOT__*/</script>").unwrap();

        let relay = Arc::new(CountingStageRelay {
            calls: AtomicUsize::new(0),
            port: std::sync::atomic::AtomicU16::new(9222),
        });
        let srv = McpServer::new(Arc::clone(&relay) as Arc<dyn RelayBackend>, html_path);
        initialize(&srv, apps_capabilities());

        // Populate SWR with a 100 KB imageDataUrl, then read_resource -> must strip imageDataUrl & reset frame sync fields
        let r1 = srv
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "resources/read", "params": { "uri": STAGE_URI }
            }))
            .unwrap();
        let html = r1["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(
            html.len() < 4096,
            "boot HTML must not carry 100KB imageDataUrl: {}",
            html.len()
        );
        assert!(!html.contains("imageDataUrl"));
        assert!(html.contains("\"changed\":false"));
        assert!(html.contains("\"seq\":0"));
        assert!(html.contains("\"frameHash\":\"\""));
        assert_eq!(
            srv.swr_cache.get_swr(Duration::ZERO).unwrap().image.len(),
            100_023
        );

        // Backdate SWR past SWR_FRESH_TTL (500ms) and update relay port -> chrome_stream_stage must refresh SWR immediately
        relay.port.store(9333, Ordering::SeqCst);
        {
            let mut st = srv.swr_cache.state.lock().unwrap();
            st.updated_at = Some(Instant::now() - Duration::from_millis(600));
        }
        let stage = srv
            .handle_message(&json!({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "chrome_stream_stage", "arguments": {} }
            }))
            .unwrap();
        assert_eq!(stage["result"]["structuredContent"]["remotePort"], 9333);
        assert_eq!(relay.calls.load(Ordering::SeqCst), 2);

        let _ = fs::remove_dir_all(&dir);
    }
}
