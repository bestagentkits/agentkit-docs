Report whether the API server is running, showing PID, bind address, uptime, and request count when active. Exits 0 whether or not the server is running—use the `running` field in `--json` output to branch in scripts.

**When to use it:** Check whether `ak api start` has been run, or verify the server is still up after a long idle period. Safe to call repeatedly; read-only.

Reads `~/.agentkit/api-state.json`.
