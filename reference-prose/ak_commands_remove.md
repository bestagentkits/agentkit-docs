Remove an installed slash command's files. If the asset has a runtime env and skill runtime is not opted out, the env is also cleaned up.

**When to use it:** To uninstall a previously installed command. Removing an absent ref is idempotent—it reports an info notice and exits 0.

Removes files under `~/.claude/plugins/<kit>/commands/<name>/`. Unless `AGENTKIT_SKILL_RUNTIME=0`, also removes `~/.agentkit/skills/<kit>/<name>/`.
