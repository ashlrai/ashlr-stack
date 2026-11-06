import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ASTRO_COMMAND, fetchServerPage } from "./cli-ref-server";

describe("CLI reference server readiness", () => {
  test("the actual Astro launch renders on Node after stdin EOF under CI", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-ref-server-"));
    const reservation = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        data(socket) {
          socket.end();
        },
      },
    });
    const port = reservation.port;
    reservation.stop(true);
    try {
      mkdirSync(join(root, "src/pages"), { recursive: true });
      symlinkSync(dirname(dirname(ASTRO_COMMAND[1])), join(root, "node_modules"), "dir");
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      // Exercise Vite's stdin shutdown listener before a page can satisfy readiness.
      writeFileSync(
        join(root, "astro.config.mjs"),
        `export default {
  integrations: [{ name: "stdin-eof-regression", hooks: {
    "astro:server:start": async () => {
      process.stdin.resume();
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  } }],
};`,
      );
      writeFileSync(
        join(root, "src/pages/index.astro"),
        `---
const runtime = process.release.name;
const bun = String(!!process.versions.bun);
---
<p data-runtime={runtime} data-bun={bun}>ready</p>
`,
      );
      const response = await fetchServerPage(
        [...ASTRO_COMMAND, "dev", "--root", root, "--host", "127.0.0.1", "--port", String(port)],
        `http://127.0.0.1:${port}/`,
      );
      expect(response.status).toBe(200);
      const runtimes: Array<{ node: string | null; bun: string | null }> = [];
      await new HTMLRewriter()
        .on("p", {
          element(element) {
            runtimes.push({
              node: element.getAttribute("data-runtime"),
              bun: element.getAttribute("data-bun"),
            });
          },
        })
        .transform(response)
        .text();
      expect(runtimes).toEqual([{ node: "node", bun: "false" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
