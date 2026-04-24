import { type ProviderContext, getProvider } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError } from "../ui.ts";

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Refresh OAuth / PAT credentials for a specific provider.",
  },
  args: {
    service: { type: "positional", required: true, description: "Provider name." },
  },
  async run({ args }) {
    intro(`stack login ${args.service}`);
    try {
      const provider = await getProvider(args.service);
      const ctx: ProviderContext = {
        cwd: process.cwd(),
        interactive: process.stdout.isTTY === true,
        log: logEvent,
      };
      await provider.login(ctx);
      outro(colors.green(`${provider.displayName}: signed in.`));
    } catch (err) {
      outroError((err as Error).message);
    }
  },
});
