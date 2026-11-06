import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Write a fake `phantom` binary into `dir` that sandboxed runners and macOS
 * Gatekeeper will actually exec. An extensionless script written by a
 * non-platform process is refused ("bad interpreter: Operation not
 * permitted"), while a `phantom.sh` target with a `phantom` symlink at it
 * passes. Same workaround as packages/core/src/__tests__/_harness.ts.
 */
export function writePhantomShim(dir: string, script: string): string {
  const realPath = join(dir, "phantom.sh");
  const linkPath = join(dir, "phantom");
  writeFileSync(realPath, script);
  chmodSync(realPath, 0o755);
  try {
    symlinkSync(realPath, linkPath);
  } catch {
    writeFileSync(linkPath, script);
    chmodSync(linkPath, 0o755);
  }
  return linkPath;
}
