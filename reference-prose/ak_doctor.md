Run health checks on your AgentKit installation. Checks run concurrently and finish in under five seconds.

**When to use it:** After install, upgrade, or unexpected behavior. In CI, use `--json` and inspect the `healthy` field—the command exits 0 even if checks fail unless you pass `--exit-on-fail`. Use `--fix` to invoke repair commands that may write to `~/.agentkit/` or `~/.claude/plugins/`.

Read-only by default. `--offline` skips network checks.
