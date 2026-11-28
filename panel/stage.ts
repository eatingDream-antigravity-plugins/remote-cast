import { App } from "./kit/bridge.ts";
import type { HostContext, ThemePreference } from "./kit/bridge.ts";
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
type CfgState = { lang: string; defaultQuality: string; defaultConnectMode: string; bgPollIntervalSec: number; idlePauseSec: number; wheelCoalesceMs?: number; newTabUrl?: string; theme?: string; lastHostTheme?: string };

const K_TID = "targetId", K_AT = "activeTargetId", K_TH = "tabsHash", K_CM = "connectionMode", K_PF = "portFile", K_EC = "errorCode", K_PE = "pauseEpoch", K_SPI = "screencastPausedIdle", K_PS = "popupSwitched", K_RC = "recovered", K_IDU = "imageDataUrl", K_IB = "imageBytes", K_SM = "serverMs", K_QA = "qualityApplied", K_DQ = "defaultQuality", K_DCM = "defaultConnectMode", K_BG = "bgPollIntervalSec", K_IP = "idlePauseSec", K_LHT = "lastHostTheme", K_VW = "viewportWidth", K_VH = "viewportHeight", K_SG = "settingsGen", K_SP = "settingsPath", K_SE = "settingsError", K_CN = "connected", K_PA = "paused", K_SB = "standby", K_ERR = "error", K_DLG = "dialog", K_EW = "ewmaRttMs", K_GEQ = "getEffectiveQuality", K_DS = "dataset", K_TY = "type", K_PE2 = "pressEnter", K_MOD = "modifiers", K_PASTE = "Paste", K_VAL = "value", K_CNM = "className";
const K_SC = "structuredContent", K_TB = "tabs", K_AC = "action", K_PR = "personal", K_AU = "auto", K_ES = "Escape", K_EN = "Enter", K_KD = "keydown", K_MM = "mousemove", K_TI = "title", K_HD = "hidden", K_TC = "textContent", K_L = "length", K_SP0 = "split", K_STP = "setThemePreference", K_ST0 = "settings", K_CS = "chrome_stream_", K_FC = "focus", K_W = "width", K_H = "height", K_BT = "button", K_TR = "target", K_IC = "isComposing", K_MSG = "message", K_INC = "includes", K_LT = "light", K_DK = "dark", K_SYS = "system", K_RS = "resume", K_PRM = "prompt", K_AL = "alert";
const doc = document, M = Math, N = navigator, LS_LG = `${K_CS}lang`;
const b0: BootPayload = (globalThis as { __CHROME_STREAM_BOOT__?: BootPayload }).__CHROME_STREAM_BOOT__ || {};
const fin = Number.isFinite, rnd = M.round, isA = Array.isArray;
const num = (v: unknown): number => +(v as number) || 0, low = (s: string): string => s.toLowerCase();
const on = (n: EventTarget | null | undefined, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions | boolean): void => { (n as any)?.addEventListener?.(ev, fn, o); };
const ck = (n: EventTarget | null | undefined, fn: (e: any) => void): void => on(n, "click", fn);
const sa = (n: Element | null | undefined, k: string, v: string | number | boolean): void => { (n as any)?.setAttribute?.(k, String(v)); };
const pd = (e: { preventDefault(): void }): void => e.preventDefault();
const sp = (e: { stopPropagation(): void }): void => e.stopPropagation();
const tx = (n: { textContent: string | null }, v: string): void => { if (n[K_TC] !== v) n[K_TC] = v; };
const hd = (n: { hidden: boolean }, v: unknown): boolean => (n[K_HD] = !!v);
const bumpE = (n: number): number => M.min(4, n + 1);
const tg = (n: Element, c: string, v: unknown): boolean => n.classList.toggle(c, !!v);
const pNow = (): number => performance.now(), nowMs = (): number => Date.now(), cl = (v: number, lo: number, hi: number): number => M.max(lo, M.min(hi, v));
const sTm = (f: () => void, m?: number): Tm => globalThis.setTimeout(f, m), cTm = (i: Tm): void => globalThis.clearTimeout(i as ReturnType<typeof setTimeout>), hid = (): boolean => doc.visibilityState === K_HD;
const isMac = /mac/i.test(N?.platform || N?.userAgent || "");
const root = doc.getElementById("app") as HTMLElement, app = App({ name: "Remote Cast", version: b0.appVersion || b0.relayVersion || "0.1.0" }, {}), net = new AdaptiveBandwidthController(K_AU);
const KEYS = new Set<string>([...REP, K_EN, K_ES, "Home", "End", "Space"]);
const QK = `${K_AU} ultra low medium high`[K_SP0](" "), IK = (`${K_EN} ${K_ES} Tab Backspace Undo Copy ${K_PASTE} SelectAll`)[K_SP0](" ");
const DLG = "alert confirm prompt beforeunload"[K_SP0](" "), DLG_K = "da df dp dl"[K_SP0](" ");
const PAGE_ACT = new Set<string>(`click mousedown mouseup ${K_MM} scroll ${K_TY} key ${K_DLG} navigate back forward reload close_tab`[K_SP0](" "));
const BN = ["left", "middle", "right"] as const, BM = [1, 4, 2] as const;
const ls = (k: string, v?: string): string => { try { return v === undefined ? localStorage.getItem(k) || "" : (localStorage.setItem(k, v), ""); } catch { return ""; } };
type SwrBlob = { v?: number; savedAt?: number; data?: BootPayload };
const SWR_K = `${K_CS}swr`;
const readSwr = (): SwrBlob | null => {
  try {
    const p = JSON.parse(ls(SWR_K) || "null") as SwrBlob | null;
    return p?.v === 1 && fin(p.savedAt) && p.data && typeof p.data === "object" ? p : null;
  } catch { return null; }
};
const swr0 = readSwr();
const b0Empty = b0[K_CN] === undefined && !b0.bootTs;
const useSwr = !!swr0 && (b0Empty || (swr0.savedAt as number) > (+(b0.bootTs ?? 0) || 0));
const boot: BootPayload = useSwr ? { ...b0, ...swr0!.data } : b0;
const freshBoot = !useSwr && typeof b0.bootTs === "number" && nowMs() - b0.bootTs < 2500;
const CFGS: readonly [string, string, keyof CfgState, 0 | 1, string][] = [
  ["sl", "lg", "lang", 0, `${K_AU}:la|en:=English|zh-CN:=简体中文`],
  ["sq", "dq", K_DQ, 0, QK.map((k) => `${k}:q_${k}`).join("|")],
  ["sc", "dc2", K_DCM, 0, `${K_AU}:q_auto|${K_PR}:mc|remote:sc`],
  ["sb", "bg", K_BG, 1, "0:q_auto|5:k5|15:k15|30:k30|-1:bgp"],
  ["si2", "ip2", K_IP, 1, "12:k12|30:k30|60:k60|0:of"],
];

const D: Record<string, any> = {}, TAGS: Record<string, string> = { b: "button", s: "span", i: "input", l: "select" }, ARIA: Record<string, string> = { e: "expanded", p: "pressed", c: "checked", h: "haspopup", l: "label", i: "hidden", v: "live", s: "selected" };
const sA = (n: Element | null | undefined, k: string, v: string | number | boolean): void => sa(n, "aria-" + ARIA[k], v);
const tog = (btns: HTMLElement[], k: string, val: string, ak = "c"): void => { for (const b of btns) { const f = b[K_DS][k] === val; sA(b, ak, f); tg(b, "on", f); } };
const disN = (v: unknown, ...ks: string[]): void => { for (const k of ks) D[k].disabled = !!v; };
const h = (sel: string, at?: string | 0, ...kids: HChild[]): HTMLElement => {
  const hid0 = sel.endsWith("!"), sp = (hid0 ? sel.slice(0, -1) : sel)[K_SP0]("#"), tp = sp[0][K_SP0](".");
  let raw = tp.shift() || ""; if (raw === "!") { tp.unshift("b"); raw = "b"; }
  const tag = TAGS[raw] || raw || "div", n = doc.createElement(tag) as HTMLElement & { type?: string };
  if (raw === "b") n[K_TY] = "button";
  if (tp[K_L]) n[K_CNM] = tp.join(" ");
  if (sp[1]) D[n.id = sp[1]] = n;
  if (hid0) n[K_HD] = true;
  if (at) for (const kv of at[K_SP0](";")) {
    const j = kv.indexOf("=");
    if (j > 0) {
      const k = kv.slice(0, j), v = kv.slice(j + 1);
      if (k === "t") n[K_TC] = v;
      else if (k[0] === ".") n[K_DS][k.slice(1)] = v;
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
  for (const [k, v] of [["class", "ic"], [K_W, sz], [K_H, sz], ["viewBox", "0 0 16 16"], ["aria-hidden", "true"]] as const) sa(s, k, v);
  for (const dp of IC[idx][K_SP0](";")) { const p = doc.createElementNS(ns, "path"); sa(p, "d", dp); if (pid) D[pid] = p; s.appendChild(p); }
  return s;
};

const bEp = num(boot.epoch) || 1;
const S: PanelState = {
  on: !!boot[K_CN], cm: boot[K_CM] || "", cr: !!boot.crisp, fm: boot.format || "",
  tabs: isA(boot.tabs) ? boot.tabs : [], th: boot[K_TH] || "",
  aid: boot[K_AT] || null, ep: bEp, tep: bEp, pe: num(boot[K_PE]), pg: boot.page || {},
  seq: useSwr ? 0 : boot.seq || 0, fh: useSwr ? "" : boot.frameHash || "", by: useSwr ? 0 : boot[K_IB] || 0, uc: false,
  nv: false, st: !boot[K_PA], pa: !!boot[K_PA], id: !!boot[K_SPI],
  dlg: boot.dialog || null, nt: !!(boot[K_CN] && isNoTabsPayload(boot)),
};
const THS: readonly ThemePreference[] = [K_SYS, K_LT, K_DK];
const pTh = (v: unknown): ThemePreference => (v === K_LT || v === K_DK ? v : K_SYS);
const pHt = (v: unknown): "light" | "dark" => (v === K_LT ? K_LT : K_DK);
let cfg: CfgState = { lang: K_AU, [K_DQ]: K_AU, [K_DCM]: K_AU, [K_BG]: 0, [K_IP]: 12, theme: K_SYS, [K_LHT]: K_DK, ...(boot[K_ST0] as Partial<CfgState> | undefined) };
let cfgPath = boot[K_SP] || "settings.json", cfgGen = +(boot[K_SG] ?? 0) || 0, cfgErr = boot[K_SE] || "", hostCtx: HostContext | null = null;
let thP: ThemePreference = pTh(cfg.theme), lht: "light" | "dark" = pHt(cfg[K_LHT]), thLk = 0;

const pickLg = (c: HostContext | null = hostCtx): PanelLang =>
  resolvePanelLang({ saved: cfg.lang && cfg.lang !== K_AU ? cfg.lang : ls(LS_LG), hostLocale: (c?.locale || c?.language || "") as string, navLang: N?.language || "", bootLocale: boot.locale || b0.locale || "" });
let curLg: PanelLang = pickLg(), T: I18nDict = I18N[curLg] || I18N.en, portF: PortFileInfo | null = boot[K_PF] || null, tabSig = "", qApp = boot[K_QA] || "low";
let errCode: string | null = null, errRaw: string | null = null, errDet = 0, cErr = false, hadTabs = S[K_TB][K_L] > 0;
let isCn: string | 0 = 0, isDisc = 0, isPa = 0, isSw = 0, isSb = !!(boot[K_CN] && (boot[K_SB] === true || (boot[K_PA] === true && boot[K_SB] !== false))), qMode: QualityMode = (QK[K_INC](cfg[K_DQ]) ? cfg[K_DQ] : K_AU) as QualityMode, lastMode = K_PR, dlgKey = "", imeOn = false, popOn = false, setOn = false;
let qIn: Array<[InputEventPayload, string | null, number]> = [], inB = 0, inT: Tm = 0, pB = 0, pT: Tm = 0, oT: Tm = 0, oB = 0, urg = 0, act = nowMs(), tT: Tm = 0, dropTimers = (): void => {};
let pErr = 0, offErr = 0, offUrg = 0, pollSeq = 0, lastFetchAt = boot[K_CN] ? (freshBoot ? +(b0.bootTs || nowMs()) : nowMs()) : 0, lastForceAt = 0, stopReveal: (() => void) | null = null;
let pGen = 0, painted = 0, started = 0, synced = 0, ready = 0, tSig = "", lAr = 0, fTimes: number[] = [], fpsVal = 0, saveT: Tm = 0;
const closing = new Set<string>(), tMap = new Map<string, HTMLElement>();
let lNodes: HTMLElement[] = [], gNodes: HTMLElement[] = [], qBtns: HTMLElement[] = [], lgBtns: HTMLElement[] = [], thBtns: HTMLElement[] = [];

const syncNetCfg = (): void => { net[K_BG] = +cfg[K_BG] || 0; const wc = +(cfg.wheelCoalesceMs ?? 0); if (wc >= 20) net.wheelCoalesceMs = wc; };
net.setMode(qMode); syncNetCfg();

const vp = (): [number, number] => [+(S.pg[K_VW] ?? 0) || 1280, +(S.pg[K_VH] ?? 0) || 800];
const qName = (q: string): string => T[`q_${QK[K_INC](q) ? q : "low"}`] || q;
const qLbl = (): string => { const e = qName(qApp || net[K_GEQ]()); return qMode === K_AU ? T.ap + e : e; };
const qArgs = (): { qualityPreset: string; rttMs: number } => ({ qualityPreset: net[K_GEQ](), rttMs: net[K_EW] || 0 });
const canCall = (): boolean => !!ready && app.hasServerTools();
const eRaw = (e: unknown): string => (typeof e === "string" ? e : (e as { message?: string } | null)?.[K_MSG] || String(e || ""));
const eCode = (d: FramePayload | null | undefined, fb?: string): string | null => (d?.[K_EC] ? `e_${d[K_EC]}` : fb || null);
const isTE = (e: unknown): boolean => isTargetErrorText((e as { message?: string } | null)?.[K_MSG]);
const rpcSc = (() => {
  type J = { n: string; a: Record<string, unknown>; s: (v: FramePayload | undefined) => void; j: (e: unknown) => void };
  let busy = 0, bg: J | null = null;
  const hi: J[] = [];
  const isBg = (n: string): boolean => n === "frame" || n === "stage";
  const run = async (n: string, a: Record<string, unknown>): Promise<FramePayload | undefined> => {
    const g = isBg(n) && net[K_EW] > 120 && num(a.waitMs) > 0 ? { ...a, waitMs: 0 } : a;
    const r = (await app.callServerTool({ name: K_CS + n, arguments: g })) as { [K_SC]?: FramePayload; isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    if (!r?.[K_SC] && r?.isError) { const m = r.content?.find((c) => c?.text)?.text; if (m) throw new Error(m); }
    return r?.[K_SC];
  };
  const pump = async (): Promise<void> => {
    if (busy) return;
    busy = 1;
    try {
      while (hi[K_L] || bg) {
        const q = hi.shift() || ((x) => ((bg = null), x))(bg!);
        try {
          let v: FramePayload | undefined;
          for (let rt = 0; ; ) {
            try {
              v = await run(q.n, q.a);
              if (rt || v?.[K_EC] !== "relay_busy") break;
            } catch (e) { if (rt || !isBusyErrorText(eRaw(e))) throw e; }
            rt = 1; await new Promise<void>((r) => sTm(r, 160));
          }
          q.s(v);
        } catch (e) { q.j(e); }
      }
    } finally { busy = 0; }
  };
  return (n: string, a: Record<string, unknown>): Promise<FramePayload | undefined> =>
    new Promise((s, j) => { const q: J = { n, a, s, j }; isBg(n) ? (bg?.s(undefined), (bg = q)) : hi.push(q); void pump(); });
})();
const sendIn = (events: InputEventPayload[], targetId?: string, targetEpoch?: number): Promise<FramePayload | undefined> => rpcSc("input", fin(targetEpoch) && targetEpoch! > 0 ? { [K_TID]: targetId, targetEpoch, events } : { [K_TID]: targetId, events });
const dropIn = (): void => { qIn = []; cTm(inT); inT = 0; dropTimers(); };
const evIn = (action: string, o: Record<string, unknown> = {}, imm = 1, tid = S.aid, tep = S.tep): void => pushIn({ [K_AC]: action, ...o }, imm, tid, tep);
const kyIn = (key: string, modifiers?: number, imm: number | boolean = 1): void => evIn("key", modifiers ? { key, [K_MOD]: modifiers } : { key }, imm ? 1 : 0);
const isRec = (d: FramePayload | null | undefined): boolean => Boolean(d?.[K_RC] || isTargetErrorText(d?.[K_ERR]));
const modsOf = (e: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): number => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const focusSt = (): void => (D.si || D.st)[K_FC]({ preventScroll: true });
const toast = (m: string): void => { if (m) { tx(D.ts, m); tg(D.ts, "on", 1); cTm(tT); tT = sTm(() => tg(D.ts, "on", 0), 1600); } };
const setPf = (d: FramePayload | null | undefined): void => {
  if (!d) return;
  if (d[K_PF]) portF = d[K_PF];
  if (d[K_CM]) S.cm = d[K_CM];
  const e = num(d.epoch); if (e > 0) S.tep = e; syncCfg(d);
};
const syncTabList = (d: FramePayload | null | undefined): void => {
  if (isA(d?.[K_TB])) {
    S[K_TB] = d[K_TB]; if (d[K_TB][K_L] > 0) hadTabs = true; S.th = d[K_TH] || "";
    setMeta(S[K_TB].find((t) => t[K_TID] === S.aid)); uTabs();
  }
};
const clsP = (): void => { if (popOn) setPop(false); if (setOn) setSet(false); };
const bumpPe = (d: FramePayload): void => { const pe = +(d[K_PE] ?? NaN); if (fin(pe) && pe >= S.pe) S.pe = pe; };
const syncPe = (d: FramePayload | null | undefined, fb?: boolean): number => {
  const pe = +(d?.[K_PE] ?? NaN), g = fin(pe) && pe > S.pe; if (g) S.pe = pe;
  return typeof d?.[K_PA] === "boolean" && (g || fb) ? ((S.st = !(S.pa = d[K_PA])), g ? 1 : 0) : 0;
};
const clrTm = (w: number | boolean): void => { if (w) { cTm(pT); pT = 0; } else { cTm(oT); oT = 0; } };
const saveSwr = (): void => {
  const pf = portF ? { valid: !!portF.valid, fallback: !!portF.fallback, port: portF.port ?? null } : null;
  const st = { ...cfg } as Record<string, unknown>; delete st[K_PF]; delete st.userDataDir;
  ls(SWR_K, JSON.stringify({ v: 1, savedAt: nowMs(), data: { [K_CN]: S.on, [K_CM]: S.cm || null, [K_TB]: S[K_TB], [K_TH]: S.th, [K_AT]: S.aid, page: S.pg, [K_QA]: qApp, [K_PA]: S.pa, [K_SB]: isSb, noTabs: S.nt, [K_PF]: pf, [K_ST0]: st } }));
};
const hideCvs = (): void => { painted = 0; hd(D.vc, 1); D.vc.className = "c"; hd(D.ph, 0); hd(D.pb, 1); };
const liveSched = (): void => { if (S.on && !isSb && S.st && !S.pa && !isDisc) sched(nextMs(0), 0); };

const setErr = (code?: string | null, raw?: unknown, st?: number | boolean): void => { errCode = code || null; errRaw = raw ? eRaw(raw) : null; cErr = !!st && !!(code || raw); errDet = 0; syncBnr(); syncDots(); };
const setPErr = (d: FramePayload | null | undefined, fb?: string, st?: number | boolean): void => (!d?.[K_EC] && !d?.[K_ERR] ? setErr() : setErr(eCode(d, fb || (isBusyErrorText(d?.[K_ERR]) ? "b_busy" : undefined)), d[K_ERR], st));
const setBErr = (err: unknown, st?: number | boolean): void => { const r = eRaw(err); setErr(mapBridgeErrorKey(r), r, st); };
const setSb = (d: FramePayload, live?: boolean): void => { S.on = isSb = S.pa = true; S.st = S.id = false; S.nt = isNoTabsPayload(d); setPf(d); if (live) bumpPe(d); };
const chkConn = (d: FramePayload | null | undefined): boolean => !!(d?.[K_CN] === false && !isRec(d) && (goOff(eCode(d, "e_conn_lost"), d[K_ERR], d[K_PF]), 1));

const bumpFps = (hit: number | boolean): void => { const t = nowMs(); if (hit) fTimes.push(t); while (fTimes[K_L] && t - fTimes[0] > 1500) fTimes.shift(); fpsVal = fTimes[K_L] ? M.min(60, rnd(fTimes[K_L] / 1.5)) : 0; };
  const fitStage = (nw = painted ? D.vc[K_W] : 0, nh = painted ? D.vc[K_H] : 0): void => { const a = resolveStageAspect(+(S.pg[K_VW] ?? 0), +(S.pg[K_VH] ?? 0), nw, nh); if (a && a !== lAr) D.vw.style.setProperty("--ar", String(lAr = a)); };
const paint = (url: string): void => {
  if (!isSafeImageUrl(url)) return;
  const gen = ++pGen, im = new Image(), dm = vp(); im.decoding = "async";
  const blit = (src: CanvasImageSource & { close?: () => void }, nw: number, nh: number): void => {
    if (gen !== pGen) return src.close?.();
    const v = D.vc; fitStage(nw, nh);
    if (v[K_W] !== nw || v[K_H] !== nh) { v[K_W] = nw; v[K_H] = nh; }
    const cx = v.getContext("2d", { alpha: false });
    if (cx) { cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high"; cx.drawImage(src, 0, 0, nw, nh); }
    src.close?.(); painted = 1; bumpFps(1); hd(v, 0); hd(D.ph, 1); setSw(0); uSt();
  };
  const go = (): void => {
    if (gen !== pGen) return;
    const nw = im.naturalWidth || dm[0], nh = im.naturalHeight || dm[1];
    typeof createImageBitmap === "function" ? createImageBitmap(im).then((b) => blit(b, b[K_W] || nw, b[K_H] || nh), () => blit(im, nw, nh)) : blit(im, nw, nh);
  };
  im.src = url;
  im.decode ? im.decode().then(go, () => im.complete && im.naturalWidth && go()) : (im.onload = go);
};
const setPop = (o: boolean): void => { popOn = !!o; if (popOn) setSet(false); hd(D.pp, !popOn); sA(D.bq, "e", popOn); };
const setSet = (o: boolean): void => { setOn = !!o; if (setOn) setPop(false); hd(D.sw, !setOn); sA(D.bg, "e", setOn); sA(D.bg0, "e", setOn); if (setOn) syncCfgUi(); };
const setIme = (o: boolean): void => { imeOn = !!o; hd(D.im, !imeOn); sA(D.bi, "e", imeOn); tg(D.st, "im", imeOn); tg(D.bi, "on", imeOn); if (imeOn) D.ti[K_FC](); };

const syncBnr = (): void => {
  const txt = !errCode && !errRaw ? "" : T[errCode || ""] || (curLg === "zh-CN" ? T.b_generic : errRaw || T.b_generic);
  const det = !!(errRaw && errRaw !== txt), live = S.on && !isSb, g = live && S.dlg && typeof S.dlg === "object" ? S.dlg : null;
  const show = (m: number): void => "dp di dk do er eb dx bn"[K_SP0](" ").forEach((k, i) => hd(D[k], !(m & (1 << i))));
  const raw = errRaw || "";
  if (g) {
    const tp = g[K_TY] || K_AL, key = `${g[K_TID] || ""}:${tp}:${g[K_MSG] || ""}`;
    tg(D.bn, "wn", 1); tx(D.dp, T[DLG_K[M.max(0, DLG.indexOf(tp))]]); tx(D.dm, g[K_MSG] || g.url || "");
    hd(D.ed, 1); show(137 | (tp === K_PRM ? 2 : 0) | (tp !== K_AL ? 4 : 0));
    if (key !== dlgKey) { dlgKey = key; if (tp === K_PRM) { D.di[K_VAL] = g.defaultPrompt || ""; sTm(() => D.di[K_FC](), 0); } }
  } else if (live && txt) {
    tg(D.bn, "wn", 0); tx(D.dm, txt); tx(D.ed, raw); hd(D.ed, !(det && errDet)); show(208 | (det ? 32 : 0)); dlgKey = "";
  } else {
    hd(D.bn, 1); hd(D.ed, 1); dlgKey = "";
  }
  const od = !live && det; tx(D.om, txt); tx(D.od2, raw); hd(D.ob2, !od); hd(D.od2, !(od && errDet)); hd(D.oe, !txt);
};
const syncDots = (): void => {
  const he = !!(errCode || errRaw), ok = !!portF?.valid;
  D.ld[K_CNM] = "ed " + (!S.on ? "" : he ? "er" : S.pa || S.id ? "wn" : S.nt ? "" : "ok");
  D.od[K_CNM] = D.o0[K_CNM] = "ed " + (he ? "er" : isCn || isSb ? "wn" : ok ? "ok" : "");
  tg(D.op, "ok", !isSb && ok && !he); tg(D.op, "wn", isSb && !he); tg(D.op, "er", he);
};
const setSw = (v: number): void => { isSw = v ? 1 : 0; tg(D.vc, "sw", isSw); hd(D.lb, !(S.nv || isSw)); };
const sUrl = (u: string): void => { if (doc.activeElement !== D.ui) D.ui[K_VAL] = u || ""; };
const setMeta = (m: TabInfo | undefined): void => { if (m) { S.pg = { ...S.pg, [K_TI]: m[K_TI] || "", url: m.url || "" }; sUrl(m.url || ""); } };
const rstF = (th?: number): void => { S.seq = 0; S.fh = ""; S.cr = false; if (th) S.th = ""; };

const syncPh = (): void => {
  if (S.nt) { setSw(0); S.nv = false; hideCvs(); tx(D.pm, hadTabs ? T.wc : T.nt0); tx(D.ps, hadTabs ? T.wcb : T.nt0b); hd(D.ps, 0); hd(D.pa2, 0); return; }
  hd(D.ps, 1); hd(D.pa2, 1);
  if (painted) { const dim = !!(S.pa || S.id); hd(D.ph, 1); hd(D.vc, 0); tg(D.vc, "pa", dim); tx(D.pb, S.pa ? T.pp : T.ip); hd(D.pb, !dim); }
  else { tx(D.pm, S.pa ? T.pd : T.ld); hd(D.ph, 0); hd(D.pb, 1); }
};
const syncPauseUi = (): void => {
  const lbl = S.pa ? T.rs : T.pa, dis = !canCall(), b = D.bp;
  tg(b, "wp", S.pa); sA(b, "p", S.pa); sA(b, "l", lbl); b[K_TI] = lbl; tx(D.bt, lbl);
  b.disabled = Boolean(isPa || isDisc || dis); disN(isDisc || dis, "dc", "n3", "n4", "rv");
  sa(D.pi, "d", IC[S.pa ? 2 : 1]); syncDots(); syncPh(); uSt();
};

const schedOffP = (ms = net.computeOfflinePollDelay({ [K_HD]: hid(), errCount: offErr })): void => {
  clrTm(0);
  if (!hid() && ms >= 0 && (!S.on || isSb) && !isCn && !isDisc && canCall()) oT = sTm(() => { oT = 0; void probeOff(); }, ms);
};
const probeOff = async (): Promise<void> => {
  if ((S.on && !isSb) || isCn || isDisc || oB || !canCall()) return;
  oB = 1; const seq = ++pollSeq, t0 = pNow();
  try {
    const d = await reqFrame(0, 0, 0);
    if (seq !== pollSeq || isCn || isDisc) return;
    lastFetchAt = nowMs(); offErr = d?.[K_ERR] ? bumpE(offErr) : 0;
    if (!d?.[K_SPI]) net.recordSample({ totalMs: rnd(pNow() - t0), [K_SM]: d?.[K_SM] || 0, [K_IB]: 0 });
    if (d?.[K_CN] === false) { if (isSb) { isSb = false; goOff(eCode(d), d[K_ERR], d[K_PF]); return; } setPf(d); uOff(); saveSwr(); }
    else if (d?.[K_CN] === true && (d[K_PA] || d[K_SB])) {
      const wasSb = isSb;
      setSb(d); syncPe(d, true); syncTabList(d); wasSb ? uOff() : sView(); saveSwr();
    } else if (d?.[K_CN]) { isSb = false; act = nowMs(); onPoll(d, 0, S.ep); liveSched(); return; }
    else if (d) { setPf(d); if (!S.on) uOff(); }
  } catch { if (seq !== pollSeq) return; offErr = bumpE(offErr); } finally {
    oB = 0; if ((!S.on || isSb) && !isCn && !isDisc) schedOffP(offUrg ? 20 : undefined); offUrg = 0;
  }
};
const goOff = (code?: string | null, raw?: unknown, pf?: PortFileInfo): void => {
  pollSeq++; S.on = S.pa = S.id = S.nt = S.cr = S.nv = isSb = false; isDisc = isPa = isSw = 0; cErr = hadTabs = false;
  S.dlg = null; S.st = true; S.th = S.cm = S.fm = "";
  errCode = code || null; errRaw = raw ? eRaw(raw) : null; errDet = 0; fTimes = []; fpsVal = 0; if (pf) portF = pf;
  dropIn(); clrTm(1); sView(); saveSwr(); schedOffP();
};
const uOff = (): void => {
  const ok = !!portF?.valid;
  if (isSb) {
    tx(D.op, T.sbb); tx(D.ob, isCn === K_RS ? T.rsg : T.rsb); tx(D.orv, isDisc === 2 ? T.tdc : T.rvl); tx(D.ont, T.sbn);
    hd(D.ol, 1); hd(D.orv, 0); hd(D.dt, 1);
  } else {
    tx(D.op, ok ? (portF?.fallback ? T.rse : T.rmy) : T.nf);
    tx(D.ob, isCn === K_PR ? T.cn : T.cm); tx(D.ol, isCn === "launch" ? T.cn : T.os); tx(D.ont, T.oss);
    hd(D.ol, 0); hd(D.orv, 1); hd(D.dt, 0);
    if (!ok && !D.dt[K_DS].u) D.dt.open = true;
  }
  syncBnr(); disN(isCn || isDisc || !canCall(), "ob", "ol", "orv");
  syncDots();
};
const sView = (): void => { const off = !S.on || isSb; hd(D.vo, !off); hd(D.vn, off); !off ? (clrTm(0), syncBnr(), syncPauseUi(), fitStage()) : (clsP(), clrTm(1), hideCvs(), setSw(0), uOff()); };

const renderGuide = (): void => {
  tx(gNodes[0], T.s1);
  const [a, b] = T.s2[K_SP0]("$0"); gNodes[1].replaceChildren(doc.createTextNode(a), h("code", "t=chrome://inspect/#remote-debugging"), doc.createTextNode(b || ""));
  tx(gNodes[2], T.s3.replace(/\*/g, ""));
};
const syncCfgUi = (): void => {
  for (const [id, , k] of CFGS) D[id][K_VAL] = String(cfg[k] ?? "");
  tog(thBtns, "th", thP);
  tx(D.sp2, `${T.sf}: ${cfgPath}`); D.sp2[K_TI] = cfgPath; hd(D.se, !cfgErr); tx(D.se, cfgErr ? T.sfb : "");
};
const putCfg = (p: Partial<CfgState>): void => { cfg = { ...cfg, ...p }; syncNetCfg(); saveSwr(); };
const chkLg = (c?: HostContext | null): void => { const nl = pickLg(c); if (nl !== curLg) { curLg = nl; applyLangUi(); } };
const syncCfg = (d: FramePayload, quiet?: number): void => {
  if (d[K_SP]) cfgPath = d[K_SP];
  const ne = d[K_SE] || "", ec = ne !== cfgErr; cfgErr = ne;
  const g = num(d[K_SG]);
  if (d[K_ST0] && typeof d[K_ST0] === "object" && (!g || g > cfgGen || quiet)) {
    const ext = !quiet && cfgGen > 0 && g > cfgGen && !saveT;
    if (g > cfgGen) cfgGen = g;
    putCfg(d[K_ST0] as Partial<CfgState>);
    if (cfg[K_LHT]) lht = pHt(cfg[K_LHT]);
    if (!thLk && cfg.theme) { const nt = pTh(cfg.theme); if (nt !== thP) { thP = nt; app[K_STP]?.(nt); } }
    chkLg();
    if (setOn || ec || quiet) syncCfgUi();
    if (ext) toast(T.trl);
  } else if (ec && setOn) syncCfgUi();
};
const applyLangUi = (): void => {
  T = I18N[curLg] || I18N.en; doc.documentElement.lang = curLg;
  for (const n of lNodes) {
    const ds = n[K_DS], vi = T[ds.i || ""], va = T[ds.a || ""], vp0 = T[ds.p || ""], vt = T[ds.t || ""];
    if (vi) tx(n, vi); if (va) { sA(n, "l", va); if (n.tagName === "BUTTON" && !vt) n[K_TI] = va; }
    if (vt) n[K_TI] = vt; if (vp0) (n as HTMLInputElement).placeholder = vp0;
  }
  tog(lgBtns, "lg", curLg, "p");
  for (const [, n] of tMap) sA(n.lastChild as Element | null, "l", T.ct);
  renderGuide(); uOff(); syncBnr(); syncPauseUi(); syncCfgUi();
};
const setSS = (m: string, c = ""): void => { tx(D.ss, m); D.ss[K_CNM] = c; };
const saveCfg = async (patch: Record<string, unknown>, quiet?: number): Promise<void> => {
  putCfg(patch as Partial<CfgState>);
  if ("lang" in patch) { ls(LS_LG, patch.lang === K_AU ? "" : String(patch.lang)); chkLg(); }
  if (K_DQ in patch && typeof patch[K_DQ] === "string" && QK[K_INC](patch[K_DQ])) setQ(patch[K_DQ], 1);
  if (!canCall()) return;
  const failSv = () => { saveT = 0; setSS(T.svf, "erc"); };
  if (!quiet) { setSS(T.sv); cTm(saveT); saveT = 1; }
  try {
    const r = await rpcSc("config", { [K_AC]: "update", patch });
    if (quiet) { if (r?.ok) syncCfg(r, 1); }
    else r?.ok ? (syncCfg(r, 1), setSS(T.svd, "hd"), (saveT = sTm(() => { saveT = 0; setSS(""); }, 1800))) : failSv();
  } catch { if (!quiet) failSv(); }
};

const mkEmblem = (dotId: string, big: number): HTMLElement => h(big ? "s.e.el" : "s.e", 0, ico(0, big ? 18 : 13), [`s.ed#${dotId}`]);
const mkLang = (): HTMLElement => h(".l", "R=group;.a=lg", ...([["EN", "en"], ["中文", "zh-CN"]] as const).map(([lbl, lg]) => {
  const b = h("b", `t=${lbl};.lg=${lg};@p=${curLg === lg}`);
  ck(b, () => { if (curLg !== lg) { curLg = lg; ls(LS_LG, lg); applyLangUi(); void saveCfg({ lang: lg }); } });
  lgBtns.push(b); return b;
}));

const mount = (): void => {
  const gLi = (i: number): HSpec => { const s = h("s"); gNodes[i] = s; return ["li", 0, ["s.n", `t=0${i + 1}`], s]; };
  const row = (k: string, id: string): HSpec => [".pr", 0, ["s", `.i=${k}`], [`s.nm#${id}`, "t=-"]];
  const ib = (id: string, ic: number, a = id, ex = ""): HSpec => [`!.i#${id}`, `.a=${a}${ex}`, ico(ic)];
  const bgB = (id: string): HSpec => ib(id, 8, "st", ";@h=dialog;@e=false");
  const hb0 = (id: string, a: string, ic: number, i0: string, dg = "", pi = ""): HSpec => [`!.hb${dg}#${id}`, `.a=${a}${pi ? ";@p=false" : ""}`, ico(ic, 13, pi), [pi ? "s#bt" : "s", `.i=${i0}`]];
  const hdr = (did: string, mid: HSpec, ...rt: HChild[]): HSpec => ["header.h", 0, [".m", 0, mkEmblem(did, 0), ["s.w", "t=Remote Cast"], did === "ld" && ["s.rm#rm!"]], mid, [".ha", 0, ...rt]];
  const okI = !!portF?.valid, qRail = h(".sg#qs", "R=radiogroup");
  qBtns = QK.map((v) => { const on = v === qMode, b = h(on ? "b.on" : "b", `R=radio;.q=${v};.i=q_${v};.t=qt_${v};@c=${on}`); ck(b, () => setQ(v)); qRail.append(b); return b; });

  root.replaceChildren(h(".a", 0,
    [".v#vo", 0,
      hdr("o0", [".t"], mkLang(), bgB("bg0")),
      ["section.f", 0,
        [".oh", 0, mkEmblem("od", 1), [okI ? "s.bd.ok#op" : "s.bd#op"]],
        [".r#oe!", 0, ["s.mt#om"], [".da", 0, ["!#ob2!", ".i=dt"], ["!#or", ".i=rt"]], [".mn.ed2#od2!"]],
        ["!.bp#ob"], ["!.bs#ol"], ["!.dg#orv!"], ["s.nt#ont", ".i=oss"],
        ["details.d#dt", okI ? "" : "open=", ["summary", ".i=ht"], ["ol.ol", 0, ...[0, 1, 2].map(gLi)]]
      ]
    ],
    [".v#vn", 0,
      hdr("ld", [".tw", 0, [".t#tb", "R=tablist;.a=tb"], ["!.nb#nt", ".a=nt", ico(9, 13)]],
        mkLang(),
        hb0("bp", "pa", 1, "pa", "", "pi"),
        hb0("dc", "dcl", 3, "dc"),
        hb0("rv", "rvl", 10, "rv3", ".dg"),
        bgB("bg")
      ),
      [".nr", 0,
        [".pg", 0, ib("bk", 4), ib("fw", 5), ib("rl", 6)],
        ["form.u#uf", 0, ["i.in#ui", ".a=up;.p=up"], isMac && ["s.uk", "t=⌘L;@i=true"]],
        ["b.q#bq", ".a=ql;@h=dialog;@e=false", ["s.rd#sd"], ["s#qm"], ["s.fp#qf"], ["s.hd#qh!", "t= · HD"]],
        ib("bi", 7, "kb", ";@e=false")
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
          ...IK.map((k, i): HSpec => ["b.ch", `.k=${k};` + (i < 3 ? `t=${k === K_ES ? "Esc" : k}` : `.i=${"bs un cp ps2 sa"[K_SP0](" ")[i - 3]}`)]),
          ["b.ch", "t=↑;.sc=-360;.a=su"], ["b.ch", "t=↓;.sc=360;.a=sd"]
        ]
      ],
      [".o#pp!", "R=dialog;.a=ql", [".pl", ".i=ql"], qRail, ..."fs:sr|ps:sv|lv:sp|ch:sm"[K_SP0]("|").map((p) => { const [k, id] = p[K_SP0](":"); return row(k, id); }), [".mn#mn!", ".i=rn"], ["!.bs#sn", ".i=rv"]]
    ],
    [".o#sw!", "R=dialog;.a=st",
      [".pr", 0, ["s.pl", ".i=st"], ["s#ss"]],
      [".mn.erc#se!"],
      [".pr", 0, ["s", ".i=th"], h(".l", "R=radiogroup;.a=th", ...THS.map((v, i) => {
        const b = h("b", `R=radio;.th=${v};.i=th${i};@c=${thP === v}`); ck(b, () => { thLk = 1; thP = v; app[K_STP]?.(v); syncCfgUi(); void saveCfg({ theme: v }); });
        thBtns.push(b); return b;
      }))],
      ...CFGS.map(([id, lk, , , ops]): HSpec => [".pr", 0, ["s", `.i=${lk}`], [`l.sel#${id}`, `.a=${lk}`, ...ops[K_SP0]("|").map((o): HSpec => { const [v, tk] = o[K_SP0](":"); return ["option", `value=${v};${tk[0] === "=" ? `t=${tk.slice(1)}` : `.i=${tk}`}`]; })]]),
      ["b.mn#sp2", ".a=cp"]
    ]
  ));

  const qAll = (n: Element, s: string): HTMLElement[] => [...n.querySelectorAll<HTMLElement>(s)];
  lNodes = qAll(root, "[data-i],[data-a],[data-p],[data-t]");
  applyLangUi();

  const sendTx = (pe: boolean): void => { const v = D.ti[K_VAL]; if (v || pe) { D.ti[K_VAL] = ""; toast(T.ts); evIn(K_TY, { text: v, [K_PE2]: pe }); } };
  const openNT = (): void => { S.nt = S.id = false; S.ep++; rstF(1); setSw(1); evIn("new_tab", { url: cfg.newTabUrl || "chrome://newtab" }); };
  const finPa = (sb: boolean): void => { sb ? (uOff(), schedOffP()) : (syncPauseUi(), askUrg(1)); };
  const doDisc = async (mode: "standby" | "revoke" = K_SB): Promise<void> => {
    if (isDisc || !S.on || !canCall()) return;
    const rev = mode === "revoke";
    clsP(); isDisc = rev ? 2 : 1; S.ep++; dropIn(); clrTm(1); clrTm(0);
    isSb ? uOff() : syncPauseUi(); toast(rev ? T.tdc : T.tsbi);
    try {
      const d = await rpcSc("disconnect", { mode }), okU = d && d.ok !== false && !d.unconfirmed;
      if (d?.[K_CN] === false && okU) {
        isSb = false; clrSt(); rstF(1); goOff(null, null, d[K_PF]); toast(T.td); return;
      }
      if (!rev && d?.[K_CN] === true && (d[K_PA] || d[K_SB]) && okU) {
        pollSeq++; isDisc = 0; setSb(d, true); setErr(); sView(); saveSwr(); schedOffP(); toast(T.tsb); return;
      }
      setPErr(d, "ed", 1);
    } catch (e) { setBErr(e, 1); }
    isDisc = 0; finPa(isSb);
  };
  const sendPa = async (want: boolean, sb?: boolean): Promise<void> => {
    if (!S.on || isDisc || !canCall() || (sb ? isCn || isPa : isPa)) return;
    const clrSb = () => { if (sb) { isCn = 0; isSb = false; } };
    const fail = (d?: FramePayload | null, e?: unknown) => { sb ? (isCn = 0) : (isPa = 0); e ? setBErr(e, 1) : setPErr(d, "ep", 1); finPa(!!sb); };
    sb ? ((isCn = K_RS), setErr(), clrTm(0), uOff()) : ((isPa = 1), syncPauseUi(), want && clrTm(1));
    try {
      const d = await sendIn([{ [K_AC]: want ? "pause" : K_RS }]);
      if (chkConn(d)) return clrSb();
      if (!d || d.ok === false) return fail(d);
      bumpPe(d); pollSeq++;
      sb ? clrSb() : (isPa = 0);
      S.pa = typeof d[K_PA] === "boolean" ? d[K_PA] : want; S.st = !S.pa; S.ep++; S.id = false; act = nowMs(); setErr();
      if (sb) { sView(); uSt(); } else syncPauseUi();
      saveSwr(); toast(S.pa ? T.tpa : T.trs);
      sb ? (!S.pa ? (askUrg(1), liveSched()) : schedOffP()) : S.pa ? clrTm(1) : askUrg(1);
    } catch (e) { fail(null, e); }
  };
  const ansDlg = (accept: boolean): void => { const g = S.dlg; if (g) { S.dlg = null; syncBnr(); evIn(K_DLG, { accept, promptText: g[K_TY] === K_PRM ? D.di[K_VAL] : undefined }); askUrg(1); focusSt(); } };
  const tDet = (): void => { errDet ^= 1; syncBnr(); };
  const tSet = (e: Event): void => { sp(e); setSet(!setOn); };
  const discFn = (m: "standby" | "revoke") => () => void doDisc(m);
  const resOr = (fn: () => void) => () => void (isSb ? sendPa(false, true) : fn());
  for (const [ks, fn] of [
    ["ob", resOr(() => conn(K_PR))],
    ["or", () => (ready ? canCall() && resOr(() => conn(lastMode, 1))() : void initBridge())],
    ["ol", () => void conn("launch", 1)],
    ["nt n2", openNT], ["n3 dc", discFn(K_SB)], ["n4 rv orv", discFn("revoke")],
    ["er", () => (ready ? (setErr(), askUrg(1)) : void initBridge())], ["dx", () => setErr()], ["eb ob2", tDet],
    ["sn", () => { S.fh = ""; S.cr = S.id = false; act = nowMs(); setPop(false); toast(T.trf); void poll(1); }],
    ["bp", () => void sendPa(!S.pa)], ["pb", () => S.on && (S.pa ? void sendPa(false) : ((S.id = false), (act = nowMs()), syncPauseUi(), void poll(1)))],
    ["dk", () => ansDlg(false)], ["do", () => ansDlg(true)], ["bi", () => setIme(!imeOn)], ["ty", () => sendTx(false)], ["te", () => sendTx(true)],
    ["bq", (e: Event) => { sp(e); setPop(!popOn); }], ["bg bg0", tSet],
    ["sp2", () => { N.clipboard?.writeText?.(cfgPath).catch(() => {}); toast(T.tcp); }],
  ] as const) for (const k of ks[K_SP0](" ")) ck(D[k], fn);
  for (const [id, , k, num0] of CFGS) on(D[id], "change", () => void saveCfg({ [k]: num0 ? num(D[id][K_VAL]) : D[id][K_VAL] }));
  for (const s of "back,← ,bk|forward,→ ,fw|reload,↻ ,rl"[K_SP0]("|")) {
    const [a, p, k] = s[K_SP0](",");
    ck(D[k], () => { if (!S.pa) { S.nv = true; S.id = false; hd(D.lb, 0); toast(p + T[k]); evIn(a); } });
  }
  const onK = (n: EventTarget, ent: (() => void) | 0, esc: (() => void) | 0): void => on(n, K_KD, (e: KeyboardEvent) => { ent && e.key === K_EN && !e[K_IC] ? (pd(e), ent()) : esc && e.key === K_ES && (pd(e), esc()); });
  on(D.dt, "toggle", () => (D.dt[K_DS].u = "1"));
  onK(D.di, () => ansDlg(true), () => ansDlg(S.dlg?.[K_TY] === K_AL));
  on(D.ui, K_FC, () => D.ui.select());
  onK(D.ui, 0, () => { D.ui[K_VAL] = S.pg.url || ""; focusSt(); });
  on(D.uf, "submit", (e: Event) => { pd(e); const u = !S.pa && D.ui[K_VAL].trim(); if (u) { S.nv = true; S.id = false; S.pg = { ...S.pg, url: u }; hd(D.lb, 0); evIn("navigate", { url: u }); focusSt(); } });
  onK(D.ti, () => sendTx(true), () => { setIme(false); focusSt(); });
  for (const ch of qAll(D.im, "[data-k],[data-sc]")) ck(ch, async () => {
    if (S.pa) return;
    const { k, sc } = ch[K_DS], cb = N.clipboard;
    if (sc) { const dm = vp(); evIn("scroll", { x: rnd(dm[0] / 2), y: rnd(dm[1] / 2), deltaY: +sc || 360 }); return; }
    if (k === K_PASTE && cb?.readText) try { const txt = await cb.readText(); if (txt) { toast(T.tps); evIn(K_TY, { text: txt, [K_PE2]: false }); return; } } catch {}
    toast(k === "Copy" ? T.tcp : k === K_PASTE ? T.tps : `✓ ${ch[K_TC]}`); if (k) kyIn(k);
  });

  const ptOf = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const r = D.vc.getBoundingClientRect(); if (!r[K_W] || !r[K_H]) return null;
    const dm = vp(), vw = S.pg[K_VW] || D.vc[K_W] || dm[0], vh = S.pg[K_VH] || D.vc[K_H] || dm[1];
    return { x: rnd(cl((e.clientX - r.left) / r[K_W], 0, 1) * vw), y: rnd(cl((e.clientY - r.top) / r[K_H], 0, 1) * vh) };
  };
  let mM = 0, mN: (typeof BN)[number] = "left", mTid: string | null = null, mTep = 0, mvT: Tm = 0, mv: { p: Record<string, unknown>; t: string | null; e: number } | null = null, lRD = 0;
  const flMv = (): void => { cTm(mvT); mvT = 0; if (mv) { evIn(K_MM, mv.p, 0, mv.t, mv.e); mv = null; } };
  const ptrEv = (a0: string, e: { detail?: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, p: { x: number; y: number }, b: string, ex: Record<string, unknown>, tid = S.aid, tep = S.tep): void =>
    evIn(a0, { ...p, [K_BT]: b, clickCount: cl(e.detail || 1, 1, 3), [K_MOD]: modsOf(e) || undefined, ...ex }, 1, tid, tep);
  const onV = (ev: string, fn: (e: any) => void, o?: AddEventListenerOptions | boolean): void => on(D.vc, ev, fn, o);
  const bt = (b: number): (typeof BN)[number] => BN[b] || "left";
  const relDrag = (e: MouseEvent | null): void => { if (!mM) return; flMv(); const pn = mN, tid = mTid, tep = mTep; mM = 0; mTid = null; if (tid === S.aid && tep === S.tep) ptrEv("mouseup", e || {}, (e && ptOf(e)) || { x: 0, y: 0 }, e ? bt(e[K_BT]) : pn, { buttons: 0 }, tid, tep); };
  onV("mousedown", (e: MouseEvent) => {
    const b = e[K_BT]; if (b > 2) return;
    if (S.pa) { pd(e); void sendPa(false); return; }
    if (b === 1) pd(e);
    clsP(); const p = ptOf(e); if (!p) return;
    focusSt(); mM = BM[b] || 1; mN = bt(b); mTid = S.aid; mTep = S.tep; if (b === 2) lRD = nowMs();
    ptrEv("mousedown", e, p, mN, { buttons: mM });
  });
  const onMv = (e: MouseEvent): void => {
    if (S.pa || !S.on) return;
    if (mM && typeof e.buttons === "number" && (e.buttons & mM) === 0) return relDrag(e);
    if (!mM && S.id) return;
    const p = ptOf(e);
    if (p) { mv = { p: { ...p, [K_BT]: mM ? mN : "none", buttons: mM, [K_MOD]: modsOf(e) || undefined }, t: S.aid, e: S.tep }; if (!mvT) mvT = sTm(flMv, mM ? 32 : net[K_EW] > 350 ? 150 : 75); }
  };
  onV(K_MM, onMv);
  on(window, K_MM, (e: MouseEvent) => mM && e[K_TR] !== D.vc && onMv(e));
  on(window, "mouseup", (e: MouseEvent) => mM && relDrag(e));
  on(window, "blur", () => mM && relDrag(null));
  onV("auxclick", (e: MouseEvent) => e[K_BT] === 1 && pd(e));
  onV("contextmenu", (e: MouseEvent) => { pd(e); const p = !S.pa && nowMs() - lRD >= 450 && ptOf(e); if (p) ptrEv("click", e, p, "right", { clickCount: 1 }); });

  let wx = 0, wy = 0, wp: { x: number; y: number } | null = null, wT: string | null = null, wE = 0, wt: Tm = 0;
  onV("wheel", (e: WheelEvent) => {
    pd(e); if (S.pa) return;
    const sc = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? vp()[1] * 0.85 : 1;
    if (!wt || wT !== S.aid || wE !== S.tep) { cTm(wt); wt = 0; wx = wy = 0; wp = null; wT = S.aid; wE = S.tep; }
    wx += e.deltaX * sc; wy += e.deltaY * sc; wp = ptOf(e) || wp;
    if (!wt) wt = sTm(() => {
      const sx = cl(rnd(wx), -1400, 1400), sy = cl(rnd(wy), -1400, 1400), pt = wp || { x: 500, y: 350 };
      wx = wy = 0; wt = 0;
      if (M.abs(sx) >= 2 || M.abs(sy) >= 2) evIn("scroll", { ...pt, deltaX: sx, deltaY: sy }, 1, wT, wE);
    }, net.getWheelCoalesceMs());
  }, { passive: false });

  let comp = 0, pArm: Tm = 0, pSentAt = 0;
  const takeSi = (): string => { const v = D.si[K_VAL]; D.si[K_VAL] = ""; return v; };
  dropTimers = () => { cTm(wt); cTm(mvT); cTm(pArm); wt = wx = wy = mvT = pArm = mM = 0; mv = wp = mTid = null; };
  on(D.st, K_FC, () => doc.activeElement === D.st && focusSt());
  on(D.si, "compositionstart", () => (comp = 1));
  const tyEv = (t: string, imm = 0): void => evIn(K_TY, { text: t, [K_PE2]: false }, imm);
  on(D.si, "compositionend", (e: CompositionEvent) => { comp = 0; const v = e.data || takeSi(); takeSi(); if (!S.pa && v) tyEv(v, 1); });
  on(D.si, "beforeinput", (e: InputEvent) => !comp && !e[K_IC] && !S.pa && (e.inputType === "deleteContentBackward" ? (pd(e), kyIn("Backspace", 0, 0)) : e.inputType === "insertLineBreak" && (pd(e), kyIn(K_EN))));
  on(D.si, "input", () => { if (!comp && !S.pa && D.si[K_VAL]) tyEv(takeSi()); });
  on(D.st, K_KD, (e: KeyboardEvent) => {
    const k = e.key, tr = e[K_TR], m = e.metaKey, c = e.ctrlKey, al = e.altKey;
    if (S.pa || (tr !== D.st && tr !== D.si) || comp || e[K_IC] || k === "Process" || e.keyCode === 229) return;
    const mods = modsOf(e), lw = low(k), fk = k === " " ? "Space" : k, asc = k[K_L] === 1 && k.charCodeAt(0) >= 33 && k.charCodeAt(0) <= 126;
    if ((m || c) && !al) {
      if (lw === "l") return;
      if (lw === "v") { const a = S.aid, e0 = S.tep; cTm(pArm); pArm = sTm(() => { pArm = 0; if (S.aid === a && S.tep === e0) { pSentAt = nowMs(); kyIn(K_PASTE); } }, 120); return; }
      const cmd = ({ a: "SelectAll", c: "Copy", x: "Cut", z: e.shiftKey ? "Redo" : "Undo", y: "Redo" } as Record<string, string | undefined>)[lw];
      if (cmd) { pd(e); if (lw === "c") toast(T.tcp); kyIn(cmd); return; }
      if (KEYS.has(fk) || asc) { pd(e); kyIn(fk, mods, 1); }
      return;
    }
    if (KEYS.has(fk)) { pd(e); kyIn(fk, mods, fk === K_EN || fk === K_ES); return; }
    if (k[K_L] === 1 && !m && (!c || al)) { pd(e); !al && asc ? kyIn(k, mods, 0) : tyEv(k); }
  });
  on(doc, "paste", (e: ClipboardEvent) => {
    if (!S.on || S.pa || [D.ui, D.ti, D.di][K_INC](e[K_TR])) return;
    if (pSentAt && nowMs() - pSentAt < 250) { pSentAt = 0; pd(e); takeSi(); return; }
    if (pArm) { cTm(pArm); pArm = 0; } pd(e); const txt = e.clipboardData?.getData("text/plain") || ""; takeSi();
    toast(T.tps); txt ? tyEv(txt, 1) : kyIn(K_PASTE);
  });
};

const setQ = (v: string, silent?: number): void => {
  if (!QK[K_INC](v)) return;
  qMode = v as QualityMode; net.setMode(v); qApp = net[K_GEQ](); S.fh = ""; S.cr = S.id = false; act = nowMs();
  tog(qBtns, "q", v);
  uSt(); if (!silent) toast(`✓ ${qLbl()}`); if (S.on && !isSb) askUrg(1);
};
const chgTab = (tid: string | null): void => { pollSeq++; dropIn(); S.aid = tid; S.id = false; S.dlg = null; S.ep++; rstF(); setMeta(S[K_TB].find((t) => t[K_TID] === tid)); syncBnr(); setSw(tid ? 1 : 0); };
const swTab = (tid: string): void => { if (tid && tid !== S.aid) { chgTab(tid); uTabs(); uSt(); saveSwr(); evIn("switch_tab", { [K_TID]: tid }, 1, tid, S.tep); } };
const clTab = (tid: string): void => {
  if (!tid || closing.has(tid)) return;
  closing.add(tid); hadTabs = true;
  const tep = S.tep, o = applyOptimisticTabClose(S[K_TB], S.aid, tid);
  S[K_TB] = o[K_TB]; S.th = ""; S.id = false;
  if (o.wasActive) chgTab(o[K_AT]);
  if (!o[K_TB][K_L]) { S.nt = true; setSw(0); syncPh(); }
  uTabs(); uSt(); saveSwr(); toast(T.tcl); evIn("close_tab", { [K_TID]: tid }, 1, tid, tep);
};
const mkTab = (tid: string): HTMLElement => {
  const x = h("b.x", `t=×;@l=${T.ct}`), node = h(".p", "tabindex=0;R=tab", ["s.tt"], x);
  node[K_DS].id = tid;
  ck(node, (e: Event) => e[K_TR] !== x && swTab(tid));
  on(node, "auxclick", (e: MouseEvent) => e[K_BT] === 1 && (pd(e), clTab(tid)));
  on(node, K_KD, (e: KeyboardEvent) => (e.key === K_EN || e.key === " ") && (pd(e), swTab(tid)));
  ck(x, (e: Event) => { sp(e); clTab(tid); });
  return node;
};
const uTabs = (): void => {
  const sig = String(S.aid) + S[K_TB].map((t) => `|${t[K_TID]}:${t[K_TI]}:${t.url}`).join("");
  if (sig === tabSig) return;
  tabSig = sig;
  const live = new Set(S[K_TB].map((t) => t[K_TID]));
  for (const [id, n] of tMap) if (!live.has(id)) { n.remove(); tMap.delete(id); }
  let cur = D.tb.firstChild as ChildNode | null;
  for (const t of S[K_TB]) {
    const id = t[K_TID], a = id === S.aid, u = t.url || "";
    let node = tMap.get(id); if (!node) { node = mkTab(id); tMap.set(id, node); }
    tg(node, "on", a); sA(node, "s", a);
    if (node[K_TI] !== u) node[K_TI] = u; tx(node.firstChild as ChildNode, t[K_TI] || u || T.ut);
    if (cur !== node) D.tb.insertBefore(node, cur); cur = node.nextSibling;
  }
};
const uSt = (): void => {
  bumpFps(0);
  const rtt = net.lastNetRttMs || net[K_EW], pend = inB + qIn[K_L], dm = vp(), rm = S.cm === "remote", mode = rm ? T.sc : T.mc;
  const idle = S.pa || S.id || S.nt, b = S.by, kb = !b ? "0 KB" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  D.sd[K_CNM] = `rd ${S.pa || S.id ? "wn" : S.nt ? "id" : rttBand(rtt)}`;
  tx(D.qm, idle ? (S.pa ? T.pd : S.id ? T.id : T.nt0) : `${rtt ? `${rtt}ms` : "--ms"} · ${qName(qMode)}`);
  tx(D.qf, idle ? "" : ` · ${fpsVal}fps`); hd(D.qh, idle || !S.cr || S.fm !== "webp");
  hd(D.rm, !rm); if (rm) tx(D.rm, T.sb); D.rm[K_TI] = T.sc; hd(D.mn, S.cm !== K_PR);
  tx(D.sr, `${S.uc ? T.nc : kb}${pend ? T.qu.replace("{n}", String(pend)) : ""}`);
  tx(D.sv, `${dm[0]}×${dm[1]}`); tx(D.sp, qLbl() + (S.cr ? " · HD" : "")); tx(D.sm, mode); hd(D.lb, !(S.nv || isSw));
};
const recover = (m?: string): void => { S.aid = S.dlg = null; rstF(1); if (m) toast(m); askUrg(1); };
const clrSt = (th = ""): void => { S.aid = S.dlg = null; S[K_TB] = []; S.th = th; };
const clrNt = (th = ""): void => { clrSt(th); S.pg = {}; S.nv = false; setSw(0); sUrl(""); rstF(); syncBnr(); uTabs(); syncPh(); };
const setDlg = (d: FramePayload | null | undefined, sy = 1): void => { if (d && K_DLG in d) { S.dlg = d[K_DLG] || null; if (sy) syncBnr(); } };
const onPoll = (d: FramePayload | undefined, totalMs: number, reqEpoch = S.ep): void => {
  if (!d) return;
  const firstSync = !synced;
  if (totalMs > 0) synced = 1;
  if (d[K_CN] === false) { setPf(d); isRec(d) ? recover(T.tsw) : goOff(eCode(d), d[K_ERR], d[K_PF]); return; }
  const wasPa = S.pa, oA = S.aid, oE = S.tep, hadBefore = S[K_TB][K_L] > 0, paintIt = applyFramePayloadState(S, d, reqEpoch, totalMs);
  if (paintIt === null) { if (S.on && S.st && !S.pa && !isDisc) askUrg(0); return; }
  if (hadBefore || S[K_TB][K_L] > 0) hadTabs = true;
  setPf(d);
  const sw = d[K_PS] || d[K_RC];
  if (sw || S.aid !== oA || S.tep !== oE) dropTimers();
  if (totalMs > 0 && !d[K_SPI]) {
    if (net.recordSample({ totalMs, [K_SM]: d[K_SM] || 0, [K_IB]: d.changed ? d[K_IB] || 0 : 0 }).tierChanged) qApp = net[K_GEQ]();
  }
  if (d[K_QA]) qApp = d[K_QA];
  sView();
  if (wasPa !== S.pa) { syncPauseUi(); if (S.pa) clrTm(1); }
  S.nt ? sUrl("") : d.page && sUrl(d.page.url || "");
  sw ? (!cErr && setErr(), toast(d[K_PS] ? T.tnt : T.tsc)) : (d[K_EC] || d[K_ERR] || !cErr) && setPErr(d);
  uTabs();
  S.nt || S.pa || S.dlg ? (S.nt || (setSw(0), (S.nv = false)), syncPh()) : paintIt ? paint(d[K_IDU]!) : (fitStage(), isSw && painted && S.fh && setSw(0), syncPh());
  uSt();
  if (firstSync || !d.unchanged || sw || wasPa !== S.pa || oA !== S.aid || isA(d[K_TB])) saveSwr();
};
const pushIn = (ev: InputEventPayload, imm = 1, tid = S.aid, tep = S.tep): void => {
  const wasIdle = S.id; act = nowMs(); S.cr = false;
  if (ev[K_AC] !== "pause" && ev[K_AC] !== "disconnect") S.id = false;
  qIn.push([ev, tid, tep]);
  wasIdle && !S.id ? syncPauseUi() : uSt();
  if (inB) return;
  const ms = imm ? 0 : net.getTypeBatchMs();
  ms <= 0 ? (cTm(inT), (inT = 0), void flIn()) : !inT && (inT = sTm(() => { inT = 0; void flIn(); }, ms));
};
const flIn = async (): Promise<void> => {
  if (inB || !qIn[K_L] || !canCall()) return;
  inB = 1;
  const isT = (a: string) => /_tab$/.test(a), [f0, bTid, bTep] = qIn[0], isTab = isT(f0[K_AC]);
  let k = 1;
  while (k < qIn[K_L] && isT(qIn[k][0][K_AC]) === isTab && qIn[k][1] === bTid && qIn[k][2] === bTep) k++;
  const batch = coalesceInputEvents(qIn.splice(0, k).map((x) => x[0]));
  const closed = batch.filter((e) => e[K_AC] === "close_tab" && e[K_TID]).map((e) => e[K_TID] as string);
  const needEp = batch.some((e) => PAGE_ACT.has(e[K_AC])), ep = S.ep;
  const sendTid = isTab && batch[K_L] === 1 && batch[0][K_TID] ? batch[0][K_TID] : (bTid ?? undefined);
  uSt();
  try {
    const d = await sendIn(batch, sendTid, needEp ? bTep : undefined);
    synced = 1;
    if (chkConn(d)) return;
    setPf(d);
    if (d?.staleTarget) { dropIn(); !cErr && setErr(); toast(T.ttc); if (d[K_AT] !== undefined) S.aid = d[K_AT] || null; syncTabList(d); setDlg(d); rstF(); if (!S.pa) askUrg(1); return; }
    d?.[K_RC] ? (!cErr && setErr(), toast(T.tsc)) : (d?.[K_EC] || (d?.[K_ERR] && !isTargetErrorText(d[K_ERR]))) && setPErr(d);
    if (syncPe(d)) syncPauseUi();
    if (ep === S.ep) {
      setDlg(d);
      if ((S.nt = isNoTabsPayload(d))) clrNt(d?.[K_TH] || "");
      else { if (d?.[K_AT] && d[K_AT] !== S.aid) { S.aid = d[K_AT]; rstF(); } syncTabList(d); }
    }
    if (!S.nt && !S.pa) askUrg(0);
  } catch (err) {
    isTE(err) ? recover() : setBErr(err);
  } finally {
    for (const id of closed) closing.delete(id);
    inB = 0; uSt(); if (qIn[K_L]) void flIn();
  }
};
const sched = (ms: number, f = 0): void => { clrTm(1); if ((!hid() || f) && ms >= 0 && S.on && !isSb && !isDisc && (!S.pa || f)) pT = sTm(() => { pT = 0; void poll(f); }, ms); };
const askUrg = (f = 0): void => { if (!S.on || isSb || isDisc || (S.pa && !f)) return; pB ? (urg |= f ? 2 : 1) : sched(20, f); };
const timing = (idleMs: number, inputBusy = 0) => net.computePollTiming({ idleMs, inputBusy: !!inputBusy, screencastIdle: S.id, [K_HD]: hid(), errCount: pErr, settled: S.cr });
const nextMs = (idleMs: number, busy = 0): number => (!hid() && S.nt ? M.max(1200, M.min(15000, rnd(net[K_EW] * 3))) : timing(idleMs, busy).nextDelayMs);
const reqFrame = (f: number, w: number, keep = 1): Promise<FramePayload | undefined> =>
  rpcSc("frame", { [K_TID]: S.aid || undefined, sinceSeq: !f && keep ? S.seq : 0, lastFrameHash: S.fh || undefined, knownTabsHash: S.th || undefined, ...qArgs(), waitMs: f || net[K_EW] > 120 ? 0 : w, forceRefresh: !!f });
const poll = async (f = 0): Promise<void> => {
  if (pB || isDisc || isSb || !canCall() || (!f && S.pa)) { if (f && pB && !isDisc && !isSb) urg |= 2; return; }
  pB = 1; const ep = S.ep, seq = ++pollSeq, t0 = pNow();
  try {
    const d = await reqFrame(f, hid() ? 0 : S.nt ? 1000 : timing(nowMs() - act).waitMs);
    if (seq !== pollSeq) return;
    lastFetchAt = nowMs(); pErr = d?.[K_ERR] && !d?.[K_RC] ? bumpE(pErr) : 0;
    onPoll(d, rnd(pNow() - t0), ep);
  } catch (err) {
    if (seq !== pollSeq) return;
    pErr = bumpE(pErr);
    isTE(err) ? ((S.aid = null), rstF(1), (urg |= 2)) : setBErr(err);
  } finally {
    pB = 0;
    if (S.on && !isSb && !S.pa && !isDisc) urg ? (sched(20, urg & 2), (urg = 0)) : S.st && sched(nextMs(nowMs() - act, inB || qIn[K_L]), 0);
  }
};
const conn = async (mode = K_PR, f = 0): Promise<void> => {
  if (isCn || !canCall()) return;
  lastMode = mode; isCn = mode; pollSeq++; setErr(); clrTm(0); if (!S.on) uOff();
  const ep = S.ep, t0 = pNow(), rem = mode === "launch";
  try {
    const c = await rpcSc(rem ? mode : "connect", !rem && mode !== K_AU ? { ...qArgs(), mode } : qArgs());
    if (!c?.[K_CN]) { isCn = 0; goOff(eCode(c, "e_not_detected"), c?.[K_ERR], c?.[K_PF]); return; }
    act = nowMs(); S.on = S.st = true; S.pa = S.id = isSb = false; S.pe = +(c[K_PE] ?? 0) || 0;
    setPf(c); if (c[K_AT]) S.aid = c[K_AT]; syncTabList(c);
    S.dlg = c[K_DLG] || null; S.nt = isNoTabsPayload(c);
    if (S.nt) { isCn = 0; sView(); saveSwr(); liveSched(); return; }
    const d = await reqFrame(f || 1, 0, 0);
    isCn = 0; lastFetchAt = nowMs(); pErr = offErr = 0; onPoll(d, rnd(pNow() - t0), ep); liveSched();
  } catch (err) {
    isCn = 0;
    S.on && isTE(err) ? recover() : S.on ? (sView(), setBErr(err), liveSched()) : goOff(mapBridgeErrorKey(eRaw(err)), eRaw(err));
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

ck(doc, (e: Event) => { const el = e[K_TR] as Element | null; if (popOn && !el?.closest?.("#pp,#bq")) setPop(false); if (setOn && !el?.closest?.("#sw,#bg,#bg0")) setSet(false); });
on(doc, K_KD, (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && low(e.key) === "l" && S.on && !isSb) { pd(e); D.ui[K_FC](); D.ui.select(); }
  else if (e.key === K_ES && (popOn || setOn)) { pd(e); popOn ? (setPop(false), D.bq[K_FC]()) : (setSet(false), (S.on && !isSb ? D.bg : D.bg0)[K_FC]()); }
});
const syncHostCtx = (ctx: HostContext | null | undefined, fullCtx?: HostContext): void => { hostCtx = fullCtx || ctx || null; chkLg(hostCtx); };
const persistHt = (ht: "light" | "dark"): void => { if (ht !== lht) { lht = ht; if (canCall()) void saveCfg({ [K_LHT]: ht }, 1); } };
app.onhostthemechanged = persistHt;
const bootPoll = (): void => { started = 1; lastForceAt = nowMs(); isSb ? schedOffP() : S.on && !S.pa && (freshBoot ? liveSched() : void poll(0)); };
const onResult = (r: { [K_SC]?: unknown }): void => {
  const d = r?.[K_SC] as FramePayload | undefined; if (!d) return;
  const sig = [!!d[K_CN], !!d[K_PA], !!d[K_SB], num(d[K_PE]), !!d[K_PF]?.valid, num(d[K_PF]?.port), d[K_AT], d[K_TH], d[K_EC], d[K_ERR]].join("|");
  if (sig === tSig) { if (d[K_CN] && !started && ready) bootPoll(); return; }
  const sbM = d.mode === K_SB;
  tSig = sig; pollSeq++; const wasLive = S.on && !isSb; setPf(d); syncPe(d, !synced || !!d[K_SB] || sbM);
  if (d[K_AT] && !synced) S.aid = d[K_AT];
  syncTabList(d); setDlg(d, 0);
  if (d[K_CN]) {
    S.on = true; S.nt = isNoTabsPayload(d); act = lastFetchAt = nowMs();
    isSb = d[K_SB] === true || sbM || (S.pa && (!wasLive || !painted) && d[K_SB] !== false);
    if (d[K_EC] || d[K_ERR]) setPErr(d); sView(); uTabs(); uSt(); saveSwr();
    if (ready) { isSb ? schedOffP() : !S.pa && void poll(0); }
    return;
  }
  if (!isCn) goOff(eCode(d), d[K_ERR], d[K_PF]);
};

app.ontoolresult = onResult; app.onhostcontextchanged = syncHostCtx;
app.onteardown = () => { clrTm(1); clrTm(0); stopReveal?.(); stopReveal = null; return {}; };

mount(); sView();
if (S.on) {
  if (+(boot.rttMs ?? 0) > 0) net.lastNetRttMs = net[K_EW] = +(boot.rttMs ?? 0);
  sUrl(S.nt ? "" : S.pg.url || "");
  uTabs(); uSt();
  if (!S.nt && !isSb && !useSwr && b0.changed && isSafeImageUrl(b0[K_IDU])) paint(b0[K_IDU]);
}
const initBridge = (): Promise<void> => (setErr(), app[K_STP]?.(thP), app.connect().then(() => {
  ready = 1; syncHostCtx(app.getHostContext()); const ht = app.getResolvedHostTheme?.(); if (ht) persistHt(ht); if (!canCall()) setErr("b_notools");
  uOff(); syncPauseUi(); stopReveal?.();
  stopReveal = setupRevealObservers({ onReveal: forceNow, onHide, getLastFetchAt: () => lastFetchAt, bridgeApp: app });
  if (!started && canCall()) bootPoll();
}).catch((err) => { ready = 0; uOff(); syncPauseUi(); setBErr(err); }));
void initBridge();
