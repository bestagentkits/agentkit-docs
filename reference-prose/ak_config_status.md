Report whether the dashboard server is running, showing PID, bind address, and uptime when active. Exits 0 whether or not the server is running—use the `running` field in `--json` output to branch in scripts.

**When to use it:** Check whether `ak config start` has been run, or verify the dashboard is still up after a long idle period. Safe to call repeatedly; read-only.

Reads `~/.agentkit/dashboard-state.json`.
