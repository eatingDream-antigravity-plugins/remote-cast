use std::env;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    ZhCn,
}

impl Lang {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::ZhCn => "zh-CN",
        }
    }
}

/// Parses a single locale tag (`zh_CN.UTF-8`, `en-US`, `C`, etc.).
/// Returns `None` for empty or neutral POSIX locales (`C`, `C.UTF-8`, `POSIX`, `UTF-8`)
/// so resolution continues down the fallback chain.
pub fn parse_locale_tag(raw: &str) -> Option<Lang> {
    let trimmed = raw
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')' || c == ',');
    if trimmed.is_empty() {
        return None;
    }
    let base = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .split('@')
        .next()
        .unwrap_or(trimmed)
        .trim();
    if base.is_empty() {
        return None;
    }
    let low = base.to_ascii_lowercase().replace('_', "-");
    if matches!(low.as_str(), "c" | "posix" | "utf-8" | "utf8") {
        return None;
    }
    if low == "zh" || low.starts_with("zh-") || low.contains("-hans") || low.contains("-hant") {
        Some(Lang::ZhCn)
    } else {
        Some(Lang::En)
    }
}

/// Pure, deterministic language resolution following:
/// `CHROME_STREAM_LANG` -> `LC_ALL` -> `LC_MESSAGES` -> `LANG` -> macOS `AppleLanguages` -> `en`.
pub fn resolve_lang_chain(
    chrome_stream_lang: Option<&str>,
    lc_all: Option<&str>,
    lc_messages: Option<&str>,
    lang: Option<&str>,
    apple_languages: Option<&str>,
) -> Lang {
    for candidate in [chrome_stream_lang, lc_all, lc_messages, lang]
        .into_iter()
        .flatten()
    {
        if let Some(resolved) = parse_locale_tag(candidate) {
            return resolved;
        }
    }
    if let Some(raw_apple) = apple_languages {
        for line in raw_apple.lines() {
            if let Some(resolved) = parse_locale_tag(line) {
                return resolved;
            }
        }
    }
    Lang::En
}

fn cached_macos_apple_languages() -> Option<&'static str> {
    static APPLE_LANGS: OnceLock<Option<String>> = OnceLock::new();
    APPLE_LANGS
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            {
                let out = Command::new("/usr/bin/defaults")
                    .args(["read", "-g", "AppleLanguages"])
                    .output()
                    .ok()?;
                if !out.status.success() {
                    return None;
                }
                Some(String::from_utf8_lossy(&out.stdout).into_owned())
            }
            #[cfg(not(target_os = "macos"))]
            {
                None
            }
        })
        .as_deref()
}

pub fn current_lang() -> Lang {
    let csl = env::var("CHROME_STREAM_LANG").ok();
    let lc_all = env::var("LC_ALL").ok();
    let lc_msg = env::var("LC_MESSAGES").ok();
    let lang = env::var("LANG").ok();

    for v in [&csl, &lc_all, &lc_msg, &lang] {
        if let Some(s) = v.as_deref() {
            if let Some(resolved) = parse_locale_tag(s) {
                return resolved;
            }
        }
    }
    resolve_lang_chain(None, None, None, None, cached_macos_apple_languages())
}

#[cfg(test)]
pub const ALL_ERROR_CODES: &[&str] = &[
    "not_detected",
    "port_busy",
    "launch_failed",
    "chrome_missing",
    "allow_timeout",
    "allow_denied",
    "conn_lost",
    "timeout",
    "tab_changed",
    "tab_close_failed",
    "relay_busy",
    "relay_down",
    "unconfirmed",
];

/// Maps any raw backend/launcher/WebSocket/relay error string to one of the 13 canonical
/// structured `errorCode`s rendered by the panel without leaking env vars, HTTP status codes,
/// or protocol jargon.
pub fn classify_error_code(raw: &str) -> &'static str {
    let low = raw.to_ascii_lowercase();
    if low.contains("remote debugging is off")
        || low.contains("remote debugging was not detected")
        || low.contains("chrome://inspect/#remote-debugging")
        || low.contains("未检测到")
        || low.contains("还没开启远程调试")
        || low.contains("尚未开启远程调试")
    {
        return "not_detected";
    }
    if low.contains("already in use")
        || low.contains("became occupied")
        || low.contains("unoccupied loopback port")
        || low.contains("free loopback port")
    {
        return "port_busy";
    }
    if low.contains("chrome executable") || low.contains("no executable configured") {
        return "chrome_missing";
    }
    if low.contains("remote chrome") || low.contains("isolated") && low.contains("profile") {
        return "launch_failed";
    }
    if low.contains("handshake") && (low.contains("timed out") || low.contains("allow")) {
        return "allow_timeout";
    }
    if low.contains("http 101") || low.contains("switching protocols") || low.contains("declined") {
        return "allow_denied";
    }
    if low.contains("did not close the tab") {
        return "tab_close_failed";
    }
    if low.contains("tab epoch")
        || low.contains("input target")
        || low.contains("tab to close")
        || low.contains("active tab switched")
        || low.contains("event target differs")
        || low.contains("no active tab")
        || low.contains("no target with given id")
        || low.contains("target closed")
        || low.contains("target destroyed")
    {
        return "tab_changed";
    }
    if low.contains("relay busy")
        || low.contains("too many client")
        || low.contains("too many concurrent")
    {
        return "relay_busy";
    }
    if low.contains("did not confirm")
        || low.contains("invalid connection control")
        || low.contains("connection control failed")
    {
        return "unconfirmed";
    }
    if low.contains("relay")
        && (low.contains("unavailable")
            || low.contains("failed to start")
            || low.contains("unable to connect to relay")
            || low.contains("relay connection closed")
            || low.contains("spawning"))
    {
        return "relay_down";
    }
    if low.contains("timeout") || low.contains("timed out") {
        return "timeout";
    }
    "conn_lost"
}

pub fn error_message(code: &str, lang: Lang) -> &'static str {
    match (code, lang) {
        ("not_detected", Lang::En) => {
            "Chrome's remote debugging is off. Open chrome://inspect/#remote-debugging and turn it on, or open a separate Chrome."
        }
        ("not_detected", Lang::ZhCn) => {
            "Chrome 尚未开启远程调试。请打开 chrome://inspect/#remote-debugging 开启，或改用独立 Chrome。"
        }
        ("port_busy", Lang::En) => {
            "Couldn't find a free port for separate Chrome. Try again, or connect your own Chrome."
        }
        ("port_busy", Lang::ZhCn) => {
            "独立 Chrome 暂无可用端口。请重试，或改为连接本机 Chrome。"
        }
        ("launch_failed", Lang::En) => "Couldn't open separate Chrome. Try again.",
        ("launch_failed", Lang::ZhCn) => "独立 Chrome 启动失败，请重试。",
        ("chrome_missing", Lang::En) => "Couldn't find Chrome on this Mac.",
        ("chrome_missing", Lang::ZhCn) => "未在这台 Mac 上找到 Chrome。",
        ("allow_timeout", Lang::En) => {
            "Chrome didn't answer. If it asked for permission, click Allow and try again."
        }
        ("allow_timeout", Lang::ZhCn) => {
            "Chrome 没有响应。如果弹出了授权窗口，请点「允许」后重试。"
        }
        ("allow_denied", Lang::En) => {
            "Chrome declined the connection. Click Allow when it asks."
        }
        ("allow_denied", Lang::ZhCn) => "Chrome 拒绝了连接。弹出授权窗口时请点「允许」。",
        ("conn_lost", Lang::En) => "Lost connection to Chrome.",
        ("conn_lost", Lang::ZhCn) => "与 Chrome 的连接已断开。",
        ("timeout", Lang::En) => "Chrome is taking too long. Try again.",
        ("timeout", Lang::ZhCn) => "Chrome 响应超时，请重试。",
        ("tab_changed", Lang::En) => "The tab changed. Try again.",
        ("tab_changed", Lang::ZhCn) => "目标标签页已变更，请重试。",
        ("tab_close_failed", Lang::En) => "Couldn't close the tab.",
        ("tab_close_failed", Lang::ZhCn) => "关闭标签页失败。",
        ("relay_busy", Lang::En) => "Remote Cast is busy. Try again in a moment.",
        ("relay_busy", Lang::ZhCn) => "Remote Cast 正忙，请稍后再试。",
        ("relay_down", Lang::En) => {
            "Remote Cast's background service isn't running. Reopen the panel."
        }
        ("relay_down", Lang::ZhCn) => "Remote Cast 后台服务未运行，请重新打开面板。",
        ("unconfirmed", Lang::En) => {
            "No confirmation from Chrome. Check the status and try again."
        }
        ("unconfirmed", Lang::ZhCn) => "没有收到 Chrome 的确认，请查看状态后重试。",
        (_, Lang::En) => "Lost connection to Chrome.",
        (_, Lang::ZhCn) => "与 Chrome 的连接已断开。",
    }
}

pub fn chrome_not_found_error(lang: Lang) -> &'static str {
    error_message("not_detected", lang)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_language_priority_and_defaults_non_zh_to_en() {
        assert_eq!(
            resolve_lang_chain(Some("zh-CN"), Some("en_US.UTF-8"), None, None, None),
            Lang::ZhCn
        );
        assert_eq!(
            resolve_lang_chain(Some("en"), Some("zh_CN.UTF-8"), None, None, None),
            Lang::En
        );
        assert_eq!(
            resolve_lang_chain(None, Some("zh_TW.UTF-8"), None, Some("en_US.UTF-8"), None),
            Lang::ZhCn
        );
        assert_eq!(
            resolve_lang_chain(None, Some("C"), Some("POSIX"), Some("zh_CN.UTF-8"), None),
            Lang::ZhCn
        );
        assert_eq!(
            resolve_lang_chain(
                None,
                None,
                None,
                Some("ja_JP.UTF-8"),
                Some("(\"zh-Hans-CN\")")
            ),
            Lang::En
        );
        assert_eq!(
            resolve_lang_chain(
                None,
                Some("C.UTF-8"),
                None,
                None,
                Some("(\n    \"zh-Hans-CN\",\n    \"en-US\"\n)"),
            ),
            Lang::ZhCn
        );
        assert_eq!(resolve_lang_chain(None, None, None, None, None), Lang::En);
    }

    #[test]
    fn classifies_and_localizes_all_13_error_codes_without_env_or_protocol_jargon() {
        let samples = [
            ("not_detected", chrome_not_found_error(Lang::En)),
            ("port_busy", "Debug port 9222 is already in use"),
            (
                "launch_failed",
                "Remote Chrome did not become ready on 127.0.0.1:9223",
            ),
            (
                "chrome_missing",
                "Could not start a Chrome executable: not found",
            ),
            (
                "allow_timeout",
                "Timed out waiting for Chrome DevTools handshake (65s).",
            ),
            (
                "allow_denied",
                "Expected HTTP 101 Switching Protocols, got: HTTP/1.1 403",
            ),
            ("conn_lost", "Chrome CDP connection closed"),
            ("timeout", "CDP timeout on Page.navigate"),
            ("tab_changed", "The tab epoch changed"),
            ("tab_close_failed", "Chrome did not close the tab"),
            ("relay_busy", "Relay busy: too many concurrent requests"),
            ("relay_down", "Local CDP relay connection closed"),
            (
                "unconfirmed",
                "The relay did not confirm revoking the Chrome connection",
            ),
        ];
        for (expected, sample) in samples {
            assert_eq!(classify_error_code(sample), expected, "sample={sample}");
        }
        for code in ALL_ERROR_CODES {
            let en = error_message(code, Lang::En);
            let zh = error_message(code, Lang::ZhCn);
            assert!(!en.is_empty() && !zh.is_empty());
            for text in [en, zh] {
                assert!(
                    !text.contains("CHROME_STREAM_"),
                    "env leak in {code}: {text}"
                );
                assert!(
                    !text.contains("HTTP 101"),
                    "protocol leak in {code}: {text}"
                );
                assert!(!text.contains("CDP"), "CDP jargon in {code}: {text}");
            }
        }
    }
}
