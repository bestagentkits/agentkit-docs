Preview or apply AgentKit-owned project refreshes after a release. Bare `ak update` refreshes inferred project-owned `kits/<kit>/...` content; use `ak kit refresh` for installed plugins.

**When to use it:** After an AgentKit release to refresh AK-owned project files. Default is preview (dry-run); pass `--yes` or accept interactively to apply. User-modified files are skipped without `--force`.

When applied, takes a pre-update project snapshot before mutation. Does not refresh installed `~/.claude/plugins/<kit>/` plugin output.
