import { spawn } from "node:child_process";
import { platform } from "node:os";
import { getProvider, getService, readConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { notInStackMessage } from "../lib/not-in-stack.ts";
import { colors, intro, outro, outroError } from "../ui.ts";

export const openCommand = defineCommand({
  meta: { name: "open", description: "Open a service's dashboard in your browser." },
  args: {
    service: { type: "positional", required: true, description: "Service name." },
  },
  async run({ args }) {
    intro(`stack open ${args.service}`);
    const config = await readConfig();
    const entry = getService(config, args.service);
    if (!entry) {
      outroError(notInStackMessage(args.service, Object.keys(config.services)));
      return;
    }
    const provider = await getProvider(args.service);
    const url = provider.dashboardUrl?.(entry);
    if (!url) {
      outroError(`${provider.displayName} has no dashboard URL configured.`);
      return;
    }

    const [cmd, cmdArgs] = openerFor(platform(), url);
    if (await launch(cmd, cmdArgs)) {
      outro(colors.green(`Opening ${url}`));
      return;
    }
    // No opener on this machine (headless box, container, minimal PATH):
    // the URL is still the useful answer, so print it and succeed.
    outro(`Couldn't launch a browser (${cmd} not available); open it by hand:`);
    console.log(url);
  },
});

/**
 * The program that opens `url` in the default browser. On Windows `start` is
 * a cmd.exe builtin, not an executable, so it cannot be spawned directly;
 * `rundll32 url.dll,FileProtocolHandler` takes the URL as one argument with
 * no shell parsing of `&` and friends.
 */
export function openerFor(os: NodeJS.Platform, url: string): [string, string[]] {
  if (os === "darwin") return ["open", [url]];
  if (os === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

/** Spawn a detached opener; resolves false instead of throwing when it can't start. */
function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
