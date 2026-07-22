Publish a post to a configured channel. Validates the payload before any network I/O. `--body` and `--template` are mutually exclusive.

**When to use it:** Publishing release notes, changelogs, or agent summaries. Use `--dry-run` to verify the payload first. Pass `--at` with an RFC3339 timestamp to enqueue instead of posting immediately.

Reads `--template` and `--vars` inputs; no local writes. Posts to the channel API on success.
