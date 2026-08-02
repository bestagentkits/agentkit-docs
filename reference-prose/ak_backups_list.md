List every rollback snapshot under `~/.agentkit/backups/`, ordered newest first. Stray files or directories that do not match a valid snapshot id are silently skipped.

**When to use it:** Before `ak backups restore` to discover available IDs; in scripts to inventory state.

This command is read-only.
