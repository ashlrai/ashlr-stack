import { disableTelemetry, enableTelemetry, isTelemetryEnabled } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro } from "../ui.ts";

const statusSub = defineCommand({
  meta: { name: "status", description: "Show telemetry opt-in status." },
  async run() {
    intro("stack telemetry status");
    const enabled = await isTelemetryEnabled();
    console.log();
    console.log(
      `  ${enabled ? colors.green("●") : colors.dim("○")}  telemetry ${enabled ? colors.green("enabled") : colors.dim("disabled")}`,
    );
    console.log();
    outro(
      enabled
        ? "Run `stack telemetry disable` to opt out."
        : "Run `stack telemetry enable` to opt in. See docs/PRIVACY.md.",
    );
  },
});

const enableSub = defineCommand({
  meta: { name: "enable", description: "Opt in to anonymous usage telemetry." },
  async run() {
    intro("stack telemetry enable");
    await enableTelemetry();
    outro(colors.green("✓ telemetry enabled. Thanks — it helps us prioritize."));
  },
});

const disableSub = defineCommand({
  meta: { name: "disable", description: "Opt out of telemetry." },
  async run() {
    intro("stack telemetry disable");
    await disableTelemetry();
    outro(colors.green("✓ telemetry disabled."));
  },
});

export const telemetryCommand = defineCommand({
  meta: {
    name: "telemetry",
    description: "Opt into / out of anonymous usage telemetry. See docs/PRIVACY.md.",
  },
  subCommands: {
    status: statusSub,
    enable: enableSub,
    disable: disableSub,
  },
});
