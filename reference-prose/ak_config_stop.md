Stop the running AgentKit dashboard by sending SIGTERM to the process recorded in the state file. Succeeds (exit 0) if the server is not running—idempotent and safe to call from scripts.

**When to use it:** When you want to stop the dashboard started with `ak config start`. Also useful in CI teardown or when switching ports.

Removes `~/.agentkit/dashboard-state.json` after a successful stop.
