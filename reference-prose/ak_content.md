Publish content to configured channels from scripts and workflows. The Discord webhook adapter is implemented; Twitter, LinkedIn, and RSS are not yet implemented.

**When to use it:** Use `ak content publish` to push a message from a script or workflow. Use `--dry-run` for a fully read-only validation pass.

Reads `~/.agentkit/config.yaml`. Network writes happen on publish; `--dry-run` is fully read-only.
