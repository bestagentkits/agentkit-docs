Launch the AgentKit desktop GUI for point-and-click kit browsing, agent runs, and dashboards.

**When to use it:** When you prefer a graphical interface over CLI commands for day-to-day AgentKit work.

Read-only for the UI launch itself; underlying agent runs may write per-agent caches. Exits 0 on platforms where the GUI is not packaged; exit 4 when the binary was built without `-tags wails`.
