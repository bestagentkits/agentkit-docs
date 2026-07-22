# Release sync & deploy

How `ak-docs` stays aligned with `ak-cli` releases and reaches staging/production.

## End-to-end overview

```mermaid
flowchart TB
  subgraph akcli["ak-cli"]
    REL["Release job"]
    BUNDLE["docs-bundle.tar.gz<br/>manifest + reference/cli + release-notes"]
    DISP["repository_dispatch<br/>release-docs"]
  end

  subgraph akdocs["ak-docs"]
    SYNC["docs-sync.yml"]
    RAW["reference-raw/"]
    PROSE["reference-prose/"]
    BETA["content/docs/beta/"]
    DEV["dev branch"]
    MAIN["main branch"]
  end

  subgraph cf["Cloudflare"]
    STG["staging.docs.agentkit.best"]
    PROD["docs.agentkit.best"]
  end

  REL --> BUNDLE --> DISP --> SYNC
  SYNC --> RAW
  SYNC --> BETA
  RAW --> PROSE
  PROSE --> BETA
  SYNC --> DEV
  DEV -->|deploy-staging.yml| STG
  DEV -->|PR merge| MAIN
  MAIN -->|deploy-production.yml| PROD
```

## Beta docs sync (per release)

```mermaid
sequenceDiagram
  participant CLI as ak-cli release
  participant GH as GitHub
  participant WF as docs-sync.yml
  participant BOT as agentkit-docs-bot
  participant REPO as ak-docs dev

  CLI->>GH: Upload docs-bundle.tar.gz
  CLI->>GH: repository_dispatch release-docs
  GH->>WF: channel=beta, tag, sha
  WF->>GH: Download bundle (manifest is source of truth)
  WF->>REPO: sync-release.mjs
  Note over REPO: reference-raw/ ← bundle reference/cli<br/>generate-reference ← raw + prose<br/>release-notes.mdx, channels.json
  BOT->>REPO: Commit docs-sync: beta &lt;tag&gt;
  BOT->>REPO: Tag docs/&lt;tag&gt;
  Note over REPO: deploy-staging.yml → staging site
```

### docs-bundle contract (v1)

```
manifest.json      # schemaVersion, channel, tag, sha, version, generatedAt
reference/cli/     # raw ak --help MDX per command
release-notes.md   # channel release notes (semi-trusted input)
```

`sync-release.mjs` wholesale-replaces `reference-raw/`, regenerates derived
`content/docs/beta/reference/cli/` from raw + prose overlays, preserves human-owned
`meta.json` / `meta.vi.json` nav, updates `channels.json.beta`.

Re-dispatching the same tag is **idempotent**.

## Stable promotion

```mermaid
flowchart LR
  BETA_TAG["docs/&lt;beta-tag&gt;<br/>on dev"]
  PROMO["promote-docs.mjs<br/>stable bundle"]
  PR["Promotion PR → dev<br/>label: docs-promotion"]
  STABLE["content/docs/stable/<br/>whole copy from beta tag"]
  REV["Human review"]

  BETA_TAG --> PROMO --> PR --> REV --> STABLE
```

Stable is never direct-committed. Promotion asserts content is channel-neutral
(no baked-in `beta`/`stable` wording). Prose overlays inherit for free because
they live outside `content/docs/`.

## Branch → environment

```mermaid
flowchart LR
  DEV["dev<br/>integration + staging"]
  MAIN["main<br/>production"]
  DEV --> STG["staging.docs.agentkit.best"]
  MAIN --> PROD["docs.agentkit.best"]
```

| Branch | Deploy workflow | Site |
| --- | --- | --- |
| `dev` | `deploy-staging.yml` | staging.docs.agentkit.best |
| `main` | `deploy-production.yml` | docs.agentkit.best |

Production changes only via reviewed `dev` → `main` merge.

## Docs agent (optional prose patches)

```mermaid
flowchart TD
  SYNC_OK["Green beta docs-sync on dev"]
  AGENT["docs-agent.yml<br/>agentkit-docs-agent"]
  DIFF["Compare release notes + reference diff vs guides"]
  PR["Open PR only<br/>modify beta getting-started/guides"]
  GUARD["agent-guard.yml<br/>check-agent-pr.mjs"]
  HUMAN["CODEOWNERS review"]

  SYNC_OK --> AGENT --> DIFF
  DIFF -->|stale guide| PR --> GUARD --> HUMAN
  DIFF -->|unsure / no drift| SKIP["Skip"]
```

The agent cannot touch `reference/`, `stable/`, workflows, or generated dirs.
Disabling `docs-agent.yml` does not affect the sync pipeline.

## CI on every PR (reference-related excerpt)

```mermaid
flowchart TD
  A["PR to dev or main"] --> B["Unit tests"]
  B --> C["Reference hygiene"]
  C --> D["compile-prose --check"]
  D --> E["generate-reference + zero diff"]
  E --> F["Build + link check"]
```

See [CLI reference pipeline](./cli-reference-pipeline.md) for layer details.

## Identities & guards (summary)

| Actor | Role | Bypass on `dev`? |
| --- | --- | --- |
| `agentkit-docs-bot` | Beta sync commits + tags | Yes (ruleset bypass) |
| `agentkit-docs-agent` | Guide patch PRs | No — must pass guards |
| Humans | PRs via review | No |

Generated reference dir: reproducibility check (`generate-reference` zero diff)
is stronger than the hand-edit guard for that path.

## Local validation (no live ak-cli)

```bash
node scripts/sync-release.mjs --bundle fixtures/docs-bundle-beta
node scripts/promote-docs.mjs --bundle fixtures/docs-bundle-stable --beta-source content/docs/beta
node scripts/compile-prose.mjs --check
node scripts/generate-reference.mjs
pnpm test
```
