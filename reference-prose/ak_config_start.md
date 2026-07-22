Start the local AgentKit dashboard server. Opens a browser by default unless `--no-open` is set. The server listens on loopback by default; non-loopback binds require `--auth-token`.

**When to use it:** When you need the web UI for API keys, kits, and project state. Use `ak config status` to check if already running and `ak config stop` to shut down.

Writes `~/.agentkit/dashboard-state.json` with PID, bind address, and start time. The file is removed by `ak config stop`.
