Recompute the sha256 of every file under the snapshot's `data/` tree and compare against the recorded hash. Reports `ok` only when all entries match.

**When to use it:** Before `ak backups restore`; periodic integrity audits.

This command is read-only.
