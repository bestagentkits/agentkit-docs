`ak mcp add` writes a single MCP server entry into a selected Claude-style MCP config file, giving scripts, CI jobs, and reviewers a deterministic way to edit MCP configuration.

**When to use it:** Reach for it after reviewing your existing MCP inventory with `ak mcp list`. Supply the server's `--command`, repeat `--arg` to preserve argument order, and pass `--env KEY=VALUE` for environment assignments — env values are written but never displayed. By default it writes the project's `.mcp.json`; use `--source` to target a different MCP config path.
