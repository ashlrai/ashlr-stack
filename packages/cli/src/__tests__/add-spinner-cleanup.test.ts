import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";
import { runAdd } from "../commands/add.ts";
import { colors, prompts } from "../ui.ts";

test("runAdd stops its spinner and propagates a provisioning failure", async () => {
  const h = setupFakePhantom();
  const dir = mkdtempSync(join(tmpdir(), "stack-add-spinner-"));
  const previousCwd = process.cwd();
  const events: string[] = [];
  const spinner = spyOn(prompts, "spinner").mockReturnValue({
    start: (message) => events.push(`start: ${message}`),
    message: () => {},
    stop: (message) => events.push(`stop: ${message}`),
  });

  try {
    writeFileSync(
      join(dir, ".stack.toml"),
      '[stack]\nversion = "1"\n\n[services.supabase]\nprovider = "supabase"\nsecrets = []\n',
    );
    process.chdir(dir);

    const error: unknown = await runAdd({ service: "supabase" }).catch((err: unknown) => err);

    expect(error).toMatchObject({
      code: "SERVICE_ALREADY_ADDED",
      message: expect.stringContaining("already in this stack"),
    });
    expect(events).toEqual(["start: Wiring supabase…", `stop: ${colors.red("Failed.")}`]);
  } finally {
    spinner.mockRestore();
    process.chdir(previousCwd);
    h.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
