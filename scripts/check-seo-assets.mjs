#!/usr/bin/env node
// Post-build SEO artifact validation (issue #61): confirms out/sitemap.xml
// and out/robots.txt are well-formed, reference only the production origin,
// exclude the non-canonical beta channel and other unlisted routes, and that
// every sitemap URL actually resolves to a file the static export produced.
//
//   node scripts/check-seo-assets.mjs [--out out]
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/paths.mjs';

export const PRODUCTION_ORIGIN = 'https://docs.agentkit.best';

/** Every `<loc>…</loc>` value in a sitemap.xml document, in document order. */
export function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

/**
 * Sitemap policy checks that don't require the build output: every URL uses
 * the production origin (no staging/local host), and none reference routes
 * that must never be indexed (the non-canonical beta channel, the unlisted
 * `_showcase` QA page).
 */
export function validateSitemapUrls(locs) {
  const errors = [];
  if (locs.length === 0) errors.push('sitemap.xml has no <loc> entries');

  for (const loc of locs) {
    if (!loc.startsWith(`${PRODUCTION_ORIGIN}/`)) {
      errors.push(`<loc>${loc}</loc> does not use the production origin ${PRODUCTION_ORIGIN}`);
      continue;
    }
    const path = loc.slice(PRODUCTION_ORIGIN.length);
    const segments = path.split('/').filter(Boolean);
    if (segments[1] === 'beta') {
      errors.push(`<loc>${loc}</loc> is in the non-canonical beta channel`);
    }
    if (segments.includes('_showcase')) {
      errors.push(`<loc>${loc}</loc> references the unlisted _showcase page`);
    }
  }
  return errors;
}

/** The out/ file a sitemap <loc> should resolve to, mirroring Next static export's page.html layout. */
export function sitePathForLoc(loc) {
  const path = loc.slice(PRODUCTION_ORIGIN.length).split('?')[0].split('#')[0];
  return path === '' || path === '/' ? '/index' : path.replace(/\/$/, '');
}

/** Extract the `<link rel="canonical">` href and `<meta name="robots">` content docsPageMetadata renders (lib/metadata.ts). */
export function extractPageMeta(html) {
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const robots = html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
  return { canonical, robots };
}

/** The public URL a static-export HTML file (relative to out/) represents, mirroring Next's page.html / page/index.html layout. */
export function urlForOutputHtml(relPath) {
  let sitePath = relPath.slice(0, -'.html'.length);
  if (sitePath.endsWith('/index')) sitePath = sitePath.slice(0, -'/index'.length);
  if (sitePath === 'index') sitePath = '';
  return `${PRODUCTION_ORIGIN}/${sitePath}`;
}

/**
 * Bidirectional invariant between the static output and the sitemap: a page
 * that is self-canonical and not `noindex` must be listed in sitemap.xml,
 * and nothing else may be — not a page canonicalized elsewhere (a locale
 * fallback), and not a page marked `noindex` (e.g. `beta`, the unlisted
 * `_showcase` page). Catches a filter silently dropping pages, or a stray
 * page slipping into the sitemap, that url-shape checks alone would miss.
 *
 * `pages` is `{ url, canonical, robots }` for every rendered page that sets
 * a canonical link (i.e. went through `docsPageMetadata`); pages without one
 * (search index JSON, 404, etc.) are the caller's responsibility to exclude.
 */
export function validateHtmlAgainstSitemap(pages, sitemapUrls) {
  const errors = [];
  const sitemapSet = new Set(sitemapUrls);
  for (const { url, canonical, robots } of pages) {
    if (!canonical) continue;
    const isSelfCanonical = canonical === url;
    const isNoindex = /noindex/i.test(robots ?? '');
    const inSitemap = sitemapSet.has(url);
    if (isSelfCanonical && !isNoindex && !inSitemap) {
      errors.push(`${url} is self-canonical and indexable but missing from sitemap.xml`);
    }
    if (inSitemap && (!isSelfCanonical || isNoindex)) {
      errors.push(
        isNoindex
          ? `${url} is noindex but listed in sitemap.xml`
          : `${url} is canonicalized to ${canonical} but listed in sitemap.xml under its own URL`,
      );
    }
  }
  return errors;
}

export function validateRobotsTxt(text) {
  const errors = [];
  const expectedSitemapLine = `Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`;
  if (!text.includes(expectedSitemapLine)) {
    errors.push(`robots.txt is missing "${expectedSitemapLine}"`);
  }
  if (/localhost|127\.0\.0\.1|staging\./i.test(text)) {
    errors.push('robots.txt references a non-production host');
  }
  if (!/Disallow:/i.test(text)) {
    errors.push('robots.txt has no Disallow directives');
  }
  return errors;
}

async function collectHtmlFiles(dir, root = dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(full, root, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(relative(root, full).split(sep).join('/'));
    }
  }
  return files;
}

/** Every rendered `{ url, canonical, robots }` under the given locale dirs of `outDir`. */
async function collectPageMeta(outDir, locales) {
  const pages = [];
  for (const locale of locales) {
    const localeDir = join(outDir, locale);
    if (!existsSync(localeDir)) continue;
    for (const relPath of await collectHtmlFiles(localeDir)) {
      const html = await readFile(join(localeDir, relPath), 'utf8');
      const { canonical, robots } = extractPageMeta(html);
      pages.push({ url: urlForOutputHtml(`${locale}/${relPath}`), canonical, robots });
    }
  }
  return pages;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' } } });
  const outDir = resolve(repoRoot, values.out);
  if (!existsSync(outDir)) {
    throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  }

  const sitemapPath = resolve(outDir, 'sitemap.xml');
  const robotsPath = resolve(outDir, 'robots.txt');
  if (!existsSync(sitemapPath)) throw new Error(`missing ${sitemapPath}`);
  if (!existsSync(robotsPath)) throw new Error(`missing ${robotsPath}`);

  const xml = await readFile(sitemapPath, 'utf8');
  const robotsTxt = await readFile(robotsPath, 'utf8');

  const errors = [];
  if (!xml.includes('<urlset') || !xml.includes('</urlset>')) {
    errors.push('sitemap.xml is missing a <urlset> root element');
  }

  const locs = extractLocs(xml);
  errors.push(...validateSitemapUrls(locs));
  errors.push(...validateRobotsTxt(robotsTxt));

  for (const loc of locs) {
    if (!loc.startsWith(PRODUCTION_ORIGIN)) continue; // already reported above
    const sitePath = sitePathForLoc(loc);
    const base = resolve(outDir, `.${sitePath}`);
    const resolved =
      existsSync(base) || existsSync(`${base}.html`) || existsSync(resolve(base, 'index.html'));
    if (!resolved) errors.push(`<loc>${loc}</loc> has no matching file under out/`);
  }

  const pages = await collectPageMeta(outDir, ['en', 'vi']);
  errors.push(...validateHtmlAgainstSitemap(pages, locs));

  if (errors.length) {
    throw new Error(`SEO asset check failed:\n  - ${errors.join('\n  - ')}`);
  }

  console.error(`check-seo-assets: ${locs.length} sitemap URLs, robots.txt OK.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`check-seo-assets failed: ${error.message}`);
    process.exit(1);
  });
}
