import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

import pkg from "../../package.json" with { type: "json" };

const PKG = "@ashlr/stack";
const CURRENT_VERSION = pkg.version;

/**
 * `stack upgrade` — lightweight self-update helper. Checks npm for the latest
 * @ashlr/stack version, prints a hint when a newer one exists. Does not
 * auto-install (too many opinions about bun vs npm vs brew).
 */
export const upgradeCommand = defineCommand({
  meta: {
    name: "upgrade",
    description: "Check npm for a newer @ashlr/stack release.",
  },
  async run() {
    intro("stack upgrade");
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG)}/latest`);
      if (!res.ok) {
        outroError(`npm registry returned ${res.status}.`);
        return;
      }
      const body = (await res.json()) as { version?: string };
      const latest = body.version;
      if (!latest) {
        outroError("npm registry response missing version field.");
        return;
      }
      if (latest === CURRENT_VERSION) {
        outro(colors.green(`Up to date (${latest}).`));
        return;
      }
      if (isNewer(latest, CURRENT_VERSION)) {
        console.log();
        console.log(
          `  ${colors.bold(CURRENT_VERSION)} ${colors.dim("→")} ${colors.bold(colors.green(latest))}`,
        );
        console.log();
        console.log(colors.dim("  Install:"));
        console.log(colors.dim(`    bun add -g ${PKG}   # or: npm i -g ${PKG}`));
        console.log();
        outro(colors.yellow("A newer version is available."));
      } else {
        outro(colors.dim(`Local version (${CURRENT_VERSION}) is ahead of npm (${latest}).`));
      }
    } catch (err) {
      outroError(`Couldn't reach npm: ${(err as Error).message}`);
    }
  },
});

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10));
  const pb = b.split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
