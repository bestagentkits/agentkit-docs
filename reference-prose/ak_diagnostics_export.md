Export a redacted diagnostics bundle by running `ak doctor --json` and stripping sensitive values. The bundle goes to stdout for piping or redirection.

**When to use it:** Before filing feedback that needs install, update, adapter, or registry diagnostics. Use `--offline` to skip network-dependent doctor checks.

This command is read-only; the redacted bundle is written to stdout.
