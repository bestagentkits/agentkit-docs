Mark all checkboxes in a phase file as done by toggling `- [ ]` to `- [x]`. Already-checked boxes are left unchanged—idempotent.

**When to use it:** When a plan phase is complete and you want to record progress in the phase file.

Mutates the phase file in-place with an atomic write.
