# AGENTS.md

Guidance for AI agents and human contributors working in **ak-docs** — the docs
site for the AgentKit (`ak`) CLI. Built with Fumadocs (Next.js, static export)
and deployed to Cloudflare Pages.

This is a minimal starting point. Content-authoring rules, generated-directory
protection, and the docs-agent scope will be expanded here when the release-sync
pipeline and docs agent land.

## Dev commands

```bash
pnpm install
pnpm dev         # http://localhost:3000
pnpm build       # static export → ./out
pnpm typecheck
```

CI (`.github/workflows/ci.yml`) runs install → typecheck → build on every PR.
Keep the build a pure static export — no server-only routes, no dynamic runtime.

## Design system — read before touching any styling

The theme reuses the **real agentkit.best brand**, so docs stay visually
continuous with the marketing site. Do **not** invent colours, fonts, or radii.

- **Single source of truth:** `app/global.css` (Fumadocs `--color-fd-*` token
  overrides) + `source.config.ts` (code theme). Fonts are wired in
  `app/layout.tsx`.
- **Provenance:** tokens are copied from `ak-web` — `docs/design-guidelines.md`
  (commit `8fa1cf9`, 2026-07-15) and `app/globals.css`. They are a point-in-time
  copy, **not** synced; if the brand evolves, update here deliberately and bump
  this reference. Some values are still provisional (light-mode set, 6px radius)
  — expect tuning.
- **Rules:**
  - Use the existing `--color-fd-*` tokens or the brand blue accent
    (`#7cb9ea` dark / `#356a93` light). No new hex values in components.
  - **Dark-first**: dark is the default; light is a docs-only extension.
  - **Code blocks stay dark in both themes** (brand §3.3). Achieved via a single
    dark Shiki theme + `figure.shiki` token overrides in light mode — don't
    "fix" light-mode code to be light.
  - **Fonts:** Geist for everything — body, UI, and headings in both EN and VI
    (semibold) — plus Geist Mono for code and the mono-uppercase-blue eyebrow /
    sidebar group labels. Headings are all-sans so the two locales look
    identical; a serif would only work for EN (Vietnamese diacritics force
    sans). Self-hosted via the `geist` npm package (`next/font/local`), **not**
    `next/font/google`: Google's Geist exposes only latin / latin-ext, which omit
    the Latin Extended Additional block (U+1EA0–1EF9) carrying most Vietnamese
    tone-marked letters. The bundled woff2 covers the full Vietnamese letterset.
  - Any theme/token change must keep **axe-core color-contrast at 0 violations**
    in both modes. QA against `content/docs/_showcase.mdx` (unlisted page that
    exercises every component).

## Content structure

- **Two channels:** `content/docs/stable/` and `content/docs/beta/` are Fumadocs
  root folders (`meta.json` `"root": true`) rendered as Sidebar Tabs. Their page
  trees must stay **identical in shape** — promotion is a whole-copy, so any
  asymmetry breaks it. Content is equal at launch and diverges only when the
  release-sync pipeline writes into a channel.
- **Bilingual:** Fumadocs i18n (`lib/i18n.ts`), locales `en` (default) + `vi`,
  URL-prefixed (`/en`, `/vi`). Files use `.en.mdx` / `.vi.mdx`; nav labels use
  `meta.json` + `meta.vi.json`. A missing `.vi.mdx` falls back to English
  (`fallbackLanguage: 'en'`), so VI can land page-by-page without breaking the
  tree. Cross-page links inside MDX should be **relative** (`./installation`,
  `../guides/updating`) so `createRelativeLink` localizes them to the current
  locale; a hardcoded `/en/...` link would strand readers of the other locale on
  a fallback page. The generated CLI reference is **English-only** — do not
  translate command syntax.
- **Generated dirs are machine-owned:** any directory containing a `.generated`
  marker (currently `…/reference/cli/`) is written by the release-sync pipeline;
  do not hand-edit. Placeholder pages carry `generated: true` frontmatter.
- **`channels.json`** (repo root) holds the released version per channel
  (`null` until first sync). Read it null-safely; the beta banner and version
  display already do.

## Repo conventions

- Package manager: pnpm (see `packageManager` in `package.json`); Node ≥ 20.9.
- Commits: single-line, conventional (`type: imperative`). No internal
  plan/phase references in commit messages, PR titles, or code comments.
- `plans/` and `.claude/` are git-ignored (local working files).
