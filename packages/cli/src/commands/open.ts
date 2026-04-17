import { spawn } from "node:child_process";
import { platform } from "node:os";
import { defineCommand } from "citty";
import { getProvider, readConfig } from "@ashlr/stack-core";
import { colors, intro, outro, outroError } from "../ui.ts";

export const openCommand = defineCommand({
  meta: { name: "open", description: "Open a service's dashboard in your browser." },
  args: {
    service: { type: "positional", required: true, description: "Service name." },
  },
  async run({ args }) {
    intro(`stack open ${args.service}`);
    const config = await readConfig();
    const entry = config.services[args.service];
    if (!entry) {
      outroError(`${args.service} is not in this stack.`);
      return;
    }
    const provider = await getProvider(args.service);
    const url = provider.dashboardUrl?.(entry);
    if (!url) {
      outroError(`${provider.displayName} has no dashboard URL configured.`);
      return;
    }

    const opener =
      platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
    outro(colors.green(`Opening ${url}`));
  },
});
