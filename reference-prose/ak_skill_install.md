Install or refresh the per-skill runtime env. Idempotent—safe to re-run.

**When to use it:** After cloning the repo or after editing `skill.yaml`'s runtime block. Use `ak skill upgrade` instead when only the constraint string changed.

Writes to `~/.agentkit/skills/<kit>/<skill>/.manifest.json` and `~/.agentkit/cache/<runtime-hash>/`.
