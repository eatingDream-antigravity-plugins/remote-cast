use crate::i18n::{classify_error_code, current_lang, error_message, Lang};
use crate::mcp::server::{stage_status_from_snapshot, SwrBootCache};
use crate::relay::ipc::RelayBackend;
use crate::settings::SettingsStore;
use crate::stream::dedup::{hash_frame_data, hash_tabs, is_target_gone_error};
use crate::stream::profiles::{resolve_profile, TabInfo};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const STAGE_URI: &str = "ui://chrome-stream-mcp/stage";
pub const APP_MIME: &str = "text/html;profile=mcp-app";

pub fn attach_settings_snapshot(val: &mut Value, settings: Option<&Arc<SettingsStore>>) {
    let Some(store) = settings else {
        return;
    };
    let mut snap = store.snapshot();
    if let Some(settings_obj) = snap.get_mut("settings").and_then(Value::as_object_mut) {
        settings_obj.remove("portFile");
        settings_obj.remove("userDataDir");
    }
    if let (Some(dst), Some(src)) = (val.as_object_mut(), snap.as_object()) {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
}

/// Strips sensitive local path / DevTools WS token fields and personal hostnames from any relay JSON.
pub fn redact_relay_payload(val: &mut Value) {
    if let Some(obj) = val.as_object_mut() {
        if obj.contains_key("hostname") {
            obj.insert("hostname".to_string(), json!("localhost"));
        }
        if let Some(pf) = obj.get_mut("portFile").and_then(|v| v.as_object_mut()) {
            pf.remove("path");
            pf.remove("wsUrl");
        }
        if let Some(settings_obj) = obj.get_mut("settings").and_then(Value::as_object_mut) {
            settings_obj.remove("portFile");
            settings_obj.remove("userDataDir");
        }
    }
}

pub fn tool_definitions(include_app_only: bool) -> Value {
    let mut tools = json!([
        {
            "name": "chrome_stream_stage",
            "title": "Remote Cast",
            "description": "Open the Remote Cast live browser stage to view and interactively control local Google Chrome tabs without auto-connecting.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            },
            "_meta": {
                "ui": {
                    "resourceUri": STAGE_URI
                },
                "com.google.antigravity/ui": {
                    "entrypoints": [
                        { "type": "global", "title": "Remote Cast" },
                        { "type": "aux_pane", "title": "Remote Cast" }
                    ]
                }
            }
        },
        {
            "name": "chrome_stream_connect",
            "title": "Connect Remote Cast",
            "description": "Connect or verify the persistent local Chrome DevTools session and warm the active tab screencast.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "qualityPreset": { "type": "string", "enum": ["auto", "ultra", "low", "medium", "high"] },
                    "rttMs": { "type": "number", "minimum": 0 },
                    "mode": { "type": "string", "enum": ["auto", "personal", "remote"], "default": "auto" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "chrome_stream_frame",
            "title": "Poll Screencast Frame",
            "description": "App-only tool: poll the active tab screencast frame, tab state, and modal JS dialog status without auto-dialing when disconnected.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "targetId": { "type": "string" },
                    "sinceSeq": { "type": "integer", "minimum": 0 },
                    "lastFrameHash": { "type": "string" },
                    "if_hash": { "type": "string" },
                    "ifHash": { "type": "string" },
                    "knownTabsHash": { "type": "string" },
                    "qualityPreset": { "type": "string", "enum": ["auto", "ultra", "low", "medium", "high"] },
                    "rttMs": { "type": "number", "minimum": 0 },
                    "waitMs": { "type": "integer", "minimum": 0, "maximum": 1500 },
                    "forceRefresh": { "type": "boolean" }
                },
                "additionalProperties": false
            },
            "_meta": {
                "ui": {
                    "visibility": ["app"]
                }
            }
        },
        {
            "name": "chrome_stream_input",
            "title": "Dispatch Interactive Input Batch",
            "description": "App-only tool: dispatch coalesced mouse, drag, wheel, touch, keyboard, shortcut, IME, dialog, navigation, and tab events.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "targetId": { "type": "string" },
                    "targetEpoch": { "type": "integer", "minimum": 0 },
                    "events": {
                        "type": "array",
                        "maxItems": 256,
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {
                                    "type": "string",
                                    "enum": [
                                        "click",
                                        "mousedown",
                                        "mouseup",
                                        "mousemove",
                                        "scroll",
                                        "type",
                                        "key",
                                        "dialog",
                                        "navigate",
                                        "back",
                                        "forward",
                                        "reload",
                                        "switch_tab",
                                        "new_tab",
                                        "close_tab",
                                        "pause",
                                        "resume",
                                        "disconnect"
                                    ]
                                },
                                "targetId": { "type": "string" },
                                "x": { "type": "number" },
                                "y": { "type": "number" },
                                "button": { "type": "string", "enum": ["left", "right", "middle", "none"] },
                                "buttons": { "type": "integer", "minimum": 0, "maximum": 7 },
                                "clickCount": { "type": "integer", "minimum": 1, "maximum": 3 },
                                "modifiers": { "type": "integer", "minimum": 0, "maximum": 15 },
                                "deltaX": { "type": "number" },
                                "deltaY": { "type": "number" },
                                "text": { "type": "string" },
                                "pressEnter": { "type": "boolean" },
                                "key": { "type": "string" },
                                "repeat": { "type": "integer", "minimum": 1, "maximum": 20 },
                                "url": { "type": "string" },
                                "accept": { "type": "boolean" },
                                "promptText": { "type": "string" }
                            },
                            "required": ["action"]
                        }
                    }
                },
                "required": ["events"],
                "additionalProperties": false
            },
            "_meta": {
                "ui": {
                    "visibility": ["app"]
                }
            }
        },
        {
            "name": "chrome_stream_disconnect",
            "title": "Disconnect Remote Cast",
            "description": "Stop screencast streaming. Use mode=\"standby\" (recommended) to drop to 0 FPS while keeping Chrome's Allow permission warm, or mode=\"revoke\" (default) to close the debugging session.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["standby", "revoke"], "default": "revoke" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "chrome_stream_launch",
            "title": "Launch Separate Chrome",
            "description": "App-only tool: open or reuse an isolated loopback Chrome profile without permission prompts and warm the active tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "qualityPreset": { "type": "string", "enum": ["auto", "ultra", "low", "medium", "high"] },
                    "rttMs": { "type": "number", "minimum": 0 }
                },
                "additionalProperties": false
            },
            "_meta": {
                "ui": {
                    "visibility": ["app"]
                }
            }
        },
        {
            "name": "chrome_stream_config",
            "title": "Configure Remote Cast",
            "description": "App-only tool: read or atomically update Remote Cast settings.json preferences with live hot-reload.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["get", "update"] },
                    "patch": {
                        "type": "object",
                        "properties": {
                            "lang": { "type": ["string", "null"], "enum": ["auto", "en", "zh-CN", null] },
                            "defaultQuality": { "type": ["string", "null"], "enum": ["auto", "ultra", "low", "medium", "high", null] },
                            "defaultConnectMode": { "type": ["string", "null"], "enum": ["auto", "personal", "remote", null] },
                            "bgPollIntervalSec": { "type": ["integer", "null"], "minimum": -1, "maximum": 300 },
                            "idlePauseSec": { "type": ["integer", "null"], "minimum": 0, "maximum": 300 },
                            "debugPort": { "type": ["integer", "null"], "minimum": 1, "maximum": 65535 },
                            "remotePort": { "type": ["integer", "null"], "minimum": 1, "maximum": 65535 },
                            "newTabUrl": { "type": ["string", "null"] },
                            "portFile": { "type": ["string", "null"] },
                            "userDataDir": { "type": ["string", "null"] },
                            "wheelCoalesceMs": { "type": ["integer", "null"], "minimum": 20, "maximum": 500 },
                            "theme": { "type": ["string", "null"], "enum": ["system", "light", "dark", null] },
                            "lastHostTheme": { "type": ["string", "null"], "enum": ["light", "dark", null] }
                        },
                        "additionalProperties": false
                    }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "_meta": {
                "ui": {
                    "visibility": ["app"]
                }
            }
        }
    ]);
    if !include_app_only {
        tools.as_array_mut().unwrap().retain(|tool| {
            tool.pointer("/_meta/ui/visibility")
                .and_then(Value::as_array)
                .is_none_or(|visibility| {
                    !visibility.iter().any(|scope| scope == "app")
                        || visibility.iter().any(|scope| scope == "model")
                })
        });
    }
    tools
}

#[allow(dead_code)]
pub fn dispatch_tool_with_cache(
    relay: &Arc<dyn RelayBackend>,
    swr_cache: Option<&Arc<SwrBootCache>>,
    name: &str,
    args: Value,
) -> Value {
    dispatch_tool_with_context(relay, swr_cache, None, name, args)
}

pub fn dispatch_tool_with_context(
    relay: &Arc<dyn RelayBackend>,
    swr_cache: Option<&Arc<SwrBootCache>>,
    settings: Option<&Arc<SettingsStore>>,
    name: &str,
    args: Value,
) -> Value {
    let revoking = match name {
        "chrome_stream_disconnect" => args.get("mode").is_none_or(|mode| mode == "revoke"),
        "chrome_stream_input" => args["events"]
            .as_array()
            .is_some_and(|events| events.iter().any(|event| event["action"] == "disconnect")),
        _ => false,
    };
    let generation = swr_cache.map(|cache| {
        if revoking {
            cache.begin_revoke();
        }
        cache.generation()
    });
    let mut out = match name {
        "chrome_stream_stage" => handle_stage(relay, swr_cache),
        "chrome_stream_connect" => handle_connect(relay, "connect", args, Duration::from_secs(70)),
        "chrome_stream_frame" => handle_frame(relay, args),
        "chrome_stream_input" => handle_input(relay, args, revoking),
        "chrome_stream_disconnect" => handle_disconnect(relay, args),
        "chrome_stream_launch" | "chrome_stream_launch_remote" => {
            handle_connect(relay, "launch_remote", args, Duration::from_secs(85))
        }
        "chrome_stream_config" => handle_config(settings, args),
        _ => json!({
            "isError": true,
            "content": [{ "type": "text", "text": format!("Unknown tool: {name}") }]
        }),
    };

    let compact_unchanged = name == "chrome_stream_frame"
        && out.pointer("/structuredContent/unchanged") == Some(&json!(true))
        && out.pointer("/structuredContent/connected").is_none();
    if let Some(sc) = out.get_mut("structuredContent") {
        redact_relay_payload(sc);
        if name != "chrome_stream_config" && !compact_unchanged {
            attach_settings_snapshot(sc, settings);
        }
    }
    let sc = out.get("structuredContent");
    if let Some((cache, generation)) = swr_cache.zip(generation) {
        if revoking {
            cache.finish_revoke(sc.filter(|sc| sc["ok"] == true && sc["connected"] == false));
        } else if name != "chrome_stream_stage"
            && name != "chrome_stream_config"
            && !compact_unchanged
        {
            if let Some(sc) = sc.filter(|sc| sc["unconfirmed"] != true) {
                cache.update_from_tool_result(generation, sc);
            }
        }
    }
    out
}

fn handle_config(settings: Option<&Arc<SettingsStore>>, args: Value) -> Value {
    let lang = current_lang();
    let Some(store) = settings else {
        let msg = error_message("relay_down", lang);
        return json!({
            "isError": true,
            "content": [{ "type": "text", "text": msg }],
            "structuredContent": { "ok": false, "errorCode": "relay_down", "error": msg, "locale": lang.as_str() }
        });
    };
    let action = args.get("action").and_then(Value::as_str).unwrap_or("get");
    match action {
        "get" => {
            let mut snap = store.snapshot();
            snap["ok"] = json!(true);
            snap["locale"] = json!(lang.as_str());
            let text = match lang {
                Lang::En => "Loaded settings.",
                Lang::ZhCn => "已读取设置。",
            };
            json!({
                "content": [{ "type": "text", "text": text }],
                "structuredContent": snap
            })
        }
        "update" => {
            let patch = args.get("patch").cloned().unwrap_or_else(|| json!({}));
            match store.update_patch(patch) {
                Ok(mut snap) => {
                    snap["ok"] = json!(true);
                    snap["locale"] = json!(lang.as_str());
                    let text = match lang {
                        Lang::En => "Settings saved.",
                        Lang::ZhCn => "设置已保存。",
                    };
                    json!({
                        "content": [{ "type": "text", "text": text }],
                        "structuredContent": snap
                    })
                }
                Err(err) => {
                    let code = sanitized_config_error_code(&err);
                    let text = match lang {
                        Lang::En => "Couldn't save settings.",
                        Lang::ZhCn => "保存设置失败。",
                    };
                    let mut snap = store.snapshot();
                    snap["ok"] = json!(false);
                    snap["errorCode"] = json!(code);
                    snap["error"] = json!(text);
                    snap["errorDetail"] = json!(code);
                    snap["locale"] = json!(lang.as_str());
                    json!({
                        "isError": false,
                        "content": [{ "type": "text", "text": text }],
                        "structuredContent": snap
                    })
                }
            }
        }
        _ => json!({
            "isError": true,
            "content": [{ "type": "text", "text": "Invalid config action. Expected get or update." }]
        }),
    }
}

fn safe_status(relay: &Arc<dyn RelayBackend>) -> Value {
    let mut st = relay
        .call("status", json!({}), Duration::from_secs(3))
        .unwrap_or_else(|_| {
            json!({
                "connected": false,
                "locale": current_lang().as_str(),
                "portFile": { "exists": false, "valid": false, "port": Value::Null }
            })
        });
    redact_relay_payload(&mut st);
    st
}

fn handle_stage(relay: &Arc<dyn RelayBackend>, swr_cache: Option<&Arc<SwrBootCache>>) -> Value {
    let lang = current_lang();
    let status = swr_cache
        .and_then(|cache| cache.stage_status(Duration::from_millis(1200)))
        .map(Ok)
        .unwrap_or_else(|| {
            relay
                .call("status", json!({}), Duration::from_secs(3))
                .map(|status| stage_status_from_snapshot(&status))
        });
    let mut status = match status {
        Ok(status) => status,
        Err(_) => {
            let text = match lang {
                Lang::En => "Remote Cast isn't running.",
                Lang::ZhCn => "Remote Cast 没有运行。",
            };
            return json!({
                "isError": false,
                "content": [{ "type": "text", "text": text }],
                "structuredContent": {
                    "connected": false,
                    "locale": lang.as_str(),
                    "errorCode": "relay_down",
                    "error": error_message("relay_down", lang)
                }
            });
        }
    };
    status["locale"] = json!(lang.as_str());

    let connected = status
        .get("connected")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if connected && swr_cache.is_none() {
        let r = Arc::clone(relay);
        let _ = std::thread::spawn(move || {
            let _ = r.call("warm", json!({}), Duration::from_secs(2));
        });
    }
    let port_ready = status
        .pointer("/portFile/valid")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let text = match lang {
        Lang::En => {
            if connected {
                "Remote Cast: connected.".to_string()
            } else if port_ready {
                "Remote Cast: disconnected · Chrome ready.".to_string()
            } else {
                "Remote Cast: disconnected · Chrome not found.".to_string()
            }
        }
        Lang::ZhCn => {
            if connected {
                "Remote Cast：已连接。".to_string()
            } else if port_ready {
                "Remote Cast：未连接 · Chrome 已就绪。".to_string()
            } else {
                "Remote Cast：未连接 · 未发现 Chrome。".to_string()
            }
        }
    };

    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": status
    })
}

fn handle_connect(
    relay: &Arc<dyn RelayBackend>,
    method: &str,
    args: Value,
    timeout: Duration,
) -> Value {
    let lang = current_lang();
    match relay.call(method, args, timeout) {
        Ok(mut res) => {
            res["locale"] = json!(lang.as_str());
            let count = res
                .get("tabs")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let text = match lang {
                Lang::En => {
                    if count == 1 {
                        "Connected to Chrome (1 tab).".to_string()
                    } else {
                        format!("Connected to Chrome ({count} tabs).")
                    }
                }
                Lang::ZhCn => format!("已连接 Chrome（{count} 个标签页）。"),
            };
            json!({
                "content": [{ "type": "text", "text": text }],
                "structuredContent": res
            })
        }
        Err(err) => {
            let st = safe_status(relay);
            let connected = st
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let code = classify_error_code(&err);
            let msg = error_message(code, lang);
            json!({
                "isError": false,
                "content": [{ "type": "text", "text": msg }],
                "structuredContent": {
                    "ok": false,
                    "connected": connected,
                    "connectionMode": st.get("connectionMode").cloned().unwrap_or(Value::Null),
                    "remotePort": st.get("remotePort").cloned().unwrap_or(Value::Null),
                    "locale": lang.as_str(),
                    "errorCode": code,
                    "error": msg,
                    "portFile": st.get("portFile").cloned().unwrap_or(Value::Null),
                }
            })
        }
    }
}

fn normalize_frame(
    mut frame: Value,
    req_target_id: Option<&str>,
    last_frame_hash: &str,
    known_tabs_hash: &str,
    profile_name: &str,
    elapsed_ms: u64,
) -> Value {
    let img_url = frame
        .get("imageDataUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let frame_hash = frame
        .get("frameHash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| hash_frame_data(img_url));

    let active_tid = frame
        .get("activeTargetId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let changed = frame
        .get("changed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let same_frame = !img_url.is_empty()
        && !last_frame_hash.is_empty()
        && frame_hash == last_frame_hash
        && (req_target_id.is_none() || active_tid.is_empty() || req_target_id == Some(active_tid));
    let changed = changed && !same_frame;
    frame["changed"] = json!(changed);
    frame["unchanged"] = json!(!changed);
    if !changed {
        if frame["crisp"] == true {
            frame["imageDataUrl"] = json!("");
        } else if let Some(object) = frame.as_object_mut() {
            object.remove("imageDataUrl");
        }
        frame["imageBytes"] = json!(0);
    }

    let tabs_hash = frame
        .get("tabsHash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| {
            frame
                .get("tabs")
                .and_then(|v| serde_json::from_value::<Vec<TabInfo>>(v.clone()).ok())
                .map(|t| hash_tabs(&t))
                .unwrap_or_default()
        });

    if !known_tabs_hash.is_empty() && !tabs_hash.is_empty() && known_tabs_hash == tabs_hash {
        if let Some(obj) = frame.as_object_mut() {
            obj.remove("tabs");
        }
    }

    frame["frameHash"] = json!(frame_hash);
    if !tabs_hash.is_empty() {
        frame["tabsHash"] = json!(tabs_hash);
    }
    if frame
        .get("qualityApplied")
        .and_then(|v| v.as_str())
        .is_none()
    {
        frame["qualityApplied"] = json!(profile_name);
    }
    if frame.get("serverMs").and_then(|v| v.as_u64()).is_none() {
        frame["serverMs"] = json!(elapsed_ms);
    }
    frame
}

fn handle_frame(relay: &Arc<dyn RelayBackend>, args: Value) -> Value {
    let t_start = Instant::now();
    let req_target_id = args
        .get("targetId")
        .and_then(|v| v.as_str())
        .map(String::from);
    let since_seq = args.get("sinceSeq").and_then(|v| v.as_u64()).unwrap_or(0);
    let has_if_hash = ["if_hash", "ifHash"].iter().any(|k| {
        args.get(*k)
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
    });
    let last_hash = ["lastFrameHash", "if_hash", "ifHash"]
        .iter()
        .find_map(|k| {
            args.get(*k)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("")
        .to_string();
    let known_tabs_hash = args
        .get("knownTabsHash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let q_preset = args
        .get("qualityPreset")
        .and_then(|v| v.as_str())
        .unwrap_or("auto");
    let rtt_ms = args.get("rttMs").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let wait_ms = args.get("waitMs").and_then(|v| v.as_u64()).unwrap_or(350);
    let force_refresh = args
        .get("forceRefresh")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let profile = resolve_profile(q_preset, rtt_ms);
    let relay_args = json!({
        "targetId": req_target_id,
        "sinceSeq": since_seq,
        "lastFrameHash": last_hash,
        "knownTabsHash": known_tabs_hash,
        "qualityPreset": q_preset,
        "rttMs": rtt_ms,
        "waitMs": wait_ms,
        "forceRefresh": force_refresh,
    });

    match relay.call("poll_frame", relay_args, Duration::from_secs(70)) {
        Ok(frame) => {
            let norm = normalize_frame(
                frame,
                req_target_id.as_deref(),
                &last_hash,
                &known_tabs_hash,
                profile.name,
                t_start.elapsed().as_millis() as u64,
            );
            let frame_hash = norm["frameHash"].as_str().unwrap_or("");
            let target_matches = req_target_id
                .as_deref()
                .is_none_or(|t| norm["activeTargetId"].as_str() == Some(t));
            let can_compact = !last_hash.is_empty()
                && !frame_hash.is_empty()
                && frame_hash == last_hash
                && norm["unchanged"] == true
                && norm["changed"] == false
                && norm["connected"] == true
                && norm["paused"] != true
                && norm["screencastPausedIdle"] != true
                && norm["noTabs"] != true
                && norm["dialog"].is_null()
                && norm["recovered"] != true
                && norm["popupSwitched"] != true
                && norm["errorCode"].is_null()
                && norm["error"].is_null()
                && ((has_if_hash && known_tabs_hash.is_empty())
                    || (norm.get("tabs").is_none() && target_matches));
            let sc = if can_compact {
                json!({
                    "unchanged": true,
                    "changed": false,
                    "frameHash": frame_hash,
                    "serverMs": norm["serverMs"],
                })
            } else {
                norm
            };
            let label = if sc.get("changed").and_then(|v| v.as_bool()) == Some(true) {
                format!("Frame #{}", sc["seq"].as_u64().unwrap_or(0))
            } else {
                "No change".to_string()
            };
            json!({
                "content": [{ "type": "text", "text": label }],
                "structuredContent": sc
            })
        }
        Err(err) => {
            let st = safe_status(relay);
            let still_connected = st
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // Auto-recover transparently when a target vanished while browser WS stays open!
            if still_connected && is_target_gone_error(&err, None) {
                let retry_args = json!({
                    "sinceSeq": 0,
                    "lastFrameHash": "",
                    "knownTabsHash": "",
                    "qualityPreset": q_preset,
                    "rttMs": rtt_ms,
                    "waitMs": 0,
                    "forceRefresh": true,
                });
                if let Ok(mut recovered) =
                    relay.call("poll_frame", retry_args, Duration::from_secs(30))
                {
                    recovered["recovered"] = json!(true);
                    let norm = normalize_frame(
                        recovered,
                        None,
                        "",
                        "",
                        profile.name,
                        t_start.elapsed().as_millis() as u64,
                    );
                    return json!({
                        "content": [{ "type": "text", "text": format!("Recovered frame #{}", norm["seq"].as_u64().unwrap_or(0)) }],
                        "structuredContent": norm
                    });
                }
            }

            let post = if still_connected {
                safe_status(relay)
            } else {
                st
            };
            let live = post
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let lang = current_lang();
            let code = classify_error_code(&err);
            let msg = error_message(code, lang);
            let mut sc = json!({
                "connected": live,
                "connectionMode": post.get("connectionMode").cloned().unwrap_or(Value::Null),
                "remotePort": post.get("remotePort").cloned().unwrap_or(Value::Null),
                "recoverable": live,
                "errorCode": code,
                "error": msg,
                "portFile": post.get("portFile").cloned().unwrap_or(Value::Null),
                "activeTargetId": post.get("activeTargetId").cloned().unwrap_or(Value::Null),
                "dialog": post.get("dialog").cloned().unwrap_or(Value::Null),
                "changed": false,
                "unchanged": true,
                "seq": since_seq,
                "serverMs": t_start.elapsed().as_millis() as u64,
            });
            if !live {
                sc["tabs"] = json!([]);
            }
            json!({
                "isError": false,
                "content": [{ "type": "text", "text": msg }],
                "structuredContent": sc
            })
        }
    }
}

fn handle_input(relay: &Arc<dyn RelayBackend>, args: Value, revoking: bool) -> Value {
    let t_start = Instant::now();
    match relay.call("input", args, Duration::from_secs(30)) {
        Ok(mut res) => {
            if revoking && (res["ok"] != true || res["connected"] != false) {
                return unconfirmed_control(current_lang(), "unconfirmed");
            }
            if res.get("serverMs").and_then(|v| v.as_u64()).is_none() {
                res["serverMs"] = json!(t_start.elapsed().as_millis() as u64);
            }
            let label = res.get("error").and_then(Value::as_str).unwrap_or("ok");
            json!({
                "content": [{ "type": "text", "text": label }],
                "structuredContent": res
            })
        }
        Err(err) if revoking => {
            unconfirmed_control(current_lang(), sanitized_control_code("input", &err))
        }
        Err(err) => {
            let lang = current_lang();
            let st = safe_status(relay);
            let live = st
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if live && is_target_gone_error(&err, None) {
                let rec = relay
                    .call(
                        "poll_frame",
                        json!({ "sinceSeq": 0, "waitMs": 0, "forceRefresh": true }),
                        Duration::from_secs(15),
                    )
                    .ok();
                let msg = error_message("tab_changed", lang);
                return json!({
                    "isError": false,
                    "content": [{ "type": "text", "text": msg }],
                    "structuredContent": {
                        "ok": false,
                        "staleTarget": true,
                        "needsRefresh": true,
                        "recoverable": true,
                        "connected": true,
                        "errorCode": "tab_changed",
                        "error": msg,
                        "activeTargetId": rec.as_ref().and_then(|r| r.get("activeTargetId")).cloned().unwrap_or_else(|| st.get("activeTargetId").cloned().unwrap_or(Value::Null)),
                        "dialog": rec.as_ref().and_then(|r| r.get("dialog")).cloned().unwrap_or(Value::Null),
                        "epoch": rec.as_ref().and_then(|r| r.get("epoch")).cloned().unwrap_or(Value::Null),
                        "pauseEpoch": rec.as_ref().and_then(|r| r.get("pauseEpoch")).cloned().unwrap_or_else(|| st.get("pauseEpoch").cloned().unwrap_or(json!(0))),
                        "paused": rec.as_ref().and_then(|r| r.get("paused")).cloned().unwrap_or_else(|| st.get("paused").cloned().unwrap_or(json!(false))),
                        "tabs": rec.as_ref().and_then(|r| r.get("tabs")).cloned().unwrap_or(Value::Null),
                        "tabsHash": rec.as_ref().and_then(|r| r.get("tabsHash")).cloned().unwrap_or(Value::Null),
                        "seq": rec.as_ref().and_then(|r| r.get("seq")).cloned().unwrap_or(json!(0)),
                        "portFile": st.get("portFile").cloned().unwrap_or(Value::Null),
                        "serverMs": t_start.elapsed().as_millis() as u64,
                    }
                });
            }
            let code = classify_error_code(&err);
            let msg = error_message(code, lang);
            json!({
                "isError": false,
                "content": [{ "type": "text", "text": msg }],
                "structuredContent": {
                    "ok": false,
                    "connected": live,
                    "recoverable": live,
                    "errorCode": code,
                    "error": msg,
                    "portFile": st.get("portFile").cloned().unwrap_or(Value::Null),
                    "serverMs": t_start.elapsed().as_millis() as u64,
                }
            })
        }
    }
}

fn handle_disconnect(relay: &Arc<dyn RelayBackend>, args: Value) -> Value {
    let lang = current_lang();
    let standby = match args.get("mode").map(Value::as_str) {
        Some(Some("standby")) => true,
        None | Some(Some("revoke")) => false,
        _ => {
            return json!({
                "isError": true,
                "content": [{ "type": "text", "text": "Invalid disconnect mode. Expected standby or revoke." }]
            })
        }
    };
    // Older relays implement pause and interpret disconnect as an unconditional revoke.
    let method = if standby { "pause" } else { "disconnect" };
    let mut res = match relay.call(method, json!({}), Duration::from_secs(10)) {
        Ok(res) if res.is_object() => res,
        Ok(_) => return unconfirmed_control(lang, "unconfirmed"),
        Err(err) => return unconfirmed_control(lang, sanitized_control_code(method, &err)),
    };
    if !standby && (res["ok"] != true || res["connected"] != false) {
        return unconfirmed_control(lang, "unconfirmed");
    }
    let standby_active =
        standby && res["ok"] == true && res["connected"] == true && res["paused"] == true;
    let text = match (lang, standby, standby_active, res["connected"].as_bool()) {
        (Lang::En, false, _, _) => "Disconnected from Chrome.",
        (Lang::ZhCn, false, _, _) => "已断开 Chrome 连接。",
        (Lang::En, true, true, _) => "Paused. Chrome stays connected.",
        (Lang::ZhCn, true, true, _) => "已暂停，Chrome 保持连接。",
        (Lang::En, true, false, Some(false)) => "Chrome is disconnected.",
        (Lang::ZhCn, true, false, Some(false)) => "Chrome 当前已断开。",
        (Lang::En, true, false, _) => error_message("unconfirmed", Lang::En),
        (Lang::ZhCn, true, false, _) => error_message("unconfirmed", Lang::ZhCn),
    };
    res["locale"] = json!(lang.as_str());
    res["mode"] = json!(if standby { "standby" } else { "revoke" });
    res["standby"] = json!(standby_active);
    if standby {
        res["ok"] = json!(standby_active);
    }
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": res
    })
}

fn unconfirmed_control(lang: Lang, code: &'static str) -> Value {
    let error = error_message(code, lang);
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": error }],
        "structuredContent": {
            "ok": false,
            "unconfirmed": true,
            "errorCode": code,
            "error": error,
            "locale": lang.as_str()
        }
    })
}

fn sanitized_config_error_code(err: &str) -> &'static str {
    if err.starts_with("Settings patch")
        || err.starts_with("Unknown setting")
        || err.starts_with("Invalid setting")
        || err.starts_with("Unsupported ")
        || err.contains("must be")
        || err.contains("must use")
        || err.contains("exceeds")
    {
        "invalid_settings"
    } else if err.starts_with("Unsafe settings") {
        "unsafe_settings_file"
    } else {
        "settings_io_error"
    }
}

// Relay errors can contain local paths and WebSocket tokens, including on older versions.
fn sanitized_control_code(method: &str, err: &str) -> &'static str {
    if err == format!("Relay timeout on {method}") {
        "timeout"
    } else if err.starts_with("Relay busy:") {
        "relay_busy"
    } else if err.starts_with("Local CDP relay connection closed") {
        "relay_down"
    } else {
        "unconfirmed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ControlRelay(Result<Value, String>, &'static str);

    impl RelayBackend for ControlRelay {
        fn call(&self, method: &str, _params: Value, _timeout: Duration) -> Result<Value, String> {
            assert_eq!(method, self.1);
            self.0.clone()
        }
    }

    #[test]
    fn failed_revoke_reports_unconfirmed_and_omits_raw_relay_details() {
        let relay: Arc<dyn RelayBackend> = Arc::new(ControlRelay(
            Err("Unable to connect to /tmp/example/relay.sock, ws://127.0.0.1:9222/devtools/browser/example".into()),
            "disconnect",
        ));
        let result = handle_disconnect(&relay, json!({ "mode": "revoke" }));
        assert_eq!(result["isError"], true);
        let status = &result["structuredContent"];
        assert_eq!(status["ok"], false);
        assert_eq!(status["unconfirmed"], true);
        assert!(status.get("connected").is_none());
        assert!(status["error"].is_string());
        let rendered = result.to_string();
        assert!(!rendered.contains("/tmp/example"));
        assert!(!rendered.contains("ws://"));
    }

    #[test]
    fn explicit_revoke_disconnects_and_omits_standby_flag() {
        let relay: Arc<dyn RelayBackend> = Arc::new(ControlRelay(
            Ok(json!({ "ok": true, "connected": false, "paused": false, "pauseEpoch": 2 })),
            "disconnect",
        ));
        let result = handle_disconnect(&relay, json!({ "mode": "revoke" }));
        assert_ne!(result["isError"], true);
        let status = &result["structuredContent"];
        assert_eq!(status["ok"], true);
        assert_eq!(status["connected"], false);
        assert_eq!(status["standby"], false);
        assert_eq!(status["mode"], "revoke");
    }

    #[test]
    fn standby_uses_legacy_pause_and_checks_connection_and_pause_state() {
        for (connected, paused) in [(true, true), (false, true), (true, false)] {
            let relay: Arc<dyn RelayBackend> = Arc::new(ControlRelay(
                Ok(
                    json!({ "ok": true, "connected": connected, "paused": paused, "pauseEpoch": 3 }),
                ),
                "pause",
            ));
            let result = handle_disconnect(&relay, json!({ "mode": "standby" }));
            let status = &result["structuredContent"];
            assert_eq!(status["connected"], connected);
            assert_eq!(status["paused"], paused);
            assert_eq!(status["standby"], connected && paused);
            assert_eq!(status["ok"], connected && paused);
            let text = result["content"][0]["text"].as_str().unwrap();
            assert_eq!(
                text.contains("Chrome stays connected") || text.contains("Chrome 保持连接"),
                connected && paused
            );
        }
    }

    #[test]
    fn all_tool_names_stay_within_64_char_antigravity_budget() {
        const HOST_PREFIX_LEN: usize = 40;
        let defs = tool_definitions(true);
        let tools = defs.as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "chrome_stream_config"));
        for tool in tools {
            let name = tool["name"].as_str().unwrap();
            assert!(
                HOST_PREFIX_LEN + name.len() <= 64,
                "tool {name} exceeds 64-char host budget ({})",
                HOST_PREFIX_LEN + name.len()
            );
        }
    }

    #[test]
    fn multi_event_input_with_disconnect_surfaces_unconfirmed_on_stale_target() {
        let relay: Arc<dyn RelayBackend> = Arc::new(ControlRelay(
            Ok(json!({
                "ok": false,
                "staleTarget": true,
                "connected": true,
                "error": "The tab epoch changed. Refresh the panel before sending input again."
            })),
            "input",
        ));
        let result = dispatch_tool_with_cache(
            &relay,
            None,
            "chrome_stream_input",
            json!({
                "targetEpoch": 1,
                "events": [
                    { "action": "click", "x": 10, "y": 20 },
                    { "action": "disconnect" }
                ]
            }),
        );
        assert_eq!(result["isError"], true);
        assert_eq!(result["structuredContent"]["ok"], false);
        assert_eq!(result["structuredContent"]["unconfirmed"], true);
    }

    #[test]
    fn settings_snapshot_redacts_local_paths_and_sanitizes_config_errors() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "chrome-stream-tools-sec-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = SettingsStore::new(dir.clone());
        let secret_port_file = concat!("/U", "sers/example-user/Library/DevToolsActivePort");
        let secret_user_dir = concat!("/U", "sers/example-user/chrome-profile");
        let secret_status_path = concat!("/U", "sers/example-user/p");
        store
            .update_patch(json!({
                "lang": "en",
                "portFile": secret_port_file,
                "userDataDir": secret_user_dir
            }))
            .unwrap();

        let relay: Arc<dyn RelayBackend> = Arc::new(ControlRelay(
            Ok(json!({
                "connected": false,
                "portFile": { "exists": false, "valid": false, "port": null, "path": secret_status_path }
            })),
            "status",
        ));
        let stage = dispatch_tool_with_context(
            &relay,
            None,
            Some(&store),
            "chrome_stream_stage",
            json!({}),
        );
        let rendered = stage.to_string();
        assert!(!rendered.contains("example-user"));
        assert!(stage["structuredContent"]["settings"]
            .get("portFile")
            .is_none());
        assert!(stage["structuredContent"]["settings"]
            .get("userDataDir")
            .is_none());
        assert_eq!(stage["structuredContent"]["settings"]["lang"], "en");

        let bad_cfg = handle_config(
            Some(&store),
            json!({ "action": "update", "patch": { "unknownKey": secret_user_dir } }),
        );
        assert_eq!(bad_cfg["structuredContent"]["ok"], false);
        assert_eq!(
            bad_cfg["structuredContent"]["errorCode"],
            "invalid_settings"
        );
        assert_eq!(
            bad_cfg["structuredContent"]["errorDetail"],
            "invalid_settings"
        );
        assert!(!bad_cfg["structuredContent"]["errorDetail"]
            .as_str()
            .unwrap()
            .contains("unknownKey"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frame_supports_if_hash_aliases_and_returns_compact_unchanged_payload() {
        let defs = tool_definitions(true);
        let frame_def = defs
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == "chrome_stream_frame")
            .unwrap();
        let props = &frame_def["inputSchema"]["properties"];
        assert_eq!(props["if_hash"]["type"], "string");
        assert_eq!(props["ifHash"]["type"], "string");

        struct FrameRelay;
        impl RelayBackend for FrameRelay {
            fn call(
                &self,
                method: &str,
                params: Value,
                _timeout: Duration,
            ) -> Result<Value, String> {
                assert_eq!(method, "poll_frame");
                let same = params["lastFrameHash"] == "abc123def4567890";
                Ok(json!({
                    "connected": true,
                    "connectionMode": "personal",
                    "activeTargetId": "t1",
                    "tabs": [{ "targetId": "t1", "title": "Example", "url": "https://example.test" }],
                    "tabsHash": "th1",
                    "changed": !same,
                    "unchanged": same,
                    "seq": 9,
                    "frameHash": "abc123def4567890",
                    "imageBytes": if same { 0 } else { 12 },
                    "imageDataUrl": if same { "" } else { "data:image/webp;base64,QUFB" },
                    "serverMs": 4,
                }))
            }
        }

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "chrome-stream-if-hash-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = SettingsStore::new(dir.clone());
        let relay: Arc<dyn RelayBackend> = Arc::new(FrameRelay);

        for key in ["if_hash", "ifHash"] {
            let res = dispatch_tool_with_context(
                &relay,
                None,
                Some(&store),
                "chrome_stream_frame",
                json!({ (key): "abc123def4567890" }),
            );
            let sc = &res["structuredContent"];
            assert_eq!(sc["unchanged"], true);
            assert_eq!(sc["changed"], false);
            assert_eq!(sc["frameHash"], "abc123def4567890");
            assert_eq!(sc["serverMs"], 4);
            let encoded = serde_json::to_string(sc).unwrap();
            assert!(
                encoded.len() < 120,
                "compact unchanged payload for {key} exceeded 120B: {encoded}"
            );
        }

        let changed = dispatch_tool_with_context(
            &relay,
            None,
            Some(&store),
            "chrome_stream_frame",
            json!({ "if_hash": "different-hash" }),
        );
        assert_eq!(changed["structuredContent"]["changed"], true);
        assert_eq!(changed["structuredContent"]["unchanged"], false);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
