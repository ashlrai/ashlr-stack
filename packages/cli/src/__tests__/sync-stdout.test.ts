import { describe, expect, it } from "bun:test";
import { makeWritesSynchronous } from "../lib/sync-stdout.ts";

function fakeStream(): NodeJS.WriteStream {
  return { fd: 7, write: () => false } as unknown as NodeJS.WriteStream;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("makeWritesSynchronous", () => {
  it("writes every byte before returning, across partial writes and EAGAIN", () => {
    const stream = fakeStream();
    const written: Buffer[] = [];
    let calls = 0;
    makeWritesSynchronous(stream, (fd, data) => {
      expect(fd).toBe(7);
      calls++;
      if (calls === 2) throw errno("EAGAIN");
      const n = Math.min(3, data.length);
      written.push(Buffer.from(data.subarray(0, n)));
      return n;
    });
    expect(stream.write("héllo\n")).toBe(true);
    expect(Buffer.concat(written).toString()).toBe("héllo\n");
  });

  it("drops output when the reader is gone (EPIPE) and still calls back", async () => {
    const stream = fakeStream();
    makeWritesSynchronous(stream, () => {
      throw errno("EPIPE");
    });
    const done = new Promise<unknown>((resolve) => stream.write("x", resolve));
    expect(await done).toBeNull();
  });
});
