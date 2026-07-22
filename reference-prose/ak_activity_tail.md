Follow the local activity log and print events as they are appended—a live CLI equivalent of the desktop activity stream.

**When to use it:** Use while another process runs `ak run` or other activity-producing commands. Press Ctrl-C or cancel the process to stop.

This command is read-only. It tails `~/.agentkit/activity/events.ndjson`; `AGENTKIT_HOME` overrides the base directory.
