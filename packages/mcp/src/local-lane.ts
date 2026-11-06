#!/usr/bin/env bun
/**
 * Loopback MCP bridge for the local lane harness (RQ-LOCAL-1). Runs the locus, lexicon and
 * stack MCP servers as stdio children and republishes their tools as `<server>__<tool>` on
 * http://127.0.0.1:<port>/mcp. No host option; foreign Host headers (DNS rebinding) and any
 * request carrying an Origin (a browser) are refused.
 *
 *   bun packages/mcp/src/local-lane.ts serve [--port <n>]
 *   bun packages/mcp/src/local-lane.ts smoke [--json]
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readServerVersion } from "./stack-bin.ts";

const HOST = "127.0.0.1";
const SEP = "__";

export interface UpstreamSpec {
  id: string;
  command: string;
  args: string[];
}
export interface UpstreamStatus {
  ok: boolean;
  tools: number;
  error?: string;
}
type Route = { client: Client; tool: string };

/** locus-mcp and lexicon come from PATH; stack is this package's own stdio server. */
export function defaultUpstreams(): UpstreamSpec[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    { id: "locus", command: "locus-mcp", args: [] },
    { id: "lexicon", command: "lexicon", args: ["mcp"] },
    { id: "stack", command: process.execPath, args: [join(here, "server.ts")] },
  ];
}

export async function startLaneBridge(opts: { upstreams?: UpstreamSpec[]; port?: number } = {}) {
  const version = readServerVersion();
  const routes = new Map<string, Route>();
  const listed: Tool[] = [];
  const status: Record<string, UpstreamStatus> = {};
  const clients: Client[] = [];

  // Child stderr is discarded so nothing an upstream logs reaches this process's output.
  await Promise.all(
    (opts.upstreams ?? defaultUpstreams()).map(async (spec) => {
      const client = new Client({ name: "ashlr-local-lane", version });
      try {
        await client.connect(new StdioClientTransport({ ...spec, stderr: "ignore" }));
        const { tools } = await client.listTools();
        clients.push(client);
        for (const tool of tools) {
          const name = `${spec.id}${SEP}${tool.name}`;
          routes.set(name, { client, tool: tool.name });
          listed.push({ ...tool, name });
        }
        status[spec.id] = { ok: true, tools: tools.length };
      } catch (err) {
        status[spec.id] = { ok: false, tools: 0, error: (err as Error).message };
        await client.close().catch(() => {});
      }
    }),
  );

  const http = createServer((req, res) => {
    handle(req, res, { listed, routes, version, port: () => boundPort() }).catch(
      (err: Error) => !res.headersSent && res.writeHead(500).end(err.message),
    );
  });
  const sockets = new Set<Socket>();
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const boundPort = () => (http.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port ?? 0, HOST, () => resolve());
  });
  const endpoint = `http://${HOST}:${boundPort()}/mcp`;
  let closePromise: Promise<void> | undefined;
  return {
    endpoint,
    status,
    toolNames: listed.map((t) => t.name),
    close(): Promise<void> {
      closePromise ??= (async () => {
        const closed = new Promise<void>((resolve, reject) => {
          http.once("close", resolve);
          http.once("error", reject);
          // Bun 1.2 drops its native server handle in close(), making a later
          // closeAllConnections() ineffective. Force-close this server's own
          // connections first. Bun 1.2 also stops its listener here; Node keeps
          // it open, so close that listener only when address() still exists.
          http.closeAllConnections();
          if (http.address() !== null) {
            http.close((error) => (error ? reject(error) : resolve()));
          }
        });
        // Retain explicit ownership cleanup for compatibility socket wrappers.
        for (const socket of sockets) socket.destroy();
        await closed;
        await Promise.all(clients.map((c) => c.close().catch(() => {})));
      })();
      return closePromise;
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { listed: Tool[]; routes: Map<string, Route>; version: string; port: () => number },
) {
  if (req.url !== "/mcp") return void res.writeHead(404).end();
  if (req.headers.origin !== undefined) return void res.writeHead(403).end("no browser origins");
  // Stateless: one protocol server per request, sharing the upstream clients.
  const server = new Server(
    { name: "ashlr-local-lane", version: ctx.version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ctx.listed }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const route = ctx.routes.get(params.name);
    if (!route)
      return { content: [{ type: "text", text: `Unknown tool: ${params.name}` }], isError: true };
    return route.client.callTool({ name: route.tool, arguments: params.arguments ?? {} });
  });
  const hosts = [`${HOST}:${ctx.port()}`, `localhost:${ctx.port()}`];
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: hosts,
  });
  res.on("close", () => void server.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Bridge on an ephemeral port, list tools over HTTP, and make one routed read-only call. */
export async function runSmoke(opts: { upstreams?: UpstreamSpec[] } = {}) {
  const bridge = await startLaneBridge(opts);
  const client = new Client({ name: "ashlr-local-lane-smoke", version: readServerVersion() });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.endpoint)));
    const { tools } = await client.listTools();
    // lexicon's list_terms only reads lexicon files, so it is safe to call from a smoke test.
    const name = `lexicon${SEP}list_terms`;
    const callOk = tools.some((t) => t.name === name)
      ? await client.callTool({ name, arguments: {} }).then(
          (r) => !r.isError,
          () => false,
        )
      : false;
    const upstreamsOk = Object.values(bridge.status).every((s) => s.ok && s.tools > 0);
    return {
      ok: upstreamsOk && callOk,
      endpoint: bridge.endpoint,
      upstreams: bridge.status,
      tools: tools.length,
      call: { name, ok: callOk },
    };
  } finally {
    await client.close().catch(() => {});
    await bridge.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "smoke") {
    const report = await runSmoke();
    if (rest.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.log(`${report.ok ? "PASS" : "FAIL"} ${report.endpoint} tools=${report.tools}`);
    return report.ok ? 0 : 1;
  }
  if (command === "serve") {
    const i = rest.indexOf("--port");
    const port = i === -1 ? 0 : Number(rest[i + 1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error("--port must be an integer from 0 to 65535");
      return 2;
    }
    const bridge = await startLaneBridge({ port });
    console.error(`ashlr local lane on ${bridge.endpoint}`);
    for (const [id, s] of Object.entries(bridge.status)) {
      if (!s.ok) console.error(`  ${id} unavailable: ${s.error}`);
    }
    process.once("SIGINT", () => void bridge.close().then(() => process.exit(0)));
    return new Promise<number>(() => {});
  }
  console.error("usage: local-lane.ts serve [--port <n>] | smoke [--json]");
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
