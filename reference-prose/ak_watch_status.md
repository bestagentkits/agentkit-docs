Show current watch state for all repos or a specific one, including responded counts and daemon status.

**When to use it:** After `ak watch start --daemon` to confirm the watcher is running, or to inspect responded counts.

Read-only. Reads `~/.agentkit/watch/<repo-slug>/state.json`; `AGENTKIT_HOME` overrides the base directory.
