// Client-side adaptive bandwidth (EWMA + asymmetric hysteresis), input coalescing, locale & epoch helpers.
export type QualityTier = "ultra" | "low" | "medium" | "high";
export type QualityMode = "auto" | QualityTier;
export type PanelLang = "en" | "zh-CN";
export type RttBand = "ok" | "wn" | "er";
export type NetworkGrade = "good" | "mid" | "weak";
export type BridgeErrorKey = "b_closed" | "b_timeout" | "b_init" | "b_notools" | "b_busy" | "b_generic";

export interface TabInfo {
  targetId: string;
  title?: string;
  url?: string;
  [k: string]: unknown;
}

export interface DialogInfo {
  type?: string;
  targetId?: string;
  message?: string;
  url?: string;
  defaultPrompt?: string;
  [k: string]: unknown;
}

export interface PageInfo {
  title?: string;
  url?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  [k: string]: unknown;
}

export interface PortFileInfo {
  valid?: boolean;
  fallback?: boolean;
  port?: number;
  [k: string]: unknown;
}

export interface FramePayload {
  connected?: boolean;
  activeTargetId?: string | null;
  recovered?: boolean;
  popupSwitched?: boolean;
  tabs?: TabInfo[];
  tabsHash?: string;
  noTabs?: boolean;
  epoch?: number;
  connectionMode?: string;
  paused?: boolean;
  standby?: boolean;
  mode?: string;
  pauseEpoch?: number;
  screencastPausedIdle?: boolean;
  dialog?: DialogInfo | null;
  page?: PageInfo;
  crisp?: boolean;
  format?: string;
  changed?: boolean;
  unchanged?: boolean;
  imageDataUrl?: string;
  seq?: number;
  frameHash?: string;
  imageBytes?: number;
  serverMs?: number;
  qualityApplied?: string;
  portFile?: PortFileInfo;
  error?: string;
  errorCode?: string;
  recoverable?: boolean;
  staleTarget?: boolean;
  ok?: boolean;
  unconfirmed?: boolean;
  settings?: Record<string, unknown>;
  settingsGen?: number;
  settingsPath?: string;
  settingsError?: string;
  rttMs?: number;
  bootTs?: number;
  [k: string]: unknown;
}

export interface PanelState {
  on: boolean;
  cm: string;
  cr: boolean;
  fm: string;
  tabs: TabInfo[];
  th: string;
  aid: string | null;
  ep: number;
  tep: number;
  pe: number;
  pg: PageInfo;
  seq: number;
  fh: string;
  by: number;
  uc: boolean;
  nv: boolean;
  st: boolean;
  pa: boolean;
  id: boolean;
  dlg: DialogInfo | null;
  nt: boolean;
}

export interface InputEventPayload {
  action: string;
  targetId?: string;
  targetEpoch?: number;
  x?: number;
  y?: number;
  button?: string;
  buttons?: number;
  clickCount?: number;
  modifiers?: number;
  text?: string;
  pressEnter?: boolean;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  repeat?: number;
  accept?: boolean;
  promptText?: string;
  url?: string;
  [k: string]: unknown;
}

export interface SampleInput {
  totalMs: number;
  serverMs?: number;
  imageBytes?: number;
  now?: number;
}

export interface SampleResult {
  netRttMs: number;
  ewmaRttMs: number;
  effectiveTier: QualityTier;
  tierChanged: boolean;
}

export interface PollTimingInput {
  idleMs?: number;
  inputBusy?: boolean;
  screencastIdle?: boolean;
  hidden?: boolean;
  errCount?: number;
  settled?: boolean;
}

export interface PollTimingResult {
  waitMs: number;
  nextDelayMs: number;
}

export interface ObserverEventTargetLike {
  addEventListener?(ev: string, fn: (...args: any[]) => void, op?: AddEventListenerOptions | boolean): void;
  removeEventListener?(ev: string, fn: (...args: any[]) => void, op?: EventListenerOptions | boolean): void;
}

export interface ObserverRootElementLike extends ObserverEventTargetLike {
  clientWidth?: number;
  clientHeight?: number;
}

export interface ObserverDocLike extends ObserverEventTargetLike {
  documentElement?: ObserverRootElementLike | null;
  visibilityState?: string;
}

export interface ObserverBridgeAppLike {
  onhostcontextchanged?: ((delta: any, merged: any) => unknown) | null;
}

export interface RevealObserversOptions {
  rootDoc?: ObserverDocLike | null;
  rootWin?: ObserverEventTargetLike | null;
  bridgeApp?: ObserverBridgeAppLike | null;
  onReveal?: () => void;
  onHide?: () => void;
  getLastFetchAt?: () => number;
  clock?: () => number;
  staleMs?: number;
  throttleMs?: number;
  ResizeObs?: (new (cb: (entries: ReadonlyArray<{ contentRect?: { width: number; height: number } }>) => void) => { observe(el: unknown): void; disconnect?(): void }) | null;
  IntersectionObs?: (new (cb: (entries: ReadonlyArray<{ isIntersecting?: boolean }>) => void, opts?: { threshold?: number }) => { observe(el: unknown): void; disconnect?(): void }) | null;
}

const TIERS: readonly QualityTier[] = ["ultra", "low", "medium", "high"];
const { max: mx, min: mn, round: rd, abs: ab } = Math, isA = Array.isArray, nFin = Number.isFinite;
const K_TID = "targetId", K_AT = "activeTargetId", K_MOD = "modifiers", K_PA = "paused", K_TB = "tabs", K_EW = "ewmaRttMs", K_ET = "effectiveTier", K_BG = "bgPollIntervalSec", K_CH = "changed", K_SQ = "seq", K_FH = "frameHash";
const clamp = (v: number, lo: number, hi: number): number => mx(lo, mn(hi, v));
const eb = (c: number): number => (c > 0 ? mn(4, 1 << mn(c, 2)) : 1);
const tierVal = (r: number, u: number, l: number, m: number, h: number): number =>
  r >= 750 ? u : r >= 350 ? l : r >= 140 ? m : h;
const tIx = (t: QualityTier): number => TIERS.indexOf(t);

export const REP: Set<string> = new Set(
  "Backspace Delete ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Tab".split(" ")
);

export const isTargetErrorText = (m: unknown): boolean =>
  /no target with given id|target closed|session with given id not found|inspected target navigated or closed|target.*destroyed/i.test(
    String(m || "")
  );

export const isBusyErrorText = (m: unknown): boolean =>
  /too many concurrent|server busy|relay busy/i.test(String(m || ""));

export const rttBand = (ms: unknown): RttBand => {
  const n = +(ms as number);
  return !nFin(n) || n <= 0 ? "ok" : n >= 200 ? "er" : n >= 80 ? "wn" : "ok";
};

export const parsePanelLocaleTag = (raw: unknown): PanelLang | null => {
  const s = String(raw || "").trim().toLowerCase().replace(/_/g, "-");
  return !s || /^(c|posix|utf-8|auto)$/.test(s) ? null : /^zh($|-)|-(hans|hant)/.test(s) ? "zh-CN" : "en";
};

export const resolvePanelLang = ({
  saved = "",
  hostLocale = "",
  navLang = "",
  bootLocale = "",
}: {
  saved?: string;
  hostLocale?: string;
  navLang?: string;
  bootLocale?: string;
} = {}): PanelLang => [saved, hostLocale, navLang, bootLocale].map(parsePanelLocaleTag).find(Boolean) || "en";

export const mapBridgeErrorKey = (raw: unknown): BridgeErrorKey => {
  const s = String(raw || "").trim();
  return /^closed$|\bnot connected\b/i.test(s)
    ? "b_closed"
    : /^timeout\b/i.test(s)
      ? "b_timeout"
      : /bad init|bad protocol|unsupported protocol|parent unavailable/i.test(s)
        ? "b_init"
        : /no servertools|no tool access|servertools/i.test(s)
          ? "b_notools"
          : isBusyErrorText(s)
            ? "b_busy"
            : "b_generic";
};

export class AdaptiveBandwidthController {
  mode: QualityMode | string;
  effectiveTier: QualityTier;
  ewmaRttMs: number;
  lastNetRttMs: number;
  bgPollIntervalSec: number;
  wheelCoalesceMs: number;
  private _c = false;
  private _f = 0;
  private _s = 0;
  private _u = 0;

  constructor(m: QualityMode | string = "auto") {
    this.mode = m;
    this[K_ET] = (m === "auto" ? "low" : m) as QualityTier;
    this[K_EW] = this.lastNetRttMs = this[K_BG] = 0;
    this.wheelCoalesceMs = 75;
  }

  setMode(m: string): void {
    const s = this;
    s.mode = m === "auto" || TIERS.includes(m as QualityTier) ? m : "auto";
    s._f = s._s = 0;
    s[K_ET] = s.mode !== "auto" ? (s.mode as QualityTier) : s._c ? s._t(s[K_EW], 0, 0) : "low";
  }

  getEffectiveQuality(): QualityTier {
    return (this.mode === "auto" ? this[K_ET] : this.mode) as QualityTier;
  }

  _t(r: number, b: number, n: number): QualityTier {
    return r >= 750 || (b >= 14000 && n >= 850) ? "ultra" : r >= 350 || (b >= 14000 && n >= 420) ? "low" : r >= 140 ? "medium" : "high";
  }

  recordSample({ totalMs: tm, serverMs: sm = 0, imageBytes: ib = 0, now: nw = Date.now() }: SampleInput): SampleResult {
    const s = this, net = mx(1, rd((+tm || 0) - mx(0, +sm || 0)));
    const r = !s._c || s[K_EW] <= 0 ? net : rd(s[K_EW] * 0.75 + net * 0.25);
    const prev = s[K_ET];
    s.lastNetRttMs = net;
    s[K_EW] = r;
    if (s.mode === "auto") {
      const want = s._t(r, ib, net);
      if (!s._c) (s._c = true), (s[K_ET] = want), (s._f = s._s = 0), (s._u = nw);
      else {
        const ci = tIx(prev), di = tIx(want), ri = tIx(s._t(net, ib, net));
        const up = prev === "ultra" ? 520 : prev === "low" ? 240 : 100;
        di < ci && ri < ci
          ? ((s._f = 0), ++s._s >= 2 && ((s[K_ET] = TIERS[mx(di, ri)]), (s._s = 0)))
          : di > ci && ri > ci && r < up && net < up
            ? ((s._s = 0), ++s._f >= 3 && nw - s._u >= 4000 && ((s[K_ET] = TIERS[ci + 1]), (s._f = 0), (s._u = nw)))
            : (s._f = s._s = 0);
      }
    } else s._c = true;
    const effectiveTier = s.getEffectiveQuality();
    return { netRttMs: net, ewmaRttMs: r, effectiveTier, tierChanged: prev !== effectiveTier };
  }

  getNetworkGrade(): NetworkGrade {
    const r = this[K_EW];
    return !this._c || r < 140 ? "good" : r >= 350 ? "weak" : "mid";
  }

  private _bg(h: boolean, m: number, fb: number): number {
    const r = this[K_EW], bg = this[K_BG], d = h && bg === -1 ? -1 : h && bg > 0 ? mn(3e5, bg * 1e3 * m) : mn(3e4, fb * m);
    return d < 0 ? d : mx(d, mn(15e3, rd(r * 3)));
  }

  computePollTiming({
    idleMs: im = 0,
    inputBusy: ib = false,
    screencastIdle: si = false,
    hidden: h = false,
    errCount: ec = 0,
    settled: st = false,
  }: PollTimingInput = {}): PollTimingResult {
    const r = this[K_EW], m = eb(ec);
    const p = (waitMs: number, nextDelayMs: number): PollTimingResult => ({ waitMs, nextDelayMs });
    const t3 = (a: number, b: number, c: number): number => (r > 700 ? a : r > 350 ? b : c);
    const fl = (b: number): number => mx(b, mn(15e3, rd(r * 3)));
    return h ? p(0, this._bg(h, m, tierVal(r, 12e3, 8e3, 4e3, 2e3)))
      : si && !ib ? p(0, fl(mn(2e4, 4e3 * m)))
      : ib ? p(r > 350 ? 220 : 140, clamp(rd(r * 0.3), 75, 220))
      : ec > 0 ? p(0, fl(mn(16e3, (im < 3500 ? 1e3 : im < 12e3 ? 1500 : 2e3) * m)))
      : st && im >= 1e3 ? p(1400, fl(t3(600, 350, 180)))
      : im < 3500 ? p(r > 350 ? 280 : 180, t3(300, 160, 50))
      : im < 12e3 ? p(1350, fl(t3(800, 450, 240)))
      : p(1400, fl(t3(2400, 1600, 1100)));
  }

  computeOfflinePollDelay({ hidden: h = false, errCount: ec = 0 }: { hidden?: boolean; errCount?: number } = {}): number {
    return this._bg(h, eb(ec), tierVal(this[K_EW], h ? 1e4 : 8e3, h ? 7500 : 6e3, h ? 5e3 : 4500, 3e3));
  }

  getWheelCoalesceMs(): number {
    return clamp(+this.wheelCoalesceMs || 75, 20, 500);
  }

  getTypeBatchMs(): number {
    return this[K_EW] > 350 ? 60 : this[K_EW] > 180 ? 30 : 0;
  }
}

export const coalesceInputEvents = (raw: readonly InputEventPayload[] | null | undefined): InputEventPayload[] => {
  const out: InputEventPayload[] = [], seen = new Set<string>(), eqT = (a: InputEventPayload, b: InputEventPayload) => (a[K_TID] || "") === (b[K_TID] || "") && (a.targetEpoch || 0) === (b.targetEpoch || 0);
  for (const e of raw || []) {
    const a = e?.action;
    if (!a) continue;
    const p = out[out.length - 1];
    if (a === "close_tab") {
      const id = e[K_TID], k = `${id || ""}:${e.targetEpoch || 0}`;
      if (id && seen.has(k)) continue;
      if (id) seen.add(k);
      out.push({ ...e });
      continue;
    }
    if (p?.action === "switch_tab" && a === "switch_tab") { p[K_TID] = e[K_TID]; continue; }
    const pa = p && p.action === a && eqT(p, e) ? a : "";
    if (pa === "mousemove" && (p.buttons || 0) === (e.buttons || 0)) {
      p.x = e.x; p.y = e.y;
      e[K_MOD] !== undefined ? (p[K_MOD] = e[K_MOD]) : delete p[K_MOD];
      continue;
    }
    if (pa === "type" && !p.pressEnter && !e.pressEnter) { p.text = (p.text || "") + (e.text || ""); continue; }
    if (pa === "scroll") { const cl = (v: number) => clamp(v, -1600, 1600); p.deltaX = cl((p.deltaX || 0) + (e.deltaX || 0)); p.deltaY = cl((p.deltaY || 0) + (e.deltaY || 0)); p.x = e.x; p.y = e.y; continue; }
    if (pa === "key" && p.key === e.key && (p[K_MOD] || 0) === (e[K_MOD] || 0) && e.key && REP.has(e.key)) {
      const n = (+(p.repeat ?? 1)) + (+(e.repeat ?? 1));
      if (n <= 20) { p.repeat = n; continue; }
    }
    out.push({ ...e });
  }
  return out;
};

export const shouldApplyFrameResponse = ({
  reqEpoch: re,
  currentEpoch: ce,
  currentTargetId: ct,
  payload: d,
}: {
  reqEpoch: number;
  currentEpoch: number;
  currentTargetId: string | null;
  payload: FramePayload | null | undefined;
}): { apply: boolean; reason: "empty" | "stale_epoch" | "stale_target" | "ok" } => {
  const r = !d || typeof d !== "object" ? "empty" : re !== ce ? "stale_epoch" : d[K_AT] && ct && d[K_AT] !== ct && !d.recovered && !d.popupSwitched && !(isA(d[K_TB]) && !d[K_TB].some((t) => t[K_TID] === ct)) ? "stale_target" : "ok";
  return { apply: r === "ok", reason: r };
};

export const applyOptimisticTabClose = (
  tabs: readonly TabInfo[] | null | undefined,
  aid: string | null,
  cid: string
): { tabs: TabInfo[]; activeTargetId: string | null; wasActive: boolean } => {
  const ls = isA(tabs) ? tabs : [], i = ls.findIndex((t) => t[K_TID] === cid), nt = ls.filter((t) => t[K_TID] !== cid), wa = aid === cid;
  return { tabs: nt, activeTargetId: wa || !nt.some((t) => t[K_TID] === aid) ? (nt[i >= 0 ? mn(i, nt.length - 1) : 0]?.[K_TID] ?? null) : aid, wasActive: wa };
};

export const isNoTabsPayload = (d: FramePayload | null | undefined): boolean =>
  !!(d?.noTabs || (isA(d?.[K_TB]) && !d[K_TB].length && !d?.[K_AT]));

export const isSafeImageUrl = (u: unknown): u is string =>
  typeof u === "string" && /^data:image\/(?:jpeg|webp|png);base64,/i.test(u);

export const applyFramePayloadState = (
  S: PanelState,
  d: FramePayload | null | undefined,
  reqEpoch = S.ep,
  totalMs = 0
): boolean | null => {
  if (!d || !shouldApplyFrameResponse({ reqEpoch, currentEpoch: S.ep, currentTargetId: S.aid, payload: d }).apply) return null;
  S.on = true;
  const srvEp = +(d.epoch as number), k = "boolean";
  if (nFin(srvEp) && srvEp > 0) S.tep = srvEp;
  if (d.connectionMode) S.cm = d.connectionMode;
  if (typeof d[K_PA] === k) {
    const pe = +(d.pauseEpoch as number), ok = nFin(pe), cur = +S.pe || 0;
    if (ok ? pe > cur || (!totalMs && pe >= cur) : !totalMs) { if (ok) S.pe = pe; S.st = !(S.pa = d[K_PA]!); }
  }
  S.id = !S.pa && !!d.screencastPausedIdle;
  S.dlg = d.dialog || null;
  S.nv = false;
  const nt = (S.nt = isNoTabsPayload(d)), rst = () => { S.seq = 0; S.fh = ""; S.cr = false; };
  if (nt) { S.aid = S.dlg = null; S[K_TB] = []; S.pg = {}; rst(); }
  else { if (isA(d[K_TB])) S[K_TB] = d[K_TB]; if (d[K_AT]) S.aid = d[K_AT]; if (d.page) S.pg = d.page; }
  if (d.popupSwitched) rst();
  if (d.tabsHash) S.th = d.tabsHash;
  if (typeof d.crisp === k) S.cr = d.crisp!;
  if (d.format) S.fm = d.format;
  const sp = !nt && !!d[K_CH] && isSafeImageUrl(d.imageDataUrl);
  if (sp) { S.seq = d[K_SQ] || S.seq + 1; S.fh = d[K_FH] || S.fh; S.by = d.imageBytes || S.by; S.uc = false; }
  else { S.uc = !!(d.unchanged || !d[K_CH]); if (d[K_SQ]) S.seq = mx(S.seq, d[K_SQ]); if (d[K_FH]) S.fh = d[K_FH]; }
  return sp;
};

export const resolveStageAspect = (vw: number, vh: number, iw: number, ih: number): number => {
  const va = +vw > 0 && +vh > 0 ? vw / vh : 0, ia = +iw > 0 && +ih > 0 ? iw / ih : 0;
  const a = va ? (ia && ab(ia - va) / va > 0.04 ? ia : va) : ia;
  return a > 0 ? +a.toFixed(4) : 0;
};

export const setupRevealObservers = (o: RevealObserversOptions = {}): (() => void) => {
  const g = globalThis as any, K_AEL = "addEventListener", K_CW = "clientWidth", K_CH0 = "clientHeight";
  const dc = o.rootDoc ?? g.document, wn = o.rootWin ?? g.window, ap = o.bridgeApp, rt = dc?.documentElement;
  const getLF = o.getLastFetchAt || (() => 0), nw = o.clock || Date.now, sm = o.staleMs ?? 900, tm = o.throttleMs ?? 250;
  const RO = o.ResizeObs ?? g.ResizeObserver, IO = o.IntersectionObs ?? g.IntersectionObserver, offs: Array<() => void> = [];
  let lt = -1e15;
  const trig = (): boolean => { const t = nw(); return t - lt >= tm && ((lt = t), o.onReveal?.(), true); };
  const add = (tg: any, ev: string, fn: (...args: any[]) => void, op?: AddEventListenerOptions | boolean): void => {
    if (tg?.[K_AEL]) { tg[K_AEL](ev, fn, op); offs.push(() => tg.removeEventListener?.(ev, fn, op)); }
  };
  const obs = (ob: { observe(el: unknown): void; disconnect?(): void }): void => { ob.observe(rt); offs.push(() => ob.disconnect?.()); };
  if (RO && rt) {
    const pos = (r?: { width: number; height: number }) => (r ? r.width : rt[K_CW] || 0) > 0 && (r ? r.height : rt[K_CH0] || 0) > 0;
    let wc = !pos();
    obs(new RO((es: any[]) => { const v = pos(es?.[0]?.contentRect); if (wc && v) trig(); wc = !v; }));
  }
  if (IO && rt) {
    let wv = false;
    obs(new IO((es: any[]) => { for (const e of es || []) { const v = !!e?.isIntersecting; if (!wv && v) trig(); wv = v; } }, { threshold: 0 }));
  }
  add(dc, "visibilitychange", () => {
    const v = dc?.visibilityState, h = (dc as any)?.hidden;
    if (v === "hidden" || h === true) o.onHide?.(); else if (v === "visible" || h === false) trig();
  });
  add(wn, "focus", trig); add(wn, "pageshow", trig);
  add(rt, "pointerenter", () => nw() - getLF() > sm && trig(), { passive: true });
  if (ap) { const pv = ap.onhostcontextchanged || null; ap.onhostcontextchanged = (c, m) => (pv?.(c, m), (c?.containerDimensions || c?.displayMode) && trig()); offs.push(() => (ap.onhostcontextchanged = pv)); }
  return () => { while (offs.length) try { offs.pop()?.(); } catch {} };
};
