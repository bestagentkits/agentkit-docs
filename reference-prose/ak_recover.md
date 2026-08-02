Recover AgentKit state from a snapshot—a top-level alias for `ak backups restore`. Replays every file in the manifest back to its original on-host path after end-to-end verification.

**When to use it:** After a failed update or migration, or to roll back to a known-good prior state. Use `--latest` to restore the newest snapshot.

Overwrites files under `~/.claude/plugins/` and `~/.agentkit/skills/` to match the snapshot.
