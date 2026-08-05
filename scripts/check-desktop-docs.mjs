#!/usr/bin/env node
// Pre-build, source-only guard for the Desktop-app usage docs.
//
// It owns exactly the invariants the existing gates do NOT cover:
//   - the optimized screenshot set (count, naming, per-file & total size, no PNG),
//   - the four new usage pages exist in both channels and both locales,
//   - every /gui/*.webp an MDX references is present on disk,
//   - each channel's folder meta lists the four slugs after `getting-started`,
//   - new content is channel-neutral (no `/docs/beta/` links),
//   - both channels retain the same required Desktop page and metadata shape.
//
// It does NOT re-implement `check:links` (post-build src/href) or
// `check:assets` (Cloudflare deploy limits). Downstream MDX assertions
// skip-with-note while the files are absent and hard-fail once present.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guiDir = join(root, "public", "gui");
const channels = ["beta", "stable"];
const locales = ["en", "vi"];
const NEW_SLUGS = [
  "interface-overview",
  "managing-entities",
  "projects-and-plans",
  "settings-and-system",
];
const AUDITED_SLUGS = [...NEW_SLUGS, "getting-started"];

const EXPECTED_WEBP = [
  "dashboard-charts",
  "dashboard-empty-state",
  "dashboard-runtime-filter",
  "kits-install-wizard",
  "subagents-list-detail",
  "commands-grouped",
  "hooks-harness",
  "sessions-list",
  "mcp-servers",
  "projects-list",
  "project-dashboard",
  "plans-kanban",
  "plans-list",
  "plan-detail",
  "journals",
  "feedback-form",
  "settings-app",
  "settings-database",
  "status-line-designer",
  "migrate-wizard",
].map((n) => `${n}.webp`);

const PER_FILE_LIMIT = 500 * 1024; // 500 KB
const TOTAL_LIMIT = 5 * 1024 * 1024; // 5 MB

const fails = [];
const notes = [];
const oks = [];
const fail = (m) => fails.push(m);
const note = (m) => notes.push(m);
const ok = (m) => oks.push(m);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ── 1. Optimized screenshot set ────────────────────────────────────────────
if (!existsSync(guiDir)) {
  fail(`public/gui/ is missing — run the Phase 1 image pipeline first.`);
} else {
  const entries = readdirSync(guiDir);
  const pngs = entries.filter((f) => /\.png$/i.test(f));
  if (pngs.length) fail(`public/gui/ must contain no PNG; found: ${pngs.join(", ")}`);

  const webps = entries.filter((f) => /\.webp$/i.test(f));
  if (webps.length !== EXPECTED_WEBP.length) {
    fail(`expected ${EXPECTED_WEBP.length} .webp in public/gui/, found ${webps.length}`);
  }
  for (const f of webps) {
    if (/[A-Z\s@]/.test(f)) fail(`bad WebP name (space/uppercase/@): "${f}"`);
  }
  const missing = EXPECTED_WEBP.filter((f) => !entries.includes(f));
  if (missing.length) fail(`missing expected WebP: ${missing.join(", ")}`);

  let total = 0;
  for (const f of webps) {
    const size = statSync(join(guiDir, f)).size;
    total += size;
    if (size > PER_FILE_LIMIT) fail(`"${f}" is ${kb(size)} (> 500 KB budget)`);
  }
  if (total > TOTAL_LIMIT) fail(`public/gui total is ${kb(total)} (> 5 MB budget)`);
  if (webps.length) ok(`${webps.length} WebP, total ${kb(total)}, all within budget, no PNG`);
}

// ── helpers for MDX assertions ─────────────────────────────────────────────
const mdxPath = (channel, slug, locale) =>
  join(root, "content", "docs", channel, "desktop-app", `${slug}.${locale}.mdx`);

const anyNewMdxExists = channels.some((c) =>
  NEW_SLUGS.some((s) => locales.some((l) => existsSync(mdxPath(c, s, l)))),
);

if (!anyNewMdxExists) {
  note(`no new usage-page MDX yet — skipping page/meta assertions (Phase 2+).`);
} else {
  // 2. All 16 MDX present.
  for (const c of channels)
    for (const s of NEW_SLUGS)
      for (const l of locales) {
        const p = mdxPath(c, s, l);
        if (!existsSync(p)) fail(`missing MDX: content/docs/${c}/desktop-app/${s}.${l}.mdx`);
      }

  // 3. Referenced /gui/*.webp exist; channel-neutral (no /docs/beta/).
  const imgRe = /!\[[^\]]*\]\((\/gui\/[^)]+)\)/g;
  for (const c of channels)
    for (const s of AUDITED_SLUGS)
      for (const l of locales) {
        const p = mdxPath(c, s, l);
        if (!existsSync(p)) continue;
        const src = readFileSync(p, "utf8");
        if (src.includes("/docs/beta/"))
          fail(`${c}/${s}.${l}.mdx contains a "/docs/beta/" link (breaks stable promotion)`);
        let m;
        while ((m = imgRe.exec(src))) {
          const rel = m[1].replace(/^\//, "");
          if (!existsSync(join(root, "public", rel)))
            fail(`${c}/${s}.${l}.mdx references missing image: ${m[1]}`);
        }
      }

  // 4. Folder meta lists the four slugs after `getting-started`.
  for (const c of channels)
    for (const metaName of ["meta.json", "meta.vi.json"]) {
      const p = join(root, "content", "docs", c, "desktop-app", metaName);
      if (!existsSync(p)) {
        fail(`missing ${c}/desktop-app/${metaName}`);
        continue;
      }
      const pages = JSON.parse(readFileSync(p, "utf8")).pages || [];
      const gs = pages.indexOf("getting-started");
      const slice = pages.slice(gs + 1, gs + 1 + NEW_SLUGS.length);
      if (gs === -1 || slice.join(",") !== NEW_SLUGS.join(","))
        fail(`${c}/desktop-app/${metaName} must list [${NEW_SLUGS.join(", ")}] right after "getting-started"; got [${pages.join(", ")}]`);
    }

  if (!fails.length) ok(`16 MDX present, images resolve, meta ordered, and content is channel-neutral`);
}

// ── report ─────────────────────────────────────────────────────────────────
for (const m of oks) console.log(`  ok   ${m}`);
for (const m of notes) console.log(`  note ${m}`);
for (const m of fails) console.error(`  FAIL ${m}`);

if (fails.length) {
  console.error(`\ncheck-desktop-docs: ${fails.length} failure(s).`);
  process.exit(1);
}
console.log(`\ncheck-desktop-docs: OK${notes.length ? " (with skipped downstream checks)" : ""}.`);
