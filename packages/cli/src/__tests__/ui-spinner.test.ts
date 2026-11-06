import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { isInteractiveOutput, prompts } from "../ui.ts";

describe("isInteractiveOutput", () => {
  test("only a TTY outside CI is interactive", () => {
    expect(isInteractiveOutput({ isTTY: true }, {})).toBe(true);
    expect(isInteractiveOutput({ isTTY: true }, { CI: "1" })).toBe(false);
    expect(isInteractiveOutput({ isTTY: false }, {})).toBe(false);
    expect(isInteractiveOutput({}, {})).toBe(false);
  });
});

describe("prompts.spinner outside a TTY", () => {
  const originalWrite = process.stdout.write;
  const originalCI = process.env.CI;
  afterEach(() => {
    process.stdout.write = originalWrite;
    if (originalCI === undefined) Reflect.deleteProperty(process.env, "CI");
    else process.env.CI = originalCI;
  });

  // Cursor moves (\x1b[999D), erase (\x1b[J) and cursor hide/show — the
  // spinner's repaint machinery. Plain SGR colour codes are fine.
  const CURSOR_CONTROL = new RegExp(`${String.fromCharCode(27)}\\[(\\?25[lh]|\\d*[A-GJK])`);

  test("prints plain lines with no ANSI cursor codes", async () => {
    process.env.CI = "1";
    let out = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    const s = prompts.spinner();
    s.start("Wiring supabase…");
    s.message("still wiring");
    await new Promise((r) => setTimeout(r, 200)); // a real spinner repaints every 80ms
    s.stop("supabase wired");
    s.start("Wiring neon…");
    s.stop("neon failed", 2);

    expect(out).not.toMatch(CURSOR_CONTROL);
    expect(out).toContain("supabase wired");
    expect(out).toContain("neon failed");
    expect(out).not.toContain("still wiring");
  });

  test("piped output without CI contains no spinner control sequences", () => {
    const uiUrl = new URL("../ui.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        `
          import { prompts } from ${JSON.stringify(uiUrl)};
          if (process.stdout.isTTY || process.stderr.isTTY || process.env.CI) {
            throw new Error("expected piped output outside CI");
          }
          const spinner = prompts.spinner();
          spinner.start("working");
          spinner.message("still working");
          await new Promise((resolve) => setTimeout(resolve, 200));
          spinner.stop("finished");
          spinner.start("trying again");
          spinner.stop("failed", 2);
        `,
      ],
      { encoding: "utf8", env: { HOME: process.env.HOME }, timeout: 5000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toMatch(CURSOR_CONTROL);
    expect(output).not.toContain("\r");
    expect(output).toContain("finished");
    expect(output).toContain("failed");
    expect(output).not.toContain("still working");
  });

  test("other @clack/prompts exports pass through", () => {
    expect(typeof prompts.intro).toBe("function");
    expect(typeof prompts.isCancel).toBe("function");
  });
});
