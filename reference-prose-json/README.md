# CLI reference prose — JSON wire format

Structured **LLM/agent input** for narrative CLI reference leads. Each file
`reference-prose-json/<slug>.json` compiles to `reference-prose/<slug>.md`; the
published reference still merges that markdown with `reference-raw/` via
`generate-reference.mjs`.

Facts (flags, exit codes, usage) never belong here — only readability fields.

## Schema

See [`schema.json`](./schema.json). Required fields:

| Field | Type | Maps to markdown |
| --- | --- | --- |
| `overview` | string | Opening 1–2 sentences |
| `whenToUse` | string | Becomes `**When to use it:** …` (label added by compile) |
| `notes` | string, optional | Trailing gotcha paragraph |

Example:

```json
{
  "overview": "Run health checks on your AgentKit installation. Checks run concurrently and finish in under five seconds.",
  "whenToUse": "After install, upgrade, or unexpected behavior. In CI, use `--json` and inspect the `healthy` field.",
  "notes": "Read-only by default. `--offline` skips network checks."
}
```

## Agent prompt (JSON output)

> Read `content/docs/beta/reference/cli/<slug>.mdx` (or `reference-raw/<slug>.mdx`)
> — the ONLY ground truth for flags, paths, and behavior.
>
> Return **JSON only** matching `reference-prose-json/schema.json`:
> `{ "overview": "…", "whenToUse": "…", "notes": "…" }`
>
> Rules: faithful to source; no `##` headings; no flag/exit-code tables; do not
> include the `**When to use it:**` label inside `whenToUse`.

Write the result to `reference-prose-json/<slug>.json`, then compile.

## Commands

```bash
node scripts/compile-prose.mjs                    # JSON → reference-prose/*.md
node scripts/compile-prose.mjs --check            # CI: fail if .md drift from JSON
node scripts/compile-prose.mjs --slug ak_doctor   # one slug
node scripts/compile-prose.mjs --export-missing   # bootstrap JSON from existing .md
node scripts/generate-reference.mjs               # prose + raw → published MDX
```

Slugs **without** a JSON file may still use hand-edited `reference-prose/*.md`.
When JSON exists, CI expects the markdown to match (`--check`).

## Bootstrap existing overlays

To backfill JSON from the current markdown corpus (one-time or incremental):

```bash
node scripts/compile-prose.mjs --export-missing
node scripts/compile-prose.mjs --check
```

Commit both `reference-prose-json/` and `reference-prose/` when adopting JSON for a slug.
