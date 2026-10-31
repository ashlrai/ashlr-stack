import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "index.ts");

test.each(["absolute", "relative"])(
  "scan preserves leading and trailing spaces in an %s project path",
  (kind) => {
    const root = mkdtempSync(join(tmpdir(), "stack scan path "));
    try {
      const projectName = " my app ";
      const project = join(root, projectName);
      const decoy = join(root, projectName.trim());
      mkdirSync(project);
      mkdirSync(decoy);
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.45.0" } }),
      );
      writeFileSync(join(project, "fly.toml"), "app = 'my-app'\n");
      writeFileSync(join(decoy, "package.json"), JSON.stringify({ dependencies: { openai: "1" } }));

      const result = spawnSync(
        "bun",
        [cli, "scan", "--json", "--path", kind === "absolute" ? project : projectName],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, CI: "1", NO_COLOR: "1" },
          timeout: 15_000,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        hits: [
          { provider: "fly", confidence: "high", sources: ["fly.toml"] },
          {
            provider: "supabase",
            confidence: "high",
            sources: ["package.json:@supabase/supabase-js"],
          },
        ],
      });
      expect(existsSync(join(project, ".stack.toml"))).toBe(false);
      expect(existsSync(join(decoy, ".stack.toml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  20_000,
);
