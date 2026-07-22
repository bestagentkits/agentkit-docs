Remove stale project registry entries whose directories no longer exist or match other prune criteria.

**When to use it:** When `ak doctor` reports orphaned registry entries and suggests `ak projects prune --orphans`. Default is dry-run; pass `--yes` to actually prune.

Writes `~/.agentkit/projects.json` atomically when applying. No-op in dry-run mode.
