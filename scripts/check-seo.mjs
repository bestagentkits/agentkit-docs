#!/usr/bin/env node
// Verifies the sitemap/robots/noindex/metadata behavior from the SEO plan
// against the real built `out/` artifact. Parses static files directly — no
// running server required (same pattern as check-links.mjs).
//
//   node scripts/check-seo.mjs [--out out]
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/paths.mjs';

export const SITE_ORIGIN = 'https://docs.agentkit.best';
export const MIN_SITEMAP_ENTRIES = 1000;
const SPOT_CHECK_PAGES = [
  'en/stable/getting-started/installation.html',
  'vi/stable/getting-started/installation.html',
  'en/beta/getting-started/installation.html',
  'vi/beta/getting-started/installation.html',
];

const ESCAPED_SITE_ORIGIN = SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Excludes real duplicate/non-page surfaces that must never appear in the
// sitemap: `.md` siblings, the top-level `/api/*` route, and the
// `/{lang}/og/*` and `/{lang}/llms*` route families (segment right after the
// locale, not a path that merely contains one of these words, e.g.
// `reference/cli/api/start` is a real page, matched by neither branch below).
const EXCLUDED_LOC_PATTERN = new RegExp(
  `^${ESCAPED_SITE_ORIGIN}/api/|^${ESCAPED_SITE_ORIGIN}/(en|vi)/og/|^${ESCAPED_SITE_ORIGIN}/(en|vi)/llms|\\.md$`,
);

export function extractLocs(sitemapXml) {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

/** Validate a sitemap.xml body; returns an array of problem strings (empty = OK). */
export function checkSitemapXml(sitemapXml) {
  const errors = [];
  const locs = extractLocs(sitemapXml);
  if (locs.length < MIN_SITEMAP_ENTRIES) {
    errors.push(
      `sitemap.xml has only ${locs.length} <loc> entries (expected at least ${MIN_SITEMAP_ENTRIES}) — looks truncated or badly filtered`,
    );
  }
  for (const loc of locs) {
    if (!loc.startsWith(`${SITE_ORIGIN}/`)) {
      errors.push(`sitemap.xml has a <loc> not on ${SITE_ORIGIN}: ${loc}`);
    } else if (EXCLUDED_LOC_PATTERN.test(loc)) {
      errors.push(`sitemap.xml includes an excluded route: ${loc}`);
    }
  }
  if (sitemapXml.includes('<lastmod>')) {
    errors.push(
      'sitemap.xml has a <lastmod> entry — no trustworthy per-page timestamp exists yet (see plan Decisions)',
    );
  }
  return errors;
}

/** Validate a robots.txt body; returns an array of problem strings (empty = OK). */
export function checkRobotsTxt(robotsTxt) {
  if (!robotsTxt.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)) {
    return [`robots.txt is missing the line "Sitemap: ${SITE_ORIGIN}/sitemap.xml"`];
  }
  return [];
}

/** Validate the `/*.md` block of a Cloudflare `_headers` file carries noindex. */
export function checkHeadersNoindex(headers) {
  const lines = headers.split('\n');
  const ruleIndex = lines.indexOf('/*.md');
  if (ruleIndex === -1) {
    return ['_headers /*.md block is missing "X-Robots-Tag: noindex"'];
  }
  const blockLines = [];
  for (let i = ruleIndex + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    blockLines.push(lines[i].trim());
  }
  if (!blockLines.includes('X-Robots-Tag: noindex')) {
    return ['_headers /*.md block is missing "X-Robots-Tag: noindex"'];
  }
  return [];
}

/**
 * Validate a built page's Twitter Card + JSON-LD metadata. `label` is used
 * only to make error messages point at the right file.
 */
export function checkPageMetadata(html, label) {
  const errors = [];
  if (!/<meta name="twitter:card" content="summary_large_image"/.test(html)) {
    errors.push(`${label} is missing a twitter:card=summary_large_image meta tag`);
  }

  const scriptBodies = [
    ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  const types = [];
  for (const body of scriptBodies) {
    // Sanity-check the escaping helper actually ran, not just that the JSON
    // happens to be valid — a script-breakout payload would also happen to
    // parse as JSON if the browser never gets to it.
    if (body.includes('<') || body.includes('>')) {
      errors.push(
        `${label} has a JSON-LD script body with a raw "<" or ">" — the escaping helper may not have run`,
      );
    }
    try {
      types.push(JSON.parse(body)['@type']);
    } catch {
      errors.push(`${label} has a JSON-LD script body that does not parse as JSON`);
    }
  }
  for (const required of ['WebSite', 'Organization']) {
    if (!types.includes(required)) {
      errors.push(`${label} is missing a JSON-LD block with @type "${required}"`);
    }
  }
  return errors;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' } } });
  const outDir = resolve(repoRoot, values.out);
  if (!existsSync(outDir)) {
    throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  }

  const errors = [];

  const sitemapPath = join(outDir, 'sitemap.xml');
  if (!existsSync(sitemapPath)) {
    errors.push('out/sitemap.xml is missing');
  } else {
    errors.push(...checkSitemapXml(await readFile(sitemapPath, 'utf8')));
  }

  const robotsPath = join(outDir, 'robots.txt');
  if (!existsSync(robotsPath)) {
    errors.push('out/robots.txt is missing');
  } else {
    errors.push(...checkRobotsTxt(await readFile(robotsPath, 'utf8')));
  }

  const headersPath = join(outDir, '_headers');
  if (!existsSync(headersPath)) {
    errors.push('out/_headers is missing');
  } else {
    errors.push(...checkHeadersNoindex(await readFile(headersPath, 'utf8')));
  }

  for (const spotCheckPage of SPOT_CHECK_PAGES) {
    const pagePath = join(outDir, spotCheckPage);
    if (!existsSync(pagePath)) {
      errors.push(`spot-check page missing: out/${spotCheckPage}`);
    } else {
      errors.push(
        ...checkPageMetadata(await readFile(pagePath, 'utf8'), `out/${spotCheckPage}`),
      );
    }
  }

  if (errors.length) {
    console.error(`check-seo: ${errors.length} problem(s) found:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.error('check-seo: sitemap, robots, noindex header, and page metadata all OK.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`check-seo failed: ${err.message}`);
    process.exit(1);
  });
}
