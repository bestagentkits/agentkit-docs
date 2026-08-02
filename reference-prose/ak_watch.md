Watch a GitHub repository and auto-respond to issues. Requires the `gh` CLI to be authenticated. State is persisted so restarts never produce duplicate responses.

**When to use it:** Use `ak watch start` to begin monitoring. Use `ak watch dry-run` to preview before going live.

Reads and writes `~/.agentkit/watch/<repo-slug>/state.json` atomically. In daemon mode, writes a PID file alongside the state file.
