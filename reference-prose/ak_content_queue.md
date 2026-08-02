Manage the scheduled post queue—list pending posts, cancel by ID, or manually trigger due posts. Posts are added via `ak content publish --at <RFC3339>`.

**When to use it:** After scheduling with `ak content publish --at`, use subcommands to inspect, cancel, or flush the queue without starting the long-running daemon.

Reads `~/.agentkit/content/queue.json`. Cancel and run-pending subcommands write atomically.
