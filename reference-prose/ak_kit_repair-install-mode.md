Repair mixed Claude Code native and project-plugin install state by keeping the native install and deactivating fingerprinted project-plugin state.

**When to use it:** After `ak doctor --fix` reports a mixed-install-mode finding, or directly after reviewing plugin cleanup. Does not reinstall or guess the original kit source.

Takes recovery snapshots and preserves native and user-modified files. `--keep native` is required.
