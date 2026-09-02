# SEO indexing policy

`docs.agentkit.best` publishes a build-time `sitemap.xml` and `robots.txt`
(`app/sitemap.ts`, `app/robots.ts`). This records the indexing decisions
behind them, so a future change doesn't silently drift from what was
reviewed (issue #61).

## Canonical channel: `stable` only

`beta` documents in-flight, unreleased behavior; `stable` is a reviewed
snapshot of it (see the root `CLAUDE.md`). Indexability
(`lib/metadata.ts`) is an explicit **allowlist** — `channel === 'stable'` —
not a `channel !== 'beta'` denylist, so it also catches routes outside both
channels (the unlisted `_showcase` QA page). Any non-`stable` page:

- carries `<meta name="robots" content="noindex, follow">`;
- is **not** listed in `sitemap.xml` (`app/sitemap.ts`);
- is **not** blocked in `robots.txt` — blocking it there would hide the
  `noindex` tag from crawlers instead of just keeping it out of the index,
  and these pages still need to be reachable from in-page links (beta docs
  from the beta banner; `_showcase` from its own direct links).

## Locale fallback: untranslated VI stays live, canonical → EN, no `noindex`

A VI route with no `.vi.mdx` file silently renders the English body via
`fallbackLanguage` (`lib/i18n.ts`) — the page still exists at its `/vi/...`
URL, it just isn't a distinct translation. For that page:

- `alternates.canonical` points at the English URL for the same slug, not
  the VI URL;
- it does **not** get an hreflang entry (neither as source nor as target —
  `lib/route-variant.ts` excludes it from `contentLocales()`);
- it is **not** listed in `sitemap.xml`.

It is deliberately **not** `noindex`: pairing `noindex` with a cross-page
`canonical` is a contradictory signal (a crawler that honors `noindex` never
gets far enough to read the canonical hint pointing elsewhere, and the two
directives argue past each other; Google documents this combination as
unreliable). Canonical-to-English alone is the correct way to say "this URL
and that one are the same content" without also telling the crawler not to
look at either.

The English/Vietnamese file distinction is read straight from
`content/docs/<channel>/**/*.mdx` (`lib/route-variant.ts`), reusing the exact
`native` / `shared-default` / `english-fallback` / `shared-fallback`
vocabulary already reviewed in `scripts/release-quality-shape.mjs`
(`RELEASE_SHAPE_BASELINE.reviewedVariants`) via a shared `lib/route-variant.mjs`
module both files import, rather than maintaining two copies of the same
parsing rule. As of this writing every stable route has real VI content
except the unlisted `_showcase` QA page (already excluded by the channel
filter), so this currently has no visible effect — it exists for when a new
EN page ships ahead of its VI translation.

## `robots.txt`: crawl everything, gate indexing with `noindex` instead

`robots.txt` disallows only `/api/` (the search index endpoint). It does
**not** block the per-page OG image route (`/*/og/`), the raw `llms.mdx`
source, or the sibling `.md` mirrors (issue #29) — blocking any of those
would stop crawlers from ever fetching them, which breaks Twitter Card
previews and defeats the AI-crawler-facing Markdown endpoints outright. The
`.md` mirrors instead carry `X-Robots-Tag: noindex` (`public/_headers`): still
crawlable, just not indexed as duplicates of their HTML page.

## Not covered here

- **Social image generation** — pages reuse the existing dynamic
  `/[lang]/og/docs/[...slug]` route (pre-rendered at build time via
  `generateStaticParams`, already wired through `getPageImage()`). No new
  build-time image pipeline was added.
- **Structured data** — only a minimal, factual `WebSite` JSON-LD
  (`app/[lang]/layout.tsx`: name + url, no `SearchAction`, since search is a
  client-side modal with no navigable `?q=` URL). No `Organization`,
  `SoftwareApplication`, or breadcrumb schema: the docs pages render a
  one-line "eyebrow" section label instead of a breadcrumb trail
  (`breadcrumb={{ enabled: false }}` in
  `app/[lang]/(docs)/[...slug]/page.tsx`), so `BreadcrumbList` schema would
  claim a UI element that isn't there.

## Post-deploy smoke check

`deploy-production.yml` asserts `/sitemap.xml` and `/robots.txt` return 200
with the expected content-type and that `robots.txt` references the
production sitemap; `deploy-staging.yml` asserts the staging-deployed
sitemap still points at the production origin (`app/sitemap.ts` hardcodes
it — there is only ever one indexable sitemap, so staging must serve it
verbatim rather than a staging-origin copy a crawler that reaches it could
be misled by).
