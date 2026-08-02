Check or apply signed AgentKit binary updates. Use this instead of `ak update` when updating the `ak` binary or staging a desktop update.

**When to use it:** When a newer signed release is available. Check mode is read-only; manual CLI apply requires `--yes`. Desktop auto-update is opt-in via `updates.enabled` in config.

Apply mode downloads verified artifacts into `~/.agentkit/cache/binaries` and replaces the CLI binary only after all required bytes verify.
