# SEO: sitemap.xml, robots.txt, static discovery support

- Issue: #61
- Branch: `claude/sleepy-babbage-mot7f8`
- Route: feature
- Mode: official (stable)
- Status: completed
- Advisory: reviewed by `kongming` before implementation; findings applied (see Decisions 1-2, Implementation)

## Outcome

`docs.agentkit.best` serves a deterministic `sitemap.xml` and `robots.txt`
generated at build time from the Fumadocs content source, plus correct
canonical/hreflang/OG metadata, so search engines can discover and index the
right pages without duplicate-content or fallback-content confusion.

## Decisions (resolving the issue's open questions)

1. **Canonical channel for search: `stable` only.** `beta` documents
   in-flight/unreleased behavior (CLAUDE.md: "Stable is machine-generated from
   an exact Beta snapshot"). Indexability is an explicit `channel === 'stable'`
   allowlist, not a `channel !== 'beta'` denylist — `beta` pages *and* any route
   outside both channels (the unlisted `_showcase` QA page) get
   `robots: noindex, follow` (stay crawlable/linkable, just not indexed) and
   are excluded from the sitemap. Blocking them in `robots.txt` instead would
   hide the `noindex` tag from crawlers (anti-pattern) — so they stay allowed,
   just not listed/indexed. (The initial implementation used the denylist form
   and missed `_showcase`; caught by `kongming`'s pre-implementation review and
   fixed before shipping.)
2. **Untranslated VI routes: locale URL stays live, self-canonicalizes to the
   English URL — no `noindex`.** No redirect (the page still renders via
   `fallbackLanguage`), no fabricated hreflang alternate, no sitemap entry.
   The initial draft also set `robots: noindex` on these pages; `kongming`'s
   review flagged that pairing `noindex` with a cross-page `canonical` is a
   contradictory signal (Google documents noindex + canonical-elsewhere as
   unreliable — the crawler that honors noindex never reaches the canonical
   hint, and the two directives argue past each other), so the fix is
   canonical-to-English alone. Fallback-locale detection is read from the
   content tree itself (`.vi.mdx` presence), reusing the exact
   native/shared-default/english-fallback/shared-fallback vocabulary already
   established in `scripts/release-quality-shape.mjs`
   (`RELEASE_SHAPE_BASELINE.reviewedVariants`) via a shared `lib/route-variant.mjs`
   module both consume, not a new classification. Today this affects 0 stable
   routes (VI coverage is ~complete) — the logic exists for when it inevitably
   drifts.
3. **OG image: reuse the existing dynamic `/[lang]/og/docs/[...slug]` route.**
   It's already wired into `getPageImage()` / per-page metadata and works
   under `output: 'export'` (pre-rendered via `generateStaticParams`). No new
   build-time image generation for v1.
4. **Deploy smoke check: in scope, extending the existing step.**
   `deploy-production.yml` / `deploy-staging.yml` already smoke-check the
   deployed site with a `curl` retry loop; `kongming`'s review pointed out this
   was a ~10-line extension rather than genuinely out of reach, so production
   now also asserts `/sitemap.xml` and `/robots.txt` return 200 with the right
   content-type and that `robots.txt` references the production sitemap, and
   staging asserts its deployed sitemap still points at the production origin
   (the sitemap intentionally hardcodes it — there is only ever one indexable
   sitemap).

## Implementation

- `lib/route-variant.mjs` (new) — the plain parsing rule (`parseVariant` /
  `resolveVariant`: a bare `route.mdx` is the locale-agnostic default,
  `route.en.mdx` / `route.vi.mdx` are overrides) shared verbatim between the
  Next app and pipeline scripts, matching the existing
  `lib/channel-route-href.mjs` / `docs-og-layout.mjs` / `search-index.mjs` /
  `cli-reference-routes.mjs` convention. `scripts/release-quality-shape.mjs`
  now imports it instead of keeping its own copy.
- `lib/route-variant.ts` (new) — classifies `(slug, locale)` as
  `native | shared-default | english-fallback | shared-fallback | null` by
  reading `content/docs/<channel>/**/*.mdx` directly (memoized per channel),
  built on the shared `route-variant.mjs` functions above.
- `lib/locale-path.ts` — `localeAlternates()` takes an optional locale
  allowlist (defaults to all) so fallback locales can be excluded from
  hreflang.
- `lib/metadata.ts` — `docsPageMetadata()` now also takes the resolved
  channel; `robots` is an explicit `channel === 'stable' ? undefined : noindex`
  allowlist (catches `_showcase`, not just `beta`); a fallback-locale page
  canonicalizes to the English URL without `noindex` (Decision 2); hreflang
  is restricted to locales with real content; OG/Twitter defaults added
  (siteName, type, locale, `summary_large_image`), with `base.title` /
  `base.description` null-coalesced since `openGraph`/`twitter` don't accept
  `null`.
- `app/[lang]/(docs)/[...slug]/page.tsx` — pass channel into
  `docsPageMetadata()`.
- `app/sitemap.ts` (new) — Next.js metadata route (`export const dynamic =
  'force-static'`, required under `output: 'export'`); enumerates
  `source.getPages('en')` filtered to the `stable` channel, one `<url>` per
  locale that has real content for that slug, with hreflang `alternates`
  (every real locale plus `x-default`, per Google's guidance), sorted by URL
  for deterministic output. No `lastmod` (no trustworthy per-page revision
  source without an expensive per-file git-log walk at build time — omitted
  per the issue's own instruction rather than guessed).
- `app/robots.ts` (new, `force-static`) — allow `/`, disallow only `/api/`.
  The initial draft also disallowed `/*/og/`, `/*/llms.mdx/`, `/*.md`, and
  `/*/_showcase`; `kongming`'s review flagged that blocking `/*/og/` breaks
  Twitter Card previews and blocking the Markdown mirrors defeats the
  AI-crawler-facing sibling-`.md` feature (issue #29) outright, and that
  `_showcase` only needed the noindex-meta fix (Decision 1), not a crawl
  block too — so the disallow list was cut to just `/api/`.
- `public/_headers` — the `.md` sibling rule (issue #29) now also sets
  `X-Robots-Tag: noindex`, so those endpoints stay crawlable (per the
  robots.txt fix above) but don't rank as duplicates of their HTML page.
- `app/[lang]/layout.tsx` — add a minimal, factual `WebSite` JSON-LD
  (name + url only — no `SearchAction`, since search is client-side and
  there's no navigable `?q=` URL to substantiate one).
- `scripts/check-seo-assets.mjs` (new) + `.test.mjs` — post-build CI check:
  `out/sitemap.xml` is well-formed XML, every `<loc>` uses
  `https://docs.agentkit.best`, none reference `beta` or `_showcase`, every
  `<loc>` path resolves to a real file in `out/`, and (per `kongming`'s
  review) a bidirectional cross-check against every rendered page's own
  `<link rel="canonical">` / `<meta name="robots">` tags — a self-canonical,
  non-noindex page must be in the sitemap and nothing else may be, catching a
  filter silently dropping pages or a stray page slipping in; `out/robots.txt`
  references the canonical sitemap URL and has no staging/localhost entries.
  Wired into `package.json` (`check:seo`) and `.github/workflows/ci.yml`.
- CI: add `test -f out/sitemap.xml` / `out/robots.txt` to the existing
  "Assert static output" step.
- `.github/workflows/deploy-production.yml` / `deploy-staging.yml` — extend
  the existing smoke-check step per Decision 4.

## Non-goals (matching the issue)

- No `SoftwareApplication`/`Organization` JSON-LD or breadcrumb structured
  data — page.tsx explicitly disables the Fumadocs breadcrumb component
  (`breadcrumb={{ enabled: false }}`) in favor of a one-line eyebrow label,
  so a `BreadcrumbList` claiming a rendered breadcrumb trail would not match
  visible content.
## Verification

- `pnpm typecheck`, `pnpm build`, inspect `out/sitemap.xml` / `out/robots.txt`
  by hand for a sample of stable/beta/en/vi/`_showcase` routes — confirmed
  810 sitemap URLs (405 stable routes × 2 locales), `_showcase` absent from
  the sitemap and `noindex` in its HTML, beta `noindex`, stable EN
  self-canonical with no `robots` meta.
- `pnpm check:seo`, `pnpm check:links`, `pnpm check:assets`,
  `pnpm check:quality` all green.
- `pnpm test` — 356/356 passing (new script tests included).
