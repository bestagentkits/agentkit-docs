Delete snapshots that fall outside your retention policy. A snapshot is retained when it is among the `--keep-last` newest or younger than `--older-than` (whichever is more protective). When neither flag is set the command is a no-op.

**When to use it:** Periodic cleanup to reclaim disk, or before a major upgrade to drop ancient state. Use `--dry-run` to preview the deletion plan first.

Removes `~/.agentkit/backups/<id>/` trees that fall outside the retention window.
