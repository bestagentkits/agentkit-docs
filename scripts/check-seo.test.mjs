import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SITE_ORIGIN,
  checkSitemapXml,
  checkRobotsTxt,
  checkHeadersNoindex,
  checkPageMetadata,
  extractLocs,
} from './check-seo.mjs';

function sitemapWithLocs(locs) {
  const body = locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${body}</urlset>`;
}

function manyValidLocs(count) {
  return Array.from({ length: count }, (_, i) => `${SITE_ORIGIN}/en/stable/page-${i}`);
}

test('extractLocs pulls every <loc> out of a sitemap body', () => {
  const xml = sitemapWithLocs([`${SITE_ORIGIN}/en/stable`, `${SITE_ORIGIN}/vi/stable`]);
  assert.deepEqual(extractLocs(xml), [`${SITE_ORIGIN}/en/stable`, `${SITE_ORIGIN}/vi/stable`]);
});

test('checkSitemapXml passes a well-formed sitemap above the entry floor', () => {
  const xml = sitemapWithLocs(manyValidLocs(1200));
  assert.deepEqual(checkSitemapXml(xml), []);
});

test('checkSitemapXml fails when the entry count is below the floor', () => {
  const xml = sitemapWithLocs(manyValidLocs(5));
  const errors = checkSitemapXml(xml);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /only 5 <loc> entries/);
});

test('checkSitemapXml fails on a non-production origin', () => {
  const xml = sitemapWithLocs([...manyValidLocs(1200), 'http://localhost:3000/broken']);
  const errors = checkSitemapXml(xml);
  assert.ok(errors.some((e) => e.includes('localhost:3000/broken')));
});

test('checkSitemapXml fails on an excluded .md sibling URL', () => {
  const xml = sitemapWithLocs([...manyValidLocs(1200), `${SITE_ORIGIN}/en/stable/page.md`]);
  const errors = checkSitemapXml(xml);
  assert.ok(errors.some((e) => e.includes('excluded route') && e.includes('page.md')));
});

test('checkSitemapXml fails on the /api, /{lang}/og, /{lang}/llms route families', () => {
  for (const excluded of [`${SITE_ORIGIN}/api/search`, `${SITE_ORIGIN}/en/og/docs/stable/image.png`, `${SITE_ORIGIN}/en/llms.txt`]) {
    const errors = checkSitemapXml(sitemapWithLocs([...manyValidLocs(1200), excluded]));
    assert.ok(errors.some((e) => e.includes(excluded)), `expected ${excluded} to be flagged`);
  }
});

test('checkSitemapXml does not flag a real page whose path merely contains "api"', () => {
  const xml = sitemapWithLocs([...manyValidLocs(1200), `${SITE_ORIGIN}/en/stable/reference/cli/api/start`]);
  assert.deepEqual(checkSitemapXml(xml), []);
});

test('checkSitemapXml fails on a <lastmod> entry', () => {
  const xml = sitemapWithLocs(manyValidLocs(1200)).replace(
    '</urlset>',
    `<url><loc>${SITE_ORIGIN}/en/stable</loc><lastmod>2026-01-01</lastmod></url></urlset>`,
  );
  const errors = checkSitemapXml(xml);
  assert.ok(errors.some((e) => e.includes('<lastmod>')));
});

test('checkRobotsTxt passes when the Sitemap line is present', () => {
  assert.deepEqual(
    checkRobotsTxt(`User-Agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml`),
    [],
  );
});

test('checkRobotsTxt fails when the Sitemap line is missing', () => {
  const errors = checkRobotsTxt('User-Agent: *\nAllow: /');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Sitemap:/);
});

test('checkHeadersNoindex passes when the /*.md block carries the header', () => {
  const headers = '/*.md\n  Content-Type: text/markdown; charset=utf-8\n  X-Robots-Tag: noindex\n';
  assert.deepEqual(checkHeadersNoindex(headers), []);
});

test('checkHeadersNoindex fails when the noindex header is missing', () => {
  const headers = '/*.md\n  Content-Type: text/markdown; charset=utf-8\n';
  const errors = checkHeadersNoindex(headers);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /noindex/);
});

test('checkHeadersNoindex fails when there is no /*.md rule at all', () => {
  const errors = checkHeadersNoindex('/*.js\n  Cache-Control: max-age=3600\n');
  assert.equal(errors.length, 1);
});

const VALID_PAGE_HTML = `
<meta name="twitter:card" content="summary_large_image"/>
<script type="application/ld+json">{"@type":"WebSite","name":"AgentKit Docs"}</script>
<script type="application/ld+json">{"@type":"Organization","name":"AgentKit"}</script>
`;

test('checkPageMetadata passes a page with Twitter Card + both JSON-LD types', () => {
  assert.deepEqual(checkPageMetadata(VALID_PAGE_HTML, 'fixture.html'), []);
});

test('checkPageMetadata fails when the twitter:card meta tag is missing', () => {
  const html = VALID_PAGE_HTML.replace(/<meta name="twitter:card"[^>]*>\n/, '');
  const errors = checkPageMetadata(html, 'fixture.html');
  assert.ok(errors.some((e) => e.includes('twitter:card')));
});

test('checkPageMetadata fails when a JSON-LD type is missing', () => {
  const html = VALID_PAGE_HTML.replace(
    '<script type="application/ld+json">{"@type":"Organization","name":"AgentKit"}</script>',
    '',
  );
  const errors = checkPageMetadata(html, 'fixture.html');
  assert.ok(errors.some((e) => e.includes('Organization')));
});

test('checkPageMetadata fails on a raw angle bracket inside a JSON-LD body (escaping helper did not run)', () => {
  const html = VALID_PAGE_HTML.replace(
    '{"@type":"WebSite","name":"AgentKit Docs"}',
    '{"@type":"<script>alert(1)</script>","name":"AgentKit Docs"}',
  );
  const errors = checkPageMetadata(html, 'fixture.html');
  assert.ok(errors.some((e) => e.includes('raw "<" or ">"')));
});
