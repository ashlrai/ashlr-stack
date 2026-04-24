import { isPhantomInstalled } from "@ashlr/stack-core";
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
export async function requirePhantom(): Promise<boolean> {
  if (await isPhantomInstalled()) return true;

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
