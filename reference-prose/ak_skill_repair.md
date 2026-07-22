Rebuild a corrupted per-skill runtime env. Other states (ok, missing, unknown) are no-ops—safe for reconciliation loops.

**When to use it:** After `ak skill verify` reports corrupt.

Removes `~/.agentkit/skills/<kit>/<skill>/`, then re-runs install. Holds an exclusive advisory lock at `~/.agentkit/skills/<kit>/<skill>.lock`.
