Inspect the local AgentKit activity feed from the CLI—the same event log the dashboard and desktop app use. Use `list` for a finite snapshot, `tail` for a live stream, and `stats` for local skill usage aggregates.

**When to use it:** Use when debugging recent `ak run` activity or when a headless workflow needs activity evidence without opening the desktop app.

This command is read-only. It reads `~/.agentkit/activity/events.ndjson`; `AGENTKIT_HOME` overrides the base directory.
