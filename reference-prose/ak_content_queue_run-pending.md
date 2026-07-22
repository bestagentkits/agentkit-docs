Fire all scheduled posts whose time has arrived. Idempotent—it won't double-publish already-published entries. An advisory lock prevents concurrent double-publish.

**When to use it:** As a cron job or manual flush without starting the long-running scheduler daemon.

Atomically reads and writes `~/.agentkit/content/queue.json`; uses a transient lock file alongside the queue during publish.
