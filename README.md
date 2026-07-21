# ak-docs

Official documentation site for the **AgentKit** (`ak`) CLI — [docs.agentkit.best](https://docs.agentkit.best) *(domain pending)*.

Built with [Fumadocs](https://fumadocs.dev) (Next.js, **static export**) and deployed to **Cloudflare Pages** ($0 hosting, no server runtime). The site tracks two release channels — **stable** and **beta** — and keeps the CLI reference in sync with released binaries via an automated pipeline. The design system reuses the real agentkit.best brand tokens (dark-first canvas, steel-blue accent, Instrument Serif + Geist).

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

## Deployment — Cloudflare Pages

Deployed via Cloudflare Pages **Git integration** (gives production + per-PR preview deploys for free). Console setup (not reproducible from code — recorded here):

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select this repo.
2. Build settings:
   - **Framework preset:** None
   - **Build command:** `pnpm build`
   - **Build output directory:** `out`
   - **Environment variable:** `NODE_VERSION = 22`
3. Enable **preview deployments** for pull requests (default on).
4. (Later, once the domain is confirmed) add the custom domain `docs.agentkit.best` + DNS.

`wrangler pages deploy out` is the documented fallback if the org later wants workflow-controlled deploys instead of Git integration.

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`: install (frozen lockfile) → typecheck → lint (MDX) → unit tests → generated-dir guard → build → internal link check → static-output assertion. Keep it green; all steps are deterministic and offline (the link check validates internal links only).

## Release sync pipeline

Docs stay in sync with `ak` releases via a deterministic pipeline (scripts + workflows) and a guardrailed LLM agent. Everything is validated against hand-built fixtures in `fixtures/`, so no `ak-cli` change is required to run it.

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

- `scripts/sync-release.mjs --bundle <dir|tar.gz> | --tag <vX.Y.Z-beta.N>` — beta ingestion: replace the generated pages in `content/docs/beta/reference/cli/` (preserving the human-owned `meta.json`/`meta.vi.json` nav), rewrite the `.generated` marker, write `release-notes.mdx`, update `channels.json.beta`. Idempotent (re-running a tag reproduces byte-identical output — `generatedAt` comes from the manifest, never the clock).
- `scripts/promote-docs.mjs --bundle <stable-bundle-dir>` — stable promotion: whole-copy the beta tree at tag `docs/{promotedFrom}` into `content/docs/stable/`, assert it is channel-neutral, update `channels.json.stable`. Emits a branch name; the workflow opens the PR (stable is never direct-committed).
- `scripts/check-generated.mjs --base <ref>` — CI guard: fails any hand edit to a `.generated`-marked dir's generated pages (ownership judged at the base ref, so bootstrapping a new generated dir is allowed; `meta*.json` nav is exempt); the sync bot (`GITHUB_ACTOR`) is exempt.
- `scripts/check-agent-pr.mjs --base <ref>` — agent-PR scope guard (modify-only, `content/docs/beta/{getting-started,guides}` prose).
- `scripts/check-links.mjs` — internal link checker over `out/`.

### Workflows

- `docs-sync.yml` (`repository_dispatch: release-docs`): beta → sync + commit `docs-sync: beta <tag>` + tag `docs/<tag>` + push (Pages deploys); stable → promotion PR labeled `docs-promotion`. Concurrency is queued per channel.
- `docs-agent.yml` (`workflow_run` after a green beta sync): the docs agent patches drifted beta prose via a PR only; beta-only + ≥1h rate limit. Runs under its own non-bypass identity so guards always apply. Disable it by deleting/disabling this one file — the sync pipeline is unaffected.
- `agent-guard.yml`: enforces agent-PR scope on the diff.

### Secrets, variables, and identities (set in the GitHub org/repo console)

| Name | Kind | Purpose |
| --- | --- | --- |
| `DOCS_BOT_APP_ID` / `DOCS_BOT_PRIVATE_KEY` | secret | **agentkit-docs-bot** GitHub App (contents:write + pull-requests:write on ak-docs only). Sole ruleset-bypass identity on `main`; sync commits/tags and promotion PRs use its short-lived token. |
| `DOCS_AGENT_APP_ID` / `DOCS_AGENT_PRIVATE_KEY` | secret | **agentkit-docs-agent** GitHub App for the docs agent. Same write scopes but **NOT** on the ruleset bypass list — so agent changes must always pass the PR guards + CODEOWNERS. Keep it off the bypass list. |
| `AK_CLI_READ_TOKEN` | secret | Fine-grained PAT, contents:read on the private `ak-cli` repo only, to download the release asset. Document a rotation owner. |
| `ANTHROPIC_API_KEY` | secret | Docs agent (Claude Code Action). |
| `AK_CLI_REPO` | variable | Source repo slug (default `bestagentkits/agentkit`). |

Branch protection / ruleset on `main`: required checks (CI build + guards), no direct pushes except the `agentkit-docs-bot` app (ruleset bypass list = that app only — **not** the agent app), review required via `.github/CODEOWNERS`. **Caveat:** enforced rulesets/CODEOWNERS on a **private** repo require a paid GitHub plan — verify the org tier; if unavailable, fall back to required status checks + review discipline and record the gap in `AGENTS.md`/`CODEOWNERS`.

### Runbook

- **Re-fire a sync manually:** re-send the dispatch (the same tag is idempotent):
  ```bash
  gh api repos/bestagentkits/agentkit-docs/dispatches -f event_type=release-docs \
    -F 'client_payload[channel]=beta' -F 'client_payload[tag]=v0.42.0-beta.7' -F 'client_payload[sha]=<sha>'
  ```
- **Recover a failed/half-applied sync:** the workflow stages everything and commits once, so a partial state is unusual; if it happens, revert the bad commit on `main` and re-dispatch the tag (idempotent).
- **Reviewing agent PRs:** confirm the diff is minimal and factual; the guard already proves it is modify-only beta prose. Release notes are semi-trusted (built from PR titles) — read on merits.
- **Local validation without ak-cli:** `node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta` and `node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable --beta-source content/docs/beta` (the `--beta-source` flag skips the git checkout).
