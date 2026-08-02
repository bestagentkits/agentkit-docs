Start watching a GitHub repository for new issues and post reply comments. Runs once by default; use `--daemon` for continuous background polling.

**When to use it:** When you want AgentKit to automatically respond to new GitHub issues. Use `ak watch dry-run` first to verify filters.

Reads and writes `~/.agentkit/watch/<repo-slug>/state.json` to track responded issues and rate-limit counters.
