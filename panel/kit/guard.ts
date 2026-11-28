#!/usr/bin/env node
// Shared Panel QA Gate enforcing Lucid Indigo theme tokens, CSP/size bounds, and i18n parity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const DEFAULT_MAX_BYTES = 65_536;
export const WARN_BYTES = 57_344;
export const HARD_MAX_BYTES = 65_536;

export const DARK_BG_HEX = "#0B0D12";
export const LIGHT_BG_HEX = "#F8FAFD";
export const DARK_ACCENT_HEX = "#6895FF";
export const LIGHT_ACCENT_HEX = "#2952CC";
export const DARK_OK_HEX = "#34D399";
export const LIGHT_OK_HEX = "#059669";

const CJK_CHAR_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/g;
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_.-]+)\}/g;

export const FAMILY_TOKENS = Object.freeze([
  "--bg", "--s1", "--s2", "--s3", "--s0",
  "--t1", "--t2", "--t3",
  "--ln", "--l2", "--ls", "--sh",
  "--ac", "--ah", "--as", "--ab", "--cb", "--ct",
  "--ok", "--wn", "--er", "--in",
] as const);

export interface PanelGuardOptions {
  maxBytes?: number;
  hardMaxBytes?: number;
  warnBytes?: number;
  bootPlaceholder?: string | null;
  skipJsParse?: boolean;
  allowEmptyAppRoot?: boolean;
}

export interface PanelGuardResult {
  ok: boolean;
  bytes: number;
  warnings: string[];
  errors: string[];
}

export type I18nMap = ReadonlyMap<string, unknown> | Record<string, unknown>;

export interface I18nCheckResult {
  ok: boolean;
  checkedKeys: number;
  warnings: string[];
  errors: string[];
}

export interface EnNoCjkOptions {
  allowKeys?: Iterable<string>;
}

function extractAllCssBlocks(css: string, selectorRegex: RegExp): string | null {
  const blocks: string[] = [];
  for (const m of css.matchAll(selectorRegex)) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks.length > 0 ? blocks.join("\n") : null;
}

function redactUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return rawUrl.split(/[?#]/)[0].replace(/\/\/[^/@]+@/, "//[redacted]@");
  }
}

function extractAppRootSubtreeBeforeScript(htmlNoComments: string): string | null {
  const bodyMatch = htmlNoComments.match(/<body\b[^>]*>([\s\S]*?)(?:<script\b|<\/body>)/i);
  if (!bodyMatch) return null;
  const preScript = bodyMatch[1];
  const appOpenMatch = /<div\b[^>]*(?:^|\s)id\s*=\s*(?:["']app["']|app(?=[\s/>]))[^>]*>/i.exec(
    preScript
  );
  if (!appOpenMatch || appOpenMatch[0].endsWith("/>")) return null;

  const rest = preScript.slice(appOpenMatch.index);
  const tagRe = /<div\b[^>]*>|<\s*\/\s*div\s*>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rest)) !== null) {
    const tok = m[0];
    if (tok.startsWith("</") || /^<\s*\//.test(tok)) {
      depth -= 1;
      if (depth === 0) {
        return rest.slice(0, m.index + tok.length);
      }
    } else if (!tok.endsWith("/>")) {
      depth += 1;
    }
  }
  return depth > 0 ? rest : null;
}

function hasBootFrameInAppRoot(htmlNoComments: string): boolean {
  const appSubtree = extractAppRootSubtreeBeforeScript(htmlNoComments);
  if (!appSubtree) return false;
  const openTagMatch = appSubtree.match(/^<div\b[^>]*>/i);
  const inner = openTagMatch
    ? appSubtree.slice(openTagMatch[0].length).replace(/<\s*\/\s*div\s*>\s*$/i, "")
    : "";
  if (inner.trim().length === 0) return false;
  for (const tagMatch of appSubtree.matchAll(/<[a-z0-9-]+\b[^>]*>/gi)) {
    const classMatch = tagMatch[0].match(
      /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    );
    if (!classMatch) continue;
    const rawClasses = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "";
    if (rawClasses.split(/\s+/).includes("boot-frame")) return true;
  }
  return false;
}

function validateInlineScriptSyntax(jsBody: string, isModule: boolean): string | null {
  try {
    // Parse-only top-level script validation without executing the script body.
    new vm.Script(isModule ? `"use strict";\n${jsBody}` : jsBody);
    return null;
  } catch (err) {
    const primaryMsg = err instanceof Error ? err.message : String(err);
    if (
      isModule &&
      /(?:await is only valid in async functions|Unexpected token ['"]?export\b)/.test(primaryMsg)
    ) {
      const withoutExports = jsBody
        .replace(/\bexport\s*\{[^}]*\}\s*;?/g, ";")
        .replace(/\bexport\s+default\b/g, "void ")
        .replace(/\bexport\s+(?=(?:const|let|var|function|async\s+function|class)\b)/g, "");
      try {
        new vm.Script(`"use strict";\n(async () => {\n${withoutExports}\n})`);
        const checkNoTopReturn = withoutExports
          .replace(/\bfor\s+await\s*\(/g, "for (")
          .replace(/\bawait\b/g, "void ");
        new vm.Script(`"use strict";\nclass __M { static {\n${checkNoTopReturn}\n} }`);
        return null;
      } catch {
        return primaryMsg;
      }
    }
    return primaryMsg;
  }
}

function extractAttrValue(tag: string, attrName: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    "i"
  );
  const m = tag.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? "";
}

/**
 * Evaluates all Lucid Indigo panel invariants against a compiled self-contained HTML string.
 * Returns `{ ok, bytes, warnings, errors }`.
 */
export function checkPanelInvariants(
  html: string,
  options: PanelGuardOptions = {}
): PanelGuardResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const hardMaxBytes = options.hardMaxBytes ?? HARD_MAX_BYTES;
  const warnBytes = options.warnBytes ?? WARN_BYTES;
  const bootPlaceholder = options.bootPlaceholder ?? null;
  const skipJsParse = options.skipJsParse === true;
  const allowEmptyAppRoot = options.allowEmptyAppRoot === true;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof html !== "string" || html.length === 0) {
    return { ok: false, bytes: 0, warnings, errors: ["panel HTML must be a non-empty string"] };
  }

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > hardMaxBytes) {
    errors.push(`hard size gate exceeded: ${bytes} B > ${hardMaxBytes} B`);
  } else if (bytes > maxBytes) {
    errors.push(`size budget exceeded: ${bytes} B > ${maxBytes} B`);
  }
  if (bytes > warnBytes) {
    warnings.push(`panel size warning: ${bytes} B > ${warnBytes} B`);
  }

  // Strip HTML comments before structural tag scanning so commented-out <meta>/<style>/<script> cannot spoof checks.
  const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");

  // CSP must be declared inside <head> via <meta http-equiv="Content-Security-Policy" ...>
  const headMatch = htmlNoComments.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const headHtml = headMatch ? headMatch[1] : "";
  const cspMetaTags =
    headHtml.match(/<meta\b[^>]*http-equiv\s*=\s*(?:["']content-security-policy["']|content-security-policy(?=[\s/>]))[^>]*>/gi) ||
    [];
  const hasValidCsp = cspMetaTags.some((tag) => {
    const cm = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!cm) return false;
    return /(?:^|;)\s*default-src\s+'none'\s*(?:;|$)/i.test(cm[2]);
  });
  if (!hasValidCsp) {
    errors.push("missing <head> CSP meta directive: default-src 'none'");
  }

  // Zero external URLs (allow standard XML SVG namespace only; redact query/userinfo in errors)
  const strippedSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/gi, "");
  const extUrl = strippedSvgNs.match(/(?:https?|wss?):\/\/[^"'\s<>)]+/i);
  if (extUrl) {
    errors.push(`forbidden external URL detected: ${redactUrlForLog(extUrl[0])}`);
  }
  const protoRelAttr = strippedSvgNs.match(
    /\b(?:src|href|action|poster|data)\s*=\s*(?:["'](\/\/[^"'\s<>]+)["']|(\/\/[^\s"'<>`]+))/i
  );
  if (protoRelAttr) {
    errors.push(`forbidden protocol-relative URL detected: ${redactUrlForLog(protoRelAttr[1] || protoRelAttr[2])}`);
  }
  const protoRelCssUrl = strippedSvgNs.match(/\burl\(\s*["']?(\/\/[^"'\s)]+)/i);
  if (protoRelCssUrl) {
    errors.push(`forbidden protocol-relative CSS url() detected: ${redactUrlForLog(protoRelCssUrl[1])}`);
  }
  const protoRelImport = strippedSvgNs.match(/@import\s+["'](\/\/[^"'\s]+)["']/i);
  if (protoRelImport) {
    errors.push(`forbidden protocol-relative @import detected: ${redactUrlForLog(protoRelImport[1])}`);
  }
  const protoRelQuotedHost = strippedSvgNs.match(
    /["'](\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/[^"'\s<>]*)?)["']/i
  );
  if (protoRelQuotedHost) {
    errors.push(`forbidden protocol-relative URL string detected: ${redactUrlForLog(protoRelQuotedHost[1])}`);
  }

  // Byte-0 Frame-0 SSR root locks: canonical Dark (#0B0D12) OR canonical Light (data-theme="light" + #F8FAFD)
  const htmlTag = htmlNoComments.match(/<html\b[^>]*>/i)?.[0] || "";
  const bodyTag = htmlNoComments.match(/<body\b[^>]*>/i)?.[0] || "";
  const htmlDataThemeRaw = extractAttrValue(htmlTag, "data-theme");
  const htmlDataTheme = htmlDataThemeRaw !== null ? htmlDataThemeRaw.trim().toLowerCase() : null;
  const htmlStyle = extractAttrValue(htmlTag, "style") ?? "";
  const bodyStyle = extractAttrValue(bodyTag, "style") ?? "";

  if (htmlDataTheme !== null && htmlDataTheme !== "dark" && htmlDataTheme !== "light") {
    errors.push(
      `invalid data-theme="${htmlDataThemeRaw}" on <html>: expected "light" or "dark" (or omit for dark default)`
    );
  } else if (htmlDataTheme === "light") {
    if (
      !/(?:^|;)\s*background(?:-color)?\s*:\s*#f8fafd(?:\s*!important)?\s*(?:;|$)/i.test(htmlStyle) ||
      !/(?:^|;)\s*color-scheme\s*:\s*light(?:\s*!important)?\s*(?:;|$)/i.test(htmlStyle)
    ) {
      errors.push(
        'missing light SSR inline lock on <html data-theme="light"> (background:#F8FAFD;color-scheme:light)'
      );
    }
    if (
      !/<meta\b[^>]*\bname=["']color-scheme["'][^>]*\bcontent=["']light["'][^>]*>/i.test(
        htmlNoComments
      ) &&
      !/<meta\b[^>]*\bcontent=["']light["'][^>]*\bname=["']color-scheme["'][^>]*>/i.test(
        htmlNoComments
      )
    ) {
      errors.push(
        'missing light-only <meta name="color-scheme" content="light"> for <html data-theme="light">'
      );
    }
    if (
      !/(?:^|;)\s*background(?:-color)?\s*:\s*#f8fafd(?:\s*!important)?\s*(?:;|$)/i.test(bodyStyle)
    ) {
      errors.push('missing light SSR inline lock on <body> (background:#F8FAFD)');
    }
  } else {
    if (
      !/(?:^|;)\s*background(?:-color)?\s*:\s*#0b0d12(?:\s*!important)?\s*(?:;|$)/i.test(htmlStyle) ||
      !/(?:^|;)\s*color-scheme\s*:\s*dark(?:\s*!important)?\s*(?:;|$)/i.test(htmlStyle)
    ) {
      errors.push('missing dark-first inline lock on <html> (background:#0B0D12;color-scheme:dark)');
    }
    if (
      !/<meta\b[^>]*\bname=["']color-scheme["'][^>]*\bcontent=["']dark["'][^>]*>/i.test(
        htmlNoComments
      ) &&
      !/<meta\b[^>]*\bcontent=["']dark["'][^>]*\bname=["']color-scheme["'][^>]*>/i.test(
        htmlNoComments
      )
    ) {
      errors.push('missing dark-only <meta name="color-scheme" content="dark">');
    }
    if (
      !/(?:^|;)\s*background(?:-color)?\s*:\s*#0b0d12(?:\s*!important)?\s*(?:;|$)/i.test(bodyStyle)
    ) {
      errors.push('missing dark-first inline lock on <body> (background:#0B0D12)');
    }
  }

  // Zero prefers-color-scheme
  if (/prefers-color-scheme/i.test(htmlNoComments)) {
    errors.push("forbidden prefers-color-scheme query found");
  }

  // Extract all <style> blocks and strip CSS comments once for keyframes & token checks
  const styleBlocks = [...htmlNoComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const combinedCss = styleBlocks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

  // Reject host --color-background-primary on html/body/:root canvas (prevents #FFFFFF flash during webview hydration)
  const hostBgOnCanvas =
    /\bbackground(?:-color)?\s*:\s*[^"';>]*var\(\s*--color-background-primary\b/i.test(htmlTag) ||
    /\bbackground(?:-color)?\s*:\s*[^"';>]*var\(\s*--color-background-primary\b/i.test(bodyTag) ||
    [...combinedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(
      ([, sel, decls]) =>
        /(?:\b(?:html|body)\b|:root\b)/i.test(sel) &&
        /\bbackground(?:-color)?\s*:\s*[^;{}]*var\(\s*--color-background-primary\b/i.test(decls)
    );
  if (hostBgOnCanvas) {
    errors.push(
      "forbidden --color-background-primary on html/body background — use var(--bg) so host hydration cannot flash #FFFFFF"
    );
  }

  // Require Frame-0 painted .boot-frame shell inside <div id="app"> before <script> unless allowEmptyAppRoot === true
  if (!allowEmptyAppRoot && !hasBootFrameInAppRoot(htmlNoComments)) {
    errors.push(
      'missing Frame-0 .boot-frame shell inside <div id="app"> before <script> — render <div class="boot-frame">...</div> inside #app (or pass allowEmptyAppRoot: true)'
    );
  }

  // Zero opacity:0 / 0% / 0 !important inside @keyframes / @-webkit-keyframes
  const keyframes =
    combinedCss.match(/@(?:-webkit-)?keyframes\s+[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi) || [];
  for (const kf of keyframes) {
    if (/opacity\s*:\s*(?:0(?:\.0+)?|\.0+)%?(?:\s*!important)?(?:\s*[;}]|$)/i.test(kf)) {
      errors.push(`forbidden opacity:0 in @keyframes: ${kf.slice(0, 80)}`);
    }
  }

  // Zero innerHTML / outerHTML (= or +=, dot or bracket) / insertAdjacentHTML / document.write / createContextualFragment / parseFromString DOM sinks
  if (/(?:\.(?:innerHTML|outerHTML)|\[\s*["'`](?:innerHTML|outerHTML)["'`]\s*\])\s*\+?=/i.test(html)) {
    errors.push("forbidden innerHTML/outerHTML assignment detected");
  }
  if (
    /(?:\.(?:insertAdjacentHTML|write|writeln|createContextualFragment|parseFromString)|\[\s*["'`](?:insertAdjacentHTML|write|writeln|createContextualFragment|parseFromString)["'`]\s*\])\s*\(/i.test(
      html
    )
  ) {
    errors.push(
      "forbidden HTML string injection sink detected (insertAdjacentHTML/document.write/createContextualFragment/parseFromString)"
    );
  }

  // Zero --buncss-* declarations
  if (/--buncss-/i.test(htmlNoComments)) {
    errors.push("forbidden --buncss-* declaration detected");
  }

  // Exactly one inline <script> or <script type="module">
  const scripts = htmlNoComments.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  if (scripts.length !== 1) {
    errors.push(`expected exactly 1 inline <script> tag, found ${scripts.length}`);
  } else {
    const openTag = scripts[0].match(/^<script\b[^>]*>/i)?.[0] || "";
    if (/\bsrc\s*=/i.test(openTag)) {
      errors.push("external <script src=...> is forbidden");
    }
    const rawType = extractAttrValue(openTag, "type");
    let isModuleScript = false;
    if (rawType !== null) {
      const scriptType = rawType.trim().toLowerCase();
      if (scriptType === "module") {
        isModuleScript = true;
      } else {
        errors.push(
          `unsupported <script type="${rawType}">: expected <script> or <script type="module">`
        );
      }
    }
    if (bootPlaceholder && !scripts[0].includes(bootPlaceholder)) {
      errors.push(`missing SSR boot placeholder: ${bootPlaceholder}`);
    }
    if (!skipJsParse) {
      const jsBody = scripts[0].replace(/^<script\b[^>]*>|<\/script>$/gi, "");
      const syntaxErr = validateInlineScriptSyntax(jsBody, isModuleScript);
      if (syntaxErr) {
        errors.push(`inline <script> syntax error: ${syntaxErr}`);
      }
    }
  }

  // All Lucid Indigo family tokens in BOTH dark (:root) and light (:root[data-theme="light"]) + canonical anchor values
  if (styleBlocks.length === 0) {
    errors.push("missing inline <style> block");
  } else {
    const darkBlock = extractAllCssBlocks(combinedCss, /:root\s*\{([^}]+)\}/gi);
    const lightBlock = extractAllCssBlocks(
      combinedCss,
      /:root\s*\[\s*data-theme\s*=\s*["']?light["']?\s*\]\s*\{([^}]+)\}/gi
    );

    if (!darkBlock) {
      errors.push("missing dark :root token block");
    }
    if (!lightBlock) {
      errors.push('missing light :root[data-theme="light"] token block');
    }
    if (darkBlock && lightBlock) {
      for (const tok of FAMILY_TOKENS) {
        const tokRe = new RegExp(`${tok}\\s*:`, "i");
        if (!tokRe.test(darkBlock)) errors.push(`missing dark family token: ${tok}`);
        if (!tokRe.test(lightBlock)) errors.push(`missing light family token: ${tok}`);
      }
      if (!/--bg\s*:\s*(?:var\([^,)]+,\s*)?#0b0d12\b/i.test(darkBlock)) {
        errors.push(`dark theme --bg must be ${DARK_BG_HEX}`);
      }
      if (!/--ac\s*:\s*#6895ff\b/i.test(darkBlock)) {
        errors.push(`dark theme --ac must be ${DARK_ACCENT_HEX}`);
      }
      if (!/--ok\s*:\s*#34d399\b/i.test(darkBlock)) {
        errors.push(`dark theme --ok must be ${DARK_OK_HEX}`);
      }
      if (!/--bg\s*:\s*(?:var\([^,)]+,\s*)?#f8fafd\b/i.test(lightBlock)) {
        errors.push(`light theme --bg must be ${LIGHT_BG_HEX}`);
      }
      if (!/--ac\s*:\s*#2952cc\b/i.test(lightBlock)) {
        errors.push(`light theme --ac must be ${LIGHT_ACCENT_HEX}`);
      }
      if (!/--ok\s*:\s*#059669\b/i.test(lightBlock)) {
        errors.push(`light theme --ok must be ${LIGHT_OK_HEX}`);
      }
    }
    if (!/prefers-reduced-motion\s*:\s*reduce/i.test(combinedCss)) {
      errors.push("missing @media (prefers-reduced-motion: reduce) rule");
    }
  }

  return { ok: errors.length === 0, bytes, warnings, errors };
}

/**
 * Throws an Error listing every failed invariant if `html` violates the Panel QA gate.
 */
export function assertPanelInvariants(
  html: string,
  options: PanelGuardOptions = {}
): PanelGuardResult {
  const report = checkPanelInvariants(html, options);
  if (!report.ok) {
    throw new Error(`Panel invariant gate failed (${report.bytes} B):\n- ${report.errors.join("\n- ")}`);
  }
  return report;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function flattenI18nEntries(
  input: unknown,
  localeName: string
): { entries: Map<string, string>; errors: string[] } {
  const entries = new Map<string, string>();
  const errors: string[] = [];

  if (!(input instanceof Map) && !isPlainObject(input)) {
    errors.push(
      `Invalid ${localeName} translation map: expected a plain { key: string } object or Map (e.g., I18N.${localeName}).`
    );
    return { entries, errors };
  }

  const walk = (node: ReadonlyMap<unknown, unknown> | Record<string, unknown>, prefix: string): void => {
    const iter = node instanceof Map ? node.entries() : Object.entries(node);
    for (const [rawKey, val] of iter) {
      const key = String(rawKey);
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === "string") {
        entries.set(fullKey, val);
      } else if (val instanceof Map || isPlainObject(val)) {
        walk(val, fullKey);
      } else {
        const kind = val === null ? "null" : Array.isArray(val) ? "array" : typeof val;
        errors.push(
          `Invalid ${localeName} value at "${fullKey}": expected string (got ${kind}) — replace with a string or nested object.`
        );
      }
    }
  };

  walk(input as ReadonlyMap<unknown, unknown> | Record<string, unknown>, "");
  return { entries, errors };
}

function extractPlaceholders(str: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of str.matchAll(PLACEHOLDER_RE)) {
    const token = `{${m[1]}}`;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function formatPlaceholders(counts: ReadonlyMap<string, number>): string {
  if (counts.size === 0) return "none";
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tok, n]) => (n > 1 ? `${tok} x${n}` : tok))
    .join(", ");
}

function placeholderCountsEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

function previewText(str: string, maxLen = 48): string {
  const compact = str.replace(/\s+/g, " ").trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

/**
 * Verifies 1:1 key and `{placeholder}` parity between `enMap` and `zhMap`.
 * Returns `{ ok, checkedKeys, warnings, errors }` with actionable remediation errors.
 */
export function checkI18nParity(enMap: I18nMap, zhMap: I18nMap): I18nCheckResult {
  const warnings: string[] = [];
  const enParsed = flattenI18nEntries(enMap, "en");
  const zhParsed = flattenI18nEntries(zhMap, "zh");
  const errors = [...enParsed.errors, ...zhParsed.errors];

  for (const [key, enVal] of enParsed.entries) {
    const zhVal = zhParsed.entries.get(key);
    if (zhVal === undefined) {
      errors.push(
        `Missing zh translation for key "${key}" (en: "${previewText(enVal)}") — add "${key}" to your zh dictionary to restore 1:1 parity.`
      );
      continue;
    }
    const enEmpty = enVal.trim().length === 0;
    const zhEmpty = zhVal.trim().length === 0;
    if (enEmpty !== zhEmpty) {
      const emptyLocale = zhEmpty ? "zh" : "en";
      const nonEmptyVal = zhEmpty ? enVal : zhVal;
      errors.push(
        `Empty ${emptyLocale} translation for key "${key}" (other locale: "${previewText(nonEmptyVal)}") — provide translated copy instead of an empty string.`
      );
      continue;
    }
    const enPh = extractPlaceholders(enVal);
    const zhPh = extractPlaceholders(zhVal);
    if (!placeholderCountsEqual(enPh, zhPh)) {
      errors.push(
        `Placeholder mismatch for i18n key "${key}": en uses [${formatPlaceholders(enPh)}] but zh uses [${formatPlaceholders(zhPh)}] — keep identical {placeholder} tokens in both locales.`
      );
    }
  }

  for (const key of zhParsed.entries.keys()) {
    if (!enParsed.entries.has(key)) {
      errors.push(
        `Extra zh translation key "${key}" missing from en — add "${key}" to your en dictionary or remove the stale zh key.`
      );
    }
  }

  return { ok: errors.length === 0, checkedKeys: enParsed.entries.size, warnings, errors };
}

/**
 * Throws an Error listing every i18n parity violation if `enMap` and `zhMap` diverge.
 */
export function assertI18nParity(enMap: I18nMap, zhMap: I18nMap): I18nCheckResult {
  const report = checkI18nParity(enMap, zhMap);
  if (!report.ok) {
    throw new Error(`i18n parity gate failed (${report.checkedKeys} keys):\n- ${report.errors.join("\n- ")}`);
  }
  return report;
}

/**
 * Flags stray CJK characters or CJK punctuation in English UI copy (`enMap`).
 * Pass `{ allowKeys: ["langZh"] }` if specific keys intentionally render localized language labels.
 */
export function checkEnNoCjk(enMap: I18nMap, options: EnNoCjkOptions = {}): I18nCheckResult {
  const warnings: string[] = [];
  const allowKeys = new Set(
    Array.isArray(options.allowKeys) || options.allowKeys instanceof Set ? options.allowKeys : []
  );
  const parsed = flattenI18nEntries(enMap, "en");
  const errors = [...parsed.errors];

  for (const [key, val] of parsed.entries) {
    if (allowKeys.has(key)) continue;
    const matches = val.match(CJK_CHAR_RE);
    if (matches && matches.length > 0) {
      const uniqueChars = [...new Set(matches)].slice(0, 6).join("");
      errors.push(
        `Stray CJK character(s) [${uniqueChars}] in EN copy for key "${key}": "${previewText(val)}" — replace with English copy (or pass "${key}" in options.allowKeys if intentionally localized).`
      );
    }
  }

  return { ok: errors.length === 0, checkedKeys: parsed.entries.size, warnings, errors };
}

/**
 * Throws an Error if English UI copy contains unexpected CJK characters.
 */
export function assertEnNoCjk(enMap: I18nMap, options: EnNoCjkOptions = {}): I18nCheckResult {
  const report = checkEnNoCjk(enMap, options);
  if (!report.ok) {
    throw new Error(`EN no-CJK gate failed (${report.checkedKeys} keys):\n- ${report.errors.join("\n- ")}`);
  }
  return report;
}

// CLI entrypoint: `node panel/guard.ts <panel.html> [--max-bytes 65536] [--allow-empty-app-root]`
const isMain =
  typeof process !== "undefined" &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  let filePath: string | null = null;
  let maxBytes = DEFAULT_MAX_BYTES;
  let allowEmptyAppRoot = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--max-bytes") {
      if (!args[i + 1]) {
        console.error("Error: --max-bytes requires a positive integer value");
        process.exit(2);
      }
      const parsed = Number(args[i + 1]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error(`Error: invalid --max-bytes value: ${args[i + 1]}`);
        process.exit(2);
      }
      maxBytes = parsed;
      i += 1;
    } else if (args[i] === "--allow-empty-app-root") {
      allowEmptyAppRoot = true;
    } else if (args[i].startsWith("-")) {
      console.error(`Error: unknown option: ${args[i]}`);
      process.exit(2);
    } else {
      if (filePath !== null) {
        console.error(`Error: unexpected extra argument: ${args[i]}`);
        process.exit(2);
      }
      filePath = args[i];
    }
  }
  if (!filePath) {
    console.error("Usage: node panel/guard.ts <panel.html> [--max-bytes 65536] [--allow-empty-app-root]");
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, "utf8");
  const report = checkPanelInvariants(html, { maxBytes, allowEmptyAppRoot });
  for (const w of report.warnings) console.warn(`[warn] ${w}`);
  if (!report.ok) {
    console.error(`FAIL ${filePath} (${report.bytes} B):`);
    for (const e of report.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`PASS ${filePath} (${report.bytes} B <= ${maxBytes} B)`);
}
