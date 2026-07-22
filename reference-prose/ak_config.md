Open the local AgentKit dashboard for managing API keys, kits, and project state. Wails builds open a native window; headless mode starts an HTTP server on loopback by default.

**When to use it:** Use the default dashboard flow for point-and-click configuration. Use `ak config start`, `status`, and `stop` for scripted lifecycle control.

Reads `~/.agentkit/config.yaml`. HTTP mode writes `~/.agentkit/dashboard/state.json` on start and removes it on stop. Non-loopback HTTP binds require `--auth-token`.
