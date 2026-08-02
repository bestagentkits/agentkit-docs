Install or build a kit so its agents, skills, and commands are available locally through one or more target adapters. Remote registry is the release default; use `--local --kits-dir` for development and CI.

**When to use it:** After `ak licenses` confirms paid kit access. Project-native mode merges into `./.claude` with metadata under `./.agentkit`; `--global` writes to the adapter user directory instead.

Use `--force` to overwrite after taking a snapshot. Paid kits require remote or explicit `--kits-dir`.
