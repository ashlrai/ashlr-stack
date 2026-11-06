import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFleetRow,
  openFleetFile,
  parseFleetJsonl,
  readFleetJson,
  readFleetJsonl,
  readFleetText,
} from "./fleet-jsonl.ts";

async function fixture(files: Record<string, string>, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "fleet-jsonl-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isFleetRow accepts only plain objects", () => {
  expect(isFleetRow({})).toBe(true);
  for (const value of [null, undefined, [], [1], "x", 5, true])
    expect(isFleetRow(value)).toBe(false);
});

test("readFleetText reads regular files and reports missing, oversized and non-file sources", () =>
  fixture({ "ok.log": "line\n" }, async (dir) => {
    expect(await readFleetText(join(dir, "ok.log"))).toEqual({ status: "ok", text: "line\n" });
    expect((await readFleetText(join(dir, "absent"))).status).toBe("missing");
    await mkdir(join(dir, "sub"));
    for (const ioStatus of [undefined, "unavailable"] as const)
      expect(await readFleetText(join(dir, "sub"), { ioStatus })).toEqual({
        status: ioStatus ?? "invalid",
        text: "",
      });
    await symlink(join(dir, "ok.log"), join(dir, "link"));
    expect((await readFleetText(join(dir, "link"))).status).toBe("invalid");
    await writeFile(join(dir, "big"), "x".repeat(33));
    expect((await readFleetText(join(dir, "big"), { maxBytes: 32 })).status).toBe("invalid");
    expect((await readFleetText(join(dir, "big"), { maxBytes: 33 })).status).toBe("ok");
  }));

test("readFleetText enforces the cap at read time, not only at stat", async () => {
  // procfs entries stat as zero bytes but produce content at read: the same
  // stat-vs-read gap a mid-read growth exploits, on a real file, no timing.
  if (!existsSync("/proc/self/status") || statSync("/proc/self/status").size !== 0) return;
  for (const maxBytes of [0, 1]) {
    expect(await readFleetText("/proc/self/status", { maxBytes })).toEqual({
      status: "invalid",
      text: "",
    });
  }
  expect(
    await readFleetText("/proc/self/status", { maxBytes: 1, ioStatus: "unavailable" }),
  ).toEqual({
    status: "unavailable",
    text: "",
  });
});

test("readFleetText returns exact tiny and empty files without provisioning the cap", () =>
  fixture({ "tiny.log": "x", "empty.log": "" }, async (dir) => {
    expect(await readFleetText(join(dir, "tiny.log"), { maxBytes: 4 })).toEqual({
      status: "ok",
      text: "x",
    });
    expect(await readFleetText(join(dir, "empty.log"), { maxBytes: 0 })).toEqual({
      status: "ok",
      text: "",
    });
    expect((await readFleetText(join(dir, "tiny.log"), { maxBytes: 0 })).status).toBe("invalid");
    for (const maxBytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await readFleetText(join(dir, "tiny.log"), { maxBytes })).status).toBe("invalid");
    }
    // Isolate allocation instrumentation in a child to avoid modifying other tests.
    const moduleUrl = new URL("./fleet-jsonl.ts", import.meta.url).href;
    const source = `
      const { readFleetText } = await import(${JSON.stringify(moduleUrl)});
      const allocations = [];
      const original = Buffer.alloc;
      Buffer.alloc = function(size, ...args) { allocations.push(size); return original.call(Buffer, size, ...args); };
      const result = await readFleetText(${JSON.stringify(join(dir, "tiny.log"))});
      console.log(JSON.stringify({ result, allocations }));
    `;
    const child = spawnSync(process.execPath, ["--eval", source], { encoding: "utf8" });
    expect(child.status).toBe(0);
    const result = JSON.parse(child.stdout) as {
      result: { status: string; text: string };
      allocations: number[];
    };
    expect(result.result).toEqual({ status: "ok", text: "x" });
    expect(result.allocations.length).toBeGreaterThan(0);
    expect(Math.max(...result.allocations)).toBeLessThanOrEqual(2);
  }));

test("readFleetText bounds actual reads when a real file grows after stat", () =>
  fixture({ grow: "x", within: "x" }, async (dir) => {
    const moduleUrl = new URL("./fleet-jsonl.ts", import.meta.url).href;
    for (const [name, suffix, expected] of [
      ["grow", "yy", { status: "invalid", text: "" }],
      ["within", "y", { status: "ok", text: "xy" }],
    ] as const) {
      // Hook only the timing of a real append; file reads remain native.
      const source = `
        const { open } = await import("node:fs/promises");
        const { appendFileSync } = await import("node:fs");
        const { readFleetText } = await import(${JSON.stringify(moduleUrl)});
        const handle = await open(${JSON.stringify(join(dir, name))}, "r");
        const proto = Object.getPrototypeOf(handle);
        await handle.close();
        const original = proto.read;
        let first = true, bytes = 0;
        proto.read = async function(...args) {
          if (first) { first = false; appendFileSync(${JSON.stringify(join(dir, name))}, ${JSON.stringify(suffix)}); }
          const result = await original.apply(this, args);
          bytes += result.bytesRead;
          return result;
        };
        const result = await readFleetText(${JSON.stringify(join(dir, name))}, { maxBytes: 2 });
        console.log(JSON.stringify({ result, bytes }));
      `;
      const child = spawnSync(process.execPath, ["--eval", source], { encoding: "utf8" });
      expect(child.status).toBe(0);
      const observed = JSON.parse(child.stdout) as {
        result: { status: string; text: string };
        bytes: number;
      };
      expect(observed.result).toEqual(expected);
      expect(observed.bytes).toBe(name === "grow" ? 3 : 2);
    }
  }));

test("readFleetText handles repeated short reads without per-read allocations", () =>
  fixture({ short: "x".repeat(1024) }, async (dir) => {
    const moduleUrl = new URL("./fleet-jsonl.ts", import.meta.url).href;
    const path = join(dir, "short");
    // Limit native reads to one byte in an isolated child; do not mock their data.
    const source = `
      const { open } = await import("node:fs/promises");
      const { readFleetText } = await import(${JSON.stringify(moduleUrl)});
      const handle = await open(${JSON.stringify(path)}, "r");
      const proto = Object.getPrototypeOf(handle);
      await handle.close();
      const read = proto.read, alloc = Buffer.alloc, from = Buffer.from;
      let reads = 0, allocs = 0, copies = 0;
      proto.read = async function(buffer, offset, length, position) {
        reads++;
        return read.call(this, buffer, offset, Math.min(length, 1), position);
      };
      Buffer.alloc = function(...args) { allocs++; return alloc.apply(Buffer, args); };
      Buffer.from = function(...args) { copies++; return from.apply(Buffer, args); };
      const result = await readFleetText(${JSON.stringify(path)}, { maxBytes: 1024 });
      Buffer.alloc = alloc; Buffer.from = from;
      console.log(JSON.stringify({ result, reads, allocs, copies }));
    `;
    const child = spawnSync(process.execPath, ["--eval", source], { encoding: "utf8" });
    expect(child.status).toBe(0);
    const observed = JSON.parse(child.stdout) as {
      result: { status: string; text: string };
      reads: number;
      allocs: number;
      copies: number;
    };
    expect(observed.result).toEqual({ status: "ok", text: "x".repeat(1024) });
    expect(observed.reads).toBe(1025);
    expect(observed.allocs).toBeLessThanOrEqual(12);
    expect(observed.copies).toBeLessThanOrEqual(10);
  }));

test("readFleetText preserves UTF-8 when a character crosses a read boundary", () =>
  fixture({ unicode: `${"x".repeat(65535)}🌍end` }, async (dir) => {
    const text = `${"x".repeat(65535)}🌍end`;
    expect(
      await readFleetText(join(dir, "unicode"), { maxBytes: Buffer.byteLength(text) }),
    ).toEqual({
      status: "ok",
      text,
    });
    expect(
      (await readFleetText(join(dir, "unicode"), { maxBytes: Buffer.byteLength(text) - 1 })).status,
    ).toBe("invalid");
  }));

test("readFleetText tail keeps the newest bytes and drops the torn first line", () =>
  fixture({}, async (dir) => {
    const rows = Array.from({ length: 8 }, (_, i) => `{"line":${i}}`);
    await writeFile(join(dir, "jobs.jsonl"), `${rows.join("\n")}\n`);
    const source = await readFleetText(join(dir, "jobs.jsonl"), { maxBytes: 32, tail: true });
    expect(source.status).toBe("ok");
    for (const line of source.text.trim().split("\n")) expect(JSON.parse(line).line).toBeNumber();
    expect(source.text).toContain('"line":7');
    expect(source.text.length).toBeLessThanOrEqual(32);
    await writeFile(join(dir, "nonl"), "x".repeat(40));
    expect(await readFleetText(join(dir, "nonl"), { maxBytes: 32, tail: true })).toEqual({
      status: "ok",
      text: "",
    });
    await writeFile(join(dir, "small"), "short");
    expect((await readFleetText(join(dir, "small"), { maxBytes: 32, tail: true })).text).toBe(
      "short",
    );
  }));

test("readFleetJson parses whole documents and enforces the object shape on demand", () =>
  fixture(
    { "slots.json": '{"devin":{"target":2}}', "array.json": "[1,2]", "bad.json": "{broken" },
    async (dir) => {
      expect(await readFleetJson(join(dir, "slots.json"), { object: true })).toEqual({
        status: "ok",
        data: { devin: { target: 2 } },
      });
      expect((await readFleetJson(join(dir, "array.json"), { object: true })).status).toBe(
        "invalid",
      );
      expect((await readFleetJson(join(dir, "array.json"))).data).toEqual([1, 2]);
      expect((await readFleetJson(join(dir, "bad.json"))).status).toBe("invalid");
      expect((await readFleetJson(join(dir, "absent"))).status).toBe("missing");
    },
  ));

test("parseFleetJsonl splits records, skips blank lines and honors malformed modes", () => {
  const good = '{"a":1}\n\n{"b":2}\r\n{"c":3}\n';
  expect(parseFleetJsonl(good)).toEqual({
    status: "ok",
    rows: [{ a: 1 }, { b: 2 }, { c: 3 }],
  });
  expect(parseFleetJsonl("")).toEqual({ status: "ok", rows: [] });
  const mixed = '{"a":1}\nbroken\n{"b":2}';
  expect(parseFleetJsonl(mixed)).toBeNull();
  expect(parseFleetJsonl(mixed, { malformedLines: "flag" })).toEqual({
    status: "invalid",
    rows: [{ a: 1 }, { b: 2 }],
  });
  expect(parseFleetJsonl(mixed, { malformedLines: "ignore" })).toEqual({
    status: "ok",
    rows: [{ a: 1 }, { b: 2 }],
  });
  for (const line of ["null", "[]", "5", '"text"']) expect(parseFleetJsonl(line)).toBeNull();
  expect(parseFleetJsonl('{"a":1}\nnull', { malformedLines: "flag" })?.status).toBe("invalid");
});

test("parseFleetJsonl allowArray accepts queue snapshots and rejects non-record members", () => {
  expect(parseFleetJsonl('[{"id":"a"},{"id":"b"}]', { allowArray: true })).toEqual({
    status: "ok",
    rows: [{ id: "a" }, { id: "b" }],
  });
  expect(parseFleetJsonl('[{"id":"a"},5]', { allowArray: true })).toBeNull();
  expect(parseFleetJsonl('{"a":1}', { allowArray: true })).toEqual({
    status: "ok",
    rows: [{ a: 1 }],
  });
  expect(parseFleetJsonl('[{"id":"a"}]')).toBeNull();
  expect(parseFleetJsonl("{broken", { allowArray: true })).toBeNull();
});

test("readFleetJsonl combines bounded reads with parsing; custom parsers keep dual formats", () =>
  fixture(
    {
      "jobs.jsonl": '{"event":"launch"}\n{"event":"finish"}\n',
      "mixed.log": '2026-10-30T11:00:00Z ok lane=devin\n{"event":"finish"}\n',
      "snap.jsonl": '[{"id":"one"}]',
      "dirty.jsonl": '{"a":1}\nBAD\n{"b":2}',
    },
    async (dir) => {
      expect(await readFleetJsonl(join(dir, "jobs.jsonl"))).toEqual({
        status: "ok",
        rows: [{ event: "launch" }, { event: "finish" }],
      });
      const dual = (line: string) => {
        try {
          const row: unknown = JSON.parse(line);
          return isFleetRow(row) ? row : null;
        } catch {
          return { event: line.split(" ")[1]! };
        }
      };
      expect(await readFleetJsonl(join(dir, "mixed.log"), { parseLine: dual })).toEqual({
        status: "ok",
        rows: [{ event: "ok" }, { event: "finish" }],
      });
      expect(await readFleetJsonl(join(dir, "snap.jsonl"), { allowArray: true })).toEqual({
        status: "ok",
        rows: [{ id: "one" }],
      });
      expect((await readFleetJsonl(join(dir, "dirty.jsonl"))).status).toBe("invalid");
      expect(await readFleetJsonl(join(dir, "dirty.jsonl"), { malformedLines: "ignore" })).toEqual({
        status: "ok",
        rows: [{ a: 1 }, { b: 2 }],
      });
      expect((await readFleetJsonl(join(dir, "absent"))).status).toBe("missing");
      expect((await readFleetJsonl(join(dir, "absent"), { ioStatus: "unavailable" })).status).toBe(
        "missing",
      );
    },
  ));

test("openFleetFile returns a handle for regular files and refuses links and directories", () =>
  fixture({ "ok.log": "x" }, async (dir) => {
    const file = await openFleetFile(join(dir, "ok.log"));
    await file.close();
    await mkdir(join(dir, "sub"));
    await symlink(join(dir, "ok.log"), join(dir, "link"));
    for (const path of [join(dir, "sub"), join(dir, "link"), join(dir, "absent")])
      await expect(openFleetFile(path)).rejects.toThrow();
  }));
