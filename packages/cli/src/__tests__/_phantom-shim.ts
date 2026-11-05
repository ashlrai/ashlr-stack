import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Install a fake `phantom` executable into `bin` (put `bin` first on the
 * child's PATH to shadow any real install). As in core's `_harness.ts`, the
 * script is written under a real name and `phantom` is a symlink at it —
 * macOS Gatekeeper's provenance policy refuses to exec an unsigned regular
 * file literally named `phantom` written by a non-platform process — with a
 * direct-file fallback where symlinks are unavailable.
 *
 * `shimName` is the real file's name. `#!/bin/sh` scripts use the default
 * `phantom.sh`; a `#!bun` (or `#!node`) script must keep a JS-meaningful
 * extension like `.mjs`, or the runtime treats the file as a shell script.
 */
export function linkPhantomShim(bin: string, script: string, shimName = "phantom.sh"): void {
  const realPath = join(bin, shimName);
  const binPath = join(bin, "phantom");
  writeFileSync(realPath, script);
  chmodSync(realPath, 0o700);
  try {
    symlinkSync(realPath, binPath);
  } catch {
    writeFileSync(binPath, script);
    chmodSync(binPath, 0o700);
  }
}
