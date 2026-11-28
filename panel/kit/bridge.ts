// Canonical SEP-1865 (2026-01-26) MCP Apps PostMessage bridge.
// Features:
// - Strict ev.source === parent validation (rejects untrusted cross-window / self messages)
// - Coalesced & retry-capable ui/initialize handshake with exact protocolVersion check
// - serverTools capability detection
// - Live hostContext theme & luminance sync via onhostcontextchanged (>=0.9 alpha guard)
// - Net RTT measurement (totalMs - serverMs)
// - Zero size-changed RPC spam in fixed-height side panes

export const LATEST_PROTOCOL_VERSION = "2026-01-26";

const BG_VAR = "--color-background-primary";
const VSCODE_BG_VAR = "--vscode-editor-background";
const JSONRPC_VER = "2.0";
const UI_NOTIF_PREFIX = "ui/notifications/";

export type DocumentTheme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

export interface AppInfo {
  name: string;
  version: string;
  [key: string]: unknown;
}

export interface AppCapabilities {
  [key: string]: unknown;
}

export interface HostCapabilities {
  serverTools?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HostStylesCss {
  fonts?: string;
  [key: string]: unknown;
}

export interface HostStyles {
  variables?: Record<string, string | number | null | undefined>;
  css?: HostStylesCss;
  [key: string]: unknown;
}

export interface ContainerDimensions {
  maxHeight?: number | null;
  maxWidth?: number | null;
  height?: number | null;
  width?: number | null;
  [key: string]: unknown;
}

export interface HostContext {
  theme?: string;
  colorScheme?: string;
  appearance?: string;
  styles?: HostStyles;
  containerDimensions?: ContainerDimensions;
  [key: string]: unknown;
}

export interface BridgeStyleTarget {
  style?: {
    colorScheme?: string;
    backgroundColor?: string;
    height?: string;
    setProperty(name: string, value: string): void;
  } | null;
}

export interface BridgeRootElement extends BridgeStyleTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { height: number; width?: number };
  appendChild?(node: unknown): unknown;
  removeChild?(node: unknown): unknown;
}

export interface BridgeMetaElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export interface BridgeStyleElement {
  id: string;
  textContent: string | null;
  style?: {
    color?: string;
    backgroundColor?: string;
    display?: string;
    setProperty?(name: string, value: string): void;
  } | null;
  remove?(): void;
}

export interface BridgeBodyTarget {
  style?: {
    backgroundColor?: string;
  } | null;
  appendChild?(node: unknown): unknown;
  removeChild?(node: unknown): unknown;
}

export interface BridgeComputedStyle {
  color?: string;
  backgroundColor?: string;
  getPropertyValue?(prop: string): string;
}

export interface BridgeDocument {
  documentElement?: BridgeRootElement | null;
  body?: BridgeBodyTarget | null;
  defaultView?: BridgeWindowLike | null;
  head?: {
    appendChild(node: never): unknown;
  } | null;
  querySelector?(selector: string): BridgeMetaElement | null;
  getElementById?(id: string): BridgeStyleElement | null;
  createElement?(tagName: string): BridgeStyleElement;
}

export type BridgeDocLike = Document | BridgeDocument;

export interface BridgeTargetWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BridgeMessageEvent {
  source?: unknown;
  origin?: string;
  data?: unknown;
}

export interface BridgeWindow {
  parent?: BridgeTargetWindow | null;
  innerWidth?: number;
  requestAnimationFrame?: (callback: () => void) => unknown;
  getComputedStyle?: (elt: unknown) => BridgeComputedStyle;
  addEventListener?(type: "message", listener: (ev: BridgeMessageEvent) => void): void;
  removeEventListener?(type: "message", listener: (ev: BridgeMessageEvent) => void): void;
}

export type BridgeWindowLike = Window | BridgeWindow;

export interface ResizeObserverLike {
  observe(target: unknown): void;
  disconnect(): void;
}

export type ResizeObserverConstructor = new (callback: () => void) => ResizeObserverLike;

export interface AppOptions {
  window?: BridgeWindowLike | null;
  document?: BridgeDocLike | null;
  perfNow?: () => number;
  autoResize?: boolean;
  targetOrigin?: string;
  target?: BridgeTargetWindow | null;
  ResizeObserver?: ResizeObserverConstructor | null;
  themePreference?: ThemePreference;
}

export interface ConnectOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  maxTimeoutMs?: number;
}

export interface ToolCallOptions {
  timeout?: number;
  maxTimeout?: number;
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: {
    progressToken?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ToolCallResult {
  structuredContent?: {
    serverMs?: number;
    [key: string]: unknown;
  };
  serverMs?: number;
  [key: string]: unknown;
}

export interface ToolCallMetrics<T = ToolCallResult> {
  result: T;
  totalMs: number;
  serverMs: number;
  netRttMs: number;
}

export interface BridgeApp {
  onteardown?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  onhostcontextchanged?: (delta: Partial<HostContext>, merged: HostContext) => unknown | Promise<unknown>;
  onhostthemechanged?: (hostTheme: DocumentTheme) => unknown | Promise<unknown>;
  ontoolinput?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  ontoolresult?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  ontoolcancelled?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  setThemePreference(pref: ThemePreference): DocumentTheme;
  getThemePreference(): ThemePreference;
  getResolvedHostTheme(): DocumentTheme | null;
  isConnected(): boolean;
  hasServerTools(): boolean;
  getHostCapabilities(): HostCapabilities | null;
  getHostContext(): HostContext | null;
  getLastRttMs(): number | null;
  request<T = unknown>(method: string, params?: unknown, opts?: RequestOptions): Promise<T>;
  notification(method: string, params?: unknown): void;
  close(): void;
  connect(connectOpts?: ConnectOptions): Promise<void>;
  callServerTool<T = ToolCallResult>(params: ToolCallParams, opts?: ToolCallOptions): Promise<T>;
  callServerToolWithMetrics<T = ToolCallResult>(
    params: ToolCallParams,
    opts?: ToolCallOptions
  ): Promise<ToolCallMetrics<T>>;
}

interface ColorAlphaLum {
  a: number;
  lum: number | null;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  isInit: boolean;
  progressToken: string | number | null;
  timer: ReturnType<typeof setTimeout>;
  hardTimer: ReturnType<typeof setTimeout>;
  clearTimers(): void;
  reset(): void;
}

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: JsonRpcError;
}

interface InitializeResult {
  protocolVersion?: string;
  hostCapabilities?: HostCapabilities;
  hostContext?: HostContext;
}

const rgbLuminance = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const STRICT_NUM_RE = /^(?:\d+\.?\d*|\.\d+)$/;

function parseAlpha(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const isPct = s.endsWith("%");
  const numPart = isPct ? s.slice(0, -1) : s;
  if (!STRICT_NUM_RE.test(numPart)) return null;
  const a = isPct ? Number(numPart) / 100 : Number(numPart);
  return Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : null;
}

function parseRgbChannel(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const isPct = s.endsWith("%");
  const numPart = isPct ? s.slice(0, -1) : s;
  if (!STRICT_NUM_RE.test(numPart)) return null;
  const n = Number(numPart);
  if (!Number.isFinite(n)) return null;
  const ch = isPct ? (n / 100) * 255 : n;
  return Math.max(0, Math.min(255, ch));
}

function parseColorAlphaLum(raw: unknown): ColorAlphaLum | null {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  if (!s || /^(transparent|none|initial|unset)$/.test(low)) return null;

  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    const h = m[1];
    const short = h.length <= 4;
    const ch = (i: number): number =>
      parseInt(short ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16);
    const a = h.length === 4 || h.length === 8 ? ch(3) / 255 : 1;
    const lum = rgbLuminance(ch(0), ch(1), ch(2));
    return Number.isFinite(a) && Number.isFinite(lum) ? { a, lum } : null;
  }

  m = s.match(/^rgba?\(\s*([^\s,/]+)[,\s]+([^\s,/]+)[,\s]+([^\s,/]+)(?:\s*([,/])\s*([^)]*))?\s*\)$/i);
  if (m) {
    const r = parseRgbChannel(m[1]);
    const g = parseRgbChannel(m[2]);
    const b = parseRgbChannel(m[3]);
    if (r === null || g === null || b === null) return null;
    const a = m[4] !== undefined ? parseAlpha(m[5]) : 1;
    const lum = rgbLuminance(r, g, b);
    return a !== null && Number.isFinite(lum) ? { a, lum } : null;
  }

  m = low.match(/^(hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/);
  if (m) {
    const fn = m[1];
    const body = m[2].trim();
    if (!body) return null;
    if (body.includes("/")) {
      const parts = body.split("/");
      if (parts.length !== 2) return null;
      const a = parseAlpha(parts[1]);
      return a === null ? null : { a, lum: null };
    }
    if ((fn === "hsl" || fn === "hsla") && body.includes(",")) {
      const parts = body.split(",");
      if (parts.length === 4) {
        const a = parseAlpha(parts[3]);
        return a === null ? null : { a, lum: null };
      }
      if (parts.length === 3) {
        return { a: 1, lum: null };
      }
      return null;
    }
    if (/\bnone\b/i.test(body)) return null;
    return { a: 1, lum: null };
  }

  if (low === "black") return { a: 1, lum: 0 };
  if (low === "white") return { a: 1, lum: 1 };

  // Fail closed on unrecognized color values so unparseable/transparent aliases cannot bypass alpha >= 0.9.
  return null;
}

function parseUnitChannel(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const isPct = s.endsWith("%");
  const numPart = isPct ? s.slice(0, -1) : s;
  if (!STRICT_NUM_RE.test(numPart)) return null;
  const n = Number(numPart);
  if (!Number.isFinite(n)) return null;
  const unit = isPct ? n / 100 : n;
  return Math.max(0, Math.min(1, unit));
}

function parseSrgbColorFn(raw: unknown): ColorAlphaLum | null {
  const s = String(raw || "").trim();
  const m = s.match(
    /^color\(\s*srgb\s+([^\s,/]+)\s+([^\s,/]+)\s+([^\s,/]+)(?:\s*\/\s*([^)]*))?\s*\)$/i
  );
  if (!m) return null;
  const r = parseUnitChannel(m[1]);
  const g = parseUnitChannel(m[2]);
  const b = parseUnitChannel(m[3]);
  if (r === null || g === null || b === null) return null;
  const a = m[4] !== undefined ? parseAlpha(m[4]) : 1;
  if (a === null) return null;
  const lum = rgbLuminance(r * 255, g * 255, b * 255);
  return Number.isFinite(lum) ? { a, lum } : null;
}

function extractDirectLum(s: string): number | null {
  const first = parseColorAlphaLum(s);
  const resolved = first && first.lum !== null ? first : parseSrgbColorFn(s);
  return resolved &&
    Number.isFinite(resolved.a) &&
    resolved.a >= 0.5 &&
    resolved.lum !== null &&
    Number.isFinite(resolved.lum)
    ? resolved.lum
    : null;
}

/**
 * Returns relative luminance in [0, 1] for opaque/semi-opaque colors (alpha >= 0.5),
 * or null for transparent/unparseable colors.
 *
 * When direct `#hex` / `rgb()` / `color(srgb ...)` parsing returns null (e.g. `oklch`, `lab`,
 * `hsl`, `light-dark(...)`), falls back to a hidden DOM element's computed color if
 * `doc?.createElement` and `getComputedStyle` are available.
 */
export function parseColorLum(
  raw: unknown,
  doc: BridgeDocLike | null = typeof document !== "undefined" ? document : null,
  win: BridgeWindowLike | null = typeof window !== "undefined" ? window : null
): number | null {
  const s = String(raw ?? "").trim();
  if (
    !s ||
    /^(transparent|none|initial|unset|inherit|currentcolor|revert|revert-layer)$/i.test(s)
  ) {
    return null;
  }
  const directLum = extractDirectLum(s);
  if (directLum !== null) return directLum;
  if (/[;{}]|url\s*\(/i.test(s) || !doc?.createElement) return null;
  const view =
    win ??
    (doc as BridgeDocument).defaultView ??
    (typeof window !== "undefined" ? window : null);
  const getCS =
    typeof view?.getComputedStyle === "function"
      ? (el: unknown) => (view as BridgeWindow).getComputedStyle!(el)
      : typeof getComputedStyle === "function"
        ? (el: unknown) => getComputedStyle(el as Element) as BridgeComputedStyle
        : null;
  if (!getCS) return null;

  const probe = doc.createElement("span");
  if (!probe?.style) return null;
  probe.style.display = "none";
  probe.style.backgroundColor = "";
  probe.style.color = "";
  if (typeof probe.style.setProperty === "function") {
    probe.style.setProperty("background-color", s);
    probe.style.setProperty("color", s);
  } else {
    probe.style.backgroundColor = s;
    probe.style.color = s;
  }
  if (!probe.style.backgroundColor && !probe.style.color) return null;

  const hostParent = (doc.body ?? doc.documentElement) as
    | { appendChild?(node: unknown): unknown; removeChild?(node: unknown): unknown }
    | null
    | undefined;
  const canMount =
    Boolean(hostParent) &&
    typeof hostParent?.appendChild === "function" &&
    (typeof probe.remove === "function" || typeof hostParent?.removeChild === "function");
  try {
    if (canMount) hostParent!.appendChild!(probe);
    const cs = getCS(probe);
    const computed = String(cs?.backgroundColor || cs?.color || "").trim();
    return computed ? extractDirectLum(computed) : null;
  } catch {
    return null;
  } finally {
    if (canMount) {
      try {
        if (typeof probe.remove === "function") probe.remove();
        else hostParent!.removeChild!(probe);
      } catch {
        // Ignore detach errors in synthetic DOM mocks.
      }
    }
  }
}

/**
 * Computes net network/bridge round-trip time in milliseconds: max(0, totalMs - serverMs).
 */
export function measureNetRttMs(totalMs: number, serverMs = 0): number {
  const total = Number.isFinite(totalMs) ? totalMs : 0;
  const srv = Number.isFinite(serverMs) ? serverMs : 0;
  return Math.max(0, Math.round(total - srv));
}

const desiredThemeByDoc = new WeakMap<object, DocumentTheme>();

function sameCanvasBg(current: string | undefined, theme: DocumentTheme): boolean {
  const norm = String(current ?? "").trim().toLowerCase();
  if (!norm) return false;
  return theme === "light"
    ? norm === "#f8fafd" || /^rgb\(\s*248[\s,]+250[\s,]+253\s*\)$/.test(norm)
    : norm === "#0b0d12" || /^rgb\(\s*11[\s,]+13[\s,]+18\s*\)$/.test(norm);
}

function isDocumentAlreadyAtTheme(theme: DocumentTheme, doc: BridgeDocLike): boolean {
  const el = doc.documentElement;
  if (!el || el.getAttribute("data-theme") !== theme) return false;
  if (el.style) {
    if (el.style.colorScheme && el.style.colorScheme !== theme) return false;
    if (el.style.backgroundColor && !sameCanvasBg(el.style.backgroundColor, theme)) return false;
  }
  if (doc.body?.style?.backgroundColor && !sameCanvasBg(doc.body.style.backgroundColor, theme)) {
    return false;
  }
  const meta = doc.querySelector?.('meta[name="color-scheme"]');
  if (meta && meta.getAttribute("content") !== theme) return false;
  return true;
}

function commitDocumentTheme(theme: DocumentTheme, doc: BridgeDocLike): void {
  const el = doc.documentElement;
  if (!el) return;
  const bg = theme === "light" ? "#F8FAFD" : "#0B0D12";
  if (el.getAttribute("data-theme") !== theme) el.setAttribute("data-theme", theme);
  if (el.style) {
    if (el.style.colorScheme !== theme) el.style.colorScheme = theme;
    if (!sameCanvasBg(el.style.backgroundColor, theme)) el.style.backgroundColor = bg;
  }
  if (doc.body?.style && !sameCanvasBg(doc.body.style.backgroundColor, theme)) {
    doc.body.style.backgroundColor = bg;
  }
  const meta = doc.querySelector?.('meta[name="color-scheme"]');
  if (meta && meta.getAttribute("content") !== theme) meta.setAttribute("content", theme);
}

export function applyDocumentTheme(
  theme: unknown,
  doc: BridgeDocLike | null = typeof document !== "undefined" ? document : null,
  win: BridgeWindowLike | null = typeof window !== "undefined" ? window : null
): void {
  if ((theme !== "light" && theme !== "dark") || !doc?.documentElement) return;
  desiredThemeByDoc.set(doc as object, theme);
  if (isDocumentAlreadyAtTheme(theme, doc)) return;
  if (theme === "light" && doc.querySelector?.(".boot-frame")) {
    const view =
      win ??
      (doc as BridgeDocument).defaultView ??
      (typeof window !== "undefined" ? window : null);
    const schedule =
      typeof view?.requestAnimationFrame === "function"
        ? (cb: () => void) => view.requestAnimationFrame!(cb)
        : typeof requestAnimationFrame === "function"
          ? (cb: () => void) => requestAnimationFrame(cb)
          : (cb: () => void) => setTimeout(cb, 0);
    schedule(() => {
      if (desiredThemeByDoc.get(doc as object) === "light") {
        commitDocumentTheme("light", doc);
      }
    });
    return;
  }
  commitDocumentTheme(theme, doc);
}

export function applyHostStyleVariables(
  vars: Record<string, unknown> | null | undefined,
  target: BridgeStyleTarget | null = typeof document !== "undefined" ? document.documentElement : null
): void {
  if (!vars || typeof vars !== "object" || !target?.style) return;
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith("--") || v == null) continue;
    const val = String(v).trim();
    if (!val) continue;
    if (k === BG_VAR) {
      const parsed = parseColorAlphaLum(val);
      if (!parsed || parsed.a < 0.9 || parsed.lum === null) continue;
    }
    target.style.setProperty(k, val);
  }
}

export function applyHostFonts(
  css: string | null | undefined,
  doc: BridgeDocLike | null = typeof document !== "undefined" ? document : null
): void {
  if (!css || !doc?.head) return;
  const id = "__mcp-host-fonts";
  let styleEl = doc.getElementById?.(id) ?? null;
  if (!styleEl && doc.createElement) {
    styleEl = doc.createElement("style");
    styleEl.id = id;
    (doc.head as { appendChild(el: BridgeStyleElement): unknown }).appendChild(styleEl);
  }
  if (styleEl && styleEl.textContent !== css) styleEl.textContent = css;
}

function classifyThemeToken(raw: unknown): DocumentTheme | null {
  if (typeof raw !== "string") return null;
  const low = raw.trim().toLowerCase();
  if (!low) return null;
  const hasDark = /dark|night|black/.test(low);
  const hasLight = /light|day|white/.test(low);
  if (hasDark && !hasLight) return "dark";
  if (hasLight && !hasDark) return "light";
  return null;
}

/**
 * Resolves Antigravity's live host theme from `ctx.theme`, `ctx.colorScheme`, `ctx.appearance`,
 * `--color-background-primary`, or `--vscode-editor-background` (never OS `prefers-color-scheme`).
 */
export function resolveHostTheme(
  ctx: HostContext | null | undefined,
  doc: BridgeDocLike | null = typeof document !== "undefined" ? document : null,
  win: BridgeWindowLike | null = typeof window !== "undefined" ? window : null
): DocumentTheme | null {
  if (!ctx || typeof ctx !== "object") return null;
  for (const raw of [ctx.theme, ctx.colorScheme, ctx.appearance]) {
    const classified = classifyThemeToken(raw);
    if (classified) return classified;
  }
  const vars = ctx.styles?.variables;
  const candidates: unknown[] = [vars?.[BG_VAR], vars?.[VSCODE_BG_VAR]];
  const view =
    win ??
    (doc as BridgeDocument | null)?.defaultView ??
    (typeof window !== "undefined" ? window : null);
  const getCS =
    typeof view?.getComputedStyle === "function"
      ? (el: unknown) => (view as BridgeWindow).getComputedStyle!(el)
      : typeof getComputedStyle === "function"
        ? (el: unknown) => getComputedStyle(el as Element) as BridgeComputedStyle
        : null;
  if (getCS && doc?.documentElement) {
    try {
      const cs = getCS(doc.documentElement);
      if (typeof cs?.getPropertyValue === "function") {
        candidates.push(cs.getPropertyValue(BG_VAR), cs.getPropertyValue(VSCODE_BG_VAR));
      }
    } catch {
      // Ignore computed style errors on partial DOM mocks.
    }
  }
  for (const cand of candidates) {
    const lum = parseColorLum(cand, doc, win);
    if (lum !== null) return lum < 0.45 ? "dark" : "light";
  }
  return null;
}

export function applyHostContext(
  ctx: HostContext | null | undefined,
  doc: BridgeDocLike | null = typeof document !== "undefined" ? document : null,
  win: BridgeWindowLike | null = typeof window !== "undefined" ? window : null
): DocumentTheme | null {
  if (!ctx || typeof ctx !== "object") return null;
  const styles = ctx.styles;
  if (styles?.variables && doc?.documentElement) {
    applyHostStyleVariables(styles.variables, doc.documentElement);
  }
  if (styles?.css?.fonts) {
    applyHostFonts(styles.css.fonts, doc);
  }
  const theme = resolveHostTheme(ctx, doc, win);
  if (theme) applyDocumentTheme(theme, doc, win);
  return theme;
}

function normalizeThemePreference(pref: unknown): ThemePreference {
  return pref === "light" || pref === "dark" ? pref : "system";
}

/**
 * Creates a SEP-1865 MCP Apps PostMessage bridge client.
 *
 * By default `autoResize` is `false` so fixed-height side panes emit zero `size-changed`
 * RPC traffic. Even when `autoResize: true` is passed, `size-changed` is only enabled
 * when the host explicitly provides `hostContext.containerDimensions.maxHeight`.
 */
export function App(
  this: unknown,
  appInfo: AppInfo,
  appCapabilities: AppCapabilities = {},
  options: AppOptions = {}
): BridgeApp {
  const win: BridgeWindowLike | null = options.window ?? (typeof window !== "undefined" ? window : null);
  const doc: BridgeDocLike | null = options.document ?? (typeof document !== "undefined" ? document : null);
  const perfNow: () => number =
    options.perfNow ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const caps = appCapabilities || {};
  const autoResize = options.autoResize === true;
  const configuredOrigin =
    typeof options.targetOrigin === "string" && options.targetOrigin.trim()
      ? options.targetOrigin.trim()
      : "*";
  let activeOrigin = configuredOrigin;
  const target: BridgeTargetWindow | null =
    options.target !== undefined
      ? options.target
      : win && win.parent && win.parent !== win
        ? win.parent
        : null;

  const pending = new Map<string | number, PendingEntry>();
  const self: Partial<BridgeApp> =
    this && typeof this === "object" ? (this as Partial<BridgeApp>) : {};
  let hostCaps: HostCapabilities | null = null;
  let hostCtx: HostContext | null = null;
  let themePref: ThemePreference = normalizeThemePreference(options.themePreference);
  let resolvedHostTheme: DocumentTheme | null = null;
  const initialDocTheme: DocumentTheme =
    doc?.documentElement?.getAttribute("data-theme") === "light" ? "light" : "dark";
  if (themePref === "light" || themePref === "dark") {
    applyDocumentTheme(themePref, doc, win);
  }
  let nextId = 1;
  let initOk = false;
  let connEpoch = 0;
  let connPromise: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCancel: (() => void) | null = null;
  let listening = false;
  let resizeObserver: ResizeObserverLike | null = null;
  let lastRttMs: number | null = null;

  const syncHostContext = (
    ctx: HostContext | null,
    delta?: Partial<HostContext>
  ): DocumentTheme | null => {
    if (!ctx || typeof ctx !== "object") return null;
    const styles = ctx.styles;
    if (styles?.variables && doc?.documentElement) {
      applyHostStyleVariables(styles.variables, doc.documentElement);
    }
    if (styles?.css?.fonts) {
      applyHostFonts(styles.css.fonts, doc);
    }
    const deltaHasThemeSignal =
      delta !== undefined &&
      delta !== null &&
      typeof delta === "object" &&
      (delta.theme !== undefined ||
        delta.colorScheme !== undefined ||
        delta.appearance !== undefined ||
        delta.styles?.variables?.[BG_VAR] !== undefined ||
        delta.styles?.variables?.[VSCODE_BG_VAR] !== undefined);
    const nextHostTheme =
      (deltaHasThemeSignal ? resolveHostTheme(delta as HostContext, doc, win) : null) ??
      resolveHostTheme(ctx, doc, win);
    const changedTheme =
      nextHostTheme !== null && nextHostTheme !== resolvedHostTheme ? nextHostTheme : null;
    if (nextHostTheme !== null) {
      resolvedHostTheme = nextHostTheme;
    }
    const effective = themePref === "system" ? nextHostTheme : themePref;
    if (effective) {
      applyDocumentTheme(effective, doc, win);
    }
    return changedTheme;
  };

  function setThemePreference(pref: ThemePreference): DocumentTheme {
    themePref = normalizeThemePreference(pref);
    const effective: DocumentTheme =
      themePref === "system"
        ? resolvedHostTheme ??
          (hostCtx ? resolveHostTheme(hostCtx, doc, win) : null) ??
          initialDocTheme
        : themePref;
    applyDocumentTheme(effective, doc, win);
    return effective;
  }

  const post = (payload: unknown): void => {
    if (!target || typeof target.postMessage !== "function") {
      throw new Error("MCP host parent window unavailable");
    }
    target.postMessage(payload, activeOrigin);
  };

  const reply = (id: string | number, result: unknown, error?: JsonRpcError): void =>
    post(error ? { jsonrpc: JSONRPC_VER, id, error } : { jsonrpc: JSONRPC_VER, id, result });

  const messageListener = (ev: BridgeMessageEvent): void => {
    void onMessage(ev);
  };

  const attachListener = (): void => {
    if (!listening && win?.addEventListener) {
      (win as BridgeWindow).addEventListener?.("message", messageListener);
      listening = true;
    }
  };

  const detachListener = (): void => {
    if (listening && win?.removeEventListener) {
      (win as BridgeWindow).removeEventListener?.("message", messageListener);
      listening = false;
    }
  };

  const cancelRetrySleep = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (retryCancel) {
      const cancel = retryCancel;
      retryCancel = null;
      cancel();
    }
  };

  const mergeHostContext = (prevCtx: HostContext | null, delta: Partial<HostContext>): HostContext => {
    const prev: HostContext = prevCtx && typeof prevCtx === "object" ? prevCtx : {};
    const patch: Partial<HostContext> = delta && typeof delta === "object" ? delta : {};
    const hasStyles = prev.styles || patch.styles;
    const mergedStyles: HostStyles | undefined = hasStyles
      ? {
          ...(prev.styles || {}),
          ...(patch.styles || {}),
          ...(prev.styles?.variables || patch.styles?.variables
            ? {
                variables: {
                  ...(prev.styles?.variables || {}),
                  ...(patch.styles?.variables || {}),
                },
              }
            : {}),
          ...(prev.styles?.css || patch.styles?.css
            ? {
                css: {
                  ...(prev.styles?.css || {}),
                  ...(patch.styles?.css || {}),
                },
              }
            : {}),
        }
      : undefined;
    return {
      ...prev,
      ...patch,
      ...(mergedStyles !== undefined ? { styles: mergedStyles } : {}),
    };
  };

  async function onMessage(ev: BridgeMessageEvent): Promise<void> {
    // Strictly validate event source (and activeOrigin when configured/locked) against the parent host window.
    if (!target || !ev || ev.source !== target) return;
    if (activeOrigin !== "*" && ev.origin !== activeOrigin) return;
    const rawMsg = ev.data;
    if (!rawMsg || typeof rawMsg !== "object") return;
    const msg = rawMsg as JsonRpcMessage;
    if (msg.jsonrpc !== JSONRPC_VER) return;

    const method = msg.method;
    if (msg.id !== undefined && !method) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      entry.clearTimers();
      if (msg.error) {
        entry.reject(new Error(msg.error.message || "RPC error"));
      } else {
        // Lock inbound/outbound origin to ev.origin after ui/initialize when targetOrigin === "*" and ev.origin !== "null".
        if (
          entry.isInit &&
          activeOrigin === "*" &&
          typeof ev.origin === "string" &&
          ev.origin &&
          ev.origin !== "null"
        ) {
          activeOrigin = ev.origin;
        }
        entry.resolve(msg.result);
      }
      return;
    }

    if (msg.id !== undefined && typeof method === "string") {
      try {
        if (method === "ping") return reply(msg.id, {});
        if (method === "ui/resource-teardown") {
          const res = self.onteardown ? (await self.onteardown(msg.params || {})) ?? {} : {};
          return reply(msg.id, res);
        }
        reply(msg.id, null, { code: -32601, message: "Method not found" });
      } catch (err) {
        try {
          reply(msg.id, null, { code: -32603, message: String(err) });
        } catch {
          // Host window may be unavailable; avoid unhandledrejection in async onMessage.
        }
      }
      return;
    }

    if (typeof method === "string") {
      const params = msg.params || {};
      if (method.startsWith(UI_NOTIF_PREFIX)) {
        const key = method.slice(UI_NOTIF_PREFIX.length);
        if (key === "host-context-changed") {
          const delta = params as Partial<HostContext>;
          hostCtx = mergeHostContext(hostCtx, delta);
          const changedHostTheme = syncHostContext(hostCtx, delta);
          if (changedHostTheme && typeof self.onhostthemechanged === "function") {
            try {
              await self.onhostthemechanged(changedHostTheme);
            } catch {
              // Isolate user callback errors to prevent unhandledrejection.
            }
          }
          if (typeof self.onhostcontextchanged === "function") {
            try {
              await self.onhostcontextchanged(params as Partial<HostContext>, hostCtx);
            } catch {
              // Isolate user callback errors to prevent unhandledrejection.
            }
          }
        } else {
          const handlerMap: Record<
            string,
            "ontoolinput" | "ontoolresult" | "ontoolcancelled" | undefined
          > = {
            "tool-input": "ontoolinput",
            "tool-result": "ontoolresult",
            "tool-cancelled": "ontoolcancelled",
          };
          const handlerKey = handlerMap[key];
          const handler = handlerKey ? self[handlerKey] : undefined;
          if (typeof handler === "function") {
            try {
              await handler(params);
            } catch {
              // Isolate user callback errors to prevent unhandledrejection.
            }
          }
        }
      } else if (method === "notifications/progress") {
        // Scope timer renewal strictly to the matching progressToken (never reset unrelated requests).
        const tok = params.progressToken;
        if (tok !== undefined && tok !== null) {
          for (const entry of pending.values()) {
            if (entry.progressToken !== null && entry.progressToken === tok) {
              entry.reset();
            }
          }
        }
      }
    }
  }

  function request<T = unknown>(
    method: string,
    params?: unknown,
    opts: RequestOptions = {}
  ): Promise<T> {
    if (!initOk && method !== "ui/initialize") {
      return Promise.reject(new Error("MCP bridge is not connected"));
    }
    const rawTimeout = opts?.timeoutMs ?? 75_000;
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 75_000;
    const maxTimeoutMs = opts?.maxTimeoutMs;
    const id = nextId++;
    const rawTok = (params as { _meta?: { progressToken?: unknown } } | undefined)?._meta?.progressToken;
    const progressToken =
      typeof rawTok === "string" || (typeof rawTok === "number" && Number.isFinite(rawTok))
        ? rawTok
        : null;
    const hardCapMs =
      maxTimeoutMs !== undefined && Number.isFinite(maxTimeoutMs) && maxTimeoutMs > 0
        ? Math.max(timeoutMs, maxTimeoutMs)
        : Math.max(timeoutMs, timeoutMs * 4);

    return new Promise<T>((resolve, reject) => {
      const expire = (): void => {
        if (!pending.delete(id)) return;
        entry.clearTimers();
        reject(new Error(`Timeout: ${method}`));
      };
      const startTimer = (): ReturnType<typeof setTimeout> => setTimeout(expire, timeoutMs);
      const entry: PendingEntry = {
        resolve: resolve as (value: unknown) => void,
        reject,
        isInit: method === "ui/initialize",
        progressToken,
        timer: startTimer(),
        hardTimer: setTimeout(expire, hardCapMs),
        clearTimers() {
          clearTimeout(entry.timer);
          clearTimeout(entry.hardTimer);
        },
        reset() {
          clearTimeout(entry.timer);
          entry.timer = startTimer();
        },
      };
      pending.set(id, entry);
      try {
        post({ jsonrpc: JSONRPC_VER, id, method, params });
      } catch (err) {
        entry.clearTimers();
        pending.delete(id);
        reject(err);
      }
    });
  }

  function notification(method: string, params?: unknown): void {
    post(params !== undefined ? { jsonrpc: JSONRPC_VER, method, params } : { jsonrpc: JSONRPC_VER, method });
  }

  function teardownPending(reason: string): void {
    for (const entry of pending.values()) {
      entry.clearTimers();
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  function resetConnectionState(reason: string): void {
    initOk = false;
    hostCaps = null;
    hostCtx = null;
    resolvedHostTheme = null;
    activeOrigin = configuredOrigin;
    detachListener();
    resizeObserver?.disconnect();
    resizeObserver = null;
    teardownPending(reason);
  }

  function close(): void {
    connEpoch += 1;
    connPromise = null;
    cancelRetrySleep();
    resetConnectionState("Closed");
  }

  const hasServerTools = (): boolean =>
    Boolean(hostCaps?.serverTools && typeof hostCaps.serverTools === "object");

  async function callServerToolWithMetrics<T = ToolCallResult>(
    params: ToolCallParams,
    opts: ToolCallOptions = {}
  ): Promise<ToolCallMetrics<T>> {
    if (!initOk) {
      throw new Error("MCP bridge is not connected");
    }
    if (!hasServerTools()) {
      throw new Error("MCP host does not advertise serverTools capability");
    }
    const t0 = perfNow();
    const result = await request<T>("tools/call", params, {
      timeoutMs: opts.timeout ?? 75_000,
      maxTimeoutMs: opts.maxTimeout,
    });
    const totalMs = Math.max(0, perfNow() - t0);
    const typedResult = result as ToolCallResult | null | undefined;
    const rawServerMs = typedResult?.structuredContent?.serverMs ?? typedResult?.serverMs;
    const serverMs = Number.isFinite(rawServerMs) ? Number(rawServerMs) : 0;
    const netRttMs = measureNetRttMs(totalMs, serverMs);
    lastRttMs = netRttMs;
    return { result, totalMs, serverMs, netRttMs };
  }

  function startAutoResizeIfInline(): void {
    // Side panes do not advertise containerDimensions.maxHeight; never spam size-changed there.
    const RO =
      options.ResizeObserver ??
      (typeof ResizeObserver !== "undefined" ? (ResizeObserver as unknown as ResizeObserverConstructor) : null);
    if (!autoResize || hostCtx?.containerDimensions?.maxHeight == null || !RO || !doc?.documentElement) {
      return;
    }
    let queued = false;
    let lastW = 0;
    let lastH = 0;
    const root = doc.documentElement;
    const raf = win?.requestAnimationFrame
      ? (fn: () => void) => win.requestAnimationFrame!(fn)
      : (fn: () => void) => setTimeout(fn, 0);
    const measure = (): void => {
      if (queued) return;
      queued = true;
      raf(() => {
        queued = false;
        if (!root.style) return;
        const prev = root.style.height ?? "";
        root.style.height = "max-content";
        const h = Math.ceil(root.getBoundingClientRect().height);
        const w = Math.ceil(win?.innerWidth || 0);
        root.style.height = prev;
        if (w !== lastW || h !== lastH) {
          lastW = w;
          lastH = h;
          notification(`${UI_NOTIF_PREFIX}size-changed`, { width: w, height: h });
        }
      });
    };
    measure();
    resizeObserver = new RO(measure);
    resizeObserver.observe(root);
    if (doc.body) resizeObserver.observe(doc.body);
  }

  function connect(connectOpts: ConnectOptions = {}): Promise<void> {
    if (initOk) return Promise.resolve();
    if (connPromise) return connPromise;

    const myEpoch = connEpoch;
    const rawRetries = Number(connectOpts.retries ?? 0);
    const maxRetries = Number.isFinite(rawRetries) && rawRetries > 0 ? Math.floor(rawRetries) : 0;
    const rawDelay = Number(connectOpts.retryDelayMs ?? 200);
    const retryDelayMs = Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : 200;
    const rawTimeout = Number(connectOpts.timeoutMs ?? 20_000);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 20_000;

    const p = (async () => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (myEpoch !== connEpoch) {
          throw new Error("Closed");
        }
        attachListener();
        try {
          const res = await request<InitializeResult>(
            "ui/initialize",
            { appInfo, appCapabilities: caps, protocolVersion: LATEST_PROTOCOL_VERSION },
            { timeoutMs }
          );
          if (myEpoch !== connEpoch) {
            throw new Error("Closed");
          }
          if (!res || typeof res !== "object" || res.protocolVersion !== LATEST_PROTOCOL_VERSION) {
            throw new Error(`Unsupported protocol version: ${res?.protocolVersion ?? "missing"}`);
          }
          hostCaps = res.hostCapabilities || {};
          hostCtx = res.hostContext || null;
          initOk = true;
          const changedHostTheme = syncHostContext(hostCtx);
          if (changedHostTheme && typeof self.onhostthemechanged === "function") {
            try {
              await self.onhostthemechanged(changedHostTheme);
            } catch {
              // Isolate user callback errors so connect() still completes cleanly.
            }
          }
          notification(`${UI_NOTIF_PREFIX}initialized`);
          startAutoResizeIfInline();
          return;
        } catch (err) {
          lastErr = err;
          if (myEpoch !== connEpoch) {
            throw new Error("Closed");
          }
          resetConnectionState("Handshake retry");
          if (attempt < maxRetries) {
            await new Promise<void>((resolve, reject) => {
              retryCancel = () => reject(new Error("Closed"));
              retryTimer = setTimeout(() => {
                retryTimer = null;
                retryCancel = null;
                resolve();
              }, retryDelayMs);
            });
            if (myEpoch !== connEpoch) {
              throw new Error("Closed");
            }
          }
        }
      }
      throw lastErr;
    })().finally(() => {
      if (connPromise === p) {
        connPromise = null;
      }
    });

    connPromise = p;
    return p;
  }

  return Object.assign(self, {
    setThemePreference,
    getThemePreference: () => themePref,
    getResolvedHostTheme: () => resolvedHostTheme,
    isConnected: () => initOk,
    hasServerTools,
    getHostCapabilities: () => hostCaps,
    getHostContext: () => hostCtx,
    getLastRttMs: () => lastRttMs,
    request,
    notification,
    close,
    connect,
    callServerTool: <T = ToolCallResult>(params: ToolCallParams, opts: ToolCallOptions = {}) =>
      callServerToolWithMetrics<T>(params, opts).then((r) => r.result),
    callServerToolWithMetrics,
  });
}
