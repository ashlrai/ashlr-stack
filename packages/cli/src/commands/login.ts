import { type ProviderContext, getProvider, headlessAuthError } from "@ashlr/stack-core";
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
      // No terminal (agent, CI): name the command a person has to run, as
      // `stack add` does, instead of stopping at "no valid key".
      await provider.login(ctx).catch((err: unknown) => {
        throw headlessAuthError(err, provider, ctx.interactive, "login");
      });
      outro(colors.green(`${provider.displayName}: signed in.`));
    } catch (err) {
      outroError((err as Error).message);
    }
  },
});
