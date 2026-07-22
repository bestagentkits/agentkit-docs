Run the Codex agent MCP server over stdio, exposing each discovered kit or user agent as an MCP tool named `agent_<slug>`. Codex invokes a tool and the runtime spawns `codex exec` with the agent's system prompt plus user prompt, then returns the result.

**When to use it:** Codex starts this automatically when registered via `ak codex-agent-runtime register`. Use `--list-only` to enumerate discovered agents without starting the MCP transport.

Read-only on disk. Each dispatch spawns a fresh `codex exec` subprocess (roughly 1–3s per call).
