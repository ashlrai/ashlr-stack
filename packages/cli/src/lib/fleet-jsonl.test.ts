import { expect, test } from "bun:test";
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
