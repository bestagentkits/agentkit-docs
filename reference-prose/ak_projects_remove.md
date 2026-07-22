Deregister a project from the global AgentKit registry without touching the project directory or its files.

**When to use it:** Cleaning up stale registry entries for moved or deleted projects. Called automatically by `ak uninstall` unless `--keep-registry`. Idempotent—exit 0 even if the entry is already absent.

Writes `~/.agentkit/projects.json` atomically.
