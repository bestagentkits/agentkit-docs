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

## Remaining commands (117 without prose)

`ak`, `ak kit`, `ak kit install`, `ak mcp add` are done. Still needed:

ak_activity, ak_activity_list, ak_activity_stats, ak_activity_tail, ak_agents,
ak_agents_install, ak_agents_list, ak_agents_remove, ak_agents_search,
ak_agents_show, ak_api, ak_api_start, ak_api_status, ak_api_stop, ak_audit,
ak_audit_scripts, ak_backups, ak_backups_list, ak_backups_prune,
ak_backups_restore, ak_backups_show, ak_backups_verify, ak_changelog,
ak_codex-agent-runtime, ak_codex-agent-runtime_register,
ak_codex-agent-runtime_serve, ak_codex-agent-runtime_unregister, ak_commands,
ak_commands_install, ak_commands_list, ak_commands_remove, ak_commands_search,
ak_commands_show, ak_config, ak_config_start, ak_config_status, ak_config_stop,
ak_content, ak_content_publish, ak_content_queue, ak_content_queue_cancel,
ak_content_queue_list, ak_content_queue_run-pending, ak_content_schedule,
ak_content_schedule_daemon, ak_diagnostics, ak_diagnostics_export, ak_doctor,
ak_feedback, ak_gui, ak_init, ak_kit_init, ak_kit_install-path, ak_kit_list-kits,
ak_kit_refresh, ak_kit_repair-install-mode, ak_kit_uninstall, ak_kit_validate,
ak_licenses, ak_login, ak_logout, ak_mcp, ak_mcp_link, ak_mcp_list,
ak_mcp_remove, ak_mcp_show, ak_mcp_verify, ak_migrate, ak_migrate_rollback,
ak_new, ak_plan, ak_plan_add-phase, ak_plan_check, ak_plan_create,
ak_plan_kanban, ak_plan_parse, ak_plan_status, ak_plan_uncheck, ak_plan_validate,
ak_projects, ak_projects_add, ak_projects_list, ak_projects_prune,
ak_projects_remove, ak_projects_show, ak_recover, ak_run, ak_self-update,
ak_sessions, ak_sessions_list, ak_sessions_redact, ak_sessions_show,
ak_sessions_stats, ak_sessions_tail, ak_setup, ak_skill, ak_skill_install,
ak_skill_remove, ak_skill_repair, ak_skill_upgrade, ak_skill_verify, ak_skills,
ak_skills_graph, ak_skills_install, ak_skills_list, ak_skills_remove,
ak_skills_search, ak_skills_show, ak_uninstall, ak_update, ak_versions, ak_watch,
ak_watch_dry-run, ak_watch_start, ak_watch_status, ak_watch_stop, ak_whoami

Recompute anytime:

```bash
comm -23 \
  <(ls content/docs/beta/reference/cli/ak*.mdx | xargs -n1 basename | sed 's/\.mdx$//' | sort) \
  <(ls reference-prose/*.md | xargs -n1 basename | sed 's/\.md$//' | sort)
```
