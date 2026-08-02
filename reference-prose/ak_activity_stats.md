Summarize privacy-bounded local skill usage by coding agent, aggregating rows by skill, kit, runtime, source, date, status, and duration bucket. It reads local activity events and Claude Code session Skill tool calls at query time.

**When to use it:** Use to inspect recent local skill adoption or compare coding-agent coverage across a window such as `--window 7d`.

This command is read-only. It reads `~/.agentkit/activity/events.ndjson` and `~/.claude/projects/*.jsonl`; `AGENTKIT_HOME` and `AGENTKIT_CLAUDE_HOME` override those roots.
