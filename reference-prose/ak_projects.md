Manage the global AgentKit project registry that tracks every directory bootstrapped by `ak new` or `ak init`.

**When to use it:** Listing, adding, removing, or inspecting registered AgentKit projects. Use `ak projects prune --orphans` when `ak doctor` reports stale entries.

Reads and writes `~/.agentkit/projects.json` atomically under an advisory lock.
