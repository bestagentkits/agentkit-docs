Codex agent MCP dispatch runtime that registers each discovered kit or user agent as an MCP tool over stdio so Codex can invoke it by tool name. Backed by `codex exec` subprocesses per agent call.

**When to use it:** After running `ak kit init` for a Codex-targeted kit, register the runtime once so Codex sessions can invoke kit agents as MCP tools. Use `register` to write the Codex config entry, `serve` to run the MCP server, and `unregister` to remove it.

This group is read-only at the top level; subcommands document their own disk effects.
