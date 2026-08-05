# Plan: Expose every docs page as a `.md` sibling URL (issue #29)

- Status: ready to cook
- Branch: `claude/agentkit-docs-issue-29-420b48`
- Mode: beta (ship → `dev` → staging.docs.agentkit.best)
- Route: feature
- Issue: https://github.com/bestagentkits/agentkit-docs/issues/29

## Outcome

Every rendered docs page is fetchable at the sibling URL `/{lang}/{docs-page-path}.md`
returning the same processed Markdown as the existing `llms.mdx/docs/.../content.md`
endpoint (via `getLLMText`), so LLMs/CLIs/humans can retrieve a page by appending `.md`.

## Design decision (why a post-build emitter, not a route)

Static export (`output: 'export'`) + Cloudflare Workers static assets. HTML docs pages
are a **catch-all page** `app/[lang]/(docs)/[...slug]/page.tsx` → pattern `/[lang]/[...slug]`.
A genuine sibling `.md` **route** would need a catch-all route handler resolving to the same
`/[lang]/[...slug]` pattern — Next.js rejects page+route (and route-group siblings) that resolve
to the same URL; route groups are URL-transparent; `output: 'export'` excludes
middleware/rewrites/headers config. So an in-Next sibling `.md` route is **impossible**.
(The only in-routing escape — codegenerating one literal `.../getting-started.md/route.ts` dir
per page — is strictly worse: hundreds of generated dirs regenerated on every content change.)

**Chosen (Design A'):** a post-build script mirrors the already-emitted
`out/{lang}/llms.mdx/docs/{...slug}/content.md` files to `out/{lang}/{...slug}.md`
(byte-identical copy). Reuses `getLLMText` transitively → guaranteed parity, no second MDX
compile, no fumadocs import in the script. Matches the repo's house style (post-build
`scripts/*.mjs` + fixture `*.test.mjs`, e.g. `promote-docs.mjs`, `check-static-assets.mjs`).

Rejected Design A (script importing `@/lib/source` to regenerate): heavier, TS-alias/MDX-runtime
in plain node, drift risk, no byte-parity guarantee.

## Acceptance criteria

- [ ] Every valid docs page (EN + VI, `stable`/`beta`, nested slugs) has a sibling `.md` in `out/`.
- [ ] Sibling `.md` bytes are identical to the page's `content.md` (same processed markdown + rewritten links).
- [ ] Content-Type `text/markdown; charset=utf-8` (via `public/_headers`; verify on staging).
- [ ] Invalid `.md` paths → normal 404 (natural: missing file → Cloudflare `not_found_handling = "404-page"`).
- [ ] HTML docs pages unchanged; `llms.mdx/docs/.../content.md` and `llms.txt` unchanged.
- [ ] Tests: EN/VI pages, nested slugs, absence (404-by-absence), link-rewrite passthrough.

## Implementation steps

1. `scripts/emit-markdown-siblings.mjs`
   - Walk `out/{lang}/llms.mdx/docs/**/content.md` for each `i18n.language`.
   - For each, dest = strip `llms.mdx/docs/` prefix + trailing `/content.md`, append `.md`
     → `out/{lang}/{...slug}.md`. Byte-copy.
   - **Guard zero-slug edge:** skip + warn if source is `out/{lang}/llms.mdx/docs/content.md`
     (would produce `out/{lang}.md`). Not expected (docs catch-all requires ≥1 slug).
   - **Fail non-zero if zero files emitted** (guards silent drift if the llms.mdx layout changes).
   - Reuse `scripts/lib/paths.mjs` `repoRoot`; `--out` arg like `check-static-assets.mjs`.

2. `package.json`: `build` → `next build && node scripts/emit-markdown-siblings.mjs`
   (so CI `pnpm build`, deploy:staging, deploy:production all run it identically).

3. `public/_headers`: rule setting `Content-Type: text/markdown; charset=utf-8` for `.md`.
   Verify the extension-glob pattern actually matches on Cloudflare Workers assets (staging curl).
   Fallback if glob unsupported: ship plain `text/markdown` (parity with existing content.md)
   and record the deviation — do NOT use a broad `/*` rule that would clobber HTML content-type.

4. `scripts/emit-markdown-siblings.test.mjs` (node --test): temp fake `out/` with EN + VI +
   nested `content.md` fixtures → run emitter → assert siblings byte-identical, non-content files
   untouched, no sibling for a path lacking `content.md`, zero-slug guard, zero-emit failure.

5. CI `.github/workflows/ci.yml` "Assert static output": add
   `test -f out/en/stable/getting-started/installation.md` +
   `test -f out/vi/stable/getting-started/installation.md`.

## Verification

- `pnpm typecheck`, `pnpm test` (new test + existing green), `pnpm build` locally →
  spot-check `out/en/stable/getting-started.md` == its `content.md`.
- `pnpm check:assets` (file-count budget still under limit after ~2x markdown files).
- Post-merge staging: curl `.md` for `charset=utf-8`, curl invalid `.md` for 404,
  curl existing `content.md`/`llms.txt` for backward-compat.

## Risks

- Charset/`_headers` glob is the only criterion not guaranteed on paper — verify on staging first.
- Layout coupling to `llms.mdx/docs` emit — mitigated by zero-emit failure + CI `test -f`.
- File-count ~doubles markdown assets — `check:assets` enforces the Cloudflare limit.
