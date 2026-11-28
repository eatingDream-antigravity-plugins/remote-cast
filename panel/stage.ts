import { App, applyHostContext } from "./kit/bridge.ts";
import type { HostContext } from "./kit/bridge.ts";
import {
  AdaptiveBandwidthController, applyFramePayloadState, applyOptimisticTabClose, coalesceInputEvents,
  isBusyErrorText, isNoTabsPayload, isSafeImageUrl, isTargetErrorText, mapBridgeErrorKey, REP, resolvePanelLang,
  resolveStageAspect, rttBand, setupRevealObservers,
} from "./net-policy.ts";
import type { FramePayload, InputEventPayload, PanelLang, PanelState, PortFileInfo, QualityMode, TabInfo } from "./net-policy.ts";
import { I18N } from "./i18n.ts";
import type { I18nDict } from "./i18n.ts";

type Tm = ReturnType<typeof setTimeout> | number;
type HChild = Node | string | false | null | undefined | HSpec;
type HSpec = readonly [string, (string | 0)?, ...HChild[]];
type BootPayload = FramePayload & { locale?: string; qualityApplied?: string; appVersion?: string; relayVersion?: string };
type CfgState = { lang: string; defaultQuality: string; defaultConnectMode: string; bgPollIntervalSec: number; idlePauseSec: number; wheelCoalesceMs?: number; newTabUrl?: string };

const doc = document;
const b0: BootPayload = (globalThis as { __CHROME_STREAM_BOOT__?: BootPayload }).__CHROME_STREAM_BOOT__ || {};
const fin = Number.isFinite, rnd = Math.round, isA = Array.isArray;
const on = (n: EventTarget | null | undefined, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions | boolean): void => { n?.addEventListener(ev, fn, o); };
const ck = (n: EventTarget | null | undefined, fn: (e: any) => void): void => on(n, "click", fn);
const sa = (n: Element | null | undefined, k: string, v: string | number | boolean): void => { n?.setAttribute(k, String(v)); };
const pd = (e: { preventDefault(): void }): void => e.preventDefault();
const tx = (n: { textContent: string | null }, v: string): void => { if (n.textContent !== v) n.textContent = v; };
const hd = (n: { hidden: boolean }, v: unknown): boolean => (n.hidden = !!v);
const tg = (n: Element, c: string, v: unknown): boolean => n.classList.toggle(c, !!v);
const pNow = (): number => performance.now(), nowMs = (): number => Date.now(), cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const sTm = (f: () => void, m?: number): Tm => globalThis.setTimeout(f, m), cTm = (i: Tm): void => globalThis.clearTimeout(i as ReturnType<typeof setTimeout>), hid = (): boolean => doc.visibilityState === "hidden";
const isMac = /mac/i.test(navigator?.platform || navigator?.userAgent || "");
const root = doc.getElementById("app") as HTMLElement, app = App({ name: "Remote Cast", version: b0.appVersion || b0.relayVersion || "0.1.0" }, {}), net = new AdaptiveBandwidthController("auto");
const KEYS = new Set<string>([...REP, "Enter", "Escape", "Home", "End", "Space"]);
const QK = "auto ultra low medium high".split(" "), IK = "Enter Escape Tab Backspace Undo Copy Paste SelectAll".split(" ");
const DLG = "alert confirm prompt beforeunload".split(" "), DLG_K = "da df dp dl".split(" ");
const PAGE_ACT = new Set<string>("click mousedown mouseup mousemove scroll type key dialog navigate back forward reload close_tab".split(" "));
const BN = ["left", "middle", "right"] as const, BM = [1, 4, 2] as const;
const ls = (k: string, v?: string): string => { try { return v === undefined ? localStorage.getItem(k) || "" : (localStorage.setItem(k, v), ""); } catch { return ""; } };
type SwrBlob = { v?: number; savedAt?: number; data?: BootPayload };
const SWR_K = "chrome_stream_swr";
const readSwr = (): SwrBlob | null => {
  try {
    const r = ls(SWR_K), p = r ? (JSON.parse(r) as SwrBlob) : null;
    return p && p.v === 1 && fin(p.savedAt) && p.data && typeof p.data === "object" ? p : null;
  } catch { return null; }
};
const swr0 = readSwr();
const b0Empty = b0.connected === undefined && !b0.bootTs;
const useSwr = !!swr0 && (b0Empty || (swr0.savedAt as number) > (+(b0.bootTs ?? 0) || 0));
const boot: BootPayload = useSwr ? { ...b0, ...swr0!.data } : b0;
const freshBoot = !useSwr && typeof b0.bootTs === "number" && nowMs() - b0.bootTs < 2500;
const CFGS: readonly [string, string, keyof CfgState, 0 | 1, string][] = [
  ["sl", "lg", "lang", 0, "auto:la|en:=English|zh-CN:=简体中文"],
  ["sq", "dq", "defaultQuality", 0, QK.map((k) => `${k}:q_${k}`).join("|")],
  ["sc", "dc2", "defaultConnectMode", 0, "auto:q_auto|personal:mc|remote:sc"],
  ["sb", "bg", "bgPollIntervalSec", 1, "0:q_auto|5:k5|15:k15|30:k30|-1:bgp"],
  ["si2", "ip2", "idlePauseSec", 1, "12:k12|30:k30|60:k60|0:of"],
];

const D: Record<string, any> = {}, TAGS: Record<string, string> = { b: "button", s: "span", i: "input", l: "select" }, ARIA: Record<string, string> = { e: "expanded", p: "pressed", c: "checked", h: "haspopup", l: "label", i: "hidden", v: "live" };
const h = (sel: string, at?: string | 0, ...kids: HChild[]): HTMLElement => {
  const hid0 = sel.endsWith("!"), sp = (hid0 ? sel.slice(0, -1) : sel).split("#"), tp = sp[0].split(".");
  let raw = tp.shift() || ""; if (raw === "!") { tp.unshift("b"); raw = "b"; }
  const tag = TAGS[raw] || raw || "div", n = doc.createElement(tag) as HTMLElement & { type?: string };
  if (tag === "button") n.type = "button";
  if (tp.length) n.className = tp.join(" ");
  if (sp[1]) D[n.id = sp[1]] = n;
  if (hid0) n.hidden = true;
  if (at) for (const kv of at.split(";")) {
    const j = kv.indexOf("=");
    if (j > 0) {
      const k = kv.slice(0, j), v = kv.slice(j + 1);
      if (k === "t") n.textContent = v;
      else if (k[0] === ".") n.dataset[k.slice(1)] = v;
      else {
        const ak = (k[0] === "@" ? `aria-${ARIA[k.slice(1)]}` : k === "R" ? "role" : k).trim();
        if (ak && !/^on/i.test(ak)) sa(n, ak, v);
      }
    }
  }
  for (const c of kids) c != null && c !== false && n.append(isA(c) ? h(...(c as HSpec)) : typeof c === "string" ? doc.createTextNode(c) : c as Node);
  return n;
};
const IC: readonly string[] = [
  "M2 3h12v9H2z;M2 6h12;M7 8l3 1.5L7 11z", "M5 3v9M11 3v9", "M5 3l7 5-7 5z",
  "M8 2v5;M5 4a5 5 0 1 0 6 0", "M10 3L5 8l5 5", "M6 3l5 5-5 5",
  "M13 8a5 5 0 1 1-1-3;M13 2v3h-3", "M2 4h12v8H2z;M4 7h1M7 7h2M11 7h1M5 10h6",
  "M2 4h12M2 8h12M2 12h12;M5 2v4M11 6v4M6 10v4", "M8 3v10M3 8h10", "M4 4l8 8M12 4l-8 8",
];
const ico = (idx: number, sz = 14, pid?: string): SVGSVGElement => {
  const ns = "http://www.w3.org/2000/svg", s = doc.createElementNS(ns, "svg");
  for (const [k, v] of [["class", "ic"], ["width", sz], ["height", sz], ["viewBox", "0 0 16 16"], ["aria-hidden", "true"]] as const) sa(s, k, v);
  for (const dp of IC[idx].split(";")) { const p = doc.createElementNS(ns, "path"); sa(p, "d", dp); if (pid) D[pid] = p; s.appendChild(p); }
  return s;
};

const S: PanelState = {
  on: !!boot.connected, cm: boot.connectionMode || "", cr: !!boot.crisp, fm: boot.format || "",
  tabs: isA(boot.tabs) ? boot.tabs : [], th: boot.tabsHash || "",
  aid: boot.activeTargetId || null, ep: +(boot.epoch ?? 1) || 1, tep: +(boot.epoch ?? 1) || 1, pe: +(boot.pauseEpoch ?? 0) || 0, pg: boot.page || {},
  seq: useSwr ? 0 : boot.seq || 0, fh: useSwr ? "" : boot.frameHash || "", by: useSwr ? 0 : boot.imageBytes || 0, uc: false,
  nv: false, st: !boot.paused, pa: !!boot.paused, id: !!boot.screencastPausedIdle,
  dlg: boot.dialog || null, nt: !!(boot.connected && isNoTabsPayload(boot)),
};
let cfg: CfgState = { lang: "auto", defaultQuality: "auto", defaultConnectMode: "auto", bgPollIntervalSec: 0, idlePauseSec: 12, ...(boot.settings as Partial<CfgState> | undefined) };
let cfgPath = boot.settingsPath || "settings.json", cfgGen = +(boot.settingsGen ?? 0) || 0, cfgErr = boot.settingsError || "", hostCtx: HostContext | null = null;

const pickLg = (c: HostContext | null = hostCtx): PanelLang =>
  resolvePanelLang({ saved: cfg.lang && cfg.lang !== "auto" ? cfg.lang : ls("chrome_stream_lang"), hostLocale: (c?.locale || c?.language || "") as string, navLang: navigator?.language || "", bootLocale: boot.locale || b0.locale || "" });
let curLg: PanelLang = pickLg(), T: I18nDict = I18N[curLg] || I18N.en, portF: PortFileInfo | null = boot.portFile || null, tabSig = "", qApp = boot.qualityApplied || "low";
let errCode: string | null = null, errRaw: string | null = null, errDet = 0, cErr = false, hadTabs = S.tabs.length > 0;
let isCn: string | 0 = 0, isDisc = 0, isPa = 0, isSw = 0, isSb = !!(boot.connected && (boot.standby === true || (boot.paused === true && boot.standby !== false))), qMode: QualityMode = (QK.includes(cfg.defaultQuality) ? cfg.defaultQuality : "auto") as QualityMode, lastMode = "personal", dlgKey = "", imeOn = false, popOn = false, setOn = false;
let qIn: Array<[InputEventPayload, string | null, number]> = [], inB = 0, inT: Tm = 0, pB = 0, pT: Tm = 0, oT: Tm = 0, oB = 0, urg: { f: boolean } | 0 = 0, act = nowMs(), tT: Tm = 0, dropTimers = (): void => {};
let pErr = 0, offErr = 0, offUrg = 0, pollSeq = 0, lastFetchAt = boot.connected ? (freshBoot ? +(b0.bootTs || nowMs()) : nowMs()) : 0, lastForceAt = 0, stopReveal: (() => void) | null = null;
let pGen = 0, painted = 0, started = 0, synced = 0, ready = 0, tSig = "", lAr = 0, fTimes: number[] = [], fpsVal = 0, saveT: Tm = 0;
const closing = new Set<string>(), tMap = new Map<string, HTMLElement>();
let lNodes: HTMLElement[] = [], gNodes: HTMLElement[] = [], qBtns: HTMLElement[] = [], lgBtns: HTMLElement[] = [];

const syncNetCfg = (): void => { net.bgPollIntervalSec = +cfg.bgPollIntervalSec || 0; if (+(cfg.wheelCoalesceMs ?? 0) >= 20) net.wheelCoalesceMs = +(cfg.wheelCoalesceMs ?? 75); };
net.setMode(qMode); syncNetCfg();

const vp = (): [number, number] => [+(S.pg.viewportWidth ?? 0) || 1280, +(S.pg.viewportHeight ?? 0) || 800];
const qName = (q: string): string => T[`q_${QK.includes(q) ? q : "low"}`] || q;
const qLbl = (): string => { const e = qName(qApp || net.getEffectiveQuality()); return qMode === "auto" ? T.ap + e : e; };
const qArgs = (): { qualityPreset: string; rttMs: number } => ({ qualityPreset: net.getEffectiveQuality(), rttMs: net.ewmaRttMs || 0 });
const canCall = (): boolean => !!ready && app.hasServerTools();
const eRaw = (e: unknown): string => (typeof e === "string" ? e : (e as { message?: string } | null)?.message || String(e || ""));
const eCode = (d: FramePayload | null | undefined, fb?: string): string | null => (d?.errorCode ? `e_${d.errorCode}` : fb || null);
const rpcSc = (() => {
  type J = { n: string; a: Record<string, unknown>; s: (v: FramePayload | undefined) => void; j: (e: unknown) => void };
  let busy = 0, bg: J | null = null;
  const hi: J[] = [];
  const run = async (n: string, a: Record<string, unknown>): Promise<FramePayload | undefined> => {
    const g = (n === "frame" || n === "stage") && net.ewmaRttMs > 120 && +(a.waitMs ?? 0) > 0 ? { ...a, waitMs: 0 } : a;
    const r = (await app.callServerTool({ name: "chrome_stream_" + n, arguments: g })) as { structuredContent?: FramePayload; isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    if (!r?.structuredContent && r?.isError) { const m = r.content?.find((c) => c?.text)?.text; if (m) throw new Error(m); }
    return r?.structuredContent;
  };
  const pump = async (): Promise<void> => {
    if (busy) return;
    busy = 1;
    try {
      while (hi.length || bg) {
        const q = hi.shift() || ((x) => ((bg = null), x))(bg!);
        try {
          let v: FramePayload | undefined;
          for (let rt = 0; ; ) {
            try {
              v = await run(q.n, q.a);
              if (rt || v?.errorCode !== "relay_busy") break;
            } catch (e) { if (rt || !isBusyErrorText(eRaw(e))) throw e; }
            rt = 1; await new Promise<void>((r) => sTm(r, 160));
          }
          q.s(v);
        } catch (e) { q.j(e); }
      }
    } finally { busy = 0; }
  };
  return (n: string, a: Record<string, unknown>): Promise<FramePayload | undefined> =>
    new Promise((s, j) => { const q: J = { n, a, s, j }; n === "frame" || n === "stage" ? (bg?.s(undefined), (bg = q)) : hi.push(q); void pump(); });
})();
const sendIn = (events: InputEventPayload[], targetId?: string, targetEpoch?: number): Promise<FramePayload | undefined> => rpcSc("input", targetEpoch !== undefined && fin(targetEpoch) && targetEpoch > 0 ? { targetId, targetEpoch, events } : { targetId, events });
const dropIn = (): void => { qIn = []; cTm(inT); inT = 0; dropTimers(); };
const evIn = (action: string, o: Record<string, unknown> = {}, imm = 1, tid = S.aid, tep = S.tep): void => pushIn({ action, ...o }, imm, tid, tep);
const kyIn = (key: string, modifiers?: number, imm: number | boolean = 1): void => evIn("key", modifiers ? { key, modifiers } : { key }, imm ? 1 : 0);
const isRec = (d: FramePayload | null | undefined): boolean => Boolean(d?.recoverable || isTargetErrorText(d?.error));
const modsOf = (e: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): number => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const focusSt = (): void => (D.si || D.st).focus({ preventScroll: true });
const toast = (m: string): void => { if (m) { tx(D.ts, m); tg(D.ts, "on", 1); cTm(tT); tT = sTm(() => tg(D.ts, "on", 0), 1600); } };
const setPf = (d: FramePayload | null | undefined): void => {
  if (!d) return;
  if (d.portFile) portF = d.portFile;
  if (d.connectionMode) S.cm = d.connectionMode;
  const e = +(d.epoch ?? 0); if (fin(e) && e > 0) S.tep = e; syncCfg(d);
};
const syncTabList = (d: FramePayload | null | undefined): void => {
  if (isA(d?.tabs)) {
    S.tabs = d.tabs; if (d.tabs.length > 0) hadTabs = true; S.th = d.tabsHash || "";
    setMeta(S.tabs.find((t) => t.targetId === S.aid)); uTabs();
  }
};
const clsP = (): void => { if (popOn) setPop(false); if (setOn) setSet(false); };
const syncPe = (d: FramePayload | null | undefined, fb?: boolean): number => {
  const pe = +(d?.pauseEpoch ?? NaN), g = fin(pe) && pe > S.pe; if (g) S.pe = pe;
  return typeof d?.paused === "boolean" && (g || fb) ? ((S.st = !(S.pa = d.paused)), g ? 1 : 0) : 0;
};
const clrTm = (w: number | boolean): void => { if (w) { cTm(pT); pT = 0; } else { cTm(oT); oT = 0; } };
const saveSwr = (): void => {
  const pf = portF ? { exists: !!portF.exists, valid: !!portF.valid, stale: !!portF.stale, fallback: !!portF.fallback, port: portF.port ?? null } : null;
  const st = { ...cfg } as Record<string, unknown>; delete st.portFile; delete st.userDataDir;
  ls(SWR_K, JSON.stringify({ v: 1, savedAt: nowMs(), data: { connected: S.on, connectionMode: S.cm || null, tabs: S.tabs, tabsHash: S.th, activeTargetId: S.aid, page: S.pg, qualityApplied: qApp, paused: S.pa, standby: isSb, noTabs: S.nt, portFile: pf, settings: st } }));
};
const hideCvs = (): void => { painted = 0; hd(D.vc, 1); D.vc.className = "c"; hd(D.ph, 0); hd(D.pb, 1); };
const liveSched = (): void => { if (S.on && !isSb && S.st && !S.pa && !isDisc) sched(nextMs(0), 0); };

const setErr = (code?: string | null, raw?: unknown, st?: number | boolean): void => { errCode = code || null; errRaw = raw ? eRaw(raw) : null; cErr = !!st && !!(code || raw); errDet = 0; syncBnr(); syncDots(); };
const setPErr = (d: FramePayload | null | undefined, fb?: string, st?: number | boolean): void => (!d?.errorCode && !d?.error ? setErr() : setErr(eCode(d, fb || (isBusyErrorText(d?.error) ? "b_busy" : undefined)), d.error, st));
const setBErr = (err: unknown, st?: number | boolean): void => { const r = eRaw(err); setErr(mapBridgeErrorKey(r), r, st); };

const bumpFps = (hit: number | boolean): void => { const t = nowMs(); if (hit) fTimes.push(t); while (fTimes.length && t - fTimes[0] > 1500) fTimes.shift(); fpsVal = fTimes.length ? Math.min(60, rnd(fTimes.length / 1.5)) : 0; };
const fitStage = (nw = painted ? D.vc.width : 0, nh = painted ? D.vc.height : 0): void => { const a = resolveStageAspect(+(S.pg.viewportWidth ?? 0), +(S.pg.viewportHeight ?? 0), nw, nh); if (a && a !== lAr) D.vw.style.setProperty("--ar", String(lAr = a)); };
const paint = (url: string): void => {
  if (!isSafeImageUrl(url)) return;
  const gen = ++pGen, im = new Image(), dm = vp(); im.decoding = "async";
  const blit = (src: CanvasImageSource & { close?: () => void }, nw: number, nh: number): void => {
    if (gen !== pGen) return src.close?.();
    const v = D.vc; fitStage(nw, nh);
    if (v.width !== nw || v.height !== nh) { v.width = nw; v.height = nh; }
    const cx = v.getContext("2d", { alpha: false });
    if (cx) { cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high"; cx.drawImage(src, 0, 0, nw, nh); }
    src.close?.(); painted = 1; bumpFps(1); hd(v, 0); hd(D.ph, 1); setSw(0); uSt();
  };
  const go = (): void => {
    if (gen !== pGen) return;
    const nw = im.naturalWidth || dm[0], nh = im.naturalHeight || dm[1];
    typeof createImageBitmap === "function" ? createImageBitmap(im).then((b) => blit(b, b.width || nw, b.height || nh), () => blit(im, nw, nh)) : blit(im, nw, nh);
  };
  im.src = url;
  im.decode ? im.decode().then(go, () => im.complete && im.naturalWidth && go()) : (im.onload = go);
};
const setPop = (o: boolean): void => { popOn = !!o; if (popOn) setSet(false); hd(D.pp, !popOn); sa(D.bq, "aria-expanded", popOn); };
const setSet = (o: boolean): void => { setOn = !!o; if (setOn) setPop(false); hd(D.sw, !setOn); sa(D.bg, "aria-expanded", setOn); sa(D.bg0, "aria-expanded", setOn); if (setOn) syncCfgUi(); };
const setIme = (o: boolean): void => { imeOn = !!o; hd(D.im, !imeOn); sa(D.bi, "aria-expanded", imeOn); tg(D.st, "im", imeOn); tg(D.bi, "on", imeOn); if (imeOn) D.ti.focus(); };

const syncBnr = (): void => {
  const txt = !errCode && !errRaw ? "" : T[errCode || ""] || (curLg === "zh-CN" ? T.b_generic : errRaw || T.b_generic);
  const det = !!(errRaw && errRaw !== txt), live = S.on && !isSb, g = live && S.dlg && typeof S.dlg === "object" ? S.dlg : null;
  const show = (m: number): void => "dp di dk do er eb dx bn".split(" ").forEach((k, i) => hd(D[k], !(m & (1 << i))));
  if (g) {
    const tp = g.type || "alert", key = `${g.targetId || ""}:${tp}:${g.message || ""}`;
    tg(D.bn, "wn", 1); tx(D.dp, T[DLG_K[Math.max(0, DLG.indexOf(tp))]]); tx(D.dm, g.message || g.url || "");
    hd(D.ed, 1); show(137 | (tp === "prompt" ? 2 : 0) | (tp !== "alert" ? 4 : 0));
    if (key !== dlgKey) { dlgKey = key; if (tp === "prompt") { D.di.value = g.defaultPrompt || ""; sTm(() => D.di.focus(), 0); } }
  } else if (live && txt) {
    tg(D.bn, "wn", 0); tx(D.dm, txt); tx(D.ed, errRaw || ""); hd(D.ed, !(det && errDet)); show(208 | (det ? 32 : 0)); dlgKey = "";
  } else {
    hd(D.bn, 1); hd(D.ed, 1); dlgKey = "";
  }
  const od = !live && det; tx(D.om, txt); tx(D.od2, errRaw || ""); hd(D.ob2, !od); hd(D.od2, !(od && errDet)); hd(D.oe, !txt);
};
const syncDots = (): void => {
  const he = !!(errCode || errRaw), ok = !!portF?.valid;
  D.ld.className = "ed " + (!S.on ? "" : he ? "er" : S.pa || S.id ? "wn" : S.nt ? "" : "ok");
  D.od.className = D.o0.className = "ed " + (he ? "er" : isCn || isSb ? "wn" : ok ? "ok" : "");
  tg(D.op, "ok", !isSb && ok && !he); tg(D.op, "wn", isSb && !he); tg(D.op, "er", he);
};
const setSw = (v: number): void => { isSw = v ? 1 : 0; tg(D.vc, "sw", isSw); hd(D.lb, !(S.nv || isSw)); };
const sUrl = (u: string): void => { if (doc.activeElement !== D.ui) D.ui.value = u || ""; };
const setMeta = (m: TabInfo | undefined): void => { if (m) { S.pg = { ...S.pg, title: m.title || "", url: m.url || "" }; sUrl(m.url || ""); } };
const rstF = (th?: number): void => { S.seq = 0; S.fh = ""; S.cr = false; if (th) S.th = ""; };

const syncPh = (): void => {
  if (S.nt) { setSw(0); S.nv = false; hideCvs(); tx(D.pm, hadTabs ? T.wc : T.nt0); tx(D.ps, hadTabs ? T.wcb : T.nt0b); hd(D.ps, 0); hd(D.pa2, 0); return; }
  hd(D.ps, 1); hd(D.pa2, 1);
  if (painted) { const dim = !!(S.pa || S.id); hd(D.ph, 1); hd(D.vc, 0); tg(D.vc, "pa", dim); tx(D.pb, S.pa ? T.pp : T.ip); hd(D.pb, !dim); }
  else { tx(D.pm, S.pa ? T.pd : T.ld); hd(D.ph, 0); hd(D.pb, 1); }
};
const syncPauseUi = (): void => {
  const lbl = S.pa ? T.rs : T.pa, dis = !canCall(), b = D.bp;
  tg(b, "wp", S.pa); sa(b, "aria-pressed", S.pa); sa(b, "aria-label", lbl); b.title = lbl; tx(D.bt, lbl);
  b.disabled = Boolean(isPa || isDisc || dis); D.dc.disabled = D.n3.disabled = D.n4.disabled = D.rv.disabled = Boolean(isDisc || dis);
  sa(D.pi, "d", IC[S.pa ? 2 : 1]); syncDots(); syncPh(); uSt();
};

const schedOffP = (ms = net.computeOfflinePollDelay({ hidden: hid(), errCount: offErr })): void => {
  clrTm(0);
  if (!hid() && ms >= 0 && (!S.on || isSb) && !isCn && !isDisc && canCall()) oT = sTm(() => { oT = 0; void probeOff(); }, ms);
};
const probeOff = async (): Promise<void> => {
  if ((S.on && !isSb) || isCn || isDisc || oB || !canCall()) return;
  oB = 1; const seq = ++pollSeq, t0 = pNow();
  try {
    const d = await reqFrame(0, 0, 0);
    if (seq !== pollSeq || isCn || isDisc) return;
    lastFetchAt = nowMs(); offErr = d?.error ? Math.min(4, offErr + 1) : 0;
    if (!d?.screencastPausedIdle) net.recordSample({ totalMs: rnd(pNow() - t0), serverMs: d?.serverMs || 0, imageBytes: 0 });
    if (d?.connected === false) { if (isSb) { isSb = false; goOff(eCode(d), d.error, d.portFile); return; } setPf(d); uOff(); saveSwr(); }
    else if (d?.connected === true && (d.paused || d.standby)) {
      const wasSb = isSb;
      S.on = true; isSb = true; S.pa = true; S.st = false; S.id = false; S.nt = isNoTabsPayload(d);
      setPf(d); syncPe(d, true); syncTabList(d); wasSb ? uOff() : sView(); saveSwr();
    } else if (d?.connected) { isSb = false; act = nowMs(); onPoll(d, 0, S.ep); liveSched(); return; }
    else if (d) { setPf(d); if (!S.on) uOff(); }
  } catch { if (seq !== pollSeq) return; offErr = Math.min(4, offErr + 1); } finally {
    oB = 0; if ((!S.on || isSb) && !isCn && !isDisc) schedOffP(offUrg ? 20 : undefined); offUrg = 0;
  }
};
const goOff = (code?: string | null, raw?: unknown, pf?: PortFileInfo): void => {
  pollSeq++; S.on = S.pa = S.id = S.nt = S.cr = S.nv = isSb = false; isDisc = isPa = isSw = 0; cErr = false; hadTabs = false;
  S.dlg = null; S.st = true; S.th = S.cm = S.fm = "";
  errCode = code || null; errRaw = raw ? eRaw(raw) : null; errDet = 0; fTimes = []; fpsVal = 0; if (pf) portF = pf;
  dropIn(); clrTm(1); sView(); saveSwr(); schedOffP();
};
const uOff = (): void => {
  const ok = !!portF?.valid;
  if (isSb) {
    tx(D.op, T.sbb); tx(D.ob, isCn === "resume" ? T.rsg : T.rsb); tx(D.orv, isDisc === 2 ? T.tdc : T.rvl); tx(D.ont, T.sbn);
    hd(D.ol, 1); hd(D.orv, 0); hd(D.dt, 1);
  } else {
    tx(D.op, ok ? (portF?.fallback ? T.rse : T.rmy) : T.nf);
    tx(D.ob, isCn === "personal" ? T.cn : T.cm); tx(D.ol, isCn === "launch" ? T.cn : T.os); tx(D.ont, T.oss);
    hd(D.ol, 0); hd(D.orv, 1); hd(D.dt, 0);
    if (!ok && !D.dt.dataset.u) D.dt.open = true;
  }
  syncBnr(); D.ob.disabled = D.ol.disabled = D.orv.disabled = Boolean(isCn || isDisc || !canCall());
  syncDots();
};
const sView = (): void => { const off = !S.on || isSb; hd(D.vo, !off); hd(D.vn, off); !off ? (clrTm(0), syncBnr(), syncPauseUi(), fitStage()) : (clsP(), clrTm(1), hideCvs(), setSw(0), syncBnr(), uOff()); };

const renderGuide = (): void => {
  tx(gNodes[0], T.s1);
  const [a, b] = T.s2.split("$0"); gNodes[1].replaceChildren(doc.createTextNode(a), h("code", "t=chrome://inspect/#remote-debugging"), doc.createTextNode(b || ""));
  tx(gNodes[2], T.s3.replace(/\*/g, ""));
};
const syncCfgUi = (): void => {
  CFGS.forEach(([id, , k]) => (D[id].value = String(cfg[k] ?? "")));
  tx(D.sp2, `${T.sf}: ${cfgPath}`); D.sp2.title = cfgPath; hd(D.se, !cfgErr); tx(D.se, cfgErr ? T.sfb : "");
};
const syncCfg = (d: FramePayload, quiet?: number): void => {
  if (d.settingsPath) cfgPath = d.settingsPath;
  const ne = d.settingsError || "", ec = ne !== cfgErr; cfgErr = ne;
  const g = +(d.settingsGen ?? 0) || 0;
  if (d.settings && typeof d.settings === "object" && (!g || g > cfgGen || quiet)) {
    const ext = !quiet && cfgGen > 0 && g > cfgGen && !saveT;
    if (g > cfgGen) cfgGen = g;
    cfg = { ...cfg, ...(d.settings as Partial<CfgState>) }; syncNetCfg(); saveSwr();
    const nl = pickLg(); if (nl !== curLg) { curLg = nl; applyLangUi(); }
    if (setOn || ec || quiet) syncCfgUi();
    if (ext) toast(T.trl);
  } else if (ec && setOn) syncCfgUi();
};
const applyLangUi = (): void => {
  T = I18N[curLg] || I18N.en; doc.documentElement.lang = curLg;
  lNodes.forEach((n) => {
    const ds = n.dataset, vi = T[ds.i || ""], va = T[ds.a || ""], vp0 = T[ds.p || ""], vt = T[ds.t || ""];
    if (vi) tx(n, vi); if (va) { sa(n, "aria-label", va); if (n.tagName === "BUTTON" && !vt) n.title = va; }
    if (vt) n.title = vt; if (vp0) (n as HTMLInputElement).placeholder = vp0;
  });
  lgBtns.forEach((b) => { const onL = b.dataset.lg === curLg; sa(b, "aria-pressed", onL); tg(b, "on", onL); });
  tMap.forEach((n) => sa(n.lastChild as Element | null, "aria-label", T.ct));
  renderGuide(); uOff(); syncBnr(); syncPauseUi(); syncCfgUi();
};
const setSS = (m: string, c = ""): void => { tx(D.ss, m); D.ss.className = c; };
const saveCfg = async (patch: Record<string, unknown>): Promise<void> => {
  cfg = { ...cfg, ...(patch as Partial<CfgState>) }; syncNetCfg(); saveSwr();
  if ("lang" in patch) { ls("chrome_stream_lang", patch.lang === "auto" ? "" : String(patch.lang)); const nx = pickLg(); if (nx !== curLg) { curLg = nx; applyLangUi(); } }
  if ("defaultQuality" in patch && typeof patch.defaultQuality === "string" && QK.includes(patch.defaultQuality)) setQ(patch.defaultQuality, 1);
  if (!canCall()) return;
  setSS(T.sv); cTm(saveT); saveT = 1;
  try {
    const r = await rpcSc("config", { action: "update", patch });
    r?.ok ? (syncCfg(r, 1), setSS(T.svd, "hd"), (saveT = sTm(() => { saveT = 0; setSS(""); }, 1800))) : ((saveT = 0), setSS(T.svf, "erc"));
  } catch { saveT = 0; setSS(T.svf, "erc"); }
};

const mkEmblem = (dotId: string, big: number): HTMLElement => h(big ? "s.e.el" : "s.e", 0, ico(0, big ? 18 : 13), [`s.ed#${dotId}`]);
const mkLang = (): HTMLElement => h(".l", "R=group;.a=lg", ...([["EN", "en"], ["中文", "zh-CN"]] as const).map(([lbl, lg]) => {
  const b = h("b", `t=${lbl};.lg=${lg};@p=${curLg === lg}`);
  ck(b, () => { if (curLg !== lg) { curLg = lg; ls("chrome_stream_lang", lg); applyLangUi(); void saveCfg({ lang: lg }); } });
  lgBtns.push(b); return b;
}));

const mount = (): void => {
  const gLi = (i: number): HSpec => { const s = h("s"); gNodes[i] = s; return ["li", 0, ["s.n", `t=0${i + 1}`], s]; };
  const row = (k: string, id: string): HSpec => [".pr", 0, ["s", `.i=${k}`], [`s.nm#${id}`, "t=-"]];
  const ib = (id: string, a: string, ic: number, ex = "", sz = 14, pid?: string): HSpec => [`!.i#${id}`, `.a=${a}${ex}`, ico(ic, sz, pid)];
  const hdr = (did: string, mid: HSpec, ...rt: HChild[]): HSpec => ["header.h", 0, [".m", 0, mkEmblem(did, 0), ["s.w", "t=Remote Cast"], did === "ld" && ["s.rm#rm!"]], mid, [".ha", 0, ...rt]];
  const okI = !!portF?.valid, qRail = h(".sg#qs", "R=radiogroup");
  qBtns = QK.map((v) => { const b = h(v === qMode ? "b.on" : "b", `R=radio;.q=${v};.i=q_${v};.t=qt_${v};@c=${v === qMode}`); ck(b, () => setQ(v)); qRail.append(b); return b; });

  root.replaceChildren(h(".a", 0,
    [".v#vo", 0,
      hdr("o0", [".t"], mkLang(), ib("bg0", "st", 8, ";@h=dialog;@e=false")),
      ["section.f", 0,
        [".oh", 0, mkEmblem("od", 1), [okI ? "s.bd.ok#op" : "s.bd#op"]],
        [".r#oe!", 0, ["s.mt#om"], [".da", 0, ["!#ob2!", ".i=dt"], ["!#or", ".i=rt"]], [".mn.ed2#od2!"]],
        ["!.bp#ob"], ["!.bs#ol"], ["!.dg#orv!"], ["s.nt#ont", ".i=oss"],
        ["details.d#dt", okI ? "" : "open=", ["summary", ".i=ht"], ["ol.ol", 0, gLi(0), gLi(1), gLi(2)]]
      ]
    ],
    [".v#vn", 0,
      hdr("ld", [".tw", 0, [".t#tb", "R=tablist;.a=tb"], ["!.nb#nt", ".a=nt", ico(9, 13)]],
        mkLang(),
        ["!.hb#bp", ".a=pa;@p=false", ico(1, 13, "pi"), ["s#bt", ".i=pa"]],
        ["!.hb#dc", ".a=dcl", ico(3, 13), ["s", ".i=dc"]],
        ["!.hb.dg#rv", ".a=rvl", ico(10, 13), ["s", ".i=rv3"]],
        ib("bg", "st", 8, ";@h=dialog;@e=false")
      ),
      [".nr", 0,
        [".pg", 0, ib("bk", "bk", 4), ib("fw", "fw", 5), ib("rl", "rl", 6)],
        ["form.u#uf", 0, ["i.in#ui", ".a=up;.p=up"], isMac && ["s.uk", "t=⌘L;@i=true"]],
        ["b.q#bq", ".a=ql;@h=dialog;@e=false", ["s.rd#sd"], ["s#qm"], ["s.fp#qf"], ["s.hd#qh!", "t= · HD"]],
        ib("bi", "kb", 7, ";@e=false")
      ],
      [".s#st", "tabindex=0;.a=lv2",
        ["textarea.si#si", "autocomplete=off;spellcheck=false;.a=lv2"], [".lb#lb!"],
        [".r#bn!", 0, ["s.dtg#dp!"], ["s.mt#dm"], ["i.in#di!", ".p=rp"],
          [".da", 0, ["!#dk!", ".i=ca"], ["!.bs#do!", ".i=ok"], ["!#eb!", ".i=dt"], ["!.bs#er!", ".i=rt"], ["!.i#dx!", ".a=dm;t=×"]],
          [".mn.ed2#ed!"]
        ],
        [".ph#ph", 0, ["s.pt#pm"], ["s.nt#ps!"], [".da#pa2!", 0, ["!.bp#n2", ".i=nt"], ["!#n3", ".i=dc"], ["!.dg#n4", ".i=rv3"]]],
        ["b.g#pb!"],
        [".vw#vw", 0, ["canvas.c#vc!", ".a=ps"]], [".z#ts", "R=status;@v=polite"],
        [".y#im!", 0, ["i.in#ti", ".p=tp"], ["b.ch#ty", ".i=ti"], ["b.ch.bs#te", ".i=se"], ["s.dv"],
          ...IK.map((k, i): HSpec => ["b.ch", `.k=${k};` + (i < 3 ? `t=${k === "Escape" ? "Esc" : k}` : `.i=${["bs", "un", "cp", "ps2", "sa"][i - 3]}`)]),
          ["b.ch", "t=↑;.sc=-360;.a=su"], ["b.ch", "t=↓;.sc=360;.a=sd"]
        ]
      ],
      [".o#pp!", "R=dialog;.a=ql", [".pl", ".i=ql"], qRail, row("fs", "sr"), row("ps", "sv"), row("lv", "sp"), row("ch", "sm"), [".mn#mn!", ".i=rn"], ["!.bs#sn", ".i=rv"]]
    ],
    [".o#sw!", "R=dialog;.a=st",
      [".pr", 0, ["s.pl", ".i=st"], ["s#ss"]],
      [".mn.erc#se!"],
      ...CFGS.map(([id, lk, , , ops]): HSpec => [".pr", 0, ["s", `.i=${lk}`], [`l.sel#${id}`, `.a=${lk}`, ...ops.split("|").map((o): HSpec => { const [v, tk] = o.split(":"); return ["option", `value=${v};${tk[0] === "=" ? `t=${tk.slice(1)}` : `.i=${tk}`}`]; })]]),
      ["b.mn#sp2", ".a=cp"]
    ]
  ));

  const qAll = (n: Element, s: string): HTMLElement[] => [...n.querySelectorAll<HTMLElement>(s)];
  lNodes = qAll(root, "[data-i],[data-a],[data-p],[data-t]");
  applyLangUi();

  const sendTx = (pe: boolean): void => { const v = D.ti.value; if (v || pe) { D.ti.value = ""; toast(T.ts); evIn("type", { text: v, pressEnter: pe }); } };
  const openNT = (): void => { S.nt = S.id = false; S.ep++; rstF(1); setSw(1); evIn("new_tab", { url: cfg.newTabUrl || "chrome://newtab" }); };
  const doDisc = async (mode: "standby" | "revoke" = "standby"): Promise<void> => {
    if (isDisc || !S.on || !canCall()) return;
    const rev = mode === "revoke";
    clsP(); isDisc = rev ? 2 : 1; S.ep++; dropIn(); clrTm(1); clrTm(0);
    isSb ? uOff() : syncPauseUi(); toast(rev ? T.tdc : T.tsbi);
    try {
      const d = await rpcSc("disconnect", { mode });
      if (d?.connected === false && d?.ok !== false && !d?.unconfirmed) {
        isSb = false; S.tabs = []; S.aid = null; rstF(1); goOff(null, null, d.portFile); toast(T.td); return;
      }
      if (!rev && d?.connected === true && (d?.paused || d?.standby) && d?.ok !== false && !d?.unconfirmed) {
        pollSeq++; isDisc = 0; isSb = true; S.pa = true; S.st = false; S.id = false;
        const pe = +(d.pauseEpoch ?? NaN); if (fin(pe) && pe > S.pe) S.pe = pe;
        setPf(d); setErr(); sView(); saveSwr(); schedOffP(); toast(T.tsb); return;
      }
      setPErr(d, "ed", 1);
    } catch (e) { setBErr(e, 1); }
    isDisc = 0; isSb ? (uOff(), schedOffP()) : (syncPauseUi(), askUrg(1));
  };
  const resumeStandby = async (): Promise<void> => {
    if (isCn || isDisc || isPa || !S.on || !canCall()) return;
    isCn = "resume"; setErr(); clrTm(0); uOff();
    try {
      const d = await sendIn([{ action: "resume" }]);
      if (d?.connected === false && !isRec(d)) { isCn = 0; isSb = false; goOff(eCode(d, "e_conn_lost"), d.error, d.portFile); return; }
      if (!d || d.ok === false) { isCn = 0; setPErr(d, "ep", 1); uOff(); schedOffP(); return; }
      const pe = +(d.pauseEpoch ?? NaN); if (fin(pe) && pe >= S.pe) S.pe = pe;
      pollSeq++; isCn = 0; isSb = false; S.pa = typeof d.paused === "boolean" ? d.paused : false; S.st = !S.pa; S.ep++; S.id = false; act = nowMs(); setErr();
      sView(); uSt(); saveSwr(); toast(T.trs); if (!S.pa) { askUrg(1); liveSched(); } else schedOffP();
    } catch (e) { isCn = 0; setBErr(e, 1); uOff(); schedOffP(); }
  };
  const togglePa = async (): Promise<void> => {
    if (!S.on || isPa || isDisc || !canCall()) return;
    const want = !S.pa; isPa = 1; syncPauseUi(); if (want) clrTm(1);
    try {
      const d = await sendIn([{ action: want ? "pause" : "resume" }]);
      if (d?.connected === false && !isRec(d)) return goOff(eCode(d, "e_conn_lost"), d.error, d.portFile);
      if (!d || d.ok === false) { setPErr(d, "ep", 1); isPa = 0; syncPauseUi(); askUrg(1); return; }
      const pe = +(d.pauseEpoch ?? NaN); if (fin(pe) && pe >= S.pe) S.pe = pe;
      pollSeq++; S.pa = typeof d.paused === "boolean" ? d.paused : want; S.st = !S.pa; S.ep++; S.id = false; act = nowMs(); setErr(); saveSwr(); toast(S.pa ? T.tpa : T.trs);
    } catch (e) { setBErr(e, 1); }
    isPa = 0; syncPauseUi(); S.pa ? clrTm(1) : askUrg(1);
  };
  const ansDlg = (accept: boolean): void => { const g = S.dlg; if (g) { S.dlg = null; syncBnr(); evIn("dialog", { accept, promptText: g.type === "prompt" ? D.di.value : undefined }); askUrg(1); focusSt(); } };
  const tDet = (): void => { errDet ^= 1; syncBnr(); };
  const tSet = (e: Event): void => { e.stopPropagation(); setSet(!setOn); };

  const cbs: Record<string, (e: any) => void> = {
    ob: () => void (isSb ? resumeStandby() : conn("personal")), or: () => (ready ? canCall() && void (isSb ? resumeStandby() : conn(lastMode, 1)) : void initBridge()), ol: () => void conn("launch", 1), orv: () => void doDisc("revoke"),
    nt: openNT, n2: openNT, n3: () => void doDisc("standby"), n4: () => void doDisc("revoke"), er: () => (ready ? (setErr(), askUrg(1)) : void initBridge()), dx: () => setErr(), eb: tDet, ob2: tDet,
    sn: () => { S.fh = ""; S.cr = S.id = false; act = nowMs(); setPop(false); toast(T.trf); void poll(1); },
    dc: () => void doDisc("standby"), rv: () => void doDisc("revoke"), bp: () => void togglePa(), pb: () => S.on && (S.pa ? void togglePa() : ((S.id = false), (act = nowMs()), syncPauseUi(), void poll(1))),
    dk: () => ansDlg(false), do: () => ansDlg(true), bi: () => setIme(!imeOn), ty: () => sendTx(false), te: () => sendTx(true),
    bq: (e) => { e.stopPropagation(); setPop(!popOn); }, bg: tSet, bg0: tSet,
    sp2: () => { navigator.clipboard?.writeText?.(cfgPath).catch(() => {}); toast(T.tcp); },
  };
  for (const k in cbs) ck(D[k], cbs[k]);
  CFGS.forEach(([id, , k, num]) => on(D[id], "change", () => void saveCfg({ [k]: num ? +D[id].value || 0 : D[id].value })));
  for (const s of "bk,back,← ,bk|fw,forward,→ ,fw|rl,reload,↻ ,rl".split("|")) {
    const [id, a, p, k] = s.split(",");
    ck(D[id], () => { if (!S.pa) { S.nv = true; S.id = false; hd(D.lb, 0); toast(p + T[k]); evIn(a); } });
  }
  const onK = (n: EventTarget, ent: (() => void) | 0, esc: (() => void) | 0): void => on(n, "keydown", (e: KeyboardEvent) => { ent && e.key === "Enter" && !e.isComposing ? (pd(e), ent()) : esc && e.key === "Escape" && (pd(e), esc()); });
  on(D.dt, "toggle", () => (D.dt.dataset.u = "1"));
  onK(D.di, () => ansDlg(true), () => ansDlg(S.dlg?.type === "alert"));
  on(D.ui, "focus", () => D.ui.select());
  onK(D.ui, 0, () => { D.ui.value = S.pg.url || ""; focusSt(); });
  on(D.uf, "submit", (e: Event) => { pd(e); const u = !S.pa && D.ui.value.trim(); if (u) { S.nv = true; S.id = false; S.pg = { ...S.pg, url: u }; hd(D.lb, 0); evIn("navigate", { url: u }); focusSt(); } });
  onK(D.ti, () => sendTx(true), () => { setIme(false); focusSt(); });
  qAll(D.im, "[data-k],[data-sc]").forEach((ch) => ck(ch, async () => {
    if (S.pa) return;
    const { k, sc } = ch.dataset, cb = navigator.clipboard;
    if (sc) { const dm = vp(); evIn("scroll", { x: rnd(dm[0] / 2), y: rnd(dm[1] / 2), deltaY: +sc || 360 }); return; }
    if (k === "Paste" && cb?.readText) try { const txt = await cb.readText(); if (txt) { toast(T.tps); evIn("type", { text: txt, pressEnter: false }); return; } } catch {}
    toast(k === "Copy" ? T.tcp : k === "Paste" ? T.tps : `✓ ${ch.textContent}`); if (k) kyIn(k);
  }));

  const ptOf = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const r = D.vc.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const dm = vp(), vw = S.pg.viewportWidth || D.vc.width || dm[0], vh = S.pg.viewportHeight || D.vc.height || dm[1];
    return { x: rnd(cl((e.clientX - r.left) / r.width, 0, 1) * vw), y: rnd(cl((e.clientY - r.top) / r.height, 0, 1) * vh) };
  };
  let mM = 0, mN: (typeof BN)[number] = "left", mTid: string | null = null, mTep = 0, mvT: Tm = 0, mv: { p: Record<string, unknown>; t: string | null; e: number } | null = null, lRD = 0;
  const flMv = (): void => { cTm(mvT); mvT = 0; if (mv) { evIn("mousemove", mv.p, 0, mv.t, mv.e); mv = null; } };
  const ptrEv = (a0: string, e: { detail?: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, p: { x: number; y: number }, b: string, ex: Record<string, unknown>, tid = S.aid, tep = S.tep): void =>
    evIn(a0, { x: p.x, y: p.y, button: b, clickCount: cl(e.detail || 1, 1, 3), modifiers: modsOf(e) || undefined, ...ex }, 1, tid, tep);
  const onV = (ev: string, fn: (e: any) => void, o?: AddEventListenerOptions | boolean): void => on(D.vc, ev, fn, o);
  const bt = (e: { button: number }): (typeof BN)[number] => BN[e.button] || "left";
  const relDrag = (e: MouseEvent | null): void => { if (!mM) return; flMv(); const pn = mN, tid = mTid, tep = mTep; mM = 0; mTid = null; if (tid === S.aid && tep === S.tep) ptrEv("mouseup", e || {}, (e && ptOf(e)) || { x: 0, y: 0 }, e ? bt(e) : pn, { buttons: 0 }, tid, tep); };
  onV("mousedown", (e: MouseEvent) => {
    if (e.button > 2) return;
    if (S.pa) { pd(e); void togglePa(); return; }
    if (e.button === 1) pd(e);
    clsP(); const p = ptOf(e); if (!p) return;
    focusSt(); mM = BM[e.button] || 1; mN = bt(e); mTid = S.aid; mTep = S.tep; if (e.button === 2) lRD = nowMs();
    ptrEv("mousedown", e, p, mN, { buttons: mM });
  });
  const onMv = (e: MouseEvent): void => {
    if (S.pa || !S.on) return;
    if (mM && typeof e.buttons === "number" && (e.buttons & mM) === 0) return relDrag(e);
    if (!mM && S.id) return;
    const p = ptOf(e);
    if (p) { mv = { p: { x: p.x, y: p.y, button: mM ? mN : "none", buttons: mM, modifiers: modsOf(e) || undefined }, t: S.aid, e: S.tep }; if (!mvT) mvT = sTm(flMv, mM ? 32 : net.ewmaRttMs > 350 ? 150 : 75); }
  };
  onV("mousemove", onMv);
  on(window, "mousemove", (e: MouseEvent) => mM && e.target !== D.vc && onMv(e));
  on(window, "mouseup", (e: MouseEvent) => mM && relDrag(e));
  on(window, "blur", () => mM && relDrag(null));
  onV("auxclick", (e: MouseEvent) => e.button === 1 && pd(e));
  onV("contextmenu", (e: MouseEvent) => { pd(e); const p = !S.pa && nowMs() - lRD >= 450 && ptOf(e); if (p) ptrEv("click", e, p, "right", { clickCount: 1 }); });

  let wh: { x: number; y: number; p: { x: number; y: number } | null; t: string | null; e: number } = { x: 0, y: 0, p: null, t: null, e: 0 }, wt: Tm = 0;
  onV("wheel", (e: WheelEvent) => {
    pd(e); if (S.pa) return;
    const sc = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? vp()[1] * 0.85 : 1;
    if (!wt || wh.t !== S.aid || wh.e !== S.tep) { cTm(wt); wt = 0; wh = { x: 0, y: 0, p: null, t: S.aid, e: S.tep }; }
    wh.x += e.deltaX * sc; wh.y += e.deltaY * sc; wh.p = ptOf(e) || wh.p;
    if (!wt) wt = sTm(() => {
      const sx = cl(rnd(wh.x), -1400, 1400), sy = cl(rnd(wh.y), -1400, 1400), pt = wh.p || { x: 500, y: 350 };
      wh.x = wh.y = 0; wt = 0;
      if (Math.abs(sx) >= 2 || Math.abs(sy) >= 2) evIn("scroll", { x: pt.x, y: pt.y, deltaX: sx, deltaY: sy }, 1, wh.t, wh.e);
    }, net.getWheelCoalesceMs());
  }, { passive: false });

  let comp = 0, pArm: Tm = 0, pSentAt = 0;
  dropTimers = () => { cTm(wt); cTm(mvT); cTm(pArm); wt = wh.x = wh.y = mvT = pArm = mM = 0; mv = wh.p = mTid = null; };
  on(D.st, "focus", () => doc.activeElement === D.st && focusSt());
  on(D.si, "compositionstart", () => (comp = 1));
  on(D.si, "compositionend", (e: CompositionEvent) => { comp = 0; const v = e.data || D.si.value; D.si.value = ""; if (!S.pa && v) evIn("type", { text: v, pressEnter: false }); });
  on(D.si, "beforeinput", (e: InputEvent) => !comp && !e.isComposing && !S.pa && (e.inputType === "deleteContentBackward" ? (pd(e), kyIn("Backspace", 0, 0)) : e.inputType === "insertLineBreak" && (pd(e), kyIn("Enter"))));
  on(D.si, "input", () => { if (!comp && !S.pa && D.si.value) { evIn("type", { text: D.si.value, pressEnter: false }, 0); D.si.value = ""; } });
  on(D.st, "keydown", (e: KeyboardEvent) => {
    if (S.pa || (e.target !== D.st && e.target !== D.si) || comp || e.isComposing || e.key === "Process" || e.keyCode === 229) return;
    const mods = modsOf(e), low = e.key.toLowerCase(), fk = e.key === " " ? "Space" : e.key, asc = e.key.length === 1 && e.key.charCodeAt(0) >= 33 && e.key.charCodeAt(0) <= 126;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (low === "l") return;
      if (low === "v") { const a = S.aid, e0 = S.tep; cTm(pArm); pArm = sTm(() => { pArm = 0; if (S.aid === a && S.tep === e0) { pSentAt = nowMs(); kyIn("Paste"); } }, 120); return; }
      const cmd = ({ a: "SelectAll", c: "Copy", x: "Cut", z: e.shiftKey ? "Redo" : "Undo", y: "Redo" } as Record<string, string | undefined>)[low];
      if (cmd) { pd(e); if (low === "c") toast(T.tcp); kyIn(cmd); return; }
      if (KEYS.has(fk) || asc) { pd(e); kyIn(fk, mods, 1); }
      return;
    }
    if (KEYS.has(fk)) { pd(e); kyIn(fk, mods, fk === "Enter" || fk === "Escape"); return; }
    if (e.key.length === 1 && !e.metaKey && (!e.ctrlKey || e.altKey)) { pd(e); !e.altKey && asc ? kyIn(e.key, mods, 0) : evIn("type", { text: e.key, pressEnter: false }, 0); }
  });
  on(doc, "paste", (e: ClipboardEvent) => {
    if (!S.on || S.pa || [D.ui, D.ti, D.di].includes(e.target)) return;
    if (pSentAt && nowMs() - pSentAt < 250) { pSentAt = 0; pd(e); D.si.value = ""; return; }
    if (pArm) { cTm(pArm); pArm = 0; } pd(e); const txt = e.clipboardData?.getData("text/plain") || ""; D.si.value = "";
    toast(T.tps); txt ? evIn("type", { text: txt, pressEnter: false }) : kyIn("Paste");
  });
};

const setQ = (v: string, silent?: number): void => {
  if (!QK.includes(v)) return;
  qMode = v as QualityMode; net.setMode(v); qApp = net.getEffectiveQuality(); S.fh = ""; S.cr = S.id = false; act = nowMs();
  qBtns.forEach((b) => { const onQ = b.dataset.q === v; sa(b, "aria-checked", onQ); tg(b, "on", onQ); });
  uSt(); if (!silent) toast(`✓ ${qLbl()}`); if (S.on && !isSb) askUrg(1);
};
const chgTab = (tid: string | null): void => { pollSeq++; dropIn(); S.aid = tid; S.id = false; S.dlg = null; S.ep++; rstF(); setMeta(S.tabs.find((t) => t.targetId === tid)); syncBnr(); setSw(tid ? 1 : 0); };
const swTab = (tid: string): void => { if (tid && tid !== S.aid) { chgTab(tid); uTabs(); uSt(); saveSwr(); evIn("switch_tab", { targetId: tid }, 1, tid, S.tep); } };
const clTab = (tid: string): void => {
  if (!tid || closing.has(tid)) return;
  closing.add(tid); hadTabs = true;
  const tep = S.tep, o = applyOptimisticTabClose(S.tabs, S.aid, tid);
  S.tabs = o.tabs; S.th = ""; S.id = false;
  if (o.wasActive) chgTab(o.activeTargetId);
  if (!o.tabs.length) { S.nt = true; setSw(0); syncPh(); }
  uTabs(); uSt(); saveSwr(); toast(T.tcl); evIn("close_tab", { targetId: tid }, 1, tid, tep);
};
const mkTab = (tid: string): HTMLElement => {
  const x = h("b.x", `t=×;@l=${T.ct}`), node = h(".p", "tabindex=0;R=tab", ["s.tt"], x);
  node.dataset.id = tid;
  ck(node, (e: Event) => e.target !== x && swTab(tid));
  on(node, "auxclick", (e: MouseEvent) => e.button === 1 && (pd(e), clTab(tid)));
  on(node, "keydown", (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (pd(e), swTab(tid)));
  ck(x, (e: Event) => { e.stopPropagation(); clTab(tid); });
  return node;
};
const uTabs = (): void => {
  const sig = String(S.aid) + S.tabs.map((t) => `|${t.targetId}:${t.title}:${t.url}`).join("");
  if (sig === tabSig) return;
  tabSig = sig;
  const live = new Set(S.tabs.map((t) => t.targetId));
  tMap.forEach((n, id) => { if (!live.has(id)) { n.remove(); tMap.delete(id); } });
  let cur = D.tb.firstChild as ChildNode | null;
  for (const t of S.tabs) {
    const id = t.targetId, a = id === S.aid, u = t.url || "";
    let node = tMap.get(id); if (!node) { node = mkTab(id); tMap.set(id, node); }
    tg(node, "on", a); sa(node, "aria-selected", a);
    if (node.title !== u) node.title = u; tx(node.firstChild as ChildNode, t.title || u || T.ut);
    if (cur !== node) D.tb.insertBefore(node, cur); cur = node.nextSibling;
  }
};
const uSt = (): void => {
  bumpFps(0);
  const rtt = net.lastNetRttMs || net.ewmaRttMs, pend = inB + qIn.length, dm = vp(), rm = S.cm === "remote", mode = rm ? T.sc : T.mc;
  const idle = S.pa || S.id || S.nt, b = S.by, kb = !b ? "0 KB" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  D.sd.className = `rd ${S.pa || S.id ? "wn" : S.nt ? "id" : rttBand(rtt)}`;
  tx(D.qm, idle ? (S.pa ? T.pd : S.id ? T.id : T.nt0) : `${rtt ? `${rtt}ms` : "--ms"} · ${qName(qMode)}`);
  tx(D.qf, idle ? "" : ` · ${fpsVal}fps`); hd(D.qh, idle || !S.cr || S.fm !== "webp");
  hd(D.rm, !rm); if (rm) tx(D.rm, T.sb); D.rm.title = T.sc; hd(D.mn, S.cm !== "personal");
  tx(D.sr, `${S.uc ? T.nc : kb}${pend ? T.qu.replace("{n}", String(pend)) : ""}`);
  tx(D.sv, `${dm[0]}×${dm[1]}`); tx(D.sp, qLbl() + (S.cr ? " · HD" : "")); tx(D.sm, mode); hd(D.lb, !(S.nv || isSw));
};
const recover = (m?: string): void => { S.aid = S.dlg = null; rstF(1); if (m) toast(m); askUrg(1); };
const onPoll = (d: FramePayload | undefined, totalMs: number, reqEpoch = S.ep): void => {
  if (!d) return;
  const firstSync = !synced;
  if (totalMs > 0) synced = 1;
  if (d.connected === false) { setPf(d); isRec(d) ? recover(T.tsw) : goOff(eCode(d), d.error, d.portFile); return; }
  const wasPa = S.pa, oA = S.aid, oE = S.tep, hadBefore = S.tabs.length > 0, paintIt = applyFramePayloadState(S, d, reqEpoch, totalMs);
  if (paintIt === null) { if (S.on && S.st && !S.pa && !isDisc) askUrg(0); return; }
  if (hadBefore || S.tabs.length > 0) hadTabs = true;
  setPf(d);
  const sw = d.popupSwitched || d.recovered;
  if (sw || S.aid !== oA || S.tep !== oE) dropTimers();
  if (totalMs > 0 && !d.screencastPausedIdle) {
    const s = net.recordSample({ totalMs, serverMs: d.serverMs || 0, imageBytes: d.changed ? d.imageBytes || 0 : 0 });
    qApp = d.qualityApplied || (s.tierChanged ? s.effectiveTier : qApp);
  } else if (d.qualityApplied) qApp = d.qualityApplied;
  sView();
  if (wasPa !== S.pa) { syncPauseUi(); if (S.pa) clrTm(1); }
  S.nt ? sUrl("") : d.page && sUrl(d.page.url || "");
  sw ? (!cErr && setErr(), toast(d.popupSwitched ? T.tnt : T.tsc)) : (d.errorCode || d.error || !cErr) && setPErr(d);
  uTabs(); syncBnr(); syncDots();
  S.nt || S.pa || S.dlg ? (setSw(0), (S.nv = false), syncPh()) : paintIt ? paint(d.imageDataUrl!) : (fitStage(), isSw && painted && S.fh && setSw(0), syncPh());
  uSt();
  if (firstSync || !d.unchanged || sw || wasPa !== S.pa || oA !== S.aid || isA(d.tabs)) saveSwr();
};
const pushIn = (ev: InputEventPayload, imm = 1, tid = S.aid, tep = S.tep): void => {
  const wasIdle = S.id; act = nowMs(); S.cr = false;
  if (ev.action !== "pause" && ev.action !== "disconnect") S.id = false;
  qIn.push([ev, tid, tep]);
  wasIdle && !S.id ? syncPauseUi() : uSt();
  if (inB) return;
  const ms = imm ? 0 : net.getTypeBatchMs();
  ms <= 0 ? (cTm(inT), (inT = 0), void flIn()) : !inT && (inT = sTm(() => { inT = 0; void flIn(); }, ms));
};
const flIn = async (): Promise<void> => {
  if (inB || !qIn.length || !canCall()) return;
  inB = 1;
  const [f0, bTid, bTep] = qIn[0], isTab = /_tab$/.test(f0.action);
  let k = 1;
  while (k < qIn.length && /_tab$/.test(qIn[k][0].action) === isTab && qIn[k][1] === bTid && qIn[k][2] === bTep) k++;
  const batch = coalesceInputEvents(qIn.splice(0, k).map((x) => x[0]));
  const closed = batch.filter((e) => e.action === "close_tab" && e.targetId).map((e) => e.targetId as string);
  const needEp = batch.some((e) => PAGE_ACT.has(e.action)), ep = S.ep;
  const sendTid = isTab && batch.length === 1 && batch[0].targetId ? batch[0].targetId : (bTid ?? undefined);
  uSt();
  try {
    const d = await sendIn(batch, sendTid, needEp ? bTep : undefined);
    synced = 1;
    if (d?.connected === false && !isRec(d)) return goOff(eCode(d, "e_conn_lost"), d.error, d.portFile);
    setPf(d);
    if (d?.staleTarget) { dropIn(); !cErr && setErr(); toast(T.ttc); if (d.activeTargetId !== undefined) S.aid = d.activeTargetId || null; syncTabList(d); if ("dialog" in d) { S.dlg = d.dialog || null; syncBnr(); } rstF(); if (!S.pa) askUrg(1); return; }
    d?.recovered ? (!cErr && setErr(), toast(T.tsc)) : (d?.errorCode || (d?.error && !isTargetErrorText(d.error))) && setPErr(d);
    if (syncPe(d)) syncPauseUi();
    if (ep === S.ep) {
      if ("dialog" in (d || {})) { S.dlg = d?.dialog || null; syncBnr(); }
      if ((S.nt = isNoTabsPayload(d))) { S.aid = S.dlg = null; S.tabs = []; S.th = d?.tabsHash || ""; S.pg = {}; S.nv = false; setSw(0); sUrl(""); rstF(); syncBnr(); uTabs(); syncPh(); }
      else { if (d?.activeTargetId && d.activeTargetId !== S.aid) { S.aid = d.activeTargetId; rstF(); } syncTabList(d); }
    }
    if (!S.nt && !S.pa) askUrg(0);
  } catch (err) {
    isTargetErrorText((err as { message?: string } | null)?.message) ? recover() : setBErr(err);
  } finally {
    closed.forEach((id) => closing.delete(id));
    inB = 0; uSt(); if (qIn.length) void flIn();
  }
};
const sched = (ms: number, f = 0): void => { clrTm(1); if ((!hid() || f) && ms >= 0 && S.on && !isSb && !isDisc && (!S.pa || f)) pT = sTm(() => { pT = 0; void poll(f); }, ms); };
const askUrg = (f = 0): void => { if (!S.on || isSb || isDisc || (S.pa && !f)) return; pB ? (urg = { f: !!(f || (urg && urg.f)) }) : sched(20, f); };
const timing = (idleMs: number, inputBusy = 0) => net.computePollTiming({ idleMs, inputBusy: !!inputBusy, screencastIdle: S.id, hidden: hid(), errCount: pErr, settled: S.cr });
const nextMs = (idleMs: number, busy = 0): number => (!hid() && S.nt ? Math.max(1200, Math.min(15000, rnd(net.ewmaRttMs * 3))) : timing(idleMs, busy).nextDelayMs);
const reqFrame = (f: number, w: number, keep = 1): Promise<FramePayload | undefined> =>
  rpcSc("frame", { targetId: S.aid || undefined, sinceSeq: !f && keep ? S.seq : 0, lastFrameHash: S.fh || undefined, knownTabsHash: S.th || undefined, ...qArgs(), waitMs: f || net.ewmaRttMs > 120 ? 0 : w, forceRefresh: !!f });
const poll = async (f = 0): Promise<void> => {
  if (pB || isDisc || isSb || !canCall() || (!f && S.pa)) { if (f && pB && !isDisc && !isSb) urg = { f: true }; return; }
  pB = 1; const ep = S.ep, seq = ++pollSeq, t0 = pNow();
  try {
    const d = await reqFrame(f, hid() ? 0 : S.nt ? 1000 : timing(nowMs() - act).waitMs);
    if (seq !== pollSeq) return;
    lastFetchAt = nowMs(); pErr = d?.error && !d?.recovered ? Math.min(4, pErr + 1) : 0;
    onPoll(d, rnd(pNow() - t0), ep);
  } catch (err) {
    if (seq !== pollSeq) return;
    pErr = Math.min(4, pErr + 1);
    isTargetErrorText((err as { message?: string } | null)?.message) ? ((S.aid = null), rstF(1), (urg = { f: true })) : setBErr(err);
  } finally {
    pB = 0;
    if (S.on && !isSb && !S.pa && !isDisc) urg ? (sched(20, urg.f ? 1 : 0), (urg = 0)) : S.st && sched(nextMs(nowMs() - act, inB || qIn.length), 0);
  }
};
const conn = async (mode = "personal", f = 0): Promise<void> => {
  if (isCn || !canCall()) return;
  lastMode = mode; isCn = mode; pollSeq++; setErr(); clrTm(0); if (!S.on) uOff();
  const ep = S.ep, t0 = pNow(), rem = mode === "launch";
  try {
    const c = await rpcSc(rem ? mode : "connect", !rem && mode !== "auto" ? { ...qArgs(), mode } : qArgs());
    if (!c?.connected) { isCn = 0; goOff(eCode(c, "e_not_detected"), c?.error, c?.portFile); return; }
    act = nowMs(); S.on = S.st = true; S.pa = S.id = isSb = false; S.pe = +(c.pauseEpoch ?? 0) || 0;
    setPf(c); if (c.activeTargetId) S.aid = c.activeTargetId; syncTabList(c);
    S.dlg = c.dialog || null; S.nt = isNoTabsPayload(c);
    if (S.nt) { isCn = 0; sView(); syncPh(); uSt(); saveSwr(); liveSched(); return; }
    const d = await reqFrame(f || 1, 0, 0);
    isCn = 0; lastFetchAt = nowMs(); pErr = offErr = 0; onPoll(d, rnd(pNow() - t0), ep); liveSched();
  } catch (err) {
    isCn = 0;
    S.on && isTargetErrorText((err as { message?: string } | null)?.message) ? recover() : S.on ? (sView(), setBErr(err), liveSched()) : goOff(mapBridgeErrorKey(eRaw(err)), eRaw(err));
  }
};
const forceNow = (): void => {
  if (!ready) return;
  const t = nowMs();
  if (t - lastForceAt < 250) {
    if (!hid()) S.on && !isSb ? !S.pa && !pB && !pT && liveSched() : !isCn && !isDisc && !oB && !oT && schedOffP();
    return;
  }
  lastForceAt = t; pErr = offErr = 0;
  S.on && !isSb ? !S.pa && ((act = t), S.id && ((S.id = false), syncPauseUi()), clrTm(1), void poll(1)) : !isCn && !isDisc && (clrTm(0), oB ? (offUrg = 1) : void probeOff());
};
const onHide = (): void => { if (ready) { clrTm(1); clrTm(0); urg = 0; offUrg = 0; } };

ck(doc, (e: Event) => { const el = e.target as Element | null; if (popOn && !el?.closest?.("#pp,#bq")) setPop(false); if (setOn && !el?.closest?.("#sw,#bg,#bg0")) setSet(false); });
on(doc, "keydown", (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l" && S.on && !isSb) { pd(e); D.ui.focus(); D.ui.select(); }
  else if (e.key === "Escape" && (popOn || setOn)) { pd(e); popOn ? (setPop(false), D.bq.focus()) : (setSet(false), (S.on && !isSb ? D.bg : D.bg0).focus()); }
});
const syncHostCtx = (ctx: HostContext | null | undefined, fullCtx?: HostContext): void => { hostCtx = fullCtx || ctx || null; applyHostContext(hostCtx); const nl = pickLg(hostCtx); if (nl !== curLg) { curLg = nl; applyLangUi(); } };
const onResult = (r: { structuredContent?: unknown }): void => {
  const d = r?.structuredContent as FramePayload | undefined; if (!d) return;
  const sig = [!!d.connected, !!d.paused, !!d.standby, +(d.pauseEpoch ?? 0) || 0, !!d.portFile?.valid, +(d.portFile?.port ?? 0) || 0, d.activeTargetId, d.tabsHash, d.errorCode, d.error].join("|");
  if (sig === tSig) { if (d.connected && !started && ready) { started = 1; lastForceAt = nowMs(); isSb ? schedOffP() : !S.pa && (freshBoot ? liveSched() : void poll(0)); } return; }
  tSig = sig; pollSeq++; const wasLive = S.on && !isSb; setPf(d); syncPe(d, !synced || !!d.standby || d.mode === "standby");
  if (d.activeTargetId && !synced) S.aid = d.activeTargetId;
  syncTabList(d); if ("dialog" in d) S.dlg = d.dialog || null;
  if (d.connected) {
    S.on = true; S.nt = isNoTabsPayload(d); act = lastFetchAt = nowMs();
    isSb = d.standby === true || d.mode === "standby" || (S.pa && (!wasLive || !painted) && d.standby !== false);
    if (d.errorCode || d.error) setPErr(d); sView(); uTabs(); uSt(); saveSwr();
    if (ready) { isSb ? schedOffP() : !S.pa && void poll(0); }
    return;
  }
  if (!isCn) goOff(eCode(d), d.error, d.portFile);
};

app.ontoolresult = onResult; app.onhostcontextchanged = syncHostCtx;
app.onteardown = () => { clrTm(1); clrTm(0); stopReveal?.(); stopReveal = null; return {}; };

mount(); sView();
if (S.on) {
  if (+(boot.rttMs ?? 0) > 0) net.lastNetRttMs = net.ewmaRttMs = +(boot.rttMs ?? 0);
  S.nt ? sUrl("") : S.pg && sUrl(S.pg.url || "");
  uTabs(); uSt();
  if (!S.nt && !isSb && !useSwr && b0.changed && isSafeImageUrl(b0.imageDataUrl)) paint(b0.imageDataUrl);
}
const initBridge = (): Promise<void> => (setErr(), app.connect().then(() => {
  ready = 1; syncHostCtx(app.getHostContext()); if (!canCall()) setErr("b_notools");
  uOff(); syncPauseUi(); stopReveal?.();
  stopReveal = setupRevealObservers({ onReveal: forceNow, onHide, getLastFetchAt: () => lastFetchAt, bridgeApp: app });
  if (!started && canCall()) { started = 1; lastForceAt = nowMs(); S.on && !isSb ? !S.pa && (freshBoot ? liveSched() : void poll(0)) : schedOffP(); }
}).catch((err) => { ready = 0; uOff(); syncPauseUi(); setBErr(err); }));
void initBridge();
