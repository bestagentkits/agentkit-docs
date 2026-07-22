Remove an installed kit plugin, deleting AK-generated files while preserving unknown and user-modified content. Snapshots before any writes.

**When to use it:** After `ak kit init <kit>` when the kit should no longer be installed. Use `--dry-run` to preview the plan.

Deletes AK-generated files under `~/.claude/plugins/ak-<kit>/`, unregisters the Claude Code plugin, strips AK Codex runtime blocks, and removes manifest-backed content.
