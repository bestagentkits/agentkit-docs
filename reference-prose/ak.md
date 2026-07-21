`ak` is the AgentKit command-line interface — a multi-agent toolkit for both power developers who script against the CLI and non-technical users working through the TUI or desktop GUI. It covers the full project lifecycle, with expert kit and skill commands available when you need finer control.

**When to use it:** Reach for `ak` as your daily driver for AgentKit work — onboarding a project with `ak init`, previewing refreshes with `ak update`, checking your setup with `ak doctor`, and running agent operations. Start with the top-level lifecycle commands and drop into the `ak kit` and `ak skill` families when a task needs more precise control.

The root command is read-only; each subcommand documents its own disk effects. Scripted `--json` output is wrapped in a versioned success envelope (`schema_version`, `kind`, `data`).
