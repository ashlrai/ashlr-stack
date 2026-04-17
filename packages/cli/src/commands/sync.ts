import { defineCommand } from "citty";
import { readConfig, syncToPlatform } from "@ashlr/stack-core";
import { colors, intro, outro, outroError } from "../ui.ts";

const SUPPORTED = ["vercel", "railway", "fly"] as const;
type Platform = (typeof SUPPORTED)[number];

export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Push secrets to a deployment platform (via phantom sync).",
  },
  args: {
    platform: {
      type: "string",
      required: true,
      description: `One of: ${SUPPORTED.join(", ")}`,
    },
  },
  async run({ args }) {
    intro(`stack sync ${args.platform}`);
    if (!SUPPORTED.includes(args.platform as Platform)) {
      outroError(`Unsupported platform. Use: ${SUPPORTED.join(", ")}`);
      return;
    }
    const config = await readConfig();
    const entry = config.services[args.platform];
    if (!entry?.resource_id) {
      outroError(
        `No ${args.platform} project found in .stack.toml. Run \`stack add ${args.platform}\` first.`,
      );
      return;
    }
    await syncToPlatform(args.platform as Platform, entry.resource_id);
    outro(colors.green(`Secrets synced to ${args.platform}.`));
  },
});
