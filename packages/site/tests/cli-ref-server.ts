import { dirname, join } from "node:path";

const SITE = join(import.meta.dir, "..");
// Bun 1.2 hoists Astro to the root; newer installs may keep it site-local.
const ASTRO_ENTRY = join(dirname(require.resolve("astro/package.json")), "astro.js");
// Astro's executable uses Node. process.execPath here is the Bun test runner,
// which also varies across the daily CI matrix; do not force Astro onto it.
const ASTRO_RUNTIME = Bun.which("node");
if (!ASTRO_RUNTIME) throw new Error("Node is required to render the Astro CLI reference");

// Share the exact launch command with the startup regression, not just a Node probe.
export const ASTRO_COMMAND = [ASTRO_RUNTIME, ASTRO_ENTRY];

export async function fetchServerPage(
  command: string[],
  url: string,
  attempts = 600,
): Promise<Response> {
  const server = Bun.spawn(command, {
    cwd: SITE,
    // Vite treats stdin EOF as shutdown unless CI is exactly "true".
    // The test owns server lifetime; neither prompts nor inherited stdin should.
    env: { ...process.env, CI: "true", ASTRO_TELEMETRY_DISABLED: "1" },
    stdin: "ignore",
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
