Start the AgentKit local API and proxy server. The server listens on `127.0.0.1` by default (loopback-only). Non-loopback binds require `--auth-token` for security.

**When to use it:** When you need the AgentKit proxy API running for local tool integrations, dashboards, or automated pipelines. Use `ak api status` first to check if a server is already running.

Writes `~/.agentkit/api-state.json` with PID, bind address, and start time. The file is removed by `ak api stop`.
