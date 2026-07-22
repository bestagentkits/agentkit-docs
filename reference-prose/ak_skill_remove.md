Remove the per-skill runtime record without deleting the shared package cache. Idempotent—missing record is treated as success.

**When to use it:** When a skill is renamed, deleted, or its runtime block is removed.

Removes `~/.agentkit/skills/<kit>/<skill>/`. Shared cache under `~/.agentkit/cache/<hash>/` is preserved.
