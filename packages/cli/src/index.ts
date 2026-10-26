#!/usr/bin/env bun
import { installSynchronousStdio } from "./lib/sync-stdout.ts";
import { printVersion } from "./lib/version.ts";

// Keep this literal here: the source-version release guard reads this declaration.
const VERSION = "0.2.2";

// Before any output: Bun can otherwise drop queued writes on process.exit().
installSynchronousStdio();
const argv = process.argv.slice(2);

// Preserve the companion handshake's precedence and local-only behavior.
if (argv.includes("--ashlr-handshake")) {
  const { buildHandshake } = await import("./lib/handshake.ts");
  process.stdout.write(`${JSON.stringify(buildHandshake(VERSION))}\n`);
} else if (argv.length === 1 && argv[0] === "--version") {
  console.log(VERSION);
} else if (
  argv.some((arg) => arg === "--version" || arg === "-v") &&
  argv.every((arg) => arg === "--version" || arg === "-v" || arg === "--json")
) {
  // Only recognized root options qualify. Subcommands, typos and passthrough
  // arguments must still reach normal command validation and dispatch.
  printVersion(VERSION, argv.includes("--json"));
} else {
  const end = argv.indexOf("--");
  const own = end < 0 ? argv : argv.slice(0, end);
  const helpOnly =
    (own.includes("--help") || own.includes("-h")) && !argv.some((arg) => !arg.startsWith("-"));
  const { run } = await import("./main.ts");
  await run(argv, VERSION, helpOnly);
}
