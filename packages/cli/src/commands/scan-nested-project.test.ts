import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "index.ts");
let root: string;
let nested: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stack-scan-nested-"));
  nested = join(root, "apps", "api");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(root, "apps", "empty"));
  mkdirSync(join(root, "apps", "sibling"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { stripe: "1", openai: "1" } }),
  );
  writeFileSync(join(root, "fly.toml"), 'app = "parent"\n');
  writeFileSync(
    join(nested, "package.json"),
    JSON.stringify({ dependencies: { "@stripe/stripe-js": "1", resend: "1" } }),
  );
  writeFileSync(join(nested, "vercel.json"), "{}\n");
  writeFileSync(join(root, "apps", "sibling", "railway.json"), "{}\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scan(cwd: string, path?: string) {
  const result = spawnSync(
    "bun",
    [cli, "scan", "--json", "--confidence", "low", ...(path ? ["--path", path] : [])],
    { cwd, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, timeout: 15_000 },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

describe("stack scan nested project boundary", () => {
  test("scans the parent without discovering nested projects", () => {
    expect(scan(root)).toEqual({
      hits: [
        { provider: "fly", confidence: "high", sources: ["fly.toml"] },
        { provider: "openai", confidence: "high", sources: ["package.json:openai"] },
        { provider: "stripe", confidence: "high", sources: ["package.json:stripe"] },
      ],
    });
  }, 30_000);

  test("scans only the selected nested project, by path or working directory", () => {
    const expected = {
      hits: [
        { provider: "resend", confidence: "high", sources: ["package.json:resend"] },
        { provider: "stripe", confidence: "high", sources: ["package.json:@stripe/stripe-js"] },
        { provider: "vercel", confidence: "high", sources: ["vercel.json"] },
      ],
    };
    expect(scan(root, join("apps", "api"))).toEqual(expected);
    expect(scan(root, nested)).toEqual(expected);
    expect(scan(nested)).toEqual(expected);
    expect(existsSync(join(root, ".stack.toml"))).toBe(false);
    expect(existsSync(join(nested, ".stack.toml"))).toBe(false);
  }, 60_000);

  test("an empty nested project does not inherit parent or sibling signals", () => {
    expect(scan(root, join("apps", "empty"))).toEqual({ hits: [] });
  }, 30_000);
});
