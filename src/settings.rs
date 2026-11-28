use crate::config::home_dir;
use crate::local_io::{create_private_directory, effective_uid};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const DEFAULT_NEW_TAB_URL: &str = "chrome://newtab";
pub const DEFAULT_IDLE_PAUSE_SEC: u64 = 12;
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
const MAX_URL_SETTING_LEN: usize = 2048;
const MAX_PATH_SETTING_LEN: usize = 4096;
static TMP_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_auto")]
    pub lang: String,
    #[serde(default = "default_auto")]
    pub default_quality: String,
    #[serde(default = "default_auto")]
    pub default_connect_mode: String,
    #[serde(default)]
    pub bg_poll_interval_sec: i32,
    #[serde(default = "default_idle_pause_sec")]
    pub idle_pause_sec: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_tab_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_data_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wheel_coalesce_ms: Option<u32>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_last_host_theme", alias = "last_host_theme")]
    pub last_host_theme: String,
}

fn default_auto() -> String {
    "auto".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_last_host_theme() -> String {
    "dark".to_string()
}

fn default_idle_pause_sec() -> u64 {
    DEFAULT_IDLE_PAUSE_SEC
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            lang: "auto".to_string(),
            default_quality: "auto".to_string(),
            default_connect_mode: "auto".to_string(),
            bg_poll_interval_sec: 0,
            idle_pause_sec: DEFAULT_IDLE_PAUSE_SEC,
            debug_port: None,
            remote_port: None,
            new_tab_url: None,
            port_file: None,
            user_data_dir: None,
            wheel_coalesce_ms: None,
            theme: default_theme(),
            last_host_theme: default_last_host_theme(),
        }
    }
}

impl Settings {
    pub fn effective_new_tab_url(&self) -> &str {
        self.new_tab_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_NEW_TAB_URL)
    }

    pub fn effective_idle_pause(&self) -> Option<Duration> {
        (self.idle_pause_sec > 0).then(|| Duration::from_secs(self.idle_pause_sec))
    }

    pub fn validate(&mut self) -> Result<(), String> {
        self.lang = match self.lang.trim() {
            "" | "auto" => "auto".to_string(),
            "en" => "en".to_string(),
            "zh-CN" | "zh" | "zh_CN" => "zh-CN".to_string(),
            other => return Err(format!("Unsupported lang: {other}")),
        };
        self.default_quality = match self.default_quality.trim() {
            "" | "auto" => "auto".to_string(),
            "ultra" | "low" | "medium" | "high" => self.default_quality.trim().to_string(),
            other => return Err(format!("Unsupported defaultQuality: {other}")),
        };
        self.default_connect_mode = match self.default_connect_mode.trim() {
            "" | "auto" => "auto".to_string(),
            "personal" | "remote" => self.default_connect_mode.trim().to_string(),
            other => return Err(format!("Unsupported defaultConnectMode: {other}")),
        };
        if self.bg_poll_interval_sec != -1
            && self.bg_poll_interval_sec != 0
            && !(5..=300).contains(&self.bg_poll_interval_sec)
        {
            return Err("bgPollIntervalSec must be -1, 0, or 5..=300".to_string());
        }
        if self.idle_pause_sec != 0 && !(5..=300).contains(&self.idle_pause_sec) {
            return Err("idlePauseSec must be 0 or 5..=300".to_string());
        }
        if self.debug_port == Some(0) {
            return Err("debugPort must be nonzero".to_string());
        }
        if self.remote_port == Some(0) {
            return Err("remotePort must be nonzero".to_string());
        }
        if let Some(ref url) = self.new_tab_url {
            let trimmed = url.trim();
            if trimmed.is_empty() {
                self.new_tab_url = None;
            } else {
                if trimmed.len() > MAX_URL_SETTING_LEN {
                    return Err(format!(
                        "newTabUrl exceeds {MAX_URL_SETTING_LEN}-byte limit"
                    ));
                }
                let low = trimmed.to_ascii_lowercase();
                let allowed = low.starts_with("chrome://")
                    || low.starts_with("about:")
                    || low.starts_with("http://")
                    || low.starts_with("https://");
                if !allowed || trimmed.chars().any(char::is_control) {
                    return Err(
                        "newTabUrl must use chrome://, about:, http://, or https://".to_string()
                    );
                }
                self.new_tab_url = Some(trimmed.to_string());
            }
        }
        for (name, field) in [
            ("portFile", &mut self.port_file),
            ("userDataDir", &mut self.user_data_dir),
        ] {
            if let Some(ref raw_path) = *field {
                let trimmed = raw_path.trim();
                if trimmed.is_empty() {
                    *field = None;
                } else {
                    if trimmed.len() > MAX_PATH_SETTING_LEN || trimmed.chars().any(char::is_control)
                    {
                        return Err(format!(
                            "{name} must be at most {MAX_PATH_SETTING_LEN} bytes without control characters"
                        ));
                    }
                    *field = Some(trimmed.to_string());
                }
            }
        }
        if let Some(ms) = self.wheel_coalesce_ms {
            if !(20..=500).contains(&ms) {
                return Err("wheelCoalesceMs must be 20..=500".to_string());
            }
        }
        self.theme = match self.theme.trim() {
            "" | "system" => "system".to_string(),
            "light" => "light".to_string(),
            "dark" => "dark".to_string(),
            other => return Err(format!("Unsupported theme: {other}")),
        };
        self.last_host_theme = match self.last_host_theme.trim() {
            "" | "dark" => "dark".to_string(),
            "light" => "light".to_string(),
            other => return Err(format!("Unsupported lastHostTheme: {other}")),
        };
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileFingerprint {
    mtime_ns: i128,
    size: u64,
    ino: u64,
}

fn open_settings_file(path: &Path) -> io::Result<(File, fs::Metadata)> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "settings.json is not a regular file",
        ));
    }
    if meta.uid() != effective_uid() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "settings.json must be owned by the current user",
        ));
    }
    Ok((file, meta))
}

fn read_fingerprint(path: &Path) -> io::Result<Option<FileFingerprint>> {
    match open_settings_file(path) {
        Ok((_, meta)) => {
            let mtime_ns = (meta.mtime() as i128) * 1_000_000_000i128 + (meta.mtime_nsec() as i128);
            Ok(Some(FileFingerprint {
                mtime_ns,
                size: meta.len(),
                ino: meta.ino(),
            }))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

fn parse_settings_bytes(raw: &str) -> Result<(Map<String, Value>, Settings), String> {
    let val: Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid settings JSON: {e}"))?;
    let Some(obj) = val.as_object().cloned() else {
        return Err("settings.json must be a JSON object".to_string());
    };
    let mut parsed: Settings =
        serde_json::from_value(Value::Object(obj.clone())).map_err(|e| e.to_string())?;
    parsed.validate()?;
    Ok((obj, parsed))
}

fn read_settings_file(path: &Path) -> Result<(Map<String, Value>, Settings), String> {
    let (file, meta) =
        open_settings_file(path).map_err(|e| format!("Failed opening settings.json: {e}"))?;
    if meta.len() > MAX_SETTINGS_BYTES {
        return Err("settings.json exceeds maximum size".to_string());
    }
    let mut raw = String::new();
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|e| format!("Failed reading settings.json: {e}"))?;
    if raw.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("settings.json exceeds maximum size".to_string());
    }
    parse_settings_bytes(&raw)
}

pub fn abbreviate_home_path(path: &Path) -> String {
    let home = home_dir();
    if let Ok(rel) = path.strip_prefix(&home) {
        if rel.as_os_str().is_empty() {
            return "~".to_string();
        }
        return format!("~/{}", rel.to_string_lossy());
    }
    path.to_string_lossy().to_string()
}

struct SettingsState {
    settings: Settings,
    fingerprint: Option<FileFingerprint>,
    gen: u64,
    error: Option<String>,
}

pub struct SettingsStore {
    data_dir: PathBuf,
    path: PathBuf,
    lock_path: PathBuf,
    display_path: String,
    state: Mutex<SettingsState>,
}

impl SettingsStore {
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        let path = data_dir.join("settings.json");
        let lock_path = data_dir.join("settings.lock");
        let display_path = abbreviate_home_path(&path);
        let store = Arc::new(Self {
            data_dir,
            path,
            lock_path,
            display_path,
            state: Mutex::new(SettingsState {
                settings: Settings::default(),
                fingerprint: None,
                gen: 1,
                error: None,
            }),
        });
        store.reload_if_changed();
        store
    }

    /// Checks `(mtime_ns, size, ino)` and hot-reloads valid changes.
    /// Fail-closed on live syntax/validation errors: keeps last-known-good settings and sets
    /// `settingsError` without overwriting or quarantining the file on disk.
    pub fn reload_if_changed(&self) -> bool {
        let fp = match read_fingerprint(&self.path) {
            Ok(fp) => fp,
            Err(_) => {
                let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
                let changed = st.error.as_deref() != Some("invalid_settings");
                if changed {
                    st.error = Some("invalid_settings".to_string());
                    st.gen += 1;
                }
                return changed;
            }
        };

        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if st.fingerprint == fp {
            return false;
        }
        st.fingerprint = fp;
        match fp {
            None => {
                let changed = st.settings != Settings::default() || st.error.is_some();
                st.settings = Settings::default();
                st.error = None;
                if changed {
                    st.gen += 1;
                }
                changed
            }
            Some(_) => match read_settings_file(&self.path) {
                Ok((_, next)) => {
                    let changed = st.settings != next || st.error.is_some();
                    st.settings = next;
                    st.error = None;
                    if changed {
                        st.gen += 1;
                    }
                    changed
                }
                Err(_) => {
                    // Fail-closed: preserve last-known-good settings in memory, never overwrite disk.
                    st.error = Some("invalid_settings".to_string());
                    st.gen += 1;
                    true
                }
            },
        }
    }

    pub fn current(&self) -> Settings {
        self.reload_if_changed();
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .settings
            .clone()
    }

    pub fn snapshot(&self) -> Value {
        self.reload_if_changed();
        let st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let mut out = json!({
            "settings": st.settings,
            "settingsPath": self.display_path,
            "settingsGen": st.gen,
        });
        if let Some(ref err) = st.error {
            out["settingsError"] = json!(err);
        }
        out
    }

    pub fn update_patch(&self, patch: Value) -> Result<Value, String> {
        let Some(patch_obj) = patch.as_object() else {
            return Err("Settings patch must be a JSON object".to_string());
        };
        create_private_directory(&self.data_dir)
            .map_err(|e| format!("Could not prepare settings directory: {e}"))?;

        let lock = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&self.lock_path)
            .map_err(|e| format!("Could not open settings lock: {e}"))?;
        if !lock
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.uid() == effective_uid())
        {
            return Err("Unsafe settings lock file".to_string());
        }
        // SAFETY: lock owns the descriptor; released on drop.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(format!(
                "Could not lock settings file: {}",
                io::Error::last_os_error()
            ));
        }
        let _ = lock.set_permissions(fs::Permissions::from_mode(0o600));

        let mut merged = match read_fingerprint(&self.path) {
            Ok(Some(_)) => read_settings_file(&self.path)?.0,
            Ok(None) => Map::new(),
            Err(err) => return Err(format!("Could not inspect settings.json: {err}")),
        };

        const ALLOWED_KEYS: &[&str] = &[
            "lang",
            "defaultQuality",
            "defaultConnectMode",
            "bgPollIntervalSec",
            "idlePauseSec",
            "debugPort",
            "remotePort",
            "newTabUrl",
            "portFile",
            "userDataDir",
            "wheelCoalesceMs",
            "theme",
            "lastHostTheme",
            "last_host_theme",
        ];

        for (k, v) in patch_obj {
            if !ALLOWED_KEYS.contains(&k.as_str()) {
                return Err(format!("Unknown setting key: {k}"));
            }
            let canon_key = if k == "last_host_theme" {
                merged.remove("last_host_theme");
                "lastHostTheme".to_string()
            } else {
                k.clone()
            };
            if v.is_null() {
                merged.remove(&canon_key);
            } else {
                merged.insert(canon_key, v.clone());
            }
        }

        let mut next: Settings = serde_json::from_value(Value::Object(merged.clone()))
            .map_err(|e| format!("Invalid setting value: {e}"))?;
        next.validate()?;

        // Normalize canonical validated values back into merged object while preserving unknown keys.
        let canonical = serde_json::to_value(&next).map_err(|e| e.to_string())?;
        if let Some(canon_obj) = canonical.as_object() {
            for k in [
                "lang",
                "defaultQuality",
                "defaultConnectMode",
                "bgPollIntervalSec",
                "idlePauseSec",
                "theme",
                "lastHostTheme",
            ] {
                if let Some(val) = canon_obj.get(k) {
                    merged.insert(k.to_string(), val.clone());
                }
            }
        }

        let mut body = serde_json::to_string_pretty(&Value::Object(merged))
            .map_err(|e| format!("Failed serializing settings: {e}"))?;
        body.push('\n');
        if body.len() as u64 > MAX_SETTINGS_BYTES {
            return Err(format!(
                "settings.json exceeds {MAX_SETTINGS_BYTES}-byte limit"
            ));
        }

        let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp_path = self
            .data_dir
            .join(format!(".settings.json.tmp.{}.{seq}", std::process::id()));
        let write_res = (|| -> io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp_path)?;
            file.write_all(body.as_bytes())?;
            file.sync_all()?;
            fs::rename(&tmp_path, &self.path)?;
            Ok(())
        })();
        if let Err(err) = write_res {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Failed writing settings.json: {err}"));
        }

        let fp = read_fingerprint(&self.path).ok().flatten();
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.settings = next;
        st.fingerprint = fp;
        st.error = None;
        st.gen += 1;
        let out = json!({
            "settings": st.settings,
            "settingsPath": self.display_path,
            "settingsGen": st.gen,
        });
        drop(lock);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "chrome-stream-settings-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_preserves_unknown_keys_and_hot_reloads_fail_closed() {
        let dir = tmp_dir("hotreload");
        let store = SettingsStore::new(dir.clone());
        assert_eq!(store.current().effective_new_tab_url(), "chrome://newtab");
        assert_eq!(store.current().idle_pause_sec, 12);

        // Seed file with an advanced + unknown custom key
        let settings_path = dir.join("settings.json");
        fs::write(
            &settings_path,
            "{\n  \"lang\": \"zh-CN\",\n  \"newTabUrl\": \"https://example.com\",\n  \"customAgentFlag\": true\n}\n",
        )
        .unwrap();
        assert!(store.reload_if_changed());
        let cur = store.current();
        assert_eq!(cur.lang, "zh-CN");
        assert_eq!(cur.effective_new_tab_url(), "https://example.com");

        // Partial GUI patch preserves customAgentFlag & newTabUrl and writes 0600
        let updated = store
            .update_patch(json!({ "defaultQuality": "ultra", "bgPollIntervalSec": 15 }))
            .unwrap();
        assert_eq!(updated["settings"]["defaultQuality"], "ultra");
        assert_eq!(updated["settings"]["bgPollIntervalSec"], 15);
        assert_eq!(updated["settings"]["newTabUrl"], "https://example.com");
        let mode = fs::metadata(&settings_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let raw_on_disk: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(raw_on_disk["customAgentFlag"], true);

        // Live syntax error fails closed: keeps last-known-good settings & never deletes/overwrites file
        let broken = "{ not valid json";
        let tmp_bad = dir.join(".bad.tmp");
        fs::write(&tmp_bad, broken).unwrap();
        fs::rename(&tmp_bad, &settings_path).unwrap();

        assert!(store.reload_if_changed());
        let snap = store.snapshot();
        assert_eq!(snap["settingsError"], "invalid_settings");
        assert_eq!(snap["settings"]["defaultQuality"], "ultra");
        assert_eq!(fs::read_to_string(&settings_path).unwrap(), broken);

        // Fixing file on disk clears settingsError on next reload
        let tmp_ok = dir.join(".ok.tmp");
        fs::write(&tmp_ok, "{\"lang\":\"en\",\"idlePauseSec\":30}\n").unwrap();
        fs::rename(&tmp_ok, &settings_path).unwrap();
        assert!(store.reload_if_changed());
        let snap2 = store.snapshot();
        assert!(snap2.get("settingsError").is_none());
        assert_eq!(snap2["settings"]["lang"], "en");
        assert_eq!(snap2["settings"]["idlePauseSec"], 30);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_oversized_settings_and_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = tmp_dir("oversized");
        let store = SettingsStore::new(dir.clone());
        store.update_patch(json!({ "lang": "en" })).unwrap();

        // String field caps reject oversized newTabUrl / portFile / userDataDir before writing
        let too_long_url = format!("https://example.com/{}", "a".repeat(2048));
        assert!(store
            .update_patch(json!({ "newTabUrl": too_long_url }))
            .is_err());
        let too_long_path = format!("/tmp/{}", "b".repeat(4096));
        assert!(store
            .update_patch(json!({ "portFile": too_long_path }))
            .is_err());
        assert!(store
            .update_patch(json!({ "userDataDir": "/tmp/bad\npath" }))
            .is_err());

        // >64 KiB serialized body is rejected BEFORE writing, preventing persistent self-DoS
        let settings_path = dir.join("settings.json");
        let near_limit = "x".repeat(65 * 1024);
        fs::write(
            &settings_path,
            format!("{{\"lang\":\"en\",\"bigBlob\":\"{near_limit}\"}}\n"),
        )
        .unwrap();
        // Verify oversized file on disk is rejected on read
        assert!(store.reload_if_changed());
        assert_eq!(store.snapshot()["settingsError"], "invalid_settings");

        // Now write valid 63 KiB file and attempt a patch that would push serialized body >64 KiB
        let padded = "y".repeat(64 * 1024 - 100);
        fs::write(
            &settings_path,
            format!("{{\"lang\":\"en\",\"pad\":\"{padded}\"}}\n"),
        )
        .unwrap();
        assert!(store.reload_if_changed());
        assert!(store.snapshot().get("settingsError").is_none());
        let err = store
            .update_patch(
                json!({ "newTabUrl": format!("https://example.com/{}", "z".repeat(500)) }),
            )
            .unwrap_err();
        assert!(err.contains("exceeds"));
        // Disk file remains valid and readable after rejected patch
        assert!(!store.reload_if_changed());
        assert!(store.snapshot().get("settingsError").is_none());

        // Symlink settings.json is rejected via O_NOFOLLOW
        let target = dir.join("real.json");
        fs::write(&target, "{\"lang\":\"zh-CN\"}\n").unwrap();
        fs::remove_file(&settings_path).unwrap();
        symlink(&target, &settings_path).unwrap();
        assert!(store.reload_if_changed());
        assert_eq!(store.snapshot()["settingsError"], "invalid_settings");
        assert_eq!(store.current().lang, "en");

        let _ = fs::remove_dir_all(&dir);
    }
}
