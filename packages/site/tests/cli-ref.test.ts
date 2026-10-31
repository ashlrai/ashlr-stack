import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { CLI_COMMANDS } from "../src/lib/cli-ref.generated";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");
const SITE = join(import.meta.dir, "..");
// Bun 1.2 hoists Astro to the root; newer installs may keep it site-local.
const ASTRO_ENTRY = join(dirname(require.resolve("astro/package.json")), "astro.js");
// Astro's executable uses Node. process.execPath here is the Bun test runner,
// which also varies across the daily CI matrix; do not force Astro onto it.
const ASTRO_RUNTIME = Bun.which("node");
if (!ASTRO_RUNTIME) throw new Error("Node is required to render the Astro CLI reference");

async function fetchServerPage(command: string[], url: string, attempts = 600): Promise<Response> {
  const server = Bun.spawn(command, {
    cwd: SITE,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  // Drain immediately so a full stderr pipe cannot stall server startup.
  const stderr = new Response(server.stderr).text();
  let reason = "Astro server did not become ready";
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url);
      } catch {
        if (server.exitCode !== null) {
          reason = "Astro server exited before becoming ready";
          break;
        }
        await Bun.sleep(100);
        continue;
      }
      // Finish reading before cleanup shuts down the server connection.
      return new Response(await response.arrayBuffer(), response);
    }
  } finally {
    server.kill();
    await server.exited;
  }
  throw new Error(`${reason} (exit code ${server.exitCode}):\n${await stderr}`);
}

/** Top-level command names from `stack --help`'s USAGE line (citty's subCommands, in order). */
function cliSubCommands(): string[] {
  // citty prints help through consola, which drops `log` output when
  // NODE_ENV=test (as under `bun test`), so run the CLI as a user would.
  const { TEST: _test, ...env } = process.env;
  const result = spawnSync(process.execPath, [CLI_ENTRY, "--help"], {
    encoding: "utf8",
    env: { ...env, NODE_ENV: "production", NO_COLOR: "1", CI: "1", STACK_TELEMETRY: "0" },
  });
  const usage = `${result.stdout}${result.stderr}`.match(/USAGE `?stack \[OPTIONS\] ([\w|-]+)/);
  if (!usage) throw new Error(`no USAGE line in stack --help:\n${result.stdout}${result.stderr}`);
  return usage[1].split("|");
}

type NamedCommand = { name: string; subcommands?: NamedCommand[] };

function duplicateNames(commands: NamedCommand[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  function visit(entries: NamedCommand[]) {
    for (const command of entries) {
      if (seen.has(command.name)) duplicates.add(command.name);
      seen.add(command.name);
      if (command.subcommands) visit(command.subcommands);
    }
  }
  visit(commands);
  return [...duplicates];
}

describe("site CLI reference", () => {
  test("documents exactly the CLI's top-level commands, in --help order", () => {
    const cli = cliSubCommands();
    expect(cli.length).toBeGreaterThan(0);
    expect(CLI_COMMANDS.map((c) => c.name.replace(/^stack /, ""))).toEqual(cli);
  });

  test("reports each duplicate command name, including nested commands", () => {
    expect(
      duplicateNames([
        { name: "stack env", subcommands: [{ name: "stack env show" }] },
        { name: "stack env", subcommands: [{ name: "stack env show" }] },
        { name: "stack env" },
      ]),
    ).toEqual(["stack env", "stack env show"]);
  });

  test("contains no duplicate command names", () => {
    expect(duplicateNames(CLI_COMMANDS)).toEqual([]);
  });

  test("Astro runs on Node independently of the Bun test runner", async () => {
    const probe = Bun.spawn([
      ASTRO_RUNTIME, "-p",
      'JSON.stringify({ runtime: process.release.name, bun: !!process.versions.bun })',
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ runtime: "node", bun: false });
  });

  test("startup failures include the exit code and drained stderr", async () => {
    // More than a pipe buffer: waiting for exit before draining would deadlock.
    const diagnostic = `startup failure: ${"x".repeat(128 * 1024)}`;
    const command = [
      process.execPath, "-e",
      'console.error("startup failure: " + "x".repeat(128 * 1024)); process.exit(23)',
    ];
    await expect(fetchServerPage(command, "http://127.0.0.1:0")).rejects.toThrow(
      `Astro server exited before becoming ready (exit code 23):\n${diagnostic}`,
    );
  });

  test("startup timeouts stop the server and include stderr", async () => {
    const command = [
      process.execPath, "-e",
      'console.error("startup stalled"); setInterval(() => {}, 1000)',
    ];
    await expect(fetchServerPage(command, "http://127.0.0.1:0", 20)).rejects.toThrow(
      /Astro server did not become ready \(exit code .*\):\nstartup stalled/,
    );
  }, 10_000);

  test("rendered command links resolve to their documentation headings", async () => {
    // The temporary listener must never satisfy readiness with an empty HTTP 200.
    const reservation = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: { data(socket) { socket.end(); } },
    });
    const port = reservation.port;
    reservation.stop(true);
    const response = await fetchServerPage(
      [ASTRO_RUNTIME, ASTRO_ENTRY, "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      `http://127.0.0.1:${port}/docs/cli`,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    const links: string[] = [];
    const ids: string[] = [];
    const headings: Array<{ id: string; text: string }> = [];
    await new HTMLRewriter()
      .on(".not-prose a", { element(element) { links.push(element.getAttribute("href") ?? ""); } })
      .on("[id]", { element(element) { ids.push(element.getAttribute("id") ?? ""); } })
      .on("h2[id]", {
        element(element) { headings.push({ id: element.getAttribute("id") ?? "", text: "" }); },
        text(chunk) { headings[headings.length - 1].text += chunk.text; },
      })
      .transform(new Response(html)).text();

    expect(links.length, `CLI reference response: ${html.length} HTML bytes`).toBe(CLI_COMMANDS.length);
    for (const [index, href] of links.entries()) {
      expect(href, CLI_COMMANDS[index].name).toMatch(/^#[^#]+$/);
      const id = decodeURIComponent(href.slice(1));
      expect(ids.filter((candidate) => candidate === id), href).toHaveLength(1);
      expect(headings.find((heading) => heading.id === id)?.text.trim(), href).toBe(CLI_COMMANDS[index].name);
    }
  }, 120_000);
});
