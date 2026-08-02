Restore AgentKit state from a snapshot by replaying every file in the manifest back to its original on-host path. Replace-only: files added under the snapshotted scope after the snapshot are not deleted. The manifest is verified end-to-end before any live file is touched.

**When to use it:** After a failed update or migration, or to recover a known-good prior state. Run `ak backups verify` first; use `--latest` to restore the newest snapshot.

Overwrites files under `~/.claude/plugins/` and `~/.agentkit/skills/` to match the snapshot.
