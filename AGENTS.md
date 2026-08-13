# AGENTS.md

Guidance for AI agents and human contributors working in **ak-docs** — the docs
site for the AgentKit (`ak`) CLI. Built with Fumadocs (Next.js, static export)
and deployed to Cloudflare Workers (static assets via Wrangler).

This is a minimal starting point. Content-authoring rules, generated-directory
protection, and the docs-agent scope will be expanded here when the release-sync
pipeline and docs agent land.

## Dev commands

```bash
pnpm install
pnpm dev                # http://localhost:3000
pnpm build              # static export → ./out
pnpm typecheck
pnpm deploy:staging     # wrangler deploy --env staging (needs CF creds)
pnpm deploy:production  # wrangler deploy --env production
```

CI (`.github/workflows/ci.yml`) runs install → typecheck → build on every PR and
push to `main`/`dev`. Deploy: push `dev` → `staging.docs.agentkit.best`, push
`main` → `docs.agentkit.best` (see `wrangler.toml` + deploy workflows).
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
  root folders (`meta.json` `"root": true`) rendered as Sidebar Tabs. Within
  each channel, EN and VI must publish the same route shape. Across channels,
  Stable must remain a subset of Beta; Beta may add routes and prose ahead of
  the next promotion. Never mirror Beta-only content into `stable/` to satisfy
  parity checks — Stable changes only through the whole-copy promotion pipeline.
  The executable contract lives in `scripts/release-quality-shape.mjs`,
  `scripts/release-quality-metrics.mjs`, and the route tests.
- **Bilingual:** Fumadocs i18n (`lib/i18n.ts`), locales `en` (default) + `vi`,
  URL-prefixed (`/en`, `/vi`). Files use `.en.mdx` / `.vi.mdx`; nav labels use
  `meta.json` + `meta.vi.json`. A missing `.vi.mdx` falls back to English
  (`fallbackLanguage: 'en'`), so VI can land page-by-page without breaking the
  tree.   Cross-page links inside MDX should be **relative** (`./installation`,
  `../guides/updating`). The docs page resolves extensionless relatives via
  `createDocsRelativeLink` (retries `.mdx` / `/index.mdx`) so they localize to
  the current locale; a hardcoded `/en/...` link would strand readers of the
  other locale on a fallback page. The generated CLI reference and release-notes
  body are **English-only** — do not translate command syntax; VI nav labels
  live in `meta.vi.json` (CLI `pages` must mirror EN: `index`, `ak`, `...`).
  In Vietnamese product documentation, keep `Skill` in English for an AgentKit
  artifact or workflow (`các Skill`, never `Skills`); use `kỹ năng` only for a
  generic human or agent capability. Apply the same product-taxonomy treatment
  to `Kit`, `Agent`, and `Hook`.
- **Generated dirs are machine-owned:** any directory containing a `.generated`
  marker (currently `reference-derived/` for the CLI help dump) is written by
  the release-sync pipeline; do not hand-edit. Published CLI docs under
  `content/docs/<channel>/reference/cli/` are human-authored and nested to match
  site URLs. The co-located `meta.json` / `meta.vi.json` (localized nav labels)
  are human-owned.
- **`channels.json`** (repo root) holds the released version per channel
  (`null` until first sync). Read it null-safely; the beta banner and version
  display already do.

## Docs pipeline & agent governance

The docs are kept in sync with `ak` releases by a deterministic pipeline plus a
guardrailed LLM agent. Guardrails are enforced by CI on the diff, **not** by
prompt trust.

- **Authoring rules (humans and agents):**
  - Never hand-edit a generated dir (any dir with a `.generated` marker). Its
    generated pages are overwritten on the next sync and rejected by CI
    (`scripts/check-generated.mjs`). The co-located `meta.json` / `meta.vi.json`
    (localized nav labels) are human-owned — sync preserves them and the guard
    exempts them.
  - Prose lives in `getting-started/` and `guides/`. Keep command invocations
    minimal in prose and lean on the generated reference for exact syntax.
  - `stable/` changes **only** via a promotion PR (whole-copy from a beta docs
    tag). Never hand-edit `stable/` to fix something — fix `beta/`, it promotes.
  - Keep content channel-neutral: no `beta`/`stable` wording or `/docs/<channel>/`
    links baked into pages. Channel identity is path-keyed in the layout (the
    beta banner); promotion asserts nothing channel-specific survives the copy.
  - Style: factual, concise, second person; no internal repo paths, ADR/issue
    numbers, private URLs, or planning-phase references in published pages.
- **The docs agent** (`.github/workflows/docs-agent.yml`) runs after a beta
  docs-sync, compares release notes + the reference diff against existing guides,
  and opens a **PR-only**, minimal patch when a guide has gone stale — or skips
  when unsure. Its scope is enforced by `scripts/check-agent-pr.mjs`
  (`.github/workflows/agent-guard.yml`): modify-only, inside
  `content/docs/beta/{getting-started,guides}` prose, never generated dirs /
  reference / `stable/` / workflows / config. A human reviews every agent PR
  (CODEOWNERS on `content/docs/**`). The agent targets the `dev` integration
  branch and runs under its **own** identity (`agentkit-docs-agent`), which is
  deliberately **not** on the `dev` ruleset bypass list — so every agent change
  must pass the PR guards, even if the run is compromised. Disabling the agent is
  one file: delete/disable `docs-agent.yml`; the sync pipeline is unaffected.
  - **Reviewer note:** release notes are semi-trusted input (generated from PR
    titles). The agent has no write power beyond a guarded PR, but read agent PR
    diffs on their merits.
- **docs-bundle contract + secrets + runbook:** see the README pipeline section.
- **Workflow diagrams:** [`docs/README.md`](docs/README.md) (CLI reference layers, release sync, deploy, CI).

## Repo conventions

- Package manager: pnpm (see `packageManager` in `package.json`); Node ≥ 20.9.
- Commits: single-line, conventional (`type: imperative`). No internal
  plan/phase references in commit messages, PR titles, or code comments.
- `plans/` and `.claude/` are git-ignored (local working files).
