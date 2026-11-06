/** Shared CHANGELOG.md parser functions — importable by test files. */

/** Returns every level-2 heading that is not well formed (fenced code is ignored). */
export function malformedHeadings(markdown: string): string[] {
  const DATE = "\\d{4}-\\d{2}-\\d{2}";
  const VERSION_HEADING = new RegExp(
    `^## (?:Unreleased|(?:\\d+\\.\\d+\\.\\d+|\\[\\d+\\.\\d+\\.\\d+\\]) (?:\\(${DATE}\\)|— ${DATE})(?: \\([^()]+\\))?)$`,
  );
  let fenced = false;
  const bad: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line) && !VERSION_HEADING.test(line)) bad.push(line);
  }
  return bad;
}

/** Version sections in source order: heading line → body up to the next `## ` heading. */
export function versionSections(markdown: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) sections.push({ heading: line, body: "" });
    else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`;
  }
  return sections;
}

/** Entries per version and `### ` section, in source order; repeated section names stay separate. */
export function sectionEntries(markdown: string): { version: string; section: string; entries: string[] }[] {
  const out: { version: string; section: string; entries: string[] }[] = [];
  let version = "";
  let current: (typeof out)[number] | null = null;
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^##(?!#)/.test(line)) {
      version = line;
      current = null; // a new version must not inherit the previous version's section
    } else if (/^### /.test(line)) {
      current = { version, section: line.slice(4), entries: [] };
      out.push(current);
    } else if (/^- /.test(line) && current) current.entries.push(line.slice(2));
  }
  return out;
}

/** Inline Markdown links `[label](destination "optional title")` in a body, in source order. */
export function inlineLinks(body: string): { label: string; destination: string }[] {
  return [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({
    label: m[1],
    destination: m[2],
  }));
}

/** Body of each semver `##` section, keyed by its heading line (fenced code ignored). */
export function versionBodies(md: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  let fenced = false;
  for (const line of md.split(/\r?\n/)) {
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
