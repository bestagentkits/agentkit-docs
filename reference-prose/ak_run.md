Run a skill end-to-end via the configured agent adapter. Honors SIGINT for clean cancellation; use `--timeout` for hard caps.

**When to use it:** When you want to actually execute a skill. Use after `ak kit list-kits` to confirm the target exists; pair with `--json` for scripted consumers in CI or dashboards.

Read-only on kit content; the underlying adapter may write to its own working directory such as `.agentkit/cache/`. Default target is `claude-code`.
