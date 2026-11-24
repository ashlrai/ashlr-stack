#!/usr/bin/env node
// Session-start notice. If .stack.toml lists services, remind the agent to look.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function noticeFor(text) {
  const services = text.split(/\r?\n/).filter((line) => line.startsWith("[services.")).length;
  return `[ashlr-stack] .stack.toml detected (${services} services). Run /stack:status for an overview.\n`;
}

function main() {
  let text = "";
  try {
    text = readFileSync(".stack.toml", "utf8");
  } catch {
    process.exit(0);
  }
  const notice = noticeFor(text);
  if (notice) process.stdout.write(notice);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main();
