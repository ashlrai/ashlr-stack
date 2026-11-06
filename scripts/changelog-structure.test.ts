import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const entry = "- **`stack apply [recipe-id]`**";
const release = "0.1.0 — 2026-04-19 (superseded by 0.1.1)";

// Track real level-one and level-two headings, ignoring examples in code fences.
function historicalApplySections(markdown: string): (string | undefined)[] {
  let section: string | undefined;
  let fence: { marker: string; length: number } | undefined;
  const sections: (string | undefined)[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) {
        fence = undefined;
      }
      continue;
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$/);
    if (heading) section = heading[1] === "##" ? heading[2] : undefined;
    if (line.startsWith(entry)) sections.push(section);
  }
  return sections;
}

test("historical stack apply entry belongs to its version heading", () => {
  const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
  expect(historicalApplySections(changelog)).toEqual([release]);
});

test("structural check detects orphaned, moved, missing, and duplicate entries", () => {
  expect(historicalApplySections(`# Changelog\n## ${release}\n### Added\n${entry} text`)).toEqual([release]);
  for (const markdown of [
    `# Changelog\n${entry}\n## ${release}`,
    `## ${release}\n## 0.2.0\n${entry}`,
    `## ${release}\n# Appendix\n${entry}`,
    `## ${release}`,
    `## ${release}\n${entry}\n${entry}`,
    `## 0.2.0\n\`\`\`md\n## ${release}\n\`\`\`\n${entry}`,
  ]) {
    expect(historicalApplySections(markdown)).not.toEqual([release]);
  }
});

test("structural check ignores fenced entries and headings", () => {
  const markdown = `## ${release}\n\`\`\`\`md\n## 0.2.0\n${entry}\n\`\`\`\n\`\`\`\`\n~~~md\n${entry}\n~~~\n${entry}`;
  expect(historicalApplySections(markdown)).toEqual([release]);
});
