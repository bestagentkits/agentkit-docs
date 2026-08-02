Manage AgentKit plan directories for planning, tracking progress, and automating plan operations in CI. Plan format uses `plan.md` plus `phase-NN-*.md` files.

**When to use it:** Use subcommands for creating plans, checking off phases, validating format, viewing kanban boards, or parsing structured views. `create`, `check`, and `add-phase` write plan files; `parse`, `validate`, `status`, and `kanban` are read-only.

Each subcommand documents its own disk effects.
