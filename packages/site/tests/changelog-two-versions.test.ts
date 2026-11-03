import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-two-versions.md"), "utf8");

type Entry = { version: string; section: string; text: string };

/** Every list entry tagged with its `##` version and `###` section, in source order. */
function entries(markdown: string): Entry[] {
  const out: Entry[] = [];
  let version = "";
  let section = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) [version, section] = [t.text, ""];
    else if (t.type === "heading" && t.depth === 3) section = t.text;
    else if (t.type === "list") for (const item of t.items) out.push({ version, section, text: item.text });
  }
  return out;
}

test("two versions keep their entries associated and in source order", () => {
  expect(entries(fixture)).toEqual([
    { version: "0.2.0 (2026-06-10)", section: "Added", text: "Shared entry text." },
    { version: "0.2.0 (2026-06-10)", section: "Added", text: "Zulu entry only in 0.2.0." },
    { version: "0.2.0 (2026-06-10)", section: "Fixed", text: "Alpha fix only in 0.2.0." },
    { version: "0.1.0 (2026-06-01)", section: "Added", text: "Shared entry text." },
    { version: "0.1.0 (2026-06-01)", section: "Added", text: "Bravo entry only in 0.1.0." },
  ]);
});

test("identical entry text in both versions is not merged or reassigned", () => {
  const shared = entries(fixture).filter((e) => e.text === "Shared entry text.");
  expect(shared.map((e) => e.version)).toEqual(["0.2.0 (2026-06-10)", "0.1.0 (2026-06-01)"]);
});

test("headings stay in file order (newest first), not sorted", () => {
  const versions = marked
    .lexer(fixture)
    .filter((t) => t.type === "heading" && t.depth === 2)
    .map((t) => (t as { text: string }).text);
  expect(versions).toEqual(["0.2.0 (2026-06-10)", "0.1.0 (2026-06-01)"]);
});
