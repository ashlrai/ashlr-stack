import { expect, test } from "bun:test";
import { versionSections } from "./changelog-parser-utils";

test("adjacent sections retain only their own body text", () => {
  const markdown = [
    "# Changelog",
    "## 2.0.0 (2026-11-09)",
    "First release body.",
    "- First release entry.",
    "## 1.0.0 (2026-11-08)",
    "Second release body.",
    "- Second release entry.",
  ].join("\n");
  const expected = [
    { heading: "## 2.0.0 (2026-11-09)", body: "First release body.\n- First release entry.\n" },
    { heading: "## 1.0.0 (2026-11-08)", body: "Second release body.\n- Second release entry.\n" },
  ];

  for (const input of [markdown, markdown.replace(/\n/g, "\r\n")]) {
    expect(versionSections(input)).toEqual(expected);
  }
});
