Manage the content scheduler that polls the queue and publishes due posts. Use `ak content schedule daemon` for a long-running background service.

**When to use it:** When you need automated publishing of scheduled posts rather than manual cron invocations of `ak content queue run-pending`.

Reads and writes `~/.agentkit/content/queue.json` atomically on each poll tick.
