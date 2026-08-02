Verify MCP server stdio handshakes by executing configured MCP commands and sending initialize only—no tool calls or config writes.

**When to use it:** After `ak mcp list` or after editing MCP config. Requires an initialize response within the timeout (default 3s).

Executes configured MCP commands transiently; no config writes.
