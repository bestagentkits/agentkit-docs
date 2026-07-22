Stop the running AgentKit API server by sending SIGTERM to the process recorded in the state file. Succeeds (exit 0) if the server is not running—idempotent and safe to call from scripts.

**When to use it:** When you want to stop the local API server started with `ak api start`. Also useful in CI teardown after a test run that required the API server.

Removes `~/.agentkit/api-state.json` after a successful stop.
