Bootstrap a new AgentKit project in a fresh directory with an ownership manifest and optional seed or kit content. Use `ak init` for an existing directory instead.

**When to use it:** Starting a fresh AgentKit project. Paid kits require `ak login`. `--template` and `--kits` are mutually exclusive.

Creates `./<project-name>/` with ownership manifest and seed content. Takes an `ak backups` snapshot only if the target already has an AK ownership manifest.
