import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const site = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(path, "utf8");

/** Generate from reviewed guidance, README headings and rendered docs headings. */
export function generateAgentIndex(pages) {
  const { version } = JSON.parse(read(join(site, "../cli/package.json")));
  const readme = read(join(site, "../../README.md"));
  const summary = readme.match(/^\*\*Configure[^\n]+/m)?.[0];
  if (!summary) throw new Error("README product summary is missing");
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => {
    const title = match[1];
    const anchor = title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
    return `- [${title}](https://github.com/ashlrai/ashlr-stack#${anchor})`;
  });
  const docs = pages.filter((page) => page.path.startsWith("/docs")).sort((a, b) => a.path.localeCompare(b.path));
  return [
    read(join(site, "src/data/agent-guide.txt")).replaceAll("{{VERSION}}", version).trim(),
    "## README overview\n\n" + summary,
    "## README sections\n\n" + headings.join("\n"),
    "## Documentation\n\n" + docs.map((page) => `- [${page.title}](https://stack.ashlr.ai${page.path}): ${page.headings.join("; ")}`).join("\n"),
    "<!-- Generated during astro build from README.md, agent-guide.txt and rendered docs. -->",
    "",
  ].join("\n\n").replaceAll("\u2014", "-").trimEnd() + "\n";
}

export function agentIndex() {
  return {
    name: "stack-agent-index",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const output = fileURLToPath(dir);
        const docs = join(output, "docs");
        const pages = readdirSync(docs, { recursive: true }).filter((file) => file.endsWith(".html")).map((file) => {
          const html = read(join(docs, file));
          const text = (value) => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
          if (!title) throw new Error(`Missing docs title: ${file}`);
          return {
            path: `/docs/${file}`.replace(/\/index\.html$/, "").replace(/\.html$/, ""),
            title: text(title),
            headings: [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => text(match[1])),
          };
        });
        const content = generateAgentIndex(pages);
        writeFileSync(join(output, "llms.txt"), content);
        writeFileSync(join(site, "public/llms.txt"), content);
      },
    },
  };
}
