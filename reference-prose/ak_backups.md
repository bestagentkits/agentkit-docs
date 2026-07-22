Inspect and manage AgentKit rollback snapshots stored under `~/.agentkit/backups/`. Each snapshot captures the project registry, kit plugin install dirs, and per-skill envs at a single point in time.

**When to use it:** Snapshots are produced automatically before mutating commands (`ak update`, `ak uninstall`, `ak migrate`) once those epics ship; today they are also producible by future tooling that calls into this package directly. Use `list` to discover IDs, `verify` before restoring, and `restore` to roll state back.

This group is read-only at the top level; subcommands document their own effects under `~/.agentkit/backups/`.
