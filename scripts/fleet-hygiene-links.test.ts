import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const docPath = resolve(root, "docs/fleet-repo-hygiene.md");

// Relative file targets of markdown links/images/reference definitions.
// Fenced blocks and inline code spans are skipped: this doc quotes other
// repos' broken links (`a.md` → `docs/x.md`) as data, and those are not ours.
// URLs, mailto:, and pure #anchors are not local files, so they are ignored.
export function relativeLinkTargets(markdown: string): string[] {
  const prose = markdown
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const raw = [
    ...[...prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/gm)].map((m) => m[1]),
    ...[...prose.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)="([^"]+)"/gi)].map((m) => m[1]),
  ] as string[];
  return raw
    .filter((t) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(t))
    .map((t) => decodeURI(t.split("#")[0]?.split("?")[0] ?? ""))
    .filter((t) => t.length > 0);
}

describe("docs/fleet-repo-hygiene.md relative links", () => {
  test("every relative file link resolves locally", () => {
    const targets = relativeLinkTargets(readFileSync(docPath, "utf8"));
    const missing = targets.filter((t) => !existsSync(resolve(dirname(docPath), t)));
    expect(missing).toEqual([]);
  });
});

describe("relativeLinkTargets", () => {
  test("finds inline, image, reference and html links; strips anchors and queries", () => {
    const md = [
      "[a](./a.md#top) ![i](img/p.png \"t\") [r][1] <a href=\"b.md?x=1\">b</a>",
      "[1]: ../c.md",
    ].join("\n");
    expect(relativeLinkTargets(md).sort()).toEqual(["../c.md", "./a.md", "b.md", "img/p.png"]);
  });

  test("ignores urls, anchors, mailto, code spans and fenced blocks", () => {
    const md = [
      "[x](https://a.io) [y](#h) [z](mailto:a@b.c) `[q](nope.md)`",
      "```",
      "[f](fenced.md)",
      "```",
    ].join("\n");
    expect(relativeLinkTargets(md)).toEqual([]);
  });

  test("detects a broken link", () => {
    const [t] = relativeLinkTargets("[x](docs/definitely-missing-file.md)");
    expect(existsSync(resolve(root, t as string))).toBe(false);
  });
});
