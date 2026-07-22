Initialize an existing directory as an AgentKit project by creating or updating the ownership manifest. Idempotent init-or-update—use `ak new` to scaffold a fresh project from scratch.

**When to use it:** Onboarding an existing directory into AgentKit management, or re-running after manual edits to refresh the ownership manifest.

Creates or updates `<dir>/.agentkit/ownership.json`. Existing manifests trigger an `ak backups` snapshot. Use `--dry-run` to preview without writing.
