import { writeSync as fsWriteSync } from "node:fs";

type WriteCallback = (error?: Error | null) => void;
type WriteFn = (fd: number, data: Uint8Array) => number;

/**
 * Make `stream.write` write synchronously to its file descriptor.
 *
 * Bun 1.2.x queues `process.stdout` writes to a pipe or file and
 * `process.exit()` drops whatever is still queued, so the last lines a
 * command printed before `outroError` (which exits) never reached the
 * reader. Node already writes stdout synchronously to pipes and files on
 * POSIX; this gives Bun the same behaviour, so nothing is pending when a
 * command exits. A reader that went away (EPIPE) drops the output, and a
 * non-blocking descriptor (EAGAIN) is retried until it takes the bytes.
 */
export function makeWritesSynchronous(
  stream: NodeJS.WriteStream,
  writeSync: WriteFn = fsWriteSync,
): void {
  const declared = (stream as { fd?: unknown }).fd;
  const fd = typeof declared === "number" ? declared : 1;
  const write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    const cb = typeof encoding === "function" ? encoding : callback;
    const enc = typeof encoding === "string" ? encoding : "utf8";
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, enc) : chunk;
    let offset = 0;
    while (offset < bytes.length) {
      try {
        offset += writeSync(fd, bytes.subarray(offset));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
        break;
      }
    }
    if (cb) queueMicrotask(() => cb(null));
    return true;
  };
  stream.write = write as NodeJS.WriteStream["write"];
}

/** Install synchronous stdout/stderr when running under Bun (Node already is). */
export function installSynchronousStdio(): void {
  if (!process.versions.bun) return;
  makeWritesSynchronous(process.stdout);
  makeWritesSynchronous(process.stderr);
}
