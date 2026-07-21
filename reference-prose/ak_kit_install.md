`ak kit install` loads a kit (such as `engineer` or `marketing`) and emits its agents, skills, and commands through one or more target adapters. By default it writes runtime-native project content; `--switch-to-plugin` selects a Claude Code project plugin instead, and `--build-only` writes the output without installing it.

**When to use it:** Run it once `ak licenses` confirms access to a paid kit and you want the kit's agents, skills, and commands available locally for adapters like Claude Code and Codex. Use `--target` to choose adapters, `--skills` / `--exclude-skills` to control which skills install, and `--global` to install into the adapter user directory rather than the current project.

Project-native mode merges AgentKit-owned resources into `./.claude` and stores lifecycle metadata under `./.agentkit`, preserving unknown and user-modified files. `--force` authorizes a tracked overwrite after taking a snapshot.
