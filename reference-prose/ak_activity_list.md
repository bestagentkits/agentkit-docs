Return a finite snapshot of the local activity log, newest first. The JSON shape mirrors the dashboard activity API event schema.

**When to use it:** Use before or after `ak run` to inspect recent `run.started`, `run.completed`, and `run.failed` events.

This command is read-only. It reads `~/.agentkit/activity/events.ndjson`; `AGENTKIT_HOME` overrides the base directory.
