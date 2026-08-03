# CLI reference pipeline

How the published CLI reference is built: facts stay mechanical; narrative is
human/LLM-authored; the site reads **derived** pages only.

## Layer model

```mermaid
flowchart TB
  subgraph sources["Committed sources (repo root)"]
    RAW["reference-raw/&lt;slug&gt;.mdx<br/>ak --help projection"]
    JSON["reference-prose-json/&lt;slug&gt;.json<br/>optional LLM wire format"]
    PROSE["reference-prose/&lt;slug&gt;.md<br/>readable narrative lead"]
  end

  subgraph scripts["Deterministic scripts (no LLM)"]
    COMPILE["compile-prose.mjs"]
    GEN["generate-reference.mjs<br/>normalize-reference.mjs"]
  end

  subgraph published["Published (Fumadocs)"]
    MDX["reference-derived/&lt;slug&gt;.mdx"]
    SITE["docs.agentkit.best"]
  end

  AK["ak binary<br/>ak &lt;cmd&gt; --help"] -.->|release bundle| RAW
  JSON --> COMPILE --> PROSE
  PROSE --> GEN
  RAW --> GEN
  GEN --> MDX --> SITE
```

| Layer | Owner | Contents |
| --- | --- | --- |
| `reference-raw/` | Machine (sync from `ak-cli` release) | Usage, flags, exit codes, examples — exact CLI help |
| `reference-prose-json/` | LLM/agent (optional) | `{ overview, whenToUse, notes? }` |
| `reference-prose/` | Human/LLM reviewed | Markdown lead only |
| `reference-derived/` | **Derived** | Prose lead + generated fact sections (not published) |
| `content/docs/.../cli/` | **Authored** | Nested user-facing CLI reference |

Slugs without a prose overlay fall back to a mechanical synopsis from raw.

## One page: what the user sees

```mermaid
flowchart LR
  subgraph lead["Lead (narrative)"]
    O["Overview"]
    W["When to use it"]
    N["Notes optional"]
  end

  subgraph facts["Facts (machine)"]
    U["Usage"]
    E["Examples"]
    F["Flags"]
    X["Exit codes"]
    R["Related commands"]
  end

  lead --> PAGE["Published MDX page"]
  facts --> PAGE
```

The lead comes from `reference-prose/` (or JSON compiled into it). Everything
from **Usage** downward is parsed from `reference-raw/` by `normalize-reference.mjs`.

Shared boilerplate is deduped at generation time: universal flags
(`--json`, `--quiet`, `--verbose`, `--yes`, `--no-interactive`, `--help`), the
canonical output-modes table, and the standard exit codes (`0`–`3`) are
documented once on the human-owned `cli-conventions` page; command pages keep
only rows specific to them (matched by exact flag+description / code+meaning,
so overloaded spellings survive) plus a pointer line. The `cli/index` page is
also compiled — a grouped table of contents built from each command page's
frontmatter (`scripts/lib/reference-index.mjs`) instead of the raw projection.

## Authoring workflow (LLM + human)

```mermaid
sequenceDiagram
  participant SRC as reference-raw or beta MDX
  participant LLM as LLM / agent
  participant JSON as reference-prose-json/
  participant MD as reference-prose/
  participant GEN as generate-reference.mjs
  participant PUB as content/docs/.../cli/

  Note over SRC: Ground truth for flags, paths, behavior
  LLM->>SRC: Read command source
  LLM->>JSON: Write schema.json overlay
  Note over JSON: compile-prose.mjs
  JSON->>MD: Render markdown lead
  Note over MD,GEN: Or edit .md directly (no JSON)
  GEN->>PUB: Merge raw + prose
  Note over PUB: Commit JSON + MD + derived MDX
```

### Commands (local)

```bash
# Path A — JSON wire format (recommended for agents)
# 1. Write reference-prose-json/<slug>.json
node scripts/compile-prose.mjs              # → reference-prose/<slug>.md

# Path B — edit reference-prose/<slug>.md directly

# Both paths:
node scripts/generate-reference.mjs           # → reference-derived/
pnpm lint && pnpm check:reference && pnpm build && pnpm check:links
```

Bootstrap JSON from existing markdown:

```bash
node scripts/compile-prose.mjs --export-missing
```

## CI validation

```mermaid
flowchart TD
  PR["Pull request"] --> T["pnpm test"]
  T --> H["check:reference hygiene"]
  H --> C{"JSON sources exist?"}
  C -->|yes| CP["compile-prose --check<br/>JSON matches .md"]
  C -->|no| GR
  CP --> GR["generate-reference.mjs<br/>assert zero diff on derived MDX"]
  GR --> B["pnpm build + check:links"]
  B --> OK["Merge allowed"]
  CP -->|drift| FAIL["CI fail: run compile-prose"]
  GR -->|drift| FAIL2["CI fail: run generate-reference"]
```

Reproducibility rule: for unchanged `reference-raw/` + `reference-prose/`,
re-running `generate-reference.mjs` must produce **zero diff** on
`reference-derived/`.

## When each layer changes

```mermaid
flowchart TD
  Q{"What changed?"}
  Q -->|New ak release / CLI help text| SYNC["sync-release.mjs updates reference-raw/"]
  Q -->|Readability / guidance| PROSE["Edit JSON or reference-prose/"]
  Q -->|Generator logic| CODE["Edit normalize-reference.mjs + tests"]

  SYNC --> GEN["generate-reference.mjs"]
  PROSE --> COMPILE["compile-prose.mjs if JSON"]
  COMPILE --> GEN
  CODE --> GEN
  GEN --> COMMIT["Commit derived MDX"]
```

After a CLI release sync, re-check prose overlays for commands whose behavior
changed — facts update automatically; narrative may need a human/LLM pass.

## File naming

| Published page | Slug | Overlay paths |
| --- | --- | --- |
| `ak_kit_install.mdx` | `ak_kit_install` | `reference-prose/ak_kit_install.md` |
| `ak.mdx` | `ak` | `reference-prose/ak.md` |

One slug per command; channel-neutral prose promotes to stable with the tree copy.
