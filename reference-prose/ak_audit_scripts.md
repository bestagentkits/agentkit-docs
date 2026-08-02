Run a read-only advisory audit of local AgentKit hook scripts and skill scripts. It scans file text for language, dependencies, entrypoints, and heuristic risk findings—it never executes scripts and does not block installs.

**When to use it:** Run before installing or updating kits, or in CI to inspect advisory risk changes. Use `ak audit` for install drift checks against recorded fingerprints.

Bounded local file reads only; no network calls and no script execution.
