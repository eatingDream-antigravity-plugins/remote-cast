#!/usr/bin/env node
// Panel bundler & minifier for Remote Cast -> panel/dist/panel.html (<= 64 KiB).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as moduleNs from "node:module";
import { fileURLToPath } from "node:url";
import type * as esbuildNs from "esbuild";
import { assertPanelInvariants, HARD_MAX_BYTES, WARN_BYTES } from "./kit/guard.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = moduleNs.createRequire(import.meta.url);

const ENTRY_TS = path.join(__dirname, "stage.ts");
const MODULES: readonly string[] = ["kit/bridge.ts", "net-policy.ts", "i18n.ts"];
const BOOT_TOKEN = "/*__CHROME_STREAM_BOOT__*/";

function tryLoadEsbuild(): typeof esbuildNs | null {
  if (process.env.PANEL_BUNDLER === "bun") return null;
  for (const mod of [process.env.ESBUILD_PATH, "esbuild"].filter((m): m is string => Boolean(m))) {
    try {
      return require(mod) as typeof esbuildNs;
    } catch {}
  }
  return null;
}

function tryCliBundle(): { code: string; engine: string } | null {
  let tmpDir = "";
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-pack-"));
    fs.mkdirSync(path.join(tmpDir, "kit"), { recursive: true });
    for (const file of [...MODULES, "stage.ts"]) {
      fs.writeFileSync(path.join(tmpDir, file), fs.readFileSync(path.join(__dirname, file), "utf8"), "utf8");
    }
    const tmpEntry = path.join(tmpDir, "stage.ts");

    for (const esbBin of ["esbuild", "/opt/homebrew/bin/esbuild", "/usr/local/bin/esbuild"]) {
      try {
        const out = execFileSync(
          esbBin,
          [
            tmpEntry,
            "--bundle",
            "--minify",
            "--tree-shaking=true",
            "--charset=utf8",
            "--legal-comments=none",
            "--format=iife",
            "--platform=browser",
            "--target=es2022",
          ],
          { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
        );
        if (out.trim()) return { code: out.trim(), engine: "esbuild-cli" };
      } catch {}
    }

    for (const bunBin of ["bun", "/opt/homebrew/bin/bun", path.join(os.homedir(), ".bun", "bin", "bun")]) {
      try {
        const out = execFileSync(
          bunBin,
          ["build", tmpEntry, "--bundle", "--minify", "--format=iife", "--target=browser"],
          { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
        );
        if (out.trim()) return { code: out.trim(), engine: "bun" };
      } catch {}
    }
    return null;
  } catch {
    return null;
  } finally {
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function tryBunCss(rawCss: string): string | null {
  let tmpDir = "";
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-css-"));
    const tmpCss = path.join(tmpDir, "combined.css");
    fs.writeFileSync(tmpCss, rawCss, "utf8");
    for (const bunBin of ["bun", "/opt/homebrew/bin/bun", path.join(os.homedir(), ".bun", "bin", "bun")]) {
      try {
        const out = execFileSync(bunBin, ["build", tmpCss, "--minify"], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (out.trim()) return out.trim();
      } catch {}
    }
    return null;
  } catch {
    return null;
  } finally {
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function cleanCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--buncss-[a-z0-9-]+:[^;}"']+;?/gi, "")
    .replace(/--([a-z0-9-]+):\s+/gi, "--$1:")
    .replace(/,\s+/g, ",")
    .replace(/:\s+/g, ":")
    .replace(/\s*\{\s*/g, "{")
    .replace(/;\s*/g, ";")
    .replace(/;}/g, "}")
    .replace(/<\/style/gi, "<\\/style")
    .trim();
}

function fallbackMinifyCss(css: string): string {
  return cleanCss(
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,>~+])\s*/g, "$1")
  );
}

function compactJsFallback(code: string): string {
  return code
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function fallbackBundleJs(): string {
  const stripTs = (moduleNs as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
  const strip = (src: string): string => {
    const js = stripTs ? stripTs(src) : src;
    return js
      .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, "");
  };
  const parts = [...MODULES, "stage.ts"].map((file) => strip(fs.readFileSync(path.join(__dirname, file), "utf8")));
  return `(()=>{"use strict";${compactJsFallback(parts.join("\n"))}})();`;
}

async function bundleAssets(): Promise<{ js: string; css: string; engine: string }> {
  const kitTokens = fs.readFileSync(path.join(__dirname, "kit", "tokens.css"), "utf8");
  const rawCss = `${kitTokens}\n${fs.readFileSync(path.join(__dirname, "styles.css"), "utf8")}`;

  const esbuild = tryLoadEsbuild();
  if (esbuild) {
    const res = await esbuild.build({
      entryPoints: [ENTRY_TS],
      bundle: true,
      minify: true,
      treeShaking: true,
      charset: "utf8",
      legalComments: "none",
      format: "iife",
      platform: "browser",
      target: ["es2022"],
      mangleProps: /^_[a-z]$/,
      write: false,
    });
    const minCss = await esbuild.transform(rawCss, {
      loader: "css",
      minify: true,
      charset: "utf8",
      legalComments: "none",
    });
    return {
      js: res.outputFiles[0].text.trim(),
      css: cleanCss(minCss.code),
      engine: "esbuild",
    };
  }

  const cliOut = tryCliBundle();
  if (cliOut) {
    return {
      js: cliOut.code,
      css: cleanCss(tryBunCss(rawCss) || fallbackMinifyCss(rawCss)),
      engine: cliOut.engine,
    };
  }

  return {
    js: fallbackBundleJs(),
    css: fallbackMinifyCss(rawCss),
    engine: "fallback",
  };
}

const { js, css, engine } = await bundleAssets();
const jsCode = js.replace(/<\/script/gi, "<\\/script");
const cssCode = css.replace(/<\/style/gi, "<\\/style");

// Validate generated JS syntax before writing
new Function(jsCode);

const template = fs.readFileSync(path.join(__dirname, "template.html"), "utf8").replace(/>\s+</g, "><").trim();
const html = template
  .replace("/*__INLINE_CSS__*/", () => cssCode)
  .replace("/*__INLINE_JS__*/", () => jsCode);

const report = assertPanelInvariants(html, {
  maxBytes: HARD_MAX_BYTES,
  hardMaxBytes: HARD_MAX_BYTES,
  warnBytes: WARN_BYTES,
  bootPlaceholder: BOOT_TOKEN,
});
if (!report.ok) {
  throw new Error(`Panel guard failed (dist unchanged):\n- ${report.errors.join("\n- ")}`);
}

const distDir = path.join(__dirname, "dist");
fs.mkdirSync(distDir, { recursive: true });
const outHtml = path.join(distDir, "panel.html");
const tmpHtml = path.join(distDir, `.panel-${process.pid}.tmp`);
fs.writeFileSync(tmpHtml, html, "utf8");
fs.renameSync(tmpHtml, outHtml);

const totalBytes = report.bytes;
const jsBytes = Buffer.byteLength(jsCode, "utf8");
const cssBytes = Buffer.byteLength(cssCode, "utf8");
const kb = totalBytes / 1024;
console.log(`Built ${outHtml} (${totalBytes} B / ${kb.toFixed(1)} KiB; js=${jsBytes} B, css=${cssBytes} B, engine=${engine})`);
for (const warn of report.warnings) {
  console.warn(`WARN: ${warn}`);
}
