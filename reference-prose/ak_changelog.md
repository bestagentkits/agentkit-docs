Show verified CLI, app, and kit release changelogs by reading signed, public changelog metadata from the AgentKit release domain. The default view includes CLI, desktop app, engineer kit, and marketing kit entries.

**When to use it:** Inspect a release before updating or compare history since the installed binary. Use `--since-current` to show releases newer than the current `ak` binary.

This command is read-only. Verified cache data may be read when the release domain is unavailable; it never writes cache or update state.
