# Desktop app screenshots

Optimized screenshots of the AgentKit Desktop Control Center used by the
`desktop-app` usage docs. Referenced from MDX with root-absolute paths, e.g.
`![alt](/gui/dashboard-charts.webp)`, so both the `beta` and `stable` channels
share this one directory.

## Capture & processing

- **Source build:** Desktop `2.5.0-beta.32` (status pill visible in each shot).
- **Capture date:** 2026-08-01, macOS, light theme.
- **Original capture:** 3228×2272 (CleanShot `@2x`), app window over the desktop wallpaper.
- **Processing:** cropped to the window bounds (`2859×1915+176+178`), resized to
  1600 px wide, window corners rounded (transparent), encoded WebP `cwebp -q 86`.
- **Output:** 1600×1072 per file, each < 100 KB (budget < 500 KB/file, < 5 MB total).
- Content is real (project names, paths, usage figures) and intentionally not redacted — this is the project's own docs site.

The optimizer is not committed; source PNGs live outside the repo and are never
staged. The pre-build guard `scripts/check-desktop-docs.mjs` enforces count,
naming, per-file/total budget, and that no PNG lands here.

## Files

| File | Screen | Page |
| --- | --- | --- |
| `dashboard-charts.webp` | Dashboard — token/session/model/project charts | interface-overview |
| `dashboard-empty-state.webp` | Dashboard — empty / "install a kit to get started" | interface-overview |
| `dashboard-runtime-filter.webp` | Dashboard — runtime filter dropdown | interface-overview |
| `kits-install-wizard.webp` | Kits — install wizard (destination / version / review) | managing-entities |
| `subagents-list-detail.webp` | Subagents — list + agent detail with frontmatter | managing-entities |
| `commands-grouped.webp` | Commands — grouped by source command | managing-entities |
| `hooks-harness.webp` | Hooks — installed / registered in harness | managing-entities |
| `sessions-list.webp` | Sessions — recorded Claude Code / Codex sessions | managing-entities |
| `mcp-servers.webp` | MCP — servers, sources, verification | managing-entities |
| `projects-list.webp` | Projects — registered projects (read-only) | projects-and-plans |
| `project-dashboard.webp` | Project dashboard — health, sessions, active plans | projects-and-plans |
| `plans-kanban.webp` | Plans — kanban board | projects-and-plans |
| `plans-list.webp` | Plans — list with progress and status | projects-and-plans |
| `plan-detail.webp` | Plan detail — phases, progress, plan.md reader | projects-and-plans |
| `journals.webp` | Journals — chronological technical journals | projects-and-plans |
| `feedback-form.webp` | Feedback — report form with redacted preview | settings-and-system |
| `settings-app.webp` | Settings — App appearance / runtime | settings-and-system |
| `settings-database.webp` | Settings — local analytics index | settings-and-system |
| `status-line-designer.webp` | Status Line — visual status-line designer | settings-and-system |
| `migrate-wizard.webp` | Migrate — provider migration wizard | settings-and-system |
