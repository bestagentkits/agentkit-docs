import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLocs,
  extractPageMeta,
  PRODUCTION_ORIGIN,
  sitePathForLoc,
  urlForOutputHtml,
  validateHtmlAgainstSitemap,
  validateRobotsTxt,
  validateSitemapUrls,
} from './check-seo-assets.mjs';

test('extractLocs reads every <loc> in document order', () => {
  const xml = `<urlset><url><loc>${PRODUCTION_ORIGIN}/en/stable</loc></url><url><loc>${PRODUCTION_ORIGIN}/vi/stable</loc></url></urlset>`;
  assert.deepEqual(extractLocs(xml), [
    `${PRODUCTION_ORIGIN}/en/stable`,
    `${PRODUCTION_ORIGIN}/vi/stable`,
  ]);
});

test('validateSitemapUrls rejects a non-production origin', () => {
  const errors = validateSitemapUrls(['https://staging.docs.agentkit.best/en/stable']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /production origin/);
});

test('validateSitemapUrls rejects the non-canonical beta channel', () => {
  const errors = validateSitemapUrls([`${PRODUCTION_ORIGIN}/en/beta/guides/foo`]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /beta channel/);
});

test('validateSitemapUrls rejects the unlisted _showcase page', () => {
  const errors = validateSitemapUrls([`${PRODUCTION_ORIGIN}/en/_showcase`]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /_showcase/);
});

test('validateSitemapUrls accepts a clean stable URL', () => {
  assert.deepEqual(validateSitemapUrls([`${PRODUCTION_ORIGIN}/en/stable/getting-started/installation`]), []);
});

test('validateSitemapUrls flags an empty sitemap', () => {
  const errors = validateSitemapUrls([]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no <loc> entries/);
});

test('sitePathForLoc strips the origin and query/hash', () => {
  assert.equal(
    sitePathForLoc(`${PRODUCTION_ORIGIN}/en/stable/getting-started/installation`),
    '/en/stable/getting-started/installation',
  );
  assert.equal(sitePathForLoc(`${PRODUCTION_ORIGIN}/`), '/index');
  assert.equal(sitePathForLoc(`${PRODUCTION_ORIGIN}`), '/index');
});

test('validateRobotsTxt requires the canonical sitemap reference', () => {
  const errors = validateRobotsTxt('User-agent: *\nAllow: /\nDisallow: /api/\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Sitemap:/);
});

test('validateRobotsTxt rejects a non-production host', () => {
  const text = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: http://localhost:3000/sitemap.xml\n`;
  const errors = validateRobotsTxt(text);
  assert.ok(errors.some((e) => /non-production host/.test(e)));
});

test('validateRobotsTxt accepts a well-formed document', () => {
  const text = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`;
  assert.deepEqual(validateRobotsTxt(text), []);
});

test('extractPageMeta reads the canonical link and robots meta tag', () => {
  const html =
    '<head><link rel="canonical" href="https://docs.agentkit.best/en/stable/x"/>' +
    '<meta name="robots" content="noindex, follow"/></head>';
  assert.deepEqual(extractPageMeta(html), {
    canonical: 'https://docs.agentkit.best/en/stable/x',
    robots: 'noindex, follow',
  });
});

test('extractPageMeta returns undefined fields when the tags are absent', () => {
  assert.deepEqual(extractPageMeta('<head></head>'), { canonical: undefined, robots: undefined });
});

test('urlForOutputHtml maps a leaf page.html to its route', () => {
  assert.equal(
    urlForOutputHtml('en/stable/getting-started/installation.html'),
    `${PRODUCTION_ORIGIN}/en/stable/getting-started/installation`,
  );
});

test('urlForOutputHtml maps a page/index.html the same as page.html', () => {
  assert.equal(
    urlForOutputHtml('en/stable/index.html'),
    urlForOutputHtml('en/stable.html'),
  );
});

test('validateHtmlAgainstSitemap flags a self-canonical indexable page missing from the sitemap', () => {
  const pages = [{ url: `${PRODUCTION_ORIGIN}/en/stable/x`, canonical: `${PRODUCTION_ORIGIN}/en/stable/x`, robots: undefined }];
  const errors = validateHtmlAgainstSitemap(pages, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing from sitemap\.xml/);
});

test('validateHtmlAgainstSitemap flags a noindex page that is listed in the sitemap', () => {
  const url = `${PRODUCTION_ORIGIN}/en/beta/x`;
  const pages = [{ url, canonical: url, robots: 'noindex, follow' }];
  const errors = validateHtmlAgainstSitemap(pages, [url]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /noindex but listed/);
});

test('validateHtmlAgainstSitemap flags a fallback page (canonicalized elsewhere) listed under its own URL', () => {
  const url = `${PRODUCTION_ORIGIN}/vi/stable/x`;
  const pages = [{ url, canonical: `${PRODUCTION_ORIGIN}/en/stable/x`, robots: undefined }];
  const errors = validateHtmlAgainstSitemap(pages, [url]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /canonicalized to/);
});

test('validateHtmlAgainstSitemap accepts a consistent indexable + fallback pair', () => {
  const enUrl = `${PRODUCTION_ORIGIN}/en/stable/x`;
  const viUrl = `${PRODUCTION_ORIGIN}/vi/stable/x`;
  const pages = [
    { url: enUrl, canonical: enUrl, robots: undefined },
    { url: viUrl, canonical: enUrl, robots: undefined },
  ];
  assert.deepEqual(validateHtmlAgainstSitemap(pages, [enUrl]), []);
});

test('validateHtmlAgainstSitemap ignores pages without a canonical tag', () => {
  assert.deepEqual(
    validateHtmlAgainstSitemap([{ url: `${PRODUCTION_ORIGIN}/en/404`, canonical: undefined, robots: undefined }], []),
    [],
  );
});
