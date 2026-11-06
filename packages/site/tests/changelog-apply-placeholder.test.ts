import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");
const publishedPath = "packages/site/src/data/CHANGELOG.md";

const placeholderRemovalLead =
  "- **`stack apply` stops attempting to write placeholder secrets.**";
const recipeEntryLead = "- **`stack apply [recipe-id]`**";

/**
 * Raw text of every top-level bullet starting with `lead`. A lookalike line
 * inside a fenced code block lexes as part of a `code` token, never as a list
 * item, so fences cannot forge an entry.
 */
function bulletsStartingWith(markdown: string, lead: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((token) => (token.type === "list" ? token.items : []))
    .filter((item) => item.raw.startsWith(lead))
    .map((item) => item.raw);
}

/**
 * The `##` version heading whose section holds each bullet starting with
 * `lead`, in file order; `null` for a bullet outside every version section
 * (file head, `## Unreleased`, or a non-version `##` heading).
 */
function releasesContaining(markdown: string, lead: string): (string | null)[] {
  let release: string | null = null;
  const found: (string | null)[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release =
        token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)
          ? token.text
          : null;
    }
    if (token.type === "list") {
      for (const item of token.items) {
        if (item.raw.startsWith(lead)) found.push(release);
      }
    }
  }
  return found;
}

test("historical stack apply entry states the wiring step stops writing placeholder secrets", () => {
  const published = readFileSync(join(root, publishedPath), "utf8");
  const entries = bulletsStartingWith(published, placeholderRemovalLead);
  expect(entries).toHaveLength(1);

  const [entry] = entries;
  // The entry must state that the wiring step no longer writes placeholder
  // secrets: nothing goes to the vault, nothing fills in missing values.
  expect(entry).toContain(
    "The wiring step never writes to the vault or fills in missing values.",
  );
  // "Stops attempting" is the accurate claim — the old writes always failed —
  // so the heading must not be shortened into `stops writing` / `no longer
  // writes` placeholder secrets.
  expect(entry).not.toMatch(/stops? writing placeholder|no longer writes placeholder/i);
  // It must also record why: the placeholder writes it removed never worked.
  expect(entry).toContain(
    "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`",
  );
  expect(entry).toContain("every call failed");
  // And it must tell the operator what replaces them: real values added by hand.
  expect(entry).toContain(
    "users must supply each required missing value themselves",
  );
  expect(entry).toContain(
    "run `phantom add <NAME>` from a trusted terminal and enter the real value",
  );
});

test("placeholder-removal entry is filed under the 0.2.1 release", () => {
  const published = readFileSync(join(root, publishedPath), "utf8");
  expect(releasesContaining(published, placeholderRemovalLead)).toEqual([
    "0.2.1 (2026-10-16)",
  ]);
});

test("original stack apply recipe entry confirms wiring no longer writes placeholders", () => {
  const published = readFileSync(join(root, publishedPath), "utf8");
  const entries = bulletsStartingWith(published, recipeEntryLead);
  expect(entries).toHaveLength(1);
  expect(releasesContaining(published, recipeEntryLead)).toEqual([
    "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
  ]);

  const [entry] = entries;
  // The original entry must describe the placeholder writes as historical and
  // point at the fix that removed them, not as something wiring still does.
  expect(entry).toContain(
    "Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder for each declared secret, but those calls failed; the 0.2.1 fix above removed the attempts.",
  );
  expect(entry).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
});

test("bullet lookup ignores lookalike lines inside code fences", () => {
  const fenced = `${placeholderRemovalLead}\n\n\`\`\`md\n${placeholderRemovalLead}\n\`\`\`\n`;
  expect(bulletsStartingWith(fenced, placeholderRemovalLead)).toHaveLength(1);
  expect(bulletsStartingWith("", placeholderRemovalLead)).toEqual([]);
  expect(
    bulletsStartingWith("intro paragraph\n\n- other bullet\n", placeholderRemovalLead),
  ).toEqual([]);
});

test("release attribution bounds entries to their own version section", () => {
  const lead = placeholderRemovalLead;
  // Before any heading and inside `## Unreleased`: no version.
  expect(releasesContaining(`${lead}\n`, lead)).toEqual([null]);
  expect(
    releasesContaining(`## Unreleased\n\n${lead}\n`, lead),
  ).toEqual([null]);
  // Inside a version heading's section: that version, in both heading styles.
  expect(releasesContaining(`## 0.2.1 (2026-10-16)\n\n${lead}\n`, lead)).toEqual([
    "0.2.1 (2026-10-16)",
  ]);
  expect(releasesContaining(`## [0.2.1] — date\n\n${lead}\n`, lead)).toEqual([
    "[0.2.1] — date",
  ]);
  // A later version heading starts a new section; each entry gets its own.
  expect(
    releasesContaining(
      `## 0.2.1\n\n${lead}\n\n## 0.3.0\n\n${lead}\n`,
      lead,
    ),
  ).toEqual(["0.2.1", "0.3.0"]);
  // Non-version `##` headings and `#` titles close the version section.
  expect(
    releasesContaining(`## 0.2.1\n\n## Notes\n\n${lead}\n`, lead),
  ).toEqual([null]);
  expect(
    releasesContaining(`## 0.2.1\n\n# Other\n\n${lead}\n`, lead),
  ).toEqual([null]);
});
