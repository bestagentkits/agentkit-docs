Idempotently register `ak-agent-runtime` in Codex config by writing `[mcp_servers.ak-agent-runtime]` with `command=ak` and `args=["codex-agent-runtime", "serve"]`. Other `[mcp_servers.*]` entries are preserved.

**When to use it:** Run once after `ak kit init --target codex` to wire the MCP runtime into your Codex config. Safe to re-run—idempotent if the entry is already present.

Writes or updates `~/.codex/config.toml` (`CODEX_HOME` or `--codex-home` overrides the base dir).
