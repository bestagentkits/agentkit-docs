Manage per-skill Python or Node runtime envs that `ak run` activates. For catalog browsing (list, install, remove), see `ak skills`.

**When to use it:** Run `ak skill verify` after a fresh checkout; `ak skill install` after editing `skill.yaml`; `ak skill repair` when verify reports corrupt; `ak skill upgrade` after changing the runtime block.

Read-only at the group level; subcommands document effects under `~/.agentkit/skills/<kit>/<skill>/` and `~/.agentkit/cache/<hash>/`.
