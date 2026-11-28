import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";
import {
  AdaptiveBandwidthController,
  applyFramePayloadState,
  applyOptimisticTabClose,
  coalesceInputEvents,
  isSafeImageUrl,
  isTargetErrorText,
  parsePanelLocaleTag,
  resolvePanelLang,
  resolveStageAspect,
  rttBand,
  setupRevealObservers,
  shouldApplyFrameResponse,
} from "./net-policy.ts";
import type { FramePayload, PanelState } from "./net-policy.ts";
import {
  App,
  applyDocumentTheme,
  applyHostContext,
  applyHostFonts,
  applyHostStyleVariables,
  LATEST_PROTOCOL_VERSION,
  parseColorLum,
} from "./kit/bridge.ts";
import type { BridgeStyleTarget } from "./kit/bridge.ts";
import { HARD_MAX_BYTES } from "./kit/guard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MockElement {
  tagName: string;
  style: {
    setProperty(k: string, v: string): void;
    colorScheme: string;
    backgroundColor: string;
    transform: string;
    left: string;
    top: string;
  };
  dataset: Record<string, string>;
  hidden: boolean;
  disabled?: boolean;
  open?: boolean;
  textContent: string;
  value: string;
  title: string;
  className: string;
  classList: { toggle(): void; remove(): void; add(): void };
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
  append(...items: Array<MockElement & { __frag?: boolean }>): void;
  appendChild(it: MockElement | null): MockElement | null;
  replaceChildren(...items: Array<MockElement & { __frag?: boolean }>): void;
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
  __frag?: boolean;
}

interface PostedMessage {
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

describe("Remote Cast panel net-policy.ts", () => {
  it("adapts quality with EWMA (alpha=0.25) and asymmetric hysteresis (2 slow downgrade / 3 fast upgrade)", () => {
    const net = new AdaptiveBandwidthController("auto");
    assert.equal(net.getEffectiveQuality(), "low");

    let s = net.recordSample({ totalMs: 260, serverMs: 200, imageBytes: 15_000, now: 1000 });
    assert.equal(s.netRttMs, 60);
    assert.equal(s.effectiveTier, "high");

    // Single slow jitter spike must NOT downgrade immediately
    s = net.recordSample({ totalMs: 650, serverMs: 100, imageBytes: 18_000, now: 2000 });
    assert.equal(s.effectiveTier, "high");

    // Second consecutive slow sample downgrades cleanly to low
    s = net.recordSample({ totalMs: 700, serverMs: 100, imageBytes: 18_000, now: 3000 });
    assert.equal(s.effectiveTier, "low");
    assert.equal(net.getWheelCoalesceMs(), 75);

    // Continued extreme RTT (2 consecutive ultra-slow samples) steps down to ultra
    s = net.recordSample({ totalMs: 1800, serverMs: 100, imageBytes: 18_000, now: 3500 });
    s = net.recordSample({ totalMs: 1800, serverMs: 100, imageBytes: 18_000, now: 3800 });
    assert.equal(s.effectiveTier, "ultra");
    assert.equal(net.getNetworkGrade(), "weak");
    assert.equal(net.getTypeBatchMs(), 60);

    // Single fast sample must NOT upgrade immediately
    s = net.recordSample({ totalMs: 120, serverMs: 50, imageBytes: 10_000, now: 4000 });
    assert.equal(s.effectiveTier, "ultra");

    // Settled crisp still frame switches long-poll to 1400ms
    assert.equal(net.computePollTiming({ idleMs: 1500, settled: true }).waitMs, 1400);

    // Sustained fast samples (>= 3 consecutive under upgrade threshold after cooldown) step up one tier
    for (let i = 0; i < 6; i++) {
      s = net.recordSample({ totalMs: 90, serverMs: 40, imageBytes: 10_000, now: 12_000 + i * 200 });
    }
    assert.equal(s.effectiveTier, "low");

    net.setMode("high");
    assert.equal(net.getEffectiveQuality(), "high");

    // Single severe jitter spike (40, 2000, 40ms) MUST NOT downgrade to low
    const spikeNet = new AdaptiveBandwidthController("auto");
    assert.equal(spikeNet.recordSample({ totalMs: 40, serverMs: 0, imageBytes: 10_000, now: 1000 }).effectiveTier, "high");
    assert.equal(spikeNet.recordSample({ totalMs: 2000, serverMs: 0, imageBytes: 10_000, now: 2000 }).effectiveTier, "high");
    assert.equal(spikeNet.recordSample({ totalMs: 40, serverMs: 0, imageBytes: 10_000, now: 3000 }).effectiveTier, "high");
  });

  it("coalesces type, scroll, mousemove, repeatable key, switch_tab, and duplicate close_tab only for matching target+epoch", () => {
    const out = coalesceInputEvents([
      { action: "type", text: "h", pressEnter: false },
      { action: "type", text: "i", pressEnter: false },
      { action: "scroll", x: 10, y: 20, deltaX: 0, deltaY: 120 },
      { action: "scroll", x: 15, y: 25, deltaX: 0, deltaY: 180 },
      { action: "mousemove", x: 1, y: 2 },
      { action: "mousemove", x: 50, y: 60 },
      { action: "key", key: "Backspace" },
      { action: "key", key: "Backspace" },
      { action: "key", key: "Backspace" },
      { action: "switch_tab", targetId: "t1" },
      { action: "switch_tab", targetId: "t2" },
      { action: "close_tab", targetId: "t3" },
      { action: "close_tab", targetId: "t3" },
    ]);
    assert.deepEqual(out, [
      { action: "type", text: "hi", pressEnter: false },
      { action: "scroll", x: 15, y: 25, deltaX: 0, deltaY: 300 },
      { action: "mousemove", x: 50, y: 60 },
      { action: "key", key: "Backspace", repeat: 3 },
      { action: "switch_tab", targetId: "t2" },
      { action: "close_tab", targetId: "t3" },
    ]);

    const isolated = coalesceInputEvents([
      { action: "type", text: "a", pressEnter: false, targetId: "t1", targetEpoch: 1 },
      { action: "type", text: "b", pressEnter: false, targetId: "t1", targetEpoch: 2 },
      { action: "scroll", x: 1, y: 1, deltaX: 0, deltaY: 50, targetId: "t1", targetEpoch: 2 },
      { action: "scroll", x: 2, y: 2, deltaX: 0, deltaY: 50, targetId: "t2", targetEpoch: 2 },
    ]);
    assert.equal(isolated.length, 4, "events with differing targetId or targetEpoch must never coalesce");
  });

  it("enforces stale-frame filtering, optimistic tab close, and background payload state", () => {
    // Stale epoch & mismatched target filtering vs external close recovery
    assert.equal(
      shouldApplyFrameResponse({
        reqEpoch: 2,
        currentEpoch: 3,
        currentTargetId: "t2",
        payload: { activeTargetId: "t1", changed: true },
      }).apply,
      false
    );
    assert.equal(
      shouldApplyFrameResponse({
        reqEpoch: 3,
        currentEpoch: 3,
        currentTargetId: "t2",
        payload: { activeTargetId: "t1", tabs: [{ targetId: "t1" }, { targetId: "t2" }] },
      }).apply,
      false
    );
    assert.equal(
      shouldApplyFrameResponse({
        reqEpoch: 3,
        currentEpoch: 3,
        currentTargetId: "t2",
        payload: { activeTargetId: "t1", tabs: [{ targetId: "t1" }] },
      }).apply,
      true
    );

    // Optimistic tab close (active, non-active, last) & target-gone classification
    const tabs = [{ targetId: "t1" }, { targetId: "t2" }, { targetId: "t3" }];
    const a = applyOptimisticTabClose(tabs, "t2", "t2");
    assert.equal(a.wasActive, true);
    assert.equal(a.activeTargetId, "t3");

    const na = applyOptimisticTabClose(tabs, "t2", "t3");
    assert.equal(na.wasActive, false);
    assert.equal(na.activeTargetId, "t2");

    const last = applyOptimisticTabClose([{ targetId: "t1" }], "t1", "t1");
    assert.equal(last.wasActive, true);
    assert.equal(last.activeTargetId, null);

    assert.equal(isTargetErrorText("No target with given id found"), true);
    assert.equal(isTargetErrorText("Chrome CDP connection closed"), false);

    // Background state & frame payload updates preserve userPaused and unchanged 0-churn behavior
    const state: PanelState = {
      on: true, ep: 1, tep: 1, pe: 0, cm: "", cr: false, fm: "", aid: "t1",
      tabs: [{ targetId: "t1", title: "One" }], th: "th1",
      pg: { url: "https://a.test" }, seq: 5, fh: "fh5", by: 1200, uc: false,
      pa: false, st: true, id: true, dlg: null, nt: false, nv: true,
    };

    const paintUnchanged = applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t1",
      tabs: [{ targetId: "t1", title: "One" }, { targetId: "t2", title: "Two" }],
      tabsHash: "th2",
      changed: false,
      unchanged: true,
      screencastPausedIdle: true,
    }, 1, 45);
    assert.equal(paintUnchanged, false);
    assert.equal(state.uc, true);
    assert.equal(state.fh, "fh5");
    assert.equal(state.by, 1200);
    assert.equal(state.tabs.length, 2);
    assert.equal(state.th, "th2");
    assert.equal(state.id, true);

    const paintChanged = applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t2",
      tabs: [{ targetId: "t1", title: "One" }, { targetId: "t2", title: "Two" }],
      tabsHash: "th2",
      page: { title: "Two", url: "https://b.test" },
      seq: 8,
      frameHash: "fh8",
      imageBytes: 2400,
      imageDataUrl: "data:image/jpeg;base64,AAAA",
      changed: true,
      unchanged: false,
      screencastPausedIdle: false,
      popupSwitched: true,
    }, 1, 55);
    assert.equal(paintChanged, true);
    assert.equal(state.uc, false);
    assert.equal(state.seq, 8);
    assert.equal(state.fh, "fh8");
    assert.equal(state.by, 2400);
    assert.equal(state.aid, "t2");
    assert.equal(state.id, false);
    assert.equal(state.pg.url, "https://b.test");

    state.pa = true;
    state.st = false;
    state.pe = 1;
    // Legacy payload without pauseEpoch preserves local paused state on live poll (totalMs > 0)
    const paintWhilePaused = applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t2",
      paused: false,
      screencastPausedIdle: false,
      changed: false,
      unchanged: true,
    }, 1, 30);
    assert.equal(paintWhilePaused, false);
    assert.equal(state.pa, true);
    assert.equal(state.id, false);

    // Stale pauseEpoch <= S.pe is ignored on live poll
    applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t2",
      paused: false,
      pauseEpoch: 1,
      changed: false,
      unchanged: true,
    }, 1, 40);
    assert.equal(state.pa, true);
    assert.equal(state.pe, 1);

    // Newer server pauseEpoch > S.pe reconciles paused/resumed deterministically on live poll!
    applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t2",
      paused: false,
      pauseEpoch: 2,
      changed: false,
      unchanged: true,
    }, 1, 45);
    assert.equal(state.pa, false);
    assert.equal(state.st, true);
    assert.equal(state.pe, 2);

    applyFramePayloadState(state, {
      connected: true,
      activeTargetId: "t2",
      paused: true,
      pauseEpoch: 3,
      changed: false,
      unchanged: true,
    }, 1, 50);
    assert.equal(state.pa, true);
    assert.equal(state.st, false);
    assert.equal(state.pe, 3);
  });

  it("ships dark-first, zero-flicker, Lucid Indigo CSP-clean panel bundle meeting all invariants", () => {
    const html = fs.readFileSync(path.join(__dirname, "dist", "panel.html"), "utf8");
    const stageSrc = fs.readFileSync(path.join(__dirname, "stage.ts"), "utf8");
    const bridgeSrc = fs.readFileSync(path.join(__dirname, "kit", "bridge.ts"), "utf8");
    const bytes = Buffer.byteLength(html, "utf8");

    // Size gate: Panel Kit 64 KiB hard cap
    assert.ok(bytes <= HARD_MAX_BYTES, `panel.html is ${bytes} B (> ${HARD_MAX_BYTES} B hard gate)`);

    // Zero internal jargon (exclude internal SSR boot placeholder token)
    const htmlNoBoot = html.replace(/__CHROME_STREAM_BOOT__/g, "");
    for (const jargon of ["SHA-1", "0600 Unix Socket", "Local Loopback", "CDP", "CHROME_STREAM_"]) {
      assert.ok(!htmlNoBoot.includes(jargon), `panel.html must not expose internal jargon: ${jargon}`);
    }

    // Dark-first boot & zero prefers-color-scheme (Lucid Indigo #0B0D12)
    assert.ok(html.includes('<meta name="color-scheme" content="dark">'));
    assert.ok(html.includes('style="background:#0B0D12;color-scheme:dark"'));
    assert.ok(html.includes('<body style="background:#0B0D12">'));
    assert.ok(!html.includes("prefers-color-scheme"), "panel.html must contain zero prefers-color-scheme queries");

    // CSP default-src 'none', zero external URLs (excluding W3C SVG XML namespace), single merged <script>
    assert.ok(html.includes("default-src 'none'"), "panel.html must declare default-src 'none' CSP");
    assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)|wss?:\/\//i.test(html), "panel.html must have zero external URLs");
    const scriptTags = html.match(/<script\b/gi) || [];
    assert.equal(scriptTags.length, 1, `expected exactly 1 <script> tag, got ${scriptTags.length}`);
    assert.ok(html.includes("/*__CHROME_STREAM_BOOT__*/"));

    // Zero innerHTML / outerHTML anywhere in built HTML or sources
    assert.ok(!/\b(?:inner|outer)HTML\b/.test(html), "panel.html must not assign or reference innerHTML/outerHTML");
    assert.ok(!/\b(?:inner|outer)HTML\b/.test(stageSrc), "stage.ts must not use innerHTML/outerHTML");
    assert.ok(!/\b(?:inner|outer)HTML\b/.test(bridgeSrc), "kit/bridge.ts must not use innerHTML/outerHTML");
    assert.equal(LATEST_PROTOCOL_VERSION, "2026-01-26");
    assert.equal(typeof App, "function");
    assert.equal(typeof applyDocumentTheme, "function");
    assert.equal(typeof applyHostContext, "function");
    assert.equal(typeof applyHostFonts, "function");

    // Zero opacity:0 inside any @keyframes block
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(styleMatch, "panel.html must have inline <style>");
    const css = styleMatch[1];
    const kfBlocks = css.match(/@keyframes\s+[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g) || [];
    assert.ok(kfBlocks.length >= 2, "expected keyframe animations in styles");
    for (const kf of kfBlocks) {
      assert.ok(!/opacity\s*:\s*0\b/.test(kf), `@keyframes must not use opacity:0: ${kf}`);
    }

    // All Lucid Indigo family tokens defined in BOTH dark (:root) and light (:root[data-theme=light])
    const rootBlock = [...css.matchAll(/:root\{([^}]+)\}/g)].map((m) => m[1]).join(";");
    const lightBlock = [...css.matchAll(/:root\[data-theme=["']?light["']?\]\{([^}]+)\}/g)].map((m) => m[1]).join(";");
    assert.ok(rootBlock.length > 0, "expected :root token block");
    assert.ok(lightBlock.length > 0, "expected :root[data-theme=light] token block");
    const familyTokens = [
      "--bg", "--s1", "--s2", "--s3", "--s0",
      "--t1", "--t2", "--t3",
      "--ln", "--l2", "--ls", "--sh",
      "--ac", "--ah", "--as", "--ab", "--cb", "--ct",
      "--ok", "--wn", "--er", "--in",
    ];
    for (const tok of familyTokens) {
      assert.ok(rootBlock.includes(`${tok}:`), `dark :root missing token ${tok}`);
      assert.ok(lightBlock.includes(`${tok}:`), `light :root[data-theme=light] missing token ${tok}`);
    }
    assert.ok(!/(?:^|[},])\.wn\{/.test(css), "standalone .wn box rule must not collide with .ed.wn/.rd.wn dots");
    assert.ok(/--ac\s*:\s*#6895ff\b/i.test(rootBlock), `dark --ac must be #6895FF, got: ${rootBlock}`);
    assert.ok(/--ok\s*:\s*#34d399\b/i.test(rootBlock), `dark --ok must be #34D399, got: ${rootBlock}`);
    assert.ok(/--bg\s*:\s*#f8fafd\b/i.test(lightBlock), `light --bg must be #F8FAFD, got: ${lightBlock}`);
    assert.ok(/--ac\s*:\s*#2952cc\b/i.test(lightBlock), `light --ac must be #2952CC, got: ${lightBlock}`);
    assert.ok(/--ok\s*:\s*#059669\b/i.test(lightBlock), `light --ok must be #059669, got: ${lightBlock}`);
    assert.ok(!css.includes("--buncss-"), "panel.html must not contain --buncss-* declarations");

    // Stage, dimming, reduced-motion, and capability invariants
    assert.ok(css.includes("filter:brightness(.7)"), "stage canvas dimming must use filter:brightness(.7)");
    assert.ok(css.includes("prefers-reduced-motion"));
    assert.ok(css.includes("container-type:size") && css.includes("100cqw") && css.includes("100cqh"));
    assert.ok(css.includes("max-width:calc(100vw - 16px)") || css.includes("max-width:calc(100vw-16px)"));
    assert.ok(html.includes("createImageBitmap"));
    assert.ok(html.includes("IntersectionObserver"));
    assert.ok(html.includes("pointerenter"));
    assert.ok(html.includes("pageshow"));
    assert.ok(html.includes("displayMode"));
    assert.ok(html.includes("containerDimensions"));
    assert.ok(!html.includes("S.on||S.pf?.valid") && !html.includes("S.on || S.pf?.valid"), "must never auto-dial Chrome when disconnected");

    // RTT telemetry dot thresholds: ok <80ms, wn <200ms, er >=200ms
    assert.equal(rttBand(0), "ok");
    assert.equal(rttBand(42), "ok");
    assert.equal(rttBand(79), "ok");
    assert.equal(rttBand(80), "wn");
    assert.equal(rttBand(199), "wn");
    assert.equal(rttBand(200), "er");
    assert.equal(rttBand(520), "er");
  });

  it("ignores transparent or low-alpha --color-background-primary and parses alpha in parseColorLum()", () => {
    const props = new Map<string, string>();
    const fakeEl: BridgeStyleTarget = {
      style: {
        setProperty(k: string, v: string) {
          props.set(k, v);
        },
      },
    };

    for (const bad of [
      "",
      "   ",
      "transparent",
      "Transparent",
      "rgba(0, 0, 0, 0)",
      "rgba(255, 255, 255, 0)",
      "rgba(20, 19, 17, 0.5)",
      "rgba(20, 19, 17, 0.89)",
      "rgb(0 0 0 / 0)",
      "rgb(255 255 255 / 50%)",
      "#00000000",
      "#0B0D1280",
      "#0000",
      "hsla(0, 0%, 100%, 0)",
    ]) {
      props.clear();
      applyHostStyleVariables(
        {
          "--color-background-primary": bad,
          "--color-text-primary": "#F2F4F8",
        },
        fakeEl
      );
      assert.equal(
        props.has("--color-background-primary"),
        false,
        `expected --color-background-primary=${JSON.stringify(bad)} to be ignored`
      );
      assert.equal(props.get("--color-text-primary"), "#F2F4F8");
    }

    for (const ok of ["#0B0D12", "#F8FAFD", "#0B0D12ff", "rgb(11, 13, 18)", "rgba(11, 13, 18, 0.95)", "rgb(248 250 253 / 95%)"]) {
      props.clear();
      applyHostStyleVariables({ "--color-background-primary": ok }, fakeEl);
      assert.equal(props.get("--color-background-primary"), ok, `expected opaque ${ok} to be applied`);
    }

    assert.equal(parseColorLum("transparent"), null);
    assert.equal(parseColorLum("rgba(255, 255, 255, 0)"), null);
    assert.equal(parseColorLum("rgba(255, 255, 255, 0.49)"), null);
    assert.equal(parseColorLum("rgb(255 255 255 / 40%)"), null);
    assert.equal(parseColorLum("#ffffff00"), null);
    assert.equal(parseColorLum("#ffffff40"), null);
    assert.ok((parseColorLum("rgba(255, 255, 255, 0.5)") ?? 0) > 0.9);
    assert.ok((parseColorLum("#0B0D12ff") ?? 1) < 0.1);
    assert.ok((parseColorLum("#F8FAFD") ?? 0) > 0.9);
  });

  it("resolves bilingual locale and computes RTT-adaptive idle/hidden poll timings", () => {
    assert.equal(parsePanelLocaleTag("C"), null);
    assert.equal(parsePanelLocaleTag("POSIX"), null);
    assert.equal(parsePanelLocaleTag("zh_TW"), "zh-CN");
    assert.equal(parsePanelLocaleTag("ja-JP"), "en");
    assert.equal(resolvePanelLang({ saved: "en", hostLocale: "zh-CN", navLang: "zh-CN" }), "en");
    assert.equal(resolvePanelLang({ saved: "", hostLocale: "zh-Hans-CN", navLang: "en-US" }), "zh-CN");
    assert.equal(resolvePanelLang({ saved: "", hostLocale: "", navLang: "fr-FR", bootLocale: "zh-CN" }), "en");
    assert.equal(resolvePanelLang({}), "en");

    const net = new AdaptiveBandwidthController("auto");
    assert.deepEqual(net.computePollTiming({ idleMs: 15000, inputBusy: false, screencastIdle: true }), {
      waitMs: 0,
      nextDelayMs: 4000,
    });

    // Uncalibrated / fast RTT (< 140ms)
    assert.deepEqual(net.computePollTiming({ hidden: true, idleMs: 0 }), { waitMs: 0, nextDelayMs: 2000 });
    assert.equal(net.computeOfflinePollDelay({ hidden: true }), 3000);
    assert.equal(net.computeOfflinePollDelay({ hidden: false }), 3000);

    // Fast calibrated (60ms) + error backoff
    net.recordSample({ totalMs: 160, serverMs: 100, imageBytes: 5000, now: 1000 });
    assert.deepEqual(net.computePollTiming({ hidden: true }), { waitMs: 0, nextDelayMs: 2000 });
    assert.deepEqual(net.computePollTiming({ hidden: true, errCount: 1 }), { waitMs: 0, nextDelayMs: 4000 });
    assert.deepEqual(net.computePollTiming({ hidden: true, errCount: 2 }), { waitMs: 0, nextDelayMs: 8000 });

    // Medium RTT (200ms)
    const netMed = new AdaptiveBandwidthController("auto");
    netMed.recordSample({ totalMs: 250, serverMs: 50, imageBytes: 5000, now: 1000 });
    assert.deepEqual(netMed.computePollTiming({ hidden: true }), { waitMs: 0, nextDelayMs: 4000 });
    assert.equal(netMed.computeOfflinePollDelay({ hidden: true }), 5000);

    // Slow RTT (500ms)
    const netSlow = new AdaptiveBandwidthController("auto");
    netSlow.recordSample({ totalMs: 550, serverMs: 50, imageBytes: 5000, now: 1000 });
    assert.deepEqual(netSlow.computePollTiming({ hidden: true }), { waitMs: 0, nextDelayMs: 8000 });
    assert.equal(netSlow.computeOfflinePollDelay({ hidden: true }), 7500);

    // Ultra-slow RTT (900ms) + error backoff cap
    const netUltra = new AdaptiveBandwidthController("auto");
    netUltra.recordSample({ totalMs: 950, serverMs: 50, imageBytes: 5000, now: 1000 });
    assert.deepEqual(netUltra.computePollTiming({ hidden: true }), { waitMs: 0, nextDelayMs: 12000 });
    assert.deepEqual(netUltra.computePollTiming({ hidden: true, errCount: 3 }), { waitMs: 0, nextDelayMs: 30000 });
    assert.equal(netUltra.computeOfflinePollDelay({ hidden: true }), 10000);
    assert.equal(netUltra.computeOfflinePollDelay({ hidden: true, errCount: 2 }), 30000);

    // Weak-net idle/offline RTT floor: >= max(baseMs, min(15_000, round(ewmaRttMs * 3)))
    const net300 = new AdaptiveBandwidthController("auto");
    net300.recordSample({ totalMs: 300, serverMs: 0, imageBytes: 5000, now: 1000 });
    assert.ok(net300.computePollTiming({ idleMs: 1500, settled: true }).nextDelayMs >= 900);
    assert.ok(net300.computePollTiming({ idleMs: 4000 }).nextDelayMs >= 900);
    assert.ok(net300.computePollTiming({ idleMs: 15000 }).nextDelayMs >= 900);
    assert.ok(net300.computeOfflinePollDelay({ hidden: false }) >= 900);

    const netExtreme = new AdaptiveBandwidthController("auto");
    netExtreme.recordSample({ totalMs: 6000, serverMs: 0, imageBytes: 5000, now: 1000 });
    assert.equal(netExtreme.computePollTiming({ idleMs: 4000 }).nextDelayMs, 15000);
    assert.equal(netExtreme.computeOfflinePollDelay({ hidden: false }), 15000);
  });

  it("wires reveal observers (ResizeObserver, IntersectionObserver, hostContext, pointerenter), throttles, and tears down cleanly", () => {
    const makeEmitter = () => {
      const listeners = new Map<string, Array<{ fn: (arg?: any) => void; opts?: AddEventListenerOptions | boolean }>>();
      return {
        listeners,
        addEventListener(ev: string, fn: (arg?: any) => void, opts?: AddEventListenerOptions | boolean) {
          if (!listeners.has(ev)) listeners.set(ev, []);
          listeners.get(ev)!.push({ fn, opts });
        },
        removeEventListener(ev: string, fn: (arg?: any) => void) {
          const arr = listeners.get(ev);
          if (!arr) return;
          listeners.set(ev, arr.filter((x) => x.fn !== fn));
        },
        emit(ev: string, arg?: unknown) {
          for (const item of [...(listeners.get(ev) || [])]) item.fn(arg);
        },
      };
    };

    const rootEl = { ...makeEmitter(), clientWidth: 0, clientHeight: 0 };
    const fakeDoc = { ...makeEmitter(), documentElement: rootEl, visibilityState: "hidden" };
    const fakeWin = makeEmitter();
    let baseHostCtxCalls = 0;
    const fakeApp = {
      onhostcontextchanged: (_delta: Record<string, unknown>) => {
        baseHostCtxCalls += 1;
      },
    };

    let roCb: ((entries: ReadonlyArray<{ contentRect?: { width: number; height: number } }>) => void) | null = null;
    let roDisconnected = false;
    let roTarget: unknown = null;
    class FakeRO {
      constructor(cb: (entries: ReadonlyArray<{ contentRect?: { width: number; height: number } }>) => void) { roCb = cb; }
      observe(el: unknown) { roTarget = el; }
      disconnect() { roDisconnected = true; }
    }

    let ioCb: ((entries: ReadonlyArray<{ isIntersecting?: boolean }>) => void) | null = null;
    let ioOpts: { threshold?: number } | undefined;
    let ioDisconnected = false;
    let ioTarget: unknown = null;
    class FakeIO {
      constructor(cb: (entries: ReadonlyArray<{ isIntersecting?: boolean }>) => void, opts?: { threshold?: number }) { ioCb = cb; ioOpts = opts; }
      observe(el: unknown) { ioTarget = el; }
      disconnect() { ioDisconnected = true; }
    }

    let tNow = 1000, lastFetchAt = 1000, reveals = 0, hides = 0;
    const stop = setupRevealObservers({
      rootDoc: fakeDoc,
      rootWin: fakeWin,
      bridgeApp: fakeApp,
      onReveal: () => { reveals += 1; },
      onHide: () => { hides += 1; },
      getLastFetchAt: () => lastFetchAt,
      clock: () => tNow,
      ResizeObs: FakeRO,
      IntersectionObs: FakeIO,
    });

    assert.equal(roTarget, rootEl);
    assert.equal(ioTarget, rootEl);
    assert.deepEqual(ioOpts, { threshold: 0 });

    // ResizeObserver: collapsed -> visible triggers reveal; already visible resize does not; rapid edge throttled within 250ms
    roCb!([{ contentRect: { width: 0, height: 0 } }]);
    assert.equal(reveals, 0);
    roCb!([{ contentRect: { width: 420, height: 600 } }]);
    assert.equal(reveals, 1);
    tNow += 300;
    roCb!([{ contentRect: { width: 520, height: 640 } }]);
    assert.equal(reveals, 1);

    // IntersectionObserver: !wasVis -> isIntersecting triggers reveal; throttle suppresses immediate duplicate
    ioCb!([{ isIntersecting: false }]);
    assert.equal(reveals, 1);
    ioCb!([{ isIntersecting: true }]);
    assert.equal(reveals, 2);
    tNow += 100;
    ioCb!([{ isIntersecting: false }, { isIntersecting: true }]);
    assert.equal(reveals, 2);
    tNow += 300;
    ioCb!([{ isIntersecting: false }]);
    ioCb!([{ isIntersecting: true }]);
    assert.equal(reveals, 3);

    // hostContextChanged triggers only for containerDimensions / displayMode
    fakeApp.onhostcontextchanged({ theme: "dark" });
    assert.equal(baseHostCtxCalls, 1);
    assert.equal(reveals, 3);
    tNow += 300;
    fakeApp.onhostcontextchanged({ containerDimensions: { width: 480 } });
    assert.equal(baseHostCtxCalls, 2);
    assert.equal(reveals, 4);
    tNow += 300;
    fakeApp.onhostcontextchanged({ displayMode: "fullscreen" });
    assert.equal(reveals, 5);

    // pointerenter: passive:true, only fires when stale > 900ms
    const ptrEntries = rootEl.listeners.get("pointerenter")!;
    assert.equal(ptrEntries.length, 1);
    assert.deepEqual(ptrEntries[0].opts, { passive: true });
    lastFetchAt = tNow - 500;
    tNow += 300;
    rootEl.emit("pointerenter");
    assert.equal(reveals, 5);
    lastFetchAt = tNow - 950;
    rootEl.emit("pointerenter");
    assert.equal(reveals, 6);

    // visibilitychange, focus, pageshow
    fakeDoc.visibilityState = "hidden";
    fakeDoc.emit("visibilitychange");
    assert.equal(hides, 1);
    tNow += 300;
    fakeDoc.visibilityState = "visible";
    fakeDoc.emit("visibilitychange");
    assert.equal(reveals, 7);
    tNow += 300;
    fakeWin.emit("focus");
    assert.equal(reveals, 8);
    tNow += 300;
    fakeWin.emit("pageshow");
    assert.equal(reveals, 9);

    // Teardown cleanly disconnects observers and removes listeners
    stop();
    assert.equal(roDisconnected, true);
    assert.equal(ioDisconnected, true);
    assert.equal(fakeDoc.listeners.get("visibilitychange")!.length, 0);
    assert.equal(fakeWin.listeners.get("focus")!.length, 0);
    assert.equal(fakeWin.listeners.get("pageshow")!.length, 0);
    assert.equal(rootEl.listeners.get("pointerenter")!.length, 0);
    fakeApp.onhostcontextchanged({ displayMode: "inline" });
    assert.equal(reveals, 9);
    assert.equal(baseHostCtxCalls, 4);
  });

  it("boots built panel.html cleanly in sandboxed vm (throwing localStorage + strict WebIDL timers + targetEpoch/staleTarget)", async () => {
    const html = fs.readFileSync(path.join(__dirname, "dist", "panel.html"), "utf8");
    const match = html.match(/<script(?:\s+type="module")?>\/\*__CHROME_STREAM_BOOT__\*\/([\s\S]*?)<\/script>/);
    assert.ok(match, "built panel.html must contain single merged inline bundle script");
    const js = match[1];

    const els = new Map<string, MockElement>();
    const mkEl = (tag = "div"): MockElement => {
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Array<(arg?: any) => void>>();
      const kids: MockElement[] = [];
      let _id = "";
      const node: MockElement = {
        tagName: tag.toUpperCase(),
        style: { setProperty() {}, colorScheme: "", backgroundColor: "", transform: "", left: "", top: "" },
        dataset: {},
        hidden: false,
        textContent: "",
        value: "",
        title: "",
        className: "",
        classList: { toggle() {}, remove() {}, add() {} },
        get id() { return _id; },
        set id(v: string) { _id = String(v || ""); if (_id) els.set(_id, node); },
        get firstChild() { return kids[0] || null; },
        get lastChild() { return kids[kids.length - 1] || null; },
        get nextSibling() { return null; },
        setAttribute(k: string, v: string) { attrs.set(k, String(v)); },
        getAttribute(k: string) { return attrs.get(k) || null; },
        addEventListener(ev: string, fn: (arg?: any) => void) {
          if (!listeners.has(ev)) listeners.set(ev, []);
          listeners.get(ev)!.push(fn);
        },
        removeEventListener(ev: string, fn: (arg?: any) => void) {
          listeners.set(ev, (listeners.get(ev) || []).filter((f) => f !== fn));
        },
        querySelector() { return mkEl(); },
        querySelectorAll(sel: string) {
          const out: MockElement[] = [];
          const walk = (n: MockElement) => {
            if (!n || !n.children) return;
            for (const c of n.children) {
              if (sel === "[data-i],[data-a],[data-p],[data-t]" && (c.dataset?.i || c.dataset?.a || c.dataset?.p || c.dataset?.t)) out.push(c);
              else if (sel === "[data-k],[data-sc]" && (c.dataset?.k || c.dataset?.sc)) out.push(c);
              else if (sel === "[data-i]" && c.dataset?.i) out.push(c);
              else if (sel === "[data-a]" && c.dataset?.a) out.push(c);
              else if (sel === "[data-p]" && c.dataset?.p) out.push(c);
              else if (sel === "[data-k]" && c.dataset?.k) out.push(c);
              else if (sel === "[data-sc]" && c.dataset?.sc) out.push(c);
              walk(c);
            }
          };
          walk(node);
          return out;
        },
        children: kids,
        append(...items: Array<MockElement & { __frag?: boolean }>) {
          for (const it of items) {
            if (it?.__frag) kids.push(...it.children);
            else if (it) kids.push(it);
          }
        },
        appendChild(it: MockElement | null) { if (it) kids.push(it); return it; },
        replaceChildren(...items: Array<MockElement & { __frag?: boolean }>) { kids.length = 0; node.append(...items); },
        insertBefore(it: MockElement | null) { if (it) kids.push(it); return it; },
        remove() {},
        closest() { return null; },
        focus() {},
        select() {},
        getContext() { return { drawImage() {} }; },
        getBoundingClientRect() { return { left: 120, right: 240, top: 40, bottom: 68, width: 400, height: 600 }; },
        clientWidth: 0,
        clientHeight: 0,
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
      visibilityState: "hidden",
      getElementById(id: string) {
        if (!els.has(id)) {
          const created = mkEl(id);
          created.id = id;
        }
        return els.get(id)!;
      },
      createElement(t: string) { return mkEl(t); },
      createElementNS(_ns: string, t: string) { return mkEl(t); },
      createTextNode(t: string) { return { nodeType: 3, textContent: String(t) }; },
      createDocumentFragment() { const f = mkEl("frag"); f.__frag = true; return f; },
    };

    const posted: PostedMessage[] = [];
    const winListeners = new Map<string, Array<(ev: unknown) => void>>();
    const win = {
      parent: { postMessage(msg: PostedMessage) { posted.push(msg); } },
      addEventListener(ev: string, fn: (ev: unknown) => void) {
        if (!winListeners.has(ev)) winListeners.set(ev, []);
        winListeners.get(ev)!.push(fn);
      },
      removeEventListener(ev: string, fn: (ev: unknown) => void) {
        winListeners.set(ev, (winListeners.get(ev) || []).filter((f) => f !== fn));
      },
      innerWidth: 400,
    };

    const activeTimers = new Set<ReturnType<typeof setTimeout>>();
    let roCb: ((entries: ReadonlyArray<{ contentRect?: { width: number; height: number } }>) => void) | null = null;
    let roDisc = false;
    let ioDisc = false;
    let fakeNowMs = 10_000;

    const ctx = vm.createContext({
      window: win,
      document: doc,
      navigator: { language: "en-US" },
      performance: { now: () => fakeNowMs },
      console,
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
      cancelAnimationFrame: clearTimeout,
      ResizeObserver: class {
        constructor(cb: (entries: ReadonlyArray<{ contentRect?: { width: number; height: number } }>) => void) { roCb = cb; }
        observe() {}
        disconnect() { roDisc = true; }
      },
      IntersectionObserver: class {
        observe() {}
        disconnect() { ioDisc = true; }
      },
      Image: class {},
      Map, Set, Array, Object, Math, JSON, RegExp, Promise, Error, Number, String, Boolean,
      Date: { now: () => fakeNowMs },
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
      __CHROME_STREAM_BOOT__: {
        connected: true,
        paused: false,
        tabs: [{ targetId: "t1", title: "Home", url: "https://a.test" }],
        activeTargetId: "t1",
        seq: 1,
        frameHash: "h1",
      } satisfies FramePayload,
    });
    const vmGlobal = vm.runInContext("globalThis", ctx) as object;

    Object.defineProperty(ctx, "localStorage", {
      configurable: true,
      get() {
        const err = new Error("Blocked localStorage in sandboxed iframe");
        err.name = "SecurityError";
        throw err;
      },
    });
    ctx.setTimeout = function strictSetTimeout(this: unknown, fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) {
      if (this && this !== vmGlobal && this !== globalThis) throw new TypeError("Illegal invocation");
      const id = setTimeout(() => {
        activeTimers.delete(id);
        fn(...args);
      }, ms);
      activeTimers.add(id);
      return id;
    };
    ctx.clearTimeout = function strictClearTimeout(this: unknown, id: ReturnType<typeof setTimeout>) {
      if (this && this !== vmGlobal && this !== globalThis) throw new TypeError("Illegal invocation");
      activeTimers.delete(id);
      clearTimeout(id);
    };

    try {
      vm.runInContext(js, ctx);

      const initReq = posted.find((m) => m.method === "ui/initialize");
      assert.ok(initReq, "panel must send ui/initialize without crashing on blocked localStorage");
      const msgHandler = winListeners.get("message")?.[0];
      assert.equal(typeof msgHandler, "function");

      // First handshake fails (bad protocolVersion) -> listener removed -> Retry (#er) re-attaches & succeeds!
      msgHandler!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: initReq.id,
          result: { protocolVersion: "2024-01-01", hostContext: { theme: "dark" }, hostCapabilities: { serverTools: {} } },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal((winListeners.get("message") || []).length, 0, "failed handshake must remove message listener");
      assert.equal(els.get("ob")!.disabled, true, "controls must stay gated before handshake succeeds");

      // Click Retry (#er) to re-run ui/initialize handshake
      els.get("er")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const initReq2 = posted.filter((m) => m.method === "ui/initialize").pop();
      assert.ok(initReq2 && initReq2.id !== initReq.id, "Retry must send a fresh ui/initialize");
      const msgHandler2 = winListeners.get("message")?.[0];
      assert.equal(typeof msgHandler2, "function", "Retry must re-attach message listener");
      msgHandler2!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: initReq2.id,
          result: { protocolVersion: "2026-01-26", hostContext: { theme: "dark" }, hostCapabilities: { serverTools: {} } },
        },
      });
      await new Promise((r) => setTimeout(r, 15));

      // Verify + New tab button (#nt) is pinned outside [role=tablist] (#tb)
      assert.equal(els.get("tb")!.children.includes(els.get("nt")!), false, "+ button must live outside scrolling tablist");

      const frameCalls = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame");
      assert.ok(frameCalls.length >= 1, "panel must start background polling when hidden");
      assert.equal(frameCalls[0].params!.arguments!.waitMs, 0);

      msgHandler2!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: frameCalls[0].id,
          result: {
            structuredContent: {
              connected: true,
              activeTargetId: "t1",
              changed: false,
              unchanged: true,
              screencastPausedIdle: true,
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));

      fakeNowMs += 300;
      roCb!([{ contentRect: { width: 420, height: 600 } }]);
      await new Promise((r) => setTimeout(r, 10));

      const callsAfterReveal = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame");
      assert.ok(callsAfterReveal.length >= 2, "ResizeObserver reveal must trigger immediate refresh");
      assert.equal(callsAfterReveal[callsAfterReveal.length - 1].params!.arguments!.forceRefresh, true);

      // Calibrate fast RTT (50ms -> "high") and crisp WebP + Remote mode on reveal frame response
      fakeNowMs += 50;
      msgHandler2!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: callsAfterReveal[callsAfterReveal.length - 1].id,
          result: {
            structuredContent: {
              connected: true,
              activeTargetId: "t1",
              connectionMode: "remote",
              remotePort: 9223,
              crisp: true,
              format: "webp",
              changed: false,
              unchanged: true,
              serverMs: 10,
              screencastPausedIdle: false,
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("qh")!.hidden, false, "HD cue must surface on crisp WebP");
      assert.equal(els.get("rm")!.hidden, false, "Separate chip must surface in remote mode");
      assert.equal(els.get("rm")!.textContent, "Separate", "Separate chip must show clean human badge");

      // Trigger an input batch (`chrome_stream_input`) with a slow 1200ms response:
      // flIn MUST send targetEpoch AND MUST NOT pollute AdaptiveBandwidthController RTT EWMA!
      els.get("rl")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const inCall = posted.find((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input");
      assert.ok(inCall, "reload click must dispatch chrome_stream_input");
      assert.equal(inCall.params!.arguments!.targetEpoch, 1, "page input must bind targetEpoch");
      fakeNowMs += 1200;
      msgHandler2!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: inCall.id,
          result: {
            structuredContent: {
              ok: false,
              connected: true,
              staleTarget: true,
              epoch: 4,
              connectionMode: "remote",
              activeTargetId: "t1",
              serverMs: 1180,
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(els.get("sm")!.textContent, "Separate Chrome", "popover mode must reflect remote connectionMode");
      const prePausePoll = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame").pop();
      if (prePausePoll) {
        msgHandler2!({
          source: win.parent,
          data: { jsonrpc: "2.0", id: prePausePoll.id, result: { structuredContent: { connected: true, activeTargetId: "t1", changed: false, unchanged: true } } },
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // Standby (#bp) awaits server confirmation; error MUST NOT flip UI to paused!
      els.get("bp")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const pauseFailCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").pop();
      assert.equal(pauseFailCall?.params?.arguments?.events?.[0]?.action, "pause");
      assert.equal(els.get("bp")!.getAttribute("aria-pressed"), "false", "Standby must NOT flip optimistically before confirmation");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: pauseFailCall!.id, result: { structuredContent: { ok: false, connected: true, error: "relay busy" } } },
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(els.get("bp")!.getAttribute("aria-pressed"), "false", "failed Standby must keep live state");
      assert.equal(els.get("bn")!.hidden, false, "failed Standby must surface error banner");
      // Follow-up live poll (20ms later) MUST NOT wipe sticky Standby failure banner
      const stickyPoll1 = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame").pop();
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: stickyPoll1!.id, result: { structuredContent: { connected: true, activeTargetId: "t1", changed: false, unchanged: true } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("bn")!.hidden, false, "follow-up live poll must NOT erase sticky Standby failure banner");
      assert.equal(els.get("dm")!.textContent, "Couldn't pause. Try again.");

      // Confirmed Standby flips UI and clears sticky control error, then confirmed Wake resumes
      els.get("bp")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const pauseCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").pop();
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: pauseCall!.id, result: { structuredContent: { ok: true, connected: true, paused: true, pauseEpoch: 4 } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("bp")!.getAttribute("aria-pressed"), "true", "confirmed Standby must update UI");
      assert.equal(els.get("bn")!.hidden, true, "confirmed Standby must clear sticky error banner");

      els.get("bp")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const resumeCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").pop();
      assert.equal(resumeCall?.params?.arguments?.events?.[0]?.action, "resume");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: resumeCall!.id, result: { structuredContent: { ok: true, connected: true, paused: false, pauseEpoch: 5 } } },
      });
      await new Promise((r) => setTimeout(r, 30));

      const callsAfterSlowInput = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame");
      const lastCall = callsAfterSlowInput[callsAfterSlowInput.length - 1];
      assert.equal(
        lastCall.params!.arguments!.qualityPreset,
        "high",
        "slow chrome_stream_input RPC must not downgrade frame qualityPreset"
      );

      // Delayed Cmd+V fallback timer (45ms) MUST abort if popupSwitched mutates S.aid/S.tep before it fires
      const inputCountBeforePaste = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").length;
      els.get("st")!.listeners.get("keydown")?.[0]?.({
        target: els.get("si"),
        key: "v",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        keyCode: 86,
        preventDefault() {},
      });
      msgHandler2!({
        source: win.parent,
        data: {
          jsonrpc: "2.0",
          id: lastCall.id,
          result: {
            structuredContent: {
              connected: true,
              activeTargetId: "t-popup",
              epoch: 5,
              popupSwitched: true,
              tabs: [{ targetId: "t1" }, { targetId: "t-popup" }],
              changed: false,
              unchanged: true,
            },
          },
        },
      });
      await new Promise((r) => setTimeout(r, 140));
      const inputCountAfterPaste = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").length;
      assert.equal(inputCountAfterPaste, inputCountBeforePaste, "delayed Paste fallback must be dropped when popupSwitched mutates target/epoch");
      const preStandbyPoll = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame").pop();
      if (preStandbyPoll && preStandbyPoll.id !== lastCall.id) {
        msgHandler2!({
          source: win.parent,
          data: { jsonrpc: "2.0", id: preStandbyPoll.id, result: { structuredContent: { connected: true, activeTargetId: "t-popup", changed: false, unchanged: true } } },
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      // Primary Standby (#dc): unconfirmed error MUST keep panel online & banner sticky across live poll
      els.get("dc")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const standbyFailCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(standbyFailCall?.params?.arguments?.mode, "standby");
      assert.equal(els.get("vn")!.hidden, false, "Standby must NOT switch view optimistically before confirmation");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: standbyFailCall!.id, result: { structuredContent: { ok: false, unconfirmed: true, error: "relay busy" } } },
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(els.get("vn")!.hidden, false, "unconfirmed Standby must remain online for retry");
      const stickyPoll2 = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_frame").pop();
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: stickyPoll2!.id, result: { structuredContent: { connected: true, activeTargetId: "t-popup", changed: false, unchanged: true } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("bn")!.hidden, false, "follow-up live poll must NOT erase sticky Standby failure banner");
      // Dismiss (#dx) clears sticky banner
      els.get("dx")!.listeners.get("click")?.[0]?.();
      assert.equal(els.get("bn")!.hidden, true, "Dismiss must clear sticky control error");

      // Retry Standby (#dc) and confirm connected:true, paused:true, standby:true -> enters Standby Ready card (#vo)
      els.get("dc")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const standbyOkCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(standbyOkCall?.params?.arguments?.mode, "standby");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: standbyOkCall!.id, result: { structuredContent: { ok: true, connected: true, paused: true, standby: true, pauseEpoch: 6 } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("vo")!.hidden, false, "confirmed Standby must show Standby Ready card");
      assert.equal(els.get("op")!.textContent, "Standby · Grant Kept");
      assert.equal(els.get("ob")!.textContent, "Resume Stream");
      assert.equal(els.get("orv")!.hidden, false, "Standby Ready card must expose Revoke Grant button");

      // Resume Stream (#ob) from Standby Ready -> sends resume without re-dialing connect, returns to live #vn
      els.get("ob")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const resumeStandbyCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_input").pop();
      assert.equal(resumeStandbyCall?.params?.arguments?.events?.[0]?.action, "resume");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: resumeStandbyCall!.id, result: { structuredContent: { ok: true, connected: true, paused: false, pauseEpoch: 7 } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("vn")!.hidden, false, "confirmed Resume Stream must return to live view");

      // Explicit Revoke (#rv) in live view sends mode:revoke -> confirmed connected:false -> Offline card
      els.get("rv")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const discOkCall = posted.filter((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_disconnect").pop();
      assert.equal(discOkCall?.params?.arguments?.mode, "revoke");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: discOkCall!.id, result: { structuredContent: { ok: true, connected: false } } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(els.get("vo")!.hidden, false, "confirmed Revoke must switch to offline view");
      assert.equal(els.get("orv")!.hidden, true, "Offline view must hide Revoke Grant button");

      // Connect Personal Chrome (#ob) MUST send explicit mode:"personal"
      els.get("ob")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const personalCall = posted.find((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_connect");
      assert.equal(personalCall?.params?.arguments?.mode, "personal", "Personal Chrome button must send explicit mode:personal");
      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: personalCall!.id, result: { structuredContent: { connected: false } } },
      });
      await new Promise((r) => setTimeout(r, 10));

      // Offline Launch Remote (#ol) calls chrome_stream_launch
      els.get("ol")!.listeners.get("click")?.[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      const launchCall = posted.find((m) => m.method === "tools/call" && m.params?.name === "chrome_stream_launch");
      assert.ok(launchCall, "Launch Remote Chrome button must call chrome_stream_launch");

      msgHandler2!({
        source: win.parent,
        data: { jsonrpc: "2.0", id: 999, method: "ui/resource-teardown", params: {} },
      });
      assert.equal(roDisc, true);
      assert.equal(ioDisc, true);
    } finally {
      for (const id of activeTimers) clearTimeout(id);
      activeTimers.clear();
    }
  });

  it("resolveStageAspect locks viewport aspect across all quality tiers without zoom jitter", () => {
    for (const [imgW, imgH] of [
      [800, 500],
      [798, 500],
      [960, 600],
      [1152, 720],
      [1440, 900],
      [2880, 1800],
    ]) {
      assert.equal(resolveStageAspect(1440, 900, imgW, imgH), 1.6);
    }

    assert.equal(resolveStageAspect(400, 850, 245, 520), 0.4706);
    assert.equal(resolveStageAspect(1280, 800, 419, 520), +(419 / 520).toFixed(4));
    assert.equal(resolveStageAspect(0, 0, 960, 600), 1.6);
    assert.equal(resolveStageAspect(0, 0, 0, 0), 0);
  });

  it("isSafeImageUrl allows only base64 raster jpeg/webp/png data URLs", () => {
    assert.equal(isSafeImageUrl("data:image/jpeg;base64,/9j/4AAQ"), true);
    assert.equal(isSafeImageUrl("data:image/webp;base64,UklGRg=="), true);
    assert.equal(isSafeImageUrl("data:image/png;base64,iVBORw0KGgo="), true);
    assert.equal(isSafeImageUrl("DATA:IMAGE/PNG;BASE64,iVBORw0KGgo="), true);
    assert.equal(isSafeImageUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
    assert.equal(isSafeImageUrl("data:image/svg+xml,<svg/>"), false);
    assert.equal(isSafeImageUrl("data:image/png,not-base64"), false);
    assert.equal(isSafeImageUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isSafeImageUrl("https://example.com/a.png"), false);
  });
});
