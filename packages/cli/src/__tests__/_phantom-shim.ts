import { writeShimmedExecutable } from "../../../core/src/__tests__/_harness.ts";

/** Install the existing shell fixture through the shared executable helper. */
export function writePhantomShim(dir: string, script: string): string {
  return writeShimmedExecutable(dir, "phantom", script);
}
