import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLeaderFleetContext } from "./leader-fleet-context.ts";

test("projects counts only and reports missing or invalid sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "leader-context-"));
  try {
    await mkdir(join(root, "queue"));
    const path = join(root, "queue", "status.json");
    expect((await collectLeaderFleetContext(root)).statusSource).toBe("missing");
    await writeFile(
      path,
      JSON.stringify({
        admission: { cap: 9, running: 2, secret: "do-not-copy" },
        lanes: { a: { queued: 3 }, b: { queued: 4 } },
        env: "do-not-copy",
      }),
    );
    const report = await collectLeaderFleetContext(root);
    expect(report.admission).toEqual({ cap: 9, running: 2 });
    expect(report.queueDepth).toBe(7);
    expect(JSON.stringify(report)).not.toContain("do-not-copy");
    await writeFile(path, JSON.stringify({ lanes: { a: { queued: -1 } } }));
    expect((await collectLeaderFleetContext(root)).queueDepth).toBeNull();
    await rm(path);
    await symlink("elsewhere", path);
    expect((await collectLeaderFleetContext(root)).statusSource).toBe("unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
