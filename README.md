# ak-docs

Official documentation site for the **AgentKit** (`ak`) CLI — [docs.agentkit.best](https://docs.agentkit.best).

Built with [Fumadocs](https://fumadocs.dev) (Next.js, **static export**) and deployed to **Cloudflare Workers** (static assets, no server runtime). The site tracks two release channels — **stable** and **beta** — and keeps the CLI reference in sync with released binaries via an automated pipeline. The design system reuses the real agentkit.best brand tokens (dark-first canvas, steel-blue accent, Instrument Serif + Geist).

## Local development

```bash
pnpm install
pnpm dev            # dev server at http://localhost:3000
pnpm build          # static export → ./out
pnpm typecheck      # fumadocs-mdx + next typegen + tsc --noEmit
npx serve out       # serve the static build locally
```

Requires Node ≥ 20.9 (see `.nvmrc` → 22) and pnpm (see `packageManager` in `package.json`).

## Project layout

```
app/            Next.js App Router — docs layout, home, static route handlers
content/docs/   MDX content (channel/locale structure added in a later phase)
lib/            Fumadocs source adapter + shared layout config
components/     MDX components, search dialog, providers
next.config.mjs output: 'export' (static), images unoptimized, turbopack root pinned
source.config.ts  fumadocs-mdx collections + frontmatter schema
```

The build is 100% static: `pnpm build` emits `out/` with no `.next/server` runtime.
Client-side search uses a build-time Orama index (`/api/search` prerenders to a static asset).

## Deployment — Cloudflare Workers

Static export (`pnpm build` → `out/`) is deployed as a **Workers static assets** Worker via [Wrangler](https://developers.cloudflare.com/workers/wrangler/). Zone `agentkit.best` is already on Cloudflare DNS (account `digitop.vn@gmail.com`); custom domains are attached with `custom_domain = true` in `wrangler.toml` (no manual DNS CNAME required).

| Branch | Workflow | Worker | Domain |
| --- | --- | --- | --- |
| `dev` | `.github/workflows/deploy-staging.yml` | `agentkit-docs-staging` | https://staging.docs.agentkit.best |
| `main` | `.github/workflows/deploy-production.yml` | `agentkit-docs` | https://docs.agentkit.best |

### Repo secrets (required)

Set once in GitHub → Settings → Secrets and variables → Actions (same Cloudflare account as `agentkit-web`):

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts:Edit**, **Workers Routes:Edit**, **Account:Read**, **Zone:Read** (and ability to manage custom domains on `agentkit.best`) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for `digitop.vn@gmail.com` |

GitHub Environments `staging` and `production` are referenced by the deploy workflows (optional protection rules / deployment URLs).

### Local deploy

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm deploy:staging     # build + wrangler deploy --env staging
pnpm deploy:production  # build + wrangler deploy --env production
```

Locale root redirects live in `public/_redirects` (copied into `out/`; Workers static assets honor the file).

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main` / `dev`: install (frozen lockfile) → typecheck → lint (MDX) → unit tests → reference hygiene → generated-dir guard → reference-regeneration check (regenerate from `reference-raw/` + `reference-prose/`, assert no drift) → build → internal link check → static-output assertion. Keep it green; all steps are deterministic and offline (the link check validates internal links only).

Deploy workflows run their own typecheck + build, then `wrangler deploy` — they do not wait on the CI workflow.

## Release sync pipeline

Docs stay in sync with `ak` releases via a deterministic pipeline (scripts + workflows) and a guardrailed LLM agent. Everything is validated against hand-built fixtures in `fixtures/`, so no `ak-cli` change is required to run it.

The CLI reference is **two layers**: the _facts_ (usage, examples, flags, exit codes, related commands) are projected mechanically from `ak --help` — always exact, never drifting — while the _narrative_ (overview + when-to-use + notes) is reviewed prose in `reference-prose/<slug>.md`. The published pages under `content/docs/beta/reference/cli/` are **derived**: `generateReference` = normalize(`reference-raw/<slug>.mdx` source + prose overlay). Because they are a pure function of committed sources, CI regenerates them and asserts a zero diff — so the reference can't silently drift or be hand-edited. See [`reference-prose/README.md`](reference-prose/README.md) for the authoring contract and [`docs/workflows/cli-reference-pipeline.md`](docs/workflows/cli-reference-pipeline.md) for diagrams.

### docs-bundle contract (v1)

`ak-cli`'s release job publishes `docs-bundle.tar.gz` as a release asset and fires a `repository_dispatch` (`event_type: release-docs`, `client_payload: { channel, tag, sha }`) at this repo. The payload is only a trigger — the workflow re-downloads the asset and trusts its **manifest**, not the payload.

```
manifest.json      # { schemaVersion: 1, channel: "beta"|"stable", tag, sha,
                   #   version, generatedAt, promotedFrom? }  ← promotedFrom on stable only
reference/cli/     # generated MDX (frontmatter: title, description, generated: true)
release-notes.md   # channel-appropriate notes
```

All contract parsing/validation lives in `scripts/lib/manifest.mjs` (`schemaVersion` gates future changes to one module + the fixtures).

### Scripts (plain Node, no build step; `pnpm test` covers them)

- `scripts/sync-release.mjs --bundle <dir|tar.gz> | --tag <vX.Y.Z-beta.N>` — beta ingestion: refresh the raw source in `reference-raw/` from the bundle (hygiene-scrubbed: private-repo links → public support repo), then derive `content/docs/beta/reference/cli/` from it + prose overlays (preserving the human-owned `meta.json`/`meta.vi.json` nav), rewrite the `.generated` marker, write `release-notes.mdx`, update `channels.json.beta`. Idempotent (re-running a tag reproduces byte-identical output — `generatedAt` comes from the manifest, never the clock).
- `scripts/compile-prose.mjs [--check] [--slug <name>] [--export-missing]` — render `reference-prose-json/<slug>.json` (LLM/agent wire format) → `reference-prose/<slug>.md`. `--check` fails when markdown drift from JSON; `--export-missing` bootstraps JSON from existing markdown.
- `scripts/generate-reference.mjs [--channel beta]` — regenerate the derived pages from `reference-raw/` + `reference-prose/` via `scripts/lib/normalize-reference.mjs` (raw `cobra/doc` → web-native MDX, prose overlay merged). Idempotent. CI runs it and asserts a zero diff to prove the reference is exactly `generator(source + overlays)`.
- `scripts/promote-docs.mjs --bundle <stable-bundle-dir>` — stable promotion: whole-copy the beta tree at tag `docs/{promotedFrom}` into `content/docs/stable/`, assert it is channel-neutral, update `channels.json.stable`. Emits a branch name; the workflow opens the PR (stable is never direct-committed).
- `scripts/check-generated.mjs --base <ref>` — CI guard: fails any hand edit to a `.generated`-marked dir's generated pages (ownership judged at the base ref, so bootstrapping a new generated dir is allowed; `meta*.json` nav is exempt); the sync bot (`GITHUB_ACTOR`) is exempt. Dirs covered by the regenerate-and-diff reproducibility step (`REPRODUCIBLE_DIRS`, e.g. beta's reference) are exempt here — that check is stronger, so generator-change PRs need no bot bypass.
- `scripts/check-agent-pr.mjs --base <ref>` — agent-PR scope guard (modify-only, `content/docs/beta/{getting-started,guides}` prose).
- `scripts/check-links.mjs` — internal link checker over `out/`.

### Workflows

- `docs-sync.yml` (`repository_dispatch: release-docs`): beta → sync + commit `docs-sync: beta <tag>` + tag `docs/<tag>` + push to **`dev`** (deploys to staging); stable → promotion PR **into `dev`** labeled `docs-promotion`. Concurrency is queued per channel. Everything lands on `dev` (staging) first; a `dev` → `main` merge promotes it to production. Diagrams: [`docs/workflows/release-and-deploy.md`](docs/workflows/release-and-deploy.md).
- `deploy-staging.yml` / `deploy-production.yml`: push to `dev` / `main` → build static export → `wrangler deploy --env staging|production`.
- `docs-agent.yml` (`workflow_run` after a green beta sync): the docs agent patches drifted beta prose via a PR only; beta-only + ≥1h rate limit. Runs under its own non-bypass identity so guards always apply. Disable it by deleting/disabling this one file — the sync pipeline is unaffected.
- `agent-guard.yml`: enforces agent-PR scope on the diff.

### Secrets, variables, and identities (set in the GitHub org/repo console)

| Name | Kind | Purpose |
| --- | --- | --- |
| `DOCS_BOT_APP_ID` / `DOCS_BOT_PRIVATE_KEY` | secret | **agentkit-docs-bot** GitHub App (contents:write + pull-requests:write on ak-docs only). Ruleset-bypass identity on **`dev`** (where the sync bot pushes commits + tags); promotion PRs use its short-lived token too. |
| `DOCS_AGENT_APP_ID` / `DOCS_AGENT_PRIVATE_KEY` | secret | **agentkit-docs-agent** GitHub App for the docs agent. Same write scopes but **NOT** on the ruleset bypass list — so agent changes must always pass the PR guards + CODEOWNERS. Keep it off the bypass list. |
| `AK_CLI_READ_TOKEN` | secret | Fine-grained PAT, contents:read on the private `ak-cli` repo only, to download the release asset. Document a rotation owner. |
| `ANTHROPIC_API_KEY` | secret | Docs agent (Claude Code Action). |
| `AK_CLI_REPO` | variable | Source repo slug (default `bestagentkits/agentkit`). |
| `CLOUDFLARE_API_TOKEN` | secret | Wrangler deploy (Workers + custom domains on `agentkit.best`). |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Cloudflare account ID (`digitop.vn@gmail.com`). |

Branch protection / rulesets:

- **`dev`** (integration → staging): required checks (CI build + guards); direct push allowed only for the `agentkit-docs-bot` app (bypass list = that app only — **not** the agent app), so the beta sync can commit while agent/human PRs still pass the guards.
- **`main`** (production): required checks + review via `.github/CODEOWNERS`; **no** direct push, no bot bypass — production is updated only by a reviewed `dev` → `main` promotion.

**Caveat:** enforced rulesets/CODEOWNERS on a **private** repo require a paid GitHub plan — verify the org tier; if unavailable, fall back to required status checks + review discipline and record the gap in `AGENTS.md`/`CODEOWNERS`.

### Runbook

- **Re-fire a sync manually:** re-send the dispatch (the same tag is idempotent):
  ```bash
  gh api repos/bestagentkits/agentkit-docs/dispatches -f event_type=release-docs \
    -F 'client_payload[channel]=beta' -F 'client_payload[tag]=v0.42.0-beta.7' -F 'client_payload[sha]=<sha>'
  ```
- **Promote staging → production:** open a `dev` → `main` PR (or fast-forward merge) once staging looks right; merging it triggers `deploy-production.yml`. This is the only way prod changes.
- **Recover a failed/half-applied sync:** the workflow stages everything and commits once, so a partial state is unusual; if it happens, revert the bad commit on `dev` and re-dispatch the tag (idempotent).
- **Reviewing agent PRs:** confirm the diff is minimal and factual; the guard already proves it is modify-only beta prose. Release notes are semi-trusted (built from PR titles) — read on merits.
- **Local validation without ak-cli:** `node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta` and `node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable --beta-source content/docs/beta` (the `--beta-source` flag skips the git checkout).
