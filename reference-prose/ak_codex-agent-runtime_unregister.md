Idempotently remove the AgentKit-managed `[mcp_servers.ak-agent-runtime]` entry from Codex config, leaving every other `[mcp_servers.*]` entry intact. A missing entry is not an error—it exits 0 with `Changed=false`.

**When to use it:** When you want to stop Codex from auto-loading the AgentKit MCP runtime, or before switching to a different MCP server configuration.

Writes `~/.codex/config.toml` (`CODEX_HOME` or `--codex-home` overrides the base dir).
