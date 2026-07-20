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
  this reference. Some values are still provisional (light-mode set, 6px radius,
  Vietnamese font) — expect tuning.
- **Rules:**
  - Use the existing `--color-fd-*` tokens or the brand blue accent
    (`#7cb9ea` dark / `#356a93` light). No new hex values in components.
  - **Dark-first**: dark is the default; light is a docs-only extension.
  - **Code blocks stay dark in both themes** (brand §3.3). Achieved via a single
    dark Shiki theme + `figure.shiki` token overrides in light mode — don't
    "fix" light-mode code to be light.
  - **Fonts:** Instrument Serif (EN `h1`/`h2` only, weight 400, never bold),
    Geist (body/UI + VI headings), Geist Mono (code/labels). VI headings swap off
    the serif via `:lang(vi)` because Instrument Serif is latin-only.
  - Any theme/token change must keep **axe-core color-contrast at 0 violations**
    in both modes. QA against `content/docs/_showcase.mdx` (unlisted page that
    exercises every component).

## Repo conventions

- Package manager: pnpm (see `packageManager` in `package.json`); Node ≥ 20.9.
- Commits: single-line, conventional (`type: imperative`). No internal
  plan/phase references in commit messages, PR titles, or code comments.
- `plans/` and `.claude/` are git-ignored (local working files).
