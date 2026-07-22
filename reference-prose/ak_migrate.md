Migrate an existing ClaudeKit install to AgentKit. Scans `~/.claude/`, `~/.claudekit/`, and the current working directory. `--from=ck` is the only supported source.

**When to use it:** First-time ClaudeKit-to-AgentKit move, or re-run after a partial migration. Default is `--dry-run` (read-only preview); apply writes under the migration target after `--yes` and safety gates pass.

Failed apply is resumable by default. Use `--force-unlock` for a stale lock.
