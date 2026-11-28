import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";
import { assertPanelInvariants, checkEnNoCjk, checkI18nParity, HARD_MAX_BYTES, WARN_BYTES } from "../kit/guard.ts";
import { I18N } from "../i18n.ts";
import { mapBridgeErrorKey } from "../net-policy.ts";
import type { FramePayload } from "../net-policy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const panelDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(panelDir, "..");

interface MockElement {
  tagName: string;
  style: {
    setProperty(): void;
    colorScheme: string;
    backgroundColor: string;
    transform: string;
    left: string;
    top: string;
  };
  dataset: Record<string, string>;
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  textContent: string;
  value: string;
  title: string;
  className: string;
  classList: {
    toggle(c: string, force?: boolean): boolean;
    add(c: string): void;
    remove(c: string): void;
    contains(c: string): boolean;
  };
  id: string;
  readonly firstChild: MockElement | null;
  readonly lastChild: MockElement | null;
  readonly nextSibling: MockElement | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(ev: string, fn: (arg?: any) => void): void;
  removeEventListener(ev: string, fn: (arg?: any) => void): void;
  querySelector(): MockElement;
  querySelectorAll(sel: string): MockElement[];
  children: MockElement[];
  append(...items: Array<MockElement | null>): void;
  appendChild(it: MockElement | null): MockElement | null;
  replaceChildren(...items: Array<MockElement | null>): void;
  insertBefore(it: MockElement | null): MockElement | null;
  remove(): void;
  closest(): null;
  focus(): void;
  select(): void;
  getContext(): { drawImage(): void };
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number };
  clientWidth: number;
  clientHeight: number;
  listeners: Map<string, Array<(arg?: any) => void>>;
}

interface PostedMessage {
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

function bootPanel(
  boot: FramePayload = {},
  {
    navLang = "en-US",
    hostLocale = "",
    storage,
    visibilityState = "visible",
    deferConnect = false,
  }: {
    navLang?: string;
    hostLocale?: string;
    storage?: Map<string, string>;
    visibilityState?: "visible" | "hidden";
    deferConnect?: boolean;
  } = {}
) {
  const html = fs.readFileSync(path.join(panelDir, "dist", "panel.html"), "utf8");
  const match = html.match(/<script>\/\*__CHROME_STREAM_BOOT__\*\/([\s\S]*?)<\/script>/);
  assert.ok(match, "built panel.html must contain single inline script");

  const els = new Map<string, MockElement>();
  const mkEl = (tag = "div"): MockElement => {
    const attrs = new Map<string, string>();
    const listeners = new Map<string, Array<(arg?: any) => void>>();
    const kids: MockElement[] = [];
    const classes = new Set<string>();
    let _id = "";
    const node: MockElement = {
      tagName: tag.toUpperCase(),
      style: { setProperty() {}, colorScheme: "", backgroundColor: "", transform: "", left: "", top: "" },
      dataset: {},
      hidden: false,
      disabled: false,
      open: false,
      textContent: "",
      value: "",
      title: "",
      get className() { return [...classes].join(" "); },
      set className(v: string) { classes.clear(); String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      classList: {
        toggle(c: string, force?: boolean) { const on = force !== undefined ? !!force : !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
        add(c: string) { classes.add(c); },
        remove(c: string) { classes.delete(c); },
        contains(c: string) { return classes.has(c); },
      },
      get id() { return _id; },
      set id(v: string) { _id = String(v || ""); if (_id) els.set(_id, node); },
      get firstChild() { return kids[0] || null; },
      get lastChild() { return kids[kids.length - 1] || null; },
      get nextSibling() { return null; },
      setAttribute(k: string, v: string) { attrs.set(k, String(v)); },
      getAttribute(k: string) { return attrs.get(k) ?? null; },
      addEventListener(ev: string, fn: (arg?: any) => void) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev)!.push(fn); },
      removeEventListener(ev: string, fn: (arg?: any) => void) { listeners.set(ev, (listeners.get(ev) || []).filter((f) => f !== fn)); },
      querySelector() { return mkEl(); },
      querySelectorAll(sel: string) {
        const out: MockElement[] = [];
        const walk = (n: MockElement) => {
          for (const c of n?.children || []) {
            if (sel === "[data-i],[data-a],[data-p],[data-t]" && (c.dataset?.i || c.dataset?.a || c.dataset?.p || c.dataset?.t)) out.push(c);
            else if (sel === "[data-k],[data-sc]" && (c.dataset?.k || c.dataset?.sc)) out.push(c);
            walk(c);
          }
        };
        walk(node);
        return out;
      },
      children: kids,
      append(...items: Array<MockElement | null>) { for (const it of items) it && kids.push(it); },
      appendChild(it: MockElement | null) { if (it) kids.push(it); return it; },
      replaceChildren(...items: Array<MockElement | null>) { kids.length = 0; node.append(...items); },
      insertBefore(it: MockElement | null) { if (it) kids.push(it); return it; },
      remove() {},
      closest() { return null; },
      focus() {},
      select() {},
      getContext() { return { drawImage() {} }; },
      getBoundingClientRect() { return { left: 0, right: 400, top: 0, bottom: 300, width: 400, height: 300 }; },
      clientWidth: 400,
      clientHeight: 300,
      listeners,
    };
    return node;
  };

  const rootEl = mkEl("html");
  const doc = {
    ...mkEl("document"),
    documentElement: rootEl,
    body: mkEl("body"),
    head: mkEl("head"),
    visibilityState,
    getElementById(id: string) { if (!els.has(id)) { const n = mkEl(id); n.id = id; } return els.get(id)!; },
    createElement(t: string) { return mkEl(t); },
    createElementNS(_ns: string, t: string) { return mkEl(t); },
    createTextNode(t: string) { return { nodeType: 3, textContent: String(t) }; },
    createDocumentFragment() { return mkEl("frag"); },
  };
  const posted: PostedMessage[] = [];
  const winListeners = new Map<string, Array<(ev: unknown) => void>>();
  const win = {
    parent: { postMessage(msg: PostedMessage) { posted.push(msg); } },
    addEventListener(ev: string, fn: (ev: unknown) => void) { if (!winListeners.has(ev)) winListeners.set(ev, []); winListeners.get(ev)!.push(fn); },
    removeEventListener(ev: string, fn: (ev: unknown) => void) { winListeners.set(ev, (winListeners.get(ev) || []).filter((f) => f !== fn)); },
    innerWidth: 480,
    innerHeight: 720,
  };
  let disposed = false;
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduledDelays: number[] = [];
  const scheduleTimer = (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (disposed) return 0 as unknown as ReturnType<typeof setTimeout>;
    if (typeof ms === "number") scheduledDelays.push(ms);
    const id = setTimeout(() => { activeTimers.delete(id); if (!disposed) fn(...args); }, ms);
    id.unref?.();
    activeTimers.add(id);
    return id;
  };
  const cancelTimer = (id: ReturnType<typeof setTimeout>) => { activeTimers.delete(id); clearTimeout(id); };
  let nowMs = 10_000;
  const ctxGlobals: Record<string, unknown> = {
    window: win,
    document: doc,
    navigator: { language: navLang, platform: "MacIntel", clipboard: { writeText: async () => {} } },
    performance: { now: () => nowMs },
    console,
    requestAnimationFrame: (fn: () => void) => scheduleTimer(fn, 0),
    cancelAnimationFrame: cancelTimer,
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    Image: class {},
    Map, Set, Array, Object, Math, JSON, RegExp, Promise, Error, Number, String, Boolean,
    Date: { now: () => nowMs },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    __CHROME_STREAM_BOOT__: boot,
    setTimeout: scheduleTimer,
    clearTimeout: cancelTimer,
  };
  if (storage) {
    ctxGlobals.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
    };
  }
  const ctx = vm.createContext(ctxGlobals);
  vm.runInContext(match[1], ctx);

  const initReq = posted.find((m) => m.method === "ui/initialize");
  const msgHandler = winListeners.get("message")?.[0]!;
  const resolveConnect = () => {
    msgHandler({
      source: win.parent,
      data: {
        jsonrpc: "2.0",
        id: initReq!.id,
        result: {
          protocolVersion: "2026-01-26",
          hostContext: { theme: "dark", ...(hostLocale ? { locale: hostLocale } : {}) },
          hostCapabilities: { serverTools: {} },
        },
      },
    });
  };
  if (!deferConnect) resolveConnect();

  const cleanup = () => {
    disposed = true;
    for (const id of activeTimers) clearTimeout(id);
    activeTimers.clear();
  };
  return {
    els, posted, msgHandler, win, doc, winListeners, activeTimers, scheduledDelays,
    resolveConnect, setNow: (v: number) => { nowMs = v; }, cleanup,
  };
}

describe("Remote Cast panel kit invariants & Wave 2 regressions", () => {
  it("passes Panel Kit invariants, i18n EN/ZH parity, EN no-CJK, and Lucid Indigo logo check", () => {
    const html = fs.readFileSync(path.join(panelDir, "dist", "panel.html"), "utf8");
    const report = assertPanelInvariants(html, {
      maxBytes: HARD_MAX_BYTES,
      hardMaxBytes: HARD_MAX_BYTES,
      warnBytes: WARN_BYTES,
      bootPlaceholder: "/*__CHROME_STREAM_BOOT__*/",
    });
    assert.equal(report.ok, true);
    assert.ok(report.bytes <= HARD_MAX_BYTES);
    assert.ok(html.includes("base-uri 'none'"), "CSP must include base-uri 'none'");
    assert.ok(html.includes("form-action 'none'"), "CSP must include form-action 'none'");

    const parity = checkI18nParity(I18N.en, I18N["zh-CN"]);
    assert.equal(parity.ok, true, `i18n parity issues: ${JSON.stringify(parity)}`);
    const enCjk = checkEnNoCjk(I18N.en);
    assert.equal(enCjk.ok, true, `EN strings contain CJK: ${JSON.stringify(enCjk.errors)}`);

    const logo = fs.readFileSync(path.join(repoDir, "assets", "logo.svg"), "utf8");
    assert.ok(logo.includes("#0B0D12") && logo.includes("#6895FF"), "logo.svg must use Lucid Indigo palette");

    const plugin = JSON.parse(fs.readFileSync(path.join(repoDir, "plugin.json"), "utf8")) as { version: string };
    assert.ok(!html.includes(plugin.version), "built panel.html must not bake plugin.json version");
  });

  it("reads runtime appVersion / relayVersion from boot payload for ui/initialize", () => {
    const h1 = bootPanel({ connected: false, appVersion: "9.8.7", relayVersion: "9.8.6" });
    try {
      const init1 = h1.posted.find((m) => m.method === "ui/initialize") as { params?: { appInfo?: { version?: string } } };
      assert.equal(init1?.params?.appInfo?.version, "9.8.7");
    } finally {
      h1.cleanup();
    }
    const h2 = bootPanel({ connected: false, relayVersion: "9.8.6" });
    try {
      const init2 = h2.posted.find((m) => m.method === "ui/initialize") as { params?: { appInfo?: { version?: string } } };
      assert.equal(init2?.params?.appInfo?.version, "9.8.6");
    } finally {
      h2.cleanup();
    }
  });

  it("clears loading bar on 0-tab/closed-window transition and shows actionable New Tab + Disconnect", async () => {
    const h = bootPanel({
      connected: true,
      connectionMode: "personal",
      tabs: [{ targetId: "t1", title: "Docs", url: "https://example.com" }],
      activeTargetId: "t1",
      epoch: 1,
    });
    try {
      await new Promise((r) => setTimeout(r, 15));
      const frameReq = h.posted.filter((m) => m.params?.name === "chrome_stream_frame").pop();
      assert.ok(frameReq);

      // Simulate user closing the last Chrome window/tab while connected
      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          id: frameReq.id,
          result: {
            structuredContent: {
              connected: true,
              noTabs: true,
              tabs: [],
              activeTargetId: null,
              changed: false,
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 15));

      assert.equal(h.els.get("lb")!.hidden, true, "loading bar must clear when all tabs/windows close");
      assert.equal(h.els.get("ph")!.hidden, false, "empty state overlay must be visible");
      assert.equal(h.els.get("pm")!.textContent, "Chrome window closed");
      assert.equal(h.els.get("pa2")!.hidden, false, "New Tab + Disconnect action row must be visible");

      // Clicking New Tab (#n2) sends chrome://newtab
      h.els.get("n2")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const newTabCall = h.posted.filter((m) => m.params?.name === "chrome_stream_input").pop();
      assert.equal(newTabCall?.params?.arguments?.events?.[0]?.action, "new_tab");
      assert.equal(newTabCall?.params?.arguments?.events?.[0]?.url, "chrome://newtab");
    } finally {
      h.cleanup();
    }
  });

  it("orders quality presets Auto -> Saver -> Low -> Balanced -> High and hides re-auth note in remote mode", async () => {
    const h = bootPanel(
      { connected: true, connectionMode: "remote", tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }], activeTargetId: "t1" },
      { navLang: "zh-CN" }
    );
    try {
      await new Promise((r) => setTimeout(r, 10));
      const qs = h.els.get("qs")!.children;
      assert.deepEqual(qs.map((b) => b.dataset.q), ["auto", "ultra", "low", "medium", "high"]);
      assert.deepEqual(qs.map((b) => b.textContent), ["自动", "省流", "流畅", "均衡", "高清"]);
      assert.equal(h.els.get("mn")!.hidden, true, "re-auth note must stay hidden in separate Chrome mode");
      assert.equal(h.els.get("rm")!.textContent, "独立");
    } finally {
      h.cleanup();
    }
  });

  it("localizes all 13 backend errorCodes and 5 bridge errors in EN & ZH with Details toggle", async () => {
    const allCodes = [
      "not_detected", "port_busy", "launch_failed", "chrome_missing", "allow_timeout", "allow_denied",
      "conn_lost", "timeout", "tab_changed", "tab_close_failed", "relay_busy", "relay_down", "unconfirmed",
    ];
    for (const c of allCodes) {
      assert.ok(I18N.en[`e_${c}`], `missing EN copy for e_${c}`);
      assert.ok(I18N["zh-CN"][`e_${c}`], `missing ZH copy for e_${c}`);
      assert.ok(!I18N.en[`e_${c}`].includes("CHROME_STREAM_"), `EN e_${c} must not expose env var`);
      assert.ok(!I18N["zh-CN"][`e_${c}`].includes("CHROME_STREAM_"), `ZH e_${c} must not expose env var`);
    }
    assert.equal(mapBridgeErrorKey("Closed"), "b_closed");
    assert.equal(mapBridgeErrorKey("Timeout:tools/call"), "b_timeout");
    assert.equal(mapBridgeErrorKey("Bad init"), "b_init");
    assert.equal(mapBridgeErrorKey("No serverTools"), "b_notools");
    assert.equal(mapBridgeErrorKey("unexpected boom"), "b_generic");

    const h = bootPanel({ connected: false }, { navLang: "zh-CN" });
    try {
      await new Promise((r) => setTimeout(r, 10));
      h.els.get("ob")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const connCall = h.posted.filter((m) => m.params?.name === "chrome_stream_connect").pop();
      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          id: connCall!.id,
          result: { structuredContent: { connected: false, errorCode: "port_busy", error: "raw port detail" } },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("om")!.textContent, I18N["zh-CN"].e_port_busy);
      assert.equal(h.els.get("ob2")!.hidden, false, "Details toggle must appear when raw error differs");
      assert.equal(h.els.get("od2")!.hidden, true, "raw error details start collapsed");
      h.els.get("ob2")!.listeners.get("click")![0]();
      assert.equal(h.els.get("od2")!.hidden, false, "clicking Details expands raw error");
    } finally {
      h.cleanup();
    }
  });

  it("saves unified settings via chrome_stream_config and hot-reloads on settingsGen bump", async () => {
    const h = bootPanel({
      connected: true,
      connectionMode: "personal",
      tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
      activeTargetId: "t1",
      settings: { lang: "en", defaultQuality: "auto", defaultConnectMode: "auto", bgPollIntervalSec: 0, idlePauseSec: 12 },
      settingsGen: 1,
      settingsPath: "~/.gemini/antigravity/plugin_data/chrome-stream-mcp/settings.json",
    });
    try {
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("mn")!.hidden, false, "personal mode shows neutral re-auth note in popover");
      const initFrame = h.posted.filter((m) => m.params?.name === "chrome_stream_frame").pop();
      if (initFrame) {
        h.msgHandler({
          source: h.win.parent,
          data: { jsonrpc: "2.0", id: initFrame.id, result: { structuredContent: { connected: true, activeTargetId: "t1", changed: false, unchanged: true } } },
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // Open Settings drawer & change idlePauseSec -> 30
      h.els.get("bg")!.listeners.get("click")![0]({ stopPropagation() {} });
      assert.equal(h.els.get("sw")!.hidden, false, "Settings drawer must open");
      h.els.get("si2")!.value = "30";
      h.els.get("si2")!.listeners.get("change")![0]();
      await new Promise((r) => setTimeout(r, 10));

      const cfgCall = h.posted.filter((m) => m.params?.name === "chrome_stream_config").pop();
      assert.deepEqual(JSON.parse(JSON.stringify(cfgCall?.params?.arguments)), { action: "update", patch: { idlePauseSec: 30 } });

      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          id: cfgCall!.id,
          result: { structuredContent: { ok: true, settingsGen: 2, settings: { idlePauseSec: 30 } } },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("ss")!.textContent, "✓ Saved");
    } finally {
      h.cleanup();
    }
  });

  it("resumes on stage mousedown while paused without forwarding a blind click", async () => {
    const h = bootPanel({
      connected: true,
      paused: true,
      pauseEpoch: 2,
      tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
      activeTargetId: "t1",
    });
    try {
      await new Promise((r) => setTimeout(r, 10));
      h.els.get("vc")!.listeners.get("mousedown")![0]({ button: 0, clientX: 100, clientY: 100, preventDefault() {} });
      await new Promise((r) => setTimeout(r, 10));
      const inCall = h.posted.filter((m) => m.params?.name === "chrome_stream_input").pop();
      assert.deepEqual(JSON.parse(JSON.stringify(inCall?.params?.arguments?.events)), [{ action: "resume" }]);
    } finally {
      h.cleanup();
    }
  });

  it("drops .ok on #op when a standby error is active and uses direct-child .f > .b in CSS", async () => {
    const css = fs.readFileSync(path.join(panelDir, "styles.css"), "utf8");
    assert.ok(css.includes(".f > .b"), "styles.css must scope .b sizing with .f > .b");
    assert.ok(!/\.f\s+\.b\b/.test(css), "styles.css must not use descendant .f .b selector");

    const h = bootPanel({ connected: false, portFile: { valid: true, port: 9222 } }, { navLang: "zh-CN" });
    try {
      await new Promise((r) => setTimeout(r, 10));
      const op = h.els.get("op")!;
      assert.equal(op.classList.contains("ok"), true, "#op shows .ok when portFile is valid and no error");
      assert.equal(op.classList.contains("er"), false);

      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            structuredContent: {
              connected: false,
              portFile: { valid: true, port: 9222 },
              errorCode: "port_busy",
              error: "Debug port 9222 is already in use",
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(op.classList.contains("ok"), false, "#op must drop .ok when standby error is active");
      assert.equal(op.classList.contains("er"), true, "#op should show .er when standby error is active");
      assert.equal(h.els.get("od")!.classList.contains("er"), true);

      // Dismissing/clearing the error restores .ok on #op when portFile is still valid
      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            structuredContent: {
              connected: false,
              portFile: { valid: true, port: 9222 },
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(op.classList.contains("ok"), true, "#op must restore .ok once standby error clears");
      assert.equal(op.classList.contains("er"), false);
    } finally {
      h.cleanup();
    }
  });

  it("ignores attribute injection in mkTab targetId and blocks on* attributes in h()", async () => {
    const evilTid = "t1;onload=alert(1);ONERROR=alert(2)";
    const h = bootPanel({
      connected: true,
      connectionMode: "personal",
      tabs: [{ targetId: evilTid, title: "Evil", url: "https://example.com" }],
      activeTargetId: evilTid,
    });
    try {
      await new Promise((r) => setTimeout(r, 10));
      const tb = h.els.get("tb")!;
      assert.equal(tb.children.length, 1);
      const tab = tb.children[0]!;
      assert.equal(tab.dataset.id, evilTid);
      assert.equal(tab.getAttribute("role"), "tab");
      assert.equal(tab.getAttribute("onload"), null);
      assert.equal(tab.getAttribute("ONERROR"), null);
    } finally {
      h.cleanup();
    }
  });

  it("boots into Standby Ready on connected+paused without auto-unpausing and supports 1-click Resume or Revoke", async () => {
    const h = bootPanel(
      {
        connected: true,
        paused: true,
        standby: true,
        pauseEpoch: 3,
        connectionMode: "personal",
        tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
        activeTargetId: "t1",
      },
      { navLang: "zh-CN" }
    );
    try {
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(h.els.get("vo")!.hidden, false, "Standby boot must show #vo Standby Ready card");
      assert.equal(h.els.get("vn")!.hidden, true, "Standby boot must hide live #vn view");
      assert.equal(h.els.get("op")!.textContent, I18N["zh-CN"].sbb);
      assert.equal(h.els.get("op")!.classList.contains("wn"), true);
      assert.equal(h.els.get("ob")!.textContent, I18N["zh-CN"].rsb);
      assert.equal(h.els.get("ol")!.hidden, true, "Open separate Chrome must be hidden in Standby Ready");
      assert.equal(h.els.get("orv")!.hidden, false, "Revoke Grant button must be visible in Standby Ready");
      assert.equal(h.els.get("dt")!.hidden, true, "Setup guide must be hidden in Standby Ready");

      const frameCalls = h.posted.filter((m) => m.params?.name === "chrome_stream_frame");
      assert.equal(frameCalls.length, 0, "Standby boot must not start immediate live frame polling");

      // Click Revoke Grant (#orv) from Standby Ready card -> sends mode:revoke
      h.els.get("orv")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const revCall = h.posted.filter((m) => m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(revCall?.params?.arguments?.mode, "revoke");
      h.msgHandler({
        source: h.win.parent,
        data: { jsonrpc: "2.0", id: revCall!.id, result: { structuredContent: { ok: true, connected: false, portFile: { valid: true, port: 9222 } } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("vo")!.hidden, false);
      assert.equal(h.els.get("orv")!.hidden, true);
      assert.equal(h.els.get("op")!.textContent, I18N["zh-CN"].rmy);
    } finally {
      h.cleanup();
    }
  });

  it("enters Standby Ready from tool-result notification and empty-tab Standby/Revoke buttons", async () => {
    const h = bootPanel({
      connected: true,
      connectionMode: "personal",
      tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
      activeTargetId: "t1",
      epoch: 1,
    });
    try {
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("vn")!.hidden, false);
      const initFrame = h.posted.filter((m) => m.params?.name === "chrome_stream_frame").pop();
      if (initFrame) {
        h.msgHandler({
          source: h.win.parent,
          data: { jsonrpc: "2.0", id: initFrame.id, result: { structuredContent: { connected: true, activeTargetId: "t1", changed: false, unchanged: true } } },
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // Empty-tab #n3 sends standby and #n4 sends revoke
      h.els.get("n3")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const n3Call = h.posted.filter((m) => m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(n3Call?.params?.arguments?.mode, "standby");
      h.msgHandler({
        source: h.win.parent,
        data: { jsonrpc: "2.0", id: n3Call!.id, result: { structuredContent: { ok: true, connected: true, paused: true, standby: true, pauseEpoch: 2 } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("vo")!.hidden, false);

      // Resume Stream (#ob) -> returns to #vn
      h.els.get("ob")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const resCall = h.posted.filter((m) => m.params?.name === "chrome_stream_input").pop();
      assert.equal(resCall?.params?.arguments?.events?.[0]?.action, "resume");
      h.msgHandler({
        source: h.win.parent,
        data: { jsonrpc: "2.0", id: resCall!.id, result: { structuredContent: { ok: true, connected: true, paused: false, pauseEpoch: 3 } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("vn")!.hidden, false);

      // Host tool-result with connected:true + paused:true + standby:true transitions back to Standby Ready
      h.msgHandler({
        source: h.win.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: { connected: true, paused: true, standby: true, pauseEpoch: 4, activeTargetId: "t1", tabsHash: "h" } },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(h.els.get("vo")!.hidden, false);
      assert.equal(h.els.get("op")!.textContent, I18N.en.sbb);

      // #n4 button sends explicit mode:revoke
      h.els.get("n4")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 10));
      const n4Call = h.posted.filter((m) => m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(n4Call?.params?.arguments?.mode, "revoke");
    } finally {
      h.cleanup();
    }
  });

  it("keeps Settings drawer open across standby probeOff ticks and suppresses forced frame polls on quality change", async () => {
    const h = bootPanel({
      connected: true,
      paused: true,
      standby: true,
      pauseEpoch: 2,
      settings: { lang: "en", defaultQuality: "auto", defaultConnectMode: "auto", bgPollIntervalSec: 0, idlePauseSec: 12 },
      settingsGen: 1,
      tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
      activeTargetId: "t1",
    });
    try {
      await new Promise((r) => setTimeout(r, 10));
      // Open Settings drawer in Standby Ready
      h.els.get("bg0")!.listeners.get("click")![0]({ stopPropagation() {} });
      assert.equal(h.els.get("sw")!.hidden, false, "Settings drawer must open in Standby Ready");

      // Trigger standby probe via pointerenter reveal (simulates probeOff in Standby)
      h.win.parent;
      h.els.get("sq")!.value = "high";
      h.els.get("sq")!.listeners.get("change")![0]();
      await new Promise((r) => setTimeout(r, 40));
      const cfgCall = h.posted.filter((m) => m.params?.name === "chrome_stream_config").pop();
      assert.deepEqual(JSON.parse(JSON.stringify(cfgCall?.params?.arguments)), { action: "update", patch: { defaultQuality: "high" } });
      h.msgHandler({
        source: h.win.parent,
        data: { jsonrpc: "2.0", id: cfgCall!.id, result: { structuredContent: { ok: true, settingsGen: 2, settings: { defaultQuality: "high" } } } },
      });
      await new Promise((r) => setTimeout(r, 40));

      // Also simulate a standby probeOff response via reveal (resize/focus) and confirm Settings stays open & 0 forced polls fire
      const frameBefore = h.posted.filter((m) => m.params?.name === "chrome_stream_frame");
      assert.equal(frameBefore.filter((m) => m.params?.arguments?.forceRefresh === true).length, 0, "defaultQuality change in Standby must NOT trigger forceRefresh frame poll");

      // Trigger probeOff via window focus while Settings drawer is open
      h.setNow(15_000);
      h.winListeners.get("focus")?.forEach((fn) => fn({}));
      await new Promise((r) => setTimeout(r, 10));
      const probeCall = h.posted.filter((m) => m.params?.name === "chrome_stream_frame").pop();
      assert.ok(probeCall, "Standby focus reveal should run lightweight probeOff");
      assert.equal(probeCall.params?.arguments?.waitMs, 0);
      assert.equal(probeCall.params?.arguments?.forceRefresh, false);
      h.msgHandler({
        source: h.win.parent,
        data: { jsonrpc: "2.0", id: probeCall.id, result: { structuredContent: { connected: true, paused: true, standby: true, pauseEpoch: 2 } } },
      });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(h.els.get("sw")!.hidden, false, "Settings drawer must remain open across standby probeOff ticks");
    } finally {
      h.cleanup();
    }
  });

  it("hydrates redacted localStorage SWR at Frame 0 on empty or older bootTs without leaking pixels/wsUrl", async () => {
    const store = new Map<string, string>();
    const h1 = bootPanel({ connected: false }, { storage: store });
    try {
      await new Promise((r) => setTimeout(r, 10));
      h1.msgHandler({
        source: h1.win.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            structuredContent: {
              connected: true,
              connectionMode: "personal",
              activeTargetId: "t-swr",
              tabs: [{ targetId: "t-swr", title: "Cached Tab", url: "https://swr.test" }],
              tabsHash: "th-swr",
              page: { title: "Cached Tab", url: "https://swr.test", viewportWidth: 1280, viewportHeight: 800 },
              qualityApplied: "high",
              portFile: { valid: true, port: 9222, path: "/secret/DevToolsActivePort", wsUrl: "ws://127.0.0.1:9222/devtools/browser/secret" },
              imageDataUrl: "data:image/webp;base64,QUFB",
              settings: { lang: "zh-CN", defaultQuality: "high", defaultConnectMode: "personal", bgPollIntervalSec: 5, idlePauseSec: 30 },
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      h1.cleanup();
    }

    const raw = store.get("chrome_stream_swr") || "";
    assert.ok(raw.length > 0, "must persist SWR metadata in localStorage");
    assert.ok(!raw.includes("imageDataUrl") && !raw.includes("QUFB"), "must NEVER persist imageDataUrl");
    assert.ok(!raw.includes("wsUrl") && !raw.includes("/secret/"), "must NEVER persist wsUrl or local paths");
    const parsed = JSON.parse(raw) as { v: number; savedAt: number; data: Record<string, unknown> };
    assert.equal(parsed.v, 1);
    assert.equal(parsed.data.activeTargetId, "t-swr");

    // Reopen with empty b0 -> must hydrate synchronously BEFORE app.connect() resolves
    const h2 = bootPanel({}, { storage: store, deferConnect: true });
    try {
      assert.equal(h2.els.get("vn")!.hidden, false, "empty b0 must hydrate #vn at Frame 0 from localStorage");
      assert.equal(h2.els.get("vo")!.hidden, true);
      assert.equal(h2.els.get("ui")!.value, "https://swr.test");
      assert.equal(h2.els.get("tb")!.children.length, 1);
      assert.equal(h2.els.get("tb")!.children[0]!.firstChild!.textContent, "Cached Tab");
    } finally {
      h2.cleanup();
    }

    // Reopen with older bootTs < cached.savedAt -> localStorage wins at Frame 0
    const h3 = bootPanel({ connected: false, bootTs: parsed.savedAt - 500 }, { storage: store, deferConnect: true });
    try {
      assert.equal(h3.els.get("vn")!.hidden, false, "newer localStorage must override older bootTs at Frame 0");
      assert.equal(h3.els.get("ui")!.value, "https://swr.test");
    } finally {
      h3.cleanup();
    }

    // Reopen with newer bootTs >= cached.savedAt -> SSR boot wins at Frame 0
    const h4 = bootPanel({ connected: false, bootTs: parsed.savedAt + 500 }, { storage: store, deferConnect: true });
    try {
      assert.equal(h4.els.get("vo")!.hidden, false, "newer SSR bootTs must win over stale localStorage");
      assert.equal(h4.els.get("vn")!.hidden, true);
    } finally {
      h4.cleanup();
    }
  });

  it("coalesces fresh-boot poll(0) when bootTs < 2500ms, pauses on document.hidden, and drops out-of-order replies", async () => {
    // 1. Fresh-boot coalescing: bootTs = 9600 (age 400ms < 2500ms) skips immediate t=0 poll(0)
    const fresh = bootPanel({
      connected: true,
      bootTs: 9600,
      tabs: [{ targetId: "t1", title: "Home", url: "https://fresh.test" }],
      activeTargetId: "t1",
      seq: 1,
      frameHash: "h1",
    });
    try {
      await new Promise((r) => setTimeout(r, 15));
      const immediate = fresh.posted.filter((m) => m.params?.name === "chrome_stream_frame");
      assert.equal(immediate.length, 0, "fresh SSR boot (<2500ms) must coalesce and skip immediate t=0 poll(0)");

      // Emit document.hidden -> clears scheduled poll timers immediately
      fresh.doc.visibilityState = "hidden";
      fresh.doc.listeners.get("visibilitychange")?.forEach((fn) => fn({}));
      assert.equal(fresh.activeTimers.size, 0, "document.hidden must clear all scheduled poll timers");

      // Emit document.visible -> resumes via forceNow()
      fresh.doc.visibilityState = "visible";
      fresh.setNow(10_500);
      fresh.doc.listeners.get("visibilitychange")?.forEach((fn) => fn({}));
      await new Promise((r) => setTimeout(r, 10));
      const afterReveal = fresh.posted.filter((m) => m.params?.name === "chrome_stream_frame");
      assert.equal(afterReveal.length, 1, "visibilitychange visible must resume polling");
    } finally {
      fresh.cleanup();
    }

    // 2. Out-of-order drop via monotonic pollSeq across probeOff -> conn/onResult -> poll
    const ooo = bootPanel({ connected: false, portFile: { valid: true, port: 9222 } });
    try {
      await new Promise((r) => setTimeout(r, 10));
      // Trigger probeOff #1 (stays pending)
      ooo.setNow(12_000);
      ooo.winListeners.get("focus")?.forEach((fn) => fn({}));
      await new Promise((r) => setTimeout(r, 10));
      const staleProbe = ooo.posted.filter((m) => m.params?.name === "chrome_stream_frame").pop();
      assert.ok(staleProbe, "expected pending probeOff call");

      // Newer tool-result connects to t-new and fires poll #2
      ooo.msgHandler({
        source: ooo.win.parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            structuredContent: {
              connected: true,
              connectionMode: "personal",
              activeTargetId: "t-new",
              tabs: [{ targetId: "t-new", title: "New Tab", url: "https://new.test" }],
              tabsHash: "th-new",
              page: { title: "New Tab", url: "https://new.test" },
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(ooo.els.get("vn")!.hidden, false);
      assert.equal(ooo.els.get("ui")!.value, "https://new.test");

      // Now stale probeOff #1 arrives late with connected:false -> MUST be dropped!
      ooo.msgHandler({
        source: ooo.win.parent,
        data: {
          jsonrpc: "2.0",
          id: staleProbe.id,
          result: { structuredContent: { connected: false, errorCode: "not_detected" } },
        },
      });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(ooo.els.get("vn")!.hidden, false, "late out-of-order probeOff reply must be dropped");
      assert.equal(ooo.els.get("ui")!.value, "https://new.test");
    } finally {
      ooo.cleanup();
    }
  });

  it("serializes all tools/call to maxInFlight === 1, prioritizes user calls, caps waitMs on high RTT, retries busy once, and localizes ZH", async () => {
    assert.equal(mapBridgeErrorKey("Too many concurrent tool calls"), "b_busy");
    assert.equal(mapBridgeErrorKey("Server busy"), "b_busy");
    assert.equal(mapBridgeErrorKey("Relay busy: too many concurrent requests"), "b_busy");

    // 1. Concurrent frame poll + wheel/click input + config + visibility resume => maxInFlight === 1, priority first, 0 errors
    const h = bootPanel(
      {
        connected: true,
        connectionMode: "personal",
        rttMs: 220,
        tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
        activeTargetId: "t1",
        epoch: 1,
        settings: { lang: "en", defaultQuality: "auto", defaultConnectMode: "auto", bgPollIntervalSec: 0, idlePauseSec: 12 },
      },
      { deferConnect: true }
    );
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      let concurrencyErrors = 0;
      const order: string[] = [];
      const queue: Array<{ id: number; name: string; args: Record<string, any> }> = [];
      const origPost = h.win.parent.postMessage.bind(h.win.parent);
      h.win.parent.postMessage = (msg: PostedMessage) => {
        origPost(msg);
        if (msg.method === "tools/call" && typeof msg.id === "number") {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const name = msg.params?.name || "";
          order.push(name);
          if (inFlight > 1) {
            concurrencyErrors += 1;
            inFlight -= 1;
            h.msgHandler({
              source: h.win.parent,
              data: { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Too many concurrent tool calls" } },
            });
            return;
          }
          queue.push({ id: msg.id, name, args: msg.params?.arguments || {} });
        }
      };

      const replyNext = (payload: Record<string, unknown> = { ok: true, connected: true, activeTargetId: "t1", changed: false, unchanged: true }) => {
        const req = queue.shift();
        if (!req) return null;
        inFlight -= 1;
        h.msgHandler({
          source: h.win.parent,
          data: { jsonrpc: "2.0", id: req.id, result: { structuredContent: payload } },
        });
        return req;
      };

      h.resolveConnect();
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(queue.length, 1);
      assert.equal(queue[0]!.name, "chrome_stream_frame");
      assert.equal(queue[0]!.args.waitMs, 0, "waitMs must be capped to 0 when ewmaRttMs > 120");

      // While frame #1 is in flight, fire wheel scroll, click, config change, and visibility resume
      const vc = h.els.get("vc")!;
      vc.listeners.get("wheel")![0]({ deltaX: 0, deltaY: 120, deltaMode: 0, clientX: 80, clientY: 90, preventDefault() {} });
      vc.listeners.get("mousedown")![0]({ button: 0, clientX: 80, clientY: 90, detail: 1, preventDefault() {} });
      h.winListeners.get("mouseup")!.forEach((fn) => fn({ button: 0, clientX: 80, clientY: 90, detail: 1 }));
      h.els.get("si2")!.value = "30";
      h.els.get("si2")!.listeners.get("change")![0]();
      h.doc.visibilityState = "hidden";
      h.doc.listeners.get("visibilitychange")?.forEach((fn) => fn({}));
      h.setNow(11_000);
      h.doc.visibilityState = "visible";
      h.doc.listeners.get("visibilitychange")?.forEach((fn) => fn({}));

      await new Promise((r) => setTimeout(r, 95));
      assert.equal(inFlight, 1, "must hold strictly 1 RPC in flight while user inputs & visibility resume queue");
      assert.equal(maxInFlight, 1);
      assert.equal(concurrencyErrors, 0);

      // Drain frame #1 and every subsequent serialized request
      for (let i = 0; i < 12 && queue.length > 0; i++) {
        const curName: string = queue[0]!.name;
        replyNext(
          curName === "chrome_stream_config"
            ? { ok: true, settingsGen: 2, settings: { idlePauseSec: 30 } }
            : { ok: true, connected: true, activeTargetId: "t1", changed: false, unchanged: true }
        );
        await new Promise((r) => setTimeout(r, 25));
      }

      assert.equal(maxInFlight, 1, "maxInFlight must stay === 1 across concurrent frame + scroll/click + config + visibility");
      assert.equal(concurrencyErrors, 0, "0 Too many concurrent tool calls errors expected");
      assert.equal(h.els.get("bn")!.hidden, true, "error banner must stay hidden (0 surfaced errors)");
      const firstInputIdx = order.indexOf("chrome_stream_input");
      const firstConfigIdx = order.indexOf("chrome_stream_config");
      const secondFrameIdx = order.indexOf("chrome_stream_frame", 1);
      assert.ok(firstInputIdx > 0 && firstConfigIdx > 0, "expected priority input & config calls");
      if (secondFrameIdx !== -1) {
        assert.ok(firstInputIdx < secondFrameIdx && firstConfigIdx < secondFrameIdx, "priority calls must run ahead of queued frame polls");
      }
    } finally {
      h.cleanup();
    }

    // 2. Transient busy error retries once silently after 160ms; persistent busy error localizes cleanly in ZH
    const zh = bootPanel({ connected: false }, { navLang: "zh-CN", deferConnect: true });
    try {
      const origPost = zh.win.parent.postMessage.bind(zh.win.parent);
      let attempt = 0;
      let failForever = false;
      zh.win.parent.postMessage = (msg: PostedMessage) => {
        origPost(msg);
        if (msg.method === "tools/call" && typeof msg.id === "number") {
          attempt += 1;
          if (failForever || attempt === 1) {
            zh.msgHandler({
              source: zh.win.parent,
              data: { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Too many concurrent tool calls" } },
            });
          } else {
            zh.msgHandler({
              source: zh.win.parent,
              data: { jsonrpc: "2.0", id: msg.id, result: { structuredContent: { connected: false, portFile: { valid: true, port: 9222 } } } },
            });
          }
        }
      };

      zh.resolveConnect();
      await new Promise((r) => setTimeout(r, 10));
      zh.setNow(15_000);
      zh.winListeners.get("focus")?.forEach((fn) => fn({}));
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(attempt, 2, "transient busy error must wait 160ms and retry once silently");
      assert.equal(zh.els.get("oe")!.hidden, true, "successful retry must surface zero error banner");

      // Persistent busy failure on Connect button -> localizes to ZH b_busy with zero raw English in #om
      failForever = true;
      zh.els.get("ob")!.listeners.get("click")![0]();
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(attempt, 4);
      assert.equal(zh.els.get("om")!.textContent, I18N["zh-CN"].b_busy);
      assert.ok(!zh.els.get("om")!.textContent.includes("Too many concurrent"), "must not leak raw English in ZH banner");
    } finally {
      zh.cleanup();
    }
  });
});
