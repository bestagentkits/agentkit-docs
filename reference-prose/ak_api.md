Run a local HTTP server that proxies Anthropic, OpenAI, and Gemini API requests, injecting auth headers from your AgentKit config. It also exposes read-only local endpoints: `/health`, `/status`, and `/version`.

**When to use it:** Use `ak api start` to bring up the server. It binds `127.0.0.1` by default. Non-loopback binds require `--auth-token` for security. Use `ak api status` to check state and `ak api stop` to shut down.

Reads `~/.agentkit/config.yaml` for API keys. Writes `~/.agentkit/api/state.json` on start; removes it on stop.
