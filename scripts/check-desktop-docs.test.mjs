import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Runs the source-only desktop-docs guard as part of `pnpm test` (and CI),
// so the screenshot/page/mirror invariants are enforced without a full build.
test("desktop-app usage docs pass the source guard", () => {
  const guard = join(dirname(fileURLToPath(import.meta.url)), "check-desktop-docs.mjs");
  const res = spawnSync(process.execPath, [guard], { encoding: "utf8" });
  assert.equal(res.status, 0, `check-desktop-docs.mjs failed:\n${res.stdout}\n${res.stderr}`);
});
