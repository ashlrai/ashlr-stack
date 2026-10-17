import { isPhantomInstalled, removeSecret } from "@ashlr/stack-core";
import { colors } from "../ui.ts";

/**
 * Pre-flight guard for commands that shell out to Phantom.
 *
 * Usage:
 *   if (!(await requirePhantom())) return;
 *
 * Prints a user-friendly install hint, sets exit code 1, and returns false
 * when Phantom is absent so callers can early-return without their own
 * try/catch.
 */
export async function requirePhantom(opts: { json?: boolean } = {}): Promise<boolean> {
  if (await isPhantomInstalled()) return true;

  if (opts.json) {
    // `--json` callers promise one JSON object on stdout, so the install hint
    // goes in the error field instead of a decorated block.
    process.stdout.write(
      `${JSON.stringify({ error: "Phantom Secrets isn't installed. Install it with `brew install ashlrai/phantom/phantom` (or see phm.dev), then re-run this command." })}\n`,
    );
    process.exit(1);
  }

  console.log();
  console.log(`  ${colors.red("✗")} Phantom Secrets isn't installed.`);
  console.log();
  console.log("  Stack uses Phantom for secret storage. Install it:");
  console.log();
  console.log(`      ${colors.bold("brew install ashlrai/phantom/phantom")}`);
  console.log();
  console.log("  Or visit phm.dev for other install options.");
  console.log();
  console.log("  Then re-run this command.");
  console.log();
  process.exit(1);
}

/**
 * Remove vault secrets on behalf of a human-run command and report what
 * Phantom kept. Phantom Secrets (>= 0.7.3) asks for a typed confirmation per
 * secret in an attached terminal and removes nothing headlessly, so Stack
 * hands it the terminal when there is one and otherwise lists the leftovers
 * instead of claiming they were deleted. `quiet` skips that list for callers
 * that report the kept names themselves (`stack remove --json`).
 */
export async function removeVaultSecrets(
  secrets: string[],
  opts: { interactive?: boolean; quiet?: boolean } = {},
): Promise<string[]> {
  const interactive =
    opts.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const kept: string[] = [];
  for (const secret of secrets) {
    let removed = false;
    try {
      removed = await removeSecret(secret, undefined, { interactive });
    } catch {
      removed = false;
    }
    if (!removed) kept.push(secret);
  }
  if (kept.length > 0 && !opts.quiet) {
    console.log();
    console.log(
      `  ${colors.yellow("!")} Phantom kept ${kept.length} secret(s). Remove them in your terminal if you no longer need them:`,
    );
    for (const secret of kept) console.log(`      ${colors.bold(`phantom remove ${secret}`)}`);
  }
  return kept;
}
