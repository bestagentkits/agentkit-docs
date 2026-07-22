Refresh an installed kit and remove stale generated files. Uses the same snapshot-backed path as `ak kit init --force`.

**When to use it:** After an AgentKit upgrade, bundled export changes, or when `ak audit` reports plugin drift. Paid kits require remote or explicit `--kits-dir`.

Snapshots AK-owned content, removes stale generated files, and writes current kit output.
