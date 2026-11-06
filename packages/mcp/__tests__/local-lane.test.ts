import { afterAll, beforeAll, expect, test } from "bun:test";
import { request } from "node:http";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startLaneBridge } from "../src/local-lane.ts";

// The stack server lists tools without the stack CLI, so it is a self-contained upstream.
const stack = { id: "stack", command: process.execPath, args: [join(import.meta.dir, "..", "src", "server.ts")] };
const missing = { id: "missing", command: "ashlr-no-such-binary-for-lane-test", args: [] };
let bridge: Awaited<ReturnType<typeof startLaneBridge>>;

beforeAll(async () => {
  bridge = await startLaneBridge({ upstreams: [stack, missing] });
}, 60_000);
afterAll(() => bridge?.close());

/** POST /mcp with explicit headers and resolve to the status code. */
const post = (headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: new URL(bridge.endpoint).port, path: "/mcp", method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } },
      (res) => (res.resume(), resolve(res.statusCode ?? 0)),
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  });

test("binds loopback, prefixes tools, and reports a dead upstream without throwing", async () => {
  expect(bridge.endpoint.startsWith("http://127.0.0.1:")).toBe(true);
  expect(bridge.status.stack).toEqual({ ok: true, tools: expect.any(Number) });
  expect(bridge.status.missing?.ok).toBe(false);
  expect(bridge.toolNames.length).toBeGreaterThan(0);
  expect(bridge.toolNames.every((name) => name.startsWith("stack__"))).toBe(true);
});

test("lists tools and routes calls over streamable HTTP", async () => {
  const client = new Client({ name: "lane-test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(bridge.endpoint)));
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...bridge.toolNames].sort());
    const unknown = await client.callTool({ name: "stack__no_such_tool", arguments: {} });
    expect(unknown.isError).toBe(true);
  } finally {
    await client.close();
  }
});

test("rejects a rebinding Host header and any browser Origin", async () => {
  expect(await post({ host: "evil.example" })).toBe(403);
  expect(await post({ origin: "https://evil.example" })).toBe(403);
});


test("closing the bridge closes its idle connection and preserves unrelated sockets", async () => {
  const other = createServer((socket) => socket.on("data", (data) => socket.write(data)));
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  const otherSocket = createConnection((other.address() as AddressInfo).port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    otherSocket.once("connect", resolve);
    otherSocket.once("error", reject);
  });
  const owned = await startLaneBridge({ upstreams: [] });
  const port = Number(new URL(owned.endpoint).port);
  const socket = createConnection(port, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await owned.close();
    await closed;
    expect(socket.destroyed).toBe(true);
    const echo = new Promise<string>((resolve, reject) => {
      otherSocket.once("data", (data) => resolve(data.toString()));
      otherSocket.once("error", reject);
    });
    otherSocket.write("still-owned-by-other-server");
    expect(await echo).toBe("still-owned-by-other-server");
    const replacement = await startLaneBridge({ upstreams: [], port });
    await replacement.close();
  } finally {
    socket.destroy();
    otherSocket.destroy();
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }
});
