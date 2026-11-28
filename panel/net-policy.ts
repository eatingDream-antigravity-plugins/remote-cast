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
const nFin = Number.isFinite;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const eb = (c: number): number => (c > 0 ? Math.min(4, 1 << Math.min(c, 2)) : 1);
const tierVal = (r: number, u: number, l: number, m: number, h: number): number =>
  r >= 750 ? u : r >= 350 ? l : r >= 140 ? m : h;

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
  return /^(?:closed|not connected)$/i.test(s) || /\bnot connected\b/i.test(s)
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
  calibrated: boolean;
  ewmaRttMs: number;
  lastNetRttMs: number;
  fastStreak: number;
  slowStreak: number;
  lastUpgradeAt: number;
  bgPollIntervalSec: number;
  wheelCoalesceMs: number;

  constructor(m: QualityMode | string = "auto") {
    this.mode = m;
    this.effectiveTier = (m === "auto" ? "low" : m) as QualityTier;
    this.calibrated = false;
    this.ewmaRttMs = this.lastNetRttMs = this.fastStreak = this.slowStreak = this.lastUpgradeAt = this.bgPollIntervalSec = 0;
    this.wheelCoalesceMs = 75;
  }

  setMode(m: string): void {
    const s = this;
    s.mode = m === "auto" || TIERS.includes(m as QualityTier) ? m : "auto";
    s.fastStreak = s.slowStreak = 0;
    s.effectiveTier = s.mode !== "auto" ? (s.mode as QualityTier) : s.calibrated ? s._t(s.ewmaRttMs, 0, 0) : "low";
  }

  getEffectiveQuality(): QualityTier {
    return (this.mode === "auto" ? this.effectiveTier : this.mode) as QualityTier;
  }

  _t(r: number, b: number, n: number): QualityTier {
    return r >= 750 || (b >= 14000 && n >= 850)
      ? "ultra"
      : r >= 350 || (b >= 14000 && n >= 420)
        ? "low"
        : r >= 140
          ? "medium"
          : "high";
  }

  recordSample({ totalMs: tm, serverMs: sm = 0, imageBytes: ib = 0, now: nw = Date.now() }: SampleInput): SampleResult {
    const s = this;
    const net = Math.max(1, Math.round((+tm || 0) - Math.max(0, +sm || 0)));
    const r = !s.calibrated || s.ewmaRttMs <= 0 ? net : Math.round(s.ewmaRttMs * 0.75 + net * 0.25);
    const prev = s.effectiveTier;
    s.lastNetRttMs = net;
    s.ewmaRttMs = r;
    if (s.mode === "auto") {
      const want = s._t(r, ib, net);
      if (!s.calibrated) (s.calibrated = true), (s.effectiveTier = want), (s.fastStreak = s.slowStreak = 0), (s.lastUpgradeAt = nw);
      else {
        const ci = TIERS.indexOf(prev);
        const di = TIERS.indexOf(want);
        const ri = TIERS.indexOf(s._t(net, ib, net));
        const up = prev === "ultra" ? 520 : prev === "low" ? 240 : 100;
        di < ci && ri < ci
          ? ((s.fastStreak = 0), ++s.slowStreak >= 2 && ((s.effectiveTier = TIERS[Math.max(di, ri)]), (s.slowStreak = 0)))
          : di > ci && ri > ci && r < up && net < up
            ? ((s.slowStreak = 0),
              ++s.fastStreak >= 3 && nw - s.lastUpgradeAt >= 4000 && ((s.effectiveTier = TIERS[ci + 1]), (s.fastStreak = 0), (s.lastUpgradeAt = nw)))
            : (s.fastStreak = s.slowStreak = 0);
      }
    } else s.calibrated = true;
    const effectiveTier = s.getEffectiveQuality();
    return { netRttMs: net, ewmaRttMs: r, effectiveTier, tierChanged: prev !== effectiveTier };
  }

  getNetworkGrade(): NetworkGrade {
    return !this.calibrated ? "good" : this.ewmaRttMs >= 350 ? "weak" : this.ewmaRttMs >= 140 ? "mid" : "good";
  }

  computePollTiming({
    idleMs: im = 0,
    inputBusy: ib = false,
    screencastIdle: si = false,
    hidden: h = false,
    errCount: ec = 0,
    settled: st = false,
  }: PollTimingInput = {}): PollTimingResult {
    const r = this.ewmaRttMs;
    const m = eb(ec);
    const bg = this.bgPollIntervalSec;
    const p = (waitMs: number, d: number): PollTimingResult => ({ waitMs, nextDelayMs: d });
    const t3 = (a: number, b: number, c: number): number => (r > 700 ? a : r > 350 ? b : c);
    const fl = (b: number): number => (b < 0 ? b : Math.max(b, Math.min(15000, Math.round(r * 3))));
    return h
      ? p(0, fl(bg === -1 ? -1 : bg > 0 ? Math.min(300000, bg * 1000 * m) : Math.min(30000, tierVal(r, 12000, 8000, 4000, 2000) * m)))
      : si && !ib
        ? p(0, fl(Math.min(20000, 4000 * m)))
        : ib
          ? p(r > 350 ? 220 : 140, clamp(Math.round(r * 0.3), 75, 220))
          : ec > 0
            ? p(0, fl(Math.min(16000, (im < 3500 ? 1000 : im < 12000 ? 1500 : 2000) * m)))
            : st && im >= 1000
              ? p(1400, fl(t3(600, 350, 180)))
              : im < 3500
                ? p(r > 350 ? 280 : 180, t3(300, 160, 50))
                : im < 12000
                  ? p(1350, fl(t3(800, 450, 240)))
                  : p(1400, fl(t3(2400, 1600, 1100)));
  }

  computeOfflinePollDelay({ hidden: h = false, errCount: ec = 0 }: { hidden?: boolean; errCount?: number } = {}): number {
    const bg = this.bgPollIntervalSec;
    const m = eb(ec);
    const d = h && bg === -1
      ? -1
      : h && bg > 0
        ? Math.min(300000, bg * 1000 * m)
        : Math.min(30000, tierVal(this.ewmaRttMs, h ? 10000 : 8000, h ? 7500 : 6000, h ? 5000 : 4500, 3000) * m);
    return d < 0 ? d : Math.max(d, Math.min(15000, Math.round(this.ewmaRttMs * 3)));
  }

  getWheelCoalesceMs(): number {
    return clamp(+this.wheelCoalesceMs || 75, 20, 500);
  }

  getTypeBatchMs(): number {
    return this.ewmaRttMs > 350 ? 60 : this.ewmaRttMs > 180 ? 30 : 0;
  }
}

export const coalesceInputEvents = (raw: readonly InputEventPayload[] | null | undefined): InputEventPayload[] => {
  const out: InputEventPayload[] = [];
  const seen = new Set<string>();
  for (const e of raw || []) {
    const a = e?.action;
    if (!a) continue;
    const p = out[out.length - 1];
    if (a === "close_tab") {
      const k = `${e.targetId || ""}:${e.targetEpoch || 0}`;
      if (e.targetId && seen.has(k)) continue;
      if (e.targetId) seen.add(k);
      out.push({ ...e });
      continue;
    }
    if (p?.action === "switch_tab" && a === "switch_tab") {
      p.targetId = e.targetId;
      continue;
    }
    const pa =
      p && p.action === a && (p.targetId || "") === (e.targetId || "") && (p.targetEpoch || 0) === (e.targetEpoch || 0)
        ? a
        : "";
    if (pa === "mousemove" && (p.buttons || 0) === (e.buttons || 0)) {
      p.x = e.x;
      p.y = e.y;
      e.modifiers !== undefined ? (p.modifiers = e.modifiers) : delete p.modifiers;
      continue;
    }
    if (pa === "type" && !p.pressEnter && !e.pressEnter) {
      p.text = (p.text || "") + (e.text || "");
      continue;
    }
    if (pa === "scroll") {
      p.deltaX = clamp((p.deltaX || 0) + (e.deltaX || 0), -1600, 1600);
      p.deltaY = clamp((p.deltaY || 0) + (e.deltaY || 0), -1600, 1600);
      p.x = e.x;
      p.y = e.y;
      continue;
    }
    if (pa === "key" && p.key === e.key && (p.modifiers || 0) === (e.modifiers || 0) && e.key && REP.has(e.key)) {
      const n = (+(p.repeat ?? 1)) + (+(e.repeat ?? 1));
      if (n <= 20) {
        p.repeat = n;
        continue;
      }
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
}): { apply: boolean; reason: "empty" | "stale_epoch" | "stale_target" | "ok" } =>
  !d || typeof d !== "object"
    ? { apply: false, reason: "empty" }
    : re !== ce
      ? { apply: false, reason: "stale_epoch" }
      : d.activeTargetId && ct && d.activeTargetId !== ct && !d.recovered && !d.popupSwitched && !(Array.isArray(d.tabs) && !d.tabs.some((t) => t.targetId === ct))
        ? { apply: false, reason: "stale_target" }
        : { apply: true, reason: "ok" };

export const applyOptimisticTabClose = (
  tabs: readonly TabInfo[] | null | undefined,
  aid: string | null,
  cid: string
): { tabs: TabInfo[]; activeTargetId: string | null; wasActive: boolean } => {
  const ls = Array.isArray(tabs) ? tabs : [];
  const i = ls.findIndex((t) => t.targetId === cid);
  const nt = ls.filter((t) => t.targetId !== cid);
  const wa = aid === cid;
  return {
    tabs: nt,
    activeTargetId: wa || !nt.some((t) => t.targetId === aid) ? (nt[i >= 0 ? Math.min(i, nt.length - 1) : 0]?.targetId ?? null) : aid,
    wasActive: wa,
  };
};

export const isNoTabsPayload = (d: FramePayload | null | undefined): boolean =>
  !!(d?.noTabs || (Array.isArray(d?.tabs) && !d.tabs.length && !d?.activeTargetId));

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
  const srvEp = +(d.epoch as number);
  if (nFin(srvEp) && srvEp > 0) S.tep = srvEp;
  if (d.connectionMode) S.cm = d.connectionMode;
  if (typeof d.paused === "boolean") {
    const pe = +(d.pauseEpoch as number);
    const ok = nFin(pe);
    const cur = +S.pe || 0;
    if (ok ? pe > cur || (!totalMs && pe >= cur) : !totalMs) {
      if (ok) S.pe = pe;
      S.pa = d.paused;
      S.st = !d.paused;
    }
  }
  S.id = !S.pa && !!d.screencastPausedIdle;
  S.dlg = d.dialog || null;
  S.nv = false;
  const nt = (S.nt = isNoTabsPayload(d));
  if (nt) {
    S.aid = S.dlg = null;
    S.tabs = [];
    S.pg = {};
    S.seq = 0;
    S.fh = "";
    S.cr = false;
  } else {
    if (Array.isArray(d.tabs)) S.tabs = d.tabs;
    if (d.activeTargetId) S.aid = d.activeTargetId;
    if (d.page) S.pg = d.page;
  }
  if (d.popupSwitched) {
    S.seq = 0;
    S.fh = "";
    S.cr = false;
  }
  if (d.tabsHash) S.th = d.tabsHash;
  if (typeof d.crisp === "boolean") S.cr = d.crisp;
  if (d.format) S.fm = d.format;
  const sp = !nt && !!d.changed && isSafeImageUrl(d.imageDataUrl);
  if (sp) {
    S.seq = d.seq || S.seq + 1;
    S.fh = d.frameHash || S.fh;
    S.by = d.imageBytes || S.by;
    S.uc = false;
  } else {
    S.uc = !!(d.unchanged || !d.changed);
    if (d.seq) S.seq = Math.max(S.seq, d.seq);
    if (d.frameHash) S.fh = d.frameHash;
  }
  return sp;
};

export const resolveStageAspect = (vw: number, vh: number, iw: number, ih: number): number => {
  const va = +vw > 0 && +vh > 0 ? vw / vh : 0;
  const ia = +iw > 0 && +ih > 0 ? iw / ih : 0;
  const a = va ? (ia && Math.abs(ia - va) / va > 0.04 ? ia : va) : ia;
  return a > 0 ? +a.toFixed(4) : 0;
};

export const setupRevealObservers = (o: RevealObserversOptions = {}): (() => void) => {
  const g = globalThis as unknown as {
    document?: ObserverDocLike;
    window?: ObserverEventTargetLike;
    ResizeObserver?: RevealObserversOptions["ResizeObs"];
    IntersectionObserver?: RevealObserversOptions["IntersectionObs"];
  };
  const dc = o.rootDoc ?? g.document;
  const wn = o.rootWin ?? g.window;
  const ap = o.bridgeApp;
  const getLF = o.getLastFetchAt || (() => 0);
  const nw = o.clock || (() => Date.now());
  const sm = o.staleMs ?? 900;
  const tm = o.throttleMs ?? 250;
  const RO = o.ResizeObs ?? g.ResizeObserver;
  const IO = o.IntersectionObs ?? g.IntersectionObserver;
  const offs: Array<() => void> = [];
  const rt = dc?.documentElement;
  let lt = -1e15;
  const trig = (): boolean => {
    const t = nw();
    return t - lt >= tm && ((lt = t), o.onReveal?.(), true);
  };
  const add = (
    tg: ObserverEventTargetLike | null | undefined,
    ev: string,
    fn: (...args: any[]) => void,
    op?: AddEventListenerOptions | boolean
  ): void => {
    if (tg?.addEventListener) {
      tg.addEventListener(ev, fn, op);
      offs.push(() => tg.removeEventListener?.(ev, fn, op));
    }
  };
  const obs = (ob: { observe(el: unknown): void; disconnect?(): void }): void => {
    ob.observe(rt);
    offs.push(() => ob.disconnect?.());
  };
  if (RO && rt) {
    let wc = !((rt.clientWidth || 0) > 0 && (rt.clientHeight || 0) > 0);
    obs(
      new RO((es) => {
        const r = es?.[0]?.contentRect;
        const v = (r ? r.width : rt.clientWidth || 0) > 0 && (r ? r.height : rt.clientHeight || 0) > 0;
        if (wc && v) trig();
        wc = !v;
      })
    );
  }
  if (IO && rt) {
    let wv = false;
    obs(
      new IO(
        (es) => {
          for (const e of es || []) {
            const v = !!e?.isIntersecting;
            if (!wv && v) trig();
            wv = v;
          }
        },
        { threshold: 0 }
      )
    );
  }
  add(dc, "visibilitychange", () => {
    const isHidden = dc?.visibilityState === "hidden" || (dc as { hidden?: boolean } | null)?.hidden === true;
    if (isHidden) o.onHide?.();
    else if (dc?.visibilityState === "visible" || (dc as { hidden?: boolean } | null)?.hidden === false) trig();
  });
  add(wn, "focus", trig);
  add(wn, "pageshow", trig);
  add(rt, "pointerenter", () => nw() - getLF() > sm && trig(), { passive: true });
  if (ap) {
    const pv = ap.onhostcontextchanged || null;
    ap.onhostcontextchanged = (c, m) => (pv?.(c, m), (c?.containerDimensions || c?.displayMode) && trig());
    offs.push(() => (ap.onhostcontextchanged = pv));
  }
  return () => {
    while (offs.length) {
      try {
        offs.pop()?.();
      } catch {}
    }
  };
};
