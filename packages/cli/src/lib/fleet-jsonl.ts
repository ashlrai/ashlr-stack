import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

/** One journal row; prompts, tokens and error bodies never qualify as one. */
export type FleetRow = Record<string, unknown>;
export const isFleetRow = (value: unknown): value is FleetRow =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** "missing" is ENOENT only; every other read failure is unreadable input. */
export type FleetSourceStatus = "ok" | "missing" | "invalid" | "unavailable";

export interface FleetReadOptions {
  /** Maximum accepted bytes (default 16 MiB); a non-tail read may probe one extra byte. */
  maxBytes?: number;
  /** Keep only the final maxBytes of a larger file and drop the split first line. */
  tail?: boolean;
  /** Status for non-ENOENT I/O failures (default "invalid"). */
  ioStatus?: "invalid" | "unavailable";
}

/** Bounded public state reads only: regular files, never links, never blocking on pipes. */
export async function openFleetFile(path: string): Promise<FileHandle> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error("Not a regular file");
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

export type FleetTextSource = { status: FleetSourceStatus; text: string };

/** Read a bounded snapshot; a tail read keeps the newest maxBytes and drops the torn first line. */
export async function readFleetText(
  path: string,
  options: FleetReadOptions = {},
): Promise<FleetTextSource> {
  const { maxBytes = 16 * 1024 * 1024, tail = false, ioStatus = "invalid" } = options;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid byte limit");
    const file = await openFleetFile(path);
    try {
      const stat = await file.stat();
      if (stat.size > maxBytes && !tail) throw new Error("Oversized source");
      let text: string;
      if (tail && stat.size > maxBytes) {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await file.read(buffer, 0, maxBytes, stat.size - maxBytes);
        const chunk = buffer.subarray(0, bytesRead).toString("utf8");
        const newline = chunk.indexOf("\n");
        text = newline < 0 ? "" : chunk.slice(newline + 1);
      } else {
        // Read to EOF into one growing buffer. Probe one byte at the cap to
        // detect growth without allocating per short read or returning excess.
        const initial = Math.min(64 * 1024, Math.max(1, stat.size), maxBytes);
        let buffer = Buffer.alloc(initial);
        let offset = 0;
        for (;;) {
          if (offset === maxBytes) {
            const probe = Buffer.alloc(1);
            if ((await file.read(probe, 0, 1, offset)).bytesRead)
              throw new Error("Oversized source");
            break;
          }
          if (offset === buffer.length) {
            const grown = Buffer.alloc(Math.min(maxBytes, buffer.length * 2));
            buffer.copy(grown, 0, 0, offset);
            buffer = grown;
          }
          const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        text = buffer.subarray(0, offset).toString("utf8");
      }
      return { status: "ok", text };
    } finally {
      await file.close();
    }
  } catch (error) {
    return {
      status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : ioStatus,
      text: "",
    };
  }
}

export type FleetJsonSource = { status: FleetSourceStatus; data: unknown };

/** Whole-document JSON state (slots files, fixtures); `object` rejects arrays and scalars. */
export async function readFleetJson(
  path: string,
  options: FleetReadOptions & { object?: boolean } = {},
): Promise<FleetJsonSource> {
  const source = await readFleetText(path, options);
  if (source.status !== "ok") return { status: source.status, data: null };
  try {
    const data: unknown = JSON.parse(source.text);
    if (options.object && !isFleetRow(data)) throw new Error("Expected a JSON object");
    return { status: "ok", data };
  } catch {
    return { status: "invalid", data: null };
  }
}

export type FleetRowsSource = { status: FleetSourceStatus; rows: FleetRow[] };

export interface FleetJsonlOptions extends FleetReadOptions {
  /** Accept a whole-file JSON array (queue snapshots), not just JSONL. Default false. */
  allowArray?: boolean;
  /** Bad lines: "fail" discards the source, "flag" keeps good rows but marks the source
   * invalid, "ignore" skips them silently. Default "fail". */
  malformedLines?: "fail" | "flag" | "ignore";
  /** Custom line parser for dual-format logs; null marks the line malformed. */
  parseLine?: (line: string) => FleetRow | null;
  /** Extra row predicate; a false return keeps the row but marks the source invalid. */
  flagRow?: (row: FleetRow) => boolean;
}

const jsonlLine = (line: string): FleetRow | null => {
  try {
    const row: unknown = JSON.parse(line);
    return isFleetRow(row) ? row : null;
  } catch {
    return null;
  }
};

/** Parse an already-read journal; null means malformedLines "fail" tripped. */
export function parseFleetJsonl(
  text: string,
  options: Pick<FleetJsonlOptions, "allowArray" | "malformedLines" | "parseLine" | "flagRow"> = {},
): FleetRowsSource | null {
  const { allowArray = false, malformedLines = "fail", parseLine = jsonlLine, flagRow } = options;
  if (allowArray && text.trim().startsWith("[")) {
    try {
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data) || !data.every(isFleetRow)) return null;
      return { status: "ok", rows: data };
    } catch {
      return null;
    }
  }
  const rows: FleetRow[] = [];
  let status: FleetSourceStatus = "ok";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = parseLine(line);
    if (row === null) {
      if (malformedLines === "fail") return null;
      if (malformedLines === "flag") status = "invalid";
      continue;
    }
    if (flagRow && !flagRow(row)) status = "invalid";
    rows.push(row);
  }
  return { status, rows };
}

/** Bounded read plus JSONL/array parsing in one call. */
export async function readFleetJsonl(
  path: string,
  options: FleetJsonlOptions = {},
): Promise<FleetRowsSource> {
  const source = await readFleetText(path, options);
  if (source.status !== "ok") return { status: source.status, rows: [] };
  return parseFleetJsonl(source.text, options) ?? { status: "invalid", rows: [] };
}
