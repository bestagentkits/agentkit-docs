Show your current AgentKit login state and licensed kits by reading the local session and querying the registry for live entitlements.

**When to use it:** To verify login state before installing a licensed remote kit. Unauthenticated machines report `Authenticated: false` and exit 0.

Read-only. Reads `~/.agentkit/auth/session.json`; `AGENTKIT_HOME` overrides the base directory.
