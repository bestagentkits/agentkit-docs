Show which AgentKit kits your account is licensed to install. Uses the same entitlement query as `ak whoami`, scoped to per-kit grants.

**When to use it:** Before `ak kit init <kit>` for a licensed remote kit.

Read-only. Reads `~/.agentkit/auth/session.json`; `AGENTKIT_HOME` overrides the base directory.
