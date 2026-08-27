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

`.github/workflows/ci.yml` runs on every PR and push to `main` / `dev`: install (frozen lockfile) → typecheck → lint (MDX) → unit tests → reference hygiene → generated-dir guard → reference-regeneration check (regenerate from `reference-raw/` + `reference-prose/`, assert no drift) → build → static-asset limits → internal link check → static-output assertion. The asset guard keeps every file within Cloudflare's 25 MiB limit, gives the search index a 22 MiB budget, and enforces the Paid Workers 100,000-file cap. Keep it green; all steps are deterministic and offline (the link check validates internal links only).

Deploy workflows run their own typecheck + build, then `wrangler deploy` — they do not wait on the CI workflow.

## Release maintenance (authoritative: manual local)

The authoritative operating model is **manual local evidence → local script → reviewed PR → staging → reviewed `dev` → `main` → production**. Do not treat GitHub `repository_dispatch` automation as the source of truth for this phase.

```
exact release evidence
  → local beta sync and/or stable promote (scripts below)
  → normal PR into dev
  → staging.docs.agentkit.best verification
  → reviewed dev → main PR
  → docs.agentkit.best (deploy-production.yml)
```

Diagrams and the full runbook: [`docs/workflows/release-and-deploy.md`](docs/workflows/release-and-deploy.md).

Before interpreting Stable/Beta tag differences or promoting to production,
verify the manifest/archive/sidecar matrix for every Kit and all six runtimes.
Compare archive hashes first. Complete equal matrices require exact Kit-doc
closure equality; divergence blocks `dev` → `main` until deterministic,
manifest/preimage-bound reconciliation. Do not use ordinary Stable hand edits or
whole-copy Beta when unrelated CLI evidence differs. Release handoffs report
Beta and Stable evidence and docs status separately.

The CLI reference is **two layers**: the _facts_ (usage, examples, flags, exit codes, related commands) are projected mechanically from `ak --help` — always exact, never drifting — while the _narrative_ (overview + when-to-use + notes) is reviewed prose in `reference-prose/<slug>.md`. The help dump under `reference-derived/` is **derived**; published CLI docs under `content/docs/<channel>/reference/cli/` are human-authored: `generateReference` = normalize(`reference-raw/<slug>.mdx` source + prose overlay). Because they are a pure function of committed sources, CI regenerates them and asserts a zero diff — so the reference can't silently drift or be hand-edited. See [`reference-prose/README.md`](reference-prose/README.md) for the authoring contract and [`docs/workflows/cli-reference-pipeline.md`](docs/workflows/cli-reference-pipeline.md) for diagrams.

### docs-bundle contract (v1)

A channel docs-bundle is a directory (or `docs-bundle.tar.gz`) with:

```
manifest.json      # { schemaVersion: 1, channel: "beta"|"stable", tag, sha,
                   #   version, generatedAt, promotedFrom? }  ← promotedFrom on stable only
reference/cli/     # generated MDX (frontmatter: title, description, generated: true)
release-notes.md   # channel-appropriate notes (required for both channels)
```

When upstream publishes the asset, treat its **manifest** as evidence and verify it against the exact release tag/SHA before applying. Fixtures under `fixtures/docs-bundle-{beta,stable}/` are enough to exercise the scripts without a live `ak-cli` checkout. All contract parsing/validation lives in `scripts/lib/manifest.mjs`.

### Scripts (plain Node, no build step; `pnpm test` covers them)

- `scripts/sync-release.mjs --bundle <dir|tar.gz> | --tag <vX.Y.Z-beta.N>` — **beta** ingestion: refresh `reference-raw/` from the bundle (hygiene-scrubbed: private-repo links → public support repo), derive `reference-derived/`, rewrite the `.generated` marker, write beta `release-notes.mdx` via the shared release-note renderer, update `channels.json.beta`. Idempotent (`generatedAt` comes from the manifest, never the clock).
- `scripts/compile-prose.mjs [--check] [--slug <name>] [--export-missing]` — render `reference-prose-json/<slug>.json` (LLM/agent wire format) → `reference-prose/<slug>.md`. `--check` fails when markdown drift from JSON; `--export-missing` bootstraps JSON from existing markdown.
- `scripts/generate-reference.mjs [--channel beta]` — regenerate the derived pages from `reference-raw/` + `reference-prose/` via `scripts/lib/normalize-reference.mjs` (raw `cobra/doc` → web-native MDX, prose overlay merged, shared boilerplate deduped to the `cli-conventions` page, `cli/index` compiled into a grouped TOC via `scripts/lib/reference-index.mjs`). Idempotent. CI runs it and asserts a zero diff to prove the reference is exactly `generator(source + overlays)`.
- `scripts/promote-docs.mjs --bundle <stable-bundle-dir> [--beta-ref <git-ref>]` — ordinary **stable** promotion after the Kit evidence/closure gate: whole-copy the **exact** beta docs snapshot for `manifest.promotedFrom` (default git tag `docs/{promotedFrom}`; override only with `--beta-ref` pointing at that same snapshot), **rewrite** `content/docs/stable/reference/release-notes.mdx` from the stable bundle's `release-notes.md` (shared renderer: stable channel + stable tag frontmatter + hygiene), assert channel-neutral prose, update `channels.json.stable` only. Beta is never mutated. Repeat runs are byte-identical. Open a normal PR; do not hand-edit `stable/`. An arbitrary `content/docs/beta` working tree is **not** sufficient evidence. `--beta-source` exists only for fixtures/tests and requires `--allow-unverified-beta-source`.
- `scripts/check-generated.mjs --base <ref>` — CI guard: fails any hand edit to a `.generated`-marked dir's generated pages (ownership judged at the base ref, so bootstrapping a new generated dir is allowed; `meta*.json` nav is exempt); the sync bot (`GITHUB_ACTOR`) is exempt. Dirs covered by the regenerate-and-diff reproducibility step (`REPRODUCIBLE_DIRS`, e.g. beta's reference) are exempt here — that check is stronger, so generator-change PRs need no bot bypass.
- `scripts/check-agent-pr.mjs --base <ref>` — agent-PR scope guard (modify-only, `content/docs/beta/{getting-started,guides}` prose).
- `scripts/check-links.mjs` — internal link checker over `out/`.

### Deploy workflows (still active)

- `deploy-staging.yml` / `deploy-production.yml`: push to `dev` / `main` → build static export → `wrangler deploy --env staging|production`.
- Production changes **only** via a reviewed `dev` → `main` PR.

### Legacy automation (non-authoritative)

These workflows exist in the repo but are **not** the operating authority for release maintenance:

- `docs-sync.yml` (`repository_dispatch: release-docs`) — historical automatic beta commit + stable promotion PR path. Prefer local `sync-release.mjs` / `promote-docs.mjs` + normal PRs. Do not rely on it for releases that lack a published `docs-bundle.tar.gz` asset. Whether to disable or remove it is a separate ops decision (not done by content/tooling PRs by default).
- `docs-agent.yml` / `agent-guard.yml` — optional post-sync prose agent; scope-guarded if used.

### Secrets, variables, and identities (set in the GitHub org/repo console)

| Name | Kind | Purpose |
| --- | --- | --- |
| `DOCS_BOT_APP_ID` / `DOCS_BOT_PRIVATE_KEY` | secret | **agentkit-docs-bot** GitHub App (contents:write + pull-requests:write on ak-docs only). Legacy ruleset-bypass identity on **`dev`** if automation is re-enabled. |
| `DOCS_AGENT_APP_ID` / `DOCS_AGENT_PRIVATE_KEY` | secret | **agentkit-docs-agent** GitHub App for the docs agent. Same write scopes but **NOT** on the ruleset bypass list — so agent changes must always pass the PR guards + CODEOWNERS. Keep it off the bypass list. |
| `AK_CLI_READ_TOKEN` | secret | Fine-grained PAT, contents:read on the private `ak-cli` repo only, to download release assets when validating evidence. Document a rotation owner. |
| `ANTHROPIC_API_KEY` | secret | Docs agent (Claude Code Action), if that workflow is used. |
| `AK_CLI_REPO` | variable | Source repo slug (default `bestagentkits/agentkit`). |
| `CLOUDFLARE_API_TOKEN` | secret | Wrangler deploy (Workers + custom domains on `agentkit.best`). |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Cloudflare account ID (`digitop.vn@gmail.com`). |

Branch protection / rulesets:

- **`dev`** (integration → staging): required checks (CI build + guards); human PRs always pass the guards. Bot bypass (if any) is only for legacy automation identities.
- **`main`** (production): required checks + review via `.github/CODEOWNERS`; **no** direct push — production is updated only by a reviewed `dev` → `main` promotion.

**Caveat:** enforced rulesets/CODEOWNERS on a **private** repo require a paid GitHub plan — verify the org tier; if unavailable, fall back to required status checks + review discipline and record the gap in `AGENTS.md`/`CODEOWNERS`.

### Runbook (manual)

1. **Collect exact evidence** for the release: channel, tag, product SHA, `promotedFrom` (stable only), and a docs-bundle directory (or construct one from the contract when upstream did not attach `docs-bundle.tar.gz`).
2. **Beta sync (when needed):** on a working branch from `dev`:
   ```bash
   node scripts/sync-release.mjs --bundle path/to/docs-bundle-beta
   pnpm test
   ```
   Open a normal PR into `dev`. After merge, confirm staging.
3. **Stable promote:** first verify the target Stable release against its exact
   `promotedFrom` Beta, then verify the resulting current Stable and Beta Kit
   artifact matrices for `claude-code`, `codex`, `cursor`, `grok`, `omp`, and `pi`, including every
   manifest and `.sha256` sidecar. Compare archive hashes before tags. Different
   artifacts use the normal release audit; equal artifacts require exact Kit-doc
   closure equality. If equal artifacts have divergent docs, block production
   and use only deterministic manifest/preimage-bound reconciliation. Do not
   whole-copy unrelated Beta CLI evidence. Once the gate passes, ensure the exact
   docs snapshot for `manifest.promotedFrom` exists as a git ref (normally tag
   `docs/{promotedFrom}`). Then:
   ```bash
   # Binds docs/{promotedFrom} automatically — fails closed if the ref is missing.
   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable
   # Optional: name the exact snapshot ref explicitly (must still be that promotedFrom tree):
   node scripts/promote-docs.mjs --bundle path/to/docs-bundle-stable --beta-ref docs/v2.8.0-beta.14
   pnpm test
   ```
   Do **not** promote from the current `content/docs/beta` working tree as evidence. Review that `content/docs/stable/reference/release-notes.mdx` says the **stable** channel and stable tag (never leftover beta metadata), that Beta is unchanged, and that `channels.json.stable` matches the manifest. Open a normal PR into `dev`.
4. **Staging → production:** once staging looks right, open a reviewed `dev` → `main` PR; merging triggers `deploy-production.yml`. This is the only way prod changes.
5. **Local validation without a live product checkout** (fixture shape only; not a real promote):
   ```bash
   node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta
   node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable \
     --beta-source content/docs/beta --allow-unverified-beta-source
   ```
