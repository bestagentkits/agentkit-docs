Show paginated session messages from a Claude Code transcript. Default `--limit` is 200; supports `--cursor` for 0-based line cursor.

**When to use it:** After `ak sessions list` to inspect one transcript page.

Read-only. Reads `~/.agentkit/projects.json` and the selected `~/.claude` session JSONL file.
