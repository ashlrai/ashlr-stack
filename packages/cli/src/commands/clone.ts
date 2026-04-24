import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { hasConfig, scanSource } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack clone <git-url> [dir]` — git clone the repo, then run `stack scan` in
 * the new checkout and surface next-step guidance. Treats committed
 * .stack.toml as authoritative when it exists.
 */
export const cloneCommand = defineCommand({
  meta: {
    name: "clone",
    description: "Clone a GitHub repo and auto-detect its Stack services.",
  },
  args: {
    url: { type: "positional", required: true, description: "GitHub / git URL to clone." },
    dir: { type: "positional", required: false, description: "Optional target directory." },
  },
  async run({ args }) {
    intro(`stack clone ${args.url}`);
    const url = String(args.url);

    if (!isAllowedGitUrl(url)) {
      outroError(
        "Only https:// and git@ URLs are allowed (no file://, no --option prefixes, no local paths).",
      );
      return;
    }

    const target = args.dir ? String(args.dir) : inferDirFromUrl(url);
    if (target.startsWith("-") || target.includes("..")) {
      outroError(`Refusing to clone into suspicious target path "${target}".`);
      return;
    }

    if (existsSync(target)) {
      outroError(`Target directory "${target}" already exists.`);
      return;
    }

    // `--` separates options from positional args so a crafted URL can't be
    // parsed as a git flag (e.g. --upload-pack=<cmd>).
    const result = spawnSync("git", ["clone", "--", url, target], { stdio: "inherit" });
    if (result.status !== 0) {
      outroError("git clone failed.");
      return;
    }

    const resolved = resolve(target);
    console.log();

    const committed = hasConfig(resolved);
    if (committed) {
      console.log(
        `  ${colors.green("●")} committed ${colors.bold(".stack.toml")} found — this repo is Stack-aware.`,
      );
      console.log(colors.dim("  Next steps:"));
      console.log(colors.dim(`    cd ${target}`));
      console.log(colors.dim("    stack doctor --fix     # verify, re-login for anything missing"));
      console.log(colors.dim(`    stack exec -- bun dev  # run with Phantom's proxy active`));
    } else {
      const hits = await scanSource(resolved);
      const highConfidence = hits.filter((h) => h.confidence === "high");
      if (hits.length === 0) {
        console.log(
          colors.dim("  No providers detected. You can still `cd in` and run `stack init`."),
        );
      } else {
        console.log(
          `  ${colors.bold(String(hits.length))} provider(s) detected in source (${highConfidence.length} high-confidence):`,
        );
        for (const h of hits) {
          const dot =
            h.confidence === "high"
              ? colors.green("●")
              : h.confidence === "medium"
                ? colors.yellow("●")
                : colors.dim("●");
          console.log(`    ${dot} ${h.provider.padEnd(12)} ${colors.dim(h.signals[0] ?? "")}`);
        }
        console.log(colors.dim("\n  Next steps:"));
        console.log(colors.dim(`    cd ${target}`));
        console.log(colors.dim("    stack scan --auto     # offer to wire up each provider"));
      }
    }

    outro(colors.green(`Cloned to ${target}.`));
  },
});

function inferDirFromUrl(url: string): string {
  // Handle https://github.com/org/repo(.git), git@github.com:org/repo.git, etc.
  const trimmed = url.replace(/\.git$/i, "").replace(/\/$/, "");
  return basename(trimmed);
}

/**
 * Accept https://, http:// (for self-hosted), and git@host:org/repo SSH URLs
 * only. Reject file://, ext::, --option-prefixed strings, empty strings, and
 * anything else that could cause git to do something other than clone a
 * remote repo.
 */
function isAllowedGitUrl(url: string): boolean {
  if (!url || url.length > 2048) return false;
  if (url.startsWith("-")) return false;
  if (/^file:/i.test(url)) return false;
  if (/^ext::/i.test(url)) return false;
  if (/^(https?:\/\/)/i.test(url)) return true;
  if (/^git@[\w.-]+:[\w./~-]+$/i.test(url)) return true;
  if (/^ssh:\/\//i.test(url)) return true;
  return false;
}
