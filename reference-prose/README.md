# CLI reference prose overlays

Reviewed, human/AI-owned **prose leads** for the generated CLI reference, keyed by
command slug. This is the "compiled from source of truth" layer of the docs: the
_facts_ (usage, examples, flags, exit codes, related commands) are projected
mechanically from `ak --help` by `scripts/lib/normalize-reference.mjs`; the
_narrative_ (overview + when-to-use + notes) lives here and reads like docs a
human wrote.

## How it works

- One file per command: `reference-prose/<slug>.md`, where `<slug>` is the
  generated page's basename (`ak_kit_install.mdx` → `ak_kit_install.md`).
- Kept **outside `content/docs`** so fumadocs never renders an overlay as a page,
  and **channel-neutral** (same command → same prose) so stable promotion inherits
  it for free.
- The published pages are **derived**: `generateReference` = normalize(raw source
  in `reference-raw/<slug>.mdx` + this overlay). The prose **replaces** the
  mechanical overview/context lead; the deterministic factual sections (usage,
  examples, flags, tables, related) are always machine-generated from the raw
  source.
- A command **without** an overlay falls back to the mechanical synopsis
  projection — so coverage can grow incrementally, page by page.

## I/O contract (for authoring in Cursor / any agent)

- **Input (source of truth):** `content/docs/beta/reference/cli/<slug>.mdx` — the
  faithful projection of `ak <cmd> --help`. This is the ONLY ground truth.
- **Output:** `reference-prose/<slug>.md` — prose body only. **No** `##` heading
  (the layout renders the title), **no** frontmatter, **no** flag/exit-code
  tables, usage lines, or `SEE ALSO` list (those are generated mechanically).

## Authoring prompt (reusable)

> You are compiling user-facing documentation prose for one `ak` CLI command.
> Read the source file `content/docs/beta/reference/cli/<slug>.mdx` — it is the
> faithful projection of `ak <cmd> --help` and the ONLY ground truth.
>
> Write `reference-prose/<slug>.md` with:
> 1. **Overview** — 1–2 sentences, plain English, what the command is and does.
>    Lead with value, not mechanism. No "What it does:" label.
> 2. **When to use it** — a short paragraph of genuine guidance (and what to run
>    before/after, where the source says so), as `**When to use it:** …`.
> 3. **Notes** (optional) — 1–3 sentences on a KEY behavior/gotcha (disk effects,
>    a critical mode/caveat). Skip if nothing earns its place.
>
> Hard rules:
> - FAITHFUL: never state a flag, mode, path, exit code, or behavior absent from
>   the source. No invention, no embellishment.
> - Do NOT restate the full flag list, output modes, or exit codes — those are
>   tabulated automatically. Mention a specific flag only when the guidance needs
>   it.
> - Do NOT include `##` headings, frontmatter, tables, usage syntax, or SEE ALSO.
> - Tone: concise reference prose (Stripe/Vercel style). No marketing fluff, no
>   "simply", no emoji. Inline code (backticks) for command names, flags, paths.

## Faithfulness verify prompt (reusable)

> Given the source `content/docs/beta/reference/cli/<slug>.mdx` and the drafted
> `reference-prose/<slug>.md`, list every claim in the prose (flag, path, mode,
> exit code, behavior) NOT supported by the source. If any exist, the draft fails
> — rewrite the offending sentence to match the source or drop it. Return the
> corrected prose.

## Regenerate + validate loop

After writing/updating overlays:

```bash
node scripts/generate-reference.mjs  # raw source + overlays → derived pages (idempotent)
pnpm lint                            # MDX lint (--frail)
pnpm check:reference                 # fail-closed on internal-only leaks
pnpm build                           # static export must parse every page
pnpm check:links                     # internal link integrity
```

The derived pages are byte-stable: re-running generation with unchanged sources
produces zero diff. CI enforces this — if you edit an overlay but forget to
regenerate, the reference-regeneration check fails.

## Coverage

All 122 CLI reference slugs have prose overlays (recompute anytime to find gaps):

```bash
comm -23 \
  <(ls content/docs/beta/reference/cli/ak*.mdx | xargs -n1 basename | sed 's/\.mdx$//' | sort) \
  <(ls reference-prose/*.md | xargs -n1 basename | sed 's/\.md$//' | sort)
```
