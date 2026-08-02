Remove an AK-managed project with ownership-aware deletion. Snapshots prior state via `ak backups` before any deletion, even with `--force`.

**When to use it:** Removing a project that AgentKit bootstrapped with `ak new`. Default is dry-run; pass `--yes` or confirm the prompt to execute.

Deletes AK-owned files from the project directory and removes `.agentkit/ownership.json`. User-modified files are refused unless `--force`.
