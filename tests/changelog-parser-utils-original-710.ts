/** Historical710 terminal-line projection; current callers keep their existing exact-body contract. */
export { malformedHeadings, sectionEntries } from "./changelog-parser-utils";

/** Splits into lines; a final newline terminates the last line instead of adding an empty one. */
function sourceLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Version sections in source order: heading line → body up to the next `## ` heading. */
export function versionSections(markdown: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let fenced = false;
  for (const line of sourceLines(markdown)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) sections.push({ heading: line, body: "" });
    else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`;
  }
  return sections;
}

/** Body of each semver `##` section, keyed by its heading line (fenced code ignored). */
export function versionBodies(md: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  let fenced = false;
  for (const line of sourceLines(md)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) {
      key = /^## +\[?\d+\.\d+\.\d+/.test(line) ? line : null;
      if (key) bodies.set(key, "");
    } else if (key) {
      bodies.set(key, `${bodies.get(key)}${line}\n`);
    }
  }
  return bodies;
}
