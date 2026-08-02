Start the long-running content scheduler daemon that polls the queue and publishes due posts. Runs until SIGINT or SIGTERM. An advisory lock prevents two daemons from double-publishing.

**When to use it:** Start once as a background service or systemd unit for hands-off scheduled publishing.

Reads and writes `~/.agentkit/content/queue.json` on each tick; uses a transient lock during publish. Poll interval defaults to 60 seconds via `--poll-interval`.
