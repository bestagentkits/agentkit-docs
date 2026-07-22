Install a single agent by resolving `<kit>/<agent>` and copying it into the user-level install location. If the asset declares a runtime block and skill runtime is not opted out, the per-asset env is created via the runtime manager.

**When to use it:** After confirming the agent exists with `ak agents show`. Use `--force` to overwrite an existing install.

Writes files under `~/.claude/plugins/<kit>/`. Unless `AGENTKIT_SKILL_RUNTIME=0`, runtime-bearing assets also write `~/.agentkit/skills/<kit>/<name>/` and `~/.agentkit/cache/<hash>/`.
