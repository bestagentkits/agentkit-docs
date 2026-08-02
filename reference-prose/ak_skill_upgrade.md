Re-resolve the per-skill env after editing the `runtime:` block in `skill.yaml`. No-op when the hash already matches the on-disk manifest.

**When to use it:** After editing the runtime block. Use `ak skill repair` instead when verify reports corrupt.

May write to a new `~/.agentkit/cache/<new-hash>/` and refresh the manifest. Old cache dir is preserved.
