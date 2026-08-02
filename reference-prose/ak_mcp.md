Inspect local MCP server configuration across Claude Code user settings and project `.mcp.json` files. Environment values are redacted at parse time.

**When to use it:** Before editing MCP config or validating cross-adapter MCP parity. Use subcommands to list, show, verify, link, add, or remove servers.

Read-only at the group level. Reads `~/.claude/settings.json`, `~/.claude/.mcp.json`, and `./.mcp.json`.
