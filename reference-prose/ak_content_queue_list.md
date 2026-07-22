List all pending scheduled posts in the content queue, showing status, scheduled time, and attempt count.

**When to use it:** After scheduling via `ak content publish --at` to confirm what is queued and retrieve IDs for cancellation.

Reads `~/.agentkit/content/queue.json`; read-only.
