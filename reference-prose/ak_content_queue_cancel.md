Cancel (remove) a scheduled post by ID from the content queue. Only pending posts are cancellable; already-published entries are ignored.

**When to use it:** To prevent a scheduled post from firing. Get the ID from `ak content queue list`.

Atomically writes `~/.agentkit/content/queue.json`.
