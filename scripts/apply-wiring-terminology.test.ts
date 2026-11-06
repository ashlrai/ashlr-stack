import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const changelogs = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const guide = read("docs/apply-wiring-terminology.md");

// Restrict the mirror comparison to the entries covered by this guide, so an
// unrelated changelog change does not force a terminology review.
function entry(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("apply wiring terminology sources", () => {
  test("the documented apply entries match in the two checked-in changelogs", () => {
    const boundaries = [
      ["- `stack apply` does not create placeholder secrets.", "\n\n## 0.3.0"],
      ["- Apply wiring checks existing secret names", "\n- MCP compacts"],
      ["- After at least one provider succeeds, `stack apply`", "\n- `stack status`"],
      ["- **`stack apply` with a missing recipe", "\n\n## 0.2.1"],
      ["- **`stack apply` stops attempting to write placeholder secrets.", "\n\n- **Command errors"],
      ["- **`stack apply [recipe-id]`**", "\n- **MCP surface"],
    ];
    const [repository, site] = changelogs.map(read);
    for (const [start, end] of boundaries) {
      expect(entry(site, start, end)).toBe(entry(repository, start, end));
    }
  });

  test("the glossary covers the source labels and their different scopes", () => {
    const source = read(changelogs[0]);
    for (const label of ["TODO_STACK_APPLY", "envelopes", "present", "missing", "skipped", "webhooks", "--noWire"]) {
      expect(source).toContain(label);
      expect(guide).toContain(`\`${label}\``);
    }
    expect(guide).toContain("including failed providers");
    expect(guide).toContain("does not prove all required secrets are present");
    expect(guide).toContain("no wording differences between their apply entries");
  });
});
