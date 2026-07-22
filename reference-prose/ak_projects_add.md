Register a project directory in the global AgentKit registry. If the directory is already registered, the entry is refreshed.

**When to use it:** Onboarding a project that was cloned or moved from another machine. Called automatically by `ak new` and `ak init`.

Writes `~/.agentkit/projects.json` atomically.
