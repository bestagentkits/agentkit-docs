Guided first-run configuration wizard for AgentKit. Existing Claude Code or Codex subscription login is reused; setup does not install kit content.

**When to use it:** Run once after installing AgentKit. Re-run any time to update a single field with `--step`. Use `--advanced` for direct API keys and provider or model overrides.

Creates or updates `~/.agentkit/config.yaml` atomically. Re-running is idempotent—only fields you change are updated.
