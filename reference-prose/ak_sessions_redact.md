Dry-run credential redaction for Claude Code session JSONL files. Detection is best-effort and intentionally pattern-based.

**When to use it:** Run before attaching Claude Code transcripts to issues, PRs, or support reports. Default mode is dry-run; apply requires both `--apply` and `--yes`.

Dry-run is read-only. Apply snapshots each affected session root, then rewrites changed JSONL files via temp-file and rename.
