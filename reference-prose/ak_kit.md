`ak kit` groups the commands for working with AgentKit content kits — discovery, validation, installing and building, install-path lookup, and cleanup.

**When to use it:** Use it as the entry point whenever you work with kits directly: list bundled or overridden kits with `ak kit list-kits`, schema-check local `kit.yaml` files with `ak kit validate`, install or build a kit, resolve where a kit installs with `ak kit install-path`, or remove one with `ak kit uninstall`. This group level is read-only; the individual subcommands document their own on-disk effects.
